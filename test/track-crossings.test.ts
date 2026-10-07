import { describe, expect, it } from 'bun:test';

import { TrackGraph } from '../src/tracks/track.js';
import { ELEVATION } from '../src/tracks/types.js';
import { layTrack } from './station-placement-helpers.js';
import { layLine } from './track-helpers.js';

const cm = (g: TrackGraph) => g.trackCurveManager;

describe('getCrossings', () => {
    it('finds a crossing once from each side, at the exact point', () => {
        const graph = new TrackGraph();
        const h = layLine(graph, { x: 0, y: 0 }, { x: 100, y: 0 });
        const v = layLine(
            graph,
            { x: 50, y: -50 },
            { x: 50, y: 50 },
            ELEVATION.ABOVE_1
        );
        const pairs: [number, number][] = [
            [h, v],
            [v, h],
        ];
        for (const [self, other] of pairs) {
            const crossings = cm(graph).getCrossings(self);
            expect(crossings).toHaveLength(1);
            expect(crossings[0]!.otherSegment).toBe(other);
            expect(crossings[0]!.t).toBeCloseTo(0.5, 6);
            expect(crossings[0]!.otherT).toBeCloseTo(0.5, 6);
        }
    });

    it('refines an oblique crossing', () => {
        const graph = new TrackGraph();
        const h = layLine(graph, { x: 0, y: 0 }, { x: 100, y: 0 });
        layLine(graph, { x: 0, y: -30 }, { x: 100, y: 30 }, ELEVATION.ABOVE_1);
        const [c] = cm(graph).getCrossings(h);
        expect(c!.t).toBeCloseTo(0.5, 6);
        expect(c!.otherT).toBeCloseTo(0.5, 6);
    });

    it('reports two crossings with the same track, sorted by t', () => {
        const graph = new TrackGraph();
        const h = layLine(graph, { x: 0, y: 0 }, { x: 100, y: 0 });
        layLine(
            graph,
            { x: 20, y: -40 },
            { x: 80, y: -40 },
            ELEVATION.ABOVE_1,
            { x: 50, y: 120 }
        );
        // y(u) = -40 + 320u - 320u², x(u) = 20 + 60u, and h's t = x / 100
        const us = [
            (320 - Math.sqrt(51200)) / 640,
            (320 + Math.sqrt(51200)) / 640,
        ];
        const crossings = cm(graph).getCrossings(h);
        expect(crossings).toHaveLength(2);
        crossings.forEach((c, i) => {
            expect(c.otherT).toBeCloseTo(us[i]!, 6);
            expect(c.t).toBeCloseTo((20 + 60 * us[i]!) / 100, 6);
        });
    });

    it('ignores a continuation and the branches of a junction', () => {
        const graph = new TrackGraph();
        const east = { x: 1, y: 0 };
        const [a, b, c, d] = [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 200, y: 0 },
            { x: 200, y: 60 },
        ].map(p => graph.createNewEmptyJoint(p, east));
        expect(graph.connectJoints(a!, b!, [{ x: 50, y: 0 }])).toBe(true);
        expect(graph.connectJoints(b!, c!, [{ x: 150, y: 0 }])).toBe(true);
        expect(graph.connectJoints(b!, d!, [{ x: 150, y: 0 }])).toBe(true);
        for (const n of cm(graph).livingEntities) {
            expect(cm(graph).getCrossings(n)).toEqual([]);
        }
    });

    it('keeps a real crossing between segments that share a joint', () => {
        const graph = new TrackGraph();
        const a = graph.createNewEmptyJoint({ x: 0, y: 0 }, { x: 1, y: 0 });
        const b = graph.createNewEmptyJoint({ x: 100, y: 0 }, { x: 1, y: 0 });
        const e = graph.createNewEmptyJoint(
            { x: 60, y: -40 },
            { x: -0.6, y: -1 }
        );
        expect(graph.connectJoints(a, b, [{ x: 50, y: 0 }])).toBe(true);
        expect(graph.connectJoints(a, e, [{ x: 120, y: 60 }])).toBe(true);
        const straight = graph.getJoint(a)!.connections.get(b)!;
        // the loop is back on y = 0 at u = 0.75, x = 78.75
        const crossings = cm(graph).getCrossings(straight);
        expect(crossings).toHaveLength(1);
        expect(crossings[0]!.t).toBeCloseTo(0.7875, 6);
        expect(crossings[0]!.otherT).toBeCloseTo(0.75, 6);
    });

    it('forgets a removed segment, and knows nothing of an unknown one', () => {
        const graph = new TrackGraph();
        const h = layLine(graph, { x: 0, y: 0 }, { x: 100, y: 0 });
        const v = layLine(
            graph,
            { x: 50, y: -50 },
            { x: 50, y: 50 },
            ELEVATION.ABOVE_1
        );
        graph.removeTrackSegment(v);
        expect(cm(graph).getCrossings(h)).toEqual([]);
        expect(cm(graph).getCrossings(99)).toEqual([]);
    });
});

describe('getSegmentsAtJoint', () => {
    it('finds the segments ending at a joint, and nothing for a joint not there', () => {
        const graph = new TrackGraph();
        const { joints } = layTrack(graph, [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 200, y: 0 },
        ]);
        expect(
            cm(graph).getSegmentsAtJoint(joints[1]!, { x: 100, y: 0 })
        ).toEqual([0, 1]);
        expect(
            cm(graph).getSegmentsAtJoint(joints[0]!, { x: 0, y: 0 })
        ).toEqual([0]);
        expect(
            cm(graph).getSegmentsAtJoint(joints[2]!, { x: 100, y: 0 })
        ).toEqual([]);
    });

    it('still finds the neighbours of a segment that has been removed', () => {
        const graph = new TrackGraph();
        const { joints, segments } = layTrack(graph, [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 200, y: 0 },
        ]);
        graph.removeTrackSegment(segments[1]!);
        expect(
            cm(graph).getSegmentsAtJoint(joints[1]!, { x: 100, y: 0 })
        ).toEqual([segments[0]!]);
        expect(
            cm(graph).getSegmentsAtJoint(joints[2]!, { x: 200, y: 0 })
        ).toEqual([]);
    });
});
