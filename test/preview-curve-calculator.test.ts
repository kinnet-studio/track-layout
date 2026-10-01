import type { Point } from '@ue-too/math';
import { describe, expect, it } from 'bun:test';

import {
    PreviewCurveCalculator,
    TENSION_DEFAULT,
    TENSION_MAX,
    TENSION_MIN,
} from '../src/editing/new-joint.js';
import type {
    BrandNewJoint,
    ExtendingTrackJoint,
} from '../src/editing/types.js';
import { ELEVATION } from '../src/tracks/types.js';

function brandNew(x: number, y: number): BrandNewJoint {
    return { type: 'new', position: { x, y }, elevation: ELEVATION.GROUND };
}

/** A dead-end joint at (x, y) whose track continues along `tangent`. */
function extending(x: number, y: number, tangent: Point): ExtendingTrackJoint {
    return {
        type: 'extendingTrack',
        position: { x, y },
        elevation: ELEVATION.GROUND,
        constraint: {
            hitType: 'joint',
            jointNumber: 0,
            projectionPoint: { x, y },
            tangent,
            curvature: 0,
            endingJoint: true,
        },
    };
}

const EAST = { x: 1, y: 0 };

describe('PreviewCurveCalculator curve type', () => {
    it('joins two brand-new joints with a straight line', () => {
        const { cps, startAndEndSwitched } =
            new PreviewCurveCalculator().getPreviewCurve(
                brandNew(0, 0),
                brandNew(100, 0)
            );
        // A straight line is a quadratic with its midpoint as control point.
        // (The endpoints also carry a `z: 0` from the joint positions.)
        expect(startAndEndSwitched).toBe(false);
        expect(cps).toHaveLength(3);
        expect(cps[0]).toMatchObject({ x: 0, y: 0 });
        expect(cps[1]).toEqual({ x: 50, y: 0 });
        expect(cps[2]).toMatchObject({ x: 100, y: 0 });
    });

    it('uses a quadratic from a constrained start to a brand-new end', () => {
        const { cps } = new PreviewCurveCalculator().getPreviewCurve(
            extending(0, 0, EAST),
            brandNew(100, 50)
        );
        expect(cps).toHaveLength(3);
    });

    it('uses a reversed quadratic from a brand-new start to a constrained end', () => {
        const { cps } = new PreviewCurveCalculator().getPreviewCurve(
            brandNew(0, 50),
            extending(100, 0, EAST)
        );
        expect(cps).toHaveLength(3);
    });

    it('uses a cubic between two constrained joints', () => {
        const { cps } = new PreviewCurveCalculator().getPreviewCurve(
            extending(0, 0, EAST),
            extending(100, 50, EAST)
        );
        expect(cps).toHaveLength(4);
    });

    it('draws a straight line from a constrained start when straight-line mode is on', () => {
        const calculator = new PreviewCurveCalculator();
        calculator.toggleStraightLine();
        const { cps } = calculator.getPreviewCurve(
            extending(0, 0, EAST),
            brandNew(100, 0)
        );
        for (const point of cps) {
            expect(point.y).toBeCloseTo(0);
        }
    });
});

describe('PreviewCurveCalculator tension', () => {
    it('starts at the default tension', () => {
        expect(new PreviewCurveCalculator().tension).toBe(TENSION_DEFAULT);
    });

    it('clamps to the allowed range and rounds to one decimal', () => {
        const calculator = new PreviewCurveCalculator();
        calculator.tension = 99;
        expect(calculator.tension).toBe(TENSION_MAX);
        calculator.tension = -1;
        expect(calculator.tension).toBe(TENSION_MIN);
        calculator.tension = 1.26;
        expect(calculator.tension).toBe(1.3);
    });

    it('pushes cubic control points further along the tangents at higher tension', () => {
        const distanceOfFirstControlPoint = (tension: number) => {
            const calculator = new PreviewCurveCalculator();
            calculator.tension = tension;
            const { cps } = calculator.getPreviewCurve(
                extending(0, 0, EAST),
                extending(100, 50, EAST)
            );
            return Math.hypot(cps[1].x - cps[0].x, cps[1].y - cps[0].y);
        };
        expect(distanceOfFirstControlPoint(2)).toBeGreaterThan(
            distanceOfFirstControlPoint(0.5)
        );
    });
});

describe('PreviewCurveCalculator tangent direction', () => {
    it('turns a constrained start tangent to face the end point', () => {
        // The joint's tangent points east but the end lies to the west: the
        // curve must leave the joint heading west, not east.
        const { cps } = new PreviewCurveCalculator().getPreviewCurve(
            extending(100, 0, EAST),
            brandNew(0, 0)
        );
        expect(cps[1].x).toBeLessThan(100);
    });
});
