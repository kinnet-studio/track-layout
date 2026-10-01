import { describe, expect, it } from 'bun:test';

import * as root from '../src/index.js';
import * as stationPlacement from '../src/station-placement/index.js';
// Type-only exports: the typecheck fails if any of these goes missing.
import type {
    DualSpineContext,
    DualSpineEvents,
    DualSpineHintKey,
    DualSpinePlacementPreview,
    DualSpinePlacementStateMachine,
    DualSpineStates,
    SingleSpineContext,
    SingleSpineEvents,
    SingleSpineHintKey,
    SingleSpinePlacementPreview,
    SingleSpinePlacementStateMachine,
    SingleSpineStates,
    SpinePlacementPreview,
    StationPlacementContext,
    StationPlacementEvents,
    StationPlacementPreview,
    StationPlacementStates,
} from '../src/station-placement/index.js';

const RUNTIME_EXPORTS = [
    'StationPlacementEngine',
    'StationPlacementStateMachine',
    'createStationPlacementStateMachine',
    'SingleSpinePlacementEngine',
    'createSingleSpinePlacementStateMachine',
    'SINGLE_SPINE_PLACEMENT_STATES',
    'SINGLE_SPINE_HINT_KEYS',
    'DualSpinePlacementEngine',
    'createDualSpinePlacementStateMachine',
    'DUAL_SPINE_PLACEMENT_STATES',
    'DUAL_SPINE_HINT_KEYS',
];

describe('station-placement entry point', () => {
    it('exposes the three placement tools', () => {
        for (const name of RUNTIME_EXPORTS) {
            expect(stationPlacement).toHaveProperty(name);
        }
    });

    it('keeps the spine-path helpers internal', () => {
        expect(stationPlacement).not.toHaveProperty('buildSpinePath');
        expect(stationPlacement).not.toHaveProperty('sharedJointT');
    });

    it('is not re-exported from the package root', () => {
        for (const name of RUNTIME_EXPORTS) {
            expect(root).not.toHaveProperty(name);
        }
    });
});
