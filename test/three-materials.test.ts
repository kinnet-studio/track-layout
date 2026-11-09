import { describe, expect, it } from 'bun:test';
import {
    type Material,
    MeshLambertMaterial,
    OrthographicCamera,
    PerspectiveCamera,
    ShaderLib,
    UniformsUtils,
    type WebGLProgramParametersWithUniforms,
    type WebGLRenderer,
} from 'three';

import { applyTopDownCamera } from '../src/three/camera.js';
import {
    MIN_TRACK_WIDTH_PX,
    TrackMaterials,
    metresPerPixelAt,
    widenedHalfWidth,
} from '../src/three/materials.js';

const WIDTH = 1280;
const HEIGHT = 720;

/** The straight-down camera at a board zoom (px per metre). */
function orthoAtZoom(zoomLevel: number, viewPortHeight = HEIGHT) {
    const camera = new OrthographicCamera();
    applyTopDownCamera(camera, {
        position: { x: 0, y: 0 },
        zoomLevel,
        rotation: 0,
        viewPortWidth: WIDTH,
        viewPortHeight,
    });
    return camera;
}

type StubShader = {
    vertexShader: string;
    fragmentShader: string;
    uniforms: WebGLProgramParametersWithUniforms['uniforms'];
};

/** Call a material's onBeforeCompile on a stub of three's Lambert shader. */
function compiled(
    material: Material,
    source: { vertexShader: string; fragmentShader: string } = ShaderLib.lambert
): StubShader {
    const shader: StubShader = {
        vertexShader: source.vertexShader,
        fragmentShader: source.fragmentShader,
        uniforms: UniformsUtils.clone(ShaderLib.lambert.uniforms),
    };
    material.onBeforeCompile(
        shader as WebGLProgramParametersWithUniforms,
        {} as WebGLRenderer
    );
    return shader;
}

/** Every material, in property order. */
const allParts = (m: TrackMaterials) => [
    m.ballast,
    m.ballastSleepers,
    m.slab,
    m.slabSleepers,
    m.bed,
    m.rails,
    m.catenary,
];

/** The materials whose shaders keep the track at least 2 px wide. */
const widenedParts = (m: TrackMaterials) => [
    m.ballast,
    m.ballastSleepers,
    m.slab,
    m.slabSleepers,
    m.bed,
];

/** `code` comes after `#include <after>` and before `#include <before>`. */
function expectBetween(
    source: string,
    code: string,
    after: string,
    before: string
) {
    const at = source.indexOf(code);
    expect(at).toBeGreaterThan(source.indexOf(`#include <${after}>`));
    expect(at).toBeLessThan(source.indexOf(`#include <${before}>`));
}

describe('widenedHalfWidth', () => {
    it('keeps the true width when it is already wide enough', () => {
        expect(widenedHalfWidth(1.2, 0.1)).toBe(1.2); // 10 px/m: 24 px wide
    });

    it('widens to 2 px when zoomed out', () => {
        expect(widenedHalfWidth(1.2, 10)).toBe(10); // 0.1 px/m: 2 px = 20 m wide
    });

    it('takes another minimum width in pixels', () => {
        expect(MIN_TRACK_WIDTH_PX).toBe(2);
        expect(widenedHalfWidth(1.2, 1, 4)).toBe(2);
    });
});

describe('metresPerPixelAt', () => {
    it('measures metres per pixel at a perspective depth', () => {
        expect(
            metresPerPixelAt(1000, {
                isOrthographic: false,
                zoom: 1,
                fovDeg: 45,
                viewportHeightPx: 720,
            })
        ).toBeCloseTo((2 * 1000 * Math.tan(Math.PI / 8)) / 720, 9);
    });

    it('is one over the board zoom for an orthographic view, at any depth', () => {
        const camera = {
            isOrthographic: true,
            zoom: 4,
            fovDeg: 45,
            viewportHeightPx: 720,
        };
        expect(metresPerPixelAt(10, camera)).toBe(0.25);
        expect(metresPerPixelAt(400, camera)).toBe(0.25);
    });
});

describe('TrackMaterials', () => {
    it('feeds the camera into the shared uniforms', () => {
        const m = new TrackMaterials();
        m.update(orthoAtZoom(0.5), 720);
        expect(m.uniforms.uMetresPerPixel.value).toBe(2);
        expect(m.uniforms.uPerspective.value).toBe(0);
    });

    it('reads 1 / zoom from the straight-down camera at any viewport height', () => {
        const m = new TrackMaterials();
        m.update(orthoAtZoom(10, 1080), 1080);
        expect(m.uniforms.uMetresPerPixel.value).toBeCloseTo(0.1, 12);
    });

    it('hands a perspective camera to the shader to measure per vertex', () => {
        const m = new TrackMaterials();
        const camera = new PerspectiveCamera(45, WIDTH / HEIGHT, 1, 5000);
        m.update(camera, HEIGHT);
        expect(m.uniforms.uPerspective.value).toBe(1);
        expect(m.uniforms.uFovTan.value).toBeCloseTo(Math.tan(Math.PI / 8), 12);
        expect(m.uniforms.uViewportHeight.value).toBe(HEIGHT);

        camera.zoom = 2;
        m.update(camera, HEIGHT);
        expect(m.uniforms.uFovTan.value).toBeCloseTo(
            Math.tan(Math.PI / 8) / 2,
            12
        );

        m.update(orthoAtZoom(4), HEIGHT);
        expect(m.uniforms.uPerspective.value).toBe(0);
        expect(m.uniforms.uMetresPerPixel.value).toBe(0.25);
    });

    it('ignores a viewport with no height', () => {
        const m = new TrackMaterials();
        m.update(orthoAtZoom(0.5), 720);
        m.update(orthoAtZoom(0.5), 0);
        expect(m.uniforms.uMetresPerPixel.value).toBe(2);
        expect(m.uniforms.uViewportHeight.value).toBe(720);
    });

    it('starts with a 2 px minimum and no widening', () => {
        const m = new TrackMaterials();
        expect(m.uniforms.uMinWidthPx.value).toBe(MIN_TRACK_WIDTH_PX);
        expect(m.uniforms.uMetresPerPixel.value).toBe(0);
    });

    it('colours each part as 2D Detailed does', () => {
        const m = new TrackMaterials();
        const parts = allParts(m);
        for (const part of parts) {
            expect(part).toBeInstanceOf(MeshLambertMaterial);
        }
        expect(parts.map(p => p.color.getHex())).toEqual([
            0x706860, 0xa8a8a0, 0xc0bab0, 0xa09a90, 0x5a5248, 0x6b3a1f,
            0x606060,
        ]);
    });

    it('offsets the parts by units, with the slope factor only in perspective', () => {
        const m = new TrackMaterials();
        const units = {
            bed: -1,
            ballast: -2,
            slab: -3,
            ballastSleepers: -4,
            slabSleepers: -4,
            rails: -5,
        };
        const offsets = () =>
            Object.fromEntries(
                Object.keys(units).map(name => {
                    const part = m[name as keyof typeof units];
                    return [
                        name,
                        [
                            part.polygonOffset,
                            part.polygonOffsetFactor,
                            part.polygonOffsetUnits,
                        ],
                    ];
                })
            );
        const expected = (withFactor: boolean) =>
            Object.fromEntries(
                Object.entries(units).map(([name, u]) => [
                    name,
                    [true, withFactor ? u : 0, u],
                ])
            );
        const perspective = new PerspectiveCamera(45, WIDTH / HEIGHT);

        m.update(orthoAtZoom(10), 720);
        expect(offsets()).toEqual(expected(false));
        m.update(perspective, 720);
        expect(offsets()).toEqual(expected(true));
        m.update(orthoAtZoom(20), 720);
        expect(offsets()).toEqual(expected(false));

        expect(m.catenary.polygonOffset).toBe(false);
        for (const part of allParts(m)) {
            expect(part.depthTest).toBe(true);
        }
    });

    it('sets the offset factor only when the camera type changes', () => {
        const m = new TrackMaterials();
        m.update(orthoAtZoom(10), 720);
        m.rails.polygonOffsetFactor = 7; // a marker the next update must keep
        m.update(orthoAtZoom(40), 720);
        expect(m.rails.polygonOffsetFactor).toBe(7);
        m.update(new PerspectiveCamera(45, WIDTH / HEIGHT), 720);
        expect(m.rails.polygonOffsetFactor).toBe(-5);
    });

    it('blends the sleeper decals over their surface without writing depth', () => {
        const m = new TrackMaterials();
        for (const decal of [m.ballastSleepers, m.slabSleepers]) {
            expect([decal.transparent, decal.depthWrite]).toEqual([
                true,
                false,
            ]);
        }
        for (const part of [m.ballast, m.slab, m.bed, m.rails, m.catenary]) {
            expect([part.transparent, part.depthWrite]).toEqual([false, true]);
        }
    });

    it('skips the sleeper decals once a straight-down view has faded them', () => {
        const m = new TrackMaterials();
        const decalsVisible = () => [
            m.ballastSleepers.visible,
            m.slabSleepers.visible,
        ];
        m.update(orthoAtZoom(5), HEIGHT);
        expect(decalsVisible()).toEqual([true, true]);
        m.update(orthoAtZoom(2.6), HEIGHT); // 0.385 m/px: still fading
        expect(decalsVisible()).toEqual([true, true]);
        m.update(orthoAtZoom(2.5), HEIGHT); // 0.4 m/px: faded out
        expect(decalsVisible()).toEqual([false, false]);
        // A perspective camera fades them per vertex, so it keeps them.
        m.update(new PerspectiveCamera(45, WIDTH / HEIGHT), HEIGHT);
        expect(decalsVisible()).toEqual([true, true]);
    });

    it('shows and hides the rails and catenary', () => {
        const m = new TrackMaterials();
        m.setDetailVisible(false);
        expect([m.rails.visible, m.catenary.visible]).toEqual([false, false]);
        expect(
            [m.ballast, m.ballastSleepers, m.slab, m.slabSleepers, m.bed].map(
                p => p.visible
            )
        ).toEqual([true, true, true, true, true]);
        m.setDetailVisible(true);
        expect([m.rails.visible, m.catenary.visible]).toEqual([true, true]);
    });

    it('disposes every material', () => {
        const m = new TrackMaterials();
        const disposed: Material[] = [];
        const parts = allParts(m);
        for (const part of parts) {
            part.addEventListener('dispose', () => disposed.push(part));
        }
        m.dispose();
        expect(disposed).toHaveLength(7);
        expect(new Set(disposed)).toEqual(new Set(parts));
    });
});

describe('TrackMaterials shaders', () => {
    it('puts the widening in the surface shader', () => {
        const m = new TrackMaterials();
        for (const surface of [m.ballast, m.slab]) {
            const shader = compiled(surface);
            expect(shader.vertexShader).toContain('aAcross');
            expect(shader.vertexShader).toContain('uMinWidthPx');
        }
    });

    it('widens the surfaces, sleeper decals and bed between begin_vertex and project_vertex', () => {
        const m = new TrackMaterials();
        for (const part of widenedParts(m)) {
            const { vertexShader } = compiled(part);
            expect(vertexShader).toContain('attribute vec2 aAcross;');
            expect(vertexShader).toContain('attribute float aSide;');
            expect(vertexShader).toContain('attribute float aHalfWidth;');
            expectBetween(
                vertexShader,
                'transformed.xy += aAcross * aSide *',
                'begin_vertex',
                'project_vertex'
            );
        }
    });

    it('shares one set of uniforms between the widened shaders', () => {
        const m = new TrackMaterials();
        for (const part of widenedParts(m)) {
            const { uniforms } = compiled(part);
            for (const name of [
                'uMetresPerPixel',
                'uPerspective',
                'uFovTan',
                'uViewportHeight',
                'uMinWidthPx',
            ] as const) {
                expect(uniforms[name]).toBe(m.uniforms[name]);
            }
        }
    });

    it('draws the sleeper stripes as the decals’ alpha', () => {
        const m = new TrackMaterials();
        const ballast = compiled(m.ballastSleepers);
        const slab = compiled(m.slabSleepers);
        for (const shader of [ballast, slab]) {
            expect(shader.vertexShader).toContain('vAlong = aAlong;');
            expect(shader.vertexShader).toContain(
                'vAcross = aSide * aHalfWidth;'
            );
            expectBetween(
                shader.fragmentShader,
                'diffuseColor.a *= sleeper;',
                'color_fragment',
                'lights_lambert_fragment'
            );
            expect(shader.fragmentShader).toContain('stripeCoverage(');
            expect(shader.fragmentShader).toContain('vMetresPerPixel');
        }
        expect(slab.fragmentShader).not.toBe(ballast.fragmentShader);
    });

    it('widens each decal exactly as its surface', () => {
        const m = new TrackMaterials();
        // The code each adds after begin_vertex: the decal's starts with
        // all of its surface's, then only sets varyings.
        const added = (part: Material) => {
            const { vertexShader } = compiled(part);
            return vertexShader
                .slice(
                    vertexShader.indexOf('#include <begin_vertex>'),
                    vertexShader.indexOf('#include <morphtarget_vertex>')
                )
                .trimEnd();
        };
        for (const [surface, decal] of [
            [m.ballast, m.ballastSleepers],
            [m.slab, m.slabSleepers],
        ]) {
            expect(added(surface)).toContain('transformed.xy +=');
            expect(added(decal).startsWith(added(surface))).toBe(true);
            expect(added(decal).slice(added(surface).length)).not.toContain(
                'transformed'
            );
        }
    });

    it('leaves the ballast, slab and bed without sleeper code', () => {
        const m = new TrackMaterials();
        for (const part of [m.ballast, m.slab, m.bed]) {
            const { vertexShader, fragmentShader } = compiled(part);
            expect(vertexShader).not.toContain('aAlong');
            expect(fragmentShader).toBe(ShaderLib.lambert.fragmentShader);
        }
    });

    it('draws the rails’ running strip silver', () => {
        const rails = compiled(new TrackMaterials().rails);
        expect(rails.vertexShader).toContain('vRunning = aRunning;');
        expectBetween(
            rails.fragmentShader,
            'uRunningColor, step(0.5, vRunning)',
            'color_fragment',
            'lights_lambert_fragment'
        );
        expect(rails.uniforms.uRunningColor.value.getHex()).toBe(0xd0d0d0);
    });

    it('gives each changed shader its own program cache key', () => {
        const m = new TrackMaterials();
        const keys = [
            m.ballast,
            m.ballastSleepers,
            m.slab,
            m.slabSleepers,
            m.bed,
            m.rails,
        ].map(p => p.customProgramCacheKey());
        expect(new Set(keys).size).toBe(6);
        expect(keys).toContain('track-layout:ballastSleepers');
        expect(keys).toContain('track-layout:slabSleepers');
        expect(keys).not.toContain(
            new MeshLambertMaterial().customProgramCacheKey()
        );
    });

    it('fails loudly when three’s shader lacks a chunk it extends', () => {
        const m = new TrackMaterials();
        const lambert = ShaderLib.lambert;
        expect(() =>
            compiled(m.bed, {
                vertexShader: lambert.vertexShader.replace(
                    '#include <begin_vertex>',
                    ''
                ),
                fragmentShader: lambert.fragmentShader,
            })
        ).toThrow(/begin_vertex/);
    });
});
