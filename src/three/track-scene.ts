import { Box3, type BufferGeometry, Scene } from 'three';

import type { TrackGraph } from '../tracks/track.js';
import { buildSegmentGeometries, segmentShapeOf } from './geometry.js';
import { TrackMaterials } from './materials.js';
import { type BatchHandle, SegmentBatch } from './segment-batch.js';

export type PartName =
    | 'ballast'
    | 'ballastSleepers'
    | 'slab'
    | 'slabSleepers'
    | 'bed'
    | 'rails'
    | 'catenary';

/** Draw order; also the order of the meshes in the scene. */
const PART_NAMES: readonly PartName[] = [
    'ballast',
    'ballastSleepers',
    'slab',
    'slabSleepers',
    'bed',
    'rails',
    'catenary',
];

/** @internal Where a segment is drawn: its handle in each batch it uses. */
export type SegmentParts = Readonly<Partial<Record<PartName, BatchHandle>>>;

/** One segment's handles, and the box the bounds sum. */
type SegmentEntry = {
    parts: SegmentParts;
    box: Box3;
};

/**
 * A three.js `Scene` kept in step with a `TrackGraph`: one `BatchedMesh` per
 * part, shared by every segment, named `batch:<part>`. A segment is added,
 * rebuilt and removed in them as the graph's segment events fire. Every mesh
 * stays at an identity transform; the geometry is already in scene
 * coordinates (x, -y, height).
 *
 * A segment's surface is drawn twice, as ballast or slab and again as
 * sleepers, from one copy of the geometry in each batch. The materials are
 * shared by every segment and freed only by `dispose`.
 */
export class TrackScene {
    readonly scene = new Scene();
    /** @internal TrackView3D reads it. */
    readonly materials = new TrackMaterials();

    private readonly _batches: Record<PartName, SegmentBatch>;
    private readonly _entries = new Map<number, SegmentEntry>();
    private readonly _listeners = new Set<() => void>();
    private readonly _unsubscribes: Array<() => void>;
    private _disposed = false;

    constructor(private readonly _graph: TrackGraph) {
        const batches: Partial<Record<PartName, SegmentBatch>> = {};
        for (const part of PART_NAMES) {
            const batch = new SegmentBatch(
                this.materials[part],
                `batch:${part}`
            );
            batches[part] = batch;
            this.scene.add(batch.mesh);
        }
        this._batches = batches as Record<PartName, SegmentBatch>;
        const manager = _graph.trackCurveManager;
        for (const n of manager.livingEntities) this._build(n);
        this._unsubscribes = [
            manager.onAddTrackSegment(n => this._rebuild(n)),
            manager.onRemoveTrackSegment(n => this._remove(n)),
            manager.onSegmentStyleChanged(({ segmentNumber }) =>
                this._rebuild(segmentNumber)
            ),
            manager.onSegmentElevationChanged(n => this._rebuild(n)),
        ];
    }

    /** @internal For tests and TrackView3D; not part of the API. */
    batchOf(part: PartName): SegmentBatch {
        return this._batches[part];
    }

    /**
     * Where segment `segment` is drawn, if it is.
     *
     * @internal For tests; not part of the API, and may change.
     */
    partsOf(segment: number): SegmentParts | undefined {
        return this._entries.get(segment)?.parts;
    }

    /** The layout's extent in scene coordinates; empty for no track. */
    bounds(): Box3 {
        const box = new Box3();
        for (const entry of this._entries.values()) box.union(entry.box);
        return box;
    }

    /** Calls `listener` after any segment is added, rebuilt or removed. */
    onChange(listener: () => void): () => void {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    }

    dispose(): void {
        if (this._disposed) return;
        this._disposed = true;
        for (const off of this._unsubscribes) off();
        for (const part of PART_NAMES) {
            const batch = this._batches[part];
            batch.mesh.removeFromParent();
            batch.dispose();
        }
        this._entries.clear();
        this._listeners.clear();
        this.materials.dispose();
    }

    private _rebuild(n: number): void {
        if (this._disposed) return;
        this._build(n);
        this._notify();
    }

    private _remove(n: number): void {
        if (this._disposed) return;
        if (!this._discard(n)) return;
        this._notify();
    }

    /** Replace segment `n`'s parts with fresh ones, or just drop them if the segment is gone. */
    private _build(n: number): void {
        this._discard(n);
        const segment =
            this._graph.trackCurveManager.getTrackSegmentWithJoints(n);
        if (!segment) return;
        const shape = segmentShapeOf(segment);
        const built = buildSegmentGeometries(shape);
        const slab = shape.trackStyle === 'slab';
        const placements: Array<[PartName, BufferGeometry]> = [
            [slab ? 'slab' : 'ballast', built.surface],
            [slab ? 'slabSleepers' : 'ballastSleepers', built.surface],
            ['rails', built.rails],
        ];
        if (built.bed) placements.push(['bed', built.bed]);
        if (built.catenary) placements.push(['catenary', built.catenary]);
        const parts: Partial<Record<PartName, BatchHandle>> = {};
        for (const [part, geometry] of placements) {
            parts[part] = this._batches[part].add(geometry);
        }
        const box = new Box3();
        // The surface is shared by two parts, so union and free each once.
        for (const geometry of new Set(placements.map(([, g]) => g))) {
            geometry.computeBoundingBox();
            if (geometry.boundingBox) box.union(geometry.boundingBox);
            geometry.dispose();
        }
        this._entries.set(n, { parts, box });
    }

    /** Take segment `n` out of its batches; whether it was in them. */
    private _discard(n: number): boolean {
        const entry = this._entries.get(n);
        if (!entry) return false;
        this._entries.delete(n);
        for (const part of PART_NAMES) {
            const handle = entry.parts[part];
            if (handle) this._batches[part].remove(handle);
        }
        return true;
    }

    private _notify(): void {
        for (const listener of [...this._listeners]) listener();
    }
}
