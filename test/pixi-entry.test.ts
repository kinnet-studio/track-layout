import { describe, expect, it } from 'bun:test';
import { readdirSync } from 'node:fs';
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
import { importsOf } from './import-scan.js';

const RUNTIME_EXPORTS = [
    'WorldRenderSystem',
    'DETAILED_BAND_HEIGHTS',
    'findElevationInterval',
    'TrackRenderSystem',
    'StationRenderSystem',
    'TrackAlignedPlatformRenderSystem',
    'JointDirectionRenderSystem',
];

const SRC = join(import.meta.dir, '..', 'src');

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
