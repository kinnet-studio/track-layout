import { BatchedMesh } from 'three';
import type { BufferGeometry, Material } from 'three';

export type BatchHandle = {
    readonly geometryId: number;
    readonly instanceId: number;
};

export const MIN_VERTEX_CAPACITY = 4096;
export const MIN_INDEX_CAPACITY = 8192;
export const MIN_INSTANCE_CAPACITY = 64;

export type BatchStats = {
    liveVertices: number;
    liveIndices: number;
    liveInstances: number;
    vertexCapacity: number;
    indexCapacity: number;
    instanceCapacity: number;
};

/**
 * One BatchedMesh, plus the growing and compacting it lacks. Three exposes
 * only the unused space, so the batch tracks its own capacities.
 */
export class SegmentBatch {
    readonly mesh: BatchedMesh;

    private vertexCapacity: number;
    private indexCapacity: number;
    private liveVertices = 0;
    private liveIndices = 0;
    // Live entries by geometry id: the handle `add` returned and its sizes.
    // Three reuses ids, so only the handle object tells a stale one apart.
    private readonly live = new Map<
        number,
        { handle: BatchHandle; vertices: number; indices: number }
    >();
    private disposed = false;

    constructor(
        material: Material,
        name: string,
        capacity: {
            vertices?: number;
            indices?: number;
            instances?: number;
        } = {}
    ) {
        const instances = capacity.instances ?? MIN_INSTANCE_CAPACITY;
        this.vertexCapacity = capacity.vertices ?? MIN_VERTEX_CAPACITY;
        this.indexCapacity = capacity.indices ?? MIN_INDEX_CAPACITY;
        this.mesh = new BatchedMesh(
            instances,
            this.vertexCapacity,
            this.indexCapacity,
            material
        );
        this.mesh.perObjectFrustumCulled = true;
        // Track is opaque, so sorting would only cost time.
        this.mesh.sortObjects = false;
        // The mesh's own bounds are stale after edits; cull per instance.
        this.mesh.frustumCulled = false;
        this.mesh.visible = false;
        this.mesh.name = name;
    }

    /** Copies `geometry` in and draws it once. The caller still owns and frees `geometry`. */
    add(geometry: BufferGeometry): BatchHandle {
        const vertices = geometry.getAttribute('position').count;
        const indices = geometry.getIndex()!.count;
        this.makeRoom(vertices, indices);
        const geometryId = this.mesh.addGeometry(geometry);
        const instanceId = this.mesh.addInstance(geometryId);
        const handle = { geometryId, instanceId };
        this.live.set(geometryId, { handle, vertices, indices });
        this.liveVertices += vertices;
        this.liveIndices += indices;
        this.mesh.visible = true;
        return handle;
    }

    /** Removing a handle that was already removed does nothing, even after its ids are reused. */
    remove(handle: BatchHandle): void {
        const size = this.live.get(handle.geometryId);
        if (size === undefined || size.handle !== handle) return;
        // Deleting a geometry deletes its instance too.
        this.mesh.deleteGeometry(handle.geometryId);
        this.live.delete(handle.geometryId);
        this.liveVertices -= size.vertices;
        this.liveIndices -= size.indices;
        this.mesh.visible = this.mesh.instanceCount > 0;
    }

    get stats(): BatchStats {
        return {
            liveVertices: this.liveVertices,
            liveIndices: this.liveIndices,
            liveInstances: this.mesh.instanceCount,
            vertexCapacity: this.vertexCapacity,
            indexCapacity: this.indexCapacity,
            instanceCapacity: this.mesh.maxInstanceCount,
        };
    }

    dispose(): void {
        // The material is shared, so only the batch's own data is freed.
        if (this.disposed) return;
        this.disposed = true;
        this.mesh.dispose();
    }

    private makeRoom(vertices: number, indices: number): void {
        const mesh = this.mesh;
        if (mesh.instanceCount >= mesh.maxInstanceCount) {
            const max = mesh.maxInstanceCount;
            mesh.setInstanceCount(Math.max(2 * max, max + 1));
        }
        const short = () =>
            vertices > mesh.unusedVertexCount ||
            indices > mesh.unusedIndexCount;
        if (!short()) return;

        // Deleted geometry leaves holes that only `optimize` gives back. Do
        // that when half or more is dead; otherwise growing is cheaper.
        const deadVertices =
            this.vertexCapacity - mesh.unusedVertexCount - this.liveVertices;
        const deadIndices =
            this.indexCapacity - mesh.unusedIndexCount - this.liveIndices;
        if (
            deadVertices >= this.vertexCapacity / 2 ||
            deadIndices >= this.indexCapacity / 2
        ) {
            mesh.optimize();
        }
        if (!short()) return;

        // Grow each dimension on its own. Track geometry has several indices
        // per vertex, so growing both together would inflate the one that
        // is not short.
        const usedVertices = this.vertexCapacity - mesh.unusedVertexCount;
        const usedIndices = this.indexCapacity - mesh.unusedIndexCount;
        if (vertices > mesh.unusedVertexCount)
            this.vertexCapacity = Math.max(
                2 * this.vertexCapacity,
                usedVertices + vertices
            );
        if (indices > mesh.unusedIndexCount)
            this.indexCapacity = Math.max(
                2 * this.indexCapacity,
                usedIndices + indices
            );
        mesh.setGeometrySize(this.vertexCapacity, this.indexCapacity);
    }
}
