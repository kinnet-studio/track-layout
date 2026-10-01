import { BCurve } from '@ue-too/curve';
import { describe, expect, it } from 'bun:test';

import {
    DEFAULT_SEGMENT_STYLE,
    type SegmentStyleChange,
    type SegmentStyleFields,
} from '../src/tracks/segment-style.js';
import { type SegmentSplitInfo, TrackGraph } from '../src/tracks/track.js';
import {
    ELEVATION,
    type SerializedTrackData,
    validateSerializedTrackData,
} from '../src/tracks/types.js';

const EAST = { x: 1, y: 0 };

/** Lays a straight segment from (x0, y) to (x0 + 100, y) and returns its number. */
function layStraight(graph: TrackGraph, x0 = 0, y = 0): number {
    const a = graph.createNewEmptyJoint({ x: x0, y }, EAST);
    const b = graph.createNewEmptyJoint({ x: x0 + 100, y }, EAST);
    graph.connectJoints(a, b, [{ x: x0 + 50, y }]);
    return graph.getJoint(a)!.connections.get(b)!;
}

function styleOf(graph: TrackGraph, segment: number): SegmentStyleFields {
    const s = graph.getTrackSegmentWithJoints(segment)!;
    return {
        trackStyle: s.trackStyle,
        electrified: s.electrified,
        catenarySide: s.catenarySide,
        bed: s.bed,
        bedWidth: s.bedWidth,
    };
}

describe('DEFAULT_SEGMENT_STYLE', () => {
    it('is ballasted, not electrified, without a bed, bed width 3', () => {
        expect(DEFAULT_SEGMENT_STYLE).toEqual({
            trackStyle: 'ballasted',
            electrified: false,
            bed: false,
            bedWidth: 3,
        });
    });
});

describe('new segment style', () => {
    it('applies the defaults to new segments', () => {
        const graph = new TrackGraph();
        const segment = layStraight(graph);
        expect(styleOf(graph, segment)).toEqual({
            trackStyle: 'ballasted',
            electrified: false,
            catenarySide: undefined,
            bed: false,
            bedWidth: undefined,
        });
    });

    it('applies the style set with setNewSegmentStyle to later segments only', () => {
        const graph = new TrackGraph();
        const before = layStraight(graph, 0, 0);
        graph.setNewSegmentStyle({
            trackStyle: 'slab',
            electrified: true,
            catenarySide: 1,
        });
        const after = layStraight(graph, 0, 50);

        expect(styleOf(graph, before).trackStyle).toBe('ballasted');
        expect(styleOf(graph, after)).toEqual({
            trackStyle: 'slab',
            electrified: true,
            catenarySide: 1,
            bed: false,
            bedWidth: undefined,
        });
    });

    it('stores the bed width only while the bed is on', () => {
        const graph = new TrackGraph();
        graph.setNewSegmentStyle({ bedWidth: 4 });
        const withoutBed = layStraight(graph, 0, 0);
        graph.setNewSegmentStyle({ bed: true });
        const withBed = layStraight(graph, 0, 50);

        expect(styleOf(graph, withoutBed).bedWidth).toBeUndefined();
        expect(styleOf(graph, withBed)).toMatchObject({
            bed: true,
            bedWidth: 4,
        });
    });

    it('merges partial updates into newSegmentStyle', () => {
        const graph = new TrackGraph();
        graph.setNewSegmentStyle({ trackStyle: 'slab' });
        graph.setNewSegmentStyle({ bed: true });
        expect(graph.newSegmentStyle).toEqual({
            trackStyle: 'slab',
            electrified: false,
            bed: true,
            bedWidth: 3,
        });
    });

    it('clamps the bed width to at least 1 metre', () => {
        const graph = new TrackGraph();
        graph.setNewSegmentStyle({ bedWidth: 0.2 });
        expect(graph.newSegmentStyle.bedWidth).toBe(1);
    });

    it('is carried by preview draw data', () => {
        const graph = new TrackGraph();
        graph.setNewSegmentStyle({ trackStyle: 'slab', electrified: true });
        const preview = graph.trackCurveManager.getPreviewDrawData(
            new BCurve([
                { x: 0, y: 0 },
                { x: 50, y: 0 },
                { x: 100, y: 0 },
            ]),
            ELEVATION.GROUND,
            ELEVATION.GROUND
        );
        expect(preview.length).toBeGreaterThan(0);
        for (const { drawData } of preview) {
            expect(drawData.trackStyle).toBe('slab');
            expect(drawData.electrified).toBe(true);
        }
    });
});

describe('TrackGraph.setSegmentStyle', () => {
    it('updates the segment and notifies subscribers', () => {
        const graph = new TrackGraph();
        const segment = layStraight(graph);
        const changes: SegmentStyleChange[] = [];
        graph.onSegmentStyleChanged(change => changes.push(change));

        expect(
            graph.setSegmentStyle(segment, {
                electrified: true,
                catenarySide: -1,
            })
        ).toBe(true);

        expect(styleOf(graph, segment)).toMatchObject({
            electrified: true,
            catenarySide: -1,
        });
        expect(changes).toEqual([
            {
                segmentNumber: segment,
                style: {
                    trackStyle: 'ballasted',
                    electrified: true,
                    catenarySide: -1,
                    bed: false,
                    bedWidth: undefined,
                },
            },
        ]);
    });

    it('updates the draw data renderers read', () => {
        const graph = new TrackGraph();
        const segment = layStraight(graph);
        graph.setSegmentStyle(segment, { trackStyle: 'slab' });
        const drawData = graph.trackCurveManager.persistedDrawData.filter(
            entry => entry.originalTrackSegment.trackSegmentNumber === segment
        );
        expect(drawData.length).toBeGreaterThan(0);
        for (const entry of drawData) {
            expect(entry.trackStyle).toBe('slab');
        }
    });

    it('clears bedWidth when the bed is turned off', () => {
        const graph = new TrackGraph();
        const segment = layStraight(graph);
        graph.setSegmentStyle(segment, { bed: true, bedWidth: 4 });
        graph.setSegmentStyle(segment, { bed: false });

        expect(styleOf(graph, segment)).toMatchObject({
            bed: false,
            bedWidth: undefined,
        });
        const saved = JSON.parse(JSON.stringify(graph.serialize()));
        expect(saved.segments[0].bed).toBe(false);
        expect(saved.segments[0].bedWidth).toBeUndefined();
    });

    it('stores the default bedWidth when the bed is turned on without one', () => {
        const graph = new TrackGraph();
        const segment = layStraight(graph);
        graph.setSegmentStyle(segment, { bed: true });
        expect(styleOf(graph, segment)).toMatchObject({
            bed: true,
            bedWidth: 3,
        });
    });

    it('changes only style fields from a patch with other properties', () => {
        const graph = new TrackGraph();
        const segment = layStraight(graph);
        const gauge = graph.getTrackSegmentWithJoints(segment)!.gauge;
        graph.setSegmentStyle(segment, {
            trackStyle: 'slab',
            gauge: 9,
        } as never);
        const after = graph.getTrackSegmentWithJoints(segment)!;
        expect(after.trackStyle).toBe('slab');
        expect(after.gauge).toBe(gauge);
    });

    it('returns false and stays silent for an unknown segment', () => {
        const graph = new TrackGraph();
        let changes = 0;
        graph.onSegmentStyleChanged(() => changes++);
        expect(graph.setSegmentStyle(999, { electrified: true })).toBe(false);
        expect(changes).toBe(0);
    });

    it('widens edge snapping when a bed width is added', () => {
        const graph = new TrackGraph();
        const segment = layStraight(graph);
        // 1.8 m from the centreline is outside the edge-snap band of a bare
        // track (gauge/2 + gauge/2 + 0.5 buffer = 1.567 m) but inside it once
        // the segment has a 4 m bed (2 + 0.53 + 0.5 = 3.03 m).
        const probe = { x: 50, y: 1.8 };
        expect(graph.project(probe).hit).toBe(false);

        graph.setSegmentStyle(segment, { bed: true, bedWidth: 4 });

        const result = graph.project(probe);
        expect(result.hit && result.hitType).toBe('edge');
    });
});

describe('style on split segments', () => {
    it('copies the parent segment style to both halves', () => {
        const graph = new TrackGraph();
        const segment = layStraight(graph);
        graph.setSegmentStyle(segment, {
            trackStyle: 'slab',
            electrified: true,
            catenarySide: 1,
            bed: true,
            bedWidth: 5,
        });
        const splits: SegmentSplitInfo[] = [];
        graph.onSegmentSplit(info => splits.push(info));

        graph.insertJointIntoTrackSegmentUsingTrackNumber(segment, 0.5);

        const expected: SegmentStyleFields = {
            trackStyle: 'slab',
            electrified: true,
            catenarySide: 1,
            bed: true,
            bedWidth: 5,
        };
        expect(styleOf(graph, splits[0].firstNewSegment)).toEqual(expected);
        expect(styleOf(graph, splits[0].secondNewSegment)).toEqual(expected);
    });
});

describe('saving and loading style', () => {
    it('round-trips every style field without a renderer', async () => {
        const graph = new TrackGraph();
        graph.setNewSegmentStyle({
            trackStyle: 'slab',
            electrified: true,
            catenarySide: -1,
            bed: true,
            bedWidth: 4.5,
        });
        const segment = layStraight(graph);
        const saved = JSON.parse(JSON.stringify(graph.serialize()));

        expect(saved.segments[0]).toMatchObject({
            trackStyle: 'slab',
            electrified: true,
            catenarySide: -1,
            bed: true,
            bedWidth: 4.5,
        });

        const restored = new TrackGraph();
        await restored.loadFromSerializedData(saved);
        expect(styleOf(restored, segment)).toEqual({
            trackStyle: 'slab',
            electrified: true,
            catenarySide: -1,
            bed: true,
            bedWidth: 4.5,
        });
    });

    it('fills in defaults for saves without style fields', async () => {
        const graph = new TrackGraph();
        const plain = layStraight(graph, 0, 0);
        const bedded = layStraight(graph, 0, 50);
        const saved: SerializedTrackData = JSON.parse(
            JSON.stringify(graph.serialize())
        );
        for (const segment of saved.segments) {
            delete segment.trackStyle;
            delete segment.electrified;
            delete segment.catenarySide;
            delete segment.bed;
            delete segment.bedWidth;
        }
        saved.segments.find(s => s.segmentNumber === bedded)!.bed = true;

        const restored = new TrackGraph();
        await restored.loadFromSerializedData(saved);

        expect(styleOf(restored, plain)).toEqual({
            trackStyle: 'ballasted',
            electrified: false,
            catenarySide: undefined,
            bed: false,
            bedWidth: undefined,
        });
        expect(styleOf(restored, bedded)).toMatchObject({
            bed: true,
            bedWidth: 3,
        });
    });
});

describe('validateSerializedTrackData bedWidth', () => {
    function withBedWidth(bedWidth: unknown) {
        const graph = new TrackGraph();
        layStraight(graph);
        const saved = JSON.parse(JSON.stringify(graph.serialize()));
        saved.segments[0].bedWidth = bedWidth;
        return saved;
    }

    it('accepts a positive bed width', () => {
        expect(validateSerializedTrackData(withBedWidth(3))).toEqual({
            valid: true,
        });
    });

    it('rejects a non-positive or non-numeric bed width', () => {
        for (const bad of [0, -1, '3']) {
            expect(validateSerializedTrackData(withBedWidth(bad))).toEqual({
                valid: false,
                error: 'segments[0].bedWidth must be a positive number',
            });
        }
    });
});
