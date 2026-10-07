import { describe, expect, it } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import * as root from '../src/index.js';
import * as pixi from '../src/pixi/index.js';
// Type-only exports: the typecheck fails if any of these goes missing.
import type {
    BandSublayer,
    CatenaryLayoutPreviewSource,
    CurveCreationPreviewSource,
    DuplicateToSidePreviewSource,
    LayerHost,
    PlatformRenderStyle,
    TerrainSampler,
    TrackRenderStyle,
    TrackRenderSystemOptions,
    TrackTextureRenderer,
} from '../src/pixi/index.js';

const RUNTIME_EXPORTS = [
    'WorldRenderSystem',
    'findElevationInterval',
    'TrackRenderSystem',
    'StationRenderSystem',
    'TrackAlignedPlatformRenderSystem',
    'JointDirectionRenderSystem',
];

const SRC = join(import.meta.dir, '..', 'src');

/**
 * Every module a source file references, with whether the reference is
 * type-only: `import ... from` and `export ... from` statements (including
 * `export *`, multi-line clauses and either quote style), side-effect
 * `import 'x'` and dynamic `import('x')` with a string literal. Only
 * statements that start `import type` or `export type` count as type-only.
 */
function importsOf(file: string): { specifier: string; typeOnly: boolean }[] {
    const text = readFileSync(file, 'utf8');
    const statements = [
        ...text.matchAll(
            /^(?:import|export)\s+(type\s+)?[\w\s{},*$]*?\bfrom\s*(['"])([^'"\n]+)\2/gm
        ),
    ].map(match => ({
        specifier: match[3]!,
        typeOnly: match[1] !== undefined,
    }));
    const sideEffects = [
        ...text.matchAll(/^import\s*(['"])([^'"\n]+)\1/gm),
    ].map(match => ({ specifier: match[2]!, typeOnly: false }));
    const dynamic = [
        ...text.matchAll(/\bimport\s*\(\s*(['"`])([^'"`\n]+)\1\s*\)/g),
    ].map(match => ({ specifier: match[2]!, typeOnly: false }));
    return [...statements, ...sideEffects, ...dynamic];
}

/** The modules outside src/pixi that src/pixi may import, all type-only. */
const ALLOWED_OUTSIDE = [
    '../editing/preview-types.js',
    '../station-placement/preview.js',
];

describe('pixi entry point', () => {
    it('exposes the renderers and the layer host', () => {
        for (const name of RUNTIME_EXPORTS) {
            expect(pixi).toHaveProperty(name);
        }
    });

    it('keeps the geometry and colour helpers internal', () => {
        for (const name of [
            'ballastHalfWidth',
            'computeTunnelEntranceGeometry',
            'interpolateRgb',
            'getElevationColorRgb',
            'buildLineTrack',
            'resolveLineStyle',
            'classifyCrossing',
            'markSpan',
            'carrySpan',
            'sharedBridgePairs',
        ]) {
            expect(pixi).not.toHaveProperty(name);
        }
    });

    it('is not re-exported from the package root', () => {
        for (const name of RUNTIME_EXPORTS) {
            expect(root).not.toHaveProperty(name);
        }
    });

    it('imports the editing and station-placement entry points only for preview types', () => {
        const outside = readdirSync(join(SRC, 'pixi'))
            .flatMap(name => importsOf(join(SRC, 'pixi', name)))
            .filter(
                ({ specifier }) =>
                    specifier.startsWith('../editing/') ||
                    specifier.startsWith('../station-placement/')
            );

        expect(outside.length).toBeGreaterThan(0);
        for (const { specifier, typeOnly } of outside) {
            expect(ALLOWED_OUTSIDE).toContain(specifier);
            expect(typeOnly).toBe(true);
        }
    });

    it('reaches @ue-too/being through none of its imports', () => {
        const files = [
            ...readdirSync(join(SRC, 'pixi')).map(name =>
                join(SRC, 'pixi', name)
            ),
            join(SRC, 'editing', 'preview-types.ts'),
            join(SRC, 'station-placement', 'preview.ts'),
        ];
        for (const file of files) {
            expect(
                importsOf(file).map(({ specifier }) => specifier)
            ).not.toContain('@ue-too/being');
        }
    });
});
