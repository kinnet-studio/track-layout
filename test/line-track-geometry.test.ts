import { BCurve } from '@ue-too/curve';
import { describe, expect, it } from 'bun:test';

import {
    type LineStroke,
    type LineTrackInput,
    buildLineTrack,
    lightenColor,
    patternIntervals,
    resolveLineStyle,
    sampleLine,
} from '../src/pixi/line-track-geometry.js';

const STRAIGHT = new BCurve([
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 100, y: 0 },
]);
const P = 1.067 / 2 + 1.5;
const W = 1.5 * Math.SQRT1_2; // a mark's reach along and across the track
const input = (o: Partial<LineTrackInput> = {}): LineTrackInput => ({
    samples: sampleLine(STRAIGHT),
    heights: { from: 0, to: 0 },
    gauge: 1.067,
    renderStyle: 'centerline',
    terrain: null,
    metresPerPixel: 1,
    ...o,
});
/** Each stroke's [min x, max x], sorted. */
const xSpans = (strokes: LineStroke[]) =>
    strokes
        .map(
            s =>
                [
                    Math.min(...s.points.map(p => p.x)),
                    Math.max(...s.points.map(p => p.x)),
                ] as const
        )
        .sort((a, b) => a[0] - b[0]);
const expectSpans = (
    actual: readonly (readonly [number, number])[],
    expected: [number, number][]
) => {
    expect(actual).toHaveLength(expected.length);
    actual.forEach(([a, b], i) => {
        expect(a).toBeCloseTo(expected[i]![0], 6);
        expect(b).toBeCloseTo(expected[i]![1], 6);
    });
};
const isPortalAt = (s: LineStroke, x: number) =>
    s.points.length === 4 &&
    Math.abs(s.points[1]!.x - x) < 1e-6 &&
    Math.abs(Math.abs(s.points[1]!.y) - P) < 1e-6;

/** Spans of 6 m dashes every 10 m, from `from` while they start before `to`. */
const dashSpans = (from: number, to: number): [number, number][] => {
    const spans: [number, number][] = [];
    for (let x = from; x < to; x += 10) spans.push([x, x + 6]);
    return spans;
};

const GREY = 0x808080;
const BLACK = 0x000000;

describe('line style', () => {
    it('resolves each preset, with set fields winning', () => {
        expect(resolveLineStyle()).toEqual({
            preset: undefined,
            pattern: 'solid',
            color: 0x000000,
            width: 1,
        });
        expect(resolveLineStyle({ preset: 'tunnel' })).toMatchObject({
            pattern: 'dashed',
            color: 0x000000,
        });
        expect(resolveLineStyle({ preset: 'bridge' })).toMatchObject({
            pattern: 'solid',
            color: 0x000000,
        });
        expect(resolveLineStyle({ preset: 'planned' })).toMatchObject({
            pattern: 'dashed',
            color: 0x000000,
        });
        expect(resolveLineStyle({ preset: 'disused' })).toMatchObject({
            pattern: 'dotted',
            color: 0x999999,
        });
        expect(
            resolveLineStyle({
                preset: 'disused',
                color: 0xff0000,
                pattern: 'dash-dot',
                width: 3,
            })
        ).toMatchObject({
            pattern: 'dash-dot',
            color: 0xff0000,
            width: 3,
        });
    });

    it('lightens a colour per channel', () => {
        expect(lightenColor(0x000000, 0.5)).toBe(0x808080);
        expect(lightenColor(0xff0000, 0.5)).toBe(0xff8080);
        expect(lightenColor(0x999999, 0.5)).toBe(0xcccccc);
        expect(lightenColor(0xffffff, 0.5)).toBe(0xffffff);
    });
});

describe('sampleLine', () => {
    it('samples every 2 m with t, s and the normal', () => {
        const samples = sampleLine(STRAIGHT);
        expect(samples).toHaveLength(51);
        expect(samples[0]!.point.x).toBeCloseTo(0, 9);
        expect(samples[0]!.point.y).toBeCloseTo(0, 9);
        expect(samples[50]!.point.x).toBeCloseTo(100, 9);
        expect(samples[50]!.point.y).toBeCloseTo(0, 9);
        expect(samples[50]!.s).toBeCloseTo(100, 6);
        expect(samples[0]!.t).toBe(0);
        expect(samples[50]!.t).toBe(1);
        samples.forEach((sample, i) => {
            if (i > 0) expect(sample.t).toBeGreaterThan(samples[i - 1]!.t);
            expect(sample.normal.x).toBeCloseTo(0, 9);
            expect(sample.normal.y).toBeCloseTo(1, 9);
        });
    });
});

describe('buildLineTrack', () => {
    it('draws plain track as one solid line', () => {
        const drawing = buildLineTrack(input());
        expect(drawing.strokes).toHaveLength(1);
        expect(drawing.strokes[0]!.color).toBe(BLACK);
        expectSpans(xSpans(drawing.strokes), [[0, 100]]);
        for (const p of drawing.strokes[0]!.points) {
            expect(p.y).toBeCloseTo(0, 9);
        }
        expect(drawing.width).toBe(1);
        expect(drawing.styled).toBe(false);
    });

    it('draws a line along each rail', () => {
        const drawing = buildLineTrack(input({ renderStyle: 'rails' }));
        expect(drawing.strokes).toHaveLength(2);
        const ys = drawing.strokes
            .map(s => s.points[0]!.y)
            .sort((a, b) => a - b);
        expect(ys[0]).toBeCloseTo(-1.067 / 2, 9);
        expect(ys[1]).toBeCloseTo(1.067 / 2, 9);
        for (const stroke of drawing.strokes) {
            for (const p of stroke.points) {
                expect(Math.abs(p.y)).toBeCloseTo(1.067 / 2, 9);
            }
        }
    });

    it('draws underground track as lighter dashes', () => {
        const drawing = buildLineTrack(
            input({ heights: { from: -10, to: -10 } })
        );
        for (const stroke of drawing.strokes) {
            expect(stroke.color).toBe(GREY);
        }
        expectSpans(xSpans(drawing.strokes), dashSpans(0, 100));
        expect(drawing.strokes).toHaveLength(10);
        expect(drawing.styled).toBe(true);
        expect(
            drawing.strokes.some(
                s =>
                    s.points.length === 4 &&
                    Math.abs(Math.abs(s.points[1]!.y) - P) < 1e-6
            )
        ).toBe(false);
    });

    it('splits a ramp at the ground and puts a portal there', () => {
        const drawing = buildLineTrack(
            input({ heights: { from: -10, to: 10 } })
        );
        const grey = drawing.strokes.filter(s => s.color === GREY);
        expectSpans(xSpans(grey), dashSpans(0, 50));
        expect(grey).toHaveLength(5);

        const portals = drawing.strokes.filter(s => isPortalAt(s, 50));
        expect(portals).toHaveLength(1);
        expect(portals[0]!.color).toBe(BLACK);
        const [tipA, , , tipB] = portals[0]!.points;
        const [lower, upper] = [tipA!, tipB!].sort((a, b) => a.y - b.y);
        // The tunnel is toward -x, so the open air, and the wings, face +x.
        expect(lower!.x).toBeCloseTo(50 + W, 6);
        expect(lower!.y).toBeCloseTo(-(P + W), 6);
        expect(upper!.x).toBeCloseTo(50 + W, 6);
        expect(upper!.y).toBeCloseTo(P + W, 6);
        expect(tipA!.y).toBeLessThan(0);

        const black = drawing.strokes.filter(
            s => s.color === BLACK && !isPortalAt(s, 50)
        );
        expectSpans(xSpans(black), [[50, 100]]);
        expect(drawing.strokes).toHaveLength(7);
    });

    it('uses the terrain', () => {
        const buried = buildLineTrack(
            input({ terrain: { getHeight: () => 5 } })
        );
        expect(buried.strokes.every(s => s.color === GREY)).toBe(true);
        expectSpans(xSpans(buried.strokes), dashSpans(0, 100));

        const hill = buildLineTrack(
            input({ terrain: { getHeight: x => x / 10 - 2 } })
        );
        const grey = hill.strokes.filter(s => s.color === GREY);
        expectSpans(xSpans(grey), dashSpans(20, 100));
        const portals = hill.strokes.filter(s => isPortalAt(s, 20));
        expect(portals).toHaveLength(1);
        const [tipA, , , tipB] = portals[0]!.points;
        // The open air is toward -x.
        expect(tipA!.x).toBeCloseTo(20 - W, 6);
        expect(tipB!.x).toBeCloseTo(20 - W, 6);
        expect(tipA!.y).toBeCloseTo(-(P + W), 6);
        expect(tipB!.y).toBeCloseTo(P + W, 6);
        const black = hill.strokes.filter(
            s => s.color === BLACK && !isPortalAt(s, 20)
        );
        expectSpans(xSpans(black), [[0, 20]]);
    });

    it('scales patterns with zoom and width', () => {
        const zoomed = buildLineTrack(
            input({ heights: { from: -10, to: -10 }, metresPerPixel: 0.5 })
        );
        const zoomedSpans = xSpans(zoomed.strokes);
        expect(zoomedSpans[0]![0]).toBeCloseTo(0, 6);
        expect(zoomedSpans[0]![1]).toBeCloseTo(3, 6);
        expect(zoomedSpans[1]![0]).toBeCloseTo(5, 6);
        expect(zoomedSpans[1]![1]).toBeCloseTo(8, 6);

        const wide = buildLineTrack(
            input({
                heights: { from: -10, to: -10 },
                lineStyle: { width: 3 },
            })
        );
        const wideSpans = xSpans(wide.strokes);
        expect(wideSpans[0]![0]).toBeCloseTo(0, 6);
        expect(wideSpans[0]![1]).toBeCloseTo(18, 6);
        expect(wideSpans[1]![0]).toBeCloseTo(30, 6);
        expect(wideSpans[1]![1]).toBeCloseTo(48, 6);
        expect(wide.width).toBe(3);
        expect(wide.styled).toBe(true);
    });

    it('draws an underground solid line dashed, and a set pattern as it is', () => {
        const solid = buildLineTrack(
            input({
                heights: { from: -10, to: -10 },
                lineStyle: { pattern: 'solid' },
            })
        );
        expectSpans(xSpans(solid.strokes), dashSpans(0, 100));

        const dotted = buildLineTrack(
            input({
                heights: { from: -10, to: -10 },
                lineStyle: { pattern: 'dotted' },
            })
        );
        const dots = xSpans(dotted.strokes);
        expect(dots[0]![0]).toBeCloseTo(0, 6);
        expect(dots[0]![1]).toBeCloseTo(1.5, 6);
        expect(dots[1]![0]).toBeCloseTo(4.5, 6);
        expect(dots[1]![1]).toBeCloseTo(6, 6);
    });

    it('draws a tunnel preset as underground wherever it is', () => {
        const drawing = buildLineTrack(
            input({ lineStyle: { preset: 'tunnel' } })
        );
        expect(drawing.strokes.every(s => s.color === GREY)).toBe(true);
        expectSpans(xSpans(drawing.strokes), dashSpans(0, 100));
        expect(
            drawing.strokes.some(
                s =>
                    s.points.length === 4 &&
                    Math.abs(Math.abs(s.points[1]!.y) - P) < 1e-6
            )
        ).toBe(false);
    });
});

describe('patternIntervals', () => {
    it('keeps the pattern phase from the segment start', () => {
        expect(patternIntervals(52, 70, [6, 4])).toEqual([
            [52, 56],
            [60, 66],
        ]);
        expect(patternIntervals(0, 31, [8, 3, 1.5, 3])).toEqual([
            [0, 8],
            [11, 12.5],
            [15.5, 23.5],
            [26.5, 28],
        ]);
        expect(patternIntervals(3, 9, [])).toEqual([[3, 9]]);
    });

    it('caps the repeats on a very long interval', () => {
        const intervals = patternIntervals(0, 1000, [0.006, 0.004]);
        expect(intervals).toHaveLength(4000);
        expect(intervals[0]![0]).toBeCloseTo(0, 9);
        expect(intervals[0]![1]).toBeCloseTo(0.15, 9);
        expect(intervals[intervals.length - 1]![1]).toBeLessThanOrEqual(1000);
    });
});
