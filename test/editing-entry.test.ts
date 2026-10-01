import { describe, expect, it } from 'bun:test';

import * as editing from '../src/editing/index.js';

describe('editing entry point', () => {
    it('exposes the laying and editing API', () => {
        for (const name of [
            'CurveCreationEngine',
            'PreviewCurveCalculator',
            'createLayoutStateMachine',
            'createJointDirectionStateMachine',
            'DuplicateToSideEngine',
            'createDuplicateToSideStateMachine',
            'CatenaryLayoutEngine',
            'createCatenaryLayoutStateMachine',
            'computeDuplicateGeometry',
            'TENSION_DEFAULT',
        ]) {
            expect(editing).toHaveProperty(name);
        }
    });
});
