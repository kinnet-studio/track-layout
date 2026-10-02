import type { Point } from '@ue-too/math';
import { describe, expect, it, spyOn } from 'bun:test';

import { CurveCreationEngine } from '../src/editing/curve-engine.js';
import type { DeletionHighlightState } from '../src/editing/preview-types.js';
import { TrackGraph } from '../src/tracks/track.js';
import { ELEVATION } from '../src/tracks/types.js';

/** An engine whose window coordinates are world coordinates. */
function setup() {
    const graph = new TrackGraph();
    const engine = new CurveCreationEngine(graph, position => ({
        ...position,
    }));
    return { graph, engine };
}

/** Lays one curve the way the layout tool does; returns endCurve's result. */
function lay(engine: CurveCreationEngine, from: Point, to: Point) {
    engine.hoverForStartingPoint(from);
    engine.startCurve();
    engine.hoveringForEndJoint(to);
    return engine.endCurve();
}

describe('CurveCreationEngine construction', () => {
    it('edits the graph it is given', () => {
        const { graph, engine } = setup();
        lay(engine, { x: 0, y: 0 }, { x: 100, y: 0 });
        expect(graph.trackSegments).toHaveLength(1);
    });

    it('converts window positions with the injected function', () => {
        const engine = new CurveCreationEngine(new TrackGraph(), p => ({
            x: p.x * 2,
            y: p.y + 1,
        }));
        expect(engine.convert2WorldPosition({ x: 3, y: 4 })).toEqual({
            x: 6,
            y: 5,
        });
    });
});

/** A straight A(0,0) — B(100,0) laid through the engine. */
function withStraightTrack() {
    const context = setup();
    lay(context.engine, { x: 0, y: 0 }, { x: 100, y: 0 });
    return context;
}

const counts = (graph: TrackGraph) => ({
    segments: graph.trackSegments.length,
    joints: graph.getJoints().length,
});

describe('CurveCreationEngine start-joint snapping', () => {
    it('starts a brand-new joint in empty space', () => {
        const { engine } = setup();
        engine.hoverForStartingPoint({ x: 0, y: 0 });
        expect(engine.newStartJointType?.type).toBe('new');
    });

    it('extends from a dead-end joint', () => {
        const { engine } = withStraightTrack();
        engine.hoverForStartingPoint({ x: 100, y: 0 });
        expect(engine.newStartJointType?.type).toBe('extendingTrack');
    });

    it('branches from the middle of a curve', () => {
        const { engine } = withStraightTrack();
        engine.hoverForStartingPoint({ x: 50, y: 0.2 });
        expect(engine.newStartJointType?.type).toBe('branchCurve');
    });

    it('snaps beside a track as a constrained joint', () => {
        const { engine } = withStraightTrack();
        engine.hoverForStartingPoint({ x: 50, y: 1.2 });
        expect(engine.newStartJointType?.type).toBe('contrained');
    });

    it('branches from a joint that already joins two tracks', () => {
        const { engine } = withStraightTrack();
        lay(engine, { x: 100, y: 0 }, { x: 200, y: 0 });
        engine.hoverForStartingPoint({ x: 100, y: 0 });
        expect(engine.newStartJointType?.type).toBe('branchJoint');
    });
});

describe('CurveCreationEngine laying', () => {
    it('lays a segment between two new joints and returns the end point', () => {
        const { graph, engine } = setup();
        const end = lay(engine, { x: 0, y: 0 }, { x: 100, y: 0 });
        expect(end).toMatchObject({ x: 100, y: 0 });
        expect(engine.lastCurveSuccess).toBe(true);
        expect(counts(graph)).toEqual({ segments: 1, joints: 2 });
    });

    it('extends a dead end into a second segment', () => {
        const { graph, engine } = withStraightTrack();
        expect(lay(engine, { x: 100, y: 0 }, { x: 200, y: 0 })).not.toBeNull();
        expect(counts(graph)).toEqual({ segments: 2, joints: 3 });
    });

    it('branches from the middle of a curve by splitting it', () => {
        const { graph, engine } = withStraightTrack();
        expect(lay(engine, { x: 50, y: 0.2 }, { x: 80, y: 40 })).not.toBeNull();
        expect(counts(graph)).toEqual({ segments: 3, joints: 4 });
    });

    it('clears the preview after a commit', () => {
        const { engine } = withStraightTrack();
        expect(engine.previewCurve).toBeNull();
        expect(engine.newStartJointType).toBeNull();
    });
});

describe('CurveCreationEngine refused commits', () => {
    it('refuses to extend a dead end back over its own track', () => {
        const { graph, engine } = withStraightTrack();
        expect(lay(engine, { x: 100, y: 0 }, { x: 0, y: 30 })).toBeNull();
        expect(engine.lastCurveSuccess).toBe(false);
        expect(counts(graph)).toEqual({ segments: 1, joints: 2 });
    });

    it('refuses to extend a track with a different gauge', () => {
        const { graph, engine } = withStraightTrack();
        engine.setCurrentGauge(1.435);
        expect(lay(engine, { x: 100, y: 0 }, { x: 200, y: 0 })).toBeNull();
        expect(counts(graph)).toEqual({ segments: 1, joints: 2 });
    });

    it('refuses a sloped branch', () => {
        const { graph, engine } = withStraightTrack();
        engine.setCurrentJointElevation(ELEVATION.ABOVE_1);
        expect(lay(engine, { x: 50, y: 0.2 }, { x: 80, y: 40 })).toBeNull();
        expect(counts(graph)).toEqual({ segments: 1, joints: 2 });
    });

    it('refuses to branch from the middle of a protected segment', () => {
        const { graph, engine } = withStraightTrack();
        graph.setSegmentProtectionCheck(() => true);
        expect(lay(engine, { x: 50, y: 0.2 }, { x: 80, y: 40 })).toBeNull();
        expect(lay(engine, { x: 80, y: 40 }, { x: 50, y: 0.2 })).toBeNull();
        expect(counts(graph)).toEqual({ segments: 1, joints: 2 });
    });
});

describe('CurveCreationEngine deletion', () => {
    it('highlights the hovered segment and deletes it', () => {
        const { graph, engine } = withStraightTrack();
        const segment = graph
            .getJoints()[0]
            .joint.connections.values()
            .next().value!;
        const highlights: DeletionHighlightState[] = [];
        engine.onDeletionHighlightChange(state => highlights.push(state));

        engine.hoverForCurveDeletion({ x: 50, y: 0.2 });
        expect(highlights).toEqual([{ segmentNumber: segment }]);

        engine.deleteCurrentCurve();
        expect(counts(graph)).toEqual({ segments: 0, joints: 0 });
        expect(highlights.at(-1)).toBeNull();
    });
});

describe('CurveCreationEngine events', () => {
    it('publishes preview draw data while hovering and clears it on cancel', () => {
        const { engine } = setup();
        const previews: unknown[] = [];
        engine.onPreviewDrawDataChange(data => previews.push(data));

        engine.hoverForStartingPoint({ x: 0, y: 0 });
        engine.hoveringForEndJoint({ x: 100, y: 0 });
        expect(Array.isArray(previews.at(-1))).toBe(true);
        expect((previews.at(-1) as unknown[]).length).toBeGreaterThan(0);

        engine.cancelCurrentCurve();
        expect(previews.at(-1)).toBeUndefined();
    });

    it('publishes the start projection, or null away from track', () => {
        const { engine } = withStraightTrack();
        const projections: unknown[] = [];
        engine.onPreviewStartProjectionChange(p => projections.push(p));

        engine.hoverForStartingPoint({ x: 100, y: 0 });
        expect(projections.at(-1)).toMatchObject({
            hit: true,
            hitType: 'joint',
        });

        engine.hoverForStartingPoint({ x: 500, y: 500 });
        expect(projections.at(-1)).toBeNull();
    });

    it('reports tension and elevation changes', () => {
        const { engine } = setup();
        const tensions: number[] = [];
        const elevations: (ELEVATION | null)[] = [];
        engine.onTensionChange(t => tensions.push(t));
        engine.onElevationChange(e => elevations.push(e));

        engine.bumpTension();
        engine.setCurrentJointElevation(ELEVATION.ABOVE_1);

        expect(tensions).toEqual([1.1]);
        expect(engine.currentTension).toBe(1.1);
        expect(elevations).toEqual([ELEVATION.ABOVE_1]);
    });
});

describe('CurveCreationEngine.insertJointIntoTrackSegment', () => {
    it('returns the new joint number', () => {
        const { graph, engine } = withStraightTrack();
        const [a, b] = graph.getJoints().map(j => j.jointNumber);
        const m = engine.insertJointIntoTrackSegment(a, b, 0.5);
        expect(typeof m).toBe('number');
        expect(graph.getJoint(m!)).not.toBeNull();
    });

    it('returns null when the segment is protected', () => {
        const { graph, engine } = withStraightTrack();
        graph.setSegmentProtectionCheck(() => true);
        const [a, b] = graph.getJoints().map(j => j.jointNumber);
        expect(engine.insertJointIntoTrackSegment(a, b, 0.5)).toBeNull();
    });
});

describe('CurveCreationEngine console output', () => {
    it('does not dump the whole graph when committing or splitting', () => {
        const { graph, engine } = withStraightTrack();
        const segmentDump = spyOn(graph, 'logTrackSegments');
        const jointDump = spyOn(graph, 'logJoints');

        lay(engine, { x: 100, y: 0 }, { x: 200, y: 0 });
        const [a, b] = graph.getJoints().map(j => j.jointNumber);
        engine.insertJointIntoTrackSegment(a, b, 0.5);

        expect(segmentDump).not.toHaveBeenCalled();
        expect(jointDump).not.toHaveBeenCalled();
    });
});
