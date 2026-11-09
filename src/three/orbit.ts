import {
    Box2,
    type Box3,
    Color,
    Mesh,
    PlaneGeometry,
    ShaderMaterial,
    Vector2,
    Vector3,
} from 'three';

import type { BoardView } from './camera.js';

/** The orbit camera's vertical field of view, in degrees. */
export const ORBIT_FOV_DEG = 45;

/** How far from straight down the orbit camera enters: 45°. */
const ENTRY_TILT = Math.PI / 4;

/** The furthest the orbit camera may turn from straight down: 85°. */
export const ORBIT_MAX_POLAR = (85 * Math.PI) / 180;

/** The scene's up: heights are z. */
const UP = new Vector3(0, 0, 1);

/**
 * Where the orbit camera enters from the straight-down view `view`.
 *
 * - The target is the view centre at height 0.
 * - The camera is tilted 45° from straight down toward screen-down, which is
 *   the opposite of the top-down camera's up `(sin r, cos r)`. So the board's
 *   heading stays up the screen.
 * - Its distance makes the view's larger dimension, in metres, fill the 45°
 *   field of view.
 */
export function orbitPoseFrom(view: BoardView): {
    position: Vector3;
    target: Vector3;
    up: Vector3;
} {
    const target = new Vector3(view.position.x, -view.position.y, 0);
    const extent =
        Math.max(view.viewPortWidth, view.viewPortHeight) / view.zoomLevel;
    const distance = extent / 2 / Math.tan((ORBIT_FOV_DEG * Math.PI) / 360);
    const across = Math.sin(ENTRY_TILT) * distance;
    const offset = new Vector3(
        -Math.sin(view.rotation) * across,
        -Math.cos(view.rotation) * across,
        Math.cos(ENTRY_TILT) * distance
    );
    return {
        position: target.clone().add(offset),
        target,
        up: UP.clone(),
    };
}

/** The nearest the orbit camera's near plane comes, in metres. */
const MIN_NEAR = 0.1;

/**
 * The orbit camera's near and far planes, kept tight for depth precision so
 * the track's polygon offsets hold at any distance.
 *
 * - `near` is a thousandth of the camera's distance to the target, and at
 *   least 0.1 m.
 * - `far` reaches just past the corner of `content` farthest from the
 *   camera. So nothing drawn is ever cut off, however far the target has
 *   been panned.
 */
export function orbitNearFar(
    camera: Vector3,
    target: Vector3,
    content: Box3
): { near: number; far: number } {
    const distance = camera.distanceTo(target);
    let farthest = distance;
    if (!content.isEmpty()) {
        const corner = new Vector3();
        for (const x of [content.min.x, content.max.x]) {
            for (const y of [content.min.y, content.max.y]) {
                for (const z of [content.min.z, content.max.z]) {
                    corner.set(x, y, z);
                    farthest = Math.max(farthest, camera.distanceTo(corner));
                }
            }
        }
    }
    return {
        near: Math.max(MIN_NEAR, distance / 1000),
        far: farthest * 1.05 + 1,
    };
}

// ---------------------------------------------------------------------------
// The ground, shown only while orbiting

/** How far the ground reaches beyond the layout on each side, in metres. */
export const GROUND_MARGIN = 200;
/** The ground plane's opacity: underground track shows through it, tinted. */
export const GROUND_OPACITY = 0.35;
/** The grid's spacing, in metres. */
export const GRID_SPACING = 100;

const GROUND_COLOR = 0x8c9a7e;
const GRID_COLOR = 0x3c4434;
/** How far a grid line goes from the ground colour to the line colour. */
const GRID_STRENGTH = 0.6;

/**
 * The ground's extent on the plane z = 0: the layout's `bounds` plus
 * `GROUND_MARGIN` on each side or, with no track, a square that far around
 * `target`.
 */
export function groundRect(bounds: Box3, target: Vector3): Box2 {
    const margin = new Vector2(GROUND_MARGIN, GROUND_MARGIN);
    if (bounds.isEmpty()) {
        const centre = new Vector2(target.x, target.y);
        return new Box2(centre.clone().sub(margin), centre.clone().add(margin));
    }
    return new Box2(
        new Vector2(bounds.min.x, bounds.min.y).sub(margin),
        new Vector2(bounds.max.x, bounds.max.y).add(margin)
    );
}

const GROUND_VERTEX = /* glsl */ `
varying vec2 vGround;

void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vGround = world.xy;
    gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/**
 * The ground colour with grid lines every `uSpacing` metres, about 2 px wide
 * and anti-aliased with `fwidth`. The lines fade out where the cells are only
 * a few pixels across, so the grid doesn't turn to moiré toward the horizon.
 */
const GROUND_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uGridColor;
uniform float uGridStrength;
uniform float uSpacing;
uniform float uOpacity;
varying vec2 vGround;

void main() {
    vec2 cell = vGround / uSpacing;
    vec2 cellsPerPixel = fwidth(cell);
    vec2 pixelsToLine = abs(fract(cell - 0.5) - 0.5) / max(cellsPerPixel, 1e-6);
    float line = 1.0 - min(min(pixelsToLine.x, pixelsToLine.y), 1.0);
    line *= 1.0 - smoothstep(0.05, 0.25, max(cellsPerPixel.x, cellsPerPixel.y));
    gl_FragColor = vec4(mix(uColor, uGridColor, line * uGridStrength), uOpacity);
    #include <colorspace_fragment>
}
`;

/**
 * The ground plane at 0 m, hidden until `fitGround` places it and the view
 * shows it. See-through, it writes no depth and takes no polygon offset, so
 * the track's offsets (−1…−5) win at 0 m. It draws after the transparent
 * sleeper decals, so track below 0 m is tinted whole. The grid is drawn in
 * its fragment shader rather than as lines: lines take no polygon offset and
 * would flicker against track at 0 m.
 */
export function createGround(): Mesh<PlaneGeometry, ShaderMaterial> {
    const material = new ShaderMaterial({
        uniforms: {
            uColor: { value: new Color(GROUND_COLOR) },
            uGridColor: { value: new Color(GRID_COLOR) },
            uGridStrength: { value: GRID_STRENGTH },
            uSpacing: { value: GRID_SPACING },
            uOpacity: { value: GROUND_OPACITY },
        },
        vertexShader: GROUND_VERTEX,
        fragmentShader: GROUND_FRAGMENT,
        transparent: true,
        depthWrite: false,
    });
    const ground = new Mesh(new PlaneGeometry(1, 1), material);
    ground.name = 'ground';
    ground.renderOrder = 1;
    ground.visible = false;
    return ground;
}

/** Stretch `ground`'s unit plane over `rect` at 0 m. */
export function fitGround(ground: Mesh, rect: Box2): void {
    const centre = rect.getCenter(new Vector2());
    const size = rect.getSize(new Vector2());
    ground.position.set(centre.x, centre.y, 0);
    ground.scale.set(size.x, size.y, 1);
}
