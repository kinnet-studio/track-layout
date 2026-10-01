import type { Point } from '@ue-too/math';
import { describe, expect, it } from 'bun:test';

import {
    DualSpinePlacementEngine,
    type DualSpineStates,
    createDualSpinePlacementStateMachine,
} from '../src/station-placement/dual-spine-placement-state-machine.js';
import { computePlatformOffset } from '../src/stations/platform-offset.js';
import { StationManager } from '../src/stations/station-manager.js';
import { TrackAlignedPlatformManager } from '../src/stations/track-aligned-platform-manager.js';
import { TrackGraph } from '../src/tracks/track.js';
import { ELEVATION } from '../src/tracks/types.js';
import {
    RecordingPreview,
    bareStation,
    identity,
    layTrack,
} from './station-placement-helpers.js';

/**
 * Two parallel 0–100 tracks, A along y = 0 and B along y = 20 (B optionally
 * raised), a bare station between them, and the dual-spine machine started.
 */
function setup(trackBElevation: ELEVATION = ELEVATION.GROUND) {
    const graph = new TrackGraph();
    const trackA = layTrack(graph, [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
    ]);
    const trackB = layTrack(
        graph,
        [
            { x: 0, y: 20 },
            { x: 100, y: 20 },
        ],
        trackBElevation
    );
    const stations = new StationManager();
    const platforms = new TrackAlignedPlatformManager();
    const preview = new RecordingPreview();
    const hints: string[] = [];
    const engine = new DualSpinePlacementEngine(
        graph,
        identity,
        stations,
        platforms,
        preview,
        key => hints.push(key)
    );
    const machine = createDualSpinePlacementStateMachine(engine);
    const stationId = stations.createStation(bareStation({ x: 50, y: 10 }));
    machine.happens('startPlacement', { stationId });
    return {
        graph,
        trackA,
        trackB,
        stations,
        platforms,
        preview,
        hints,
        machine,
        stationId,
    };
}

type Machine = ReturnType<typeof setup>['machine'];

const click = (machine: Machine, point: Point) => {
    machine.happens('pointerMove', point);
    machine.happens('leftPointerUp', point);
};

/** Spine A start and end anchors, then spine B's, from the latest preview. */
const anchors = (preview: RecordingPreview) => {
    const args = preview.lastArgs('showDualSpinePlacementPreview')!;
    return {
        aStart: args[4] as Point,
        aEnd: args[5] as Point,
        bStart: args[6] as Point,
        bEnd: args[7] as Point,
    };
};

/** Picks spine A left to right and spine B in the given order. */
function pickSpines(machine: Machine, bFrom: number, bTo: number) {
    click(machine, { x: 10, y: 3 });
    click(machine, { x: 90, y: 3 });
    click(machine, { x: bFrom, y: 17 });
    click(machine, { x: bTo, y: 17 });
}

describe('dual-spine placement: creating a platform pair', () => {
    it('picks both spines, draws both caps, and creates two platforms', () => {
        const {
            graph,
            trackA,
            trackB,
            stations,
            platforms,
            preview,
            hints,
            machine,
            stationId,
        } = setup();
        const segmentA = graph.getTrackSegmentWithJoints(trackA.segments[0])!;
        const offset = computePlatformOffset(segmentA.gauge, segmentA.bedWidth);
        expect(machine.currentState).toBe('PICK_SPINE_A_START');

        click(machine, { x: 10, y: 3 });
        expect(machine.currentState).toBe('PICK_SPINE_A_END');
        click(machine, { x: 90, y: 3 });
        expect(machine.currentState).toBe('PICK_SPINE_B_START');
        click(machine, { x: 10, y: 17 });
        expect(machine.currentState).toBe('PICK_SPINE_B_END');
        click(machine, { x: 90, y: 17 });
        expect(machine.currentState).toBe('DRAW_END_CAP_1');

        // Cap A runs from spine A's end to spine B's end.
        machine.happens('pointerMove', { x: 95, y: 10 });
        expect(preview.lastArgs('showCapDrawingHover')).toEqual([
            anchors(preview).aEnd,
            { x: 95, y: 10 },
            anchors(preview).bEnd,
            false,
        ]);
        click(machine, { x: 95, y: 10 });
        click(machine, anchors(preview).bEnd);
        expect(machine.currentState).toBe('DRAW_END_CAP_2');

        // Cap B runs from spine B's start back to spine A's start.
        click(machine, { x: 5, y: 10 });
        click(machine, anchors(preview).aStart);
        expect(machine.currentState).toBe('PICK_SPINE_A_START');

        expect(hints).toEqual([
            'hintDualPickSpineAStart',
            'hintDualPickSpineAEnd',
            'hintDualPickSpineBStart',
            'hintDualPickSpineBEnd',
            'hintDualDrawCap1',
            'hintDualDrawCap2',
            'hintPlatformCreated',
        ]);
        expect(preview.methods.at(-1)).toBe('hidePreview');

        const created = platforms.getAllPlatforms();
        expect(created).toHaveLength(2);
        const [a, b] = created;
        expect(a.platform.stationId).toBe(stationId);
        expect(b.platform.stationId).toBe(stationId);
        expect(a.platform.spine[0]).toMatchObject({
            trackSegment: trackA.segments[0],
            side: 1,
        });
        expect(b.platform.spine[0]).toMatchObject({
            trackSegment: trackB.segments[0],
            side: -1,
        });
        expect(a.platform.offset).toBe(offset);
        expect(b.platform.offset).toBe(offset);
        // Both platforms share the spines' midline; the drawn caps are not kept.
        expect(a.platform.outerVertices.length).toBeGreaterThan(0);
        expect(b.platform.outerVertices).toEqual(a.platform.outerVertices);
        expect(a.platform.outerVertices).not.toContainEqual({ x: 95, y: 10 });

        expect(stations.getStation(stationId)!.trackAlignedPlatforms).toEqual([
            a.id,
            b.id,
        ]);
    });

    it("keeps spine B as picked when its ends already face spine A's", () => {
        const { preview, machine } = setup();
        pickSpines(machine, 10, 90);
        const { aStart, aEnd, bStart, bEnd } = anchors(preview);
        expect(bStart.x).toBeCloseTo(aStart.x);
        expect(bEnd.x).toBeCloseTo(aEnd.x);
    });

    it('reverses spine B when it was picked the other way round', () => {
        const { platforms, preview, machine } = setup();
        pickSpines(machine, 90, 10);
        const { aStart, aEnd, bStart, bEnd } = anchors(preview);
        expect(bStart.x).toBeCloseTo(aStart.x);
        expect(bEnd.x).toBeCloseTo(aEnd.x);

        click(machine, anchors(preview).bEnd);
        click(machine, anchors(preview).aStart);
        const spineB = platforms.getAllPlatforms()[1].platform.spine[0];
        expect(spineB.tStart).toBeCloseTo(0.1);
        expect(spineB.tEnd).toBeCloseTo(0.9);
    });
});

describe('dual-spine placement: refusals', () => {
    it('refuses spine B on a track at another elevation', () => {
        const { machine, hints } = setup(ELEVATION.ABOVE_1);
        click(machine, { x: 10, y: 3 });
        click(machine, { x: 90, y: 3 });
        click(machine, { x: 10, y: 17 });
        expect(machine.currentState).toBe('PICK_SPINE_B_START');
        expect(hints).not.toContain('hintDualPickSpineBEnd');
    });

    it("a refused end click drops back to picking that spine's start", () => {
        const { machine } = setup();
        click(machine, { x: 10, y: 3 });
        click(machine, { x: 50, y: 50 });
        expect(machine.currentState).toBe('PICK_SPINE_A_START');

        click(machine, { x: 10, y: 3 });
        click(machine, { x: 90, y: 3 });
        click(machine, { x: 10, y: 17 });
        click(machine, { x: 50, y: 50 });
        expect(machine.currentState).toBe('PICK_SPINE_B_START');
    });
});

describe('dual-spine placement: leaving', () => {
    it('escape steps back one stage at a time', () => {
        const { machine, stationId } = setup();
        const steps: [number, DualSpineStates][] = [
            [1, 'PICK_SPINE_A_START'],
            [2, 'PICK_SPINE_A_START'],
            [3, 'PICK_SPINE_B_START'],
            [4, 'PICK_SPINE_A_START'],
        ];
        for (const [clicks, after] of steps) {
            machine.happens('endPlacement');
            machine.happens('startPlacement', { stationId });
            const points = [
                { x: 10, y: 3 },
                { x: 90, y: 3 },
                { x: 10, y: 17 },
                { x: 90, y: 17 },
            ];
            for (const point of points.slice(0, clicks)) click(machine, point);
            machine.happens('escapeKey');
            expect(machine.currentState).toBe(after);
        }
        machine.happens('escapeKey');
        expect(machine.currentState).toBe('IDLE');
    });

    it('escape from the second cap starts over', () => {
        const { platforms, preview, machine } = setup();
        pickSpines(machine, 10, 90);
        click(machine, anchors(preview).bEnd);
        expect(machine.currentState).toBe('DRAW_END_CAP_2');
        machine.happens('escapeKey');
        expect(machine.currentState).toBe('PICK_SPINE_A_START');
        expect(preview.methods.at(-1)).toBe('hidePreview');
        expect(platforms.getAllPlatforms()).toHaveLength(0);
    });

    it('endPlacement leaves the tool from a cap state', () => {
        const { machine } = setup();
        pickSpines(machine, 10, 90);
        machine.happens('endPlacement');
        expect(machine.currentState).toBe('IDLE');
    });
});
