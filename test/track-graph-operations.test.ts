import { describe, expect, it } from 'bun:test';

import { type SegmentSplitInfo, TrackGraph } from '../src/tracks/track.js';
import { ELEVATION } from '../src/tracks/types.js';

const EAST = { x: 1, y: 0 };

/**
 * A(0,0) — B(100,0): one straight segment along +x. Straight track is a
 * quadratic curve whose control point is the midpoint.
 */
function straightLine(gauge = 1.067) {
    const graph = new TrackGraph();
    const a = graph.createNewEmptyJoint({ x: 0, y: 0 }, EAST);
    const b = graph.createNewEmptyJoint({ x: 100, y: 0 }, EAST);
    graph.connectJoints(a, b, [{ x: 50, y: 0 }], gauge);
    const ab = graph.getJoint(a)!.connections.get(b)!;
    return { graph, a, b, ab };
}

/**
 * A — M — B along +x with a branch M — D diverging on M's tangent side, so
 * M is a switch: tangent side {B, D}, reverse-tangent side {A}.
 */
function junction() {
    const { graph, a, b, ab } = straightLine();
    const m = graph.insertJointIntoTrackSegmentUsingTrackNumber(ab, 0.5)!;
    const d = graph.createNewEmptyJoint({ x: 100, y: -40 }, { x: 1, y: -1 });
    graph.connectJoints(m, d, [{ x: 80, y: 0 }]);
    const am = graph.getJoint(a)!.connections.get(m)!;
    const mb = graph.getJoint(m)!.connections.get(b)!;
    const md = graph.getJoint(m)!.connections.get(d)!;
    return { graph, a, b, m, d, am, mb, md };
}

describe('TrackGraph.connectJoints', () => {
    it('creates a segment and records it on both joints', () => {
        const { graph, a, b, ab } = straightLine();
        expect(graph.getJoint(b)!.connections.get(a)).toBe(ab);
        expect(graph.getTrackSegmentWithJoints(ab)).not.toBeNull();
    });

    it('files the neighbour on the side its tangent points to', () => {
        const { graph, a, b } = straightLine();
        expect([...graph.getJoint(a)!.direction.tangent]).toEqual([b]);
        expect([...graph.getJoint(a)!.direction.reverseTangent]).toEqual([]);
        expect([...graph.getJoint(b)!.direction.reverseTangent]).toEqual([a]);
        expect([...graph.getJoint(b)!.direction.tangent]).toEqual([]);
    });

    it('stores the gauge on the segment', () => {
        const { graph, ab } = straightLine(1.435);
        expect(graph.getTrackSegmentWithJoints(ab)!.gauge).toBe(1.435);
    });

    it('refuses to connect two joints that are already connected', () => {
        const { graph, a, b } = straightLine();
        expect(graph.connectJoints(a, b, [{ x: 50, y: 0 }])).toBe(false);
    });

    it('refuses an unknown joint', () => {
        const { graph, a } = straightLine();
        expect(graph.connectJoints(a, 999, [{ x: 10, y: 0 }])).toBe(false);
    });
});

describe('TrackGraph.insertJointIntoTrackSegmentUsingTrackNumber', () => {
    it('splits a flat segment and returns the new joint', () => {
        const { graph, a, b, ab } = straightLine();
        const m = graph.insertJointIntoTrackSegmentUsingTrackNumber(ab, 0.5);

        expect(m).not.toBeNull();
        expect(graph.getTrackSegmentWithJoints(ab)).toBeNull();
        expect(graph.getJoint(m!)!.position.x).toBeCloseTo(50);
        expect(graph.getJoint(m!)!.position.y).toBeCloseTo(0);
        expect(graph.getJoint(a)!.connections.has(b)).toBe(false);
        expect(graph.getJoint(a)!.connections.has(m!)).toBe(true);
        expect(graph.getJoint(b)!.connections.has(m!)).toBe(true);
    });

    it('notifies split subscribers with both new segments', () => {
        const { graph, ab } = straightLine();
        const events: SegmentSplitInfo[] = [];
        graph.onSegmentSplit(info => events.push(info));

        const m = graph.insertJointIntoTrackSegmentUsingTrackNumber(ab, 0.5);

        expect(events).toHaveLength(1);
        expect(events[0].oldSegmentNumber).toBe(ab);
        expect(events[0].splitT).toBe(0.5);
        expect(events[0].newJointNumber).toBe(m!);
        expect(
            graph.getTrackSegmentWithJoints(events[0].firstNewSegment)
        ).not.toBeNull();
        expect(
            graph.getTrackSegmentWithJoints(events[0].secondNewSegment)
        ).not.toBeNull();
    });

    it('keeps the gauge on both halves', () => {
        const { graph, ab } = straightLine(1.435);
        const events: SegmentSplitInfo[] = [];
        graph.onSegmentSplit(info => events.push(info));
        graph.insertJointIntoTrackSegmentUsingTrackNumber(ab, 0.5);
        const { firstNewSegment, secondNewSegment } = events[0];
        expect(graph.getTrackSegmentWithJoints(firstNewSegment)!.gauge).toBe(
            1.435
        );
        expect(graph.getTrackSegmentWithJoints(secondNewSegment)!.gauge).toBe(
            1.435
        );
    });

    it('refuses to split a sloped segment', () => {
        const graph = new TrackGraph();
        const a = graph.createNewEmptyJoint(
            { x: 0, y: 0 },
            EAST,
            ELEVATION.GROUND
        );
        const b = graph.createNewEmptyJoint(
            { x: 100, y: 0 },
            EAST,
            ELEVATION.ABOVE_1
        );
        graph.connectJoints(a, b, [{ x: 50, y: 0 }]);
        const ab = graph.getJoint(a)!.connections.get(b)!;
        let splits = 0;
        graph.onSegmentSplit(() => splits++);

        expect(
            graph.insertJointIntoTrackSegmentUsingTrackNumber(ab, 0.5)
        ).toBeNull();
        expect(graph.getTrackSegmentWithJoints(ab)).not.toBeNull();
        expect(splits).toBe(0);
    });

    it('returns null for an unknown segment', () => {
        const { graph } = straightLine();
        expect(
            graph.insertJointIntoTrackSegmentUsingTrackNumber(999, 0.5)
        ).toBeNull();
    });
});

describe('TrackGraph.insertJointIntoTrackSegment', () => {
    it('splits the segment between two connected joints', () => {
        const { graph, a, b, ab } = straightLine();
        let splits = 0;
        graph.onSegmentSplit(() => splits++);

        graph.insertJointIntoTrackSegment(a, b, 0.5);

        expect(splits).toBe(1);
        expect(graph.getTrackSegmentWithJoints(ab)).toBeNull();
        expect(graph.getJoint(a)!.connections.has(b)).toBe(false);
    });
});

describe('TrackGraph.removeTrackSegment', () => {
    it('removes the segment and deletes joints left with no connections', () => {
        const { graph, a, b, ab } = straightLine();
        const removed: number[] = [];
        graph.onSegmentRemoved(segment => removed.push(segment));

        graph.removeTrackSegment(ab);

        expect(graph.getTrackSegmentWithJoints(ab)).toBeNull();
        expect(graph.getJoint(a)).toBeNull();
        expect(graph.getJoint(b)).toBeNull();
        expect(removed).toEqual([ab]);
    });

    it('keeps a segment the protection check reports as protected', () => {
        const { graph, ab } = straightLine();
        graph.setSegmentProtectionCheck(segment => segment === ab);
        const removed: number[] = [];
        graph.onSegmentRemoved(segment => removed.push(segment));

        graph.removeTrackSegment(ab);

        expect(graph.getTrackSegmentWithJoints(ab)).not.toBeNull();
        expect(removed).toEqual([]);
    });

    it('refuses to empty the single-track side of a switch', () => {
        const { graph, am } = junction();
        graph.removeTrackSegment(am);
        expect(graph.getTrackSegmentWithJoints(am)).not.toBeNull();
    });

    it('allows removing one leg of the branching side', () => {
        const { graph, m, b, d, mb } = junction();

        graph.removeTrackSegment(mb);

        expect(graph.getTrackSegmentWithJoints(mb)).toBeNull();
        expect(graph.getJoint(b)).toBeNull();
        expect([...graph.getJoint(m)!.direction.tangent]).toEqual([d]);
    });
});

describe('TrackGraph.project', () => {
    it('reports a joint hit at a joint position', () => {
        const { graph, a } = straightLine();
        const result = graph.project({ x: 0, y: 0 });
        expect(result.hit).toBe(true);
        if (result.hit && result.hitType === 'joint') {
            expect(result.jointNumber).toBe(a);
            expect(result.endingJoint).toBe(true);
        } else {
            throw new Error(
                `expected a joint hit, got ${JSON.stringify(result)}`
            );
        }
    });

    it('reports a curve hit on the track away from joints', () => {
        const { graph, ab } = straightLine();
        const result = graph.project({ x: 50, y: 0.2 });
        if (result.hit && result.hitType === 'curve') {
            expect(result.curve).toBe(ab);
            expect(result.atT).toBeCloseTo(0.5, 2);
        } else {
            throw new Error(
                `expected a curve hit, got ${JSON.stringify(result)}`
            );
        }
    });

    it('reports no hit far from any track', () => {
        const { graph } = straightLine();
        expect(graph.project({ x: 50, y: 30 })).toEqual({ hit: false });
    });
});

describe('TrackGraph.jointIsEndingTrack', () => {
    it('is true for a dead end and false for a switch', () => {
        const { graph, a, m } = junction();
        expect(graph.jointIsEndingTrack(a)).toBe(true);
        expect(graph.jointIsEndingTrack(m)).toBe(false);
    });
});
