import { describe, expect, it } from 'bun:test';

import {
    StationPlacementEngine,
    StationPlacementStateMachine,
    createStationPlacementStateMachine,
} from '../src/station-placement/station-placement-state-machine.js';
import { computePlatformOffset } from '../src/stations/platform-offset.js';
import { createIslandStation } from '../src/stations/station-factory.js';
import { StationManager } from '../src/stations/station-manager.js';
import { TrackGraph } from '../src/tracks/track.js';
import { ELEVATION } from '../src/tracks/types.js';
import { RecordingPreview, identity } from './station-placement-helpers.js';

/** An 8 m island's track spacing, its edges `offset` from the tracks. */
const spacing = (offset: number) => 8 + 2 * offset;

/** The track centrelines' y at the middle of the station's segments. */
function trackYs(graph: TrackGraph, segments: number[]): number[] {
    return segments
        .map(segment => graph.getTrackSegmentCurve(segment)!.get(0.5).y)
        .sort((a, b) => a - b);
}

function setup(getGauge: () => number = () => 1.435) {
    const graph = new TrackGraph();
    const stations = new StationManager();
    const preview = new RecordingPreview();
    const engine = new StationPlacementEngine(
        graph,
        identity,
        stations,
        preview,
        getGauge
    );
    const machine = new StationPlacementStateMachine(engine);
    machine.happens('startPlacement');
    return { graph, stations, preview, machine };
}

describe('island station placement', () => {
    it('drags out a station and creates it on release', () => {
        const { graph, stations, preview, machine } = setup();
        expect(machine.currentState).toBe('HOVER_FOR_START');

        machine.happens('leftPointerUp', { x: 0, y: 0 });
        expect(machine.currentState).toBe('HOVER_FOR_END');
        const trackSpacing = spacing(computePlatformOffset(1.435, undefined));
        expect(preview.lastArgs('showPreview')).toEqual([
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            0.5,
            trackSpacing,
        ]);

        machine.happens('pointerMove', { x: 100, y: 0 });
        expect(preview.lastArgs('showPreview')).toEqual([
            { x: 50, y: 0 },
            { x: 1, y: 0 },
            100,
            trackSpacing,
        ]);

        machine.happens('leftPointerUp', { x: 100, y: 0 });
        expect(machine.currentState).toBe('HOVER_FOR_START');
        expect(preview.methods.at(-1)).toBe('hidePreview');

        const created = stations.getStations();
        expect(created).toHaveLength(1);
        const { station } = created[0];
        expect(station.position).toEqual({ x: 50, y: 0 });
        expect(station.elevation).toBe(ELEVATION.GROUND);
        expect(station.platforms).toHaveLength(2);
        expect(station.trackSegments).toHaveLength(2);
        expect(station.joints).toHaveLength(4);
        expect(graph.trackSegments).toHaveLength(2);
        for (const segmentId of station.trackSegments) {
            expect(graph.getTrackSegmentWithJoints(segmentId)?.gauge).toBe(
                1.435
            );
        }
    });

    it('builds the station with the gauge current at release', () => {
        let gauge = 1.067;
        const { graph, stations, machine } = setup(() => gauge);
        machine.happens('leftPointerUp', { x: 0, y: 0 });
        gauge = 1.435;
        machine.happens('leftPointerUp', { x: 100, y: 0 });
        const { station } = stations.getStations()[0];
        for (const segmentId of station.trackSegments) {
            expect(graph.getTrackSegmentWithJoints(segmentId)?.gauge).toBe(
                1.435
            );
        }
    });

    it("stands the island as far from its tracks as a track-aligned platform's offset", () => {
        const { graph, stations, machine } = setup();
        machine.happens('leftPointerUp', { x: 0, y: 0 });
        machine.happens('leftPointerUp', { x: 100, y: 0 });

        const offset = computePlatformOffset(1.435, undefined);
        const { station } = stations.getStations()[0];
        for (const platform of station.platforms) {
            expect(platform.offset).toBeCloseTo(offset);
            expect(platform.width).toBeCloseTo(4);
        }
        const [a, b] = trackYs(graph, station.trackSegments);
        expect(b - a).toBeCloseTo(spacing(offset));
    });

    it('counts the bed that new track is laid with', () => {
        const { graph, stations, preview, machine } = setup();
        graph.setNewSegmentStyle({ bed: true, bedWidth: 6 });
        const offset = computePlatformOffset(1.435, 6);

        machine.happens('leftPointerUp', { x: 0, y: 0 });
        expect(preview.lastArgs('showPreview')![3]).toBeCloseTo(
            spacing(offset)
        );
        machine.happens('leftPointerUp', { x: 100, y: 0 });

        const { station } = stations.getStations()[0];
        for (const platform of station.platforms) {
            expect(platform.offset).toBeCloseTo(offset);
        }
        const [a, b] = trackYs(graph, station.trackSegments);
        expect(b - a).toBeCloseTo(spacing(offset));
    });

    it('ignores pointer moves closer than 0.5 m to the start', () => {
        const { preview, machine } = setup();
        machine.happens('leftPointerUp', { x: 0, y: 0 });
        const callsAfterStart = preview.calls.length;
        machine.happens('pointerMove', { x: 0.3, y: 0 });
        expect(preview.calls).toHaveLength(callsAfterStart);
    });

    it('creates nothing for a drag shorter than 2 m', () => {
        const { graph, stations, preview, machine } = setup();
        machine.happens('leftPointerUp', { x: 0, y: 0 });
        machine.happens('leftPointerUp', { x: 1.5, y: 0 });
        expect(machine.currentState).toBe('HOVER_FOR_START');
        expect(preview.methods.at(-1)).toBe('hidePreview');
        expect(stations.getStations()).toHaveLength(0);
        expect(graph.trackSegments).toHaveLength(0);
    });

    it('escape drops the start point, then leaves the tool', () => {
        const { stations, preview, machine } = setup();
        machine.happens('leftPointerUp', { x: 0, y: 0 });
        machine.happens('escapeKey');
        expect(machine.currentState).toBe('HOVER_FOR_START');
        expect(preview.methods.at(-1)).toBe('hidePreview');

        machine.happens('escapeKey');
        expect(machine.currentState).toBe('IDLE');
        expect(stations.getStations()).toHaveLength(0);
    });

    it('endPlacement leaves the tool from either hover state', () => {
        const { preview, machine } = setup();
        machine.happens('endPlacement');
        expect(machine.currentState).toBe('IDLE');

        machine.happens('startPlacement');
        machine.happens('leftPointerUp', { x: 0, y: 0 });
        machine.happens('endPlacement');
        expect(machine.currentState).toBe('IDLE');
        expect(preview.methods.at(-1)).toBe('hidePreview');
    });
});

describe('createIslandStation', () => {
    it("defaults the island's edges to a track-aligned platform's offset for the gauge", () => {
        const graph = new TrackGraph();
        const stations = new StationManager();
        const id = createIslandStation(graph, stations, {
            position: { x: 0, y: 0 },
            direction: { x: 1, y: 0 },
            length: 100,
            elevation: ELEVATION.GROUND,
            gauge: 1.676,
        });

        const offset = computePlatformOffset(1.676, undefined);
        const station = stations.getStation(id)!;
        for (const platform of station.platforms) {
            expect(platform.offset).toBeCloseTo(offset);
            expect(platform.width).toBeCloseTo(4);
        }
        const [a, b] = trackYs(graph, station.trackSegments);
        expect(b - a).toBeCloseTo(spacing(offset));
    });

    it('keeps an offset and spacing it is given', () => {
        const graph = new TrackGraph();
        const stations = new StationManager();
        const id = createIslandStation(graph, stations, {
            position: { x: 0, y: 0 },
            direction: { x: 1, y: 0 },
            length: 100,
            elevation: ELEVATION.GROUND,
            trackSpacing: 10.4,
            platformOffset: 1.2,
        });

        const station = stations.getStation(id)!;
        for (const platform of station.platforms) {
            expect(platform.offset).toBe(1.2);
            expect(platform.width).toBeCloseTo(4);
        }
        const [a, b] = trackYs(graph, station.trackSegments);
        expect(b - a).toBeCloseTo(10.4);
    });
});

describe('createStationPlacementStateMachine', () => {
    it('builds a machine that places a station', () => {
        const stations = new StationManager();
        const engine = new StationPlacementEngine(
            new TrackGraph(),
            identity,
            stations,
            new RecordingPreview(),
            () => 1.067
        );
        const machine = createStationPlacementStateMachine(engine);
        machine.happens('startPlacement');
        machine.happens('leftPointerUp', { x: 0, y: 0 });
        machine.happens('leftPointerUp', { x: 50, y: 0 });
        expect(stations.getStations()).toHaveLength(1);
    });
});
