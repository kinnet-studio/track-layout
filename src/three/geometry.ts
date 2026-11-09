import type { BCurve, Point } from '@ue-too/curve';
import { BufferGeometry, Float32BufferAttribute } from 'three';

import { ballastHalfWidthForGauge } from '../shared/track-dimensions.js';
import type { TrackSegmentWithElevation, TrackStyle } from '../tracks/types.js';
import { getElevationAtT } from '../tracks/utils.js';

/** The most a sampled chord may stray from the curve, in metres (0.2 px at 10 px/m). */
export const MAX_CHORD_ERROR = 0.02;

/** Ballast: the sides drop this far (m) over `BALLAST_SLOPE_RUN` of horizontal run. */
export const BALLAST_DEPTH = 0.3;
export const BALLAST_SLOPE_RUN = 0.45;
/** Slab: vertical sides this deep (m). */
export const SLAB_DEPTH = 0.25;
/** Bed: thickness (m), under the foot of the ballast or slab. */
export const BED_THICKNESS = 0.3;
/** The 2D renderer's default bed width (m). */
export const DEFAULT_BED_WIDTH = 3;
/** Rail section (m): width and height, standing on the ballast top. */
export const RAIL_WIDTH = 0.07;
export const RAIL_HEIGHT = 0.15;
/** Catenary (m): masts, their square section, and the contact wire. */
export const MAST_SPACING = 25;
export const MAST_SIZE = 0.25;
export const MAST_HEIGHT = 6.5;
export const WIRE_HEIGHT_ABOVE_RAIL_TOP = 5.5;
export const WIRE_SIZE = 0.04;

/** A track segment's shape and style, as the geometry builders read it. */
export type SegmentShape = {
    curve: BCurve;
    gauge: number;
    /** Heights (m) at t = 0 and t = 1; linear in the curve's parameter t. */
    elevation: { from: number; to: number };
    trackStyle: TrackStyle;
    bed: boolean;
    /** Total bed width (m); `DEFAULT_BED_WIDTH` when unset. */
    bedWidth?: number;
    electrified: boolean;
    /** Which side of the curve the masts stand on (+1: along the world normal). */
    catenarySide: 1 | -1;
};

/** Read a segment's shape, filling the style defaults the 2D renderer uses. */
export function segmentShapeOf(
    segment: TrackSegmentWithElevation
): SegmentShape {
    return {
        curve: segment.curve,
        gauge: segment.gauge,
        elevation: segment.elevation,
        trackStyle: segment.trackStyle ?? 'ballasted',
        bed: segment.bed ?? false,
        bedWidth: segment.bedWidth,
        electrified: segment.electrified ?? false,
        catenarySide: segment.catenarySide ?? 1,
    };
}

export type SegmentSample = {
    /** Scene x. */
    x: number;
    /** Scene y (the world y negated). */
    y: number;
    /** Height (m). */
    z: number;
    /** The curve parameter. */
    t: number;
    /**
     * Unit normal across the track in scene x and y: the world normal
     * `(-ty, tx)` mapped to the scene, which is `(-ty, -tx)`.
     */
    normal: Point;
};

function unitTangent(curve: BCurve, t: number): Point {
    let d = curve.derivative(t);
    if (Math.hypot(d.x, d.y) < 1e-9) {
        // A cubic may have a stationary end; look a little inside.
        d = curve.derivative(t < 0.5 ? t + 1e-3 : t - 1e-3);
    }
    const len = Math.hypot(d.x, d.y) || 1;
    return { x: d.x / len, y: d.y / len };
}

type Point3 = { x: number; y: number; z: number };

function distanceToChord(p: Point3, a: Point3, b: Point3): number {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const len2 = abx * abx + aby * aby + abz * abz;
    const u =
        len2 === 0
            ? 0
            : Math.max(
                  0,
                  Math.min(
                      1,
                      ((p.x - a.x) * abx +
                          (p.y - a.y) * aby +
                          (p.z - a.z) * abz) /
                          len2
                  )
              );
    return Math.hypot(
        p.x - (a.x + u * abx),
        p.y - (a.y + u * aby),
        p.z - (a.z + u * abz)
    );
}

const CHECKS = [1 / 8, 2 / 8, 3 / 8, 4 / 8, 5 / 8, 6 / 8, 7 / 8];
const MAX_DEPTH = 14;

/**
 * Sample a curve so every chord stays within `MAX_CHORD_ERROR` of it, with
 * steps sized from the curve itself (a straight needs only its ends). The
 * list includes t = 0 and t = 1 exactly. `from` and `to` are the heights at
 * t = 0 and t = 1; `z` follows `getElevationAtT`.
 */
export function sampleSegment(
    curve: BCurve,
    from: number,
    to: number
): SegmentSample[] {
    const ts: number[] = [0];
    const elevation = { elevation: { from, to } };
    // The curve's position and its height at t. Height is linear in t, not in
    // position, so the chord error is measured in 3D.
    const at = (t: number): Point3 => {
        const p = curve.get(t);
        return { x: p.x, y: p.y, z: getElevationAtT(t, elevation) };
    };
    const walk = (
        t0: number,
        p0: Point3,
        t1: number,
        p1: Point3,
        depth: number
    ) => {
        let worst = 0;
        for (const u of CHECKS) {
            worst = Math.max(
                worst,
                distanceToChord(at(t0 + (t1 - t0) * u), p0, p1)
            );
        }
        if (worst > MAX_CHORD_ERROR && depth < MAX_DEPTH) {
            const tm = (t0 + t1) / 2;
            const pm = at(tm);
            walk(t0, p0, tm, pm, depth + 1);
            walk(tm, pm, t1, p1, depth + 1);
        } else {
            ts.push(t1);
        }
    };
    walk(0, at(0), 1, at(1), 0);

    return ts.map(t => {
        const p = curve.get(t);
        const tan = unitTangent(curve, t);
        return {
            x: p.x,
            y: -p.y,
            z: getElevationAtT(t, elevation),
            t,
            normal: { x: -tan.y, y: -tan.x },
        };
    });
}

// ---------------------------------------------------------------------------
// Mesh building

type ProfilePoint = {
    /** Offset across the track (m), + on the `normal` side. */
    across: number;
    /** Height relative to the sample's (m). */
    z: number;
    /** -1, 0 or +1: which side of the centreline the vertex lies on. */
    side: -1 | 0 | 1;
};

/** One flat face of a cross-section, left to right (or around, clockwise). */
type Face = { a: ProfilePoint; b: ProfilePoint; running?: boolean };

const pt = (across: number, z: number): ProfilePoint => ({
    across,
    z,
    side: across < 0 ? -1 : across > 0 ? 1 : 0,
});

/** Attributes the part carries on every vertex. */
type Options = {
    /** True half-width of the part (m); adds aAcross, aSide, aHalfWidth, aAlong. */
    halfWidth?: number;
    /** Adds the per-vertex aRunning flag. */
    runningFlag?: boolean;
};

class MeshBuilder {
    positions: number[] = [];
    normals: number[] = [];
    index: number[] = [];
    extras = new Map<string, { size: number; data: number[] }>();

    constructor(names: Record<string, number>) {
        for (const [name, size] of Object.entries(names)) {
            this.extras.set(name, { size, data: [] });
        }
    }

    vertex(
        pos: [number, number, number],
        normal: [number, number, number],
        extras: Record<string, number[]> = {}
    ): number {
        this.positions.push(...pos);
        this.normals.push(...normal);
        for (const [name, { data }] of this.extras) {
            data.push(...extras[name]);
        }
        return this.positions.length / 3 - 1;
    }

    /** Add a triangle, wound to face `want`. */
    triangle(a: number, b: number, c: number, want: [number, number, number]) {
        const p = this.positions;
        const ux = p[b * 3] - p[a * 3];
        const uy = p[b * 3 + 1] - p[a * 3 + 1];
        const uz = p[b * 3 + 2] - p[a * 3 + 2];
        const vx = p[c * 3] - p[a * 3];
        const vy = p[c * 3 + 1] - p[a * 3 + 1];
        const vz = p[c * 3 + 2] - p[a * 3 + 2];
        const dot =
            (uy * vz - uz * vy) * want[0] +
            (uz * vx - ux * vz) * want[1] +
            (ux * vy - uy * vx) * want[2];
        if (dot >= 0) this.index.push(a, b, c);
        else this.index.push(a, c, b);
    }

    quad(
        a0: number,
        b0: number,
        a1: number,
        b1: number,
        want: [number, number, number]
    ) {
        this.triangle(a0, b0, a1, want);
        this.triangle(b0, b1, a1, want);
    }

    build(): BufferGeometry {
        const g = new BufferGeometry();
        g.setAttribute(
            'position',
            new Float32BufferAttribute(this.positions, 3)
        );
        g.setAttribute('normal', new Float32BufferAttribute(this.normals, 3));
        for (const [name, { size, data }] of this.extras) {
            g.setAttribute(name, new Float32BufferAttribute(data, size));
        }
        g.setIndex(this.index);
        g.computeBoundingBox();
        g.computeBoundingSphere();
        return g;
    }
}

function arcLengths(curve: BCurve, samples: SegmentSample[]): number[] {
    return samples.map((s, i) =>
        i === 0
            ? 0
            : i === samples.length - 1
              ? curve.fullLength
              : curve.lengthAtT(s.t)
    );
}

/**
 * Loft cross-section `faces` along the samples. Each face gets its own
 * vertices so its normal stays flat across the face.
 */
function loft(
    faces: Face[],
    samples: SegmentSample[],
    along: number[],
    options: Options
): BufferGeometry {
    const names: Record<string, number> = {};
    if (options.halfWidth !== undefined) {
        names.aAcross = 2;
        names.aSide = 1;
        names.aHalfWidth = 1;
        names.aAlong = 1;
    }
    if (options.runningFlag) names.aRunning = 1;
    const mesh = new MeshBuilder(names);

    for (const face of faces) {
        const dAcross = face.b.across - face.a.across;
        const dz = face.b.z - face.a.z;
        const len = Math.hypot(dAcross, dz);
        // Left to right, the face looks along (-dz, dAcross) in (across, z).
        const nAcross = -dz / len;
        const nZ = dAcross / len;
        const rows: [number, number][] = [];
        for (let i = 0; i < samples.length; i++) {
            const s = samples[i];
            const row: number[] = [];
            for (const p of [face.a, face.b]) {
                const extras: Record<string, number[]> = {};
                if (options.halfWidth !== undefined) {
                    extras.aAcross = [s.normal.x, s.normal.y];
                    extras.aSide = [p.side];
                    extras.aHalfWidth = [options.halfWidth];
                    extras.aAlong = [along[i]];
                }
                if (options.runningFlag)
                    extras.aRunning = [face.running ? 1 : 0];
                row.push(
                    mesh.vertex(
                        [
                            s.x + s.normal.x * p.across,
                            s.y + s.normal.y * p.across,
                            s.z + p.z,
                        ],
                        [s.normal.x * nAcross, s.normal.y * nAcross, nZ],
                        extras
                    )
                );
            }
            rows.push([row[0], row[1]]);
        }
        for (let i = 0; i + 1 < samples.length; i++) {
            const s = samples[i];
            mesh.quad(rows[i][0], rows[i][1], rows[i + 1][0], rows[i + 1][1], [
                s.normal.x * nAcross,
                s.normal.y * nAcross,
                nZ,
            ]);
        }
    }
    return mesh.build();
}

/** Faces of a closed box section, clockwise, so each looks outward. */
function boxFaces(
    across0: number,
    across1: number,
    z0: number,
    z1: number,
    options: { bottom: boolean; runningTop?: boolean }
): Face[] {
    const faces: Face[] = [
        { a: pt(across0, z0), b: pt(across0, z1) },
        { a: pt(across0, z1), b: pt(across1, z1), running: options.runningTop },
        { a: pt(across1, z1), b: pt(across1, z0) },
    ];
    if (options.bottom) faces.push({ a: pt(across1, z0), b: pt(across0, z0) });
    return faces;
}

function surfaceFaces(style: TrackStyle, w: number): Face[] {
    const top: Face[] = [
        { a: pt(-w, 0), b: pt(0, 0) },
        { a: pt(0, 0), b: pt(w, 0) },
    ];
    if (style === 'slab') {
        return [
            { a: pt(-w, -SLAB_DEPTH), b: pt(-w, 0) },
            ...top,
            { a: pt(w, 0), b: pt(w, -SLAB_DEPTH) },
        ];
    }
    const foot = w + BALLAST_SLOPE_RUN;
    return [
        { a: pt(-foot, -BALLAST_DEPTH), b: pt(-w, 0) },
        ...top,
        { a: pt(w, 0), b: pt(foot, -BALLAST_DEPTH) },
    ];
}

function bedFaces(bedHalf: number, top: number): Face[] {
    const bottom = top - BED_THICKNESS;
    return [
        { a: pt(-bedHalf, bottom), b: pt(-bedHalf, top) },
        { a: pt(-bedHalf, top), b: pt(0, top) },
        { a: pt(0, top), b: pt(bedHalf, top) },
        { a: pt(bedHalf, top), b: pt(bedHalf, bottom) },
        { a: pt(bedHalf, bottom), b: pt(-bedHalf, bottom) },
    ];
}

function buildCatenary(shape: SegmentShape, samples: SegmentSample[]) {
    const { curve } = shape;
    const mesh = new MeshBuilder({});
    const ballastHw = ballastHalfWidthForGauge(shape.gauge);
    const offset = shape.bed
        ? Math.max(ballastHw, (shape.bedWidth ?? DEFAULT_BED_WIDTH) / 2)
        : ballastHw;

    // Masts: the 2D rule, at arc-length fractions i / count, ends included.
    const count = Math.max(1, Math.floor(curve.fullLength / MAST_SPACING));
    const half = MAST_SIZE / 2;
    for (let i = 0; i <= count; i++) {
        let t = i === 0 ? 0 : 1;
        if (i > 0 && i < count) {
            const r = curve.advanceByDistance(
                0,
                (i / count) * curve.fullLength
            );
            t =
                r.type === 'withinCurve'
                    ? r.tVal
                    : r.type === 'afterCurve'
                      ? 1
                      : 0;
        }
        const p = curve.get(t);
        const tan = unitTangent(curve, t);
        // Scene tangent, and the scene image of the world normal (-ty, tx).
        const tx = tan.x;
        const ty = -tan.y;
        const sx = -tan.y;
        const sy = -tan.x;
        const base = getElevationAtT(t, shape);
        const cx = p.x + sx * offset * shape.catenarySide;
        const cy = -p.y + sy * offset * shape.catenarySide;
        addBox(mesh, cx, cy, tx, ty, half, base, base + MAST_HEIGHT);
    }

    // Contact wire over the centreline, as a thin box along the samples.
    const wireZ = RAIL_HEIGHT + WIRE_HEIGHT_ABOVE_RAIL_TOP;
    const wire = loft(
        boxFaces(
            -WIRE_SIZE / 2,
            WIRE_SIZE / 2,
            wireZ - WIRE_SIZE / 2,
            wireZ + WIRE_SIZE / 2,
            {
                bottom: true,
            }
        ),
        samples,
        [],
        {}
    );
    return mergeInto(mesh.build(), wire);
}

/** A square-sectioned vertical box centred on (cx, cy), `half` out on each side. */
function addBox(
    mesh: MeshBuilder,
    cx: number,
    cy: number,
    ux: number,
    uy: number,
    half: number,
    z0: number,
    z1: number
) {
    const vx = -uy;
    const vy = ux;
    const corners: [number, number][] = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
    ].map(([a, b]) => [
        cx + (ux * a + vx * b) * half,
        cy + (uy * a + vy * b) * half,
    ]);
    for (let k = 0; k < 4; k++) {
        const [ax, ay] = corners[k];
        const [bx, by] = corners[(k + 1) % 4];
        const mx = (ax + bx) / 2 - cx;
        const my = (ay + by) / 2 - cy;
        const m = Math.hypot(mx, my);
        const n: [number, number, number] = [mx / m, my / m, 0];
        const lo0 = mesh.vertex([ax, ay, z0], n);
        const lo1 = mesh.vertex([bx, by, z0], n);
        const hi0 = mesh.vertex([ax, ay, z1], n);
        const hi1 = mesh.vertex([bx, by, z1], n);
        mesh.quad(lo0, lo1, hi0, hi1, n);
    }
    const up: [number, number, number] = [0, 0, 1];
    const t = corners.map(([x, y]) => mesh.vertex([x, y, z1], up));
    mesh.quad(t[0], t[1], t[3], t[2], up);
}

/** Concatenate two geometries with the same attributes. */
function mergeInto(a: BufferGeometry, b: BufferGeometry): BufferGeometry {
    const offset = a.getAttribute('position').count;
    const out = new BufferGeometry();
    for (const name of Object.keys(a.attributes)) {
        const A = a.getAttribute(name);
        const B = b.getAttribute(name);
        const data = new Float32Array(A.array.length + B.array.length);
        data.set(A.array as Float32Array, 0);
        data.set(B.array as Float32Array, A.array.length);
        out.setAttribute(name, new Float32BufferAttribute(data, A.itemSize));
    }
    const index = [
        ...Array.from(a.getIndex()!.array),
        ...Array.from(b.getIndex()!.array, i => i + offset),
    ];
    out.setIndex(index);
    out.computeBoundingBox();
    out.computeBoundingSphere();
    a.dispose();
    b.dispose();
    return out;
}

/**
 * Build a segment's geometry in scene coordinates (x, -y, z up).
 *
 * The heights are the ballast (or slab) top at the centreline. The bed and the
 * ballast sides go below it; the rails and catenary go above it.
 *
 * `surface` and `bed` carry, on every vertex: `aAcross` (vec2, the unit
 * normal across the track in scene x and y), `aSide` (-1, 0 or +1: which side
 * of the centreline, positive on the `aAcross` side), `aHalfWidth` (the
 * part's true half-width in metres: the ballast or slab top's, or
 * `bedWidth / 2`) and `aAlong` (arc length from t = 0, in metres). `rails`
 * carries `aRunning` (1 on a rail's top running strip, else 0).
 */
export function buildSegmentGeometries(shape: SegmentShape): {
    surface: BufferGeometry;
    rails: BufferGeometry;
    bed: BufferGeometry | null;
    catenary: BufferGeometry | null;
} {
    const samples = sampleSegment(
        shape.curve,
        shape.elevation.from,
        shape.elevation.to
    );
    const along = arcLengths(shape.curve, samples);
    const hw = ballastHalfWidthForGauge(shape.gauge);

    const surface = loft(surfaceFaces(shape.trackStyle, hw), samples, along, {
        halfWidth: hw,
    });

    const railFaces: Face[] = [];
    for (const side of [-1, 1]) {
        const c = (side * shape.gauge) / 2;
        railFaces.push(
            ...boxFaces(
                c - RAIL_WIDTH / 2,
                c + RAIL_WIDTH / 2,
                0,
                RAIL_HEIGHT,
                {
                    bottom: false,
                    runningTop: true,
                }
            )
        );
    }
    const rails = loft(railFaces, samples, along, { runningFlag: true });

    let bed: BufferGeometry | null = null;
    if (shape.bed) {
        const bedHalf = (shape.bedWidth ?? DEFAULT_BED_WIDTH) / 2;
        const top = -(shape.trackStyle === 'slab' ? SLAB_DEPTH : BALLAST_DEPTH);
        bed = loft(bedFaces(bedHalf, top), samples, along, {
            halfWidth: bedHalf,
        });
    }

    const catenary = shape.electrified ? buildCatenary(shape, samples) : null;
    return { surface, rails, bed, catenary };
}
