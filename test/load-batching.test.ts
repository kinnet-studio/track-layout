import { describe, expect, it } from 'bun:test';

import { TrackGraph } from '../src/tracks/track.js';
import type { SerializedTrackData } from '../src/tracks/types.js';

const EAST = { x: 1, y: 0 };

/** A save holding three parallel straight segments. */
function savedThreeSegments(): SerializedTrackData {
    const graph = new TrackGraph();
    for (const y of [0, 50, 100]) {
        const a = graph.createNewEmptyJoint({ x: 0, y }, EAST);
        const b = graph.createNewEmptyJoint({ x: 100, y }, EAST);
        graph.connectJoints(a, b, [{ x: 50, y }]);
    }
    return JSON.parse(JSON.stringify(graph.serialize()));
}

describe('TrackGraph.loadFromSerializedData batching', () => {
    it('calls yieldToFrame between batches and reports progress', async () => {
        const graph = new TrackGraph();
        let yields = 0;
        const progress: [number, number][] = [];

        await graph.loadFromSerializedData(savedThreeSegments(), {
            batchSize: 1,
            yieldToFrame: async () => {
                yields++;
            },
            onProgress: (loaded, total) => progress.push([loaded, total]),
        });

        expect(yields).toBe(2);
        expect(progress).toEqual([
            [1, 3],
            [2, 3],
            [3, 3],
        ]);
        expect(graph.trackSegments).toHaveLength(3);
    });

    it('loads in batches outside a browser by default', async () => {
        expect(typeof globalThis.requestAnimationFrame).toBe('undefined');
        const graph = new TrackGraph();

        await graph.loadFromSerializedData(savedThreeSegments(), {
            batchSize: 1,
        });

        expect(graph.trackSegments).toHaveLength(3);
    });
});
