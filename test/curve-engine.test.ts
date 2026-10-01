import type { Point } from '@ue-too/math';
import { describe, expect, it } from 'bun:test';

import { CurveCreationEngine } from '../src/editing/curve-engine.js';
import { TrackGraph } from '../src/tracks/track.js';

/** An engine whose window coordinates are world coordinates. */
function setup() {
    const graph = new TrackGraph();
    const engine = new CurveCreationEngine(graph, position => ({
        ...position,
    }));
    return { graph, engine };
}

/** Lays one curve the way the layout tool does; returns endCurve's result. */
function lay(engine: CurveCreationEngine, from: Point, to: Point) {
    engine.hoverForStartingPoint(from);
    engine.startCurve();
    engine.hoveringForEndJoint(to);
    return engine.endCurve();
}

describe('CurveCreationEngine construction', () => {
    it('edits the graph it is given', () => {
        const { graph, engine } = setup();
        lay(engine, { x: 0, y: 0 }, { x: 100, y: 0 });
        expect(graph.trackSegments).toHaveLength(1);
    });

    it('converts window positions with the injected function', () => {
        const engine = new CurveCreationEngine(new TrackGraph(), p => ({
            x: p.x * 2,
            y: p.y + 1,
        }));
        expect(engine.convert2WorldPosition({ x: 3, y: 4 })).toEqual({
            x: 6,
            y: 5,
        });
    });
});
