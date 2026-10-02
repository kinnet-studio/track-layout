import { describe, expect, it } from 'bun:test';
import type { MeshSimple } from 'pixi.js';

import { TrackRenderSystem } from '../src/pixi/track-render-system.js';
import type { SegmentStyle } from '../src/tracks/segment-style.js';
import { TrackGraph } from '../src/tracks/track.js';
import { ELEVATION } from '../src/tracks/types.js';
import {
    RecordingLayerHost,
    camera,
    drawKey,
    textureRenderer,
} from './pixi-helpers.js';
import { layTrack } from './station-placement-helpers.js';

/**
 * Segment 0, laid with `before`, then restyled with `patch`; and segment 1,
 * laid apart from it with the style segment 0 ends up with.
 */
function restyled(before: Partial<SegmentStyle>, patch: Partial<SegmentStyle>) {
    const host = new RecordingLayerHost();
    const graph = new TrackGraph();
    new TrackRenderSystem(host, graph.trackCurveManager, camera(), {
        textureRenderer,
    });
    graph.setNewSegmentStyle(before);
    layTrack(
        graph,
        [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
        ],
        ELEVATION.ABOVE_1
    );
    graph.setNewSegmentStyle(patch);
    layTrack(
        graph,
        [
            { x: 0, y: 50 },
            { x: 100, y: 50 },
        ],
        ELEVATION.ABOVE_1
    );
    const pieces = (segment: number) => {
        const key = drawKey(segment);
        return {
            drawable: host.bandItem(key),
            rail: host.bandItem(`__rail__${key}`),
            catenary: host.bandItem(`__catenary__${key}`),
            bedElevation: host.bedElevationOf(key),
            shadow: host.shadow(key),
        };
    };
    const before0 = pieces(0);
    const before1 = pieces(1);
    graph.setSegmentStyle(0, patch);
    return { host, before0, before1, after0: pieces(0), after1: pieces(1) };
}

/** The texture of the rail mesh in a rail container. */
function railTexture(rail: ReturnType<typeof restyled>['after0']['rail']) {
    return (rail!.children[0] as MeshSimple).texture;
}

describe('restyling a laid segment', () => {
    it('rebuilds its drawable, rails and shadow', () => {
        const { before0, after0 } = restyled({}, { trackStyle: 'slab' });

        expect(after0.drawable).not.toBe(before0.drawable);
        expect(after0.rail).not.toBe(before0.rail);
        expect(after0.shadow).not.toBe(before0.shadow);
        expect(before0.drawable!.destroyed).toBe(true);
    });

    it('draws slab rails after a change to slab track', () => {
        const { after0, after1 } = restyled({}, { trackStyle: 'slab' });

        expect(railTexture(after0.rail)).toBe(railTexture(after1.rail));
    });

    it('draws ballasted rails after a change back from slab', () => {
        const { after0, after1 } = restyled(
            { trackStyle: 'slab' },
            { trackStyle: 'ballasted' }
        );

        expect(railTexture(after0.rail)).toBe(railTexture(after1.rail));
    });

    it('adds a bed when bed is turned on, and removes it when turned off', () => {
        const on = restyled({}, { bed: true });
        expect(on.before0.bedElevation).toBeUndefined();
        expect(on.after0.bedElevation).toBe(ELEVATION.ABOVE_1);

        const off = restyled({ bed: true }, { bed: false });
        expect(off.after0.bedElevation).toBeUndefined();
    });

    it('rebuilds the bed at its new width', () => {
        const { host } = restyled(
            { bed: true, bedWidth: 4 },
            { bed: true, bedWidth: 10 }
        );
        const width = (segment: number) =>
            host.bed(drawKey(segment))!.getLocalBounds().height;

        expect(width(0)).toBeCloseTo(width(1));
        expect(width(0)).toBeGreaterThan(9);
    });

    it('adds catenary when electrified, on the side given, and removes it when not', () => {
        const on = restyled({}, { electrified: true, catenarySide: -1 });
        // The bounds across the track, relative to its centreline: segment 0
        // runs along y = 0 and segment 1 along y = 50.
        const across = (catenary: typeof on.after0.catenary, y: number) => {
            const bounds = catenary!.getLocalBounds();
            return [bounds.minY - y, bounds.maxY - y];
        };
        expect(on.before0.catenary).toBeUndefined();
        const [restyled0, laid1] = [
            across(on.after0.catenary, 0),
            across(on.after1.catenary, 50),
        ];
        expect(restyled0[0]).toBeCloseTo(laid1[0]!);
        expect(restyled0[1]).toBeCloseTo(laid1[1]!);

        const off = restyled({ electrified: true }, { electrified: false });
        expect(off.after0.catenary).toBeUndefined();
    });

    it('leaves other segments untouched', () => {
        const { before1, after1 } = restyled({}, { bed: true });

        expect(after1.drawable).toBe(before1.drawable);
        expect(after1.rail).toBe(before1.rail);
        expect(after1.shadow).toBe(before1.shadow);
    });

    it('rebuilds every piece of a segment split at a crossing', () => {
        const host = new RecordingLayerHost();
        const graph = new TrackGraph();
        new TrackRenderSystem(host, graph.trackCurveManager, camera(), {
            textureRenderer,
        });
        // Segment 0 runs along the ground. Segment 1 ramps up across it, so
        // the model splits segment 1's draw data at the crossing.
        const east = { x: 1, y: 0 };
        const south = { x: 0, y: 1 };
        const west0 = graph.createNewEmptyJoint(
            { x: 0, y: 0 },
            east,
            ELEVATION.GROUND
        );
        const east0 = graph.createNewEmptyJoint(
            { x: 100, y: 0 },
            east,
            ELEVATION.GROUND
        );
        graph.connectJoints(west0, east0, [{ x: 50, y: 0 }]);
        const north1 = graph.createNewEmptyJoint(
            { x: 50, y: -50 },
            south,
            ELEVATION.GROUND
        );
        const south1 = graph.createNewEmptyJoint(
            { x: 50, y: 50 },
            south,
            ELEVATION.ABOVE_1
        );
        graph.connectJoints(north1, south1, [{ x: 50, y: 0 }]);

        const keys = graph.trackCurveManager.persistedDrawData
            .filter(
                drawData =>
                    drawData.originalTrackSegment.trackSegmentNumber === 1
            )
            .map(({ originalTrackSegment: { tValInterval } }) =>
                drawKey(1, tValInterval.start, tValInterval.end)
            );
        expect(keys.length).toBeGreaterThan(1);
        const before = keys.map(key => host.bandItem(key));
        for (const [i, key] of keys.entries()) {
            expect(before[i]).toBeDefined();
            expect(host.bedElevationOf(key)).toBeUndefined();
        }

        graph.setSegmentStyle(1, { bed: true });

        for (const [i, key] of keys.entries()) {
            expect(host.bedElevationOf(key)).toBeDefined();
            expect(host.bandItem(key)).not.toBe(before[i]);
            expect(before[i]!.destroyed).toBe(true);
        }
    });

    it('keeps the rebuilt pieces hidden while zoomed out', () => {
        const { after0 } = restyled({}, { bed: true });

        expect(after0.drawable!.visible).toBe(false);
        expect(after0.rail!.visible).toBe(false);
    });

    it('rebuilds the ballast with the elevation gradient when it is on', () => {
        const host = new RecordingLayerHost();
        const graph = new TrackGraph();
        const renderer = new TrackRenderSystem(
            host,
            graph.trackCurveManager,
            camera(),
            { textureRenderer }
        );
        layTrack(graph, [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
        ]);
        renderer.showElevationGradient = true;

        graph.setSegmentStyle(0, { bed: true });

        const [gradient, solid] = host.bandItem(drawKey(0))!.children[0]!
            .children;
        expect([gradient!.visible, solid!.visible]).toEqual([true, false]);
    });

    it('keeps the restyled segment in its band', () => {
        const { host } = restyled({}, { trackStyle: 'slab', bed: true });

        expect(host.bandOf(drawKey(0))).toBe(4);
        expect(host.bandOf(`__rail__${drawKey(0)}`)).toBe(4);
    });
});
