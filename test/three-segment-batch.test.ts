import { describe, expect, it } from 'bun:test';
import { Box3, BufferGeometry, MeshBasicMaterial, PlaneGeometry } from 'three';

import {
    MIN_VERTEX_CAPACITY,
    SegmentBatch,
} from '../src/three/segment-batch.js';

const material = new MeshBasicMaterial();

/** A (w + 1)(h + 1) vertex plane, moved so each one's box differs. */
function plane(w: number, h: number, shift = 0): BufferGeometry {
    const geometry = new PlaneGeometry(1, 1, w, h).translate(shift, 0, 0);
    geometry.computeBoundingBox();
    return geometry;
}

function boxOf(batch: SegmentBatch, geometryId: number): Box3 {
    return batch.mesh.getBoundingBoxAt(geometryId, new Box3())!;
}

function expectBox(
    batch: SegmentBatch,
    handle: { geometryId: number },
    source: BufferGeometry
): void {
    expect(boxOf(batch, handle.geometryId).equals(source.boundingBox!)).toBe(
        true
    );
}

describe('SegmentBatch', () => {
    it('draws an added geometry as one instance, and hides the mesh while it holds nothing', () => {
        const batch = new SegmentBatch(material, 'test');
        expect(batch.mesh.visible).toBe(false);
        const source = plane(2, 2, 3);
        const h = batch.add(source);
        expect(batch.mesh.visible).toBe(true);
        expect(batch.stats.liveInstances).toBe(1);
        expectBox(batch, h, source);
        batch.remove(h);
        expect(batch.mesh.visible).toBe(false);
        expect(batch.stats.liveInstances).toBe(0);
        batch.dispose();
    });

    it('culls each instance, sorts none, never culls the whole mesh, and keeps its material and name', () => {
        const batch = new SegmentBatch(material, 'rails');
        expect(batch.mesh.perObjectFrustumCulled).toBe(true);
        expect(batch.mesh.sortObjects).toBe(false);
        expect(batch.mesh.frustumCulled).toBe(false);
        expect(batch.mesh.material).toBe(material);
        expect(batch.mesh.name).toBe('rails');
        batch.dispose();
    });

    it('compacts dead space instead of growing', () => {
        const batch = new SegmentBatch(material, 'test', {
            vertices: 1000,
            indices: 10000,
        });
        const a = batch.add(plane(24, 24, 1));
        const sourceB = plane(9, 9, 2);
        const b = batch.add(sourceB);
        batch.remove(a);
        const sourceC = plane(24, 24, 3);
        const c = batch.add(sourceC);
        expect(batch.stats.vertexCapacity).toBe(1000);
        expectBox(batch, b, sourceB);
        expectBox(batch, c, sourceC);
        batch.dispose();
    });

    it('grows, at least doubling, when under half its space is dead', () => {
        const batch = new SegmentBatch(material, 'test', {
            vertices: 1000,
            indices: 10000,
        });
        const sourceA = plane(24, 24, 1);
        const a = batch.add(sourceA);
        const b = batch.add(plane(9, 9, 2));
        batch.remove(b);
        const sourceC = plane(24, 24, 3);
        const c = batch.add(sourceC);
        expect(batch.stats.vertexCapacity).toBe(2000);
        expectBox(batch, a, sourceA);
        expectBox(batch, c, sourceC);
        batch.dispose();
    });

    it('takes a first geometry larger than its starting size', () => {
        const batch = new SegmentBatch(material, 'test');
        const source = plane(99, 99, 1);
        const h = batch.add(source);
        expect(batch.stats.vertexCapacity).toBeGreaterThanOrEqual(10000);
        expect(batch.stats.indexCapacity).toBeGreaterThanOrEqual(58806);
        expectBox(batch, h, source);
        batch.dispose();
    });

    it('adds instances past its starting count', () => {
        const batch = new SegmentBatch(material, 'test');
        const sources = Array.from({ length: 100 }, (_, i) => plane(1, 1, i));
        const handles = sources.map(s => batch.add(s));
        expect(batch.stats.liveInstances).toBe(100);
        expect(batch.stats.instanceCapacity).toBeGreaterThanOrEqual(100);
        expectBox(batch, handles[0]!, sources[0]!);
        expectBox(batch, handles[99]!, sources[99]!);
        batch.dispose();
    });

    it('stays within four times what it holds when everything is replaced again and again', () => {
        const batch = new SegmentBatch(material, 'test');
        const source = plane(24, 24);
        for (let round = 0; round < 10; round++) {
            const handles = Array.from({ length: 20 }, () => batch.add(source));
            const s = batch.stats;
            expect(s.vertexCapacity).toBeLessThanOrEqual(
                Math.max(4 * s.liveVertices, MIN_VERTEX_CAPACITY)
            );
            expect(s.indexCapacity).toBeLessThanOrEqual(
                Math.max(4 * s.liveIndices, 8192)
            );
            for (const h of handles) batch.remove(h);
        }
        batch.dispose();
    });

    it("dispose frees the batch's geometry once", () => {
        const batch = new SegmentBatch(material, 'test');
        batch.add(plane(1, 1));
        let count = 0;
        batch.mesh.geometry.addEventListener('dispose', () => count++);
        batch.dispose();
        batch.dispose();
        expect(count).toBe(1);
    });
});
