import type { TrackLineStyle, TrackSegment, TrackStyle } from './types.js';

/** Appearance applied to segments when they are created. */
export type SegmentStyle = {
    trackStyle: TrackStyle;
    electrified: boolean;
    /** Side of the catenary masts (1 = left, -1 = right of the curve direction). */
    catenarySide?: 1 | -1;
    bed: boolean;
    /** Bed width in metres, applied to new segments while `bed` is on. */
    bedWidth: number;
    /** How the line render styles draw this segment; unset fields come from the preset. */
    lineStyle?: TrackLineStyle;
};

/** The style fields stored on each segment and saved with it. */
export type SegmentStyleFields = Pick<
    TrackSegment,
    | 'trackStyle'
    | 'electrified'
    | 'catenarySide'
    | 'bed'
    | 'bedWidth'
    | 'lineStyle'
>;

/** Payload of TrackGraph.onSegmentStyleChanged. */
export type SegmentStyleChange = {
    segmentNumber: number;
    style: SegmentStyleFields;
};

export const DEFAULT_SEGMENT_STYLE: Readonly<SegmentStyle> = Object.freeze({
    trackStyle: 'ballasted',
    electrified: false,
    bed: false,
    bedWidth: 3,
});

/**
 * A copy of `style` holding only its defined fields, or undefined when it has
 * none. Keeps two segments from sharing one object and stores an empty style
 * as unset.
 */
export function normalizeLineStyle(
    style: TrackLineStyle | undefined
): TrackLineStyle | undefined {
    if (style === undefined) {
        return undefined;
    }
    const copy: TrackLineStyle = {};
    for (const key of Object.keys(style) as (keyof TrackLineStyle)[]) {
        if (style[key] !== undefined) {
            (copy as Record<string, unknown>)[key] = style[key];
        }
    }
    return Object.keys(copy).length > 0 ? copy : undefined;
}

/**
 * The fields stored on a segment laid with `style`. The bed width is only
 * stored while the bed is on, because snapping, parallel spacing and platform
 * offsets treat a stored bed width as the track's footprint.
 */
export function segmentFieldsFromStyle(
    style: SegmentStyle
): SegmentStyleFields {
    return {
        trackStyle: style.trackStyle,
        electrified: style.electrified,
        catenarySide: style.catenarySide,
        bed: style.bed,
        bedWidth: style.bed ? style.bedWidth : undefined,
        lineStyle: normalizeLineStyle(style.lineStyle),
    };
}

/** Fills style fields missing from a saved segment (older saves) with defaults. */
export function withStyleDefaults(
    saved: SegmentStyleFields
): SegmentStyleFields {
    const bed = saved.bed ?? DEFAULT_SEGMENT_STYLE.bed;
    return {
        trackStyle: saved.trackStyle ?? DEFAULT_SEGMENT_STYLE.trackStyle,
        electrified: saved.electrified ?? DEFAULT_SEGMENT_STYLE.electrified,
        catenarySide: saved.catenarySide,
        bed,
        bedWidth:
            saved.bedWidth ??
            (bed ? DEFAULT_SEGMENT_STYLE.bedWidth : undefined),
        lineStyle: normalizeLineStyle(saved.lineStyle),
    };
}

/** Copies just the style fields off a segment. */
export function styleFieldsOf(segment: SegmentStyleFields): SegmentStyleFields {
    return {
        trackStyle: segment.trackStyle,
        electrified: segment.electrified,
        catenarySide: segment.catenarySide,
        bed: segment.bed,
        bedWidth: segment.bedWidth,
        lineStyle: normalizeLineStyle(segment.lineStyle),
    };
}

const STYLE_KEYS = [
    'trackStyle',
    'electrified',
    'catenarySide',
    'bed',
    'bedWidth',
    'lineStyle',
] as const;

/**
 * Merges the style keys present in `patch` over `current` and keeps the bed
 * width in step with the bed: no bed means no stored width, a bed means a
 * width of at least 1 m (default 3 m when none was given). Other properties of
 * `patch` are ignored.
 */
export function applyStylePatch(
    current: SegmentStyleFields,
    patch: SegmentStyleFields
): SegmentStyleFields {
    const merged: SegmentStyleFields = { ...styleFieldsOf(current) };
    for (const key of STYLE_KEYS) {
        if (key in patch) {
            (merged as Record<string, unknown>)[key] = patch[key];
        }
    }
    const width = merged.bedWidth;
    merged.bedWidth = merged.bed
        ? width !== undefined && Number.isFinite(width)
            ? Math.max(1, width)
            : DEFAULT_SEGMENT_STYLE.bedWidth
        : undefined;
    merged.lineStyle = normalizeLineStyle(merged.lineStyle);
    return merged;
}
