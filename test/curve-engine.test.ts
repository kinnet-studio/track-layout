import type { Point } from '@ue-too/math';
import { describe, expect, it, spyOn } from 'bun:test';

import { CurveCreationEngine } from '../src/editing/curve-engine.js';
import { createLayoutStateMachine } from '../src/editing/layout-kmt-state-machine.js';
import type { DeletionHighlightState } from '../src/editing/preview-types.js';
import { TrackGraph } from '../src/tracks/track.js';

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
        engine.setCurrentJointElevation(10);
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

describe('CurveCreationEngine refusal reasons', () => {
    it('has no refusal before anything is laid', () => {
        const { engine } = setup();
        expect(engine.lastCurveRefusal).toBeNull();
    });

    it('says incomplete when there is nothing to lay', () => {
        const { engine } = setup();
        expect(engine.endCurve()).toBeNull();
        expect(engine.lastCurveRefusal).toBe('incomplete');
    });

    it('says extendAngle when the start does not carry on from a track end', () => {
        const { engine } = withStraightTrack();
        lay(engine, { x: 100, y: 0 }, { x: 0, y: 30 });
        expect(engine.lastCurveRefusal).toBe('extendAngle');
    });

    it('says extendAngle when the end does not carry on from a track end', () => {
        const { engine } = withStraightTrack();
        lay(engine, { x: 50, y: 30 }, { x: 100, y: 0 });
        expect(engine.lastCurveRefusal).toBe('extendAngle');
    });

    it('says gaugeMismatch when extending a track of another gauge', () => {
        const { engine } = withStraightTrack();
        engine.setCurrentGauge(1.435);
        lay(engine, { x: 100, y: 0 }, { x: 200, y: 0 });
        expect(engine.lastCurveRefusal).toBe('gaugeMismatch');
    });

    it('says gaugeMismatch when branching off a track of another gauge', () => {
        const { engine } = withStraightTrack();
        engine.setCurrentGauge(1.435);
        lay(engine, { x: 50, y: 0.2 }, { x: 80, y: 40 });
        expect(engine.lastCurveRefusal).toBe('gaugeMismatch');
    });

    it('says gaugeMismatch when branching from a joint of another gauge', () => {
        const { engine } = withStraightTrack();
        lay(engine, { x: 100, y: 0 }, { x: 200, y: 0 });
        engine.setCurrentGauge(1.435);
        lay(engine, { x: 100, y: 0 }, { x: 150, y: 40 });
        expect(engine.lastCurveRefusal).toBe('gaugeMismatch');
    });

    it('says slopedBranch when a branch would change elevation', () => {
        const { engine } = withStraightTrack();
        engine.setCurrentJointElevation(10);
        lay(engine, { x: 50, y: 0.2 }, { x: 80, y: 40 });
        expect(engine.lastCurveRefusal).toBe('slopedBranch');
    });

    it('says slopedBranch when branching off a sloped segment', () => {
        const { graph, engine } = setup();
        const a = graph.createNewEmptyJoint({ x: 0, y: 0 }, { x: 1, y: 0 }, 0);
        const b = graph.createNewEmptyJoint(
            { x: 100, y: 0 },
            { x: 1, y: 0 },
            10
        );
        graph.connectJoints(a, b, [{ x: 50, y: 0 }]);
        lay(engine, { x: 50, y: 0.2 }, { x: 80, y: 40 });
        expect(engine.lastCurveRefusal).toBe('slopedBranch');
    });

    it('says protectedSegment when branching off a protected segment', () => {
        const { graph, engine } = withStraightTrack();
        graph.setSegmentProtectionCheck(() => true);
        lay(engine, { x: 50, y: 0.2 }, { x: 80, y: 40 });
        expect(engine.lastCurveRefusal).toBe('protectedSegment');
    });

    it('says alreadyJoined, and splits nothing, for a branch to its own track end', () => {
        const { graph, engine } = withStraightTrack();
        expect(lay(engine, { x: 60, y: 0.5 }, { x: 100, y: 0 })).toBeNull();
        expect(engine.lastCurveRefusal).toBe('alreadyJoined');
        expect(counts(graph)).toEqual({ segments: 1, joints: 2 });
    });

    it('says alreadyJoined, and splits nothing, for a joint to a branch off its own track', () => {
        const { graph, engine } = withStraightTrack();
        lay(engine, { x: 100, y: 0 }, { x: 200, y: 0 });
        expect(lay(engine, { x: 100, y: 0 }, { x: 40, y: 0.5 })).toBeNull();
        expect(engine.lastCurveRefusal).toBe('alreadyJoined');
        expect(counts(graph)).toEqual({ segments: 2, joints: 3 });
    });

    it('says alreadyJoined, and splits nothing, for two branches off one segment', () => {
        const { graph, engine } = withStraightTrack();
        expect(lay(engine, { x: 30, y: 0.2 }, { x: 70, y: 0.2 })).toBeNull();
        expect(engine.lastCurveRefusal).toBe('alreadyJoined');
        expect(counts(graph)).toEqual({ segments: 1, joints: 2 });
    });

    it('says alreadyJoined for two joints a segment already joins', () => {
        const { graph, engine } = withStraightTrack();
        lay(engine, { x: 100, y: 0 }, { x: 200, y: 0 });
        lay(engine, { x: 200, y: 0 }, { x: 300, y: 0 });
        expect(lay(engine, { x: 100, y: 0 }, { x: 200, y: 0 })).toBeNull();
        expect(engine.lastCurveRefusal).toBe('alreadyJoined');
        expect(counts(graph)).toEqual({ segments: 3, joints: 4 });
    });

    it('says graphRefused when the graph will not split the segment', () => {
        const { graph, engine } = withStraightTrack();
        spyOn(
            graph,
            'insertJointIntoTrackSegmentUsingTrackNumber'
        ).mockReturnValue(null);
        expect(lay(engine, { x: 50, y: 0.2 }, { x: 80, y: 40 })).toBeNull();
        expect(engine.lastCurveRefusal).toBe('graphRefused');
    });

    it('says graphRefused when the graph will not join the ends', () => {
        const { graph, engine } = setup();
        spyOn(graph, 'connectJoints').mockReturnValue(false);
        expect(lay(engine, { x: 0, y: 0 }, { x: 100, y: 0 })).toBeNull();
        expect(engine.lastCurveRefusal).toBe('graphRefused');
        expect(engine.lastCurveSuccess).toBe(false);
    });

    it('clears the refusal once a track is laid', () => {
        const { engine } = withStraightTrack();
        lay(engine, { x: 100, y: 0 }, { x: 0, y: 30 });
        lay(engine, { x: 100, y: 0 }, { x: 200, y: 0 });
        expect(engine.lastCurveSuccess).toBe(true);
        expect(engine.lastCurveRefusal).toBeNull();
    });

    it('tells observers each refusal, and nothing for a laid track', () => {
        const { engine } = withStraightTrack();
        const refusals: string[] = [];
        engine.onCurveRefused(refusal => refusals.push(refusal));

        lay(engine, { x: 100, y: 0 }, { x: 0, y: 30 });
        lay(engine, { x: 100, y: 0 }, { x: 200, y: 0 });
        engine.setCurrentGauge(1.435);
        lay(engine, { x: 200, y: 0 }, { x: 300, y: 0 });

        expect(refusals).toEqual(['extendAngle', 'gaugeMismatch']);
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
        const elevations: (number | null)[] = [];
        engine.onTensionChange(t => tensions.push(t));
        engine.onElevationChange(e => elevations.push(e));

        engine.bumpTension();
        engine.setCurrentJointElevation(10);

        expect(tensions).toEqual([1.1]);
        expect(engine.currentTension).toBe(1.1);
        expect(elevations).toEqual([10]);
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

describe('CurveCreationEngine elevation step and gradient', () => {
    function withElevationLog() {
        const { engine } = setup();
        const log: (number | null)[] = [];
        engine.onElevationChange(e => log.push(e));
        return { engine, log };
    }

    it('steps the current height to multiples of the step', () => {
        const { engine, log } = withElevationLog();
        engine.setCurrentJointElevation(12.35);
        engine.bumpCurrentJointElevation();
        expect(log.at(-1)).toBe(13);
        engine.setElevationStep(0.5);
        engine.lowerCurrentJointElevation();
        expect(log.at(-1)).toBe(12.5);
    });

    it('rounds the typed height to a centimetre', () => {
        const { engine, log } = withElevationLog();
        engine.setCurrentJointElevation(12.345);
        expect(log.at(-1)).toBe(12.35);
    });

    it('clamps the typed height and steps within the range', () => {
        const { engine, log } = withElevationLog();
        engine.setCurrentJointElevation(250);
        expect(log.at(-1)).toBe(200);
        engine.bumpCurrentJointElevation();
        expect(log.at(-1)).toBe(200);
    });

    it('refuses a step below a centimetre', () => {
        const { engine } = setup();
        expect(() => engine.setElevationStep(0.001)).toThrow(RangeError);
        expect(engine.elevationStep).toBe(1);
    });

    it('rounds the step to a centimetre', () => {
        const { engine } = setup();
        engine.setElevationStep(0.254);
        expect(engine.elevationStep).toBe(0.25);
    });

    it('steps the start before the first click and the end after it', () => {
        const { engine } = setup();
        const machine = createLayoutStateMachine(engine);
        engine.setElevationStep(2);
        engine.setCurrentJointElevation(0);
        machine.happens('startLayout');
        machine.happens('pointerMove', { x: 0, y: 0 });
        machine.happens('arrowUp');
        expect(engine.newStartJointType?.elevation).toBe(2);
        machine.happens('leftPointerUp', { x: 0, y: 0 });
        machine.happens('pointerMove', { x: 100, y: 0 });
        machine.happens('arrowUp');
        machine.happens('arrowUp');
        expect(engine.newStartJointType?.elevation).toBe(2);
        expect(engine.newEndJointType?.elevation).toBe(6);
    });

    it('gives the gradient of the preview from start to end', () => {
        const { engine } = setup();
        engine.setCurrentJointElevation(0);
        engine.hoverForStartingPoint({ x: 0, y: 0 });
        engine.startCurve();
        engine.setCurrentJointElevation(3);
        engine.hoveringForEndJoint({ x: 100, y: 0 });
        expect(engine.previewGradient).toBeCloseTo(3, 6);
        engine.setCurrentJointElevation(-3);
        engine.hoveringForEndJoint({ x: 100, y: 0 });
        expect(engine.previewGradient).toBeCloseTo(-3, 6);
    });

    it('has no gradient without a preview', () => {
        const { engine } = setup();
        expect(engine.previewGradient).toBeNull();
    });
});
