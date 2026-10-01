import { describe, expect, it } from 'bun:test';

import { TrackGraph } from '../src/tracks/track.js';
import { ELEVATION } from '../src/tracks/types.js';

const EAST = { x: 1, y: 0 };

function straightLine() {
    const graph = new TrackGraph();
    const a = graph.createNewEmptyJoint({ x: 0, y: 0 }, EAST);
    const b = graph.createNewEmptyJoint({ x: 100, y: 0 }, EAST);
    graph.connectJoints(a, b, [{ x: 50, y: 0 }]);
    const ab = graph.getJoint(a)!.connections.get(b)!;
    return { graph, a, b, ab };
}

describe('TrackGraph.isSegmentProtected', () => {
    it('is false when no protection check is registered', () => {
        const { graph, ab } = straightLine();
        expect(graph.isSegmentProtected(ab)).toBe(false);
    });

    it('returns what the registered check reports', () => {
        const { graph, ab } = straightLine();
        graph.setSegmentProtectionCheck(segment => segment === ab);
        expect(graph.isSegmentProtected(ab)).toBe(true);
        expect(graph.isSegmentProtected(ab + 1)).toBe(false);
    });
});

describe('splitting a protected segment', () => {
    it('is refused by insertJointIntoTrackSegmentUsingTrackNumber', () => {
        const { graph, ab } = straightLine();
        graph.setSegmentProtectionCheck(() => true);
        let splits = 0;
        graph.onSegmentSplit(() => splits++);

        expect(
            graph.insertJointIntoTrackSegmentUsingTrackNumber(ab, 0.5)
        ).toBeNull();
        expect(graph.getTrackSegmentWithJoints(ab)).not.toBeNull();
        expect(graph.getJoints()).toHaveLength(2);
        expect(splits).toBe(0);
    });

    it('is refused by insertJointIntoTrackSegment', () => {
        const { graph, a, b, ab } = straightLine();
        graph.setSegmentProtectionCheck(() => true);
        let splits = 0;
        graph.onSegmentSplit(() => splits++);

        expect(graph.insertJointIntoTrackSegment(a, b, 0.5)).toBeNull();
        expect(graph.getTrackSegmentWithJoints(ab)).not.toBeNull();
        expect(graph.getJoints()).toHaveLength(2);
        expect(splits).toBe(0);
    });
});

describe('TrackGraph.insertJointIntoTrackSegment return value', () => {
    it('returns the new joint number on success', () => {
        const { graph, a, b } = straightLine();
        const m = graph.insertJointIntoTrackSegment(a, b, 0.5);
        expect(typeof m).toBe('number');
        expect(graph.getJoint(m!)!.connections.has(a)).toBe(true);
        expect(graph.getJoint(m!)!.connections.has(b)).toBe(true);
    });

    it('returns null for an unknown joint', () => {
        const { graph, a } = straightLine();
        expect(graph.insertJointIntoTrackSegment(a, 999, 0.5)).toBeNull();
    });

    it('returns null when the joints are not directly connected', () => {
        const { graph, a } = straightLine();
        const c = graph.createNewEmptyJoint({ x: 0, y: 50 }, EAST);
        expect(graph.insertJointIntoTrackSegment(a, c, 0.5)).toBeNull();
    });

    it('returns null for a sloped segment', () => {
        const graph = new TrackGraph();
        const a = graph.createNewEmptyJoint({ x: 0, y: 0 }, EAST);
        const b = graph.createNewEmptyJoint(
            { x: 100, y: 0 },
            EAST,
            ELEVATION.ABOVE_1
        );
        graph.connectJoints(a, b, [{ x: 50, y: 0 }]);
        expect(graph.insertJointIntoTrackSegment(a, b, 0.5)).toBeNull();
    });
});
