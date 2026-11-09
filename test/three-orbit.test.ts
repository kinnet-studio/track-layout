import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Box3, Vector3 } from 'three';

import {
    GROUND_MARGIN,
    GROUND_OPACITY,
    ORBIT_MAX_POLAR,
    createGround,
    fitGround,
    groundRect,
    orbitNearFar,
    orbitPoseFrom,
} from '../src/three/orbit.js';
import { TrackScene } from '../src/three/track-scene.js';
import {
    AMBIENT_INTENSITY,
    DETAILED_TRACK_ZOOM,
    SUN_INTENSITY,
    TrackView3D,
    WebGLUnavailableError,
    sunDirection,
} from '../src/three/track-view.js';
import { TrackGraph } from '../src/tracks/track.js';

const VIEW = {
    position: { x: 100, y: 50 },
    zoomLevel: 1,
    rotation: 0,
    viewPortWidth: 1280,
    viewPortHeight: 720,
};

/** The pose's horizontal offset from the target, as a unit vector. */
function heading(pose: ReturnType<typeof orbitPoseFrom>): Vector3 {
    const offset = pose.position.clone().sub(pose.target);
    return offset.setZ(0).normalize();
}

describe('orbitPoseFrom', () => {
    it('enters orbit over the view centre, tilted 45° at the same heading', () => {
        const pose = orbitPoseFrom(VIEW);
        expect(pose.target.toArray()).toEqual([100, -50, 0]);
        const tilt = pose.position
            .clone()
            .sub(pose.target)
            .angleTo(new Vector3(0, 0, 1));
        expect(tilt).toBeCloseTo(Math.PI / 4, 6);
        // heading: the horizontal offset points toward screen-down (−y in the scene, here (0, -1))
        expect(heading(pose).x).toBeCloseTo(0, 9);
        expect(heading(pose).y).toBeCloseTo(-1, 9);
        expect(pose.up.toArray()).toEqual([0, 0, 1]);
    });

    it('keeps the heading of a rotated view', () => {
        // The top-down camera's up is (sin r, cos r); screen-down is its opposite.
        const r = Math.PI / 6;
        const pose = orbitPoseFrom({ ...VIEW, rotation: r });
        expect(heading(pose).x).toBeCloseTo(-Math.sin(r), 9);
        expect(heading(pose).y).toBeCloseTo(-Math.cos(r), 9);
        expect(
            pose.position
                .clone()
                .sub(pose.target)
                .angleTo(new Vector3(0, 0, 1))
        ).toBeCloseTo(Math.PI / 4, 6);
    });

    it('frames the area that was in view', () => {
        const tan = Math.tan((22.5 * Math.PI) / 180);
        const wide = orbitPoseFrom(VIEW);
        const expected = 1280 / 1 / 2 / tan;
        const distance = wide.position.distanceTo(wide.target);
        expect(Math.abs(distance - expected) / expected).toBeLessThan(0.01);

        // A tall, zoomed-in view: its height is the larger dimension.
        const tall = orbitPoseFrom({
            ...VIEW,
            zoomLevel: 4,
            viewPortWidth: 600,
            viewPortHeight: 900,
        });
        expect(tall.position.distanceTo(tall.target)).toBeCloseTo(
            900 / 4 / 2 / tan,
            6
        );
    });

    it('never goes more than 85° from straight down', () =>
        expect(ORBIT_MAX_POLAR).toBeCloseTo(1.4835, 4));
});

describe('orbitNearFar', () => {
    const content = new Box3(
        new Vector3(-500, -500, -20),
        new Vector3(500, 500, 30)
    );

    it('keeps near at a thousandth of the distance to the target', () => {
        const target = new Vector3(0, 0, 0);
        expect(
            orbitNearFar(new Vector3(0, 0, 1000), target, content).near
        ).toBeCloseTo(1, 9);
        expect(
            orbitNearFar(new Vector3(0, 0, 5), target, content).near
        ).toBeCloseTo(0.1, 9);
    });

    it('reaches past the farthest corner of what is drawn', () => {
        const camera = new Vector3(0, -1000, 1000);
        const { near, far } = orbitNearFar(camera, new Vector3(), content);
        const farthest = camera.distanceTo(new Vector3(500, 500, -20));
        expect(far).toBeGreaterThan(farthest);
        expect(far).toBeLessThan(farthest * 1.1 + 1);
        expect(far / near).toBeLessThan(1e4);
    });

    it('still reaches the layout after panning far away from it', () => {
        const target = new Vector3(20000, 0, 0);
        const camera = new Vector3(20000, -10, 10);
        const { far } = orbitNearFar(camera, target, content);
        expect(far).toBeGreaterThan(
            camera.distanceTo(new Vector3(-500, 500, -20))
        );
    });

    it('stays deeper than near with nothing to draw', () => {
        const { near, far } = orbitNearFar(
            new Vector3(),
            new Vector3(),
            new Box3()
        );
        expect(near).toBe(0.1);
        expect(far).toBeGreaterThan(near);
    });
});

describe('the ground', () => {
    it('spans the layout plus 200 m on each side', () => {
        const bounds = new Box3(
            new Vector3(0, -50, -5),
            new Vector3(100, 0, 8)
        );
        const rect = groundRect(bounds, new Vector3(1e4, 1e4, 0));
        expect(GROUND_MARGIN).toBe(200);
        expect(rect.min.toArray()).toEqual([-200, -250]);
        expect(rect.max.toArray()).toEqual([300, 200]);
    });

    it('is a 400 m square around the target when there is no track', () => {
        const rect = groundRect(new Box3(), new Vector3(30, -40, 7));
        expect(rect.min.toArray()).toEqual([-170, -240]);
        expect(rect.max.toArray()).toEqual([230, 160]);
    });

    it('is see-through, writes no depth and takes no polygon offset', () => {
        const ground = createGround();
        const material = ground.material;
        expect(material.transparent).toBe(true);
        expect(material.uniforms.uOpacity!.value).toBe(0.35);
        expect(GROUND_OPACITY).toBe(0.35);
        expect(material.uniforms.uSpacing!.value).toBe(100);
        expect(material.depthWrite).toBe(false);
        expect(material.polygonOffset).toBe(false);
        // Drawn after the sleeper decals, so track under the ground is tinted whole.
        expect(ground.renderOrder).toBeGreaterThan(0);
        expect(ground.visible).toBe(false);
        ground.geometry.dispose();
        material.dispose();
    });

    it('fits the plane to the rect at 0 m', () => {
        const ground = createGround();
        fitGround(
            ground,
            groundRect(
                new Box3(new Vector3(0, -50, 3), new Vector3(100, 0, 3)),
                new Vector3()
            )
        );
        ground.updateMatrixWorld();
        const box = new Box3().setFromObject(ground);
        expect(box.min.toArray()).toEqual([-200, -250, 0]);
        expect(box.max.toArray()).toEqual([300, 200, 0]);
        ground.geometry.dispose();
        ground.material.dispose();
    });
});

describe('the light', () => {
    it('comes from the 2D sun, 45° above the horizon', () => {
        const h = Math.SQRT1_2;
        // 2D shadows fall along world (cos A, sin A), y down; the sun is opposite,
        // which in the scene (x, −y) is (−cos A, sin A).
        const cases: Array<[number, [number, number, number]]> = [
            [135, [0.5, 0.5, h]], // the default: up-right on screen
            [0, [-h, 0, h]],
            [90, [0, h, h]],
        ];
        for (const [deg, expected] of cases) {
            const d = sunDirection(deg);
            expect(d.length()).toBeCloseTo(1, 12);
            d.toArray().forEach((v, i) =>
                expect(v).toBeCloseTo(expected[i]!, 12)
            );
        }
    });

    it('lights a flat top seen straight down at its base colour', () => {
        // Lambert: colour × (ambient + sun × cos θ) / π, θ from the face normal (0, 0, 1).
        for (const deg of [0, 135, 250]) {
            const cosTheta = sunDirection(deg).dot(new Vector3(0, 0, 1));
            expect(
                (AMBIENT_INTENSITY + SUN_INTENSITY * cosTheta) / Math.PI
            ).toBeCloseTo(1, 9);
        }
        // Sloped faces turned away from the sun still get light.
        expect(AMBIENT_INTENSITY).toBeGreaterThan(0);
        expect(SUN_INTENSITY).toBeGreaterThan(0);
    });
});

describe('detail', () => {
    it('shows rails and catenary from the zoom where 2D does', () => {
        const source = readFileSync(
            join(import.meta.dir, '..', 'src/pixi/track-render-system.ts'),
            'utf8'
        );
        const match = source.match(
            /const ZOOM_THRESHOLD_DETAILED_TRACK = ([\d.]+);/
        );
        expect(match).not.toBeNull();
        expect(Number(match![1])).toBe(DETAILED_TRACK_ZOOM);
    });
});

describe('TrackView3D without WebGL', () => {
    const restores: Array<() => void> = [];
    afterEach(() => {
        for (const restore of restores.splice(0)) restore();
    });

    it('is not supported outside a browser', () => {
        expect(TrackView3D.isSupported()).toBe(false);
    });

    it('throws WebGLUnavailableError when no context can be created', () => {
        const quiet = spyOn(console, 'error').mockImplementation(() => {});
        restores.push(() => quiet.mockRestore());
        const listeners = new Set<string>();
        const canvas = {
            width: 300,
            height: 150,
            getContext: () => null,
            addEventListener: (type: string) => listeners.add(type),
            removeEventListener: (type: string) => listeners.delete(type),
        } as unknown as HTMLCanvasElement;
        const scene = new TrackScene(new TrackGraph());
        const before = scene.scene.children.length;

        let thrown: unknown;
        try {
            new TrackView3D(canvas, scene, { autoRender: false });
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toBeInstanceOf(WebGLUnavailableError);
        expect(thrown).toBeInstanceOf(Error);
        expect((thrown as Error).name).toBe('WebGLUnavailableError');
        // Nothing is left behind on the canvas or in the scene.
        expect(listeners.size).toBe(0);
        expect(scene.scene.children.length).toBe(before);
        scene.dispose();
    });
});
