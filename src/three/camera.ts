import type { Point } from '@ue-too/math';
import { OrthographicCamera, Vector3 } from 'three';

import { HEIGHT_MAX, HEIGHT_MIN } from '../tracks/heights.js';

/** The board camera's state that the straight-down 3D camera must follow. */
export type BoardView = {
    position: Point;
    zoomLevel: number;
    rotation: number;
    viewPortWidth: number;
    viewPortHeight: number;
};

/** Clearance, in metres, kept beyond the lowest and highest heights. */
const MARGIN = 10;

/** Where the straight-down camera sits above the ground (the top of the range). */
const CAMERA_HEIGHT = HEIGHT_MAX + MARGIN;

/** Near and far planes covering `HEIGHT_MIN - 10` to `HEIGHT_MAX + 10` m. */
export const TOP_DOWN_NEAR_FAR: { near: number; far: number } = {
    near: 0,
    far: CAMERA_HEIGHT - (HEIGHT_MIN - MARGIN),
};

/** A world point at a height (metres) in scene space: `(x, -y, height)`, z up. */
export function worldToScene(point: Point, height: number): Vector3 {
    return new Vector3(point.x, -point.y, height);
}

/**
 * Point `camera` straight down at the board view so a world point lands on the
 * same viewport pixel as the board camera.
 *
 * The frustum is the viewport size divided by the zoom, centred on the camera's
 * position, and `camera.zoom` stays 1. The camera sits at the top of the
 * height range and looks down -z.
 *
 * Rotation sign: the board camera turns the world by `-rotation` on screen
 * (y down), so the screen's up direction in the scene is `(sin r, cos r, 0)`.
 * The rotated test case in test/three-camera.test.ts is the authority.
 */
export function applyTopDownCamera(
    camera: OrthographicCamera,
    view: BoardView
): void {
    const halfWidth = view.viewPortWidth / view.zoomLevel / 2;
    const halfHeight = view.viewPortHeight / view.zoomLevel / 2;
    camera.left = -halfWidth;
    camera.right = halfWidth;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.zoom = 1;
    camera.near = TOP_DOWN_NEAR_FAR.near;
    camera.far = TOP_DOWN_NEAR_FAR.far;
    camera.position.set(view.position.x, -view.position.y, CAMERA_HEIGHT);
    camera.up.set(Math.sin(view.rotation), Math.cos(view.rotation), 0);
    camera.lookAt(view.position.x, -view.position.y, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
}
