import type { Point } from '@ue-too/math';

import type {
    DualSpinePlacementPreview,
    SingleSpinePlacementPreview,
    StationPlacementPreview,
} from '../src/station-placement/preview.js';
import type { TrackGraph } from '../src/tracks/track.js';
import { ELEVATION } from '../src/tracks/types.js';

/** Window coordinates are world coordinates in these tests. */
export const identity = (position: Point) => ({ ...position });

export type PreviewCall = { method: string; args: unknown[] };

/** A preview for any of the three tools that records every call. */
export class RecordingPreview
    implements
        StationPlacementPreview,
        SingleSpinePlacementPreview,
        DualSpinePlacementPreview
{
    calls: PreviewCall[] = [];

    /** The method names called, in order. */
    get methods(): string[] {
        return this.calls.map(call => call.method);
    }

    /** The arguments of the most recent call to `method`. */
    lastArgs(method: string): unknown[] | undefined {
        return this.calls.filter(call => call.method === method).at(-1)?.args;
    }

    private _record(method: string, args: unknown[]): void {
        this.calls.push({ method, args });
    }

    showPreview(...args: unknown[]): void {
        this._record('showPreview', args);
    }
    hidePreview(...args: unknown[]): void {
        this._record('hidePreview', args);
    }
    showTrackHighlight(...args: unknown[]): void {
        this._record('showTrackHighlight', args);
    }
    showPlacementPreview(...args: unknown[]): void {
        this._record('showPlacementPreview', args);
    }
    showDualSpinePlacementPreview(...args: unknown[]): void {
        this._record('showDualSpinePlacementPreview', args);
    }
    showCapDrawingHover(...args: unknown[]): void {
        this._record('showCapDrawingHover', args);
    }
}

/**
 * Lays straight segments through `points`, in order, along the x axis, and
 * returns their joint and segment ids. Each segment's t runs with x, so a
 * point at x on a 0–100 segment projects to t = x / 100.
 */
export function layTrack(
    graph: TrackGraph,
    points: Point[],
    elevation: ELEVATION = ELEVATION.GROUND
): { joints: number[]; segments: number[] } {
    const joints = points.map(point =>
        graph.createNewEmptyJoint(point, { x: 1, y: 0 }, elevation)
    );
    const segments: number[] = [];
    for (let i = 0; i + 1 < joints.length; i++) {
        const [a, b] = [points[i], points[i + 1]];
        graph.connectJoints(joints[i], joints[i + 1], [
            { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        ]);
        segments.push(
            graph.getJoint(joints[i])!.connections.get(joints[i + 1])!
        );
    }
    return { joints, segments };
}

/** A station with no platforms, as the station list creates one. */
export function bareStation(position: Point) {
    return {
        name: 'Station',
        position,
        elevation: ELEVATION.GROUND,
        platforms: [],
        trackSegments: [],
        joints: [],
        trackAlignedPlatforms: [] as number[],
    };
}
