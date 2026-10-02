import { describe, expect, it } from 'bun:test';
import type { Graphics } from 'pixi.js';

import { TrackAlignedPlatformRenderSystem } from '../src/pixi/track-aligned-platform-render-system.js';
import type { TrackTextureRenderer } from '../src/pixi/track-render-system.js';
import { StationManager } from '../src/stations/station-manager.js';
import { TrackAlignedPlatformManager } from '../src/stations/track-aligned-platform-manager.js';
import { TrackGraph } from '../src/tracks/track.js';
import { RecordingLayerHost, textureRenderer } from './pixi-helpers.js';
import { layTrack } from './station-placement-helpers.js';

const PREVIEW = 'track-aligned-platform-preview';

/**
 * A renderer over one straight segment, 0 to 100 along x, and a platform
 * along its left side for station 1. The platform exists before the
 * renderer, so the tests draw it explicitly.
 */
function scene(texture: TrackTextureRenderer | null = textureRenderer) {
    const host = new RecordingLayerHost();
    const graph = new TrackGraph();
    layTrack(graph, [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
    ]);
    const platforms = new TrackAlignedPlatformManager();
    const id = platforms.createPlatform({
        stationId: 1,
        spine: [{ trackSegment: 0, tStart: 0, tEnd: 1, side: 1 }],
        offset: 2,
        outerVertices: [
            { x: 100, y: 8 },
            { x: 0, y: 8 },
        ],
        stopPositions: [],
    });
    const renderer = new TrackAlignedPlatformRenderSystem(
        host,
        platforms,
        new StationManager(),
        graph,
        texture
    );
    return { host, graph, platforms, renderer, id };
}

function previewGraphics(host: RecordingLayerHost): Graphics {
    return host.getDrawable(PREVIEW) as Graphics;
}

describe('TrackAlignedPlatformRenderSystem', () => {
    it('draws a platform in the drawable sublayer of the band for the elevation given, at order 450', () => {
        const { host, renderer, id } = scene();

        renderer.addPlatform(id, 1);

        const key = `track-aligned-platform-${id}`;
        expect(host.bandKeys).toEqual([key]);
        expect(host.sublayerOf(key)).toBe('drawable');
        expect(host.bandOf(key)).toBe(4);
        expect(host.bandItem(key)!.zIndex).toBe(450);
        expect(host.bandItem(key)!.children).toHaveLength(1);
    });

    it('draws nothing without a texture renderer', () => {
        const { host, renderer, id } = scene(null);

        renderer.addPlatform(id, 0);

        expect(host.bandKeys).toEqual([]);
    });

    it('ignores a second add and an unknown id', () => {
        const { host, renderer, id } = scene();
        renderer.addPlatform(id, 0);
        const first = host.bandItem(`track-aligned-platform-${id}`);

        renderer.addPlatform(id, 2);
        renderer.addPlatform(99, 0);

        expect(host.bandItem(`track-aligned-platform-${id}`)).toBe(first);
        expect(host.bandOf(`track-aligned-platform-${id}`)).toBe(3);
        expect(host.bandKeys).toHaveLength(1);
    });

    it('removes and destroys a platform', () => {
        const { host, renderer, id } = scene();
        renderer.addPlatform(id, 0);
        const container = host.bandItem(`track-aligned-platform-${id}`)!;

        renderer.removePlatform(id);

        expect(host.bandKeys).toEqual([]);
        expect(container.destroyed).toBe(true);
    });

    it('draws the track highlight on one unbanded graphics at z-index 9999, which every preview reuses', () => {
        const { host, renderer } = scene();

        renderer.showTrackHighlight(0, 0.5, 1, 2);
        const preview = previewGraphics(host);
        expect(host.drawableKeys).toEqual([PREVIEW]);
        expect(preview.zIndex).toBe(9999);
        expect(preview.context.instructions.length).toBeGreaterThan(0);

        renderer.showPlacementPreview(
            [
                { x: 0, y: 2 },
                { x: 100, y: 2 },
            ],
            [{ x: 100, y: 8 }],
            { x: 0, y: 2 },
            { x: 100, y: 2 }
        );
        renderer.showDualSpinePlacementPreview(
            [
                { x: 0, y: 2 },
                { x: 100, y: 2 },
            ],
            [
                { x: 0, y: 12 },
                { x: 100, y: 12 },
            ],
            [{ x: 100, y: 7 }],
            [],
            { x: 0, y: 2 },
            { x: 100, y: 2 },
            { x: 0, y: 12 },
            null
        );
        renderer.showCapDrawingHover(
            { x: 100, y: 7 },
            { x: 50, y: 7 },
            { x: 0, y: 2 },
            false
        );

        expect(previewGraphics(host)).toBe(preview);
    });

    it('draws the single-spine placement preview', () => {
        const { host, renderer } = scene();

        renderer.showPlacementPreview(
            [
                { x: 0, y: 2 },
                { x: 100, y: 2 },
            ],
            [{ x: 100, y: 8 }],
            { x: 0, y: 2 },
            { x: 100, y: 2 }
        );

        expect(host.drawableKeys).toEqual([PREVIEW]);
        expect(
            previewGraphics(host).context.instructions.length
        ).toBeGreaterThan(0);
    });

    it('draws the dual-spine placement preview', () => {
        const { host, renderer } = scene();

        renderer.showDualSpinePlacementPreview(
            [
                { x: 0, y: 2 },
                { x: 100, y: 2 },
            ],
            [
                { x: 0, y: 12 },
                { x: 100, y: 12 },
            ],
            [{ x: 100, y: 7 }],
            [],
            { x: 0, y: 2 },
            { x: 100, y: 2 },
            { x: 0, y: 12 },
            null
        );

        expect(host.drawableKeys).toEqual([PREVIEW]);
        expect(
            previewGraphics(host).context.instructions.length
        ).toBeGreaterThan(0);
    });

    it('adds the cap-drawing hover to the preview already shown', () => {
        const { host, renderer } = scene();

        renderer.showDualSpinePlacementPreview(
            [
                { x: 0, y: 2 },
                { x: 100, y: 2 },
            ],
            [
                { x: 0, y: 12 },
                { x: 100, y: 12 },
            ],
            [{ x: 100, y: 7 }],
            [],
            { x: 0, y: 2 },
            { x: 100, y: 2 },
            { x: 0, y: 12 },
            null
        );
        const before = previewGraphics(host).context.instructions.length;

        renderer.showCapDrawingHover(
            { x: 100, y: 7 },
            { x: 50, y: 7 },
            { x: 0, y: 2 },
            false
        );

        expect(
            previewGraphics(host).context.instructions.length
        ).toBeGreaterThan(before);
    });

    it('draws no track highlight for a segment that does not exist', () => {
        const { host, renderer } = scene();

        renderer.showTrackHighlight(9, 0.5, 1, 2);

        expect(host.drawableKeys).toEqual([]);
    });

    it('removes its preview with hidePreview', () => {
        const { host, renderer } = scene();
        renderer.showTrackHighlight(0, 0.5, 1, 2);
        const preview = previewGraphics(host);

        renderer.hidePreview();

        expect(host.drawableKeys).toEqual([]);
        expect(preview.destroyed).toBe(true);
    });

    it('removes its platforms and preview on cleanup', () => {
        const { host, renderer, id } = scene();
        renderer.addPlatform(id, 0);
        renderer.showTrackHighlight(0, 0.5, 1, 2);

        renderer.cleanup();

        expect(host.bandKeys).toEqual([]);
        expect(host.drawableKeys).toEqual([]);
    });
});
