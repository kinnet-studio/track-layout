import { describe, expect, it } from 'bun:test';

import {
    StationPlacementEngine,
    StationPlacementStateMachine,
    createStationPlacementStateMachine,
} from '../src/station-placement/station-placement-state-machine.js';
import { StationManager } from '../src/stations/station-manager.js';
import { TrackGraph } from '../src/tracks/track.js';
import { ELEVATION } from '../src/tracks/types.js';
import { RecordingPreview, identity } from './station-placement-helpers.js';

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
        expect(preview.lastArgs('showPreview')).toEqual([
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            0.5,
            10.4,
        ]);

        machine.happens('pointerMove', { x: 100, y: 0 });
        expect(preview.lastArgs('showPreview')).toEqual([
            { x: 50, y: 0 },
            { x: 1, y: 0 },
            100,
            10.4,
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
