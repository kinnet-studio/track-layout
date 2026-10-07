import type { BCurve } from '@ue-too/curve';
import { type Point, PointCal } from '@ue-too/math';

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

/** Metres of clearance on each side of a gap cut in a track below a deck. */
export const GAP_CLEARANCE = 0.5;

/** A crossing mark never reaches further than this (metres) from its track. */
export const MAX_MARK_HALF_LENGTH = 25;

/** How far underground track is mixed toward white, from 0 to 1. */
export const UNDERGROUND_LIGHTEN = 0.5;

/** The renderer re-strokes patterned lines when the zoom has moved by this factor. */
export const RESTROKE_ZOOM_STEP = Math.SQRT2;

/** A line interval is never cut into more pattern repeats than this. */
export const MAX_PATTERN_REPEATS = 4000;

/** Intervals shorter than this (metres) are floating-point leftovers, not marks. */
const EMPTY_INTERVAL = 1e-9;

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

export type LineTrackInput = {
    samples: LineSample[];
    heights: LineHeights;
    gauge: number;
    lineStyle?: TrackLineStyle;
    renderStyle: 'centerline' | 'rails';
    terrain: TerrainSampler | null;
    /** Metres per screen pixel: 1 / zoom level. */
    metresPerPixel: number;
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

/** A bar across the track with both ends bent toward the open air. */
function portalStroke(
    samples: LineSample[],
    crossing: GroundCrossing,
    gauge: number,
    color: number
): LineStroke {
    const frame = frameAt(samples, crossing.s);
    const half = parapetOffset(gauge);
    const along = MARK_LENGTH * Math.cos(MARK_ANGLE) * crossing.side;
    const across = MARK_LENGTH * Math.sin(MARK_ANGLE);
    const tip = (offset: number): Point => {
        const bar = offsetPoint(frame, offset);
        const sign = Math.sign(offset);
        return {
            x: bar.x + along * frame.tangent.x + across * sign * frame.normal.x,
            y: bar.y + along * frame.tangent.y + across * sign * frame.normal.y,
        };
    };
    return {
        points: [
            tip(-half),
            offsetPoint(frame, -half),
            offsetPoint(frame, half),
            tip(half),
        ],
        color,
    };
}

/**
 * The strokes for one segment: its line (one per rail for `rails`) split into
 * above- and below-ground runs, each cut by its pattern, and a portal wherever
 * the track meets the ground.
 */
export function buildLineTrack(input: LineTrackInput): LineTrackDrawing {
    const { samples, gauge, renderStyle, metresPerPixel } = input;
    const style = resolveLineStyle(input.lineStyle);
    const strokes: LineStroke[] = [];
    let styled = style.width > 1;
    if (samples.length < 2) return { width: style.width, strokes, styled };

    const length = samples[samples.length - 1]!.s;
    const { runs, crossings } = splitRuns(input, length);
    const offsets = renderStyle === 'rails' ? [-gauge / 2, gauge / 2] : [0];

    for (const run of runs) {
        const pattern =
            run.underground && style.pattern === 'solid'
                ? 'dashed'
                : style.pattern;
        const color = run.underground
            ? lightenColor(style.color, UNDERGROUND_LIGHTEN)
            : style.color;
        const lengths = PATTERN_PX[pattern].map(
            px => px * style.width * metresPerPixel
        );
        const intervals = patternIntervals(run.s0, run.s1, lengths);
        // A run too short to show a dash now may show one at another zoom.
        if (run.s1 > run.s0 && lengths.length > 0) styled = true;
        for (const offset of offsets) {
            for (const [from, to] of intervals) {
                strokes.push({
                    points: polylineBetween(samples, from, to, offset),
                    color,
                });
            }
        }
    }

    for (const crossing of crossings) {
        strokes.push(portalStroke(samples, crossing, gauge, style.color));
    }

    return { width: style.width, strokes, styled };
}
