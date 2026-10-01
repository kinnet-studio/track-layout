import type { Point } from '@ue-too/math';

import type {
    DualSpinePlacementPreview,
    SingleSpinePlacementPreview,
    StationPlacementPreview,
} from '../src/station-placement/preview.js';

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
