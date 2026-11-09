import { DefaultBoardCamera } from '@ue-too/board';
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { OrthographicCamera } from 'three';

import { type BoardView, applyTopDownCamera } from '../src/three/camera.js';
import { TrackScene } from '../src/three/track-scene.js';
import { TrackView3D } from '../src/three/track-view.js';
import { TrackGraph } from '../src/tracks/track.js';

/**
 * A stand-in WebGL 2 context, enough for three's `WebGLRenderer` to build and
 * dispose: constants are distinct numbers, and other calls do nothing.
 */
function fakeWebGL2(): WebGL2RenderingContext {
    const constants = new Map<string, number>();
    const constant = (name: string) => {
        if (!constants.has(name)) constants.set(name, constants.size + 1);
        return constants.get(name)!;
    };
    const known: Record<string, unknown> = {
        getParameter: (parameter: number) => {
            if (parameter === constant('VERSION')) return 'WebGL 2.0';
            if (parameter === constant('SHADING_LANGUAGE_VERSION')) {
                return 'WebGL GLSL ES 3.00';
            }
            if (
                parameter === constant('VIEWPORT') ||
                parameter === constant('SCISSOR_BOX')
            ) {
                return [0, 0, 300, 150];
            }
            return 16;
        },
        getShaderPrecisionFormat: () => ({
            precision: 23,
            rangeMin: 127,
            rangeMax: 127,
        }),
        getExtension: (name: string) =>
            name === 'WEBGL_lose_context' ? { loseContext() {} } : null,
        getSupportedExtensions: () => [],
        getContextAttributes: () => ({ alpha: true, antialias: true }),
        isContextLost: () => false,
    };
    return new Proxy(known, {
        get(target, key) {
            if (typeof key !== 'string') return undefined;
            if (key in target) return target[key];
            if (/^[A-Z0-9_]+$/.test(key)) return constant(key);
            return () => ({});
        },
    }) as unknown as WebGL2RenderingContext;
}

/**
 * A canvas that hands out `fakeWebGL2`, and whose document ignores listeners
 * as it does (`OrbitControls` listens on both).
 */
function fakeCanvas(): HTMLCanvasElement {
    const gl = fakeWebGL2();
    const ignore = () => {};
    const document = { addEventListener: ignore, removeEventListener: ignore };
    return {
        ...document,
        width: 300,
        height: 150,
        style: {},
        ownerDocument: document,
        getRootNode: () => document,
        getContext: () => gl,
    } as unknown as HTMLCanvasElement;
}

function frustumOf(camera: OrthographicCamera) {
    const { left, right, top, bottom } = camera;
    return { left, right, top, bottom };
}

const WIDTH = 1280;
const HEIGHT = 720;

describe('TrackView3D.setTopDown', () => {
    let scene: TrackScene;
    let view: TrackView3D;
    const restores: Array<() => void> = [];

    beforeEach(() => {
        // three's renderer stops its animation loop on dispose; Bun has no
        // animation frames.
        if (typeof globalThis.cancelAnimationFrame !== 'function') {
            globalThis.cancelAnimationFrame = () => {};
            restores.push(() => {
                delete (globalThis as { cancelAnimationFrame?: unknown })
                    .cancelAnimationFrame;
            });
        }
        scene = new TrackScene(new TrackGraph());
        view = new TrackView3D(fakeCanvas(), scene, { autoRender: false });
    });

    afterEach(() => {
        view.dispose();
        scene.dispose();
        for (const restore of restores.splice(0)) restore();
    });

    /** The straight-down camera `view` draws with. */
    const topDownCamera = () => view['_topDownCamera'];

    /** The straight-down camera a plain copy of `board` gives. */
    function expectedCamera(board: BoardView): OrthographicCamera {
        const camera = new OrthographicCamera();
        applyTopDownCamera(camera, {
            position: { x: board.position.x, y: board.position.y },
            zoomLevel: board.zoomLevel,
            rotation: board.rotation,
            viewPortWidth: board.viewPortWidth,
            viewPortHeight: board.viewPortHeight,
        });
        return camera;
    }

    it('follows a real board camera, whose fields are getters', () => {
        const board = new DefaultBoardCamera({
            viewPortWidth: WIDTH,
            viewPortHeight: HEIGHT,
            position: { x: 120, y: -40 },
            zoomLevel: 2,
            rotation: Math.PI / 6,
        });

        view.setTopDown(board);

        const frustum = frustumOf(topDownCamera());
        for (const side of Object.values(frustum)) {
            expect(Number.isFinite(side)).toBe(true);
        }
        expect(frustum).toEqual({
            left: -WIDTH / 2 / 2,
            right: WIDTH / 2 / 2,
            top: HEIGHT / 2 / 2,
            bottom: -HEIGHT / 2 / 2,
        });
        expect(topDownCamera().position.toArray()).toEqual(
            expectedCamera(board).position.toArray()
        );
        expect(topDownCamera().up.toArray()).toEqual(
            expectedCamera(board).up.toArray()
        );
    });

    it('requests one render for the same view given twice', () => {
        const board = new DefaultBoardCamera({
            viewPortWidth: WIDTH,
            viewPortHeight: HEIGHT,
        });
        const requests = spyOn(view, 'requestRender');

        view.setTopDown(board);
        view.setTopDown(board);
        expect(requests).toHaveBeenCalledTimes(1);

        board.setPosition({ x: 10, y: 0 });
        view.setTopDown(board);
        expect(requests).toHaveBeenCalledTimes(2);
    });

    it('records a view set while orbiting, and comes back to it', () => {
        const board = new DefaultBoardCamera({
            viewPortWidth: WIDTH,
            viewPortHeight: HEIGHT,
        });
        view.setTopDown(board);
        view.enterOrbit();
        const requests = spyOn(view, 'requestRender');

        board.setPosition({ x: 300, y: 200 });
        view.setTopDown(board);
        expect(view.orbiting).toBe(true);
        expect(requests).not.toHaveBeenCalled();

        view.leaveOrbit();
        expect(requests).toHaveBeenCalledTimes(1);
        expect(topDownCamera().position.toArray()).toEqual(
            expectedCamera(board).position.toArray()
        );
    });
});
