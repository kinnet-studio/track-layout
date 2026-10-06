import { BCurve } from '@ue-too/curve';
import type { Point } from '@ue-too/math';
import { describe, expect, it } from 'bun:test';
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

const A = { x: 0, y: 0 };
const B = { x: 100, y: 0 };
const C = { x: 200, y: 0 };
const KEY = drawKey(0);

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

    it('keeps the dashed marker on underground track at every zoom level', async () => {
        const { host, graph, camera, renderer } = scene();
        renderer.renderStyle = 'centerline';

        layTrack(graph, [A, B], ELEVATION.SUB_1);
        await zoomTo(camera, 10);

        expect(host.bandKeys).toEqual(['__simplified__0', '__underground__0']);
        expect(host.bandItem('__underground__0')!.visible).toBe(true);
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
        expect(strokedLines(host.bandItem('__preview_rail__0'))).toHaveLength(
            2
        );
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
