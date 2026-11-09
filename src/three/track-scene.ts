import { Box3, type BufferGeometry, Group, Mesh, Scene } from 'three';

import type { TrackGraph } from '../tracks/track.js';
import { buildSegmentGeometries, segmentShapeOf } from './geometry.js';
import { TrackMaterials } from './materials.js';

/** One segment's group, with the box the bounds sum and the geometries to free. */
type SegmentEntry = {
    group: Group;
    box: Box3;
    geometries: BufferGeometry[];
};

/**
 * A three.js `Scene` kept in step with a `TrackGraph`: one `Group` per
 * segment, named `segment:<n>`, added, rebuilt and removed as the graph's
 * segment events fire. Every group and mesh stays at an identity transform;
 * the geometry is already in scene coordinates (x, -y, height).
 *
 * A segment's surface is drawn by two meshes, `surface` and `sleepers`, over
 * one shared geometry. The materials are shared by every segment and freed
 * only by `dispose`.
 */
export class TrackScene {
    readonly scene = new Scene();
    readonly materials = new TrackMaterials();

    private readonly _entries = new Map<number, SegmentEntry>();
    private readonly _listeners = new Set<() => void>();
    private readonly _unsubscribes: Array<() => void>;
    private _disposed = false;

    constructor(private readonly _graph: TrackGraph) {
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

    groupOf(segment: number): Group | undefined {
        return this._entries.get(segment)?.group;
    }

    /** The layout's extent in scene coordinates; empty for no track. */
    bounds(): Box3 {
        const box = new Box3();
        for (const entry of this._entries.values()) box.union(entry.box);
        return box;
    }

    /** Calls `listener` after any group is added, rebuilt or removed. */
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
        for (const entry of this._entries.values()) this._drop(entry);
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

    /** Replace segment `n`'s group with a fresh one, or just drop it if the segment is gone. */
    private _build(n: number): void {
        this._discard(n);
        const segment =
            this._graph.trackCurveManager.getTrackSegmentWithJoints(n);
        if (!segment) return;
        const shape = segmentShapeOf(segment);
        const built = buildSegmentGeometries(shape);
        const group = new Group();
        group.name = `segment:${n}`;
        const sleepers =
            shape.trackStyle === 'slab'
                ? this.materials.slabSleepers
                : this.materials.ballastSleepers;
        const surfaceMaterial =
            shape.trackStyle === 'slab'
                ? this.materials.slab
                : this.materials.ballast;
        const parts: Array<[string, BufferGeometry, Mesh['material']]> = [
            ['surface', built.surface, surfaceMaterial],
            ['sleepers', built.surface, sleepers],
            ['rails', built.rails, this.materials.rails],
        ];
        if (built.bed) parts.push(['bed', built.bed, this.materials.bed]);
        if (built.catenary) {
            parts.push(['catenary', built.catenary, this.materials.catenary]);
        }
        const geometries = new Set<BufferGeometry>();
        const box = new Box3();
        for (const [name, geometry, material] of parts) {
            const mesh = new Mesh(geometry, material);
            mesh.name = name;
            group.add(mesh);
            if (!geometries.has(geometry)) {
                geometries.add(geometry);
                geometry.computeBoundingBox();
                if (geometry.boundingBox) box.union(geometry.boundingBox);
            }
        }
        this.scene.add(group);
        this._entries.set(n, { group, box, geometries: [...geometries] });
    }

    /** Remove segment `n`'s group and free its geometry; whether there was one. */
    private _discard(n: number): boolean {
        const entry = this._entries.get(n);
        if (!entry) return false;
        this._entries.delete(n);
        this._drop(entry);
        return true;
    }

    private _drop(entry: SegmentEntry): void {
        entry.group.removeFromParent();
        for (const geometry of entry.geometries) geometry.dispose();
    }

    private _notify(): void {
        for (const listener of [...this._listeners]) listener();
    }
}
