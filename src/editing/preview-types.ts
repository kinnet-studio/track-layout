import type { Point } from '@ue-too/math';

import type { TrackSegmentDrawData } from '../index.js';

/**
 * Draw data for the track a tool is previewing, one entry per piece.
 * `undefined` clears the preview.
 */
export type PreviewDrawData = {
    index: number;
    drawData: TrackSegmentDrawData & {
        positiveOffsets: Point[];
        negativeOffsets: Point[];
    };
}[];

/**
 * Highlight payload for the curve deletion tool.
 * Non-null while the cursor is over a deletable segment.
 */
export type DeletionHighlightState = {
    segmentNumber: number;
} | null;

/**
 * Highlight payload for the duplicate-to-side tool.
 * `hover` = candidate under the cursor while no source is selected.
 * `selected` = the currently locked-in source while a preview is shown.
 */
export type DuplicateHighlightState = {
    segmentNumber: number;
    kind: 'hover' | 'selected';
} | null;

/**
 * Highlight payload for the catenary layout tool.
 * `hover` = candidate under the cursor while no source is selected.
 * `selected` = the currently locked-in source while a preview is shown.
 */
export type CatenaryHighlightState = {
    segmentNumber: number;
    kind: 'hover' | 'selected';
} | null;

/**
 * Preview payload emitted while the user is choosing a side.
 */
export type CatenaryPreviewState = {
    segmentNumber: number;
    side: 1 | -1;
} | null;
