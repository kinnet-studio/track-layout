import {
    Observable,
    SubscriptionOptions,
    SynchronousObservable,
} from '@ue-too/board';
import { BCurve, offset2 } from '@ue-too/curve';
import { Point, PointCal } from '@ue-too/math';

import { GenericEntityManager } from '../shared/entity-manager.js';
import { RTree, Rectangle } from '../shared/r-tree.js';
import { LEVEL_HEIGHT } from './constants.js';
import {
    DEFAULT_SEGMENT_STYLE,
    type SegmentStyle,
    type SegmentStyleChange,
    type SegmentStyleFields,
    applyStylePatch,
    normalizeLineStyle,
    segmentFieldsFromStyle,
    styleFieldsOf,
    withStyleDefaults,
} from './segment-style.js';
import {
    ELEVATION,
    ProjectionInfo,
    SerializedTrackSegment,
    TrackSegmentDrawData,
    TrackSegmentSplit,
    TrackSegmentWithCollision,
    TrackSegmentWithCollisionAndNumber,
} from './types.js';
import {
    getElevationAtT,
    makeTrackSegmentDrawDataFromSplit,
    orderTest,
    trackSegmentDrawDataInsertIndex,
} from './utils.js';

/** Where another segment crosses this one. `t` and `otherT` are Bezier parameters. */
export type TrackCrossing = {
    otherSegment: number;
    t: number;
    otherT: number;
};

/** Raw intersection hits this close in both `t` and `otherT` are one crossing. */
const CROSSING_MERGE_T = 0.05;
/** A crossing this close to a joint the two segments share is a touch, not a crossing. */
const JOINT_TOUCH_DISTANCE = 0.5;
/** Tracks that meet at a sine of the angle below this are touching, not crossing. */
const CROSSING_MIN_SIN = 0.02;
/** Refined crossings of one other segment this close are one crossing. */
const CROSSING_DEDUPE_DISTANCE = 0.5;

/**
 * Newton's method on `a.get(t) - b.get(u) = 0`, starting from `(t, u)`. The
 * starting point is returned when the curves are parallel there or the
 * iteration leaves [0, 1].
 */
function refineCrossing(
    a: BCurve,
    b: BCurve,
    t: number,
    u: number
): { t: number; u: number } {
    let [nextT, nextU] = [t, u];
    for (let i = 0; i < 8; i++) {
        const p = a.get(nextT);
        const q = b.get(nextU);
        const da = a.derivative(nextT);
        const db = b.derivative(nextU);
        // da * dt - db * du = q - p, by Cramer's rule
        const det = da.y * db.x - da.x * db.y;
        if (Math.abs(det) < 1e-12) {
            return { t, u };
        }
        const [rx, ry] = [q.x - p.x, q.y - p.y];
        const dt = (db.x * ry - db.y * rx) / det;
        const du = (da.x * ry - da.y * rx) / det;
        nextT += dt;
        nextU += du;
        if (nextT < 0 || nextT > 1 || nextU < 0 || nextU > 1) {
            return { t, u };
        }
        if (Math.abs(dt) < 1e-9 && Math.abs(du) < 1e-9) {
            break;
        }
    }
    return { t: nextT, u: nextU };
}

export class TrackCurveManager {
    private _internalTrackCurveManager: GenericEntityManager<{
        segment: TrackSegmentWithCollision;
        offsets: {
            positive: Point[];
            negative: Point[];
        };
    }>;

    private _internalRTree: RTree<TrackSegmentWithCollisionAndNumber> =
        new RTree<TrackSegmentWithCollisionAndNumber>();

    private _internalDrawData: (TrackSegmentDrawData & {
        callback(index: number): void;
    })[] = [];
    private _drawDataDirty = true;

    private _trackOrderMap: Map<string, number> = new Map();

    private _persistedDrawData: (TrackSegmentDrawData & {
        callback(index: number): void;
        positiveOffsets: Point[];
        negativeOffsets: Point[];
    })[] = [];

    private _deleteObservable: Observable<[string]> = new SynchronousObservable<
        [string]
    >();
    private _addObservable: Observable<
        [
            number,
            (TrackSegmentDrawData & {
                positiveOffsets: Point[];
                negativeOffsets: Point[];
            })[],
        ]
    > = new SynchronousObservable<
        [
            number,
            (TrackSegmentDrawData & {
                positiveOffsets: Point[];
                negativeOffsets: Point[];
            })[],
        ]
    >();

    private _addTrackSegmentObservable: Observable<
        [number, TrackSegmentWithCollision]
    > = new SynchronousObservable<[number, TrackSegmentWithCollision]>();
    private _removeTrackSegmentObservable: Observable<[number]> =
        new SynchronousObservable<[number]>();
    private _segmentStyleChangedObservable: Observable<[SegmentStyleChange]> =
        new SynchronousObservable<[SegmentStyleChange]>();

    /**
     * Extra distance added to gauge-based projection thresholds.
     * Prevents head-on train texture overlap at joints.
     */
    private _projectionBuffer: number = 0.5;

    /** Style applied to newly created segments. Its bed settings also size snapping for the track being laid. */
    private _newSegmentStyle: SegmentStyle = { ...DEFAULT_SEGMENT_STYLE };

    constructor(initialCount: number) {
        this._internalTrackCurveManager = new GenericEntityManager<{
            segment: TrackSegmentWithCollision;
            offsets: {
                positive: Point[];
                negative: Point[];
            };
        }>(initialCount);
    }

    /** Get the current projection buffer value. */
    get projectionBuffer(): number {
        return this._projectionBuffer;
    }

    /** Set the projection buffer (extra distance beyond gauge for snapping). */
    set projectionBuffer(value: number) {
        this._projectionBuffer = Math.max(0, value);
    }

    /** Style applied to segments created from now on. */
    get newSegmentStyle(): Readonly<SegmentStyle> {
        return this._newSegmentStyle;
    }

    /**
     * Merges `style` into the style for new segments. The bed width is clamped
     * to at least 1 m. An explicit `undefined` clears `catenarySide` and
     * `lineStyle`.
     */
    setNewSegmentStyle(style: Partial<SegmentStyle>): void {
        const next: SegmentStyle = { ...this._newSegmentStyle };
        for (const key of Object.keys(style) as (keyof SegmentStyle)[]) {
            if (
                style[key] !== undefined ||
                key === 'catenarySide' ||
                key === 'lineStyle'
            ) {
                (next as Record<string, unknown>)[key] = style[key];
            }
        }
        next.lineStyle = normalizeLineStyle(next.lineStyle);
        next.bedWidth = Number.isFinite(next.bedWidth)
            ? Math.max(1, next.bedWidth)
            : DEFAULT_SEGMENT_STYLE.bedWidth;
        this._newSegmentStyle = next;
    }

    /**
     * Changes the style of an existing segment: the segment, its spatial-index
     * entry and its draw data. Returns false when the segment does not exist.
     */
    setSegmentStyle(segmentNumber: number, patch: SegmentStyleFields): boolean {
        const entity = this._internalTrackCurveManager.getEntity(segmentNumber);
        if (entity === null) {
            return false;
        }
        const style = applyStylePatch(entity.segment, patch);
        Object.assign(entity.segment, style);
        const treeEntry = this._treeEntryFor(
            segmentNumber,
            entity.segment.curve
        );
        if (treeEntry !== undefined) {
            Object.assign(treeEntry, style);
        }
        for (const drawData of this._persistedDrawData) {
            if (
                drawData.originalTrackSegment.trackSegmentNumber ===
                segmentNumber
            ) {
                Object.assign(drawData, style);
            }
        }
        this._segmentStyleChangedObservable.notify({
            segmentNumber,
            style,
        });
        return true;
    }

    onSegmentStyleChanged(
        callback: (change: SegmentStyleChange) => void,
        options?: SubscriptionOptions
    ) {
        return this._segmentStyleChangedObservable.subscribe(callback, options);
    }

    private _treeEntryFor(
        segmentNumber: number,
        curve: BCurve
    ): TrackSegmentWithCollisionAndNumber | undefined {
        const aabb = curve.AABB;
        return this._internalRTree
            .search(
                new Rectangle(aabb.min.x, aabb.min.y, aabb.max.x, aabb.max.y)
            )
            .find(entry => entry.trackSegmentNumber === segmentNumber);
    }

    get persistedDrawData(): (TrackSegmentDrawData & {
        callback(index: number): void;
        positiveOffsets: Point[];
        negativeOffsets: Point[];
    })[] {
        return this._persistedDrawData;
    }

    getTrackSegment(segmentNumber: number): BCurve | null {
        return (
            this._internalTrackCurveManager.getEntity(segmentNumber)?.segment
                .curve ?? null
        );
    }

    getTrackSegmentsWithJoints(): TrackSegmentWithCollision[] {
        return this._internalTrackCurveManager
            .getLivingEntities()
            .map(trackSegment => trackSegment.segment);
    }

    getTrackOrder(
        trackSegmentNumber: number,
        tValInterval: { start: number; end: number }
    ): number | null {
        console.log(this._trackOrderMap);
        console.log(JSON.stringify({ trackSegmentNumber, tValInterval }));
        return (
            this._trackOrderMap.get(
                JSON.stringify({ trackSegmentNumber, tValInterval })
            ) ?? null
        );
    }

    clearInternalDrawDataOrderMap(): void {
        this._trackOrderMap.clear();
    }

    experimental(): (TrackSegmentDrawData & {
        callback(index: number): void;
    })[] {
        if (!this._drawDataDirty) {
            return this._internalDrawData;
        }
        const res: (TrackSegmentDrawData & {
            callback(index: number): void;
        })[] = [];
        const tracks =
            this._internalTrackCurveManager.getLivingEntitiesWithIndex();
        this._trackOrderMap.clear();
        tracks.forEach(track => {
            const trackSegment = track.entity;
            const index = track.index;
            trackSegment.segment.splitCurves.forEach(splitCurve => {
                const cps = trackSegment.segment.curve.getControlPoints();
                const startPosition = cps[0];
                const endPosition = cps[cps.length - 1];
                const drawData: TrackSegmentDrawData & {
                    callback(index: number): void;
                } = {
                    curve: splitCurve.curve,
                    originalTrackSegment: {
                        trackSegmentNumber: index,
                        tValInterval: {
                            start: splitCurve.tValInterval.start,
                            end: splitCurve.tValInterval.end,
                        },
                        startJointPosition: startPosition,
                        endJointPosition: endPosition,
                    },
                    originalElevation: {
                        from: trackSegment.segment.elevation.from,
                        to: trackSegment.segment.elevation.to,
                    },
                    elevation: splitCurve.elevation,
                    excludeSegmentsForCollisionCheck: new Set(),
                    callback: ((drawIndex: number) => {
                        this._trackOrderMap.set(
                            JSON.stringify({
                                trackSegmentNumber: index,
                                tValInterval: splitCurve.tValInterval,
                            }),
                            drawIndex
                        );
                    }).bind(this),
                    gauge: trackSegment.segment.gauge,
                };
                res.push(drawData);
            });
        });
        console.time('sort');
        res.sort(orderTest);
        console.timeEnd('sort');
        this._internalDrawData = res;
        this._drawDataDirty = false;
        return res;
    }

    getTrackSegmentWithJoints(
        segmentNumber: number
    ): TrackSegmentWithCollision | null {
        return (
            this._internalTrackCurveManager.getEntity(segmentNumber)?.segment ??
            null
        );
    }

    checkForCollisions(
        curve: BCurve,
        excludeSegmentsForCollisionCheck: Set<number> = new Set(),
        skipFlat: boolean = false
    ): { selfT: number; anotherCurve: { curve: BCurve; tVal: number } }[] {
        const collisions: {
            selfT: number;
            anotherCurve: { curve: BCurve; tVal: number };
        }[] = [];
        const rect = new Rectangle(
            curve.AABB.min.x,
            curve.AABB.min.y,
            curve.AABB.max.x,
            curve.AABB.max.y
        );
        const possibleCollisions = this._internalRTree.search(rect);
        possibleCollisions
            .filter(
                segment =>
                    !excludeSegmentsForCollisionCheck.has(
                        segment.trackSegmentNumber
                    ) &&
                    (!skipFlat ||
                        segment.elevation.from !== segment.elevation.to)
            )
            .forEach(segment => {
                const intersections = segment.curve
                    .getCurveIntersections(curve)
                    .map(intersection => {
                        return {
                            selfT: intersection.otherT,
                            anotherCurve: {
                                curve: segment.curve,
                                tVal: intersection.selfT,
                            },
                        };
                    });
                collisions.push(...intersections);
            });

        return collisions;
    }

    /**
     * Where other segments cross segment `segmentNumber`, sorted by `t`.
     * Segments that only touch it, at a shared joint or along a tangent, are
     * not crossings. Returns `[]` for a segment that doesn't exist.
     */
    getCrossings(segmentNumber: number): TrackCrossing[] {
        const entity = this._internalTrackCurveManager.getEntity(segmentNumber);
        if (entity === null) {
            return [];
        }
        const { curve, t0Joint, t1Joint } = entity.segment;
        const aabb = curve.AABB;
        const candidates = this._internalRTree.search(
            new Rectangle(aabb.min.x, aabb.min.y, aabb.max.x, aabb.max.y)
        );

        const crossings: TrackCrossing[] = [];
        for (const other of candidates) {
            if (other.trackSegmentNumber === segmentNumber) {
                continue;
            }
            const hits = curve
                .getCurveIntersections(other.curve)
                .map(hit => ({ t: hit.selfT, otherT: hit.otherT }))
                .sort((a, b) => a.t - b.t);

            // `getCurveIntersections` is approximate, so one crossing comes
            // back as several nearby hits. Each cluster is measured against
            // its first hit.
            const clusters: { t: number; otherT: number }[][] = [];
            for (const hit of hits) {
                const cluster = clusters.find(
                    members =>
                        Math.abs(hit.t - members[0]!.t) <= CROSSING_MERGE_T &&
                        Math.abs(hit.otherT - members[0]!.otherT) <=
                            CROSSING_MERGE_T
                );
                if (cluster === undefined) {
                    clusters.push([hit]);
                } else {
                    cluster.push(hit);
                }
            }

            const refined: { t: number; otherT: number; point: Point }[] = [];
            for (const members of clusters) {
                const meanT =
                    members.reduce((sum, hit) => sum + hit.t, 0) /
                    members.length;
                const meanOtherT =
                    members.reduce((sum, hit) => sum + hit.otherT, 0) /
                    members.length;
                const { t, u: otherT } = refineCrossing(
                    curve,
                    other.curve,
                    meanT,
                    meanOtherT
                );

                const tangent = PointCal.unitVector(curve.derivative(t));
                const otherTangent = PointCal.unitVector(
                    other.curve.derivative(otherT)
                );
                const sin =
                    tangent.x * otherTangent.y - tangent.y * otherTangent.x;
                if (Math.abs(sin) < CROSSING_MIN_SIN) {
                    continue;
                }

                const point = curve.get(t);
                const touchesSharedJoint = (
                    [
                        [t0Joint, 0],
                        [t1Joint, 1],
                    ] as const
                ).some(
                    ([joint, endT]) =>
                        (other.t0Joint === joint || other.t1Joint === joint) &&
                        PointCal.distanceBetweenPoints(point, curve.get(endT)) <
                            JOINT_TOUCH_DISTANCE
                );
                if (touchesSharedJoint) {
                    continue;
                }

                refined.push({ t, otherT, point });
            }

            // On a short segment the raw hits of one crossing can fall into
            // several clusters that refine to the same root, so crossings
            // that close are one, and the first in `t` order is kept.
            const kept: typeof refined = [];
            for (const crossing of refined.sort((a, b) => a.t - b.t)) {
                const duplicate = kept.some(
                    earlier =>
                        PointCal.distanceBetweenPoints(
                            earlier.point,
                            crossing.point
                        ) < CROSSING_DEDUPE_DISTANCE
                );
                if (!duplicate) {
                    kept.push(crossing);
                    crossings.push({
                        otherSegment: other.trackSegmentNumber,
                        t: crossing.t,
                        otherT: crossing.otherT,
                    });
                }
            }
        }
        return crossings.sort((a, b) => a.t - b.t);
    }

    /**
     * The segments with an end at joint `jointNumber`, which sits at
     * `position`, in ascending order. It takes the position so that it stays
     * an R-tree lookup, and still works after a segment has been removed.
     */
    getSegmentsAtJoint(jointNumber: number, position: Point): number[] {
        const box = new Rectangle(
            position.x - 0.5,
            position.y - 0.5,
            position.x + 0.5,
            position.y + 0.5
        );
        // A segment near `position` that ends at the joint somewhere else
        // doesn't count, so the end itself has to be in the box.
        const inBox = (point: Point) =>
            point.x >= box.minX &&
            point.x <= box.maxX &&
            point.y >= box.minY &&
            point.y <= box.maxY;
        const found = new Set<number>();
        for (const entry of this._internalRTree.search(box)) {
            if (
                (entry.t0Joint === jointNumber && inBox(entry.curve.get(0))) ||
                (entry.t1Joint === jointNumber && inBox(entry.curve.get(1)))
            ) {
                found.add(entry.trackSegmentNumber);
            }
        }
        return [...found].sort((a, b) => a - b);
    }

    onTrackSegmentEdge(position: Point): ProjectionInfo | null {
        let minDistance = Infinity;
        let projectionInfo: ProjectionInfo | null = null;
        const bbox = new Rectangle(
            position.x - 10,
            position.y - 10,
            position.x + 10,
            position.y + 10
        );
        const possibleTrackSegments = this._internalRTree.search(bbox);
        possibleTrackSegments.forEach(trackSegment => {
            const res = trackSegment.curve.getProjection(position);
            if (res != null) {
                const distance = PointCal.distanceBetweenPoints(
                    position,
                    res.projection
                );
                const existingWidth =
                    trackSegment.bedWidth ?? trackSegment.gauge;
                const newWidth = this._newSegmentStyle.bed
                    ? this._newSegmentStyle.bedWidth
                    : trackSegment.gauge;
                const maxSnapDistance =
                    existingWidth / 2 + newWidth / 2 + this._projectionBuffer;
                if (
                    distance < minDistance &&
                    distance < maxSnapDistance &&
                    distance > trackSegment.gauge / 2
                ) {
                    minDistance = distance;
                    const tangent = PointCal.unitVector(
                        trackSegment.curve.derivative(res.tVal)
                    );
                    const curvature = trackSegment.curve.curvature(res.tVal);
                    const direction = PointCal.unitVectorFromA2B(
                        res.projection,
                        position
                    );
                    const angle = PointCal.angleFromA2B(tangent, direction);
                    let orthogonalDirection = PointCal.unitVector({
                        x: -tangent.y,
                        y: tangent.x,
                    });
                    if (angle < 0) {
                        orthogonalDirection = PointCal.multiplyVectorByScalar(
                            orthogonalDirection,
                            -1
                        );
                    }
                    const projectedPosition = PointCal.addVector(
                        res.projection,
                        PointCal.multiplyVectorByScalar(
                            orthogonalDirection,
                            existingWidth / 2 + newWidth / 2
                        )
                    );
                    if (projectionInfo === null) {
                        const curveIsSloped =
                            trackSegment.elevation.from !==
                            trackSegment.elevation.to;
                        const elevation = curveIsSloped
                            ? getElevationAtT(res.tVal, {
                                  elevation: {
                                      from:
                                          trackSegment.elevation.from *
                                          LEVEL_HEIGHT,
                                      to:
                                          trackSegment.elevation.to *
                                          LEVEL_HEIGHT,
                                  },
                              })
                            : trackSegment.elevation.from;
                        projectionInfo = {
                            curve: trackSegment.trackSegmentNumber,
                            atT: res.tVal,
                            projectionPoint: projectedPosition,
                            t0Joint: trackSegment.t0Joint,
                            t1Joint: trackSegment.t1Joint,
                            tangent,
                            curvature,
                            elevation: {
                                curveIsSloped: curveIsSloped,
                                elevation: elevation,
                            },
                        };
                        return;
                    }
                    projectionInfo.atT = res.tVal;
                    projectionInfo.projectionPoint = projectedPosition;
                    projectionInfo.curve = trackSegment.trackSegmentNumber;
                    projectionInfo.t0Joint = trackSegment.t0Joint;
                    projectionInfo.t1Joint = trackSegment.t1Joint;
                    projectionInfo.tangent = tangent;
                    projectionInfo.curvature = curvature;
                }
            }
        });
        return projectionInfo;
    }

    projectOnCurve(position: Point): ProjectionInfo | null {
        let minDistance = Infinity;
        let projectionInfo: ProjectionInfo | null = null;
        const searchRadius = 10;
        const bbox = new Rectangle(
            position.x - searchRadius,
            position.y - searchRadius,
            position.x + searchRadius,
            position.y + searchRadius
        );
        const possibleTrackSegments = this._internalRTree.search(bbox);
        possibleTrackSegments.forEach(trackSegment => {
            const res = trackSegment.curve.getProjection(position);
            if (res != null) {
                const distance = PointCal.distanceBetweenPoints(
                    position,
                    res.projection
                );
                const tangent = trackSegment.curve.derivative(res.tVal);
                const curvature = trackSegment.curve.curvature(res.tVal);
                if (
                    distance < minDistance &&
                    distance < trackSegment.gauge / 2
                ) {
                    minDistance = distance;
                    if (projectionInfo === null) {
                        const curveIsSloped =
                            trackSegment.elevation.from !==
                            trackSegment.elevation.to;
                        const elevation = curveIsSloped
                            ? getElevationAtT(res.tVal, {
                                  elevation: {
                                      from:
                                          trackSegment.elevation.from *
                                          LEVEL_HEIGHT,
                                      to:
                                          trackSegment.elevation.to *
                                          LEVEL_HEIGHT,
                                  },
                              })
                            : trackSegment.elevation.from;
                        projectionInfo = {
                            curve: trackSegment.trackSegmentNumber,
                            atT: res.tVal,
                            projectionPoint: res.projection,
                            t0Joint: trackSegment.t0Joint,
                            t1Joint: trackSegment.t1Joint,
                            tangent,
                            curvature,
                            elevation: {
                                curveIsSloped: curveIsSloped,
                                elevation: elevation,
                            },
                        };
                        return;
                    }
                    projectionInfo.atT = res.tVal;
                    projectionInfo.projectionPoint = res.projection;
                    projectionInfo.curve = trackSegment.trackSegmentNumber;
                    projectionInfo.t0Joint = trackSegment.t0Joint;
                    projectionInfo.t1Joint = trackSegment.t1Joint;
                    projectionInfo.tangent = tangent;
                    projectionInfo.curvature = curvature;
                }
            }
        });
        return projectionInfo;
    }

    /**
     * Like projectOnCurve but uses a wider acceptance radius instead of gauge/2.
     * Used by platform placement tools that need a more forgiving hit area.
     */
    projectOnCurveWide(
        position: Point,
        maxDistance: number = 5
    ): ProjectionInfo | null {
        let minDistance = Infinity;
        let projectionInfo: ProjectionInfo | null = null;
        const searchRadius = Math.max(10, maxDistance);
        const bbox = new Rectangle(
            position.x - searchRadius,
            position.y - searchRadius,
            position.x + searchRadius,
            position.y + searchRadius
        );
        const possibleTrackSegments = this._internalRTree.search(bbox);
        possibleTrackSegments.forEach(trackSegment => {
            const res = trackSegment.curve.getProjection(position);
            if (res != null) {
                const distance = PointCal.distanceBetweenPoints(
                    position,
                    res.projection
                );
                if (distance < minDistance && distance < maxDistance) {
                    minDistance = distance;
                    const tangent = trackSegment.curve.derivative(res.tVal);
                    const curvature = trackSegment.curve.curvature(res.tVal);
                    const curveIsSloped =
                        trackSegment.elevation.from !==
                        trackSegment.elevation.to;
                    const elevation = curveIsSloped
                        ? getElevationAtT(res.tVal, {
                              elevation: {
                                  from:
                                      trackSegment.elevation.from *
                                      LEVEL_HEIGHT,
                                  to: trackSegment.elevation.to * LEVEL_HEIGHT,
                              },
                          })
                        : trackSegment.elevation.from;
                    projectionInfo = {
                        curve: trackSegment.trackSegmentNumber,
                        atT: res.tVal,
                        projectionPoint: res.projection,
                        t0Joint: trackSegment.t0Joint,
                        t1Joint: trackSegment.t1Joint,
                        tangent,
                        curvature,
                        elevation: {
                            curveIsSloped,
                            elevation,
                        },
                    };
                }
            }
        });
        return projectionInfo;
    }

    createCurveWithJoints(
        curve: BCurve,
        t0Joint: number,
        t1Joint: number,
        t0Elevation: ELEVATION,
        t1Elevation: ELEVATION,
        gauge: number = 1.067,
        excludeSegmentsForCollisionCheck: Set<number> = new Set(),
        /** Style for the new segment; defaults to the new-segment style. Splits pass the parent's style. */
        style: SegmentStyleFields = segmentFieldsFromStyle(
            this._newSegmentStyle
        )
    ): number {
        const experimentPositiveOffsets = offset2(curve, gauge / 2);
        const experimentNegativeOffsets = offset2(curve, -gauge / 2);
        const aabb = curve.AABB;
        const aabbRectangle = new Rectangle(
            aabb.min.x,
            aabb.min.y,
            aabb.max.x,
            aabb.max.y
        );
        const possibleCollisions = this._internalRTree.search(aabbRectangle);

        const collisions: {
            selfT: number;
            anotherCurve: { curve: BCurve; tVal: number };
        }[] = [];

        possibleCollisions
            .filter(
                segment =>
                    !excludeSegmentsForCollisionCheck.has(
                        segment.trackSegmentNumber
                    )
            )
            .forEach(segment => {
                const intersections = segment.curve
                    .getCurveIntersections(curve)
                    .map(intersection => {
                        return {
                            selfT: intersection.otherT,
                            anotherCurve: {
                                curve: segment.curve,
                                tVal: intersection.selfT,
                            },
                        };
                    });
                collisions.push(...intersections);
            });

        let startT = 0;

        const insertionT: number[] = [];
        const collisionT: number[] = [];

        if (t0Elevation !== t1Elevation) {
            // the new curve is sloped
            const internalIntersections = this.checkForCollisions(
                curve,
                excludeSegmentsForCollisionCheck
            );

            internalIntersections
                .sort((a, b) => a.selfT - b.selfT)
                .forEach(intersection => {
                    collisionT.push(intersection.selfT);
                    const insertT =
                        Math.round(((intersection.selfT + startT) / 2) * 100) /
                        100;
                    insertionT.push(insertT);
                    startT = intersection.selfT;
                });
        } else {
            // the new curve is flat
            const internalIntersections = this.checkForCollisions(
                curve,
                excludeSegmentsForCollisionCheck,
                true
            );

            internalIntersections
                .sort((a, b) => a.selfT - b.selfT)
                .forEach(intersection => {
                    collisionT.push(intersection.selfT);
                    const insertT =
                        Math.round(((intersection.selfT + startT) / 2) * 100) /
                        100;
                    insertionT.push(insertT);
                    startT = intersection.selfT;
                });
        }

        startT = 0;

        const splits: TrackSegmentSplit[] = [];

        if (insertionT.length === 0) {
            splits.push({
                curve: curve,
                elevation: {
                    from: t0Elevation * LEVEL_HEIGHT,
                    to: t1Elevation * LEVEL_HEIGHT,
                },
                tValInterval: { start: 0, end: 1 },
            });
        } else {
            {
                const [startingCurve, _] = curve.splitIntoCurves(insertionT[0]);
                const startElevation = getElevationAtT(startT, {
                    elevation: {
                        from: t0Elevation * LEVEL_HEIGHT,
                        to: t1Elevation * LEVEL_HEIGHT,
                    },
                });
                const endElevation = getElevationAtT(insertionT[0], {
                    elevation: {
                        from: t0Elevation * LEVEL_HEIGHT,
                        to: t1Elevation * LEVEL_HEIGHT,
                    },
                });
                splits.push({
                    curve: startingCurve,
                    elevation: { from: startElevation, to: endElevation },
                    tValInterval: { start: 0, end: insertionT[0] },
                });
            }

            for (let i = 0; i < insertionT.length - 1; i++) {
                const tVal = insertionT[i];
                const nextTVal = insertionT[i + 1];
                const [_, secondCurve] = curve.splitIn3Curves(tVal, nextTVal);
                const startElevation = getElevationAtT(tVal, {
                    elevation: {
                        from: t0Elevation * LEVEL_HEIGHT,
                        to: t1Elevation * LEVEL_HEIGHT,
                    },
                });
                const endElevation = getElevationAtT(nextTVal, {
                    elevation: {
                        from: t0Elevation * LEVEL_HEIGHT,
                        to: t1Elevation * LEVEL_HEIGHT,
                    },
                });
                splits.push({
                    curve: secondCurve,
                    elevation: { from: startElevation, to: endElevation },
                    tValInterval: { start: tVal, end: nextTVal },
                });
            }

            {
                const [_, endingCurve] = curve.splitIntoCurves(
                    insertionT[insertionT.length - 1]
                );
                const startElevation = getElevationAtT(
                    insertionT[insertionT.length - 1],
                    {
                        elevation: {
                            from: t0Elevation * LEVEL_HEIGHT,
                            to: t1Elevation * LEVEL_HEIGHT,
                        },
                    }
                );
                const endElevation = getElevationAtT(1, {
                    elevation: {
                        from: t0Elevation * LEVEL_HEIGHT,
                        to: t1Elevation * LEVEL_HEIGHT,
                    },
                });
                splits.push({
                    curve: endingCurve,
                    elevation: { from: startElevation, to: endElevation },
                    tValInterval: {
                        start: insertionT[insertionT.length - 1],
                        end: 1,
                    },
                });
            }
        }

        const trackSegmentEntry: TrackSegmentWithCollision = {
            curve: curve,
            t0Joint: t0Joint,
            t1Joint: t1Joint,
            elevation: {
                from: t0Elevation,
                to: t1Elevation,
            },
            collision: collisions,
            gauge,
            ...styleFieldsOf(style),
            splits: insertionT,
            splitCurves: splits,
        };

        const curveNumber = this._internalTrackCurveManager.createEntity({
            segment: trackSegmentEntry,
            offsets: {
                positive: experimentPositiveOffsets.points,
                negative: experimentNegativeOffsets.points,
            },
        });

        const trackSegmentTreeEntry: TrackSegmentWithCollisionAndNumber = {
            ...trackSegmentEntry,
            trackSegmentNumber: curveNumber,
        };

        const drawDataForSplits: (TrackSegmentDrawData & {
            positiveOffsets: Point[];
            negativeOffsets: Point[];
        })[] = [];

        splits.forEach(split => {
            const drawDataForSplit = makeTrackSegmentDrawDataFromSplit(
                split,
                trackSegmentEntry,
                curveNumber
            ) as TrackSegmentDrawData & {
                positiveOffsets: Point[];
                negativeOffsets: Point[];
                callback(index: number): void;
            };
            drawDataForSplit.callback = ((index: number) => {
                this._trackOrderMap.set(
                    JSON.stringify({
                        trackSegmentNumber: curveNumber,
                        tValInterval: split.tValInterval,
                    }),
                    index
                );
            }).bind(this);
            const insertIndex = trackSegmentDrawDataInsertIndex(
                this._persistedDrawData,
                drawDataForSplit
            );
            this._persistedDrawData.splice(insertIndex, 0, drawDataForSplit);
            drawDataForSplits.push(drawDataForSplit);
        });

        this._addObservable.notify(-1, drawDataForSplits);

        this._internalRTree.insert(aabbRectangle, trackSegmentTreeEntry);
        this._drawDataDirty = true;
        this._addTrackSegmentObservable.notify(curveNumber, trackSegmentEntry);
        return curveNumber;
    }

    destroyCurve(curveNumber: number): void {
        const trackSegment =
            this._internalTrackCurveManager.getEntity(curveNumber);
        if (trackSegment === null) {
            console.warn('track segment not found');
            return;
        }
        const trackSegmentTreeEntry = this._treeEntryFor(
            curveNumber,
            trackSegment.segment.curve
        );
        if (trackSegmentTreeEntry == null) {
            console.warn('track segment tree entry not found');
            return;
        }
        this._internalRTree.removeByData(trackSegmentTreeEntry);
        this._internalTrackCurveManager.destroyEntity(curveNumber);
        this._drawDataDirty = true;

        const removedKeys: string[] = [];
        this._persistedDrawData = this._persistedDrawData.filter(entry => {
            if (entry.originalTrackSegment.trackSegmentNumber === curveNumber) {
                const key = JSON.stringify({
                    trackSegmentNumber: curveNumber,
                    tValInterval: entry.originalTrackSegment.tValInterval,
                });
                removedKeys.push(key);
                return false;
            }
            return true;
        });

        for (const key of removedKeys) {
            this._deleteObservable.notify(key);
        }
        this._removeTrackSegmentObservable.notify(curveNumber);
    }

    getPreviewDrawData(
        curve: BCurve,
        t0Elevation: ELEVATION,
        t1Elevation: ELEVATION,
        gauge: number = 1.067,
        excludeSegmentsForCollisionCheck: Set<number> = new Set()
    ): {
        index: number;
        drawData: TrackSegmentDrawData & {
            positiveOffsets: Point[];
            negativeOffsets: Point[];
        };
    }[] {
        const experimentPositiveOffsets = offset2(curve, gauge / 2);
        const experimentNegativeOffsets = offset2(curve, -gauge / 2);
        const aabb = curve.AABB;
        const aabbRectangle = new Rectangle(
            aabb.min.x,
            aabb.min.y,
            aabb.max.x,
            aabb.max.y
        );
        const possibleCollisions = this._internalRTree.search(aabbRectangle);

        const collisions: {
            selfT: number;
            anotherCurve: { curve: BCurve; tVal: number };
        }[] = [];

        possibleCollisions
            .filter(
                segment =>
                    !excludeSegmentsForCollisionCheck.has(
                        segment.trackSegmentNumber
                    )
            )
            .forEach(segment => {
                const intersections = segment.curve
                    .getCurveIntersections(curve)
                    .map(intersection => {
                        return {
                            selfT: intersection.otherT,
                            anotherCurve: {
                                curve: segment.curve,
                                tVal: intersection.selfT,
                            },
                        };
                    });
                collisions.push(...intersections);
            });

        let startT = 0;

        const insertionT: number[] = [];
        const collisionT: number[] = [];

        if (t0Elevation !== t1Elevation) {
            // the new curve is sloped
            const internalIntersections = this.checkForCollisions(
                curve,
                excludeSegmentsForCollisionCheck
            );

            internalIntersections
                .sort((a, b) => a.selfT - b.selfT)
                .forEach(intersection => {
                    collisionT.push(intersection.selfT);
                    const insertT =
                        Math.round(((intersection.selfT + startT) / 2) * 100) /
                        100;
                    insertionT.push(insertT);
                    startT = intersection.selfT;
                });
        } else {
            // the new curve is flat
            const internalIntersections = this.checkForCollisions(
                curve,
                excludeSegmentsForCollisionCheck,
                true
            );

            internalIntersections
                .sort((a, b) => a.selfT - b.selfT)
                .forEach(intersection => {
                    collisionT.push(intersection.selfT);
                    const insertT =
                        Math.round(((intersection.selfT + startT) / 2) * 100) /
                        100;
                    insertionT.push(insertT);
                    startT = intersection.selfT;
                });
        }

        startT = 0;

        const splits: TrackSegmentSplit[] = [];

        if (insertionT.length === 0) {
            splits.push({
                curve: curve,
                elevation: {
                    from: t0Elevation * LEVEL_HEIGHT,
                    to: t1Elevation * LEVEL_HEIGHT,
                },
                tValInterval: { start: 0, end: 1 },
            });
        } else {
            {
                const [startingCurve, _] = curve.splitIntoCurves(insertionT[0]);
                const startElevation = getElevationAtT(startT, {
                    elevation: {
                        from: t0Elevation * LEVEL_HEIGHT,
                        to: t1Elevation * LEVEL_HEIGHT,
                    },
                });
                const endElevation = getElevationAtT(insertionT[0], {
                    elevation: {
                        from: t0Elevation * LEVEL_HEIGHT,
                        to: t1Elevation * LEVEL_HEIGHT,
                    },
                });
                splits.push({
                    curve: startingCurve,
                    elevation: { from: startElevation, to: endElevation },
                    tValInterval: { start: 0, end: insertionT[0] },
                });
            }

            for (let i = 0; i < insertionT.length - 1; i++) {
                const tVal = insertionT[i];
                const nextTVal = insertionT[i + 1];
                const [_, secondCurve] = curve.splitIn3Curves(tVal, nextTVal);
                const startElevation = getElevationAtT(tVal, {
                    elevation: {
                        from: t0Elevation * LEVEL_HEIGHT,
                        to: t1Elevation * LEVEL_HEIGHT,
                    },
                });
                const endElevation = getElevationAtT(nextTVal, {
                    elevation: {
                        from: t0Elevation * LEVEL_HEIGHT,
                        to: t1Elevation * LEVEL_HEIGHT,
                    },
                });
                splits.push({
                    curve: secondCurve,
                    elevation: { from: startElevation, to: endElevation },
                    tValInterval: { start: tVal, end: nextTVal },
                });
            }

            {
                const [_, endingCurve] = curve.splitIntoCurves(
                    insertionT[insertionT.length - 1]
                );
                const startElevation = getElevationAtT(
                    insertionT[insertionT.length - 1],
                    {
                        elevation: {
                            from: t0Elevation * LEVEL_HEIGHT,
                            to: t1Elevation * LEVEL_HEIGHT,
                        },
                    }
                );
                const endElevation = getElevationAtT(1, {
                    elevation: {
                        from: t0Elevation * LEVEL_HEIGHT,
                        to: t1Elevation * LEVEL_HEIGHT,
                    },
                });
                splits.push({
                    curve: endingCurve,
                    elevation: { from: startElevation, to: endElevation },
                    tValInterval: {
                        start: insertionT[insertionT.length - 1],
                        end: 1,
                    },
                });
            }
        }

        const trackSegmentEntry: TrackSegmentWithCollision = {
            curve: curve,
            t0Joint: -1,
            t1Joint: -1,
            elevation: {
                from: t0Elevation,
                to: t1Elevation,
            },
            collision: collisions,
            gauge,
            ...segmentFieldsFromStyle(this._newSegmentStyle),
            splits: insertionT,
            splitCurves: splits,
        };

        const drawDataForSplits = splits.map(split => {
            const drawDataForSplit = makeTrackSegmentDrawDataFromSplit(
                split,
                trackSegmentEntry,
                -1
            );
            const positiveOffsets = offset2(split.curve, gauge / 2).points;
            const negativeOffsets = offset2(split.curve, -gauge / 2).points;
            return {
                // index: trackSegmentDrawDataInsertIndex(this._persistedDrawData, drawDataForSplit),
                index: -1,
                drawData: drawDataForSplit,
                positiveOffsets,
                negativeOffsets,
            };
        });

        return drawDataForSplits;
    }

    onDelete(callback: (key: string) => void, options?: SubscriptionOptions) {
        return this._deleteObservable.subscribe(callback, options);
    }

    onAdd(
        callback: (
            index: number,
            drawData: (TrackSegmentDrawData & {
                positiveOffsets: Point[];
                negativeOffsets: Point[];
            })[]
        ) => void,
        options?: SubscriptionOptions
    ) {
        return this._addObservable.subscribe(callback, options);
    }

    onAddTrackSegment(
        callback: (
            curveNumber: number,
            trackSegment: TrackSegmentWithCollision
        ) => void,
        options?: SubscriptionOptions
    ) {
        return this._addTrackSegmentObservable.subscribe(callback, options);
    }

    onRemoveTrackSegment(
        callback: (curveNumber: number) => void,
        options?: SubscriptionOptions
    ) {
        return this._removeTrackSegmentObservable.subscribe(callback, options);
    }

    get livingEntities(): number[] {
        return this._internalTrackCurveManager.getLivingEntitesIndex();
    }

    get trackOffsets(): { positive: Point[]; negative: Point[] }[] {
        return this._internalTrackCurveManager
            .getLivingEntities()
            .map(entity => entity.offsets);
    }

    onWhichDrawData(position: { trackSegmentNumber: number; tVal: number }): {
        trackSegmentNumber: number;
        tValInterval: { start: number; end: number };
    } | null {
        const trackSegment = this._internalTrackCurveManager.getEntity(
            position.trackSegmentNumber
        );
        if (trackSegment == null) {
            return null;
        }
        const splits = trackSegment.segment.splitCurves;
        let left = 0;
        let right = splits.length - 1;

        while (left <= right) {
            const mid = left + Math.floor((right - left) / 2);
            const midSplit = splits[mid];
            if (
                position.tVal >= midSplit.tValInterval.start &&
                position.tVal <= midSplit.tValInterval.end
            ) {
                return {
                    trackSegmentNumber: position.trackSegmentNumber,
                    tValInterval: midSplit.tValInterval,
                };
            } else if (position.tVal < midSplit.tValInterval.start) {
                right = mid - 1;
            } else {
                left = mid + 1;
            }
        }
        return null;
    }

    /**
     * Serializes all living track segments into a JSON-safe format.
     * BCurves are stored as control point arrays; derived state (offsets,
     * collisions, RTree entries, draw data) is recomputed during deserialization.
     */
    serialize(): SerializedTrackSegment[] {
        return this._internalTrackCurveManager
            .getLivingEntitiesWithIndex()
            .map(({ index, entity }) => {
                const { lineStyle } = entity.segment;
                return {
                    segmentNumber: index,
                    controlPoints: entity.segment.curve
                        .getControlPoints()
                        .map(p => ({ x: p.x, y: p.y })),
                    t0Joint: entity.segment.t0Joint,
                    t1Joint: entity.segment.t1Joint,
                    elevation: {
                        from: entity.segment.elevation.from,
                        to: entity.segment.elevation.to,
                    },
                    gauge: entity.segment.gauge,
                    splits: [...entity.segment.splits],
                    trackStyle: entity.segment.trackStyle,
                    electrified: entity.segment.electrified,
                    catenarySide: entity.segment.catenarySide,
                    bed: entity.segment.bed,
                    bedWidth: entity.segment.bedWidth,
                    ...(lineStyle ? { lineStyle: { ...lineStyle } } : {}),
                };
            });
    }

    /**
     * Loads a segment with a specific ID, rebuilding all derived state
     * (offsets, split curves, RTree entry, draw data) from the stored essentials.
     * Fires add observers so that render systems are notified.
     */
    loadSegmentWithId(
        segmentNumber: number,
        curve: BCurve,
        t0Joint: number,
        t1Joint: number,
        t0Elevation: ELEVATION,
        t1Elevation: ELEVATION,
        gauge: number,
        splitTValues: number[],
        /** Saved style; missing fields get the defaults. */
        style: SegmentStyleFields = {}
    ): void {
        const experimentPositiveOffsets = offset2(curve, gauge / 2);
        const experimentNegativeOffsets = offset2(curve, -gauge / 2);
        const aabb = curve.AABB;
        const aabbRectangle = new Rectangle(
            aabb.min.x,
            aabb.min.y,
            aabb.max.x,
            aabb.max.y
        );

        // Compute collisions with existing segments in the RTree (same as
        // addTrackSegment). Without this, segments loaded from serialized data
        // have empty collision arrays and crossing detection won't work.
        const collisions: {
            selfT: number;
            anotherCurve: { curve: BCurve; tVal: number };
        }[] = [];

        const possibleCollisions = this._internalRTree.search(aabbRectangle);
        for (const segment of possibleCollisions) {
            const intersections = segment.curve
                .getCurveIntersections(curve)
                .map(intersection => ({
                    selfT: intersection.otherT,
                    anotherCurve: {
                        curve: segment.curve,
                        tVal: intersection.selfT,
                    },
                }));
            collisions.push(...intersections);
        }

        const splits: TrackSegmentSplit[] = [];

        if (splitTValues.length === 0) {
            splits.push({
                curve: curve,
                elevation: {
                    from: t0Elevation * LEVEL_HEIGHT,
                    to: t1Elevation * LEVEL_HEIGHT,
                },
                tValInterval: { start: 0, end: 1 },
            });
        } else {
            {
                const [startingCurve, _] = curve.splitIntoCurves(
                    splitTValues[0]
                );
                const startElevation = getElevationAtT(0, {
                    elevation: {
                        from: t0Elevation * LEVEL_HEIGHT,
                        to: t1Elevation * LEVEL_HEIGHT,
                    },
                });
                const endElevation = getElevationAtT(splitTValues[0], {
                    elevation: {
                        from: t0Elevation * LEVEL_HEIGHT,
                        to: t1Elevation * LEVEL_HEIGHT,
                    },
                });
                splits.push({
                    curve: startingCurve,
                    elevation: { from: startElevation, to: endElevation },
                    tValInterval: { start: 0, end: splitTValues[0] },
                });
            }

            for (let i = 0; i < splitTValues.length - 1; i++) {
                const tVal = splitTValues[i];
                const nextTVal = splitTValues[i + 1];
                const [_, secondCurve] = curve.splitIn3Curves(tVal, nextTVal);
                const startElevation = getElevationAtT(tVal, {
                    elevation: {
                        from: t0Elevation * LEVEL_HEIGHT,
                        to: t1Elevation * LEVEL_HEIGHT,
                    },
                });
                const endElevation = getElevationAtT(nextTVal, {
                    elevation: {
                        from: t0Elevation * LEVEL_HEIGHT,
                        to: t1Elevation * LEVEL_HEIGHT,
                    },
                });
                splits.push({
                    curve: secondCurve,
                    elevation: { from: startElevation, to: endElevation },
                    tValInterval: { start: tVal, end: nextTVal },
                });
            }

            {
                const [_, endingCurve] = curve.splitIntoCurves(
                    splitTValues[splitTValues.length - 1]
                );
                const startElevation = getElevationAtT(
                    splitTValues[splitTValues.length - 1],
                    {
                        elevation: {
                            from: t0Elevation * LEVEL_HEIGHT,
                            to: t1Elevation * LEVEL_HEIGHT,
                        },
                    }
                );
                const endElevation = getElevationAtT(1, {
                    elevation: {
                        from: t0Elevation * LEVEL_HEIGHT,
                        to: t1Elevation * LEVEL_HEIGHT,
                    },
                });
                splits.push({
                    curve: endingCurve,
                    elevation: { from: startElevation, to: endElevation },
                    tValInterval: {
                        start: splitTValues[splitTValues.length - 1],
                        end: 1,
                    },
                });
            }
        }

        const trackSegmentEntry: TrackSegmentWithCollision = {
            curve: curve,
            t0Joint: t0Joint,
            t1Joint: t1Joint,
            elevation: {
                from: t0Elevation,
                to: t1Elevation,
            },
            collision: collisions,
            gauge,
            ...withStyleDefaults(style),
            splits: splitTValues,
            splitCurves: splits,
        };

        this._internalTrackCurveManager.createEntityWithId(segmentNumber, {
            segment: trackSegmentEntry,
            offsets: {
                positive: experimentPositiveOffsets.points,
                negative: experimentNegativeOffsets.points,
            },
        });

        const trackSegmentTreeEntry: TrackSegmentWithCollisionAndNumber = {
            ...trackSegmentEntry,
            trackSegmentNumber: segmentNumber,
        };

        this._internalRTree.insert(aabbRectangle, trackSegmentTreeEntry);

        const drawDataForSplits: (TrackSegmentDrawData & {
            positiveOffsets: Point[];
            negativeOffsets: Point[];
        })[] = [];

        splits.forEach(split => {
            const drawDataForSplit = makeTrackSegmentDrawDataFromSplit(
                split,
                trackSegmentEntry,
                segmentNumber
            ) as TrackSegmentDrawData & {
                positiveOffsets: Point[];
                negativeOffsets: Point[];
                callback(index: number): void;
            };
            drawDataForSplit.callback = ((index: number) => {
                this._trackOrderMap.set(
                    JSON.stringify({
                        trackSegmentNumber: segmentNumber,
                        tValInterval: split.tValInterval,
                    }),
                    index
                );
            }).bind(this);
            const insertIndex = trackSegmentDrawDataInsertIndex(
                this._persistedDrawData,
                drawDataForSplit
            );
            this._persistedDrawData.splice(insertIndex, 0, drawDataForSplit);
            drawDataForSplits.push(drawDataForSplit);
        });

        this._addObservable.notify(-1, drawDataForSplits);
        this._drawDataDirty = true;
        this._addTrackSegmentObservable.notify(
            segmentNumber,
            trackSegmentEntry
        );
    }

    /**
     * Reconstructs a TrackCurveManager from serialized data,
     * preserving all original segment numbers. Derived state
     * (offsets, split curves, RTree, draw data) is recomputed.
     */
    static deserialize(data: SerializedTrackSegment[]): TrackCurveManager {
        const maxId = data.reduce(
            (max, s) => Math.max(max, s.segmentNumber),
            -1
        );
        const manager = new TrackCurveManager(Math.max(maxId + 1, 10));
        for (const segment of data) {
            const curve = new BCurve(segment.controlPoints);
            manager.loadSegmentWithId(
                segment.segmentNumber,
                curve,
                segment.t0Joint,
                segment.t1Joint,
                segment.elevation.from,
                segment.elevation.to,
                segment.gauge,
                segment.splits,
                {
                    trackStyle: segment.trackStyle,
                    electrified: segment.electrified,
                    catenarySide: segment.catenarySide,
                    bed: segment.bed,
                    bedWidth: segment.bedWidth,
                    lineStyle: segment.lineStyle,
                }
            );
        }
        return manager;
    }
}
