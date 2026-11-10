import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { BatchedMesh, Box3, BufferGeometry } from 'three';

import {
    MIN_INDEX_CAPACITY,
    MIN_VERTEX_CAPACITY,
} from '../src/three/segment-batch.js';
import { type PartName, TrackScene } from '../src/three/track-scene.js';
import { TrackGraph } from '../src/tracks/track.js';
import { layLine } from './track-helpers.js';

const EAST = { x: 1, y: 0 };

/** a (0, 0) – j (100, 0) – b (200, 0): segments s1 (a→j) and s2 (j→b). */
function twoSegments(graph: TrackGraph) {
    const a = graph.createNewEmptyJoint({ x: 0, y: 0 }, EAST);
    const j = graph.createNewEmptyJoint({ x: 100, y: 0 }, EAST);
    const b = graph.createNewEmptyJoint({ x: 200, y: 0 }, EAST);
    graph.connectJoints(a, j, [{ x: 50, y: 0 }]);
    graph.connectJoints(j, b, [{ x: 150, y: 0 }]);
    return {
        j,
        s1: graph.getJoint(a)!.connections.get(j)!,
        s2: graph.getJoint(j)!.connections.get(b)!,
    };
}

const PARTS: PartName[] = [
    'ballast',
    'ballastSleepers',
    'slab',
    'slabSleepers',
    'bed',
    'rails',
    'catenary',
];

/** The names of the batches segment `n` is drawn in, sorted. */
function partsNamed(ts: TrackScene, n: number) {
    return Object.keys(ts.partsOf(n)!).sort();
}

/** Segment `n`'s box in `part`'s batch. */
function boxIn(ts: TrackScene, part: PartName, n: number) {
    const handle = ts.partsOf(n)![part]!;
    return ts
        .batchOf(part)
        .mesh.getBoundingBoxAt(handle.geometryId, new Box3())!;
}

/** Counts `BufferGeometry.dispose` calls, until `restore`. */
function spyOnGeometryDispose() {
    const original = BufferGeometry.prototype.dispose;
    const disposed = new Set<BufferGeometry>();
    let count = 0;
    BufferGeometry.prototype.dispose = function (this: BufferGeometry) {
        count++;
        disposed.add(this);
        return original.call(this);
    };
    return {
        get count() {
            return count;
        },
        disposed,
        restore() {
            BufferGeometry.prototype.dispose = original;
        },
    };
}

let graph: TrackGraph;
let spy: ReturnType<typeof spyOnGeometryDispose> | undefined;
let infoSpy: ReturnType<typeof spyOn> | undefined;

beforeEach(() => {
    // EntityManager reports each time it grows; keep the test output clean.
    infoSpy = spyOn(console, 'info').mockImplementation(() => {});
    graph = new TrackGraph();
});
afterEach(() => {
    infoSpy?.mockRestore();
    infoSpy = undefined;
    spy?.restore();
    spy = undefined;
});

describe('TrackScene', () => {
    it('draws segments that existed before it was built', () => {
        const { s1, s2 } = twoSegments(graph);
        const ts = new TrackScene(graph);
        expect(ts.partsOf(s1)).toBeDefined();
        expect(ts.partsOf(s2)).toBeDefined();
        expect(ts.batchOf('ballast').stats.liveInstances).toBe(2);
        ts.dispose();
    });

    it("holds seven batched meshes, each with its part's shared material, at identity transforms", () => {
        twoSegments(graph);
        const ts = new TrackScene(graph);
        expect(ts.scene.children.map(c => c.name)).toEqual(
            PARTS.map(part => `batch:${part}`)
        );
        ts.scene.children.forEach((child, i) => {
            expect(child).toBeInstanceOf(BatchedMesh);
            expect((child as BatchedMesh).material).toBe(
                ts.materials[PARTS[i]!]
            );
            expect(child.position.toArray()).toEqual([0, 0, 0]);
            expect(child.scale.toArray()).toEqual([1, 1, 1]);
            expect(child.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
        });
        ts.dispose();
    });

    it('puts a ballasted, electrified, bedded segment in five batches, its surface twice', () => {
        const { s1 } = twoSegments(graph);
        graph.setSegmentStyle(s1, { electrified: true, bed: true });
        const ts = new TrackScene(graph);
        expect(partsNamed(ts, s1)).toEqual([
            'ballast',
            'ballastSleepers',
            'bed',
            'catenary',
            'rails',
        ]);
        expect(boxIn(ts, 'ballast', s1)).toEqual(
            boxIn(ts, 'ballastSleepers', s1)
        );
        ts.dispose();
    });

    it('uses the slab batches for a slab segment', () => {
        const { s1 } = twoSegments(graph);
        graph.setSegmentStyle(s1, { trackStyle: 'slab' });
        const ts = new TrackScene(graph);
        expect(partsNamed(ts, s1)).toEqual(['rails', 'slab', 'slabSleepers']);
        ts.dispose();
    });

    it('moves a segment between batches when its style changes', () => {
        const { s1 } = twoSegments(graph);
        const ts = new TrackScene(graph);
        graph.setSegmentStyle(s1, { trackStyle: 'slab' });
        expect(partsNamed(ts, s1)).toEqual(['rails', 'slab', 'slabSleepers']);
        expect(ts.batchOf('ballast').stats.liveInstances).toBe(1);
        expect(ts.batchOf('slab').stats.liveInstances).toBe(1);
        expect(ts.batchOf('rails').stats.liveInstances).toBe(2);
        ts.dispose();
    });

    it('adds, rebuilds and removes segments as the graph changes', () => {
        const { j, s1 } = twoSegments(graph);
        const ts = new TrackScene(graph);
        const s3 = layLine(graph, { x: 0, y: 500 }, { x: 100, y: 500 });
        expect(ts.partsOf(s3)).toBeDefined();
        const before = ts.partsOf(s1);
        graph.setJointElevation(j, 6.5);
        expect(ts.partsOf(s1)).toBeDefined();
        expect(ts.partsOf(s1)).not.toBe(before);
        expect(partsNamed(ts, s1)).not.toContain('catenary');
        graph.setSegmentStyle(s1, { electrified: true });
        expect(partsNamed(ts, s1)).toContain('catenary');
        graph.removeTrackSegment(s3);
        expect(ts.partsOf(s3)).toBeUndefined();
        expect(ts.batchOf('ballast').stats.liveInstances).toBe(2);
        ts.dispose();
    });

    it('rebuilds only the segments whose heights changed', () => {
        const { j, s1, s2 } = twoSegments(graph);
        const unrelated = layLine(graph, { x: 0, y: 500 }, { x: 100, y: 500 });
        const ts = new TrackScene(graph);
        const other = ts.partsOf(unrelated);
        const s1Before = ts.partsOf(s1);
        const s2Before = ts.partsOf(s2);
        graph.setJointElevation(j, 6.5);
        expect(ts.partsOf(unrelated)).toBe(other);
        expect(ts.partsOf(s1)).not.toBe(s1Before);
        expect(ts.partsOf(s2)).not.toBe(s2Before);
        ts.dispose();
    });

    it('draws the new heights', () => {
        const { j, s1 } = twoSegments(graph);
        const ts = new TrackScene(graph);
        expect(ts.bounds().max.z).toBeLessThan(1);
        graph.setJointElevation(j, 6.5);
        expect(ts.bounds().max.z).toBeGreaterThan(6);
        expect(boxIn(ts, 'ballast', s1).max.z).toBeGreaterThan(6);
        ts.dispose();
    });

    it('bounds() is empty without track and spans the layout in scene coordinates', () => {
        const ts = new TrackScene(graph);
        expect(ts.bounds().isEmpty()).toBe(true);
        layLine(graph, { x: 0, y: 0 }, { x: 100, y: 0 });
        layLine(graph, { x: 0, y: 500 }, { x: 100, y: 500 });
        const box = ts.bounds();
        expect(box.isEmpty()).toBe(false);
        expect(box.min.x).toBeLessThan(1);
        expect(box.max.x).toBeGreaterThan(99);
        // world y is down, scene y is up: y = 500 lands at -500
        expect(box.min.y).toBeLessThan(-499);
        expect(box.max.y).toBeGreaterThan(-1);
        ts.dispose();
    });

    it('onChange fires synchronously for each add, rebuild and remove, and unsubscribes', () => {
        const { j } = twoSegments(graph);
        const ts = new TrackScene(graph);
        let calls = 0;
        const off = ts.onChange(() => calls++);
        const s3 = layLine(graph, { x: 0, y: 500 }, { x: 100, y: 500 });
        expect(calls).toBe(1);
        graph.setJointElevation(j, 3);
        expect(calls).toBe(3);
        graph.removeTrackSegment(s3);
        expect(calls).toBe(4);
        off();
        layLine(graph, { x: 0, y: 900 }, { x: 100, y: 900 });
        expect(calls).toBe(4);
        ts.dispose();
    });

    it('frees each source geometry once it is copied into its batches', () => {
        twoSegments(graph);
        spy = spyOnGeometryDispose();
        const ts = new TrackScene(graph);
        // two surfaces and two rails
        expect(spy.count).toBe(4);
        for (const child of ts.scene.children) {
            expect(spy.disposed.has((child as BatchedMesh).geometry)).toBe(
                false
            );
        }
        ts.dispose();
    });

    it('hides a batch once its last segment leaves', () => {
        const { s1 } = twoSegments(graph);
        const ts = new TrackScene(graph);
        expect(ts.batchOf('catenary').mesh.visible).toBe(false);
        graph.setSegmentStyle(s1, { electrified: true });
        expect(ts.batchOf('catenary').mesh.visible).toBe(true);
        graph.setSegmentStyle(s1, { electrified: false });
        expect(ts.batchOf('catenary').mesh.visible).toBe(false);
        ts.dispose();
    });

    it('keeps a reused geometry id apart from the segment that held it before', () => {
        const { s1 } = twoSegments(graph);
        const s3 = layLine(graph, { x: 0, y: 500 }, { x: 100, y: 500 });
        const ts = new TrackScene(graph);
        graph.removeTrackSegment(s3);
        const s4 = layLine(graph, { x: 0, y: 900 }, { x: 100, y: 900 });
        expect(ts.batchOf('ballast').stats.liveInstances).toBe(3);
        const box = boxIn(ts, 'ballast', s4);
        expect(box.min.y).toBeLessThan(-899);
        graph.removeTrackSegment(s1);
        expect(boxIn(ts, 'ballast', s4)).toEqual(box);
        expect(ts.batchOf('ballast').stats.liveInstances).toBe(2);
        ts.dispose();
    });

    it('replacing the layout five times keeps each batch within four times what it holds', async () => {
        const other = new TrackGraph();
        for (let i = 0; i < 50; i++) {
            layLine(other, { x: 0, y: i * 20 }, { x: 60, y: i * 20 });
        }
        const data = other.serialize();
        const ts = new TrackScene(graph);
        for (let round = 0; round < 5; round++) {
            await graph.loadFromSerializedData(data, {
                yieldToFrame: async () => {},
            });
            for (const n of graph.trackCurveManager.livingEntities) {
                expect(ts.partsOf(n)).toBeDefined();
            }
            expect(ts.batchOf('ballast').stats.liveInstances).toBe(50);
            for (const part of PARTS) {
                const s = ts.batchOf(part).stats;
                expect(s.vertexCapacity).toBeLessThanOrEqual(
                    Math.max(4 * s.liveVertices, MIN_VERTEX_CAPACITY)
                );
                expect(s.indexCapacity).toBeLessThanOrEqual(
                    Math.max(4 * s.liveIndices, MIN_INDEX_CAPACITY)
                );
            }
        }
        ts.dispose();
    });

    it('matches a replaced layout exactly after loadFromSerializedData', async () => {
        twoSegments(graph);
        layLine(graph, { x: 0, y: 500 }, { x: 100, y: 500 });
        const ts = new TrackScene(graph);
        const old = [...graph.trackCurveManager.livingEntities];

        const other = new TrackGraph();
        layLine(other, { x: 0, y: 0 }, { x: 60, y: 0 });
        layLine(other, { x: 0, y: 300 }, { x: 60, y: 300 });
        layLine(other, { x: 0, y: 600 }, { x: 60, y: 600 });

        await graph.loadFromSerializedData(other.serialize(), {
            yieldToFrame: async () => {},
        });

        const living = graph.trackCurveManager.livingEntities;
        expect(living).toHaveLength(3);
        for (const n of living) expect(ts.partsOf(n)).toBeDefined();
        for (const n of old) {
            if (!living.includes(n)) expect(ts.partsOf(n)).toBeUndefined();
        }
        expect(ts.batchOf('ballast').stats.liveInstances).toBe(3);
        ts.dispose();
    });

    it('dispose() unsubscribes, empties the scene and frees the batches and materials', () => {
        twoSegments(graph);
        const ts = new TrackScene(graph);
        let calls = 0;
        ts.onChange(() => calls++);
        const geometryDisposed = PARTS.map(part => {
            let n = 0;
            ts.batchOf(part).mesh.geometry.addEventListener(
                'dispose',
                () => n++
            );
            return () => n;
        });
        let materialDisposed = 0;
        ts.materials.ballast.addEventListener(
            'dispose',
            () => materialDisposed++
        );
        ts.dispose();
        for (const count of geometryDisposed) expect(count()).toBe(1);
        expect(materialDisposed).toBe(1);
        expect(ts.scene.children).toHaveLength(0);
        spy = spyOnGeometryDispose();
        layLine(graph, { x: 0, y: 500 }, { x: 100, y: 500 });
        for (const n of graph.trackCurveManager.livingEntities) {
            graph.setSegmentStyle(n, { electrified: true });
            graph.removeTrackSegment(n);
        }
        expect(calls).toBe(0);
        expect(ts.scene.children).toHaveLength(0);
        expect(spy.count).toBe(0);
    });

    it('builds 3000 segments in under 3 s, in seven objects, and rebuilds one without touching the rest', () => {
        for (let i = 0; i < 3000; i++) {
            const col = i % 60;
            const row = Math.floor(i / 60);
            layLine(
                graph,
                { x: col * 30, y: row * 30 },
                { x: col * 30 + 10, y: row * 30 }
            );
        }
        const living = [...graph.trackCurveManager.livingEntities];
        expect(living).toHaveLength(3000);
        const t1 = performance.now();
        const ts = new TrackScene(graph);
        const ms = performance.now() - t1;
        expect(ms).toBeLessThan(3000);
        expect(ts.scene.children).toHaveLength(7);
        expect(ts.batchOf('ballast').stats.liveInstances).toBe(3000);
        const recorded = new Map(living.map(n => [n, ts.partsOf(n)]));
        const target = living[1234]!;
        const joint =
            graph.trackCurveManager.getTrackSegmentWithJoints(target)!.t0Joint;
        graph.setJointElevation(joint, 3);
        let changed = 0;
        for (const n of living) {
            if (ts.partsOf(n) !== recorded.get(n)) changed++;
            else expect(ts.partsOf(n)).toBe(recorded.get(n));
        }
        expect(ts.partsOf(target)).not.toBe(recorded.get(target));
        expect(changed).toBe(1);
        ts.dispose();
    }, 60000);
});
