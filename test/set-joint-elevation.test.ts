import { beforeEach, describe, expect, it } from 'bun:test';

import type { JointElevationRefusal } from '../src/index.js';
import { TrackGraph } from '../src/tracks/track.js';
import type { TrackCurveManager } from '../src/tracks/trackcurve-manager.js';
import { layLine } from './track-helpers.js';

const EAST = { x: 1, y: 0 };

let graph: TrackGraph;
let manager: TrackCurveManager;

function newGraph() {
    graph = new TrackGraph();
    manager = graph.trackCurveManager;
}

function segment(n: number) {
    return manager.getTrackSegmentWithJoints(n)!;
}

/** Segment `n`'s drawn pieces, as plain data, in order along it. */
function piecesOf(n: number) {
    return manager.persistedDrawData
        .filter(d => d.originalTrackSegment.trackSegmentNumber === n)
        .map(d => ({
            tValInterval: { ...d.originalTrackSegment.tValInterval },
            elevation: { ...d.elevation },
        }))
        .sort((p, q) => p.tValInterval.start - q.tValInterval.start);
}

function pieceHeights(n: number) {
    return piecesOf(n).map(p => p.elevation);
}

/** The point `metres` along segment `n`, whose curve is straight. */
function pointOn(n: number, metres: number) {
    const curve = segment(n).curve;
    return curve.get(metres / curve.fullLength);
}

/** a (0, 0) – j (100, 0) – b (200, 0): flat ground segments s1 (a→j) and s2 (j→b). */
function line() {
    const a = graph.createNewEmptyJoint({ x: 0, y: 0 }, EAST);
    const j = graph.createNewEmptyJoint({ x: 100, y: 0 }, EAST);
    const b = graph.createNewEmptyJoint({ x: 200, y: 0 }, EAST);
    graph.connectJoints(a, j, [{ x: 50, y: 0 }]);
    graph.connectJoints(j, b, [{ x: 150, y: 0 }]);
    return {
        j,
        s1: graph.getJoint(a)!.connections.get(j)!,
        s2: graph.getJoint(j)!.connections.get(b)!,
    };
}

describe('TrackGraph.setJointElevation', () => {
    let j: number;
    let s1: number;
    let s2: number;

    beforeEach(() => {
        newGraph();
        ({ j, s1, s2 } = line());
    });

    it('changes both segments at a joint and keeps their numbers', () => {
        expect(graph.setJointElevation(j, 6.5)).toBeNull();
        expect(segment(s1).elevation).toEqual({ from: 0, to: 6.5 });
        expect(segment(s2).elevation).toEqual({ from: 6.5, to: 0 });
        expect(graph.getJoint(j)?.elevation).toBe(6.5);
        expect(graph.trackCurveManager.livingEntities.sort()).toEqual(
            [s1, s2].sort()
        );
    });

    it('fires piece delete and add events and the heights-changed event, but no segment add or remove', () => {
        const events: string[] = [];
        manager.onDelete(() => events.push('delete'));
        manager.onAdd(() => events.push('add'));
        manager.onAddTrackSegment(() => events.push('addSegment'));
        manager.onRemoveTrackSegment(() => events.push('removeSegment'));
        graph.onSegmentElevationChanged(n => events.push(`changed ${n}`));
        graph.setJointElevation(j, 6.5);
        expect(events).not.toContain('addSegment');
        expect(events).not.toContain('removeSegment');
        expect(events.filter(e => e.startsWith('changed'))).toEqual([
            `changed ${s1}`,
            `changed ${s2}`,
        ]);
        expect(events.indexOf('delete')).toBeLessThan(
            events.indexOf(`changed ${s1}`)
        );
    });

    it('replaces each piece and fires the heights-changed event last', () => {
        const events: string[] = [];
        manager.onDelete(key => events.push(`delete ${key}`));
        manager.onAdd((_, pieces) =>
            events.push(
                `add ${pieces.map(p => p.originalTrackSegment.trackSegmentNumber)}`
            )
        );
        manager.onSegmentElevationChanged(n => events.push(`changed ${n}`));
        graph.setJointElevation(j, 6.5);
        const key = (n: number) =>
            JSON.stringify({
                trackSegmentNumber: n,
                tValInterval: { start: 0, end: 1 },
            });
        expect(events).toEqual([
            `delete ${key(s1)}`,
            `add ${s1}`,
            `changed ${s1}`,
            `delete ${key(s2)}`,
            `add ${s2}`,
            `changed ${s2}`,
        ]);
        expect(piecesOf(s1)).toEqual([
            {
                tValInterval: { start: 0, end: 1 },
                elevation: { from: 0, to: 6.5 },
            },
        ]);
    });

    it('accepts 200.004 m as 200 m', () => {
        expect(graph.setJointElevation(j, 200.004)).toBeNull();
        expect(graph.getJoint(j)?.elevation).toBe(200);
        expect(segment(s1).elevation.to).toBe(200);
    });

    it('fires nothing for the height the joint already has', () => {
        const events: string[] = [];
        manager.onDelete(() => events.push('delete'));
        manager.onAdd(() => events.push('add'));
        graph.onSegmentElevationChanged(n => events.push(`changed ${n}`));
        expect(graph.setJointElevation(j, 0.001)).toBeNull();
        expect(events).toEqual([]);
    });

    it('refuses an unknown joint, a height out of range and a protected segment', () => {
        const changed: number[] = [];
        graph.onSegmentElevationChanged(n => changed.push(n));
        const unknown: JointElevationRefusal | null = graph.setJointElevation(
            999,
            1
        );
        expect(unknown).toBe('unknownJoint');
        expect(graph.setJointElevation(j, 200.01)).toBe('outOfRange');
        expect(graph.setJointElevation(j, NaN)).toBe('outOfRange');
        graph.setSegmentProtectionCheck(n => n === s2);
        expect(graph.setJointElevation(j, 3)).toBe('protectedSegment');
        expect(graph.getJoint(j)?.elevation).toBe(0); // nothing changed
        expect(segment(s1).elevation).toEqual({ from: 0, to: 0 });
        expect(changed).toEqual([]);
    });
});

describe('TrackGraph.setJointElevation across a crossing', () => {
    let j: number;
    let s1: number;
    let c: number;

    beforeEach(() => {
        newGraph();
        // s1 is straight from a (0, 0) to j (100, 0); a flat cross track c runs north–south at x = 50.
        c = layLine(graph, { x: 50, y: -50 }, { x: 50, y: 50 });
        ({ j, s1 } = line());
    });

    it('re-splits a segment that becomes sloped at its crossings', () => {
        // Flat s1 was not split there. Sloped, it splits halfway to the crossing, as createCurveWithJoints does.
        // getCurveIntersections reports the one crossing as four hits, two at t = 0.494 and two at t = 0.506,
        // and createCurveWithJoints splits halfway between each hit and the one before it.
        graph.setJointElevation(j, 6.5);
        expect(segment(s1).splits).toEqual([0.25, 0.49, 0.5, 0.51]);
        const heights = pieceHeights(s1);
        const [first] = heights;
        const last = heights[heights.length - 1];
        expect(first.from).toBe(0);
        expect(first.to).toBeCloseTo(1.625, 6);
        expect(last.to).toBe(6.5);
        expect(segment(s1).splitCurves.map(p => p.elevation)).toEqual(heights);
        graph.setJointElevation(j, 0);
        expect(segment(s1).splits).toEqual([]);
        expect(pieceHeights(s1)).toEqual([{ from: 0, to: 0 }]);
    });

    it('splits a segment as laying it at the new heights would', () => {
        graph.setJointElevation(j, 6.5);
        const laid = new TrackGraph();
        layLine(laid, { x: 50, y: -50 }, { x: 50, y: 50 });
        const a = laid.createNewEmptyJoint({ x: 0, y: 0 }, EAST, 0);
        const end = laid.createNewEmptyJoint({ x: 100, y: 0 }, EAST, 6.5);
        laid.connectJoints(a, end, [{ x: 50, y: 0 }]);
        const fresh = laid.getJoint(a)!.connections.get(end)!;
        expect(segment(s1).splits).toEqual(
            laid.trackCurveManager.getTrackSegmentWithJoints(fresh)!.splits
        );
    });

    it('keeps the segment in the R-tree with its new heights', () => {
        graph.setJointElevation(j, 6.5);
        const hit = graph.projectPointOnTrack(pointOn(s1, 1));
        expect(hit?.curve).toBe(s1);
        expect(hit?.elevation).toMatchObject({ curveIsSloped: true });
        // one entry, not the old one and a new one
        expect(manager.getCrossings(c).map(x => x.otherSegment)).toEqual([s1]);
    });

    it('round-trips through serialize', async () => {
        graph.setJointElevation(j, 6.5);
        const again = new TrackGraph();
        await again.loadFromSerializedData(graph.serialize());
        expect(again.serialize()).toEqual(graph.serialize());
    });

    it('leaves crossing segments alone', () => {
        const before = piecesOf(c);
        graph.setJointElevation(j, 6.5);
        expect(piecesOf(c)).toEqual(before);
    });
});

describe('TrackGraph.setJointElevation at a junction', () => {
    let b1: number;
    let branchEnd: number;

    beforeEach(() => {
        newGraph();
        // trunk t from (-100, 0) to the junction (0, 0); branch b1 straight on to (100, 0), b2 diverging to (50, -40)
        const start = graph.createNewEmptyJoint({ x: -100, y: 0 }, EAST);
        const junction = graph.createNewEmptyJoint({ x: 0, y: 0 }, EAST);
        branchEnd = graph.createNewEmptyJoint({ x: 100, y: 0 }, EAST);
        const otherEnd = graph.createNewEmptyJoint(
            { x: 50, y: -40 },
            { x: 1, y: -2 }
        );
        graph.connectJoints(start, junction, [{ x: -50, y: 0 }]);
        graph.connectJoints(junction, branchEnd, [{ x: 50, y: 0 }]);
        graph.connectJoints(junction, otherEnd, [{ x: 30, y: 0 }]);
        b1 = graph.getJoint(junction)!.connections.get(branchEnd)!;
    });

    it('allows a change that leaves a branch sloped', () => {
        // the junction's laying rules are not enforced here
        expect(graph.setJointElevation(branchEnd, 4)).toBeNull();
        expect(segment(b1).elevation.to).toBe(4);
    });

    it('does not split a segment where the segments at its joints meet it', () => {
        graph.setJointElevation(branchEnd, 4);
        expect(segment(b1).splits).toEqual([]);
        expect(pieceHeights(b1)).toEqual([{ from: 0, to: 4 }]);
    });
});

describe('TrackCurveManager.setSegmentElevation', () => {
    beforeEach(newGraph);

    it('keeps the curve, gauge, style, collisions and offsets', () => {
        const { s1 } = line();
        graph.setSegmentStyle(s1, { trackStyle: 'slab', electrified: true });
        const before = segment(s1);
        const { curve, gauge, collision } = before;
        const offsets = manager.trackOffsets;

        expect(manager.setSegmentElevation(s1, { from: 0, to: 6.5 })).toBe(
            true
        );

        const after = segment(s1);
        expect(after.curve).toBe(curve);
        expect(after.gauge).toBe(gauge);
        expect(after.collision).toBe(collision);
        expect(after.trackStyle).toBe('slab');
        expect(after.electrified).toBe(true);
        expect(manager.trackOffsets).toHaveLength(offsets.length);
        expect(manager.trackOffsets.every((o, i) => o === offsets[i])).toBe(
            true
        );
        const pieces = manager.persistedDrawData.filter(
            d => d.originalTrackSegment.trackSegmentNumber === s1
        );
        expect(pieces.map(p => p.trackStyle)).toEqual(['slab']);
    });

    it('returns false for an unknown segment', () => {
        expect(manager.setSegmentElevation(999, { from: 0, to: 1 })).toBe(
            false
        );
    });
});
