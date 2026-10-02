import type { Observer, SubscriptionOptions } from '@ue-too/board';

import type {
    CatenaryHighlightState,
    CatenaryPreviewState,
    DeletionHighlightState,
    DuplicateHighlightState,
    PreviewDrawData,
} from '../editing/preview-types.js';
import type { ProjectionPositiveResult } from '../index.js';

/** Subscribes an observer to one stream of preview payloads. */
type Subscribe<T> = (
    observer: Observer<[T]>,
    options?: SubscriptionOptions
) => void;

/**
 * The previews the track renderer draws for the curve tool. The
 * `CurveCreationEngine` from `track-layout/editing` is one.
 */
export interface CurveCreationPreviewSource {
    onPreviewDrawDataChange: Subscribe<PreviewDrawData | undefined>;
    onDeletionHighlightChange: Subscribe<DeletionHighlightState>;
    onPreviewStartProjectionChange: Subscribe<ProjectionPositiveResult | null>;
    onPreviewEndProjectionChange: Subscribe<ProjectionPositiveResult | null>;
}

/**
 * The previews the track renderer draws for the duplicate-to-side tool. The
 * `DuplicateToSideEngine` from `track-layout/editing` is one.
 */
export interface DuplicateToSidePreviewSource {
    onPreviewDrawDataChange: Subscribe<PreviewDrawData | undefined>;
    onHighlightChange: Subscribe<DuplicateHighlightState>;
}

/**
 * The previews the track renderer draws for the catenary tool. The
 * `CatenaryLayoutEngine` from `track-layout/editing` is one.
 */
export interface CatenaryLayoutPreviewSource {
    onHighlightChange: Subscribe<CatenaryHighlightState>;
    onPreviewChange: Subscribe<CatenaryPreviewState>;
}
