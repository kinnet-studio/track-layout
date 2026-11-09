import { BCurve } from '@ue-too/curve';
import { describe, expect, it } from 'bun:test';
import type { BufferGeometry } from 'three';

import { ballastHalfWidthForGauge } from '../src/shared/track-dimensions.js';
import {
    BALLAST_DEPTH,
    BALLAST_SLOPE_RUN,
    MAX_CHORD_ERROR,
    SLAB_DEPTH,
    type SegmentShape,
    buildSegmentGeometries,
    sampleSegment,
    segmentShapeOf,
} from '../src/three/geometry.js';
import { getElevationAtT } from '../src/tracks/utils.js';

const STRAIGHT = (length = 20) =>
    new BCurve([
        { x: 0, y: 0 },
        { x: length, y: 0 },
    ]);
// A gentle arc (radius about 250 m) and a tight one (radius about 12 m).
const GENTLE = () =>
    new BCurve([
        { x: 0, y: 0 },
        { x: 100, y: 20 },
        { x: 200, y: 0 },
    ]);
const TIGHT = () =>
    new BCurve([
        { x: 0, y: 0 },
        { x: 12, y: 0 },
        { x: 12, y: 12 },
    ]);

function shape(
    over: Partial<SegmentShape> & { from?: number; to?: number } = {}
): SegmentShape {
    const { from = 0, to = 0, ...rest } = over;
    return {
        curve: STRAIGHT(),
        gauge: 1.435,
        elevation: { from, to },
        trackStyle: 'ballasted',
        bed: false,
        electrified: false,
        catenarySide: 1,
        ...rest,
    };
}

type V = { x: number; y: number; z: number };
function verts(g: BufferGeometry): V[] {
    const p = g.getAttribute('position');
    return Array.from({ length: p.count }, (_, i) => ({
        x: p.getX(i),
        y: p.getY(i),
        z: p.getZ(i),
    }));
}
const attr = (g: BufferGeometry, name: string, i: number) =>
    g.getAttribute(name).getX(i);

/** Z of the centreline vertices (aSide 0) at the first or last sample. */
function centrelineTopZ(g: BufferGeometry, end: 'start' | 'end'): number {
    const vs = verts(g);
    const zs = vs
        .map((v, i) => ({ v, i }))
        .filter(({ i }) => attr(g, 'aSide', i) === 0)
        .map(({ v }) => v);
    const x =
        end === 'start'
            ? Math.min(...zs.map(v => v.x))
            : Math.max(...zs.map(v => v.x));
    return zs.find(v => Math.abs(v.x - x) < 1e-9)!.z;
}
const maxZ = (g: BufferGeometry) => Math.max(...verts(g).map(v => v.z));
const minZ = (g: BufferGeometry) => Math.min(...verts(g).map(v => v.z));

/** Largest |across| over the top (z = sample height) vertices of a straight along x. */
function topHalfWidth(g: BufferGeometry): number {
    const top = Math.max(...verts(g).map(v => v.z));
    return Math.max(
        ...verts(g)
            .filter(v => Math.abs(v.z - top) < 1e-6)
            .map(v => Math.abs(v.y))
    );
}

describe('sampleSegment', () => {
    it('keeps a straight to its two ends, with the ends exact', () => {
        const s = sampleSegment(STRAIGHT(50), 0, 5);
        expect(s.map(p => p.t)).toEqual([0, 1]);
        expect(s[0]).toMatchObject({ x: 0, y: -0, z: 0 });
        expect(s[1]).toMatchObject({ x: 50, z: 5 });
    });

    it('takes z from getElevationAtT at the same parameter', () => {
        for (const p of sampleSegment(GENTLE(), 2, 8)) {
            expect(p.z).toBeCloseTo(
                getElevationAtT(p.t, { elevation: { from: 2, to: 8 } }),
                9
            );
        }
    });

    it('uses scene coordinates and the scene image of the world normal', () => {
        const [first] = sampleSegment(STRAIGHT(), 0, 0);
        // World tangent (1, 0), world normal (0, 1), scene normal (0, -1).
        expect(first.normal.x).toBeCloseTo(0, 9);
        expect(first.normal.y).toBeCloseTo(-1, 9);
    });

    it.each([
        ['a gentle curve', GENTLE],
        ['a tight curve', TIGHT],
    ])('stays within 2 cm of %s', (_name, make) => {
        const curve = make();
        const s = sampleSegment(curve, 0, 0);
        expect(s.length).toBeGreaterThan(2);
        for (let i = 0; i + 1 < s.length; i++) {
            const a = s[i];
            const b = s[i + 1];
            for (const u of [0.1, 0.3, 0.5, 0.7, 0.9]) {
                const c = curve.get(a.t + (b.t - a.t) * u);
                const px = c.x - a.x;
                const py = -c.y - a.y;
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const along = Math.max(
                    0,
                    Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy))
                );
                const err = Math.hypot(px - along * dx, py - along * dy);
                expect(err).toBeLessThanOrEqual(MAX_CHORD_ERROR);
            }
        }
    });

    it('samples an unevenly parametrised sloped straight by height too', () => {
        // P1 = P0 and P2 = P3: a straight whose t runs fast in the middle.
        const curve = new BCurve([
            { x: 0, y: 0 },
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 0 },
        ]);
        const model = { elevation: { from: 0, to: 5 } };
        const s = sampleSegment(curve, 0, 5);
        expect(s.length).toBeGreaterThan(2);
        expect(s[0].t).toBe(0);
        expect(s[s.length - 1].t).toBe(1);
        for (const p of s) {
            expect(p.z).toBeCloseTo(getElevationAtT(p.t, model), 9);
        }
        // The mesh interpolates linearly in position along each chord.
        for (let k = 0; k <= 50; k++) {
            const t = k / 50;
            let i = 0;
            while (i + 2 < s.length && s[i + 1].t <= t) i++;
            const a = s[i];
            const b = s[i + 1];
            const c = curve.get(t);
            const u = (c.x - a.x) / (b.x - a.x);
            const z = a.z + (b.z - a.z) * u;
            expect(Math.abs(z - getElevationAtT(t, model))).toBeLessThanOrEqual(
                MAX_CHORD_ERROR * 1.5
            );
        }
    });

    it('samples the tight curve more densely than the gentle one', () => {
        const per = (c: BCurve) => sampleSegment(c, 0, 0).length / c.fullLength;
        expect(per(TIGHT())).toBeGreaterThan(per(GENTLE()));
    });
});

describe('segmentShapeOf', () => {
    it('fills the style defaults', () => {
        const curve = STRAIGHT();
        const s = segmentShapeOf({
            t0Joint: 1,
            t1Joint: 2,
            curve,
            gauge: 1.067,
            splits: [],
            splitCurves: [],
            elevation: { from: 1, to: 2 },
        });
        expect(s).toEqual({
            curve,
            gauge: 1.067,
            elevation: { from: 1, to: 2 },
            trackStyle: 'ballasted',
            bed: false,
            bedWidth: undefined,
            electrified: false,
            catenarySide: 1,
        });
    });
});

describe('buildSegmentGeometries', () => {
    it("starts and ends at its joints' heights, on the ballast top", () => {
        const g = buildSegmentGeometries(shape({ from: 0, to: 12.35 }));
        expect(centrelineTopZ(g.surface, 'start')).toBeCloseTo(0, 6);
        expect(centrelineTopZ(g.surface, 'end')).toBeCloseTo(12.35, 6);
    });

    it('is as wide as the 2D ballast', () => {
        expect(
            topHalfWidth(
                buildSegmentGeometries(shape({ gauge: 1.067 })).surface
            )
        ).toBeCloseTo(ballastHalfWidthForGauge(1.067), 6);
    });

    it('slopes the ballast sides down 0.3 m over 0.45 m', () => {
        const { surface } = buildSegmentGeometries(shape());
        const w = ballastHalfWidthForGauge(1.435);
        expect(minZ(surface)).toBeCloseTo(-BALLAST_DEPTH, 6);
        const foot = verts(surface).filter(v => v.z < -0.29);
        expect(Math.max(...foot.map(v => Math.abs(v.y)))).toBeCloseTo(
            w + BALLAST_SLOPE_RUN,
            6
        );
    });

    it('builds a slab with flat sides for trackStyle slab', () => {
        const { surface } = buildSegmentGeometries(
            shape({ trackStyle: 'slab' })
        );
        const w = ballastHalfWidthForGauge(1.435);
        expect(minZ(surface)).toBeCloseTo(-SLAB_DEPTH, 6);
        // Every vertex is at the top's half-width or on the centreline.
        for (const v of verts(surface)) {
            const a = Math.abs(v.y);
            expect(a < 1e-9 || Math.abs(a - w) < 1e-6).toBe(true);
        }
        // And some side vertices hang below the top, straight under it.
        expect(
            verts(surface).some(v => v.z < -0.2 && Math.abs(v.y) > w - 1e-6)
        ).toBe(true);
    });

    it('stands the rails on the ballast at +-gauge/2', () => {
        const { rails } = buildSegmentGeometries(shape({ gauge: 1.435 }));
        expect(minZ(rails)).toBeCloseTo(0, 6);
        expect(maxZ(rails)).toBeCloseTo(0.15, 6);
        // Rail centres: midpoints of each rail's across extent.
        const ys = verts(rails).map(v => v.y);
        const neg = ys.filter(y => y < 0);
        const pos = ys.filter(y => y > 0);
        expect((Math.min(...neg) + Math.max(...neg)) / 2).toBeCloseTo(
            -0.7175,
            4
        );
        expect((Math.min(...pos) + Math.max(...pos)) / 2).toBeCloseTo(
            0.7175,
            4
        );
        expect(Math.max(...pos) - Math.min(...pos)).toBeCloseTo(0.07, 6);
    });

    it('flags only the top running strip of each rail', () => {
        const { rails } = buildSegmentGeometries(shape());
        const flagged = verts(rails).filter(
            (_, i) => attr(rails, 'aRunning', i) === 1
        );
        expect(flagged.length).toBeGreaterThan(0);
        for (const v of flagged) expect(v.z).toBeCloseTo(0.15, 6);
        expect(
            verts(rails).some((_, i) => attr(rails, 'aRunning', i) === 0)
        ).toBe(true);
    });

    it('puts the bed under the ballast, bedWidth wide', () => {
        expect(buildSegmentGeometries(shape()).bed).toBeNull();
        const { bed } = buildSegmentGeometries(
            shape({ bed: true, bedWidth: 5 })
        );
        expect(maxZ(bed!)).toBeLessThanOrEqual(-BALLAST_DEPTH + 1e-9);
        expect(Math.max(...verts(bed!).map(v => Math.abs(v.y)))).toBeCloseTo(
            2.5,
            6
        );
        expect(minZ(bed!)).toBeCloseTo(-BALLAST_DEPTH - 0.3, 6);
    });

    it('defaults the bed width to 3 m, and sits under a slab at its depth', () => {
        const { bed } = buildSegmentGeometries(
            shape({ bed: true, trackStyle: 'slab' })
        );
        expect(Math.max(...verts(bed!).map(v => Math.abs(v.y)))).toBeCloseTo(
            1.5,
            6
        );
        expect(maxZ(bed!)).toBeCloseTo(-SLAB_DEPTH, 6);
    });

    it('gives surface and bed aAcross, aSide, aHalfWidth and aAlong', () => {
        const g = buildSegmentGeometries(shape({ bed: true, bedWidth: 5 }));
        const w = ballastHalfWidthForGauge(1.435);
        for (const [geo, half] of [
            [g.surface, w],
            [g.bed!, 2.5],
        ] as const) {
            expect(geo.getAttribute('aAcross').itemSize).toBe(2);
            expect(geo.getAttribute('aSide').itemSize).toBe(1);
            expect(geo.getAttribute('aHalfWidth').itemSize).toBe(1);
            expect(geo.getAttribute('aAlong').itemSize).toBe(1);
            const n = geo.getAttribute('position').count;
            for (let i = 0; i < n; i++) {
                expect(attr(geo, 'aHalfWidth', i)).toBeCloseTo(half, 6);
                expect([-1, 0, 1]).toContain(attr(geo, 'aSide', i));
            }
        }
    });

    it('keeps aSide +1 on the +aAcross side, with aAcross a unit vector', () => {
        const { surface } = buildSegmentGeometries(shape({ curve: GENTLE() }));
        const across = surface.getAttribute('aAcross');
        const pos = surface.getAttribute('position');
        const c = new BCurve(GENTLE().getControlPoints());
        for (let i = 0; i < pos.count; i++) {
            const nx = across.getX(i);
            const ny = across.getY(i);
            expect(Math.hypot(nx, ny)).toBeCloseTo(1, 6);
            const side = attr(surface, 'aSide', i);
            if (side === 0) continue;
            // Vertex minus the curve's nearest point points along side * aAcross.
            let best = Infinity;
            let bx = 0;
            let by = 0;
            for (let k = 0; k <= 400; k++) {
                const p = c.get(k / 400);
                const d = Math.hypot(pos.getX(i) - p.x, pos.getY(i) + p.y);
                if (d < best) {
                    best = d;
                    bx = pos.getX(i) - p.x;
                    by = pos.getY(i) + p.y;
                }
            }
            expect((bx * nx + by * ny) * side).toBeGreaterThan(0);
        }
    });

    it('measures aAlong from 0 to the full length', () => {
        for (const curve of [STRAIGHT(37), GENTLE(), TIGHT()]) {
            const { surface } = buildSegmentGeometries(shape({ curve }));
            const along = Array.from(
                { length: surface.getAttribute('aAlong').count },
                (_, i) => attr(surface, 'aAlong', i)
            );
            expect(Math.min(...along)).toBeCloseTo(0, 6);
            expect(
                Math.abs(Math.max(...along) - curve.fullLength)
            ).toBeLessThan(0.05);
        }
    });

    it('winds every triangle to face along its vertex normals', () => {
        const g = buildSegmentGeometries(
            shape({
                curve: GENTLE(),
                from: 0,
                to: 3,
                bed: true,
                electrified: true,
            })
        );
        for (const geo of [g.surface, g.rails, g.bed!, g.catenary!]) {
            const p = geo.getAttribute('position');
            const n = geo.getAttribute('normal');
            const idx = geo.getIndex()!;
            for (let k = 0; k < idx.count; k += 3) {
                const [a, b, c] = [
                    idx.getX(k),
                    idx.getX(k + 1),
                    idx.getX(k + 2),
                ];
                const u = [0, 1, 2].map(
                    j => p.getComponent(b, j) - p.getComponent(a, j)
                );
                const v = [0, 1, 2].map(
                    j => p.getComponent(c, j) - p.getComponent(a, j)
                );
                const cross = [
                    u[1] * v[2] - u[2] * v[1],
                    u[2] * v[0] - u[0] * v[2],
                    u[0] * v[1] - u[1] * v[0],
                ];
                const dot = [0, 1, 2].reduce(
                    (s, j) => s + cross[j] * n.getComponent(a, j),
                    0
                );
                expect(dot).toBeGreaterThanOrEqual(0);
            }
        }
    });
});

describe('catenary', () => {
    it('is absent unless electrified', () => {
        expect(
            buildSegmentGeometries(shape({ electrified: false })).catenary
        ).toBeNull();
    });

    /** Mast footprints: vertices at the mast base height, grouped by 25 m station. */
    function mastCentres(g: BufferGeometry, base = 0) {
        const vs = verts(g).filter(v => Math.abs(v.z - base) < 1e-6);
        const byX = new Map<number, V[]>();
        for (const v of vs) {
            const key = Math.round(v.x);
            byX.set(key, [...(byX.get(key) ?? []), v]);
        }
        return [...byX.entries()]
            .filter(([, list]) => list.length >= 4)
            .map(([x, list]) => ({
                x,
                y: list.reduce((s, v) => s + v.y, 0) / list.length,
            }))
            .sort((a, b) => a.x - b.x);
    }

    it('puts 5 masts on a 100 m straight, on the +normal side', () => {
        const { catenary } = buildSegmentGeometries(
            shape({ curve: STRAIGHT(100), electrified: true, catenarySide: 1 })
        );
        const masts = mastCentres(catenary!);
        expect(masts.map(m => m.x)).toEqual([0, 25, 50, 75, 100]);
        // World normal (0, 1) is scene -y.
        for (const m of masts) {
            expect(m.y).toBeCloseTo(-ballastHalfWidthForGauge(1.435), 6);
        }
    });

    it('flips to the other side, and stands off the bed when it is wider', () => {
        const { catenary } = buildSegmentGeometries(
            shape({
                curve: STRAIGHT(100),
                electrified: true,
                catenarySide: -1,
                bed: true,
                bedWidth: 6,
            })
        );
        for (const m of mastCentres(catenary!)) expect(m.y).toBeCloseTo(3, 6);
    });

    it('puts masts at both ends of a 10 m segment, 6.5 m tall, with the wire 5.65 m up', () => {
        const { catenary } = buildSegmentGeometries(
            shape({ curve: STRAIGHT(10), electrified: true, from: 2, to: 2 })
        );
        const masts = mastCentres(catenary!, 2);
        expect(masts.map(m => m.x)).toEqual([0, 10]);
        expect(maxZ(catenary!)).toBeCloseTo(2 + 6.5, 6);
        const wire = verts(catenary!).filter(
            v => Math.abs(v.y) < 0.03 && v.z > 2 + 5
        );
        expect(wire.length).toBeGreaterThan(0);
        expect(wire.reduce((s, v) => s + v.z, 0) / wire.length).toBeCloseTo(
            2 + 0.15 + 5.5,
            6
        );
    });

    it('stands each mast on the track height at its place on a slope', () => {
        const { catenary } = buildSegmentGeometries(
            shape({ curve: STRAIGHT(100), electrified: true, from: 0, to: 10 })
        );
        expect(mastCentres(catenary!, 0).length).toBe(1); // only the first mast starts at 0
        const base = verts(catenary!).filter(
            v => Math.abs(v.x - 50) < 0.2 && Math.abs(v.y) > 1 && v.z < 6
        );
        expect(Math.min(...base.map(v => v.z))).toBeCloseTo(5, 3);
    });
});
