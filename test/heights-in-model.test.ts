import { describe, expect, it } from 'bun:test';

import {
    findElevationColorStop,
    getElevationColorRgb,
    normalizeElevation,
} from '../src/pixi/track-render-system.js';
import { TrackGraph } from '../src/tracks/track.js';
import { layLine } from './track-helpers.js';

function elevationOf(graph: TrackGraph, jointNumber: number) {
    return graph.serialize().joints.find(j => j.jointNumber === jointNumber)
        ?.elevation;
}

describe('heights in the model', () => {
    it('keeps a typed height to the centimetre through laying and saving', () => {
        const graph = new TrackGraph();
        const a = graph.createNewEmptyJoint(
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            12.345
        );
        expect(elevationOf(graph, a)).toBe(12.35);

        const b = graph.createNewEmptyJoint(
            { x: 100, y: 0 },
            { x: 1, y: 0 },
            6.5
        );
        expect(graph.connectJoints(a, b, [{ x: 50, y: 0 }])).toBe(true);

        const saved = graph.serialize();
        expect(saved.joints.map(j => j.elevation).sort()).toEqual(
            [12.35, 6.5].sort()
        );
        expect(saved.segments[0].elevation).toEqual({ from: 12.35, to: 6.5 });
    });

    it('holds split pieces in metres, not metres x 10', () => {
        // A ramp from 0 to 30 m crossing a flat 16 m bridge, less than the 3 m clearance above the ramp's 15 m midpoint.
        const graph = new TrackGraph();
        layLine(graph, { x: 100, y: -100 }, { x: 100, y: 100 }, 16);
        const start = graph.createNewEmptyJoint(
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            0
        );
        const end = graph.createNewEmptyJoint(
            { x: 200, y: 0 },
            { x: 1, y: 0 },
            30
        );
        expect(graph.connectJoints(start, end, [{ x: 100, y: 0 }])).toBe(true);
        const ramp = graph.getJoint(start)!.connections.get(end)!;

        const pieces = graph.trackCurveManager.persistedDrawData.filter(
            d => d.originalTrackSegment.trackSegmentNumber === ramp
        );
        expect(pieces.length).toBeGreaterThan(1);
        for (const p of pieces) {
            expect(p.elevation.from).toBeGreaterThanOrEqual(0);
            expect(p.elevation.to).toBeLessThanOrEqual(30);
        }
    });

    it('rounds heights on load', async () => {
        const source = new TrackGraph();
        layLine(source, { x: 0, y: 0 }, { x: 100, y: 0 }, 5);
        const data = source.serialize();
        data.joints[0].elevation = 1.234;
        const g = new TrackGraph();
        await g.loadFromSerializedData(data);
        expect(elevationOf(g, data.joints[0].jointNumber)).toBe(1.23);
    });

    it('exports no level names', async () => {
        for (const entry of [
            '../src/index.js',
            '../src/editing/index.js',
            '../src/pixi/index.js',
            '../src/station-placement/index.js',
        ]) {
            const mod = await import(entry);
            for (const name of [
                'ELEVATION',
                'ELEVATION_VALUES',
                'ELEVATION_MIN',
                'ELEVATION_MAX',
                'LEVEL_HEIGHT',
            ]) {
                expect(name in mod).toBe(false);
            }
        }
    });
});

describe('heights beyond the Detailed bands', () => {
    it('gives a 150 m height the 30 m band colour stop', () => {
        expect(findElevationColorStop(150)).toEqual(getElevationColorRgb(30));
        expect(findElevationColorStop(-150)).toEqual(getElevationColorRgb(-30));
    });

    it('clamps the gradient texture coordinate to [0, 1]', () => {
        expect(normalizeElevation(150)).toBe(1);
        expect(normalizeElevation(-150)).toBe(0);
        expect(normalizeElevation(0)).toBe(0.5);
    });
});
