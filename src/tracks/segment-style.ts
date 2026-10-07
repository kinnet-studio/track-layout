import {
    LINE_PATTERNS,
    LINE_PRESETS,
    type LinePattern,
    type LinePreset,
    type TrackLineStyle,
    type TrackSegment,
    type TrackStyle,
} from './types.js';

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
 * The one gate every `lineStyle` goes through before the model stores it, so
 * a stored style is always one `validateSerializedTrackData` accepts and the
 * renderer can rely on. Returns a new object holding only what is valid:
 *
 * - `preset` if it is in {@link LINE_PRESETS}, `pattern` if it is in
 *   {@link LINE_PATTERNS};
 * - `color` if it is an integer from 0 to 0xFFFFFF;
 * - `width` clamped to 1 to 8 if it is a finite number.
 *
 * Anything else is dropped: other values, unknown keys (only these four keys
 * are read, so a `__proto__` key can't reach the copy), and a style that is
 * `null` or not an object. The result is undefined when nothing is left, so an
 * empty style is stored as unset. The copy keeps two segments from sharing one
 * object.
 */
export function normalizeLineStyle(
    style: TrackLineStyle | undefined
): TrackLineStyle | undefined {
    if (typeof style !== 'object' || style === null) {
        return undefined;
    }
    const { preset, pattern, color, width } = style as Record<string, unknown>;
    const copy: TrackLineStyle = {};
    if ((LINE_PRESETS as readonly unknown[]).includes(preset)) {
        copy.preset = preset as LinePreset;
    }
    if ((LINE_PATTERNS as readonly unknown[]).includes(pattern)) {
        copy.pattern = pattern as LinePattern;
    }
    if (
        Number.isInteger(color) &&
        (color as number) >= 0 &&
        (color as number) <= 0xffffff
    ) {
        copy.color = color as number;
    }
    if (typeof width === 'number' && Number.isFinite(width)) {
        copy.width = Math.min(8, Math.max(1, width));
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
