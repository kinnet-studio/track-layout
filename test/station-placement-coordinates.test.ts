import type { Point } from '@ue-too/math';
import { describe, expect, it } from 'bun:test';

import { DualSpinePlacementEngine } from '../src/station-placement/dual-spine-placement-state-machine.js';
import { SingleSpinePlacementEngine } from '../src/station-placement/single-spine-placement-state-machine.js';
import { StationPlacementEngine } from '../src/station-placement/station-placement-state-machine.js';
import { StationManager } from '../src/stations/station-manager.js';
import { TrackAlignedPlatformManager } from '../src/stations/track-aligned-platform-manager.js';
import { TrackGraph } from '../src/tracks/track.js';
import { RecordingPreview } from './station-placement-helpers.js';

/** A converter that is clearly not the identity. */
const shift = (p: Point) => ({ x: p.x + 1000, y: p.y - 5 });

describe('station placement engines convert with the injected function', () => {
    it('island', () => {
        const engine = new StationPlacementEngine(
            new TrackGraph(),
            shift,
            new StationManager(),
            new RecordingPreview(),
            () => 1.067
        );
        expect(engine.convert2WorldPosition({ x: 1, y: 2 })).toEqual({
            x: 1001,
            y: -3,
        });
    });

    it('single-spine', () => {
        const engine = new SingleSpinePlacementEngine(
            new TrackGraph(),
            shift,
            new StationManager(),
            new TrackAlignedPlatformManager(),
            new RecordingPreview()
        );
        expect(engine.convert2WorldPosition({ x: 1, y: 2 })).toEqual({
            x: 1001,
            y: -3,
        });
    });

    it('dual-spine', () => {
        const engine = new DualSpinePlacementEngine(
            new TrackGraph(),
            shift,
            new StationManager(),
            new TrackAlignedPlatformManager(),
            new RecordingPreview()
        );
        expect(engine.convert2WorldPosition({ x: 1, y: 2 })).toEqual({
            x: 1001,
            y: -3,
        });
    });
});
