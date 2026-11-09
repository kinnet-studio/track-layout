import {
    type Camera,
    Color,
    type IUniform,
    MeshLambertMaterial,
    type OrthographicCamera,
    type PerspectiveCamera,
    type WebGLProgramParametersWithUniforms,
} from 'three';

import {
    TRACK_TEX_SIZE,
    ballastHalfWidthForGauge,
} from '../shared/track-dimensions.js';

/** The narrowest the ballast, slab and bed may look on screen, in pixels. */
export const MIN_TRACK_WIDTH_PX = 2;

/**
 * The half-width (m) to draw a part at so it is at least `minWidthPx` wide on
 * screen. The vertex shader runs the same formula: `widenedHalfWidth` in
 * `WIDTH_GLSL` below. Change the two together.
 */
export function widenedHalfWidth(
    trueHalfWidth: number,
    metresPerPixel: number,
    minWidthPx = MIN_TRACK_WIDTH_PX
): number {
    return Math.max(trueHalfWidth, (minWidthPx * metresPerPixel) / 2);
}

/**
 * Metres per screen pixel at a depth in view space. An orthographic `zoom` is
 * the board zoom in px per metre, so depth doesn't matter; a perspective
 * camera spreads `2 * depth * tan(fov / 2)` metres over the viewport height.
 * The vertex shader runs the same formula: `metresPerPixelAt` in `WIDTH_GLSL`
 * below. Change the two together.
 */
export function metresPerPixelAt(
    viewDepth: number,
    camera: {
        isOrthographic: boolean;
        zoom: number;
        fovDeg: number;
        viewportHeightPx: number;
    }
): number {
    if (camera.isOrthographic) return 1 / camera.zoom;
    const fovTan = Math.tan((camera.fovDeg * Math.PI) / 360);
    return (2 * viewDepth * fovTan) / camera.viewportHeightPx;
}

/**
 * `widenedHalfWidth` and `metresPerPixelAt` in GLSL, with the uniforms they
 * read. They are the same formulas as the two functions above.
 */
const WIDTH_GLSL = /* glsl */ `
uniform float uMetresPerPixel;
uniform float uPerspective;
uniform float uFovTan;
uniform float uViewportHeight;
uniform float uMinWidthPx;

float widenedHalfWidth(float trueHalfWidth, float metresPerPixel, float minWidthPx) {
    return max(trueHalfWidth, (minWidthPx * metresPerPixel) / 2.0);
}

float metresPerPixelAt(float viewDepth) {
    return uPerspective > 0.5
        ? (2.0 * viewDepth * uFovTan) / uViewportHeight
        : uMetresPerPixel;
}
`;

/** The uniforms every widened material shares. */
export type TrackUniforms = {
    /** Metres per pixel for an orthographic camera. */
    uMetresPerPixel: IUniform<number>;
    /** 1 for a perspective camera, which measures per vertex; else 0. */
    uPerspective: IUniform<number>;
    /** A perspective camera's `tan(fov / 2)`, after its zoom. */
    uFovTan: IUniform<number>;
    /** The viewport height in the pixels `uMinWidthPx` counts. */
    uViewportHeight: IUniform<number>;
    uMinWidthPx: IUniform<number>;
};

/**
 * Push each edge vertex (`aSide` ±1) out along `aAcross` until the part is at
 * least `uMinWidthPx` wide on screen, measuring metres per pixel at the
 * vertex's own depth in view space. Centreline vertices stay put.
 */
const WIDEN_VERTEX = {
    pars: /* glsl */ `
attribute vec2 aAcross;
attribute float aSide;
attribute float aHalfWidth;
${WIDTH_GLSL}`,
    main: /* glsl */ `
    float trackViewDepth = -(modelViewMatrix * vec4(transformed, 1.0)).z;
    float trackMetresPerPixel = metresPerPixelAt(trackViewDepth);
    transformed.xy += aAcross * aSide *
        (widenedHalfWidth(aHalfWidth, trackMetresPerPixel, uMinWidthPx) - aHalfWidth);`,
};

// ---------------------------------------------------------------------------
// Sleepers, drawn as stripes on the ballast or slab top, after the 2D textures
// in track-render-system.ts.

/** Sleeper pitch along the track (m): the 2D texture's `TRACK_TEXTURE_TILE_LEN`. */
const SLEEPER_PITCH = 0.6;
/** Ballasted: a concrete tie 12 texture px of the 64 px pitch long. */
const TIE_DUTY = 12 / TRACK_TEX_SIZE;
/** Slab: a tie block under each rail, 8 px of the pitch long and 14 px of the gauge wide. */
const BLOCK_DUTY = 8 / TRACK_TEX_SIZE;
const BLOCK_WIDTH_PER_GAUGE = 14 / TRACK_TEX_SIZE;
/**
 * `ballastHalfWidthForGauge(gauge)` is the tie half-width,
 * `gauge * TIE_HALF_WIDTH_PER_GAUGE`, plus a fixed shoulder. So the shader gets
 * the tie half-width and the gauge back from a surface's true half-width.
 */
const SHOULDER = ballastHalfWidthForGauge(0);
const TIE_HALF_WIDTH_PER_GAUGE = ballastHalfWidthForGauge(1) - SHOULDER;
/**
 * Sleepers show in full from 5 px per metre, where 2D shows rails and ties
 * (`ZOOM_THRESHOLD_DETAILED_TRACK`), and fade out by half that.
 */
const SLEEPER_FADE_START = 1 / 5;
const SLEEPER_FADE_END = 2 / 5;

/** A JS number as a GLSL float literal. */
const f = (n: number): string =>
    Number.isInteger(n) ? n.toFixed(1) : String(n);

/**
 * Pass the true (unwidened) position on the top to the fragment shader: metres
 * along the segment and across the centreline. Comes after `WIDEN_VERTEX`.
 */
const SLEEPER_VERTEX = {
    pars: /* glsl */ `
attribute float aAlong;
varying float vAlong;
varying float vAcross;
varying float vHalfWidth;
varying float vMetresPerPixel;`,
    main: /* glsl */ `
    vAlong = aAlong;
    vAcross = aSide * aHalfWidth;
    vHalfWidth = aHalfWidth;
    vMetresPerPixel = trackMetresPerPixel;`,
};

/**
 * The stripes are box-filtered over each pixel's footprint, so ties thinner
 * than a pixel blend into the ballast instead of shimmering.
 */
const SLEEPER_FRAGMENT_PARS = /* glsl */ `
uniform vec3 uSleeperColor;
varying float vAlong;
varying float vAcross;
varying float vHalfWidth;
varying float vMetresPerPixel;

// How much of [0, x] lies on stripes \`duty\` wide, centred in each unit.
float stripeIntegral(float x, float duty) {
    return floor(x) * duty + clamp(fract(x) - 0.5 + 0.5 * duty, 0.0, duty);
}

// How much of a footprint \`w\` wide, centred on x, lies on the stripes.
float stripeCoverage(float x, float w, float duty) {
    w = max(w, 1e-5);
    return (stripeIntegral(x + 0.5 * w, duty) - stripeIntegral(x - 0.5 * w, duty)) / w;
}

// How much of a footprint \`w\` wide lies inside an edge \`inside\` metres away.
float edgeCoverage(float inside, float w) {
    return clamp(inside / max(w, 1e-5) + 0.5, 0.0, 1.0);
}
`;

type SurfaceStyle = 'ballast' | 'slab';

/** Across the track: how much of the pixel is on a tie (ballasted) or a block (slab). */
const SLEEPER_ACROSS: Record<SurfaceStyle, string> = {
    ballast: /* glsl */ `
        float tieHalfWidth = vHalfWidth - ${f(SHOULDER)};
        float across = edgeCoverage(tieHalfWidth - abs(vAcross), fwidth(vAcross));`,
    slab: /* glsl */ `
        float gauge = (vHalfWidth - ${f(SHOULDER)}) / ${f(TIE_HALF_WIDTH_PER_GAUGE)};
        float blockHalfWidth = ${f(BLOCK_WIDTH_PER_GAUGE / 2)} * gauge;
        float across = edgeCoverage(
            blockHalfWidth - abs(abs(vAcross) - 0.5 * gauge),
            fwidth(vAcross)
        );`,
};

function sleeperFragmentMain(style: SurfaceStyle): string {
    const duty = style === 'ballast' ? TIE_DUTY : BLOCK_DUTY;
    return /* glsl */ `
    {
        float pitches = vAlong / ${f(SLEEPER_PITCH)};
        float along = stripeCoverage(pitches, fwidth(pitches), ${f(duty)});
        ${SLEEPER_ACROSS[style]}
        float shown = 1.0 - smoothstep(
            ${f(SLEEPER_FADE_START)}, ${f(SLEEPER_FADE_END)}, vMetresPerPixel
        );
        float sleeper = along * across * shown;
        diffuseColor.rgb = mix(diffuseColor.rgb, uSleeperColor, sleeper);
    }`;
}

// ---------------------------------------------------------------------------
// Rails

/** Colour each rail's top face (`aRunning` 1) as the running strip. */
const RUNNING_STRIP = {
    vertexPars: /* glsl */ `
attribute float aRunning;
varying float vRunning;`,
    vertexMain: /* glsl */ `
    vRunning = aRunning;`,
    fragmentPars: /* glsl */ `
uniform vec3 uRunningColor;
varying float vRunning;`,
    fragmentMain: /* glsl */ `
    diffuseColor.rgb = mix(diffuseColor.rgb, uRunningColor, step(0.5, vRunning));`,
};

// ---------------------------------------------------------------------------
// Shader patches

type Shader = WebGLProgramParametersWithUniforms;

/** Code added to three's Lambert shader, each part after a stable chunk. */
type Extension = {
    uniforms: Record<string, IUniform>;
    /** After `#include <common>` in the vertex shader. */
    vertexPars: string;
    /** After `#include <begin_vertex>`, which declares `transformed`. */
    vertexMain: string;
    /** After `#include <common>` in the fragment shader. */
    fragmentPars?: string;
    /** After `#include <color_fragment>`, before lighting reads `diffuseColor`. */
    fragmentMain?: string;
};

/** Put `code` after three's `#include <chunk>`; throw if three has none. */
function after(source: string, chunk: string, code: string): string {
    const include = `#include <${chunk}>`;
    if (!source.includes(include)) {
        throw new Error(
            `track-layout/three: three's shader has no ${include} to extend`
        );
    }
    return source.replace(include, () => `${include}\n${code}`);
}

function extend(shader: Shader, extension: Extension): void {
    Object.assign(shader.uniforms, extension.uniforms);
    shader.vertexShader = after(
        after(shader.vertexShader, 'common', extension.vertexPars),
        'begin_vertex',
        extension.vertexMain
    );
    if (extension.fragmentPars !== undefined) {
        shader.fragmentShader = after(
            shader.fragmentShader,
            'common',
            extension.fragmentPars
        );
    }
    if (extension.fragmentMain !== undefined) {
        shader.fragmentShader = after(
            shader.fragmentShader,
            'color_fragment',
            extension.fragmentMain
        );
    }
}

function widened(uniforms: TrackUniforms): Extension {
    return {
        uniforms,
        vertexPars: WIDEN_VERTEX.pars,
        vertexMain: WIDEN_VERTEX.main,
    };
}

function widenedWithSleepers(
    uniforms: TrackUniforms,
    style: SurfaceStyle,
    sleeperColor: number
): Extension {
    return {
        uniforms: {
            ...uniforms,
            uSleeperColor: { value: new Color(sleeperColor) },
        },
        vertexPars: WIDEN_VERTEX.pars + SLEEPER_VERTEX.pars,
        vertexMain: WIDEN_VERTEX.main + SLEEPER_VERTEX.main,
        fragmentPars: SLEEPER_FRAGMENT_PARS,
        fragmentMain: sleeperFragmentMain(style),
    };
}

function runningStrip(runningColor: number): Extension {
    return {
        uniforms: { uRunningColor: { value: new Color(runningColor) } },
        ...RUNNING_STRIP,
    };
}

/**
 * A Lambert material, with `extension` added to its shader. three caches
 * compiled programs by `customProgramCacheKey()`, so each extended material
 * gets its own key.
 */
function lambert(
    key: string,
    color: number,
    polygonOffset: number | null,
    extension?: Extension
): MeshLambertMaterial {
    const material = new MeshLambertMaterial({ color });
    if (polygonOffset !== null) {
        material.polygonOffset = true;
        material.polygonOffsetFactor = polygonOffset;
        material.polygonOffsetUnits = polygonOffset;
    }
    if (extension !== undefined) {
        material.onBeforeCompile = shader => extend(shader, extension);
        material.customProgramCacheKey = () => `track-layout:${key}`;
    }
    return material;
}

const isPerspective = (camera: Camera): camera is PerspectiveCamera =>
    (camera as PerspectiveCamera).isPerspectiveCamera === true;
const isOrthographic = (camera: Camera): camera is OrthographicCamera =>
    (camera as OrthographicCamera).isOrthographicCamera === true;

/**
 * One material per part of the laid track, shared by every segment. The
 * ballast, slab and bed stay at least `MIN_TRACK_WIDTH_PX` wide on screen;
 * call `update` with the camera before each render.
 *
 * Same-height surfaces of a style share one material and so one colour,
 * which keeps overlaps at a junction or diamond from flickering. The polygon
 * offsets keep the bed under the surfaces and the rails over them.
 */
export class TrackMaterials {
    readonly uniforms: TrackUniforms = {
        uMetresPerPixel: { value: 0 },
        uPerspective: { value: 0 },
        uFovTan: { value: 0 },
        uViewportHeight: { value: 1 },
        uMinWidthPx: { value: MIN_TRACK_WIDTH_PX },
    };
    /** The ballasted surface, with concrete ties. */
    readonly ballast = lambert(
        'ballast',
        0x706860,
        -2,
        widenedWithSleepers(this.uniforms, 'ballast', 0xa8a8a0)
    );
    /** The slab surface, with a tie block under each rail. */
    readonly slab = lambert(
        'slab',
        0xc0bab0,
        -2,
        widenedWithSleepers(this.uniforms, 'slab', 0xa09a90)
    );
    readonly bed = lambert('bed', 0x5a5248, -1, widened(this.uniforms));
    /** Rust rails with a silver running strip on top. */
    readonly rails = lambert('rails', 0x6b3a1f, -4, runningStrip(0xd0d0d0));
    /** The masts and the contact wire. */
    readonly catenary = lambert('catenary', 0x606060, null);

    /**
     * Feed the camera into the shared uniforms. `viewportHeightPx` is the
     * viewport height in the pixels the minimum width counts: CSS pixels, as
     * the board's `viewPortHeight` is.
     */
    update(camera: Camera, viewportHeightPx: number): void {
        if (!(viewportHeightPx > 0)) return;
        const u = this.uniforms;
        u.uViewportHeight.value = viewportHeightPx;
        if (isPerspective(camera)) {
            u.uPerspective.value = 1;
            u.uFovTan.value =
                Math.tan((camera.fov * Math.PI) / 360) / camera.zoom;
        } else if (isOrthographic(camera)) {
            u.uPerspective.value = 0;
            u.uMetresPerPixel.value =
                (camera.top - camera.bottom) / camera.zoom / viewportHeightPx;
        }
    }

    /** Show or hide the rails and catenary. */
    setDetailVisible(visible: boolean): void {
        this.rails.visible = visible;
        this.catenary.visible = visible;
    }

    dispose(): void {
        for (const material of [
            this.ballast,
            this.slab,
            this.bed,
            this.rails,
            this.catenary,
        ]) {
            material.dispose();
        }
    }
}
