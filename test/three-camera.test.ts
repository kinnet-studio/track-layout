import { DefaultBoardCamera } from '@ue-too/board';
import { describe, expect, it } from 'bun:test';
import { OrthographicCamera } from 'three';

import { ballastHalfWidth } from '../src/pixi/geometry-utils.js';
import { ballastHalfWidthForGauge } from '../src/shared/track-dimensions.js';
import {
    TOP_DOWN_NEAR_FAR,
    applyTopDownCamera,
    worldToScene,
} from '../src/three/camera.js';

const WIDTH = 1280;
const HEIGHT = 720;

describe('top-down camera', () => {
    it.each([
        { zoomLevel: 1, rotation: 0, position: { x: 0, y: 0 } },
        { zoomLevel: 10, rotation: 0, position: { x: 120.5, y: -40 } },
        {
            zoomLevel: 0.1,
            rotation: Math.PI / 6,
            position: { x: -3000, y: 900 },
        },
    ])('lands a world point on the board camera pixel (%o)', view => {
        const board = new DefaultBoardCamera({
            viewPortWidth: WIDTH,
            viewPortHeight: HEIGHT,
            ...view,
            zoomLevelBoundaries: { min: 0.01, max: 100 },
        });
        const ortho = new OrthographicCamera();
        applyTopDownCamera(ortho, {
            ...view,
            viewPortWidth: WIDTH,
            viewPortHeight: HEIGHT,
        });
        for (const p of [
            { x: 0, y: 0 },
            { x: 37.25, y: -12.5 },
            { x: view.position.x + 50, y: view.position.y + 20 },
        ]) {
            const ndc = worldToScene(p, 12.35).project(ortho);
            const vp = board.convertFromWorld2ViewPort(p);
            expect(((ndc.x + 1) / 2) * WIDTH).toBeCloseTo(vp.x + WIDTH / 2, 3);
            expect(((1 - ndc.y) / 2) * HEIGHT).toBeCloseTo(
                vp.y + HEIGHT / 2,
                3
            );
        }
    });

    it('keeps heights from -210 to 210 m inside near and far', () => {
        const ortho = new OrthographicCamera();
        applyTopDownCamera(ortho, {
            position: { x: 5, y: 7 },
            zoomLevel: 2,
            rotation: 0,
            viewPortWidth: WIDTH,
            viewPortHeight: HEIGHT,
        });
        expect(ortho.zoom).toBe(1);
        expect(ortho.near).toBe(TOP_DOWN_NEAR_FAR.near);
        expect(ortho.far).toBe(TOP_DOWN_NEAR_FAR.far);
        for (const z of [-210, 210]) {
            const ndc = worldToScene({ x: 5, y: 7 }, z).project(ortho);
            expect(Math.abs(ndc.z)).toBeLessThanOrEqual(1);
        }
    });

    it('maps (x, y) to (x, -y, height)', () => {
        const v = worldToScene({ x: 3, y: 4 }, 5);
        expect([v.x, v.y, v.z]).toEqual([3, -4, 5]);
    });
});

describe('ballastHalfWidthForGauge', () => {
    it('matches the 2D ballast half-width', () => {
        for (const gauge of [0.5, 1.435, 3]) {
            expect(ballastHalfWidthForGauge(gauge)).toBe(
                ballastHalfWidth({ gauge } as never)
            );
        }
    });
});
