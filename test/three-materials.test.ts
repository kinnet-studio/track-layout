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
        const parts = [m.ballast, m.slab, m.bed, m.rails, m.catenary];
        for (const part of parts) {
            expect(part).toBeInstanceOf(MeshLambertMaterial);
        }
        expect(parts.map(p => p.color.getHex())).toEqual([
            0x706860, 0xc0bab0, 0x5a5248, 0x6b3a1f, 0x606060,
        ]);
    });

    it('offsets the bed, surfaces and rails so they never fight', () => {
        const m = new TrackMaterials();
        const offsets = (part: Material) => [
            part.polygonOffset,
            part.polygonOffsetFactor,
            part.polygonOffsetUnits,
        ];
        expect(offsets(m.bed)).toEqual([true, -1, -1]);
        expect(offsets(m.ballast)).toEqual([true, -2, -2]);
        expect(offsets(m.slab)).toEqual([true, -2, -2]);
        expect(offsets(m.rails)).toEqual([true, -4, -4]);
        for (const part of [m.ballast, m.slab, m.bed, m.rails]) {
            expect(part.depthTest).toBe(true);
        }
    });

    it('shows and hides the rails and catenary', () => {
        const m = new TrackMaterials();
        m.setDetailVisible(false);
        expect([m.rails.visible, m.catenary.visible]).toEqual([false, false]);
        expect([m.ballast.visible, m.slab.visible, m.bed.visible]).toEqual([
            true,
            true,
            true,
        ]);
        m.setDetailVisible(true);
        expect([m.rails.visible, m.catenary.visible]).toEqual([true, true]);
    });

    it('disposes every material', () => {
        const m = new TrackMaterials();
        const disposed: Material[] = [];
        const parts = [m.ballast, m.slab, m.bed, m.rails, m.catenary];
        for (const part of parts) {
            part.addEventListener('dispose', () => disposed.push(part));
        }
        m.dispose();
        expect(disposed).toEqual(parts);
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

    it('widens the ballast, slab and bed between begin_vertex and project_vertex', () => {
        const m = new TrackMaterials();
        for (const part of [m.ballast, m.slab, m.bed]) {
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
        for (const part of [m.ballast, m.slab, m.bed]) {
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

    it('draws sleeper stripes in the ballast and slab shaders', () => {
        const m = new TrackMaterials();
        const ballast = compiled(m.ballast);
        const slab = compiled(m.slab);
        for (const shader of [ballast, slab]) {
            expect(shader.vertexShader).toContain('vAlong = aAlong;');
            expect(shader.vertexShader).toContain(
                'vAcross = aSide * aHalfWidth;'
            );
            expectBetween(
                shader.fragmentShader,
                'uSleeperColor, sleeper',
                'color_fragment',
                'lights_lambert_fragment'
            );
            expect(shader.fragmentShader).toContain('vMetresPerPixel');
        }
        expect(ballast.uniforms.uSleeperColor.value.getHex()).toBe(0xa8a8a0);
        expect(slab.uniforms.uSleeperColor.value.getHex()).toBe(0xa09a90);
        expect(slab.fragmentShader).not.toBe(ballast.fragmentShader);
    });

    it('leaves the bed without sleepers', () => {
        const { fragmentShader } = compiled(new TrackMaterials().bed);
        expect(fragmentShader).toBe(ShaderLib.lambert.fragmentShader);
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
        const keys = [m.ballast, m.slab, m.bed, m.rails].map(p =>
            p.customProgramCacheKey()
        );
        expect(new Set(keys).size).toBe(4);
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
