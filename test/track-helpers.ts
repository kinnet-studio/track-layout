import { Point, PointCal } from '@ue-too/math';
import { expect } from 'bun:test';

import type { TrackGraph } from '../src/tracks/track.js';
import { ELEVATION } from '../src/tracks/types.js';

/**
 * Lays one segment from `from` to `to` through `control` (the midpoint by
 * default, which makes it straight) and returns its segment number. The joint
 * at `from` faces `control` and the one at `to` faces away from `control`, so
 * the segment's curve runs from `from` to `to`.
 */
export function layLine(
    graph: TrackGraph,
    from: Point,
    to: Point,
    elevation: ELEVATION = ELEVATION.GROUND,
    control: Point = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
): number {
    const a = graph.createNewEmptyJoint(
        from,
        PointCal.unitVector(PointCal.subVector(control, from)),
        elevation
    );
    const b = graph.createNewEmptyJoint(
        to,
        PointCal.unitVector(PointCal.subVector(to, control)),
        elevation
    );
    expect(graph.connectJoints(a, b, [control])).toBe(true);
    return graph.getJoint(a)!.connections.get(b)!;
}
