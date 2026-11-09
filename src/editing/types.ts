import { Point } from '@ue-too/math';

import {
    FlatElevation,
    ProjectionCurveResult,
    ProjectionEdgeResult,
    ProjectionJointResult,
    SlopedElevation,
} from '../index.js';

export type NewJointType =
    | BrandNewJoint
    | BranchJoint
    | ExtendingTrackJoint
    | BranchCurveJoint
    | ConstrainedNewJoint;

export type BrandNewJoint = {
    type: 'new';
} & BaseJoint;

export type BaseJoint = {
    position: Point;
    elevation: number;
};

export type ConstrainedNewJoint = {
    type: 'contrained';
    constraint: ProjectionEdgeResult;
} & BaseJoint;

export type BranchJoint = {
    type: 'branchJoint';
    constraint: ProjectionJointResult;
} & BaseJoint;

export type ExtendingTrackJoint = {
    type: 'extendingTrack';
    constraint: ProjectionJointResult;
} & BaseJoint;

export type BranchCurveJoint = {
    type: 'branchCurve';
    constraint: ProjectionCurveResult;
    curveElevation: SlopedElevation | FlatElevation;
} & BaseJoint;

/**
 * Why `CurveCreationEngine.endCurve` refused to lay the curve.
 *
 * - `incomplete`: there was no start, end or preview curve to lay.
 * - `extendAngle`: an end extends a track end, but the curve doesn't carry
 *   on from it.
 * - `gaugeMismatch`: the curve's gauge differs from the track at an end it
 *   joins or the segment it branches off.
 * - `slopedBranch`: a branch would slope: its ends are at different
 *   elevations, or it branches off a sloped segment.
 * - `protectedSegment`: it branches off a protected segment (see
 *   `TrackGraph.setSegmentProtectionCheck`).
 * - `alreadyJoined`: a segment already joins its two ends, or both ends
 *   branch off the same segment.
 * - `graphRefused`: the graph refused to split a segment or join the ends.
 */
export type CurveRefusal =
    | 'incomplete'
    | 'extendAngle'
    | 'gaugeMismatch'
    | 'slopedBranch'
    | 'protectedSegment'
    | 'alreadyJoined'
    | 'graphRefused';
