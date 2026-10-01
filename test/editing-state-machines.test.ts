import type { Point } from '@ue-too/math';
import { describe, expect, it } from 'bun:test';

import { CatenaryLayoutEngine } from '../src/editing/catenary-layout-engine.js';
import { createCatenaryLayoutStateMachine } from '../src/editing/catenary-layout-state-machine.js';
import { CurveCreationEngine } from '../src/editing/curve-engine.js';
import { DuplicateToSideEngine } from '../src/editing/duplicate-to-side-engine.js';
import { createDuplicateToSideStateMachine } from '../src/editing/duplicate-to-side-state-machine.js';
import {
    type JointDirectionContext,
    createJointDirectionStateMachine,
} from '../src/editing/joint-direction-state-machine.js';
import { createLayoutStateMachine } from '../src/editing/layout-kmt-state-machine.js';
import { TrackGraph } from '../src/tracks/track.js';

/** Window coordinates are world coordinates in these tests. */
const identity = (position: Point) => ({ ...position });

/** A graph holding one straight segment A(0,0) — B(100,0). */
function straightTrack() {
    const graph = new TrackGraph();
    const a = graph.createNewEmptyJoint({ x: 0, y: 0 }, { x: 1, y: 0 });
    const b = graph.createNewEmptyJoint({ x: 100, y: 0 }, { x: 1, y: 0 });
    graph.connectJoints(a, b, [{ x: 50, y: 0 }]);
    const segment = graph.getJoint(a)!.connections.get(b)!;
    return { graph, segment };
}

describe('layout state machine with a curve engine', () => {
    function setup() {
        const graph = new TrackGraph();
        const engine = new CurveCreationEngine(graph, identity);
        const machine = createLayoutStateMachine(engine);
        return { graph, engine, machine };
    }

    it('lays chained segments click by click', () => {
        const { graph, machine } = setup();
        machine.happens('startLayout');
        expect(machine.currentState).toBe('HOVER_FOR_STARTING_POINT');

        machine.happens('pointerMove', { x: 0, y: 0 });
        machine.happens('leftPointerUp', { x: 0, y: 0 });
        expect(machine.currentState).toBe('HOVER_FOR_ENDING_POINT');

        machine.happens('pointerMove', { x: 100, y: 0 });
        machine.happens('leftPointerUp', { x: 100, y: 0 });
        expect(machine.currentState).toBe('HOVER_FOR_ENDING_POINT');
        expect(graph.trackSegments).toHaveLength(1);

        // The end point became the next start: one more click extends it.
        machine.happens('pointerMove', { x: 200, y: 0 });
        machine.happens('leftPointerUp', { x: 200, y: 0 });
        expect(graph.trackSegments).toHaveLength(2);
        expect(graph.getJoints()).toHaveLength(3);
    });

    it('goes back to choosing a start when a commit is refused', () => {
        const { graph, machine } = setup();
        machine.happens('startLayout');
        machine.happens('pointerMove', { x: 0, y: 0 });
        machine.happens('leftPointerUp', { x: 0, y: 0 });
        // Click without moving: there is no preview curve, so endCurve fails.
        machine.happens('leftPointerUp', { x: 0, y: 0 });
        expect(machine.currentState).toBe('HOVER_FOR_STARTING_POINT');
        expect(graph.trackSegments).toHaveLength(0);
    });

    it('escape steps back from the end point, then leaves the tool', () => {
        const { machine } = setup();
        machine.happens('startLayout');
        machine.happens('pointerMove', { x: 0, y: 0 });
        machine.happens('leftPointerUp', { x: 0, y: 0 });
        machine.happens('escapeKey');
        expect(machine.currentState).toBe('HOVER_FOR_STARTING_POINT');
        machine.happens('escapeKey');
        expect(machine.currentState).toBe('IDLE');
    });

    it('deletes the clicked segment in deletion mode', () => {
        const { graph, machine } = setup();
        machine.happens('startLayout');
        machine.happens('pointerMove', { x: 0, y: 0 });
        machine.happens('leftPointerUp', { x: 0, y: 0 });
        machine.happens('pointerMove', { x: 100, y: 0 });
        machine.happens('leftPointerUp', { x: 100, y: 0 });

        machine.happens('startDeletion');
        expect(machine.currentState).toBe('HOVER_FOR_CURVE_DELETION');
        machine.happens('pointerMove', { x: 50, y: 0.2 });
        machine.happens('leftPointerUp', { x: 50, y: 0.2 });
        expect(graph.trackSegments).toHaveLength(0);

        machine.happens('endDeletion');
        expect(machine.currentState).toBe('HOVER_FOR_STARTING_POINT');
    });
});

describe('layout state machine curve-shape keys', () => {
    it('Q straightens the preview, a second Q and G/F change it again', () => {
        const graph = new TrackGraph();
        const engine = new CurveCreationEngine(graph, identity);
        const machine = createLayoutStateMachine(engine);
        const cps = () => engine.previewCurve!.curve.getControlPoints();
        const cross = (p: Point[]) =>
            (p[p.length - 1].x - p[0].x) * (p[1].y - p[0].y) -
            (p[p.length - 1].y - p[0].y) * (p[1].x - p[0].x);

        machine.happens('startLayout');
        machine.happens('pointerMove', { x: 0, y: 0 });
        machine.happens('leftPointerUp', { x: 0, y: 0 });
        machine.happens('pointerMove', { x: 100, y: 0 });
        machine.happens('leftPointerUp', { x: 100, y: 0 });
        machine.happens('pointerMove', { x: 200, y: 50 });
        expect(engine.previewCurve).toBeDefined();
        const before = cps().map(p => ({ x: p.x, y: p.y }));
        expect(Math.abs(cross(cps()))).toBeGreaterThan(1);

        machine.happens('Q');
        const straight = cps().map(p => ({ x: p.x, y: p.y }));
        expect(cross(cps())).toBeCloseTo(0);
        expect(straight).not.toEqual(before);

        machine.happens('Q');
        machine.happens('G');
        const after = cps().map(p => ({ x: p.x, y: p.y }));
        expect(after).not.toEqual(before);
    });
});

describe('catenary state machine with its engine', () => {
    it('selects a segment, flips the side and commits on a click away', () => {
        const { graph, segment } = straightTrack();
        const engine = new CatenaryLayoutEngine(graph, identity);
        const machine = createCatenaryLayoutStateMachine(engine);
        const commits: { segmentNumber: number; side: 1 | -1 }[] = [];
        engine.onCommit(commit => commits.push(commit));

        machine.happens('leftPointerUp', { x: 50, y: 0.2 });
        expect(machine.currentState).toBe('PREVIEWING');

        machine.happens('F');
        machine.happens('leftPointerUp', { x: 50, y: 30 });

        expect(commits).toEqual([{ segmentNumber: segment, side: -1 }]);
        expect(machine.currentState).toBe('IDLE_FOR_SOURCE');
    });
});

describe('duplicate-to-side state machine with its engine', () => {
    it('lays a parallel copy of the selected segment', () => {
        const { graph } = straightTrack();
        const engine = new DuplicateToSideEngine(graph, identity);
        const machine = createDuplicateToSideStateMachine(engine);

        machine.happens('leftPointerUp', { x: 50, y: 0.2 });
        expect(machine.currentState).toBe('PREVIEWING');
        machine.happens('leftPointerUp', { x: 50, y: 30 });

        expect(graph.trackSegments).toHaveLength(2);
        const copy = graph.trackSegments[1].curve.getControlPoints();
        const offset = copy[0].y;
        expect(Math.abs(offset)).toBeGreaterThan(0);
        expect(copy[copy.length - 1].y).toBeCloseTo(offset);
        expect(machine.currentState).toBe('IDLE_FOR_SOURCE');
    });
});

describe('joint-direction state machine', () => {
    /** One switch joint (number 7) at the origin with an eastward tangent. */
    function recordingContext() {
        const calls: string[] = [];
        const context: JointDirectionContext = {
            setup: () => {},
            cleanup: () => {},
            convert2WorldPosition: identity,
            getHoveredSwitchJoint: position =>
                Math.hypot(position.x, position.y) < 10 ? 7 : null,
            showHoverIndicator: joint => calls.push(`hover ${joint}`),
            clearHoverIndicator: () => calls.push('clear hover'),
            selectJoint: joint => calls.push(`select ${joint}`),
            deselectJoint: () => calls.push('deselect'),
            cycleDirection: (joint, direction) =>
                calls.push(`cycle ${joint} ${direction}`),
            getSelectedJointTangent: () => ({ x: 1, y: 0 }),
            getSelectedJointPosition: () => ({ x: 0, y: 0 }),
        };
        return { calls, context };
    }

    it('hovers, selects and cycles a switch by the side clicked', () => {
        const { calls, context } = recordingContext();
        const machine = createJointDirectionStateMachine(context);

        machine.happens('pointerMove', { x: 1, y: 0 });
        expect(machine.currentState).toBe('HOVERING');
        machine.happens('leftPointerDown', { x: 1, y: 0 });
        expect(machine.currentState).toBe('SELECTED');

        machine.happens('leftPointerDown', { x: 3, y: 0 });
        machine.happens('leftPointerDown', { x: -3, y: 0 });

        expect(calls).toEqual([
            'hover 7',
            'clear hover',
            'select 7',
            'cycle 7 tangent',
            'cycle 7 reverseTangent',
        ]);
    });

    it('deselects when clicking away from any switch', () => {
        const { calls, context } = recordingContext();
        const machine = createJointDirectionStateMachine(context);
        machine.happens('pointerMove', { x: 1, y: 0 });
        machine.happens('leftPointerDown', { x: 1, y: 0 });

        machine.happens('leftPointerDown', { x: 50, y: 50 });

        expect(calls.at(-1)).toBe('deselect');
        expect(machine.currentState).toBe('IDLE');
    });
});
