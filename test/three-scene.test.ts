import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { BufferGeometry, type Group, type Mesh } from 'three';

import { TrackScene } from '../src/three/track-scene.js';
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

function hasCatenary(group: Group | undefined) {
    return group?.getObjectByName('catenary') !== undefined;
}

function segmentGroups(ts: TrackScene) {
    return ts.scene.children.filter(c => c.name.startsWith('segment:'));
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

/** Every distinct geometry the scene's groups currently hold. */
function geometriesOf(ts: TrackScene) {
    const set = new Set<BufferGeometry>();
    ts.scene.traverse(o => {
        const g = (o as Mesh).geometry;
        if (g) set.add(g);
    });
    return set;
}

let graph: TrackGraph;
let spy: ReturnType<typeof spyOnGeometryDispose> | undefined;

beforeEach(() => {
    graph = new TrackGraph();
});
afterEach(() => {
    spy?.restore();
    spy = undefined;
});

describe('TrackScene', () => {
    it('draws segments that existed before it was built', () => {
        const { s1, s2 } = twoSegments(graph);
        const ts = new TrackScene(graph);
        expect(ts.groupOf(s1)).toBeDefined();
        expect(ts.groupOf(s2)).toBeDefined();
        expect(ts.groupOf(s1)!.name).toBe(`segment:${s1}`);
        expect(ts.groupOf(s1)!.parent).toBe(ts.scene);
        ts.dispose();
    });

    it('names meshes, shares the materials and keeps identity transforms', () => {
        const { s1 } = twoSegments(graph);
        graph.setSegmentStyle(s1, { electrified: true, bed: true });
        const ts = new TrackScene(graph);
        const group = ts.groupOf(s1)!;
        const names = group.children.map(c => c.name).sort();
        expect(names).toEqual(
            ['bed', 'catenary', 'rails', 'sleepers', 'surface'].sort()
        );
        const surface = group.getObjectByName('surface') as Mesh;
        const sleepers = group.getObjectByName('sleepers') as Mesh;
        expect(surface.material).toBe(ts.materials.ballast);
        expect(sleepers.material).toBe(ts.materials.ballastSleepers);
        expect(sleepers.geometry).toBe(surface.geometry);
        expect((group.getObjectByName('rails') as Mesh).material).toBe(
            ts.materials.rails
        );
        group.traverse(o => {
            expect(o.position.toArray()).toEqual([0, 0, 0]);
            expect(o.scale.toArray()).toEqual([1, 1, 1]);
            expect(o.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
        });
        ts.dispose();
    });

    it('uses the slab materials for a slab segment', () => {
        const { s1 } = twoSegments(graph);
        graph.setSegmentStyle(s1, { trackStyle: 'slab' });
        const ts = new TrackScene(graph);
        const group = ts.groupOf(s1)!;
        expect((group.getObjectByName('surface') as Mesh).material).toBe(
            ts.materials.slab
        );
        expect((group.getObjectByName('sleepers') as Mesh).material).toBe(
            ts.materials.slabSleepers
        );
        ts.dispose();
    });

    it('adds, rebuilds and removes groups as the graph changes', () => {
        const { j, s1 } = twoSegments(graph);
        const ts = new TrackScene(graph);
        const s3 = layLine(graph, { x: 0, y: 500 }, { x: 100, y: 500 });
        expect(ts.groupOf(s3)).toBeDefined();
        const before = ts.groupOf(s1);
        graph.setJointElevation(j, 6.5);
        expect(ts.groupOf(s1)).toBeDefined();
        expect(ts.groupOf(s1)).not.toBe(before);
        expect(before!.parent).toBeNull();
        expect(segmentGroups(ts)).toHaveLength(3);
        expect(hasCatenary(ts.groupOf(s1))).toBe(false);
        graph.setSegmentStyle(s1, { electrified: true });
        expect(hasCatenary(ts.groupOf(s1))).toBe(true);
        graph.removeTrackSegment(s3);
        expect(ts.groupOf(s3)).toBeUndefined();
        expect(segmentGroups(ts)).toHaveLength(2);
        ts.dispose();
    });

    it('rebuilds only the segments whose heights changed', () => {
        const { j, s1, s2 } = twoSegments(graph);
        const unrelated = layLine(graph, { x: 0, y: 500 }, { x: 100, y: 500 });
        const ts = new TrackScene(graph);
        const other = ts.groupOf(unrelated);
        const s1Before = ts.groupOf(s1);
        const s2Before = ts.groupOf(s2);
        graph.setJointElevation(j, 6.5);
        expect(ts.groupOf(unrelated)).toBe(other);
        expect(ts.groupOf(s1)).not.toBe(s1Before);
        expect(ts.groupOf(s2)).not.toBe(s2Before);
        ts.dispose();
    });

    it('draws the new heights', () => {
        const { j, s1 } = twoSegments(graph);
        const ts = new TrackScene(graph);
        expect(ts.bounds().max.z).toBeLessThan(1);
        graph.setJointElevation(j, 6.5);
        expect(ts.groupOf(s1)).toBeDefined();
        expect(ts.bounds().max.z).toBeGreaterThan(6);
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

    it('disposes what it drops and keeps nothing after a whole layout is removed (Review Focus 1)', () => {
        twoSegments(graph);
        layLine(graph, { x: 0, y: 500 }, { x: 100, y: 500 });
        spy = spyOnGeometryDispose();
        const ts = new TrackScene(graph);
        const built = geometriesOf(ts);
        expect(built.size).toBeGreaterThan(0);
        for (const n of [...graph.trackCurveManager.livingEntities]) {
            graph.removeTrackSegment(n);
        }
        expect(segmentGroups(ts)).toHaveLength(0);
        expect(spy.count).toBe(built.size);
        for (const g of built) expect(spy.disposed.has(g)).toBe(true);
        expect(ts.bounds().isEmpty()).toBe(true);
        ts.dispose();
    });

    it('frees the old geometry when a segment is rebuilt', () => {
        const { j, s1 } = twoSegments(graph);
        const ts = new TrackScene(graph);
        spy = spyOnGeometryDispose();
        const old = new Set<BufferGeometry>();
        ts.groupOf(s1)!.traverse(o => {
            const g = (o as Mesh).geometry;
            if (g) old.add(g);
        });
        graph.setJointElevation(j, 4);
        for (const g of old) expect(spy.disposed.has(g)).toBe(true);
        expect(spy.count).toBeGreaterThanOrEqual(old.size);
        ts.dispose();
    });

    it('matches a replaced layout exactly after loadFromSerializedData (Review Focus 1)', async () => {
        twoSegments(graph);
        layLine(graph, { x: 0, y: 500 }, { x: 100, y: 500 });
        const ts = new TrackScene(graph);
        const oldGeometries = geometriesOf(ts);

        const other = new TrackGraph();
        layLine(other, { x: 0, y: 0 }, { x: 60, y: 0 });
        layLine(other, { x: 0, y: 300 }, { x: 60, y: 300 });
        layLine(other, { x: 0, y: 600 }, { x: 60, y: 600 });

        spy = spyOnGeometryDispose();
        await graph.loadFromSerializedData(other.serialize(), {
            yieldToFrame: async () => {},
        });

        const living = graph.trackCurveManager.livingEntities;
        expect(living).toHaveLength(3);
        expect(
            segmentGroups(ts)
                .map(g => g.name)
                .sort()
        ).toEqual(living.map(n => `segment:${n}`).sort());
        for (const n of living) expect(ts.groupOf(n)).toBeDefined();
        for (const g of oldGeometries) expect(spy.disposed.has(g)).toBe(true);
        // nothing of the old layout is still in the scene
        for (const g of geometriesOf(ts))
            expect(oldGeometries.has(g)).toBe(false);
        ts.dispose();
    });

    it('dispose() unsubscribes, empties the scene and disposes geometries and materials', () => {
        twoSegments(graph);
        const ts = new TrackScene(graph);
        const built = geometriesOf(ts);
        let calls = 0;
        ts.onChange(() => calls++);
        spy = spyOnGeometryDispose();
        let materialDisposed = 0;
        ts.materials.ballast.addEventListener(
            'dispose',
            () => materialDisposed++
        );
        ts.dispose();
        for (const g of built) expect(spy.disposed.has(g)).toBe(true);
        expect(materialDisposed).toBe(1);
        expect(ts.scene.children).toHaveLength(0);
        const before = spy.count;
        layLine(graph, { x: 0, y: 500 }, { x: 100, y: 500 });
        for (const n of graph.trackCurveManager.livingEntities) {
            graph.setSegmentStyle(n, { electrified: true });
            graph.removeTrackSegment(n);
        }
        expect(calls).toBe(0);
        expect(ts.scene.children).toHaveLength(0);
        expect(spy.count).toBe(before);
    });

    it('builds a scene of 3000 segments in under 3 s', () => {
        const t0 = performance.now();
        for (let i = 0; i < 3000; i++) {
            const col = i % 60;
            const row = Math.floor(i / 60);
            layLine(
                graph,
                { x: col * 30, y: row * 30 },
                { x: col * 30 + 10, y: row * 30 }
            );
        }
        const graphMs = performance.now() - t0;
        expect(graph.trackCurveManager.livingEntities).toHaveLength(3000);
        const t1 = performance.now();
        const ts = new TrackScene(graph);
        const ms = performance.now() - t1;
        console.log(
            `graph ${graphMs.toFixed(0)} ms, scene ${ms.toFixed(0)} ms`
        );
        expect(segmentGroups(ts)).toHaveLength(3000);
        expect(ms).toBeLessThan(3000);
        ts.dispose();
    }, 60000);
});
