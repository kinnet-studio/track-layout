import type { SerializedTrackData } from './types.js';

/** Lowest allowed height, in metres. */
export const HEIGHT_MIN = -200;
/** Highest allowed height, in metres. */
export const HEIGHT_MAX = 200;

/** Rounds a height to 0.01 m. Negative zero becomes 0. */
export function roundHeight(metres: number): number {
    const rounded = Math.round(metres * 100) / 100;
    return rounded === 0 ? 0 : rounded;
}

/** Rounds a height to 0.01 m, then clamps it to the allowed range. */
export function clampHeight(metres: number): number {
    return Math.min(HEIGHT_MAX, Math.max(HEIGHT_MIN, roundHeight(metres)));
}

/** Whether `value` is a finite number within the allowed range. */
export function isValidHeight(value: unknown): value is number {
    return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= HEIGHT_MIN &&
        value <= HEIGHT_MAX
    );
}

/**
 * Moves a height to the next multiple of `step` above or below it.
 * Works in whole centimetres so that fractional steps are exact.
 */
export function stepHeight(
    metres: number,
    step: number,
    direction: 1 | -1
): number {
    const h = Math.round(metres * 100);
    const s = Math.max(1, Math.round(step * 100));
    const next =
        direction === 1
            ? (Math.floor(h / s) + 1) * s
            : (Math.ceil(h / s) - 1) * s;
    return clampHeight(next / 100);
}

/** Old level heights were whole levels of 10 m. */
const METRES_PER_LEVEL = 10;

function levelToMetres(level: number): number {
    return typeof level === 'number' && Number.isFinite(level)
        ? roundHeight(level * METRES_PER_LEVEL)
        : level;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

/** A segment with finite end heights and a splits array, which can be converted. */
function hasLevelHeights(segment: unknown): boolean {
    return (
        isRecord(segment) &&
        isRecord(segment.elevation) &&
        isFiniteNumber(segment.elevation.from) &&
        isFiniteNumber(segment.elevation.to) &&
        Array.isArray(segment.splits)
    );
}

/**
 * Converts track and station heights saved as levels (-3 to +3) into metres.
 * Returns new objects; the input is not changed. Malformed data is passed
 * through as it is, so that validation reports it rather than this
 * throwing: a joint height that is not a finite number, a segment without
 * a finite `elevation.from` and `to` or without `splits`, and a station
 * entry that is not an object or has no finite `elevation`.
 */
export function levelsToMetres<S extends { elevation: number }>(data: {
    track: SerializedTrackData;
    stations: readonly S[];
}): { track: SerializedTrackData; stations: S[] } {
    return {
        track: {
            ...data.track,
            joints: data.track.joints.map(joint => ({
                ...joint,
                elevation: levelToMetres(joint.elevation),
            })),
            segments: data.track.segments.map(segment =>
                hasLevelHeights(segment)
                    ? {
                          ...segment,
                          elevation: {
                              from: levelToMetres(segment.elevation.from),
                              to: levelToMetres(segment.elevation.to),
                          },
                          splits: [...segment.splits],
                      }
                    : segment
            ),
        },
        stations: data.stations.map(station =>
            isRecord(station) && isFiniteNumber(station.elevation)
                ? { ...station, elevation: levelToMetres(station.elevation) }
                : station
        ),
    };
}
