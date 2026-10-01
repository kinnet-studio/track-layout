/**
 * Builds the spine of a track-aligned platform between two picked points,
 * shared by the single- and dual-spine placement tools.
 */
import type { SpineEntry, TrackGraph } from '../index.js';

/**
 * Builds a spine path from `startSeg` to `endSeg` by walking through
 * non-branching joints using BFS.
 */
export function buildSpinePath(
    trackGraph: TrackGraph,
    startSeg: number,
    startT: number,
    side: 1 | -1,
    endSeg: number,
    endT: number
): SpineEntry[] | null {
    // BFS from startSeg to endSeg.
    type QueueEntry = { segId: number; path: number[] };
    const visited = new Set<number>();
    const queue: QueueEntry[] = [{ segId: startSeg, path: [startSeg] }];

    while (queue.length > 0) {
        const { segId, path } = queue.shift()!;

        if (segId === endSeg) {
            // Build spine entries from path.
            return pathToSpineEntries(trackGraph, path, startT, side, endT);
        }

        if (visited.has(segId)) continue;
        visited.add(segId);

        const segment = trackGraph.getTrackSegmentWithJoints(segId);
        if (segment === null) continue;

        // Try both joints of this segment.
        for (const jointId of [segment.t0Joint, segment.t1Joint]) {
            const joint = trackGraph.getJoint(jointId);
            if (joint === null) continue;

            // Only traverse through non-branching joints.
            if (joint.connections.size > 2) continue;

            for (const [, connectedSegId] of joint.connections) {
                if (!visited.has(connectedSegId) && connectedSegId !== segId) {
                    queue.push({
                        segId: connectedSegId,
                        path: [...path, connectedSegId],
                    });
                }
            }
        }
    }

    return null;
}

/**
 * Converts a sequence of segment IDs into SpineEntry objects.
 *
 * The side value is propagated from the user's original pick. At each
 * segment junction the tangent vectors of both curves are compared via dot
 * product: if they point in opposite directions the side is flipped so that
 * the offset stays on the same geometric side of the track.
 */
function pathToSpineEntries(
    trackGraph: TrackGraph,
    path: number[],
    startT: number,
    side: 1 | -1,
    endT: number
): SpineEntry[] {
    const entries: SpineEntry[] = [];
    let currentSide = side;

    for (let i = 0; i < path.length; i++) {
        const segId = path[i];
        const isFirst = i === 0;
        const isLast = i === path.length - 1;

        const segment = trackGraph.getTrackSegmentWithJoints(segId);

        let tStart: number;
        let tEnd: number;

        if (isFirst && isLast) {
            // Same segment — preserve user's drawing direction.
            tStart = startT;
            tEnd = endT;
        } else if (isFirst) {
            // First segment: determine exit direction toward next segment.
            if (segment !== null) {
                const nextSegId = path[i + 1];
                const nextSeg = trackGraph.getTrackSegmentWithJoints(nextSegId);
                if (nextSeg !== null) {
                    const exitT = sharedJointT(segment, nextSeg);
                    tStart = startT;
                    tEnd = exitT;
                } else {
                    tStart = startT;
                    tEnd = 1;
                }
            } else {
                tStart = startT;
                tEnd = 1;
            }
            // First segment always keeps the user's original side — no flip.
        } else {
            // Non-first segment: determine entry t and check for side flip.
            const prevSegId = path[i - 1];
            const prevSeg = trackGraph.getTrackSegmentWithJoints(prevSegId);

            let entryT: 0 | 1 = 0;

            if (segment !== null && prevSeg !== null) {
                entryT = sharedJointT(segment, prevSeg);

                // Compare tangent directions at the junction to decide side flip.
                const prevCurve = trackGraph.getTrackSegmentCurve(prevSegId);
                const thisCurve = trackGraph.getTrackSegmentCurve(segId);
                if (prevCurve !== null && thisCurve !== null) {
                    const prevExitT = sharedJointT(prevSeg, segment);
                    const prevTangent = prevCurve.derivative(prevExitT);
                    const thisTangent = thisCurve.derivative(entryT);
                    const dot =
                        prevTangent.x * thisTangent.x +
                        prevTangent.y * thisTangent.y;
                    if (dot < 0) {
                        currentSide = (currentSide * -1) as 1 | -1;
                    }
                }
            }

            if (isLast) {
                tStart = entryT;
                tEnd = endT;
            } else {
                // Middle segment: determine exit toward next segment.
                if (segment !== null) {
                    const nextSegId = path[i + 1];
                    const nextSeg =
                        trackGraph.getTrackSegmentWithJoints(nextSegId);
                    if (nextSeg !== null) {
                        tStart = entryT;
                        tEnd = sharedJointT(segment, nextSeg);
                    } else {
                        tStart = entryT;
                        tEnd = entryT === 0 ? 1 : 0;
                    }
                } else {
                    tStart = entryT;
                    tEnd = entryT === 0 ? 1 : 0;
                }
            }
        }

        entries.push({
            trackSegment: segId,
            tStart,
            tEnd,
            side: currentSide,
        });
    }

    return entries;
}

/**
 * Returns the t-value (0 or 1) on `seg` at the joint it shares with `other`.
 * Falls back to 1 if no shared joint is found.
 */
export function sharedJointT(
    seg: { t0Joint: number; t1Joint: number },
    other: { t0Joint: number; t1Joint: number }
): 0 | 1 {
    const otherJoints = new Set([other.t0Joint, other.t1Joint]);
    if (otherJoints.has(seg.t0Joint)) return 0;
    if (otherJoints.has(seg.t1Joint)) return 1;
    return 1; // fallback
}
