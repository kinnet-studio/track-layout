#!/usr/bin/env bun
/**
 * Generates test/fixtures/banana-scene-b26692b.json: a layout saved by the
 * verbatim port of banana's model code (banana b26692b), before any
 * track-layout changes. The golden-scene test loads it and saves it again to
 * prove old banana saves keep loading.
 *
 * Run once, right after the verbatim port, and commit the output. Re-running
 * it after the model changes would produce a different file.
 *
 * Usage: bun scripts/generate-golden-fixture.ts
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createIslandStation } from '../src/stations/station-factory.js';
import { StationManager } from '../src/stations/station-manager.js';
import { TrackAlignedPlatformManager } from '../src/stations/track-aligned-platform-manager.js';
import { JointDirectionPreferenceMap } from '../src/tracks/joint-direction-preference-map.js';
import { TrackGraph } from '../src/tracks/track.js';
import { ELEVATION } from '../src/tracks/types.js';

const GAUGE = 1.067;

// Straight track is a quadratic curve whose control point is the midpoint;
// @ue-too/curve cannot compute bounds for two-point (linear) curves.

function segmentBetween(graph: TrackGraph, a: number, b: number): number {
    const segment = graph.getJoint(a)?.connections.get(b);
    if (segment === undefined) {
        throw new Error(`no segment between joints ${a} and ${b}`);
    }
    return segment;
}

const graph = new TrackGraph();
const east = { x: 1, y: 0 };
const north = { x: 0, y: 1 };

// Main line A-B, then a curve B-C.
const a = graph.createNewEmptyJoint({ x: 0, y: 0 }, east, ELEVATION.GROUND);
const b = graph.createNewEmptyJoint({ x: 100, y: 0 }, east, ELEVATION.GROUND);
const c = graph.createNewEmptyJoint({ x: 200, y: 50 }, east, ELEVATION.GROUND);
graph.connectJoints(a, b, [{ x: 50, y: 0 }], GAUGE);
graph.connectJoints(b, c, [{ x: 150, y: 0 }], GAUGE);

// Branch off the middle of A-B: splits it at M, then M-D diverges.
const abSegment = segmentBetween(graph, a, b);
const m = graph.insertJointIntoTrackSegmentUsingTrackNumber(abSegment, 0.5);
if (m === null) {
    throw new Error('split failed');
}
const d = graph.createNewEmptyJoint(
    { x: 100, y: -40 },
    { x: 1, y: -1 },
    ELEVATION.GROUND
);
graph.connectJoints(m, d, [{ x: 80, y: 0 }], GAUGE);

// Elevated line crossing the main line.
const e = graph.createNewEmptyJoint(
    { x: 75, y: -80 },
    north,
    ELEVATION.ABOVE_1
);
const f = graph.createNewEmptyJoint({ x: 75, y: 80 }, north, ELEVATION.ABOVE_1);
graph.connectJoints(e, f, [{ x: 75, y: 0 }], GAUGE);

// Sloped ramp.
const g = graph.createNewEmptyJoint({ x: 200, y: -50 }, east, ELEVATION.GROUND);
const h = graph.createNewEmptyJoint(
    { x: 300, y: -50 },
    east,
    ELEVATION.ABOVE_1
);
graph.connectJoints(g, h, [{ x: 250, y: -50 }], GAUGE);

// Styles, written the way banana's renderer stamped them onto segments.
const bc = graph.getTrackSegmentWithJoints(segmentBetween(graph, b, c))!;
bc.trackStyle = 'slab';
const md = graph.getTrackSegmentWithJoints(segmentBetween(graph, m, d))!;
md.electrified = true;
md.catenarySide = -1;
const gh = graph.getTrackSegmentWithJoints(segmentBetween(graph, g, h))!;
gh.bed = true;

// Stations.
const stationManager = new StationManager();
createIslandStation(graph, stationManager, {
    position: { x: 0, y: 200 },
    direction: east,
    length: 120,
    elevation: ELEVATION.GROUND,
    name: 'Island',
});

const bcNumber = segmentBetween(graph, b, c);
const riverside = stationManager.createStation({
    name: 'Riverside',
    position: { x: 150, y: 10 },
    elevation: ELEVATION.GROUND,
    platforms: [],
    trackSegments: [bcNumber],
    joints: [],
    trackAlignedPlatforms: [],
});
const platformManager = new TrackAlignedPlatformManager();
const platformId = platformManager.createPlatform({
    stationId: riverside,
    spine: [{ trackSegment: bcNumber, tStart: 0.2, tEnd: 0.8, side: 1 }],
    offset: 2.5,
    outerVertices: [
        { x: 120, y: 5 },
        { x: 170, y: 15 },
    ],
    stopPositions: [
        {
            id: 0,
            trackSegmentId: bcNumber,
            direction: 'tangent',
            tValue: 0.5,
        },
    ],
});
stationManager.getStation(riverside)!.trackAlignedPlatforms.push(platformId);

// Joint direction preferences at the junction.
const preferences = new JointDirectionPreferenceMap();
preferences.set(m, 'tangent', b);
preferences.set(m, 'reverseTangent', a);

const fixture = {
    source: 'banana b26692b model code, verbatim port; scripts/generate-golden-fixture.ts',
    tracks: graph.serialize(),
    stations: stationManager.serialize(),
    trackAlignedPlatforms: platformManager.serialize(),
    jointDirectionPreferences: preferences.serialize(),
};

const out = join(
    import.meta.dir,
    '..',
    'test',
    'fixtures',
    'banana-scene-b26692b.json'
);
writeFileSync(out, `${JSON.stringify(fixture, null, 4)}\n`);
console.log(`wrote ${out}`);
