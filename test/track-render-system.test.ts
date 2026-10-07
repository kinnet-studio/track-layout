import { BCurve } from '@ue-too/curve';
import type { Point } from '@ue-too/math';
import { describe, expect, it, spyOn } from 'bun:test';
import { type Container, type Graphics, Texture } from 'pixi.js';

import {
    TrackRenderSystem,
    type TrackRenderSystemOptions,
    type TrackTextureRenderer,
} from '../src/pixi/track-render-system.js';
import type { TerrainSampler } from '../src/pixi/tunnel-geometry.js';
import { TrackGraph } from '../src/tracks/track.js';
import { ELEVATION } from '../src/tracks/types.js';
import {
    RecordingLayerHost,
    type StrokedLine,
    camera,
    drawKey,
    fakeCatenaryLayoutSource,
    fakeCurveCreationSource,
    fakeDuplicateToSideSource,
    strokedLines,
    textsIn,
    textureRenderer,
    zoomTo,
} from './pixi-helpers.js';
import { layTrack } from './station-placement-helpers.js';
import { layLine } from './track-helpers.js';

const A = { x: 0, y: 0 };
const B = { x: 100, y: 0 };
const C = { x: 200, y: 0 };
const KEY = drawKey(0);
/** Distance from a track's centre line to its portal bars, for gauge 1.067. */
const P = 1.067 / 2 + 1.5;
/** How far a wing reaches along the track: MARK_LENGTH at 45 degrees. */
const W = 1.5 * Math.SQRT1_2;

/** A renderer on a fresh graph, with the texture stub unless options say otherwise. */
function scene(options: TrackRenderSystemOptions = {}) {
    const host = new RecordingLayerHost();
    const graph = new TrackGraph();
    const cam = camera();
    const renderer = new TrackRenderSystem(host, graph.trackCurveManager, cam, {
        textureRenderer,
        ...options,
    });
    return { host, graph, camera: cam, renderer };
}

/** Lays one straight segment from A to B, ramping from `from` to `to`. */
function layRamp(graph: TrackGraph, from: ELEVATION, to: ELEVATION) {
    const start = graph.createNewEmptyJoint(A, { x: 1, y: 0 }, from);
    const end = graph.createNewEmptyJoint(B, { x: 1, y: 0 }, to);
    graph.connectJoints(start, end, [{ x: 50, y: 0 }]);
}

/** Terrain at one height everywhere. */
const flatTerrain = (height: number): TerrainSampler => ({
    getHeight: () => height,
});

/** The overlay that holds the highlights and the projection dots. */
function topOverlay(host: RecordingLayerHost): Container {
    return host.overlays[0]!;
}

/** Whether a graphics object has anything drawn in it. */
function drawn(graphics: Container | undefined): boolean {
    return (graphics as Graphics).context.instructions.length > 0;
}

/** What the curve tool previews for `curve`, laid at ground level. */
function previewData(
    graph: TrackGraph,
    curve = new BCurve([A, { x: 50, y: 0 }, B])
) {
    return graph.trackCurveManager.getPreviewDrawData(
        curve,
        ELEVATION.GROUND,
        ELEVATION.GROUND
    );
}

describe('TrackRenderSystem: laid track', () => {
    it('draws ground track in the ground band, with no shadow or bed', () => {
        const { host, graph } = scene();

        layTrack(graph, [A, B]);

        expect(host.bandKeys).toEqual([
            `__rail__${KEY}`,
            '__simplified__0',
            KEY,
        ]);
        expect(host.sublayerOf(KEY)).toBe('drawable');
        expect(host.sublayerOf(`__rail__${KEY}`)).toBe('rail');
        expect(host.sublayerOf('__simplified__0')).toBe('rail');
        expect(host.bandOf(KEY)).toBe(3);
        expect(host.shadowKeys).toEqual([]);
        expect(host.bedKeys).toEqual([]);
    });

    it('draws elevated track in its band and its shadow one level below', () => {
        const { host, graph } = scene();

        layTrack(graph, [A, B], ELEVATION.ABOVE_2);

        expect(host.bandOf(KEY)).toBe(5);
        expect(host.bandOf(`__rail__${KEY}`)).toBe(5);
        expect(host.shadowElevationOf(KEY)).toBe(ELEVATION.ABOVE_1);
    });

    it('draws a ramp in the band of its higher end', () => {
        const { host, graph } = scene();

        layRamp(graph, ELEVATION.GROUND, ELEVATION.ABOVE_1);

        expect(host.bandOf(KEY)).toBe(4);
        expect(host.shadowElevationOf(KEY)).toBe(ELEVATION.GROUND);
    });

    it('draws a bed at the track level and catenary in the catenary sublayer', () => {
        const { host, graph } = scene();
        graph.setNewSegmentStyle({ bed: true, electrified: true });

        layTrack(graph, [A, B], ELEVATION.ABOVE_1);

        expect(host.bedElevationOf(KEY)).toBe(ELEVATION.ABOVE_1);
        expect(host.sublayerOf(`__catenary__${KEY}`)).toBe('catenary');
        expect(host.bandOf(`__catenary__${KEY}`)).toBe(4);
    });

    it('draws no rails or shadows without a texture renderer', () => {
        const { host, graph } = scene({ textureRenderer: null });

        layTrack(graph, [A, B], ELEVATION.ABOVE_1);

        expect(host.bandKeys).toEqual(['__simplified__0', KEY]);
        expect(host.shadowKeys).toEqual([]);
    });

    it('removes everything a deleted segment registered', () => {
        const { host, graph } = scene();
        graph.setNewSegmentStyle({ bed: true, electrified: true });
        const { segments } = layTrack(graph, [A, B, C], ELEVATION.ABOVE_1);

        graph.removeTrackSegment(segments[0]!);

        const other = drawKey(1);
        expect(host.bandKeys).toEqual([
            `__catenary__${other}`,
            `__rail__${other}`,
            '__simplified__1',
            other,
        ]);
        expect(host.bedKeys).toEqual([other]);
        expect(host.shadowKeys).toEqual([other]);
    });

    it('reports the band of a draw-data piece, or null for an unknown one', () => {
        const { renderer, graph } = scene();
        layTrack(graph, [A, B], ELEVATION.ABOVE_1);

        expect(
            renderer.getTrackBandIndex({
                trackSegmentNumber: 0,
                tValInterval: { start: 0, end: 1 },
            })
        ).toBe(4);
        expect(
            renderer.getTrackBandIndex({
                trackSegmentNumber: 7,
                tValInterval: { start: 0, end: 1 },
            })
        ).toBeNull();
    });
});

describe('TrackRenderSystem: display settings', () => {
    it('shows the simplified track below zoom 5 and the detailed track from 5', async () => {
        const { host, graph, camera } = scene();
        graph.setNewSegmentStyle({ bed: true });
        layTrack(graph, [A, B], ELEVATION.ABOVE_1);
        const detailed = () => [
            host.bandItem(KEY)!.visible,
            host.bandItem(`__rail__${KEY}`)!.visible,
            host.shadow(KEY)!.visible,
        ];

        expect(host.bandItem('__simplified__0')!.visible).toBe(true);
        expect(detailed()).toEqual([false, false, false]);

        await zoomTo(camera, 5);
        expect(host.bandItem('__simplified__0')!.visible).toBe(false);
        expect(detailed()).toEqual([true, true, true]);

        await zoomTo(camera, 4.9);
        expect(host.bandItem('__simplified__0')!.visible).toBe(true);
    });

    it('swaps solid and gradient ballast when the elevation gradient is toggled', () => {
        const { host, graph, renderer } = scene();
        layTrack(graph, [A, B]);
        const ballast = host.bandItem(KEY)!.children[0]!;
        const [gradient, solid] = ballast.children;

        expect([gradient!.visible, solid!.visible]).toEqual([false, true]);
        renderer.showElevationGradient = true;
        expect([gradient!.visible, solid!.visible]).toEqual([true, false]);
    });

    it('moves a level shadow with the sun angle', () => {
        const { host, graph, renderer } = scene();
        layTrack(graph, [A, B], ELEVATION.ABOVE_1);
        const shadow = host.shadow(KEY)!;
        const before = { x: shadow.position.x, y: shadow.position.y };

        renderer.sunAngle = 90;

        expect(renderer.sunAngle).toBe(90);
        expect(before.x).toBeLessThan(0);
        expect(shadow.position.x).toBeCloseTo(0);
        expect(shadow.position.y).toBeCloseTo(-before.x * Math.SQRT2);
    });
});

describe('TrackRenderSystem: terrain', () => {
    it('treats missing terrain as flat ground, so track below ground is in a tunnel', () => {
        const { host, graph } = scene();

        layTrack(graph, [A, B], ELEVATION.SUB_1);

        expect(host.sublayerOf(`__tunnel_wall__${KEY}`)).toBe('drawable');
        expect(host.sublayerOf(`__tunnel_ceiling__${KEY}`)).toBe('catenary');
        expect(host.bandOf(`__tunnel_wall__${KEY}`)).toBe(2);
        expect(host.bandOf('__underground__0')).toBe(3);
    });

    it('puts ground-level track under higher terrain in a tunnel', () => {
        const { host, graph } = scene({ terrain: flatTerrain(20) });

        layTrack(graph, [A, B]);

        expect(host.bandOf(`__tunnel_wall__${KEY}`)).toBe(3);
        expect(host.bandOf('__underground__0')).toBe(5);
    });

    it('gives a ramp that crosses the terrain a cutting and a cover', () => {
        const { host, graph } = scene({ terrain: flatTerrain(5) });

        layRamp(graph, ELEVATION.GROUND, ELEVATION.ABOVE_1);

        expect(host.sublayerOf(`__cutting__${KEY}`)).toBe('drawable');
        expect(host.sublayerOf(`__cutting_cover__${KEY}`)).toBe('catenary');
    });

    it('draws no tunnel for track above the terrain', () => {
        const { host, graph } = scene({ terrain: flatTerrain(5) });

        layTrack(graph, [A, B], ELEVATION.ABOVE_1);

        expect(host.bandKeys.filter(key => key.includes('tunnel'))).toEqual([]);
    });
});

describe('TrackRenderSystem: previews and highlights', () => {
    it('draws curve-tool preview track and clears it on undefined', () => {
        const curveCreation = fakeCurveCreationSource();
        const { host, graph } = scene({ curveCreation: curveCreation.source });

        curveCreation.emit('onPreviewDrawDataChange', previewData(graph));
        expect(host.bandKeys).toEqual(['__preview__0', '__preview_rail__0']);
        expect(host.sublayerOf('__preview__0')).toBe('drawable');
        expect(host.sublayerOf('__preview_rail__0')).toBe('rail');

        curveCreation.emit('onPreviewDrawDataChange', undefined);
        expect(host.bandKeys).toEqual([]);
    });

    it('replaces the previous preview rather than adding to it', () => {
        const duplicateToSide = fakeDuplicateToSideSource();
        const { host, graph } = scene({
            duplicateToSide: duplicateToSide.source,
        });

        duplicateToSide.emit('onPreviewDrawDataChange', previewData(graph));
        duplicateToSide.emit('onPreviewDrawDataChange', previewData(graph));

        expect(host.bandKeys).toEqual(['__preview__0', '__preview_rail__0']);
    });

    it('shows and hides the projection dots', () => {
        const curveCreation = fakeCurveCreationSource();
        const { host, graph } = scene({ curveCreation: curveCreation.source });
        layTrack(graph, [A, B]);
        const projection = graph.project({ x: 30, y: 0 });
        const [startDot, endDot] = topOverlay(host).children.slice(4);

        expect([startDot!.visible, endDot!.visible]).toEqual([false, false]);
        curveCreation.emit('onPreviewStartProjectionChange', projection);
        curveCreation.emit('onPreviewEndProjectionChange', projection);
        expect([startDot!.visible, endDot!.visible]).toEqual([true, true]);
        expect(startDot!.position.x).toBeCloseTo(30);

        curveCreation.emit('onPreviewStartProjectionChange', null);
        expect(startDot!.visible).toBe(false);
    });

    it('draws each tool highlight on its own graphics and clears it on null', () => {
        const curveCreation = fakeCurveCreationSource();
        const duplicateToSide = fakeDuplicateToSideSource();
        const catenaryLayout = fakeCatenaryLayoutSource();
        const { host, graph } = scene({
            curveCreation: curveCreation.source,
            duplicateToSide: duplicateToSide.source,
            catenaryLayout: catenaryLayout.source,
        });
        layTrack(graph, [A, B]);
        const [duplicate, deletion, catenary, catenaryPreview] =
            topOverlay(host).children;

        duplicateToSide.emit('onHighlightChange', {
            segmentNumber: 0,
            kind: 'hover',
        });
        curveCreation.emit('onDeletionHighlightChange', { segmentNumber: 0 });
        catenaryLayout.emit('onHighlightChange', {
            segmentNumber: 0,
            kind: 'selected',
        });
        catenaryLayout.emit('onPreviewChange', { segmentNumber: 0, side: 1 });
        expect(
            [duplicate, deletion, catenary, catenaryPreview].map(drawn)
        ).toEqual([true, true, true, true]);

        duplicateToSide.emit('onHighlightChange', null);
        curveCreation.emit('onDeletionHighlightChange', null);
        catenaryLayout.emit('onHighlightChange', null);
        catenaryLayout.emit('onPreviewChange', null);
        expect(
            [duplicate, deletion, catenary, catenaryPreview].map(drawn)
        ).toEqual([false, false, false, false]);
    });

    it('draws no highlight for a segment that does not exist', () => {
        const curveCreation = fakeCurveCreationSource();
        const { host } = scene({ curveCreation: curveCreation.source });

        curveCreation.emit('onDeletionHighlightChange', { segmentNumber: 9 });

        expect(drawn(topOverlay(host).children[1])).toBe(false);
    });
});

describe('TrackRenderSystem: cleanup', () => {
    it('removes everything it registered with the host', () => {
        const curveCreation = fakeCurveCreationSource();
        const { host, graph, renderer } = scene({
            curveCreation: curveCreation.source,
            terrain: flatTerrain(5),
        });
        graph.setNewSegmentStyle({ bed: true, electrified: true });
        layTrack(graph, [A, B], ELEVATION.ABOVE_1);
        layRamp(graph, ELEVATION.SUB_1, ELEVATION.GROUND);
        curveCreation.emit(
            'onPreviewDrawDataChange',
            graph.trackCurveManager.getPreviewDrawData(
                new BCurve([C, { x: 250, y: 0 }, { x: 300, y: 0 }]),
                ELEVATION.GROUND,
                ELEVATION.GROUND
            )
        );
        expect(host.bandKeys.length).toBeGreaterThan(0);

        renderer.cleanup();

        expect(host.bandKeys).toEqual([]);
        expect(host.bedKeys).toEqual([]);
        expect(host.shadowKeys).toEqual([]);
        expect(host.overlays).toEqual([]);
    });

    it('destroys every texture it generated, tunnel and cutting textures included', () => {
        const generated: Texture[] = [];
        const recording: TrackTextureRenderer = {
            renderer: {
                textureGenerator: {
                    generateTexture: () => {
                        const texture = new Texture();
                        generated.push(texture);
                        return texture;
                    },
                },
            },
        };
        const { host, graph, renderer } = scene({
            textureRenderer: recording,
            terrain: flatTerrain(5),
        });
        graph.setNewSegmentStyle({ bed: true, electrified: true });
        layTrack(
            graph,
            [
                { x: 0, y: 50 },
                { x: 100, y: 50 },
            ],
            ELEVATION.SUB_1
        );
        layRamp(graph, ELEVATION.GROUND, ELEVATION.ABOVE_1);
        expect(host.bandKeys).toContain(`__tunnel_wall__${KEY}`);
        expect(host.bandKeys).toContain(`__cutting__${drawKey(1)}`);

        renderer.cleanup();

        expect(generated.length).toBeGreaterThan(0);
        expect(generated.filter(texture => !texture.destroyed).length).toBe(0);
    });
});

describe('TrackRenderSystem: track that exists when it is built', () => {
    /** Lays two elevated, bedded, electrified segments and a ramp into `graph`. */
    function layLayout(graph: TrackGraph) {
        graph.setNewSegmentStyle({ bed: true, electrified: true });
        layTrack(graph, [A, B, C], ELEVATION.ABOVE_1);
        layRamp(graph, ELEVATION.GROUND, ELEVATION.ABOVE_1);
    }

    /** A renderer built over a graph that already holds the layout. */
    function builtAfterLaying() {
        const host = new RecordingLayerHost();
        const graph = new TrackGraph();
        layLayout(graph);
        const cam = camera();
        const renderer = new TrackRenderSystem(
            host,
            graph.trackCurveManager,
            cam,
            { textureRenderer }
        );
        return { host, graph, camera: cam, renderer };
    }

    it('draws the same pieces as a renderer built before the track was laid', () => {
        const before = scene();
        layLayout(before.graph);

        const after = builtAfterLaying();

        expect(after.host.bandKeys.length).toBeGreaterThan(0);
        expect(after.host.bandKeys).toEqual(before.host.bandKeys);
        expect(after.host.bedKeys).toEqual(before.host.bedKeys);
        expect(after.host.shadowKeys).toEqual(before.host.shadowKeys);
        for (const key of after.host.bandKeys) {
            expect(after.host.bandOf(key)).toBe(before.host.bandOf(key));
        }
    });

    it('shows existing track at the zoom level it is built at', async () => {
        const { host, camera } = builtAfterLaying();

        expect(host.bandItem('__simplified__0')!.visible).toBe(true);
        expect(host.bandItem(KEY)!.visible).toBe(false);

        await zoomTo(camera, 5);
        expect(host.bandItem('__simplified__0')!.visible).toBe(false);
        expect(host.bandItem(KEY)!.visible).toBe(true);
    });

    it('removes existing track when the graph deletes it', () => {
        const { host, graph } = builtAfterLaying();

        graph.removeTrackSegment(0);

        expect(
            host.bandKeys.filter(
                key =>
                    key.includes('"trackSegmentNumber":0,') ||
                    key === '__simplified__0'
            )
        ).toEqual([]);
        expect(host.bedElevationOf(KEY)).toBeUndefined();
    });
});

/** Expects `line` to run from x = 0 to x = 100 at a constant `y`. */
function expectStraightAlongX(line: StrokedLine, y: number) {
    expect(line.points[0]!.x).toBeCloseTo(0);
    expect(line.points.at(-1)!.x).toBeCloseTo(100);
    for (const point of line.points) {
        expect(point.y).toBeCloseTo(y);
    }
}

/** The distance from `point` to the nearest of 4000 points along `curve`. */
function distanceToCurve(point: Point, curve: BCurve): number {
    let nearest = Infinity;
    for (let i = 0; i <= 4000; i++) {
        const onCurve = curve.get(i / 4000);
        nearest = Math.min(
            nearest,
            Math.hypot(point.x - onCurve.x, point.y - onCurve.y)
        );
    }
    return nearest;
}

describe('TrackRenderSystem: line styles', () => {
    it('draws track as a line at every zoom level, and nothing else', async () => {
        const { host, graph, camera, renderer } = scene();
        renderer.renderStyle = 'centerline';
        graph.setNewSegmentStyle({ bed: true, electrified: true });

        layTrack(graph, [A, B], ELEVATION.ABOVE_1);

        expect(host.bandKeys).toEqual(['__simplified__0']);
        expect(host.bandOf('__simplified__0')).toBe(4);
        expect(host.bedKeys).toEqual([]);
        expect(host.shadowKeys).toEqual([]);
        await zoomTo(camera, 10);
        expect(host.bandItem('__simplified__0')!.visible).toBe(true);
    });

    it('draws the centerline down the middle of the track', () => {
        const { host, graph, renderer } = scene();
        renderer.renderStyle = 'centerline';

        layTrack(graph, [A, B]);

        const lines = strokedLines(host.bandItem('__simplified__0'));
        expect(lines).toHaveLength(1);
        expectStraightAlongX(lines[0]!, 0);
    });

    it("draws the rails the segment's gauge apart", () => {
        const { host, graph, renderer } = scene();
        renderer.renderStyle = 'rails';
        const start = graph.createNewEmptyJoint(A, { x: 1, y: 0 });
        const end = graph.createNewEmptyJoint(B, { x: 1, y: 0 });

        graph.connectJoints(start, end, [{ x: 50, y: 0 }], 1.435);

        const lines = strokedLines(host.bandItem('__simplified__0'));
        expect(lines).toHaveLength(2);
        const [lower, upper] = [...lines].sort(
            (a, b) => a.points[0]!.y - b.points[0]!.y
        );
        expectStraightAlongX(lower!, -0.7175);
        expectStraightAlongX(upper!, 0.7175);
    });

    it('keeps each rail half the gauge from the middle around a curve', () => {
        const { host, graph, renderer } = scene();
        renderer.renderStyle = 'rails';
        const corner = { x: 100, y: 0 };
        const end = { x: 100, y: 100 };
        const startJoint = graph.createNewEmptyJoint(A, { x: 1, y: 0 });
        const endJoint = graph.createNewEmptyJoint(end, { x: 0, y: 1 });

        graph.connectJoints(startJoint, endJoint, [corner]);

        const lines = strokedLines(host.bandItem('__simplified__0'));
        expect(lines).toHaveLength(2);
        const curve = new BCurve([A, corner, end]);
        for (const point of lines.flatMap(line => line.points)) {
            expect(distanceToCurve(point, curve)).toBeCloseTo(1.067 / 2, 2);
        }
    });

    it('draws lines without a texture renderer', async () => {
        const { host, graph, camera, renderer } = scene({
            textureRenderer: null,
        });
        renderer.renderStyle = 'rails';

        layTrack(graph, [A, B]);
        await zoomTo(camera, 10);

        expect(host.bandItem('__simplified__0')!.visible).toBe(true);
        expect(strokedLines(host.bandItem('__simplified__0'))).toHaveLength(2);
    });

    it('draws underground track lighter and dashed, with no overlay', () => {
        const { host, graph, renderer } = scene();
        renderer.renderStyle = 'centerline';

        layTrack(graph, [A, B], ELEVATION.SUB_1);

        expect(host.bandKeys).toEqual(['__simplified__0']);
        const lines = strokedLines(host.bandItem('__simplified__0'));
        expect(lines.length).toBeGreaterThan(1);
        for (const line of lines) {
            expect(line.color).toBe(0x808080);
        }
    });

    it('draws a ramp solid above ground and dashed below, with a portal', () => {
        const { host, graph, renderer } = scene();
        renderer.renderStyle = 'centerline';

        layRamp(graph, ELEVATION.SUB_1, ELEVATION.ABOVE_1);

        const lines = strokedLines(host.bandItem('__simplified__0'));
        const black = lines.filter(line => line.color === 0x000000);
        expect(black).toHaveLength(2);
        // The portal's bar runs across the track; the line runs along it.
        const acrossTrack = (line: StrokedLine) =>
            line.points.some(point => Math.abs(point.y) > 0.1);
        const portal = black.find(acrossTrack)!;
        const above = black.find(line => !acrossTrack(line))!;
        expect(above.points[0]!.x).toBeCloseTo(50);
        expect(above.points.at(-1)!.x).toBeCloseTo(100);
        expect(portal.points[1]!.x).toBeCloseTo(50);
        expect(Math.abs(portal.points[1]!.y)).toBeCloseTo(P);
        const grey = lines.filter(line => line.color !== 0x000000);
        expect(grey.length).toBeGreaterThan(0);
        for (const line of grey) {
            expect(line.color).toBe(0x808080);
            for (const point of line.points) {
                expect(point.x).toBeLessThanOrEqual(50 + 1e-6);
            }
        }
    });

    it('decides underground with the terrain', () => {
        const { host, graph, renderer } = scene({ terrain: flatTerrain(5) });
        renderer.renderStyle = 'centerline';

        layTrack(graph, [A, B]);

        const lines = strokedLines(host.bandItem('__simplified__0'));
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) {
            expect(line.color).toBe(0x808080);
        }
    });

    it('draws each segment in its line style', () => {
        const { host, graph, renderer } = scene();
        renderer.renderStyle = 'centerline';
        graph.setNewSegmentStyle({ lineStyle: { preset: 'disused' } });

        layTrack(graph, [A, B]);

        const dotted = strokedLines(host.bandItem('__simplified__0'));
        expect(dotted.length).toBeGreaterThan(10);
        for (const line of dotted) {
            expect(line.color).toBe(0x999999);
        }

        graph.setSegmentStyle(0, { lineStyle: { color: 0xff0000 } });

        const red = strokedLines(host.bandItem('__simplified__0'));
        expect(red).toHaveLength(1);
        expect(red[0]!.color).toBe(0xff0000);
    });

    it('draws a wider line at its width in world units', async () => {
        const { host, graph, camera, renderer } = scene();
        renderer.renderStyle = 'centerline';
        graph.setNewSegmentStyle({ lineStyle: { width: 3 } });

        layTrack(graph, [A, B]);

        const wide = strokedLines(host.bandItem('__simplified__0'));
        expect(wide.length).toBeGreaterThan(0);
        for (const line of wide) {
            expect(line.width).toBe(3);
            expect(line.pixelLine).toBe(false);
        }

        await zoomTo(camera, 2);

        const zoomed = strokedLines(host.bandItem('__simplified__0'));
        expect(zoomed.length).toBeGreaterThan(0);
        for (const line of zoomed) {
            expect(line.width).toBe(1.5);
            expect(line.pixelLine).toBe(false);
        }
    });

    it('re-strokes styled lines only at √2 zoom steps', async () => {
        const { host, graph, camera, renderer } = scene();
        renderer.renderStyle = 'centerline';
        graph.setNewSegmentStyle({ lineStyle: { preset: 'planned' } });
        layTrack(graph, [A, B]);
        graph.setNewSegmentStyle({ lineStyle: undefined });
        layTrack(graph, [C, { x: 300, y: 0 }]);
        const plain = host.bandItem('__simplified__1') as Graphics;
        const cleared = spyOn(plain, 'clear');

        expect(strokedLines(host.bandItem('__simplified__0'))).toHaveLength(10);

        await zoomTo(camera, 1.3);
        expect(strokedLines(host.bandItem('__simplified__0'))).toHaveLength(10);

        await zoomTo(camera, 1.5);
        expect(strokedLines(host.bandItem('__simplified__0'))).toHaveLength(15);

        expect(cleared).not.toHaveBeenCalled();
    });

    it('gives a lone tunnel segment a portal at each end', () => {
        const { host, graph, renderer } = scene();
        renderer.renderStyle = 'centerline';
        graph.setNewSegmentStyle({ lineStyle: { preset: 'tunnel' } });

        layTrack(graph, [A, B]);

        const lines = strokedLines(host.bandItem('__simplified__0'));
        const portals = lines
            .filter(line => line.color === 0x000000)
            .sort((a, b) => a.points[1]!.x - b.points[1]!.x);
        expect(portals).toHaveLength(2);
        expect(portals[0]!.points[1]!.x).toBeCloseTo(0);
        expect(portals[1]!.points[1]!.x).toBeCloseTo(100);
        const rest = lines.filter(line => line.color !== 0x000000);
        expect(rest.length).toBeGreaterThan(0);
        for (const line of rest) {
            expect(line.color).toBe(0x808080);
        }
    });

    it('draws the preview in the new-track line style and underground', () => {
        const curveCreation = fakeCurveCreationSource();
        const { host, graph, renderer } = scene({
            curveCreation: curveCreation.source,
        });
        renderer.renderStyle = 'centerline';
        graph.setNewSegmentStyle({ lineStyle: { preset: 'planned' } });

        curveCreation.emit('onPreviewDrawDataChange', previewData(graph));

        const lines = strokedLines(host.bandItem('__preview_rail__0'));
        expect(lines.length).toBeGreaterThan(1);
        for (const line of lines) {
            expect(line.color).toBe(0x000000);
        }
    });

    it('keeps the detailed style as it was', () => {
        const { host, graph } = scene();
        graph.setNewSegmentStyle({ lineStyle: { preset: 'planned' } });

        layTrack(graph, [A, B], ELEVATION.SUB_1);

        const lines = strokedLines(host.bandItem('__simplified__0'));
        expect(lines).toHaveLength(1);
        expect(lines[0]!.color).toBe(0x000000);
        expect(host.bandKeys).toContain('__underground__0');
    });

    it('still reports the band of a draw-data piece', () => {
        const { renderer, graph } = scene();
        renderer.renderStyle = 'rails';

        layTrack(graph, [A, B], ELEVATION.ABOVE_1);

        expect(
            renderer.getTrackBandIndex({
                trackSegmentNumber: 0,
                tValInterval: { start: 0, end: 1 },
            })
        ).toBe(4);
    });

    it('draws nothing more when a segment is restyled', () => {
        const { host, graph, renderer } = scene();
        renderer.renderStyle = 'centerline';
        layTrack(graph, [A, B], ELEVATION.ABOVE_1);

        graph.setSegmentStyle(0, { bed: true, electrified: true });

        expect(host.bandKeys).toEqual(['__simplified__0']);
        expect(host.bedKeys).toEqual([]);
    });

    it('draws the preview as lines, without a tunnel', () => {
        const curveCreation = fakeCurveCreationSource();
        const { host, graph, renderer } = scene({
            curveCreation: curveCreation.source,
            terrain: flatTerrain(5),
        });
        renderer.renderStyle = 'rails';

        curveCreation.emit('onPreviewDrawDataChange', previewData(graph));

        expect(host.bandKeys).toEqual(['__preview_rail__0']);
        expect(host.sublayerOf('__preview_rail__0')).toBe('rail');
        // The preview is under the terrain at 5, so it is lighter and dashed.
        const lines = strokedLines(host.bandItem('__preview_rail__0'));
        expect(lines.length).toBeGreaterThan(2);
        for (const line of lines) {
            expect(line.color).toBe(0x808080);
        }
    });

    it('draws the preview curve arcs too', () => {
        const curveCreation = fakeCurveCreationSource();
        const { host, graph, renderer } = scene({
            curveCreation: curveCreation.source,
        });
        renderer.renderStyle = 'centerline';
        renderer.showPreviewCurveArcs = true;

        curveCreation.emit(
            'onPreviewDrawDataChange',
            previewData(
                graph,
                new BCurve([A, { x: 100, y: 0 }, { x: 100, y: 100 }])
            )
        );

        expect(
            textsIn(host.bandItem('__preview__0')).some(text =>
                text.startsWith('R ')
            )
        ).toBe(true);
    });

    it('redraws laid track when the style changes', async () => {
        const { host, graph, camera, renderer } = scene();
        graph.setNewSegmentStyle({ bed: true, electrified: true });
        layTrack(graph, [A, B], ELEVATION.ABOVE_1);
        const detailedKeys = host.bandKeys;
        await zoomTo(camera, 5);

        renderer.renderStyle = 'rails';

        expect(host.bandKeys).toEqual(['__simplified__0']);
        expect(host.bedKeys).toEqual([]);
        expect(host.shadowKeys).toEqual([]);
        expect(host.bandItem('__simplified__0')!.visible).toBe(true);
        expect(strokedLines(host.bandItem('__simplified__0'))).toHaveLength(2);

        renderer.renderStyle = 'detailed';

        expect(host.bandKeys).toEqual(detailedKeys);
        expect(host.bedKeys).toEqual([KEY]);
        expect(host.shadowKeys).toEqual([KEY]);
        expect(host.bandItem(KEY)!.visible).toBe(true);
        expect(host.bandItem('__simplified__0')!.visible).toBe(false);
    });

    it('redraws the current preview when the style changes', () => {
        const curveCreation = fakeCurveCreationSource();
        const { host, graph, renderer } = scene({
            curveCreation: curveCreation.source,
        });
        curveCreation.emit('onPreviewDrawDataChange', previewData(graph));

        renderer.renderStyle = 'centerline';

        expect(host.bandKeys).toEqual(['__preview_rail__0']);
        expect(strokedLines(host.bandItem('__preview_rail__0'))).toHaveLength(
            1
        );

        renderer.renderStyle = 'detailed';

        expect(host.bandKeys).toEqual(['__preview__0', '__preview_rail__0']);
    });

    it('removes its lines on cleanup', () => {
        const curveCreation = fakeCurveCreationSource();
        const { host, graph, renderer } = scene({
            curveCreation: curveCreation.source,
        });
        renderer.renderStyle = 'rails';
        layTrack(graph, [A, B], ELEVATION.SUB_1);
        curveCreation.emit(
            'onPreviewDrawDataChange',
            previewData(
                graph,
                new BCurve([C, { x: 250, y: 0 }, { x: 300, y: 0 }])
            )
        );
        expect(host.bandKeys.length).toBeGreaterThan(0);

        renderer.cleanup();

        expect(host.bandKeys).toEqual([]);
    });
});

describe('TrackRenderSystem: crossings and runs', () => {
    const GAP = P + 0.5; // half-gap at 90°
    const DECK = 1.067 / 2 + 1.5; // half-deck at 90°
    const linesOf = (host: RecordingLayerHost, n: number) =>
        strokedLines(host.bandItem(`__simplified__${n}`));
    const xSpans = (lines: StrokedLine[]) =>
        lines
            .map(line => [
                Math.min(...line.points.map(point => point.x)),
                Math.max(...line.points.map(point => point.x)),
            ])
            .sort((a, b) => a[0]! - b[0]!);
    /** h along y = 0, then v across it at x = 50, one level up. */
    function crossing(graph: TrackGraph) {
        const h = layLine(graph, { x: 0, y: 0 }, { x: 100, y: 0 });
        const v = layLine(
            graph,
            { x: 50, y: -50 },
            { x: 50, y: 50 },
            ELEVATION.ABOVE_1
        );
        return { h, v };
    }
    function expectBridge(host: RecordingLayerHost, h: number, v: number) {
        const spans = xSpans(linesOf(host, h));
        expect(spans).toHaveLength(2);
        expect(spans[0]![1]).toBeCloseTo(50 - GAP, 6);
        expect(spans[1]![0]).toBeCloseTo(50 + GAP, 6);
        const parapets = linesOf(host, v).filter(
            line => Math.abs(line.points[1]!.x - 50) > 1
        );
        const xs = parapets
            .map(line => line.points[1]!.x)
            .sort((a, b) => a - b);
        expect(xs).toHaveLength(2);
        expect(xs[0]).toBeCloseTo(50 - P, 6);
        expect(xs[1]).toBeCloseTo(50 + P, 6);
        for (const parapet of parapets) {
            expect(parapet.points[0]!.y).toBeCloseTo(-DECK - W, 6);
            expect(parapet.points.at(-1)!.y).toBeCloseTo(DECK + W, 6);
        }
    }

    it('draws a bridge where track crosses over other track', () => {
        const { host, graph, renderer } = scene();
        renderer.renderStyle = 'centerline';

        const { h, v } = crossing(graph);

        expectBridge(host, h, v);
    });

    it('draws the bridge when the upper track is laid first', () => {
        const { host, graph, renderer } = scene();
        renderer.renderStyle = 'centerline';

        const v = layLine(
            graph,
            { x: 50, y: -50 },
            { x: 50, y: 50 },
            ELEVATION.ABOVE_1
        );
        const h = layLine(graph, { x: 0, y: 0 }, { x: 100, y: 0 });

        expectBridge(host, h, v);
    });

    it('cuts every rail of the lower track', () => {
        const { host, graph, renderer } = scene();
        renderer.renderStyle = 'rails';

        const { h, v } = crossing(graph);

        expect(linesOf(host, h)).toHaveLength(4);
        expect(linesOf(host, v)).toHaveLength(4);
    });

    it('restores the lower line when the upper track is removed', () => {
        const { host, graph, renderer } = scene();
        renderer.renderStyle = 'centerline';
        const { h, v } = crossing(graph);
        expect(xSpans(linesOf(host, h))).toHaveLength(2);

        graph.removeTrackSegment(v);

        const spans = xSpans(linesOf(host, h));
        expect(spans).toHaveLength(1);
        expect(spans[0]![0]).toBeCloseTo(0, 6);
        expect(spans[0]![1]).toBeCloseTo(100, 6);
    });

    it('restores every track a deleted upper track crossed', () => {
        const { host, graph, renderer } = scene();
        renderer.renderStyle = 'centerline';
        const h1 = layLine(graph, { x: 0, y: 0 }, { x: 100, y: 0 });
        const h2 = layLine(graph, { x: 0, y: 20 }, { x: 100, y: 20 });
        const v = layLine(
            graph,
            { x: 50, y: -50 },
            { x: 50, y: 50 },
            ELEVATION.ABOVE_1
        );
        expect(xSpans(linesOf(host, h1))).toHaveLength(2);
        expect(xSpans(linesOf(host, h2))).toHaveLength(2);

        graph.removeTrackSegment(v);

        expect(xSpans(linesOf(host, h1))).toHaveLength(1);
        expect(xSpans(linesOf(host, h2))).toHaveLength(1);
    });

    it('cuts a gap at each of two crossings', () => {
        const { host, graph, renderer } = scene();
        renderer.renderStyle = 'centerline';
        const h = layLine(graph, { x: 0, y: 0 }, { x: 100, y: 0 });
        layLine(
            graph,
            { x: 20, y: -40 },
            { x: 80, y: -40 },
            ELEVATION.ABOVE_1,
            {
                x: 50,
                y: 120,
            }
        );

        const spans = xSpans(linesOf(host, h));

        expect(spans).toHaveLength(3);
        for (const u of [
            (320 - Math.sqrt(51200)) / 640,
            (320 + Math.sqrt(51200)) / 640,
        ]) {
            const x = 20 + 60 * u;
            expect(spans.some(([from, to]) => from! <= x && x <= to!)).toBe(
                false
            );
        }
    });

    it('draws nothing at a level crossing', () => {
        const { host, graph, renderer } = scene();
        renderer.renderStyle = 'centerline';
        const h = layLine(graph, { x: 0, y: 0 }, { x: 100, y: 0 });
        const v = layLine(graph, { x: 50, y: -50 }, { x: 50, y: 50 });

        expect(linesOf(host, h)).toHaveLength(1);
        expect(linesOf(host, v)).toHaveLength(1);
    });

    it('draws nothing where the lower track is underground', () => {
        const { host, graph, renderer } = scene();
        renderer.renderStyle = 'centerline';
        const h = layLine(
            graph,
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            ELEVATION.SUB_1
        );
        const v = layLine(graph, { x: 50, y: -50 }, { x: 50, y: 50 });
        const alone = scene();
        alone.renderer.renderStyle = 'centerline';
        const same = layLine(
            alone.graph,
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            ELEVATION.SUB_1
        );

        expect(linesOf(host, h)).toEqual(linesOf(alone.host, same));
        expect(linesOf(host, v)).toHaveLength(1);
    });

    it('treats a tunnel preset as underground at a crossing', () => {
        const { host, graph, renderer } = scene();
        renderer.renderStyle = 'centerline';
        const h = layLine(graph, { x: 0, y: 0 }, { x: 100, y: 0 });
        graph.setNewSegmentStyle({ lineStyle: { preset: 'tunnel' } });
        const v = layLine(
            graph,
            { x: 50, y: -50 },
            { x: 50, y: 50 },
            ELEVATION.ABOVE_1
        );

        expect(linesOf(host, h)).toHaveLength(1);
        const acrossV = linesOf(host, v).filter(
            line => Math.abs(line.points[1]!.x - 50) > 1
        );
        const ys = acrossV.map(line => line.points[1]!.y).sort((a, b) => a - b);
        expect(ys).toHaveLength(2);
        expect(ys[0]).toBeCloseTo(-50, 6);
        expect(ys[1]).toBeCloseTo(50, 6);
    });

    it('redraws the lower track when the upper becomes a tunnel', () => {
        const { host, graph, renderer } = scene();
        renderer.renderStyle = 'centerline';
        const { h, v } = crossing(graph);
        expect(linesOf(host, h)).toHaveLength(2);

        graph.setSegmentStyle(v, { lineStyle: { preset: 'tunnel' } });

        expect(linesOf(host, h)).toHaveLength(1);
    });

    it('draws bridges after loading a saved layout', async () => {
        const source = new TrackGraph();
        crossing(source);
        const saved = source.serialize();
        const { host, graph, renderer } = scene();
        renderer.renderStyle = 'centerline';

        await graph.loadFromSerializedData(saved, {
            yieldToFrame: async () => {},
        });

        expectBridge(host, 0, 1);
    });

    it('keeps bridges right across render-style switches', () => {
        const { host, graph, renderer } = scene();
        renderer.renderStyle = 'centerline';
        const { h, v } = crossing(graph);

        renderer.renderStyle = 'rails';
        expect(linesOf(host, h)).toHaveLength(4);

        renderer.renderStyle = 'detailed';
        renderer.renderStyle = 'centerline';
        expectBridge(host, h, v);
        expect(
            host.bandKeys.filter(key => key.startsWith('__simplified__'))
        ).toEqual(['__simplified__0', '__simplified__1']);
    });

    it('draws each segment once when a style switch redraws laid track', () => {
        const { host, graph, renderer } = scene();
        const { h, v } = crossing(graph);
        const draw = spyOn(
            TrackRenderSystem.prototype as any,
            '_drawLineSegment'
        );
        try {
            renderer.renderStyle = 'centerline';

            expect(draw).toHaveBeenCalledTimes(2);
        } finally {
            draw.mockRestore();
        }
        expectBridge(host, h, v);
    });

    it('keeps run ends right when a style switch draws a tunnel run', () => {
        const { host, graph, renderer } = scene();
        layTrack(graph, [A, B, C]);
        const tunnel = { lineStyle: { preset: 'tunnel' as const } };
        graph.setSegmentStyle(0, tunnel);
        graph.setSegmentStyle(1, tunnel);
        const draw = spyOn(
            TrackRenderSystem.prototype as any,
            '_drawLineSegment'
        );
        try {
            renderer.renderStyle = 'centerline';

            expect(draw).toHaveBeenCalledTimes(2);
        } finally {
            draw.mockRestore();
        }
        const portalXs = (n: number) =>
            linesOf(host, n)
                .filter(line => line.color === 0x000000)
                .map(line => line.points[1]!.x);
        expect(portalXs(0)).toHaveLength(1);
        expect(portalXs(0)[0]).toBeCloseTo(0, 6);
        expect(portalXs(1)).toHaveLength(1);
        expect(portalXs(1)[0]).toBeCloseTo(200, 6);
    });

    it('puts tunnel portals only at the ends of a tunnel run', () => {
        const { host, graph, renderer } = scene();
        renderer.renderStyle = 'centerline';
        layTrack(graph, [A, B, C]);
        const tunnel = { lineStyle: { preset: 'tunnel' as const } };
        const portalXs = (n: number) =>
            linesOf(host, n)
                .filter(line => line.color === 0x000000)
                .map(line => line.points[1]!.x)
                .sort((a, b) => a - b);

        graph.setSegmentStyle(0, tunnel);
        const alone = portalXs(0);
        expect(alone).toHaveLength(2);
        expect(alone[0]).toBeCloseTo(0, 6);
        expect(alone[1]).toBeCloseTo(100, 6);

        graph.setSegmentStyle(1, tunnel);
        const first = portalXs(0);
        const second = portalXs(1);
        expect(first).toHaveLength(1);
        expect(first[0]).toBeCloseTo(0, 6);
        expect(second).toHaveLength(1);
        expect(second[0]).toBeCloseTo(200, 6);

        graph.removeTrackSegment(1);
        expect(portalXs(0)).toHaveLength(2);
    });

    it('puts viaduct wings only at the ends of a bridge run', () => {
        const { host, graph, renderer } = scene();
        renderer.renderStyle = 'centerline';
        layTrack(graph, [A, B, C]);
        const bridge = { lineStyle: { preset: 'bridge' as const } };
        const parapets = (n: number) =>
            linesOf(host, n).filter(line => Math.abs(line.points[1]!.y) > 1);

        graph.setSegmentStyle(0, bridge);
        const alone = parapets(0);
        expect(alone).toHaveLength(2);
        for (const parapet of alone) {
            expect(parapet.points.at(-1)!.x).toBeCloseTo(100 + W, 6);
        }

        graph.setSegmentStyle(1, bridge);
        const first = parapets(0);
        const second = parapets(1);
        expect(first).toHaveLength(2);
        expect(second).toHaveLength(2);
        for (const parapet of first) {
            expect(parapet.points.at(-1)!.x).toBeCloseTo(100, 6);
        }
        for (const parapet of second) {
            expect(parapet.points[0]!.x).toBeCloseTo(100, 6);
        }
    });
});

describe('TrackRenderSystem: marks across joints', () => {
    const GAP = P + 0.5; // half-gap at 90°
    const DECK = 1.067 / 2 + 1.5; // half-deck at 90°
    const linesOf = (host: RecordingLayerHost, n: number) =>
        strokedLines(host.bandItem(`__simplified__${n}`));
    const xSpans = (lines: StrokedLine[]) =>
        lines
            .map(line => [
                Math.min(...line.points.map(point => point.x)),
                Math.max(...line.points.map(point => point.x)),
            ])
            .sort((a, b) => a[0]! - b[0]!);
    /** The parapets of a deck: the lines that run P either side of the centre line. */
    const parapetsOf = (lines: StrokedLine[]) =>
        lines.filter(line => Math.abs(Math.abs(line.points[1]!.y) - P) < 1e-6);
    const expectSpans = (
        spans: number[][],
        expected: [number, number][]
    ): void => {
        expect(spans).toHaveLength(expected.length);
        expected.forEach(([from, to], i) => {
            expect(spans[i]![0]).toBeCloseTo(from, 6);
            expect(spans[i]![1]).toBeCloseTo(to, 6);
        });
    };

    /** Track A–B–C at ground level, and an upper track across it at x = 99, 1 m short of the joint. */
    function layGapScene(graph: TrackGraph) {
        layTrack(graph, [A, B, C]);
        return layLine(
            graph,
            { x: 99, y: -50 },
            { x: 99, y: 50 },
            ELEVATION.ABOVE_1
        );
    }
    const carriedGap: [number, number][][] = [
        [[0, 99 - GAP]],
        [[99 + GAP, 200]],
    ];

    it('carries a gap across the joint onto the next segment', () => {
        const { host, graph, renderer } = scene();
        renderer.renderStyle = 'centerline';

        layGapScene(graph);

        expectSpans(xSpans(linesOf(host, 0)), carriedGap[0]!);
        expectSpans(xSpans(linesOf(host, 1)), carriedGap[1]!);
    });

    it('carries a deck across the joint, with wings only at its true ends', () => {
        const { host, graph, renderer } = scene();
        renderer.renderStyle = 'centerline';
        layTrack(graph, [A, B, C], ELEVATION.ABOVE_1);

        layLine(graph, { x: 99, y: -50 }, { x: 99, y: 50 });

        const first = parapetsOf(linesOf(host, 0));
        expect(first).toHaveLength(2);
        for (const parapet of first) {
            expect(parapet.points[0]!.x).toBeCloseTo(99 - DECK - W, 6);
            expect(parapet.points.at(-1)!.x).toBeCloseTo(100, 6);
        }
        const second = parapetsOf(linesOf(host, 1));
        expect(second).toHaveLength(2);
        for (const parapet of second) {
            expect(parapet.points[0]!.x).toBeCloseTo(100, 6);
            expect(parapet.points.at(-1)!.x).toBeCloseTo(99 + DECK + W, 6);
        }
    });

    it('carries a gap onto every branch at a junction', () => {
        const { host, graph, renderer } = scene();
        renderer.renderStyle = 'centerline';
        const tangent = { x: 1, y: 0 };
        const [a, b, c, d] = [A, B, C, { x: 200, y: 60 }].map(point =>
            graph.createNewEmptyJoint(point, tangent)
        );
        graph.connectJoints(a!, b!, [{ x: 50, y: 0 }]);
        graph.connectJoints(b!, c!, [{ x: 150, y: 0 }]);
        graph.connectJoints(b!, d!, [{ x: 150, y: 0 }]);
        const bc = graph.getJoint(b!)!.connections.get(c!)!;
        const bd = graph.getJoint(b!)!.connections.get(d!)!;

        layLine(graph, { x: 99, y: -50 }, { x: 99, y: 50 }, ELEVATION.ABOVE_1);

        const minX = (n: number) => xSpans(linesOf(host, n))[0]![0]!;
        expect(minX(bc)).toBeCloseTo(99 + GAP, 6);
        expect(Math.abs(minX(bd) - (99 + GAP))).toBeLessThan(0.1);
    });

    it('chains a gap across a short segment', () => {
        const { host, graph, renderer } = scene();
        renderer.renderStyle = 'centerline';
        layTrack(graph, [A, B, { x: 105, y: 0 }, C]);
        const angle = (20 * Math.PI) / 180;
        const reach = 50;

        layLine(
            graph,
            { x: 99 - reach * Math.cos(angle), y: -reach * Math.sin(angle) },
            { x: 99 + reach * Math.cos(angle), y: reach * Math.sin(angle) },
            ELEVATION.ABOVE_1
        );

        const half = (P + 0.5) / Math.sin(angle);
        expectSpans(xSpans(linesOf(host, 0)), [[0, 99 - half]]);
        expect(linesOf(host, 1)).toHaveLength(0);
        expectSpans(xSpans(linesOf(host, 2)), [[99 + half, 200]]);
    });

    it('ends a deck at an open end with a wing', () => {
        const { host, graph, renderer } = scene();
        renderer.renderStyle = 'centerline';
        layTrack(graph, [A, B], ELEVATION.ABOVE_1);

        layLine(graph, { x: 99, y: -50 }, { x: 99, y: 50 });

        const parapets = parapetsOf(linesOf(host, 0));
        expect(parapets).toHaveLength(2);
        for (const parapet of parapets) {
            expect(parapet.points.at(-1)!.x).toBeCloseTo(100 + W, 6);
        }
    });

    it('ends a deck that chains over a short segment with a wing at the open end', () => {
        const { host, graph, renderer } = scene();
        renderer.renderStyle = 'centerline';
        layTrack(graph, [A, B, { x: 105, y: 0 }], ELEVATION.ABOVE_1);
        const angle = (20 * Math.PI) / 180;
        const reach = 50;

        layLine(
            graph,
            { x: 99 - reach * Math.cos(angle), y: -reach * Math.sin(angle) },
            { x: 99 + reach * Math.cos(angle), y: reach * Math.sin(angle) }
        );

        // The deck is longer than the 5 m segment past the joint, so it covers it whole.
        const second = parapetsOf(linesOf(host, 1));
        expect(second).toHaveLength(2);
        for (const parapet of second) {
            expect(parapet.points[0]!.x).toBeCloseTo(100, 6);
            expect(parapet.points.at(-1)!.x).toBeCloseTo(105 + W, 6);
        }
    });

    it('restores both sides of the joint when the upper track is removed', () => {
        const { host, graph, renderer } = scene();
        renderer.renderStyle = 'centerline';
        const upper = layGapScene(graph);

        graph.removeTrackSegment(upper);

        expectSpans(xSpans(linesOf(host, 0)), [[0, 100]]);
        expectSpans(xSpans(linesOf(host, 1)), [[100, 200]]);
    });

    it('draws carried gaps after loading a saved layout', async () => {
        const source = new TrackGraph();
        layGapScene(source);
        const saved = source.serialize();
        const { host, graph, renderer } = scene();
        renderer.renderStyle = 'centerline';

        await graph.loadFromSerializedData(saved, {
            yieldToFrame: async () => {},
        });

        expectSpans(xSpans(linesOf(host, 0)), carriedGap[0]!);
        expectSpans(xSpans(linesOf(host, 1)), carriedGap[1]!);
    });

    it('carries a gap onto track laid after the crossing', () => {
        const { host, graph, renderer } = scene();
        renderer.renderStyle = 'centerline';
        const { joints } = layTrack(graph, [A, B]);
        layLine(graph, { x: 99, y: -50 }, { x: 99, y: 50 }, ELEVATION.ABOVE_1);

        const end = graph.createNewEmptyJoint(C, { x: 1, y: 0 });
        expect(graph.connectJoints(joints[1]!, end, [{ x: 150, y: 0 }])).toBe(
            true
        );
        const next = graph.getJoint(joints[1]!)!.connections.get(end)!;

        expectSpans(xSpans(linesOf(host, next)), [[99 + GAP, 200]]);
    });

    it('carries a gap onto the neighbour that was laid before the crossed segment', () => {
        const { host, graph, renderer } = scene();
        renderer.renderStyle = 'centerline';
        const tangent = { x: 1, y: 0 };
        const [a, b, c] = [A, B, C].map(point =>
            graph.createNewEmptyJoint(point, tangent)
        );
        expect(graph.connectJoints(b!, c!, [{ x: 150, y: 0 }])).toBe(true);
        const next = graph.getJoint(b!)!.connections.get(c!)!;
        layLine(graph, { x: 99, y: -50 }, { x: 99, y: 50 }, ELEVATION.ABOVE_1);
        expectSpans(xSpans(linesOf(host, next)), [[100, 200]]);

        expect(graph.connectJoints(a!, b!, [{ x: 50, y: 0 }])).toBe(true);

        expectSpans(xSpans(linesOf(host, next)), [[99 + GAP, 200]]);
    });

    it('keeps one gap when the lower segment is split near the crossing', () => {
        const { host, graph, renderer } = scene();
        renderer.renderStyle = 'centerline';
        const { segments } = layTrack(graph, [A, C]);
        const upper = layLine(
            graph,
            { x: 99, y: -50 },
            { x: 99, y: 50 },
            ELEVATION.ABOVE_1
        );

        graph.insertJointIntoTrackSegmentUsingTrackNumber(segments[0]!, 0.5);

        const lower = [...graph.trackCurveManager.livingEntities]
            .filter(n => n !== upper)
            .map(n => xSpans(linesOf(host, n)))
            .sort((a, b) => a[0]![0]! - b[0]![0]!);
        expect(lower).toHaveLength(2);
        expectSpans(lower[0]!, [[0, 99 - GAP]]);
        expectSpans(lower[1]!, [[99 + GAP, 200]]);
    });

    it('stops walking at a loop of track shorter than the reach', () => {
        const { host, graph, renderer } = scene();
        renderer.renderStyle = 'centerline';
        const crossings = spyOn(graph.trackCurveManager, 'getCrossings');
        const tangent = { x: 1, y: 0 };
        // A triangle with 7 m sides: its 21 m loop is inside the 25 m reach.
        const [left, right, bottom] = [
            { x: 95, y: 0 },
            { x: 102, y: 0 },
            { x: 98.5, y: -6 },
        ].map(point => graph.createNewEmptyJoint(point, tangent));
        expect(graph.connectJoints(left!, right!, [{ x: 98.5, y: 0 }])).toBe(
            true
        );
        expect(
            graph.connectJoints(right!, bottom!, [{ x: 100.25, y: -3 }])
        ).toBe(true);
        expect(graph.connectJoints(bottom!, left!, [{ x: 96.75, y: -3 }])).toBe(
            true
        );
        const top = graph.getJoint(left!)!.connections.get(right!)!;

        layLine(graph, { x: 96, y: 5 }, { x: 96, y: -0.5 }, ELEVATION.ABOVE_1);

        expectSpans(xSpans(linesOf(host, top)), [[96 + GAP, 102]]);
        // Walking from the top side's start, the other two sides are each
        // visited once, by their shortest way, and the walk ends there.
        const visits: { number: number; distance: number }[] = [];
        (renderer as any)._walkJoints(
            top,
            { joint: left!, position: { x: 95, y: 0 } },
            ({ number, distance }: (typeof visits)[number]) =>
                visits.push({ number, distance })
        );
        const leftSide = graph.getJoint(bottom!)!.connections.get(left!)!;
        const rightSide = graph.getJoint(right!)!.connections.get(bottom!)!;
        expect(visits.map(visit => visit.number)).toEqual([
            leftSide,
            rightSide,
        ]);
        expect(visits[0]!.distance).toBe(0);
        expect(visits[1]!.distance).toBeCloseTo(Math.hypot(3.5, 6), 3);
        // Four segments, and four additions that each look a segment up at
        // most once: not a lap round the loop for every one.
        expect(crossings.mock.calls.length).toBeLessThanOrEqual(4 * 4);
    });

    it('carries a gap the short way round a loop, not the way with fewer segments', () => {
        const { host, graph, renderer } = scene();
        renderer.renderStyle = 'centerline';
        const tangent = { x: 1, y: 0 };
        const joint = (x: number, y: number) =>
            graph.createNewEmptyJoint({ x, y }, tangent);
        const [far, j0, j1, k, end] = [
            joint(-20, 0),
            joint(0, 0),
            joint(4, 0),
            joint(2, 0.3),
            joint(30, 0),
        ];
        const segmentBetween = (from: number, to: number) =>
            graph.getJoint(from)!.connections.get(to)!;
        // The track `n` ends at j0. From there j1 is 4.04 m away through k
        // (two segments) and 5.2 m away by the curved segment, which is one.
        expect(graph.connectJoints(far!, j0!, [{ x: -10, y: 0 }])).toBe(true);
        expect(graph.connectJoints(j0!, j1!, [{ x: 2, y: -3 }])).toBe(true);
        expect(graph.connectJoints(j0!, k!, [{ x: 1, y: 0.15 }])).toBe(true);
        expect(graph.connectJoints(k!, j1!, [{ x: 3, y: 0.15 }])).toBe(true);
        expect(graph.connectJoints(j1!, end!, [{ x: 17, y: 0 }])).toBe(true);
        const n = segmentBetween(far!, j0!);
        const shortWay = 2 * Math.hypot(2, 0.3);

        // The track at 10° over m, 10 m along it, puts a gap on m that reaches
        // 4.6 m past j1: more than the short way, less than the long one.
        const angle = (10 * Math.PI) / 180;
        layLine(
            graph,
            { x: 14 + 50 * Math.cos(angle), y: -50 * Math.sin(angle) },
            { x: 14 - 50 * Math.cos(angle), y: 50 * Math.sin(angle) },
            ELEVATION.ABOVE_1
        );

        const overflow = (P + 0.5) / Math.sin(angle) - 10;
        expect(overflow).toBeGreaterThan(shortWay);
        expect(overflow).toBeLessThan(5.1);
        expectSpans(xSpans(linesOf(host, n)), [[-20, -(overflow - shortWay)]]);
    });

    it('finds the crossings of each segment once per event', () => {
        const { graph, renderer } = scene();
        renderer.renderStyle = 'centerline';
        const { joints, segments } = layTrack(
            graph,
            [0, 10, 20, 30, 40, 50, 60].map(x => ({ x, y: 0 }))
        );
        layLine(graph, { x: 25, y: -20 }, { x: 25, y: 20 }, ELEVATION.ABOVE_1);
        const crossings = spyOn(graph.trackCurveManager, 'getCrossings');
        const askedBy = (event: () => void): number[] => {
            crossings.mockClear();
            event();
            return crossings.mock.calls.map(([segment]) => segment);
        };
        const expectOnce = (asked: number[]) => {
            expect(asked.length).toBeGreaterThan(0);
            expect(new Set(asked).size).toBe(asked.length);
        };

        expectOnce(
            askedBy(() => {
                const next = graph.createNewEmptyJoint(
                    { x: 70, y: 0 },
                    { x: 1, y: 0 }
                );
                graph.connectJoints(joints[6]!, next, [{ x: 65, y: 0 }]);
            })
        );
        expectOnce(
            askedBy(() =>
                graph.setSegmentStyle(segments[3]!, {
                    lineStyle: { preset: 'bridge' },
                })
            )
        );
        expectOnce(askedBy(() => graph.removeTrackSegment(segments[4]!)));
        expectOnce(askedBy(() => (renderer.renderStyle = 'rails')));
    });

    it('cuts both segments once at a crossing on the joint', () => {
        const { host, graph, renderer } = scene();
        renderer.renderStyle = 'centerline';
        layTrack(graph, [A, B, C]);

        layLine(
            graph,
            { x: 100, y: -50 },
            { x: 100, y: 50 },
            ELEVATION.ABOVE_1
        );

        expectSpans(xSpans(linesOf(host, 0)), [[0, 100 - GAP]]);
        expectSpans(xSpans(linesOf(host, 1)), [[100 + GAP, 200]]);
    });
});
