import { describe, expect, it } from 'bun:test';

import { CatenaryLayoutEngine } from '../src/editing/catenary-layout-engine.js';
import { CurveCreationEngine } from '../src/editing/curve-engine.js';
import { DuplicateToSideEngine } from '../src/editing/duplicate-to-side-engine.js';
import { TrackRenderSystem } from '../src/pixi/track-render-system.js';
import { TrackGraph } from '../src/tracks/track.js';
import {
    RecordingLayerHost,
    camera,
    drawKey,
    fakeCatenaryLayoutSource,
    fakeCurveCreationSource,
    fakeDuplicateToSideSource,
    textureRenderer,
} from './pixi-helpers.js';
import { identity, layTrack } from './station-placement-helpers.js';

function rendererWithAllSources() {
    const curveCreation = fakeCurveCreationSource();
    const duplicateToSide = fakeDuplicateToSideSource();
    const catenaryLayout = fakeCatenaryLayoutSource();
    const renderer = new TrackRenderSystem(
        new RecordingLayerHost(),
        new TrackGraph().trackCurveManager,
        camera(),
        {
            curveCreation: curveCreation.source,
            duplicateToSide: duplicateToSide.source,
            catenaryLayout: catenaryLayout.source,
        }
    );
    return { renderer, curveCreation, duplicateToSide, catenaryLayout };
}

describe('TrackRenderSystem preview sources', () => {
    it('draws laid track with no sources', () => {
        const host = new RecordingLayerHost();
        const graph = new TrackGraph();
        new TrackRenderSystem(host, graph.trackCurveManager, camera(), {
            textureRenderer,
        });

        layTrack(graph, [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
        ]);

        expect(host.sublayerOf(drawKey(0))).toBe('drawable');
        expect(host.sublayerOf(`__rail__${drawKey(0)}`)).toBe('rail');
    });

    it('subscribes to every method of each source it is given', () => {
        const { curveCreation, duplicateToSide, catenaryLayout } =
            rendererWithAllSources();

        expect(curveCreation.subscriptions.map(s => s.method)).toEqual([
            'onPreviewDrawDataChange',
            'onDeletionHighlightChange',
            'onPreviewStartProjectionChange',
            'onPreviewEndProjectionChange',
        ]);
        expect(duplicateToSide.subscriptions.map(s => s.method)).toEqual([
            'onPreviewDrawDataChange',
            'onHighlightChange',
        ]);
        expect(catenaryLayout.subscriptions.map(s => s.method)).toEqual([
            'onHighlightChange',
            'onPreviewChange',
        ]);
    });

    it('subscribes only to the sources it is given', () => {
        const curveCreation = fakeCurveCreationSource();
        new TrackRenderSystem(
            new RecordingLayerHost(),
            new TrackGraph().trackCurveManager,
            camera(),
            { curveCreation: curveCreation.source }
        );

        expect(curveCreation.subscriptions).toHaveLength(4);
    });

    it('unsubscribes from every source on cleanup', () => {
        const { renderer, curveCreation, duplicateToSide, catenaryLayout } =
            rendererWithAllSources();
        const all = [
            ...curveCreation.subscriptions,
            ...duplicateToSide.subscriptions,
            ...catenaryLayout.subscriptions,
        ];
        expect(all.every(s => s.signal?.aborted === false)).toBe(true);

        renderer.cleanup();

        expect(all.every(s => s.signal?.aborted === true)).toBe(true);
    });

    it('accepts the editing engines as sources', () => {
        const graph = new TrackGraph();
        const build = () =>
            new TrackRenderSystem(
                new RecordingLayerHost(),
                graph.trackCurveManager,
                camera(),
                {
                    textureRenderer,
                    curveCreation: new CurveCreationEngine(graph, identity),
                    duplicateToSide: new DuplicateToSideEngine(graph, identity),
                    catenaryLayout: new CatenaryLayoutEngine(graph, identity),
                }
            );

        expect(build).not.toThrow();
    });
});
