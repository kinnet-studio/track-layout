import { BCurve } from '@ue-too/curve';
import { describe, expect, it } from 'bun:test';

import {
    type CrossingMark,
    type CrossingSide,
    type LineStroke,
    type LineTrackInput,
    buildLineTrack,
    carrySpan,
    classifyCrossing,
    crossingMark,
    lightenColor,
    markSpan,
    needsRunEndMark,
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
/** Marks on a 100 m segment, as the spans `buildLineTrack` takes. */
const spans = (...marks: CrossingMark[]) =>
    marks.map(mark => markSpan(mark, 100).span);
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

const V = new BCurve([
    { x: 50, y: -50 },
    { x: 50, y: 0 },
    { x: 50, y: 50 },
]);
/** A straight track through (50, 0) at `deg` degrees to STRAIGHT. */
const at = (deg: number) => {
    const r = (deg * Math.PI) / 180;
    const [c, s] = [Math.cos(r), Math.sin(r)];
    return new BCurve([
        { x: 50 - 50 * c, y: -50 * s },
        { x: 50, y: 0 },
        { x: 50 + 50 * c, y: 50 * s },
    ]);
};
const side = (
    curve: BCurve,
    height: number,
    o: Partial<CrossingSide> = {}
): CrossingSide => ({
    curve,
    t: 0.5,
    gauge: 1.067,
    heights: { from: height, to: height },
    ...o,
});
/** The strokes that run along a parapet: those with a point at ±P. */
const parapets = (strokes: LineStroke[]) =>
    strokes.filter(s => s.points.some(p => Math.abs(Math.abs(p.y) - P) < 1e-6));
const expectPoint = (
    actual: { x: number; y: number } | undefined,
    x: number,
    y: number
) => {
    expect(actual!.x).toBeCloseTo(x, 6);
    expect(actual!.y).toBeCloseTo(y, 6);
};

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

    it('puts a ground crossing between two samples at the interpolated point', () => {
        // The height crosses 0 at t = 10 / 22, between the samples at x = 44 and 46.
        const drawing = buildLineTrack(
            input({ heights: { from: -10, to: 12 } })
        );
        const x = 1000 / 22;
        const portals = drawing.strokes.filter(s => isPortalAt(s, x));
        expect(portals).toHaveLength(1);
        expect(portals[0]!.color).toBe(BLACK);
        const black = drawing.strokes.filter(
            s => s.color === BLACK && !isPortalAt(s, x)
        );
        expectSpans(xSpans(black), [[x, 100]]);
        // The last dash, [40, 46], stops at the crossing.
        const grey = drawing.strokes.filter(s => s.color === GREY);
        expectSpans(xSpans(grey), [...dashSpans(0, 40), [40, x]]);
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

describe('classifyCrossing', () => {
    it('classifies crossings', () => {
        expect(classifyCrossing(side(STRAIGHT, 0), side(V, 10), null)).toBe(
            'under'
        );
        expect(classifyCrossing(side(V, 10), side(STRAIGHT, 0), null)).toBe(
            'over'
        );
        expect(classifyCrossing(side(STRAIGHT, 0), side(V, 2), null)).toBe(
            'level'
        );
        expect(classifyCrossing(side(STRAIGHT, -10), side(V, 0), null)).toBe(
            'buried'
        );
        const tunnel = { preset: 'tunnel' } as const;
        expect(
            classifyCrossing(
                side(V, 10, { lineStyle: tunnel }),
                side(STRAIGHT, 0),
                null
            )
        ).toBe('buried');
        expect(
            classifyCrossing(
                side(STRAIGHT, 0),
                side(V, 10, { lineStyle: tunnel }),
                null
            )
        ).toBe('buried');
        const ground = { getHeight: () => 5 };
        expect(classifyCrossing(side(STRAIGHT, 0), side(V, 10), ground)).toBe(
            'buried'
        );
        const ramp = side(STRAIGHT, 0, { heights: { from: 0, to: 20 } });
        expect(classifyCrossing(ramp, side(V, 10), null)).toBe('level');
    });

    it('needs the full vertical clearance to separate a crossing', () => {
        expect(classifyCrossing(side(STRAIGHT, 0), side(V, 2.9), null)).toBe(
            'level'
        );
        expect(classifyCrossing(side(STRAIGHT, 0), side(V, 3), null)).toBe(
            'under'
        );
        expect(classifyCrossing(side(V, 3), side(STRAIGHT, 0), null)).toBe(
            'over'
        );
    });
});

describe('crossingMark', () => {
    it('sizes a deck and a gap at 90°', () => {
        const deck = crossingMark(
            side(V, 10),
            side(STRAIGHT, 0, { gauge: 1.435 }),
            null,
            'centerline'
        );
        expect(deck!.kind).toBe('deck');
        expect(deck!.s).toBeCloseTo(50, 6);
        expect(deck!.halfLength).toBeCloseTo(1.435 / 2 + 1.5, 6);

        for (const renderStyle of ['centerline', 'rails'] as const) {
            const gap = crossingMark(
                side(STRAIGHT, 0),
                side(V, 10),
                null,
                renderStyle
            );
            expect(gap!.kind).toBe('gap');
            expect(gap!.s).toBeCloseTo(50, 6);
            expect(gap!.halfLength).toBeCloseTo(P + 0.5, 6);
        }
    });

    it('sizes a deck and a gap at 30°, and caps a shallow one', () => {
        const deck = crossingMark(
            side(at(30), 10),
            side(STRAIGHT, 0),
            null,
            'centerline'
        );
        expect(deck!.kind).toBe('deck');
        expect(deck!.halfLength).toBeCloseTo(
            (1.067 / 2 + 1.5) / 0.5 + P * Math.sqrt(3),
            6
        );

        const gap = crossingMark(
            side(STRAIGHT, 0),
            side(at(30), 10),
            null,
            'rails'
        );
        expect(gap!.kind).toBe('gap');
        expect(gap!.halfLength).toBeCloseTo(
            (P + 0.5) / 0.5 + (1.067 / 2) * Math.sqrt(3),
            6
        );

        const shallowDeck = crossingMark(
            side(at(1), 10),
            side(STRAIGHT, 0),
            null,
            'centerline'
        );
        const shallowGap = crossingMark(
            side(STRAIGHT, 0),
            side(at(1), 10),
            null,
            'centerline'
        );
        expect(shallowDeck!.halfLength).toBe(25);
        expect(shallowGap!.halfLength).toBe(25);
    });

    it("measures a gap from the track's outermost line", () => {
        // At 30°, a gap is (P_upper + 0.5) / sin + r * cot, with r the
        // outermost line's offset: 0, g / 2, or P under a bridge preset.
        const cut = (
            renderStyle: 'centerline' | 'rails',
            lineStyle?: CrossingSide['lineStyle']
        ) =>
            crossingMark(
                side(STRAIGHT, 0, { lineStyle }),
                side(at(30), 10),
                null,
                renderStyle
            )!.halfLength;
        const base = (P + 0.5) / 0.5;
        expect(cut('centerline')).toBeCloseTo(base, 6);
        expect(cut('rails')).toBeCloseTo(base + (1.067 / 2) * Math.sqrt(3), 6);
        for (const renderStyle of ['centerline', 'rails'] as const) {
            expect(cut(renderStyle, { preset: 'bridge' })).toBeCloseTo(
                base + P * Math.sqrt(3),
                6
            );
        }
    });

    it('takes each size from the right side when the gauges differ', () => {
        // A deck clears the lower track's gauge and spans its own parapets;
        // a gap clears the upper track's parapets and spans its own rails.
        const deck = crossingMark(
            side(at(30), 10, { gauge: 1.435 }),
            side(STRAIGHT, 0, { gauge: 1.067 }),
            null,
            'centerline'
        );
        expect(deck!.halfLength).toBeCloseTo(
            (1.067 / 2 + 1.5) / 0.5 + (1.435 / 2 + 1.5) * Math.sqrt(3),
            6
        );

        const gap = crossingMark(
            side(STRAIGHT, 0, { gauge: 1.067 }),
            side(at(30), 10, { gauge: 1.435 }),
            null,
            'rails'
        );
        expect(gap!.halfLength).toBeCloseTo(
            (1.435 / 2 + 1.5 + 0.5) / 0.5 + (1.067 / 2) * Math.sqrt(3),
            6
        );
    });

    it("leaves level and buried crossings, and a bridge preset's deck, unmarked", () => {
        expect(
            crossingMark(side(V, 2), side(STRAIGHT, 0), null, 'centerline')
        ).toBeNull();
        expect(
            crossingMark(side(V, 10), side(STRAIGHT, -10), null, 'centerline')
        ).toBeNull();
        expect(
            crossingMark(
                side(V, 10, { lineStyle: { preset: 'bridge' } }),
                side(STRAIGHT, 0),
                null,
                'centerline'
            )
        ).toBeNull();

        const gap = crossingMark(
            side(STRAIGHT, 0, { lineStyle: { preset: 'bridge' } }),
            side(V, 10),
            null,
            'centerline'
        );
        expect(gap!.kind).toBe('gap');
        expect(gap!.halfLength).toBeCloseTo(P + 0.5, 6);
    });

    it('takes the gap clearance into crossingMark', () => {
        const under = side(STRAIGHT, 0);
        const over = side(V, 10);
        const gapAt = (clearance?: number) =>
            crossingMark(under, over, null, 'centerline', clearance)!
                .halfLength;
        expect(gapAt(0)).toBeCloseTo(P, 6);
        expect(gapAt(3)).toBeCloseTo(P + 3, 6);
        expect(gapAt()).toBeCloseTo(P + 0.5, 6);
    });
});

describe('needsRunEndMark', () => {
    it('decides run-end marks', () => {
        const tunnel = { preset: 'tunnel' } as const;
        const bridge = { preset: 'bridge' } as const;
        expect(needsRunEndMark(tunnel, false, [])).toBe(true);
        expect(needsRunEndMark(tunnel, false, [{ underground: false }])).toBe(
            true
        );
        expect(
            needsRunEndMark(bridge, false, [
                { lineStyle: undefined, underground: false },
            ])
        ).toBe(true);

        expect(needsRunEndMark(bridge, false, [])).toBe(true);

        expect(needsRunEndMark(tunnel, true, [])).toBe(false);
        expect(needsRunEndMark(tunnel, false, [{ underground: true }])).toBe(
            false
        );
        expect(
            needsRunEndMark(bridge, false, [
                { lineStyle: bridge, underground: false },
            ])
        ).toBe(false);
        expect(needsRunEndMark({ preset: 'planned' }, false, [])).toBe(false);
        expect(needsRunEndMark(undefined, false, [])).toBe(false);
    });
});

describe('buildLineTrack marks', () => {
    it('cuts a gap in every line', () => {
        const gap = { kind: 'gap', s: 50, halfLength: 2.5 } as const;
        const centre = buildLineTrack(input({ marks: spans(gap) }));
        expectSpans(xSpans(centre.strokes), [
            [0, 47.5],
            [52.5, 100],
        ]);

        const rails = buildLineTrack(
            input({ renderStyle: 'rails', marks: spans(gap) })
        );
        expect(rails.strokes).toHaveLength(4);
        for (const sign of [-1, 1]) {
            const own = rails.strokes.filter(
                s => Math.sign(s.points[0]!.y) === sign
            );
            expect(own).toHaveLength(2);
            for (const stroke of own) {
                for (const p of stroke.points) {
                    expect(p.y).toBeCloseTo((sign * 1.067) / 2, 9);
                }
            }
            expectSpans(xSpans(own), [
                [0, 47.5],
                [52.5, 100],
            ]);
        }
    });

    it('clamps a gap to the segment, and merges gaps that overlap', () => {
        const ends = buildLineTrack(
            input({
                marks: spans(
                    { kind: 'gap', s: 1, halfLength: 3 },
                    { kind: 'gap', s: 99, halfLength: 3 }
                ),
            })
        );
        expectSpans(xSpans(ends.strokes), [[4, 96]]);

        const overlapping = buildLineTrack(
            input({
                marks: spans(
                    { kind: 'gap', s: 50, halfLength: 5 },
                    { kind: 'gap', s: 53, halfLength: 5 }
                ),
            })
        );
        expectSpans(xSpans(overlapping.strokes), [
            [0, 45],
            [58, 100],
        ]);
    });

    it('keeps the pattern phase across a gap', () => {
        const drawing = buildLineTrack(
            input({
                lineStyle: { pattern: 'dashed' },
                marks: spans({ kind: 'gap', s: 50, halfLength: 2.5 }),
            })
        );
        // The dash that starts at 50 is cut to start at 52.5; none restart.
        expectSpans(xSpans(drawing.strokes), [
            ...dashSpans(0, 50),
            [52.5, 56],
            ...dashSpans(60, 100),
        ]);
    });

    it('draws a deck as parapets with wings', () => {
        const drawing = buildLineTrack(
            input({ marks: spans({ kind: 'deck', s: 50, halfLength: 3 }) })
        );
        expect(drawing.strokes).toHaveLength(3);
        expect(drawing.strokes.every(s => s.color === BLACK)).toBe(true);
        const line = drawing.strokes.filter(s => !parapets([s]).length);
        expectSpans(xSpans(line), [[0, 100]]);

        const rails = parapets(drawing.strokes);
        expect(rails).toHaveLength(2);
        for (const sign of [-1, 1]) {
            const rail = rails.find(s => Math.sign(s.points[1]!.y) === sign)!;
            expectPoint(rail.points[0], 47 - W, sign * (P + W));
            expectPoint(rail.points[1], 47, sign * P);
            expectPoint(rail.points.at(-2), 53, sign * P);
            expectPoint(rail.points.at(-1), 53 + W, sign * (P + W));
        }
    });

    it('puts a deck on top of the rails', () => {
        const drawing = buildLineTrack(
            input({
                renderStyle: 'rails',
                marks: spans({ kind: 'deck', s: 50, halfLength: 3 }),
            })
        );
        expect(drawing.strokes).toHaveLength(4);
        expect(parapets(drawing.strokes)).toHaveLength(2);
    });

    it('clamps a deck at the segment end, with no wing there', () => {
        const drawing = buildLineTrack(
            input({ marks: spans({ kind: 'deck', s: 1, halfLength: 3 }) })
        );
        const rails = parapets(drawing.strokes);
        expect(rails).toHaveLength(2);
        for (const sign of [-1, 1]) {
            const rail = rails.find(s => Math.sign(s.points[0]!.y) === sign)!;
            expectPoint(rail.points[0], 0, sign * P);
            expectPoint(rail.points.at(-1), 4 + W, sign * (P + W));
        }

        const far = buildLineTrack(
            input({ marks: spans({ kind: 'deck', s: 99, halfLength: 3 }) })
        );
        for (const sign of [-1, 1]) {
            const rail = parapets(far.strokes).find(
                s => Math.sign(s.points[1]!.y) === sign
            )!;
            expectPoint(rail.points[0], 96 - W, sign * (P + W));
            expectPoint(rail.points.at(-1), 100, sign * P);
        }
    });

    it("draws a bridge preset's parapets along the whole segment", () => {
        const bridge = { preset: 'bridge' } as const;
        const winged = buildLineTrack(
            input({
                lineStyle: bridge,
                runEnds: { start: true, end: true },
            })
        );
        expect(winged.strokes).toHaveLength(3);
        const wingedRails = parapets(winged.strokes);
        expect(wingedRails).toHaveLength(2);
        for (const sign of [-1, 1]) {
            const rail = wingedRails.find(
                s => Math.sign(s.points[1]!.y) === sign
            )!;
            expectPoint(rail.points[0], -W, sign * (P + W));
            expectPoint(rail.points[1], 0, sign * P);
            expectPoint(rail.points.at(-2), 100, sign * P);
            expectPoint(rail.points.at(-1), 100 + W, sign * (P + W));
        }

        const plain = buildLineTrack(
            input({
                lineStyle: bridge,
                runEnds: { start: false, end: false },
            })
        );
        for (const sign of [-1, 1]) {
            const rail = parapets(plain.strokes).find(
                s => Math.sign(s.points[0]!.y) === sign
            )!;
            expectPoint(rail.points[0], 0, sign * P);
            expectPoint(rail.points.at(-1), 100, sign * P);
        }

        // Without `runEnds`, neither end gets a wing.
        const open = buildLineTrack(input({ lineStyle: bridge }));
        expect(parapets(open.strokes)).toHaveLength(2);
        for (const sign of [-1, 1]) {
            const rail = parapets(open.strokes).find(
                s => Math.sign(s.points[0]!.y) === sign
            )!;
            expectPoint(rail.points[0], 0, sign * P);
            expectPoint(rail.points.at(-1), 100, sign * P);
        }

        const cut = buildLineTrack(
            input({
                lineStyle: bridge,
                runEnds: { start: true, end: true },
                marks: spans({ kind: 'gap', s: 50, halfLength: 2.5 }),
            })
        );
        const pieces = parapets(cut.strokes);
        expect(pieces).toHaveLength(4);
        for (const sign of [-1, 1]) {
            const own = pieces
                .filter(s => Math.sign(s.points[1]!.y) === sign)
                .sort((a, b) => a.points[0]!.x - b.points[0]!.x);
            expect(own).toHaveLength(2);
            expectPoint(own[0]!.points[0], -W, sign * (P + W));
            expectPoint(own[0]!.points.at(-1), 47.5, sign * P);
            expectPoint(own[1]!.points[0], 52.5, sign * P);
            expectPoint(own[1]!.points.at(-1), 100 + W, sign * (P + W));
        }
    });

    it("keeps a bridge preset's wings where a gap takes the end of its parapets", () => {
        const drawing = buildLineTrack(
            input({
                lineStyle: { preset: 'bridge' },
                runEnds: { start: true, end: true },
                marks: spans({ kind: 'gap', s: 1, halfLength: 3 }),
            })
        );
        // The gap, [0, 4], cuts the start of each parapet and its wing's root.
        // The wing is drawn alone; the end wing is still part of its parapet.
        const strokes = parapets(drawing.strokes);
        const wings = strokes.filter(s => s.points.length === 2);
        const rails = strokes.filter(s => s.points.length > 2);
        expect(wings).toHaveLength(2);
        expect(rails).toHaveLength(2);
        for (const sign of [-1, 1]) {
            const wing = wings.find(s => Math.sign(s.points[0]!.y) === sign)!;
            expect(wing.color).toBe(BLACK);
            expectPoint(wing.points[0], 0, sign * P);
            expectPoint(wing.points[1], -W, sign * (P + W));

            const rail = rails.find(s => Math.sign(s.points[0]!.y) === sign)!;
            expectPoint(rail.points[0], 4, sign * P);
            expectPoint(rail.points.at(-2), 100, sign * P);
            expectPoint(rail.points.at(-1), 100 + W, sign * (P + W));
        }

        const far = buildLineTrack(
            input({
                lineStyle: { preset: 'bridge' },
                runEnds: { start: true, end: true },
                marks: spans({ kind: 'gap', s: 99, halfLength: 3 }),
            })
        );
        const farWings = parapets(far.strokes).filter(
            s => s.points.length === 2
        );
        expect(farWings).toHaveLength(2);
        for (const sign of [-1, 1]) {
            const wing = farWings.find(
                s => Math.sign(s.points[0]!.y) === sign
            )!;
            expectPoint(wing.points[0], 100, sign * P);
            expectPoint(wing.points[1], 100 + W, sign * (P + W));
            const rail = parapets(far.strokes).find(
                s => s.points.length > 2 && Math.sign(s.points[1]!.y) === sign
            )!;
            expectPoint(rail.points[0], -W, sign * (P + W));
            expectPoint(rail.points.at(-1), 96, sign * P);
        }

        // Only the ends asked for get a wing.
        const none = buildLineTrack(
            input({
                lineStyle: { preset: 'bridge' },
                runEnds: { start: false, end: false },
                marks: spans({ kind: 'gap', s: 1, halfLength: 3 }),
            })
        );
        expect(parapets(none.strokes).every(s => s.points.length > 2)).toBe(
            true
        );
    });

    it('draws a gap over a whole segment as wings alone', () => {
        const drawing = buildLineTrack(
            input({
                lineStyle: { preset: 'bridge' },
                runEnds: { start: true, end: true },
                marks: spans({ kind: 'gap', s: 50, halfLength: 60 }),
            })
        );
        expect(drawing.strokes).toHaveLength(4);
        expect(drawing.strokes.every(s => s.points.length === 2)).toBe(true);
    });

    it('merges decks that overlap into one, with wings at its outer ends', () => {
        const drawing = buildLineTrack(
            input({
                marks: spans(
                    { kind: 'deck', s: 52, halfLength: 2.2 },
                    { kind: 'deck', s: 48, halfLength: 2.2 }
                ),
            })
        );
        const rails = parapets(drawing.strokes);
        expect(rails).toHaveLength(2);
        expect(drawing.strokes).toHaveLength(3);
        for (const sign of [-1, 1]) {
            const rail = rails.find(s => Math.sign(s.points[1]!.y) === sign)!;
            expectPoint(rail.points[0], 45.8 - W, sign * (P + W));
            expectPoint(rail.points[1], 45.8, sign * P);
            expectPoint(rail.points.at(-2), 54.2, sign * P);
            expectPoint(rail.points.at(-1), 54.2 + W, sign * (P + W));
        }
        expectSpans(xSpans(rails), [
            [45.8 - W, 54.2 + W],
            [45.8 - W, 54.2 + W],
        ]);
    });

    it('keeps decks that are apart separate, and merges touching ones', () => {
        const apart = buildLineTrack(
            input({
                marks: spans(
                    { kind: 'deck', s: 30, halfLength: 3 },
                    { kind: 'deck', s: 60, halfLength: 3 }
                ),
            })
        );
        expect(parapets(apart.strokes)).toHaveLength(4);

        const touching = buildLineTrack(
            input({
                marks: spans(
                    { kind: 'deck', s: 47, halfLength: 3 },
                    { kind: 'deck', s: 53, halfLength: 3 }
                ),
            })
        );
        const rails = parapets(touching.strokes);
        expect(rails).toHaveLength(2);
        expectPoint(rails[0]!.points[0], 44 - W, rails[0]!.points[0]!.y);
        expectPoint(
            rails[0]!.points.at(-1),
            56 + W,
            rails[0]!.points.at(-1)!.y
        );
    });

    it('merges decks only up to the segment end, with no wing there', () => {
        const drawing = buildLineTrack(
            input({
                marks: spans(
                    { kind: 'deck', s: 1, halfLength: 3 },
                    { kind: 'deck', s: 5, halfLength: 3 }
                ),
            })
        );
        const rails = parapets(drawing.strokes);
        expect(rails).toHaveLength(2);
        for (const sign of [-1, 1]) {
            const rail = rails.find(s => Math.sign(s.points[0]!.y) === sign)!;
            expectPoint(rail.points[0], 0, sign * P);
            expectPoint(rail.points.at(-1), 8 + W, sign * (P + W));
        }
    });

    it('draws marks in the colour of the part of the line they sit on', () => {
        const drawing = buildLineTrack(
            input({
                heights: { from: -10, to: 10 },
                lineStyle: { preset: 'bridge' },
                runEnds: { start: true, end: true },
            })
        );
        const rails = parapets(drawing.strokes).filter(s => !isPortalAt(s, 50));
        expect(rails).toHaveLength(4);
        for (const rail of rails) {
            const mid = rail.points[2]!;
            expect(rail.color).toBe(mid.x < 50 ? GREY : BLACK);
        }
        const [first] = rails
            .filter(s => s.color === GREY)
            .sort((a, b) => a.points[0]!.x - b.points[0]!.x);
        // The start wing is part of the lighter parapet it begins.
        expect(first!.points[0]!.x).toBeCloseTo(-W, 6);
    });

    it("puts a tunnel preset's portals at the run ends asked for", () => {
        const tunnel = { preset: 'tunnel' } as const;
        const start = buildLineTrack(
            input({
                lineStyle: tunnel,
                runEnds: { start: true, end: false },
            })
        );
        const black = start.strokes.filter(s => s.color === BLACK);
        expect(black).toHaveLength(1);
        expect(isPortalAt(black[0]!, 0)).toBe(true);
        const [tipA, , , tipB] = black[0]!.points;
        expectPoint(tipA, -W, -(P + W));
        expectPoint(tipB, -W, P + W);
        expect(start.strokes.filter(s => s.color === GREY).length).toBe(10);

        const end = buildLineTrack(
            input({ lineStyle: tunnel, runEnds: { start: false, end: true } })
        );
        const endPortals = end.strokes.filter(s => s.color === BLACK);
        expect(endPortals).toHaveLength(1);
        expect(isPortalAt(endPortals[0]!, 100)).toBe(true);
        expectPoint(endPortals[0]!.points[0], 100 + W, -(P + W));
        expectPoint(endPortals[0]!.points[3], 100 + W, P + W);

        const both = buildLineTrack(
            input({ lineStyle: tunnel, runEnds: { start: true, end: true } })
        );
        expect(both.strokes.filter(s => s.color === BLACK)).toHaveLength(2);
    });

    it('ignores run ends for a segment with neither preset', () => {
        const onCentre = (strokes: LineStroke[]) =>
            strokes.every(s => s.points.every(p => Math.abs(p.y) < 1e-9));
        const plain = buildLineTrack(
            input({ runEnds: { start: true, end: true } })
        );
        expect(plain.strokes).toHaveLength(1);
        expect(onCentre(plain.strokes)).toBe(true);

        const planned = buildLineTrack(
            input({
                lineStyle: { preset: 'planned' },
                runEnds: { start: true, end: true },
            })
        );
        expectSpans(xSpans(planned.strokes), dashSpans(0, 100));
        expect(onCentre(planned.strokes)).toBe(true);
    });
});

describe('markSpan', () => {
    it('keeps a mark inside the segment whole, with wings at both ends', () => {
        expect(markSpan({ kind: 'deck', s: 50, halfLength: 3 }, 100)).toEqual({
            span: {
                kind: 'deck',
                from: 47,
                to: 53,
                wings: { start: true, end: true },
            },
            overflow: { start: 0, end: 0 },
        });
    });

    it('clamps a mark past either end and reports the overflow, with no wing there', () => {
        const atStart = markSpan({ kind: 'deck', s: 1, halfLength: 3 }, 100);
        expect(atStart.span).toMatchObject({
            from: 0,
            to: 4,
            wings: { start: false, end: true },
        });
        expect(atStart.overflow.start).toBeCloseTo(2, 9);
        const atEnd = markSpan({ kind: 'gap', s: 99, halfLength: 3 }, 100);
        expect(atEnd.span).toMatchObject({ from: 96, to: 100 });
        expect(atEnd.overflow.end).toBeCloseTo(2, 9);
    });
});

describe('carrySpan', () => {
    it('carries an overflow onto the start or end of a neighbour, with a wing at the far side', () => {
        expect(carrySpan('deck', 2, 100, 'start')).toEqual({
            span: {
                kind: 'deck',
                from: 0,
                to: 2,
                wings: { start: false, end: true },
            },
            remaining: 0,
        });
        expect(carrySpan('deck', 2, 100, 'end')).toEqual({
            span: {
                kind: 'deck',
                from: 98,
                to: 100,
                wings: { start: true, end: false },
            },
            remaining: 0,
        });
    });

    it('covers a neighbour shorter than the overflow and passes the rest on, with no far wing', () => {
        expect(carrySpan('gap', 7, 5, 'start')).toEqual({
            span: {
                kind: 'gap',
                from: 0,
                to: 5,
                wings: { start: false, end: false },
            },
            remaining: 2,
        });
    });
});

describe('buildLineTrack with spans', () => {
    it('cuts a gap span that starts at the segment start from 0', () => {
        const drawing = buildLineTrack(
            input({
                marks: [
                    {
                        kind: 'gap',
                        from: 0,
                        to: 2,
                        wings: { start: false, end: false },
                    },
                ],
            })
        );
        expectSpans(xSpans(drawing.strokes), [[2, 100]]);
    });

    it('draws no wing where a deck span says so', () => {
        const drawing = buildLineTrack(
            input({
                marks: [
                    {
                        kind: 'deck',
                        from: 0,
                        to: 4,
                        wings: { start: false, end: true },
                    },
                ],
            })
        );
        const parapets = drawing.strokes.filter(
            s => Math.abs(Math.abs(s.points[1]!.y) - P) < 1e-6
        );
        expect(parapets).toHaveLength(2);
        for (const p of parapets) {
            expect(p.points[0]!.x).toBeCloseTo(0, 6);
            expect(p.points.at(-1)!.x).toBeCloseTo(4 + W, 6);
        }
    });

    it('merges an own and a carried deck span, keeping their outer wing flags', () => {
        const drawing = buildLineTrack(
            input({
                marks: [
                    {
                        kind: 'deck',
                        from: 95,
                        to: 100,
                        wings: { start: true, end: false },
                    },
                    {
                        kind: 'deck',
                        from: 97,
                        to: 100,
                        wings: { start: false, end: false },
                    },
                ],
            })
        );
        const parapets = drawing.strokes.filter(
            s => Math.abs(Math.abs(s.points[1]!.y) - P) < 1e-6
        );
        expect(parapets).toHaveLength(2);
        for (const p of parapets) {
            expect(p.points[0]!.x).toBeCloseTo(95 - W, 6);
            expect(p.points.at(-1)!.x).toBeCloseTo(100, 6);
        }
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
