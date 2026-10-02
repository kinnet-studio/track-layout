import { describe, expect, it } from 'bun:test';
import type { Container, Graphics } from 'pixi.js';

import { JointDirectionRenderSystem } from '../src/pixi/joint-direction-render-system.js';
import { JointDirectionPreferenceMap } from '../src/tracks/joint-direction-preference-map.js';
import { TrackGraph } from '../src/tracks/track.js';
import { ELEVATION } from '../src/tracks/types.js';
import { RecordingLayerHost, camera, zoomTo } from './pixi-helpers.js';

/** Joint 1 at (100, 0) is a switch: it branches to joints 2 and 3. */
function scene() {
    const host = new RecordingLayerHost();
    const graph = new TrackGraph();
    const joints = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 40 },
    ].map(position =>
        graph.createNewEmptyJoint(position, { x: 1, y: 0 }, ELEVATION.GROUND)
    );
    graph.connectJoints(joints[0]!, joints[1]!, [{ x: 50, y: 0 }]);
    graph.connectJoints(joints[1]!, joints[2]!, [{ x: 150, y: 0 }]);
    graph.connectJoints(joints[1]!, joints[3]!, [{ x: 150, y: 0 }]);
    const preferences = new JointDirectionPreferenceMap();
    const cam = camera();
    const renderer = new JointDirectionRenderSystem(
        host,
        graph,
        preferences,
        cam
    );
    const [overlay] = host.overlays;
    const [highlights, arrows, hover] = overlay!.children as [
        Container,
        Container,
        Graphics,
    ];
    return {
        host,
        preferences,
        camera: cam,
        renderer,
        overlay: overlay!,
        highlights,
        arrows,
        hover,
    };
}

/** The colour of a graphics object's first stroke. */
function strokeColor(graphics: Container): number | undefined {
    const instruction = (graphics as Graphics).context.instructions.find(
        i => i.action === 'stroke'
    );
    return (instruction?.data as { style?: { color?: number } })?.style?.color;
}

describe('JointDirectionRenderSystem', () => {
    it('registers one hidden overlay, shown and hidden with the tool', () => {
        const { host, overlay, renderer } = scene();

        expect(host.overlays).toHaveLength(1);
        expect(overlay.visible).toBe(false);
        renderer.show();
        expect(overlay.visible).toBe(true);
        renderer.hide();
        expect(overlay.visible).toBe(false);
    });

    it('draws a highlight and an arrow for each branch of a selected switch', () => {
        const { renderer, highlights, arrows } = scene();

        renderer.selectJoint(1);

        expect(renderer.selectedJoint).toBe(1);
        expect(highlights.children).toHaveLength(2);
        expect(arrows.children).toHaveLength(2);

        renderer.deselectJoint();
        expect(renderer.selectedJoint).toBeNull();
        expect(highlights.children).toHaveLength(0);
        expect(arrows.children).toHaveLength(0);
    });

    it('draws nothing for a joint that does not branch', () => {
        const { renderer, highlights } = scene();

        renderer.selectJoint(0);

        expect(highlights.children).toHaveLength(0);
    });

    it('colours the preferred branch green and the other grey', () => {
        const { renderer, preferences, highlights } = scene();
        preferences.set(1, 'tangent', 3);

        renderer.selectJoint(1);

        expect(highlights.children.map(strokeColor)).toEqual([
            0x9ca3af, 0x22c55e,
        ]);
        preferences.set(1, 'tangent', 2);
        renderer.refresh();
        expect(highlights.children.map(strokeColor)).toEqual([
            0x22c55e, 0x9ca3af,
        ]);
    });

    it('sizes the hover dot to stay the same on screen as the camera zooms', async () => {
        const { renderer, camera, hover } = scene();

        renderer.showHoverIndicator(1);
        expect(hover.getLocalBounds().width).toBeCloseTo(16);

        await zoomTo(camera, 2);
        renderer.showHoverIndicator(1);
        expect(hover.getLocalBounds().width).toBeCloseTo(8);

        renderer.clearHoverIndicator();
        expect(hover.context.instructions).toHaveLength(0);
    });

    it('redraws a selection when the camera zooms', async () => {
        const { renderer, camera, highlights } = scene();
        renderer.selectJoint(1);
        const before = highlights.children[0];

        await zoomTo(camera, 2);

        expect(highlights.children).toHaveLength(2);
        expect(highlights.children[0]).not.toBe(before);
    });

    it('clears the selection and hover when hidden', () => {
        const { renderer, highlights, hover } = scene();
        renderer.show();
        renderer.selectJoint(1);
        renderer.showHoverIndicator(1);

        renderer.hide();

        expect(renderer.selectedJoint).toBeNull();
        expect(highlights.children).toHaveLength(0);
        expect(hover.context.instructions).toHaveLength(0);
    });

    it('destroys its overlay on dispose without calling removeOverlayContainer', () => {
        const { host, overlay, renderer } = scene();

        renderer.dispose();

        expect(overlay.destroyed).toBe(true);
        expect(host.overlays).toEqual([overlay]);
    });
});
