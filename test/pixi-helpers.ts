import { DefaultBoardCamera } from '@ue-too/board';
import { type Container, Texture } from 'pixi.js';

import type { ELEVATION } from '../src/index.js';
import type {
    CatenaryLayoutPreviewSource,
    CurveCreationPreviewSource,
    DuplicateToSidePreviewSource,
} from '../src/pixi/preview-sources.js';
import type { TrackTextureRenderer } from '../src/pixi/track-render-system.js';
import {
    type BandSublayer,
    WorldRenderSystem,
} from '../src/pixi/world-render-system.js';

/**
 * Generates every texture as a new empty texture, so meshes build headless.
 * Each call returns its own texture because the renderers destroy theirs on
 * cleanup.
 */
export const textureRenderer: TrackTextureRenderer = {
    renderer: {
        textureGenerator: { generateTexture: () => new Texture() },
    },
};

/** The track renderer's key for the draw data of one segment piece. */
export function drawKey(segment: number, start = 0, end = 1): string {
    return JSON.stringify({
        trackSegmentNumber: segment,
        tValInterval: { start, end },
    });
}

/** A camera at zoom 1, which shows the simplified track. */
export function camera(): DefaultBoardCamera {
    return new DefaultBoardCamera();
}

/** Zooms the camera and waits for its zoom event, which arrives a microtask later. */
export async function zoomTo(
    camera: DefaultBoardCamera,
    zoomLevel: number
): Promise<void> {
    camera.setZoomLevel(zoomLevel);
    await Promise.resolve();
}

/**
 * The real {@link WorldRenderSystem}, recording where each key went so tests
 * can ask without walking the scene graph.
 */
export class RecordingLayerHost extends WorldRenderSystem {
    private _bandItems = new Map<
        string,
        { container: Container; bandIndex: number; sublayer: BandSublayer }
    >();
    private _beds = new Map<
        string,
        { container: Container; elevation: ELEVATION }
    >();
    private _shadows = new Map<
        string,
        { container: Container; elevation: ELEVATION }
    >();
    private _drawables = new Map<string, Container>();
    private _overlays = new Set<Container>();

    override addToBand(
        key: string,
        container: Container,
        bandIndex: number,
        sublayer: BandSublayer
    ): void {
        super.addToBand(key, container, bandIndex, sublayer);
        this._bandItems.set(key, { container, bandIndex, sublayer });
    }
    override removeFromBand(key: string): Container | undefined {
        this._bandItems.delete(key);
        return super.removeFromBand(key);
    }
    override addBed(
        key: string,
        container: Container,
        elevation: ELEVATION
    ): void {
        super.addBed(key, container, elevation);
        this._beds.set(key, { container, elevation });
    }
    override removeBed(key: string): void {
        this._beds.delete(key);
        super.removeBed(key);
    }
    override addShadow(
        key: string,
        container: Container,
        elevation: ELEVATION
    ): void {
        super.addShadow(key, container, elevation);
        this._shadows.set(key, { container, elevation });
    }
    override removeShadow(key: string): void {
        this._shadows.delete(key);
        super.removeShadow(key);
    }
    override addDrawable(key: string, container: Container): void {
        super.addDrawable(key, container);
        this._drawables.set(key, container);
    }
    override removeDrawable(key: string): Container | undefined {
        this._drawables.delete(key);
        return super.removeDrawable(key);
    }
    override addOverlayContainer(
        container: Container,
        options?: { zIndex?: number }
    ): void {
        super.addOverlayContainer(container, options);
        this._overlays.add(container);
    }
    override removeOverlayContainer(container: Container): void {
        this._overlays.delete(container);
        super.removeOverlayContainer(container);
    }

    bandOf(key: string): number | undefined {
        return this._bandItems.get(key)?.bandIndex;
    }
    sublayerOf(key: string): BandSublayer | undefined {
        return this._bandItems.get(key)?.sublayer;
    }
    bandItem(key: string): Container | undefined {
        return this._bandItems.get(key)?.container;
    }
    bedElevationOf(key: string): ELEVATION | undefined {
        return this._beds.get(key)?.elevation;
    }
    bed(key: string): Container | undefined {
        return this._beds.get(key)?.container;
    }
    shadowElevationOf(key: string): ELEVATION | undefined {
        return this._shadows.get(key)?.elevation;
    }
    shadow(key: string): Container | undefined {
        return this._shadows.get(key)?.container;
    }
    /** The band keys, sorted. */
    get bandKeys(): string[] {
        return [...this._bandItems.keys()].sort();
    }
    /** The bed keys, sorted. */
    get bedKeys(): string[] {
        return [...this._beds.keys()].sort();
    }
    /** The shadow keys, sorted. */
    get shadowKeys(): string[] {
        return [...this._shadows.keys()].sort();
    }
    /** The unbanded drawable keys, sorted. */
    get drawableKeys(): string[] {
        return [...this._drawables.keys()].sort();
    }
    /** The overlay containers, in the order they were added. */
    get overlays(): Container[] {
        return [...this._overlays];
    }
}

export type FakeSubscription = {
    method: string;
    observer: (payload: unknown) => void;
    signal: AbortSignal | undefined;
};

/**
 * A stand-in preview source: it records each subscription, and `emit` sends
 * a payload to the observers of one method.
 */
function fakeSource<S>(methods: readonly string[]) {
    const subscriptions: FakeSubscription[] = [];
    const source: Record<
        string,
        (
            observer: (payload: unknown) => void,
            options?: { signal?: AbortSignal }
        ) => void
    > = {};
    for (const method of methods) {
        source[method] = (observer, options) => {
            subscriptions.push({ method, observer, signal: options?.signal });
        };
    }
    return {
        source: source as unknown as S,
        subscriptions,
        emit(method: string, payload: unknown): void {
            for (const subscription of subscriptions) {
                if (subscription.method === method) {
                    subscription.observer(payload);
                }
            }
        },
    };
}

export function fakeCurveCreationSource() {
    return fakeSource<CurveCreationPreviewSource>([
        'onPreviewDrawDataChange',
        'onDeletionHighlightChange',
        'onPreviewStartProjectionChange',
        'onPreviewEndProjectionChange',
    ]);
}

export function fakeDuplicateToSideSource() {
    return fakeSource<DuplicateToSidePreviewSource>([
        'onPreviewDrawDataChange',
        'onHighlightChange',
    ]);
}

export function fakeCatenaryLayoutSource() {
    return fakeSource<CatenaryLayoutPreviewSource>([
        'onHighlightChange',
        'onPreviewChange',
    ]);
}
