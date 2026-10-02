import { describe, expect, it } from 'bun:test';
import type { Graphics } from 'pixi.js';

import { StationRenderSystem } from '../src/pixi/station-render-system.js';
import type { TrackTextureRenderer } from '../src/pixi/track-render-system.js';
import { createIslandStation } from '../src/stations/station-factory.js';
import { StationManager } from '../src/stations/station-manager.js';
import { TrackGraph } from '../src/tracks/track.js';
import { ELEVATION } from '../src/tracks/types.js';
import { RecordingLayerHost, textureRenderer } from './pixi-helpers.js';
import { bareStation } from './station-placement-helpers.js';

/**
 * A renderer over a graph that already holds an island station with two
 * platforms, centred on the origin. The station exists before the renderer,
 * so the tests draw it explicitly.
 */
function scene(
    elevation = ELEVATION.GROUND,
    texture: TrackTextureRenderer | null = textureRenderer
) {
    const host = new RecordingLayerHost();
    const graph = new TrackGraph();
    const stations = new StationManager();
    const id = createIslandStation(graph, stations, {
        position: { x: 0, y: 0 },
        direction: { x: 1, y: 0 },
        length: 100,
        elevation,
    });
    const renderer = new StationRenderSystem(host, stations, graph, texture);
    return { host, graph, stations, renderer, id };
}

describe('StationRenderSystem', () => {
    it("draws a station's platforms in the drawable sublayer of its band, at order 450", () => {
        const { host, renderer, id } = scene(ELEVATION.ABOVE_1);

        renderer.addStation(id);

        const key = `station-${id}`;
        expect(host.bandKeys).toEqual([key]);
        expect(host.sublayerOf(key)).toBe('drawable');
        expect(host.bandOf(key)).toBe(4);
        expect(host.bandItem(key)!.zIndex).toBe(450);
        expect(host.bandItem(key)!.children).toHaveLength(2);
    });

    it('draws a station with no platforms as an empty container', () => {
        const { host, stations, renderer } = scene();
        const id = stations.createStation(bareStation({ x: 0, y: 0 }));

        renderer.addStation(id);

        expect(host.bandItem(`station-${id}`)!.children).toHaveLength(0);
    });

    it('draws empty platforms without a texture renderer', () => {
        const { host, renderer, id } = scene(ELEVATION.GROUND, null);

        renderer.addStation(id);

        expect(host.bandItem(`station-${id}`)!.children).toHaveLength(0);
    });

    it('ignores a second add and an unknown id', () => {
        const { host, renderer, id } = scene();
        renderer.addStation(id);
        const first = host.bandItem(`station-${id}`);

        renderer.addStation(id);
        renderer.addStation(99);

        expect(host.bandItem(`station-${id}`)).toBe(first);
        expect(host.bandKeys).toEqual([`station-${id}`]);
    });

    it('removes and destroys a station', () => {
        const { host, renderer, id } = scene();
        renderer.addStation(id);
        const container = host.bandItem(`station-${id}`)!;

        renderer.removeStation(id);

        expect(host.bandKeys).toEqual([]);
        expect(container.destroyed).toBe(true);
    });

    it('shows the placement preview as one unbanded drawable, and hides it', () => {
        const { host, renderer } = scene();

        renderer.showPreview({ x: 0, y: 0 }, { x: 1, y: 0 }, 50, 10.4);
        renderer.showPreview({ x: 5, y: 0 }, { x: 1, y: 0 }, 60, 10.4);

        expect(host.drawableKeys).toEqual(['station-preview']);
        const preview = host.getDrawable('station-preview') as Graphics;
        expect(preview.zIndex).toBe(9999);
        expect(preview.context.instructions.length).toBeGreaterThan(0);

        renderer.hidePreview();
        expect(host.drawableKeys).toEqual([]);
        expect(preview.destroyed).toBe(true);
    });

    it('removes its stations on cleanup, but leaves its preview', () => {
        const { host, renderer, id } = scene();
        renderer.addStation(id);
        renderer.showPreview({ x: 0, y: 0 }, { x: 1, y: 0 }, 50, 10.4);

        renderer.cleanup();

        expect(host.bandKeys).toEqual([]);
        expect(host.drawableKeys).toEqual(['station-preview']);
    });
});
