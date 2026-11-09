import { TrackSegmentDrawData } from '../index.js';
import { ballastHalfWidthForGauge } from '../shared/track-dimensions.js';

/** Compute the ballast/slab half-width for a draw data entry. Always derived from gauge. */
export const ballastHalfWidth = (drawData: TrackSegmentDrawData): number =>
    ballastHalfWidthForGauge(drawData.gauge);
