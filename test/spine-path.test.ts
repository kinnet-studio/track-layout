import { describe, expect, it } from 'bun:test';

import {
    buildSpinePath,
    sharedJointT,
} from '../src/station-placement/spine-path.js';
import { TrackGraph } from '../src/tracks/track.js';
import { layTrack } from './station-placement-helpers.js';

describe('buildSpinePath', () => {
    it('keeps the picked range on a single segment', () => {
        const graph = new TrackGraph();
        const { segments } = layTrack(graph, [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
        ]);
        expect(
            buildSpinePath(graph, segments[0], 0.8, -1, segments[0], 0.2)
        ).toEqual([
            { trackSegment: segments[0], tStart: 0.8, tEnd: 0.2, side: -1 },
        ]);
    });

    it('runs across a joint that does not branch', () => {
        const graph = new TrackGraph();
        const { segments } = layTrack(graph, [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 200, y: 0 },
        ]);
        expect(
            buildSpinePath(graph, segments[0], 0.5, 1, segments[1], 0.5)
        ).toEqual([
            { trackSegment: segments[0], tStart: 0.5, tEnd: 1, side: 1 },
            { trackSegment: segments[1], tStart: 0, tEnd: 0.5, side: 1 },
        ]);
    });

    it('flips the side onto a segment that runs the other way', () => {
        const graph = new TrackGraph();
        const a = graph.createNewEmptyJoint({ x: 0, y: 0 }, { x: 1, y: 0 });
        const b = graph.createNewEmptyJoint({ x: 100, y: 0 }, { x: 1, y: 0 });
        const c = graph.createNewEmptyJoint({ x: 200, y: 0 }, { x: 1, y: 0 });
        graph.connectJoints(a, b, [{ x: 50, y: 0 }]);
        graph.connectJoints(c, b, [{ x: 150, y: 0 }]);
        const ab = graph.getJoint(a)!.connections.get(b)!;
        const cb = graph.getJoint(c)!.connections.get(b)!;

        expect(buildSpinePath(graph, ab, 0.5, 1, cb, 0.5)).toEqual([
            { trackSegment: ab, tStart: 0.5, tEnd: 1, side: 1 },
            { trackSegment: cb, tStart: 1, tEnd: 0.5, side: -1 },
        ]);
    });

    it('returns null when the only way runs through a branching joint', () => {
        const graph = new TrackGraph();
        const { joints, segments } = layTrack(graph, [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 200, y: 0 },
        ]);
        const branchEnd = graph.createNewEmptyJoint(
            { x: 200, y: 40 },
            { x: 1, y: 0 }
        );
        graph.connectJoints(joints[1], branchEnd, [{ x: 150, y: 0 }]);
        expect(
            buildSpinePath(graph, segments[0], 0.5, 1, segments[1], 0.5)
        ).toBeNull();
    });
});

describe('sharedJointT', () => {
    it('gives the t of the joint the segment shares with the other', () => {
        expect(
            sharedJointT({ t0Joint: 1, t1Joint: 2 }, { t0Joint: 2, t1Joint: 3 })
        ).toBe(1);
        expect(
            sharedJointT({ t0Joint: 2, t1Joint: 3 }, { t0Joint: 1, t1Joint: 2 })
        ).toBe(0);
    });

    it('falls back to 1 when the segments share no joint', () => {
        expect(
            sharedJointT({ t0Joint: 1, t1Joint: 2 }, { t0Joint: 3, t1Joint: 4 })
        ).toBe(1);
    });
});
