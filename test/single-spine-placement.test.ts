import type { Point } from '@ue-too/math';
import { describe, expect, it } from 'bun:test';

import {
    SINGLE_SPINE_HINT_KEYS,
    SingleSpinePlacementEngine,
    createSingleSpinePlacementStateMachine,
} from '../src/station-placement/single-spine-placement-state-machine.js';
import { computePlatformOffset } from '../src/stations/platform-offset.js';
import { StationManager } from '../src/stations/station-manager.js';
import { TrackAlignedPlatformManager } from '../src/stations/track-aligned-platform-manager.js';
import { TrackGraph } from '../src/tracks/track.js';
import {
    RecordingPreview,
    bareStation,
    identity,
    layTrack,
} from './station-placement-helpers.js';

/**
 * A 0–100 straight track (or `points`), a bare station at (50, 10), and the
 * single-spine machine already started for it.
 */
function setup(
    points: Point[] = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
    ],
    stationPosition: Point = { x: 50, y: 10 }
) {
    const graph = new TrackGraph();
    const track = layTrack(graph, points);
    const stations = new StationManager();
    const platforms = new TrackAlignedPlatformManager();
    const preview = new RecordingPreview();
    const hints: string[] = [];
    const engine = new SingleSpinePlacementEngine(
        graph,
        identity,
        stations,
        platforms,
        preview,
        key => hints.push(key)
    );
    const machine = createSingleSpinePlacementStateMachine(engine);
    const stationId = stations.createStation(bareStation(stationPosition));
    machine.happens('startPlacement', { stationId });
    return {
        graph,
        track,
        stations,
        platforms,
        preview,
        hints,
        machine,
        stationId,
    };
}

const click = (machine: ReturnType<typeof setup>['machine'], point: Point) => {
    machine.happens('pointerMove', point);
    machine.happens('leftPointerUp', point);
};

/** The start anchor from the most recent placement preview. */
const startAnchor = (preview: RecordingPreview) =>
    preview.lastArgs('showPlacementPreview')![2] as Point;

describe('single-spine placement: picking', () => {
    it('starts in PICK_START with the first hint', () => {
        const { machine, hints } = setup();
        expect(machine.currentState).toBe('PICK_START');
        expect(hints).toEqual(['hintPickStart']);
    });

    it('highlights the side of the track under the cursor, and hides it off the track', () => {
        const { graph, track, preview, machine } = setup();
        const segment = graph.getTrackSegmentWithJoints(track.segments[0])!;
        const offset = computePlatformOffset(segment.gauge, segment.bedWidth);

        machine.happens('pointerMove', { x: 50, y: 3 });
        const [segmentId, t, side, highlightOffset] =
            preview.lastArgs('showTrackHighlight')!;
        expect(segmentId).toBe(track.segments[0]);
        expect(t as number).toBeCloseTo(0.5);
        expect(side).toBe(1);
        expect(highlightOffset).toBe(offset);

        machine.happens('pointerMove', { x: 50, y: -3 });
        expect(preview.lastArgs('showTrackHighlight')![2]).toBe(-1);

        machine.happens('pointerMove', { x: 50, y: 50 });
        expect(preview.methods.at(-1)).toBe('hidePreview');
    });

    it('refuses a start pick off the track', () => {
        const { machine, hints } = setup();
        click(machine, { x: 50, y: 50 });
        expect(machine.currentState).toBe('PICK_START');
        expect(hints).toEqual(['hintPickStart']);
    });

    it('refuses a start pick more than 500 m from the station', () => {
        const { machine, hints } = setup(undefined, { x: 50, y: 600 });
        click(machine, { x: 50, y: 3 });
        expect(machine.currentState).toBe('PICK_START');
        expect(hints).toEqual(['hintPickStart']);
    });

    it('a refused end click drops back to PICK_START', () => {
        const { machine } = setup();
        click(machine, { x: 10, y: 3 });
        expect(machine.currentState).toBe('PICK_END');
        click(machine, { x: 50, y: 50 });
        expect(machine.currentState).toBe('PICK_START');
    });
});

describe('single-spine placement: creating a platform', () => {
    it('creates a platform from a spine on one segment and its outer vertices', () => {
        const {
            graph,
            track,
            stations,
            platforms,
            preview,
            hints,
            machine,
            stationId,
        } = setup();
        const segment = graph.getTrackSegmentWithJoints(track.segments[0])!;
        const offset = computePlatformOffset(segment.gauge, segment.bedWidth);
        let changes = 0;
        platforms.onChange(() => changes++);

        click(machine, { x: 10, y: 3 });
        click(machine, { x: 90, y: 3 });
        expect(machine.currentState).toBe('DRAW_OUTER');
        click(machine, { x: 90, y: 15 });
        click(machine, { x: 10, y: 15 });
        expect(platforms.getAllPlatforms()).toHaveLength(0);

        click(machine, startAnchor(preview));
        expect(machine.currentState).toBe('PICK_START');
        expect(hints).toEqual([
            'hintPickStart',
            'hintPickEnd',
            'hintDrawOuter',
            'hintPlatformCreated',
        ]);
        expect(preview.methods.at(-1)).toBe('hidePreview');

        const created = platforms.getAllPlatforms();
        expect(created).toHaveLength(1);
        const { id, platform } = created[0];
        expect(platform.stationId).toBe(stationId);
        expect(platform.spine).toHaveLength(1);
        expect(platform.spine[0]).toMatchObject({
            trackSegment: track.segments[0],
            side: 1,
        });
        expect(platform.spine[0].tStart).toBeCloseTo(0.1);
        expect(platform.spine[0].tEnd).toBeCloseTo(0.9);
        expect(platform.offset).toBe(offset);
        expect(platform.outerVertices).toEqual([
            { x: 90, y: 15 },
            { x: 10, y: 15 },
        ]);
        expect(platform.stopPositions.length).toBeGreaterThan(0);

        const station = stations.getStation(stationId)!;
        expect(station.trackAlignedPlatforms).toEqual([id]);
        // The station moved from (50, 10) onto the platform's first stop.
        expect(station.position.y).toBeCloseTo(0);
        // createPlatform notifies, then finalize notifies again after linking.
        expect(changes).toBe(2);
    });

    it('creates a platform with no outer vertices when the outline is closed at once', () => {
        const { platforms, preview, machine } = setup();
        click(machine, { x: 10, y: 3 });
        click(machine, { x: 90, y: 3 });
        click(machine, startAnchor(preview));
        expect(platforms.getAllPlatforms()[0].platform.outerVertices).toEqual(
            []
        );
    });

    it('forgets a half-picked spine when restarted for another station', () => {
        const { stations, platforms, preview, machine } = setup();
        click(machine, { x: 10, y: 3 });
        machine.happens('endPlacement');

        const second = stations.createStation(bareStation({ x: 50, y: -10 }));
        machine.happens('startPlacement', { stationId: second });
        expect(machine.currentState).toBe('PICK_START');
        click(machine, { x: 20, y: 3 });
        click(machine, { x: 80, y: 3 });
        click(machine, startAnchor(preview));

        const { platform } = platforms.getAllPlatforms()[0];
        expect(platform.stationId).toBe(second);
        expect(platform.spine[0].tStart).toBeCloseTo(0.2);
    });

    it('builds a spine across a joint that does not branch', () => {
        const { track, platforms, preview, machine } = setup(
            [
                { x: 0, y: 0 },
                { x: 100, y: 0 },
                { x: 200, y: 0 },
            ],
            { x: 100, y: 10 }
        );
        click(machine, { x: 50, y: 3 });
        click(machine, { x: 150, y: 3 });
        expect(machine.currentState).toBe('DRAW_OUTER');
        click(machine, { x: 150, y: 15 });
        click(machine, startAnchor(preview));

        const { platform } = platforms.getAllPlatforms()[0];
        expect(platform.spine).toHaveLength(2);
        expect(platform.spine[0]).toMatchObject({
            trackSegment: track.segments[0],
            tEnd: 1,
            side: 1,
        });
        expect(platform.spine[1]).toMatchObject({
            trackSegment: track.segments[1],
            tStart: 0,
            side: 1,
        });
        expect(platform.spine[0].tStart).toBeCloseTo(0.5);
        expect(platform.spine[1].tEnd).toBeCloseTo(0.5);
    });

    it('refuses a spine through a branching joint', () => {
        const { graph, track, platforms, hints, machine } = setup(
            [
                { x: 0, y: 0 },
                { x: 100, y: 0 },
                { x: 200, y: 0 },
            ],
            { x: 100, y: 10 }
        );
        const branchEnd = graph.createNewEmptyJoint(
            { x: 200, y: 40 },
            { x: 1, y: 0 }
        );
        graph.connectJoints(track.joints[1], branchEnd, [{ x: 150, y: 0 }]);

        click(machine, { x: 50, y: 3 });
        click(machine, { x: 150, y: 3 });
        expect(machine.currentState).toBe('PICK_START');
        expect(hints).not.toContain('hintDrawOuter');
        expect(platforms.getAllPlatforms()).toHaveLength(0);
    });
});

describe('single-spine placement: leaving', () => {
    it('escape steps back to PICK_START, then leaves the tool', () => {
        const { platforms, preview, machine } = setup();
        click(machine, { x: 10, y: 3 });
        machine.happens('escapeKey');
        expect(machine.currentState).toBe('PICK_START');
        expect(preview.methods.at(-1)).toBe('hidePreview');

        click(machine, { x: 10, y: 3 });
        click(machine, { x: 90, y: 3 });
        machine.happens('escapeKey');
        expect(machine.currentState).toBe('PICK_START');

        machine.happens('escapeKey');
        expect(machine.currentState).toBe('IDLE');
        expect(platforms.getAllPlatforms()).toHaveLength(0);
    });

    it('endPlacement leaves the tool from any state', () => {
        for (const clicks of [0, 1, 2]) {
            const { preview, machine } = setup();
            if (clicks >= 1) click(machine, { x: 10, y: 3 });
            if (clicks >= 2) click(machine, { x: 90, y: 3 });
            machine.happens('endPlacement');
            expect(machine.currentState).toBe('IDLE');
            expect(preview.methods.at(-1)).toBe('hidePreview');
        }
    });
});

describe('single-spine hint keys', () => {
    it('lists the keys a placement emits, in order', () => {
        const { preview, hints, machine } = setup();
        click(machine, { x: 10, y: 3 });
        click(machine, { x: 90, y: 3 });
        click(machine, { x: 90, y: 15 });
        click(machine, startAnchor(preview));
        expect(hints).toEqual([...SINGLE_SPINE_HINT_KEYS]);
    });
});
