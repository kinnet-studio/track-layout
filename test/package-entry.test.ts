import { describe, expect, it } from 'bun:test';

import * as trackLayout from '../src/index.js';

describe('package entry', () => {
    it('exposes the model API', () => {
        for (const name of [
            'TrackGraph',
            'TrackCurveManager',
            'TrackJointManager',
            'GenericEntityManager',
            'RTree',
            'Rectangle',
            'JointDirectionPreferenceMap',
            'StationManager',
            'TrackAlignedPlatformManager',
            'createIslandStation',
            'validateSerializedTrackData',
            'DEFAULT_SEGMENT_STYLE',
            'defaultYieldToFrame',
            'ELEVATION',
        ]) {
            expect(trackLayout).toHaveProperty(name);
        }
    });
});
