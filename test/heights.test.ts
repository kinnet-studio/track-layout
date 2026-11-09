import { describe, expect, it } from 'bun:test';

import {
    clampHeight,
    levelsToMetres,
    roundHeight,
    stepHeight,
} from '../src/tracks/heights.js';
import {
    type SerializedTrackData,
    type SerializedTrackJoint,
    type SerializedTrackSegment,
    validateSerializedTrackData,
} from '../src/tracks/types.js';

function joint(jointNumber: number, elevation: number): SerializedTrackJoint {
    return {
        jointNumber,
        position: { x: jointNumber * 100, y: 0 },
        connections: [],
        tangent: { x: 1, y: 0 },
        direction: { tangent: [], reverseTangent: [] },
        elevation: elevation,
    };
}

function segment(
    segmentNumber: number,
    t0Joint: number,
    t1Joint: number,
    from: number,
    to: number,
    splits: number[]
): SerializedTrackSegment {
    return {
        segmentNumber,
        controlPoints: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
        ],
        t0Joint,
        t1Joint,
        elevation: { from: from, to: to },
        gauge: 1.067,
        splits,
    };
}

describe('roundHeight / clampHeight', () => {
    it('rounds to the centimetre', () => {
        expect(roundHeight(12.345)).toBe(12.35);
        expect(roundHeight(-0.001)).toBe(0);
        expect(Object.is(roundHeight(-0.001), 0)).toBe(true);
    });

    it('clamps to ±200 m', () => {
        expect(clampHeight(250)).toBe(200);
        expect(clampHeight(-200.004)).toBe(-200);
    });
});

describe('stepHeight', () => {
    it('steps to the next multiple of the step', () => {
        expect(stepHeight(12.35, 1, 1)).toBe(13);
        expect(stepHeight(13, 1, 1)).toBe(14);
        expect(stepHeight(12.35, 1, -1)).toBe(12);
        expect(stepHeight(12, 1, -1)).toBe(11);
        // Fractional steps are exact.
        expect(stepHeight(12.4, 0.1, 1)).toBe(12.5);
        expect(stepHeight(12.35, 0.1, 1)).toBe(12.4);
        expect(stepHeight(0.07, 0.01, 1)).toBe(0.08);
        expect(stepHeight(-0.1, 0.1, -1)).toBe(-0.2);
        expect(stepHeight(199.5, 1, 1)).toBe(200);
        expect(stepHeight(-200, 1, -1)).toBe(-200);
    });
});

describe('levelsToMetres', () => {
    it('converts levels to metres and keeps everything else', () => {
        const track = {
            joints: [joint(0, 1), joint(1, -3)],
            segments: [segment(0, 0, 1, 1, -3, [0.25])],
        };
        const stations = [{ elevation: 2, name: 'A', depotOnly: true }];
        const out = levelsToMetres({ track, stations });
        expect(out.track.joints.map(j => j.elevation)).toEqual([10, -30]);
        expect(out.track.segments[0].elevation).toEqual({
            from: 10,
            to: -30,
        });
        expect(out.track.segments[0].splits).toEqual([0.25]);
        expect(out.stations).toEqual([
            { elevation: 20, name: 'A', depotOnly: true },
        ]);
        expect(track.joints[0].elevation).toBe(1); // the input is not changed
    });

    it('leaves a height that is not a finite number for validation', () => {
        const track = {
            joints: [joint(0, NaN)],
            segments: [],
        };
        const out = levelsToMetres({ track, stations: [] });
        expect(out.track.joints[0].elevation).toBeNaN();
    });

    it('passes malformed entries through unchanged for validation', () => {
        const noHeights = { ...segment(0, 0, 1, 1, 1, []), elevation: null };
        const noSplits = { ...segment(1, 0, 1, 1, 1, []), splits: undefined };
        const nanTo = segment(2, 0, 1, 1, NaN, [0.5]);
        const good = segment(3, 0, 1, 1, 2, [0.5]);
        const track = {
            joints: [joint(0, 1), joint(1, 1)],
            segments: [noHeights, noSplits, nanTo, good],
        } as unknown as SerializedTrackData;
        const stations = [
            null,
            { name: 'no height' },
            { name: 'infinite', elevation: Infinity },
            { name: 'good', elevation: 1 },
        ] as unknown as { elevation: number }[];

        const out = levelsToMetres({ track, stations });

        expect(out.track.segments).toEqual([
            noHeights,
            noSplits,
            nanTo,
            { ...good, elevation: { from: 10, to: 20 } },
        ] as unknown as SerializedTrackSegment[]);
        expect(out.stations).toEqual([
            null,
            { name: 'no height' },
            { name: 'infinite', elevation: Infinity },
            { name: 'good', elevation: 10 },
        ] as unknown as { elevation: number }[]);
        expect(validateSerializedTrackData(out.track)).toEqual({
            valid: false,
            error: 'segments[0].elevation must be {from, to}',
        });
    });
});
