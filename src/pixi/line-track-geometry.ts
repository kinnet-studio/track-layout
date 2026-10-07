import type { BCurve } from '@ue-too/curve';
import { type Point, PointCal } from '@ue-too/math';

import { VERTICAL_CLEARANCE } from '../index.js';
import type { LinePattern, LinePreset, TrackLineStyle } from '../index.js';
import type { TerrainSampler } from './tunnel-geometry.js';

/**
 * Geometry for the `centerline` and `rails` render styles, as plain data: a
 * segment's samples go in, coloured polylines come out. Nothing here touches
 * Pixi, so the renderer only has to stroke what it is given.
 */

/** Arc length (metres) between the samples of a line-style segment. */
export const LINE_TRACK_SAMPLE_LEN = 2;

/** Metres from the outer rail to a parapet or portal bar. */
export const PARAPET_MARGIN = 1.5;

/** Length (metres) of the angled wing at each end of a portal or deck mark. */
export const MARK_LENGTH = 1.5;

/** Angle (radians) between a mark's wing and the track. */
export const MARK_ANGLE = Math.PI / 4;

/** Metres of clearance on each side of a crossing track's deck. */
export const DECK_CLEARANCE = 1.5;

/**
 * The default for the renderer's `bridgeGapClearance`: how far (metres) a gap
 * cut in a track below a deck reaches past the upper track's parapets.
 */
export const GAP_CLEARANCE = 0.5;

/**
 * The most space (metres) between the inner parapets of two decks side by side
 * over the same track for them to be drawn as one bridge.
 */
export const SHARED_BRIDGE_SPACE = 2;

/**
 * Two tracks whose crossings of the same lower track are closer than this
 * (metres) meet over it, at a junction or a crossing on the bridge. Which side
 * of each faces the other isn't defined there, so they keep their own decks.
 */
export const SHARED_BRIDGE_MIN_APART = 0.5;

/**
 * A crossing mark never reaches further than this (metres) from its track, so
 * it is also how far the renderer walks along the joints to carry a mark onto
 * the next segments, and the most `bridgeGapClearance` can be.
 */
export const MAX_MARK_HALF_LENGTH = 25;

/** How far underground track is mixed toward white, from 0 to 1. */
export const UNDERGROUND_LIGHTEN = 0.5;

/** The renderer re-strokes patterned lines when the zoom has moved by this factor. */
export const RESTROKE_ZOOM_STEP = Math.SQRT2;

/** A line interval is never cut into more pattern repeats than this. */
export const MAX_PATTERN_REPEATS = 4000;

/** Intervals shorter than this (metres) are floating-point leftovers, not marks. */
const EMPTY_INTERVAL = 1e-9;

/** Tracks crossing at a sine of the angle below this count as parallel. */
const PARALLEL_SIN = 1e-6;

/**
 * Pattern lengths in screen pixels at width 1: on, off, on, off... A solid
 * line has none.
 */
export const PATTERN_PX: Record<LinePattern, readonly number[]> = {
    solid: [],
    dashed: [6, 4],
    dotted: [1.5, 3],
    'dash-dot': [8, 3, 1.5, 3],
};

/** What a preset sets before the style's own fields are applied. */
const PRESET_LOOK: Record<LinePreset, { pattern: LinePattern; color: number }> =
    {
        tunnel: { pattern: 'dashed', color: 0x000000 },
        bridge: { pattern: 'solid', color: 0x000000 },
        planned: { pattern: 'dashed', color: 0x000000 },
        disused: { pattern: 'dotted', color: 0x999999 },
    };

const DEFAULT_LOOK = { pattern: 'solid', color: 0x000000 } as const;

export type ResolvedLineStyle = {
    preset: LinePreset | undefined;
    pattern: LinePattern;
    /** 0xRRGGBB. */
    color: number;
    /** Screen pixels. */
    width: number;
};

/** Apply the preset, then any field set on the style itself. */
export function resolveLineStyle(style?: TrackLineStyle): ResolvedLineStyle {
    const preset = style?.preset;
    const look = preset === undefined ? DEFAULT_LOOK : PRESET_LOOK[preset];
    return {
        preset,
        pattern: style?.pattern ?? look.pattern,
        color: style?.color ?? look.color,
        width: style?.width ?? 1,
    };
}

/** Mix each channel of a 0xRRGGBB colour `amount` (0 to 1) of the way to white. */
export function lightenColor(color: number, amount: number): number {
    const lighten = (channel: number) =>
        Math.round(channel + (255 - channel) * amount);
    return (
        (lighten((color >> 16) & 0xff) << 16) |
        (lighten((color >> 8) & 0xff) << 8) |
        lighten(color & 0xff)
    );
}

/** Distance (metres) from the track's centre line to a parapet or portal bar. */
export function parapetOffset(gauge: number): number {
    return gauge / 2 + PARAPET_MARGIN;
}

export type LineSample = {
    point: Point;
    /** Unit tangent. */
    tangent: Point;
    /** Unit normal, the tangent turned a quarter turn toward +y. */
    normal: Point;
    /** Bezier parameter, from 0 to 1. */
    t: number;
    /** Arc length from the start of the segment, in metres. */
    s: number;
};

/**
 * Samples along `curve`, uniform in Bezier `t` with about one every
 * {@link LINE_TRACK_SAMPLE_LEN} metres. The end samples sit exactly on the
 * curve's first and last control points.
 */
export function sampleLine(curve: BCurve): LineSample[] {
    const steps = Math.max(
        2,
        Math.ceil(curve.fullLength / LINE_TRACK_SAMPLE_LEN)
    );
    const controlPoints = curve.getControlPoints();
    const samples: LineSample[] = [];
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const point =
            i === 0
                ? controlPoints[0]!
                : i === steps
                  ? controlPoints[controlPoints.length - 1]!
                  : curve.get(t);
        const tangent = PointCal.unitVector(curve.derivative(t));
        samples.push({
            point,
            tangent,
            normal: { x: -tangent.y, y: tangent.x },
            t,
            s: curve.lengthAtT(t),
        });
    }
    return samples;
}

/** Elevations (metres) at the two ends of a segment, at t = 0 and t = 1. */
export type LineHeights = { from: number; to: number };

/** Elevation at Bezier `t`: linear between the ends, as everywhere in the model. */
export function heightAt(heights: LineHeights, t: number): number {
    return heights.from + (heights.to - heights.from) * t;
}

const groundHeight = (point: Point, terrain: TerrainSampler | null): number =>
    terrain?.getHeight(point.x, point.y) ?? 0;

/** Whether the track is below the terrain (or below 0 without one) here. */
export function buriedByTerrain(
    heights: LineHeights,
    t: number,
    point: Point,
    terrain: TerrainSampler | null
): boolean {
    return heightAt(heights, t) < groundHeight(point, terrain);
}

/** Whether the track counts as underground here: a `tunnel` preset, or buried. */
export function isUnderground(
    heights: LineHeights,
    t: number,
    point: Point,
    lineStyle: TrackLineStyle | undefined,
    terrain: TerrainSampler | null
): boolean {
    return (
        lineStyle?.preset === 'tunnel' ||
        buriedByTerrain(heights, t, point, terrain)
    );
}

/**
 * The stretches of [`s0`, `s1`] a pattern draws, as [start, end] arc lengths.
 * `lengths` alternates on, off, on, off... and its cycle starts at s = 0, so
 * the phase doesn't depend on `s0`. No lengths means one solid interval, and an
 * empty span has none. When the span would take more than
 * {@link MAX_PATTERN_REPEATS} cycles, the lengths are scaled up so that it
 * takes exactly that many.
 */
export function patternIntervals(
    s0: number,
    s1: number,
    lengths: readonly number[]
): [number, number][] {
    if (!(s1 > s0)) return [];
    const cycle = lengths.reduce((sum, length) => sum + length, 0);
    if (!(cycle > 0)) return [[s0, s1]];

    const repeats = (s1 - s0) / cycle;
    const scale =
        repeats > MAX_PATTERN_REPEATS ? repeats / MAX_PATTERN_REPEATS : 1;
    const scaled = lengths.map(length => length * scale);
    const period = scaled.reduce((sum, length) => sum + length, 0);

    const intervals: [number, number][] = [];
    for (let k = Math.floor(s0 / period); k * period < s1; k++) {
        let at = k * period;
        scaled.forEach((length, i) => {
            const end = at + length;
            if (i % 2 === 0) {
                const start = Math.max(at, s0);
                const stop = Math.min(end, s1);
                if (stop - start > EMPTY_INTERVAL)
                    intervals.push([start, stop]);
            }
            at = end;
        });
    }
    return intervals;
}

/** One track at a crossing, as that track sees it. */
export type CrossingSide = {
    curve: BCurve;
    /** Bezier parameter of the crossing on `curve`. */
    t: number;
    gauge: number;
    heights: LineHeights;
    lineStyle?: TrackLineStyle;
};

/**
 * What a crossing is to one of its tracks: `level` when the heights are within
 * {@link VERTICAL_CLEARANCE} of each other, `buried` when they aren't but either
 * track is underground there, and otherwise `over` or `under`.
 */
export type CrossingKind = 'level' | 'buried' | 'over' | 'under';

/** Classify the crossing of `self` and `other` from `self`'s side. */
export function classifyCrossing(
    self: CrossingSide,
    other: CrossingSide,
    terrain: TerrainSampler | null
): CrossingKind {
    const difference =
        heightAt(self.heights, self.t) - heightAt(other.heights, other.t);
    if (Math.abs(difference) < VERTICAL_CLEARANCE) return 'level';

    const point = self.curve.get(self.t);
    const buried = (side: CrossingSide) =>
        isUnderground(side.heights, side.t, point, side.lineStyle, terrain);
    if (buried(self) || buried(other)) return 'buried';
    return difference > 0 ? 'over' : 'under';
}

/**
 * A mark on a segment where another track crosses it: a `deck` where this
 * track bridges the other, or a `gap` where it passes under. `s` is the arc
 * length of the crossing and `halfLength` how far the mark reaches each way.
 */
export type CrossingMark = {
    kind: 'deck' | 'gap';
    s: number;
    halfLength: number;
};

/**
 * The mark a crossing puts on `self`, or null when it needs none: a level or
 * buried crossing, or the deck of a `bridge` preset, whose parapets already run
 * the whole segment. A mark is `cot θ` times the offset of its outermost line
 * longer than at a right angle (a deck's parapets, a gap's track lines or
 * parapets), so it still covers a skewed crossing, and it is capped at
 * {@link MAX_MARK_HALF_LENGTH} where the tracks are close to parallel. A gap
 * reaches `gapClearance` metres past the upper track's parapets.
 */
export function crossingMark(
    self: CrossingSide,
    other: CrossingSide,
    terrain: TerrainSampler | null,
    renderStyle: 'centerline' | 'rails',
    gapClearance: number = GAP_CLEARANCE
): CrossingMark | null {
    const kind = classifyCrossing(self, other, terrain);
    if (kind === 'level' || kind === 'buried') return null;
    const bridge = self.lineStyle?.preset === 'bridge';
    if (kind === 'over' && bridge) return null;

    const a = PointCal.unitVector(self.curve.derivative(self.t));
    const b = PointCal.unitVector(other.curve.derivative(other.t));
    const sin = Math.abs(a.x * b.y - a.y * b.x);
    const cos = Math.abs(a.x * b.x + a.y * b.y);

    let halfLength = MAX_MARK_HALF_LENGTH;
    if (sin >= PARALLEL_SIN) {
        const cot = cos / sin;
        if (kind === 'over') {
            halfLength =
                (other.gauge / 2 + DECK_CLEARANCE) / sin +
                parapetOffset(self.gauge) * cot;
        } else {
            const outermost = bridge
                ? parapetOffset(self.gauge)
                : renderStyle === 'rails'
                  ? self.gauge / 2
                  : 0;
            halfLength =
                (parapetOffset(other.gauge) + gapClearance) / sin +
                outermost * cot;
        }
    }
    return {
        kind: kind === 'over' ? 'deck' : 'gap',
        s: self.curve.lengthAtT(self.t),
        halfLength: Math.min(halfLength, MAX_MARK_HALF_LENGTH),
    };
}

/** A track that crosses over a lower segment with a deck, as the lower segment sees it. */
export type OverCrossing = {
    /** The upper segment. */
    segment: number;
    /** Where it crosses the lower segment. */
    point: Point;
    /** Arc length of the crossing along the lower segment. */
    s: number;
    /** The upper track's unit normal at the crossing: its tangent turned a quarter turn toward +y. */
    normal: Point;
    gauge: number;
    /** The upper track's height at the crossing, in metres. */
    height: number;
    /** How far (m) the upper track's deck reaches each way from the crossing. */
    reach: number;
};

/**
 * Two neighbouring decks over one lower segment that make one bridge: each
 * with the side of its own normal (+1 or −1) that faces the other.
 */
export type SharedBridgePair = {
    a: { segment: number; s: number; side: 1 | -1 };
    b: { segment: number; s: number; side: 1 | -1 };
};

/**
 * Whether the centre lines of `a` and `b`, continued straight from where they
 * cross the lower track (`delta` apart), meet within either one's deck.
 */
function meetOnTheDecks(
    a: OverCrossing,
    b: OverCrossing,
    delta: Point
): boolean {
    const tangentA = { x: a.normal.y, y: -a.normal.x };
    const tangentB = { x: b.normal.y, y: -b.normal.x };
    const cross = (p: Point, q: Point) => p.x * q.y - p.y * q.x;
    const turn = cross(tangentA, tangentB);
    if (Math.abs(turn) < PARALLEL_SIN) return false;
    const alongA = cross(delta, tangentB) / turn;
    const alongB = cross(delta, tangentA) / turn;
    return Math.abs(alongA) <= a.reach || Math.abs(alongB) <= b.reach;
}

/**
 * The pairs of decks over one lower segment that share a bridge. Only
 * neighbours along the lower segment are compared, so in a run of three the
 * middle one pairs with each outer one. Two neighbours share when they are
 * within {@link VERTICAL_CLEARANCE} of each other's height, their crossings are
 * at least {@link SHARED_BRIDGE_MIN_APART} apart, and the space between their
 * parapets is at most {@link SHARED_BRIDGE_SPACE}. That space is measured
 * across each track and the smaller taken, so the answer is the same from
 * either track, and diverging tracks are judged where they are closest.
 * Tracks whose centre lines, continued straight from the crossings, meet
 * within either deck don't share: they cross or join on the bridge, so which
 * side of each faces the other changes along it.
 */
export function sharedBridgePairs(
    over: readonly OverCrossing[]
): SharedBridgePair[] {
    const sorted = [...over].sort((a, b) => a.s - b.s || a.segment - b.segment);
    const pairs: SharedBridgePair[] = [];
    for (let i = 0; i + 1 < sorted.length; i++) {
        const a = sorted[i]!;
        const b = sorted[i + 1]!;
        if (Math.abs(a.height - b.height) >= VERTICAL_CLEARANCE) continue;
        const delta = PointCal.subVector(b.point, a.point);
        if (PointCal.magnitude(delta) < SHARED_BRIDGE_MIN_APART) continue;
        if (meetOnTheDecks(a, b, delta)) continue;
        const acrossA = PointCal.dotProduct(delta, a.normal);
        const acrossB = PointCal.dotProduct(delta, b.normal);
        const spacing = Math.min(Math.abs(acrossA), Math.abs(acrossB));
        const limit =
            parapetOffset(a.gauge) +
            parapetOffset(b.gauge) +
            SHARED_BRIDGE_SPACE;
        if (spacing > limit) continue;
        pairs.push({
            a: { segment: a.segment, s: a.s, side: acrossA >= 0 ? 1 : -1 },
            b: { segment: b.segment, s: b.s, side: -acrossB >= 0 ? 1 : -1 },
        });
    }
    return pairs;
}

/**
 * A deck or gap over [`from`, `to`] of a segment's arc length, with a wing flag
 * for each end of a deck.
 */
export type MarkSpan = {
    kind: 'deck' | 'gap';
    from: number;
    to: number;
    /** A deck's wing at `from` / `to`; ignored for gaps. */
    wings: { start: boolean; end: boolean };
    /**
     * A deck's sides whose parapet is left out, because a neighbouring deck
     * shares the bridge there: `positive` is the side the normal points to.
     * Ignored for gaps. None when omitted.
     */
    shared?: { positive: boolean; negative: boolean };
};

/** `amount` as a length that carries on, or 0 when it is only float noise. */
const aboveNoise = (amount: number): number =>
    amount > EMPTY_INTERVAL ? amount : 0;

/**
 * A mark's span on its own segment, clamped to [0, `length`], and how far the
 * mark overflows each end. A deck has a wing at an end that lies inside the
 * segment; at an end that overflows the flag is false, and the caller sets it
 * once it knows whether a neighbour continues the deck. An overflow of float
 * noise counts as none, so a deck that ends at a joint keeps its wing there.
 */
export function markSpan(
    mark: CrossingMark,
    length: number
): { span: MarkSpan; overflow: { start: number; end: number } } {
    const overflow = {
        start: aboveNoise(mark.halfLength - mark.s),
        end: aboveNoise(mark.s + mark.halfLength - length),
    };
    return {
        span: {
            kind: mark.kind,
            from: Math.max(0, mark.s - mark.halfLength),
            to: Math.min(length, mark.s + mark.halfLength),
            wings: { start: overflow.start === 0, end: overflow.end === 0 },
        },
        overflow,
    };
}

/**
 * The part of an `overflow` that lands on a neighbour of `length` entered at
 * its `'start'` or `'end'`, and what is left over to pass on. The wing at the
 * entry side is false, since the deck continues across the joint; the one at
 * the far side is true when nothing is left over (float noise is nothing),
 * since the deck ends inside this segment. When something is left, that flag
 * starts false, and the caller resolves it as it does for {@link markSpan}.
 * A deck's `shared` sides carry over as given; the caller swaps them when the
 * neighbour runs the other way.
 */
export function carrySpan(
    kind: MarkSpan['kind'],
    overflow: number,
    length: number,
    enteringAt: 'start' | 'end',
    shared?: MarkSpan['shared']
): { span: MarkSpan; remaining: number } {
    const covered = Math.min(overflow, length);
    const remaining = aboveNoise(overflow - length);
    const farWing = remaining === 0;
    const span: MarkSpan =
        enteringAt === 'start'
            ? {
                  kind,
                  from: 0,
                  to: covered,
                  wings: { start: false, end: farWing },
              }
            : {
                  kind,
                  from: length - covered,
                  to: length,
                  wings: { start: farWing, end: false },
              };
    if (shared !== undefined) span.shared = { ...shared };
    return { span, remaining };
}

/** What a segment sees of another one that meets it at a joint. */
export type RunEndNeighbour = {
    lineStyle?: TrackLineStyle;
    /** Whether that segment is underground at its own end of the joint. */
    underground: boolean;
};

/**
 * Whether a segment's end at a joint gets a portal (`tunnel` preset) or wings
 * (`bridge` preset). Only the two ends of a run of such segments do: a tunnel
 * end doesn't when the track is buried there anyway, or when a neighbour is
 * underground at the joint; a bridge end doesn't when a neighbour is a bridge
 * too. An end with no neighbours is open, and gets its mark.
 */
export function needsRunEndMark(
    lineStyle: TrackLineStyle | undefined,
    buriedHere: boolean,
    neighbours: RunEndNeighbour[]
): boolean {
    switch (lineStyle?.preset) {
        case 'tunnel':
            return !buriedHere && !neighbours.some(n => n.underground);
        case 'bridge':
            return !neighbours.some(n => n.lineStyle?.preset === 'bridge');
        default:
            return false;
    }
}

export type LineTrackInput = {
    samples: LineSample[];
    heights: LineHeights;
    gauge: number;
    lineStyle?: TrackLineStyle;
    renderStyle: 'centerline' | 'rails';
    terrain: TerrainSampler | null;
    /** Metres per screen pixel: 1 / zoom level. */
    metresPerPixel: number;
    /** Decks and gaps from the tracks that cross this one, or reach it. */
    marks?: MarkSpan[];
    /**
     * Whether each end of the segment is an end of its run of `tunnel` or
     * `bridge` segments, and so gets a portal or wings. Neither when omitted.
     */
    runEnds?: { start: boolean; end: boolean };
};

/** One polyline to stroke. */
export type LineStroke = { points: Point[]; color: number };

export type LineTrackDrawing = {
    /** Stroke width in screen pixels. */
    width: number;
    strokes: LineStroke[];
    /**
     * Whether the strokes depend on the zoom or the width, so the renderer has
     * to build them again when either changes. False for a plain solid line.
     */
    styled: boolean;
};

/** A stretch of the segment that is wholly above or wholly below ground. */
type LineRun = { s0: number; s1: number; underground: boolean };

/** Where the track meets the ground. `side` is the open-air direction along s. */
type GroundCrossing = { s: number; side: 1 | -1 };

/** A position on the line, as the samples' point, tangent and normal there. */
type LineFrame = Pick<LineSample, 'point' | 'tangent' | 'normal'>;

/** Index `i` of the sample pair [i, i + 1] that holds arc length `s`. */
function bracket(samples: LineSample[], s: number): number {
    let lo = 0;
    let hi = samples.length - 2;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (samples[mid]!.s <= s) lo = mid;
        else hi = mid - 1;
    }
    return lo;
}

const mix = (a: number, b: number, u: number): number => a * (1 - u) + b * u;

const mixPoint = (a: Point, b: Point, u: number): Point => ({
    x: mix(a.x, b.x, u),
    y: mix(a.y, b.y, u),
});

/** The frame at arc length `s`, linear between the two samples around it. */
function frameAt(samples: LineSample[], s: number): LineFrame {
    const i = bracket(samples, s);
    const a = samples[i]!;
    const b = samples[i + 1]!;
    const span = b.s - a.s;
    const u = span > 0 ? Math.min(1, Math.max(0, (s - a.s) / span)) : 0;
    return {
        point: mixPoint(a.point, b.point, u),
        tangent: mixPoint(a.tangent, b.tangent, u),
        normal: mixPoint(a.normal, b.normal, u),
    };
}

/** The point `offset` metres to the +normal side of the frame's point. */
const offsetPoint = (frame: LineFrame, offset: number): Point => ({
    x: frame.point.x + frame.normal.x * offset,
    y: frame.point.y + frame.normal.y * offset,
});

/** The line `offset` metres off centre from arc length `s0` to `s1`. */
function polylineBetween(
    samples: LineSample[],
    s0: number,
    s1: number,
    offset: number
): Point[] {
    const points = [offsetPoint(frameAt(samples, s0), offset)];
    for (
        let j = bracket(samples, s0) + 1;
        j < samples.length && samples[j]!.s < s1;
        j++
    ) {
        if (samples[j]!.s > s0) points.push(offsetPoint(samples[j]!, offset));
    }
    points.push(offsetPoint(frameAt(samples, s1), offset));
    return points;
}

/**
 * Split the segment into runs above and below ground. Where the state changes
 * between two samples, the boundary is found by linear interpolation of the
 * track's height above the ground, and it is a ground crossing.
 */
function splitRuns(
    input: LineTrackInput,
    length: number
): { runs: LineRun[]; crossings: GroundCrossing[] } {
    const { samples, heights, lineStyle, terrain } = input;
    const underground = samples.map(sample =>
        isUnderground(heights, sample.t, sample.point, lineStyle, terrain)
    );
    const clearance = (sample: LineSample) =>
        heightAt(heights, sample.t) - groundHeight(sample.point, terrain);

    const runs: LineRun[] = [];
    const crossings: GroundCrossing[] = [];
    let start = 0;
    for (let i = 0; i + 1 < samples.length; i++) {
        if (underground[i] === underground[i + 1]) continue;
        const a = samples[i]!;
        const b = samples[i + 1]!;
        const above = clearance(a);
        const s = a.s + ((b.s - a.s) * above) / (above - clearance(b));
        runs.push({ s0: start, s1: s, underground: underground[i]! });
        crossings.push({ s, side: underground[i] ? 1 : -1 });
        start = s;
    }
    runs.push({
        s0: start,
        s1: length,
        underground: underground[samples.length - 1]!,
    });
    return { runs, crossings };
}

/**
 * The outer end of a wing: from the line `offset` metres off centre at `frame`,
 * `MARK_LENGTH` long at `MARK_ANGLE` to the track, bent away from the centre
 * line and on along the track in `direction` (+1 toward larger s).
 */
function wingTip(frame: LineFrame, offset: number, direction: 1 | -1): Point {
    const bar = offsetPoint(frame, offset);
    const along = MARK_LENGTH * Math.cos(MARK_ANGLE) * direction;
    const across = MARK_LENGTH * Math.sin(MARK_ANGLE) * Math.sign(offset);
    return {
        x: bar.x + along * frame.tangent.x + across * frame.normal.x,
        y: bar.y + along * frame.tangent.y + across * frame.normal.y,
    };
}

/** A bar across the track with both ends bent toward the open air. */
function portalStroke(
    samples: LineSample[],
    crossing: GroundCrossing,
    gauge: number,
    color: number
): LineStroke {
    const frame = frameAt(samples, crossing.s);
    const half = parapetOffset(gauge);
    return {
        points: [
            wingTip(frame, -half, crossing.side),
            offsetPoint(frame, -half),
            offsetPoint(frame, half),
            wingTip(frame, half, crossing.side),
        ],
        color,
    };
}

/**
 * The spans of one kind, sorted, with spans that overlap or touch merged into
 * one. A merged span takes its start wing from the span with the smallest
 * `from` and its end wing from the one with the largest `to`, and where
 * several tie, a wing if any of them has one. The ends are the spans' own: the
 * caller clamps them to the segment.
 */
function mergedSpans(spans: MarkSpan[], kind: MarkSpan['kind']): MarkSpan[] {
    const sorted = spans
        .filter(span => span.kind === kind)
        .map(span => ({ ...span, wings: { ...span.wings } }))
        .sort((a, b) => a.from - b.from);
    const merged: MarkSpan[] = [];
    for (const span of sorted) {
        const last = merged[merged.length - 1];
        if (last === undefined || span.from > last.to) {
            merged.push(span);
            continue;
        }
        if (span.from === last.from) {
            last.wings.start = last.wings.start || span.wings.start;
        }
        if (span.to > last.to) {
            last.to = span.to;
            last.wings.end = span.wings.end;
        } else if (span.to === last.to) {
            last.wings.end = last.wings.end || span.wings.end;
        }
    }
    return merged;
}

/** The spans of one kind as merged arc-length intervals clamped to the segment. */
function spanIntervals(
    spans: MarkSpan[],
    kind: MarkSpan['kind'],
    length: number
): [number, number][] {
    return mergedSpans(spans, kind)
        .map((span): [number, number] => [
            Math.max(0, span.from),
            Math.min(length, span.to),
        ])
        .filter(([from, to]) => to - from > EMPTY_INTERVAL);
}

/** Whether arc length `s` lies in one of the (clamped) `intervals`. */
const covers = (intervals: [number, number][], s: number): boolean =>
    intervals.some(([from, to]) => from <= s && s <= to);

/** What is left of [`s0`, `s1`] once `gaps` (sorted and disjoint) are cut out. */
function subtractGaps(
    s0: number,
    s1: number,
    gaps: [number, number][]
): [number, number][] {
    const pieces: [number, number][] = [];
    let from = s0;
    for (const [gapFrom, gapTo] of gaps) {
        if (gapTo <= from) continue;
        if (gapFrom >= s1) break;
        if (gapFrom - from > EMPTY_INTERVAL) pieces.push([from, gapFrom]);
        from = Math.max(from, gapTo);
    }
    if (s1 - from > EMPTY_INTERVAL) pieces.push([from, s1]);
    return pieces;
}

/** A parapet from `from` to `to` at `offset`, with a wing at each end asked for. */
function parapetStroke(
    samples: LineSample[],
    from: number,
    to: number,
    offset: number,
    wings: { start: boolean; end: boolean },
    color: number
): LineStroke {
    const points = polylineBetween(samples, from, to, offset);
    if (wings.start) {
        points.unshift(wingTip(frameAt(samples, from), offset, -1));
    }
    if (wings.end) {
        points.push(wingTip(frameAt(samples, to), offset, 1));
    }
    return { points, color };
}

/** A wing on its own, from the line at `offset` out to its tip, at arc length `s`. */
function wingStroke(
    samples: LineSample[],
    s: number,
    offset: number,
    direction: 1 | -1,
    color: number
): LineStroke {
    const frame = frameAt(samples, s);
    return {
        points: [offsetPoint(frame, offset), wingTip(frame, offset, direction)],
        color,
    };
}

/**
 * The strokes for one segment: its line (one per rail for `rails`) split into
 * above- and below-ground runs, each cut by its pattern and by the gaps under
 * any decks; a portal wherever the track meets the ground; the parapets of a
 * `bridge` preset and of the decks over other tracks (decks that overlap are
 * one, and a side a neighbouring deck shares has none); and the portals of a `tunnel` preset's run ends. Marks are solid, and
 * take the colour of the run they sit on, except that portals always take the
 * above-ground colour. Gaps cut lines and parapets, never wings or portals: a
 * wing at a run end that a gap has taken from its parapet is drawn on its own.
 */
export function buildLineTrack(input: LineTrackInput): LineTrackDrawing {
    const { samples, gauge, renderStyle, metresPerPixel } = input;
    const style = resolveLineStyle(input.lineStyle);
    const strokes: LineStroke[] = [];
    let styled = style.width > 1;
    if (samples.length < 2) return { width: style.width, strokes, styled };

    const length = samples[samples.length - 1]!.s;
    const { runs, crossings } = splitRuns(input, length);
    const marks = input.marks ?? [];
    const gaps = spanIntervals(marks, 'gap', length);
    const runEnds = input.runEnds ?? { start: false, end: false };
    const offsets = renderStyle === 'rails' ? [-gauge / 2, gauge / 2] : [0];
    const parapets = [-parapetOffset(gauge), parapetOffset(gauge)];
    const colorOf = (run: LineRun) =>
        run.underground
            ? lightenColor(style.color, UNDERGROUND_LIGHTEN)
            : style.color;
    const parts = runs.map(run => ({
        run,
        pieces: subtractGaps(run.s0, run.s1, gaps),
    }));

    for (const { run, pieces } of parts) {
        const pattern =
            run.underground && style.pattern === 'solid'
                ? 'dashed'
                : style.pattern;
        const color = colorOf(run);
        const lengths = PATTERN_PX[pattern].map(
            px => px * style.width * metresPerPixel
        );
        // A run too short to show a dash now may show one at another zoom.
        if (run.s1 > run.s0 && lengths.length > 0) styled = true;
        for (const [pieceFrom, pieceTo] of pieces) {
            const intervals = patternIntervals(pieceFrom, pieceTo, lengths);
            for (const offset of offsets) {
                for (const [from, to] of intervals) {
                    strokes.push({
                        points: polylineBetween(samples, from, to, offset),
                        color,
                    });
                }
            }
        }
    }

    for (const crossing of crossings) {
        strokes.push(portalStroke(samples, crossing, gauge, style.color));
    }

    if (style.preset === 'bridge') {
        const parapetPieces = parts.flatMap(({ run, pieces }) =>
            pieces.map(([from, to]) => ({ from, to, color: colorOf(run) }))
        );
        const startCut = covers(gaps, 0);
        const endCut = covers(gaps, length);
        parapetPieces.forEach(({ from, to, color }, i) => {
            const wings = {
                start: runEnds.start && !startCut && i === 0,
                end: runEnds.end && !endCut && i === parapetPieces.length - 1,
            };
            for (const offset of parapets) {
                strokes.push(
                    parapetStroke(samples, from, to, offset, wings, color)
                );
            }
        });
        // A gap over a run end takes the parapet there but not the wing.
        for (const offset of parapets) {
            if (runEnds.start && startCut) {
                strokes.push(
                    wingStroke(samples, 0, offset, -1, colorOf(runs[0]!))
                );
            }
            if (runEnds.end && endCut) {
                strokes.push(
                    wingStroke(
                        samples,
                        length,
                        offset,
                        1,
                        colorOf(runs[runs.length - 1]!)
                    )
                );
            }
        }
    }

    // Where a neighbouring deck shares a side, that side has no parapet.
    const sharedOn = parapets.map(offset =>
        spanIntervals(
            marks.filter(
                span => span.shared?.[offset > 0 ? 'positive' : 'negative']
            ),
            'deck',
            length
        )
    );
    for (const deck of mergedSpans(marks, 'deck')) {
        const from = Math.max(0, deck.from);
        const to = Math.min(length, deck.to);
        if (!(to - from > EMPTY_INTERVAL)) continue;
        parapets.forEach((offset, i) => {
            for (const [pieceFrom, pieceTo] of subtractGaps(
                from,
                to,
                sharedOn[i]!
            )) {
                const centre = (pieceFrom + pieceTo) / 2;
                const run =
                    runs.find(r => centre <= r.s1) ?? runs[runs.length - 1]!;
                // A wing is drawn where the span says: a deck that goes on
                // past the segment's end has none there, and neither has an
                // end left where a shared stretch is cut out.
                const wings = {
                    start:
                        deck.wings.start && pieceFrom - from <= EMPTY_INTERVAL,
                    end: deck.wings.end && to - pieceTo <= EMPTY_INTERVAL,
                };
                strokes.push(
                    parapetStroke(
                        samples,
                        pieceFrom,
                        pieceTo,
                        offset,
                        wings,
                        colorOf(run)
                    )
                );
            }
        });
    }

    if (style.preset === 'tunnel') {
        if (runEnds.start) {
            strokes.push(
                portalStroke(samples, { s: 0, side: -1 }, gauge, style.color)
            );
        }
        if (runEnds.end) {
            strokes.push(
                portalStroke(
                    samples,
                    { s: length, side: 1 },
                    gauge,
                    style.color
                )
            );
        }
    }

    return { width: style.width, strokes, styled };
}
