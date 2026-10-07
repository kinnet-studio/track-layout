import { describe, expect, it } from 'bun:test';

import {
    type SegmentStyleChange,
    applyStylePatch,
    normalizeLineStyle,
    styleFieldsOf,
} from '../src/tracks/segment-style.js';
import { type SegmentSplitInfo, TrackGraph } from '../src/tracks/track.js';
import { TrackCurveManager } from '../src/tracks/trackcurve-manager.js';
import { validateSerializedTrackData } from '../src/tracks/types.js';

const EAST = { x: 1, y: 0 };

/** Lays a straight segment from (x0, y) to (x0 + 100, y) and returns its number. */
function layStraight(graph: TrackGraph, x0 = 0, y = 0): number {
    const a = graph.createNewEmptyJoint({ x: x0, y }, EAST);
    const b = graph.createNewEmptyJoint({ x: x0 + 100, y }, EAST);
    graph.connectJoints(a, b, [{ x: x0 + 50, y }]);
    return graph.getJoint(a)!.connections.get(b)!;
}

/** A save of one straight segment with its `lineStyle` set to `value` as-is. */
function withLineStyle(value: unknown) {
    const graph = new TrackGraph();
    layStraight(graph);
    const saved = JSON.parse(JSON.stringify(graph.serialize()));
    saved.segments[0].lineStyle = value;
    return saved;
}

describe('normalizeLineStyle', () => {
    it('drops unset fields and returns a copy', () => {
        const style = { preset: 'planned' as const, color: undefined };
        const out = normalizeLineStyle(style)!;
        expect(out).toEqual({ preset: 'planned' });
        expect('color' in out).toBe(false);
        expect(out).not.toBe(style);
    });

    it('is undefined for no style and for a style with no fields', () => {
        expect(normalizeLineStyle(undefined)).toBeUndefined();
        expect(normalizeLineStyle({})).toBeUndefined();
        expect(normalizeLineStyle({ width: undefined })).toBeUndefined();
    });
});

describe('applyStylePatch lineStyle', () => {
    const current = {
        lineStyle: { preset: 'disused' as const, color: 0xff0000 },
    };

    it('replaces the whole line style', () => {
        expect(
            applyStylePatch(current, { lineStyle: { pattern: 'dotted' } })
                .lineStyle
        ).toEqual({ pattern: 'dotted' });
    });

    it('clears it with undefined or an empty style', () => {
        for (const lineStyle of [undefined, {}]) {
            expect(
                applyStylePatch(current, { lineStyle }).lineStyle
            ).toBeUndefined();
        }
    });

    it('keeps it when the patch has no lineStyle key', () => {
        expect(applyStylePatch(current, { bed: true }).lineStyle).toEqual(
            current.lineStyle
        );
    });
});

it('styleFieldsOf copies the line style', () => {
    const source = { lineStyle: { color: 0xff0000 } };
    const copy = styleFieldsOf(source);
    source.lineStyle.color = 1;
    expect(copy.lineStyle).toEqual({ color: 0xff0000 });
});

describe('setNewSegmentStyle lineStyle', () => {
    it('lays new track with it, keeps it through other changes, and clears it', () => {
        const graph = new TrackGraph();
        graph.setNewSegmentStyle({ lineStyle: { preset: 'tunnel' } });
        const n = layStraight(graph);
        expect(graph.getTrackSegmentWithJoints(n)!.lineStyle).toEqual({
            preset: 'tunnel',
        });
        graph.setNewSegmentStyle({ bed: true });
        expect(graph.newSegmentStyle.lineStyle).toEqual({ preset: 'tunnel' });
        graph.setNewSegmentStyle({ lineStyle: undefined });
        expect(graph.newSegmentStyle.lineStyle).toBeUndefined();
    });
});

it('setSegmentStyle puts it on the segment, its pieces and the event', () => {
    const graph = new TrackGraph();
    const n = layStraight(graph);
    const changes: SegmentStyleChange[] = [];
    graph.onSegmentStyleChanged(change => changes.push(change));
    const lineStyle = { pattern: 'dash-dot' as const, color: 0x2266cc };
    graph.setSegmentStyle(n, { lineStyle });
    expect(changes[0]!.style.lineStyle).toEqual(lineStyle);
    expect(graph.getTrackSegmentWithJoints(n)!.lineStyle).toEqual(lineStyle);
    const pieces = graph.trackCurveManager.persistedDrawData.filter(
        d => d.originalTrackSegment.trackSegmentNumber === n
    );
    expect(pieces.length).toBeGreaterThan(0);
    for (const piece of pieces) expect(piece.lineStyle).toEqual(lineStyle);
});

describe('saving and loading lineStyle', () => {
    it('writes it only when set, and loads it back', async () => {
        const graph = new TrackGraph();
        const styled = layStraight(graph, 0);
        const plain = layStraight(graph, 0, 50); // y = 50, clear of the first
        graph.setSegmentStyle(styled, {
            lineStyle: { preset: 'bridge', width: 2 },
        });
        const saved = JSON.parse(JSON.stringify(graph.serialize()));
        const bySegment = (n: number) =>
            saved.segments.find(
                (s: { segmentNumber: number }) => s.segmentNumber === n
            );
        expect(bySegment(styled).lineStyle).toEqual({
            preset: 'bridge',
            width: 2,
        });
        expect('lineStyle' in bySegment(plain)).toBe(false);

        const loaded = new TrackGraph();
        await loaded.loadFromSerializedData(saved, {
            yieldToFrame: async () => {},
        });
        expect(loaded.getTrackSegmentWithJoints(styled)!.lineStyle).toEqual({
            preset: 'bridge',
            width: 2,
        });
        expect(
            loaded.getTrackSegmentWithJoints(plain)!.lineStyle
        ).toBeUndefined();
        expect(
            TrackCurveManager.deserialize(
                saved.segments
            ).getTrackSegmentWithJoints(styled)!.lineStyle
        ).toEqual({ preset: 'bridge', width: 2 });
    });
});

describe('validateSerializedTrackData lineStyle', () => {
    it('accepts a full style and an empty one', () => {
        for (const ok of [
            {
                preset: 'bridge',
                pattern: 'dash-dot',
                color: 0xffffff,
                width: 8,
            },
            {},
        ]) {
            expect(validateSerializedTrackData(withLineStyle(ok))).toEqual({
                valid: true,
            });
        }
    });

    it('rejects each bad field with its own message', () => {
        const cases: [unknown, string][] = [
            ['x', 'segments[0].lineStyle must be an object'],
            [null, 'segments[0].lineStyle must be an object'],
            [[], 'segments[0].lineStyle must be an object'],
            [
                { preset: 'viaduct' },
                'segments[0].lineStyle.preset must be one of tunnel, bridge, planned, disused',
            ],
            [
                { pattern: 'wavy' },
                'segments[0].lineStyle.pattern must be one of solid, dashed, dotted, dash-dot',
            ],
            ...[-1, 0x1000000, 1.5, 'red'].map(
                color =>
                    [
                        { color },
                        'segments[0].lineStyle.color must be an integer from 0 to 0xFFFFFF',
                    ] as [unknown, string]
            ),
            ...[0.5, 9, '2'].map(
                width =>
                    [
                        { width },
                        'segments[0].lineStyle.width must be a number from 1 to 8',
                    ] as [unknown, string]
            ),
        ];
        for (const [value, error] of cases) {
            expect(validateSerializedTrackData(withLineStyle(value))).toEqual({
                valid: false,
                error,
            });
        }
    });
});

it('splitting a segment keeps its line style on both halves', () => {
    const graph = new TrackGraph();
    const n = layStraight(graph);
    graph.setSegmentStyle(n, { lineStyle: { preset: 'planned' } });
    const splits: SegmentSplitInfo[] = [];
    graph.onSegmentSplit(info => splits.push(info));
    graph.insertJointIntoTrackSegmentUsingTrackNumber(n, 0.5);
    for (const half of [
        splits[0]!.firstNewSegment,
        splits[0]!.secondNewSegment,
    ]) {
        expect(graph.getTrackSegmentWithJoints(half)!.lineStyle).toEqual({
            preset: 'planned',
        });
    }
});
