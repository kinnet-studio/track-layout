import type { Container } from 'pixi.js';

import type { BandSublayer } from './world-render-system.js';

/**
 * Where the renderers put what they draw. Content is grouped into one band
 * per height band, and each band has sublayers that fix the draw order
 * within it.
 *
 * `WorldRenderSystem` is the default implementation. An app whose own
 * content (trains, buildings) must interleave with track by elevation draws
 * it into the same host.
 */
export interface LayerHost {
    /**
     * Adds a container to a band's sublayer. If the key exists, passing the
     * same container again moves it there; re-adding a key with a different
     * container is not supported.
     */
    addToBand(
        key: string,
        container: Container,
        bandIndex: number,
        sublayer: BandSublayer
    ): void;
    /** Removes a band item and returns it; the caller destroys it. */
    removeFromBand(key: string): Container | undefined;
    /** Sets a band item's draw order within its sublayer. */
    setOrderInBand(key: string, order: number): void;
    /** The band just above a height in metres, clamped to the first and last band. */
    getElevationBandIndex(metres: number): number;
    /** The height in metres of the band for a height in metres. */
    resolveElevationLevel(metres: number): number;
    /** Adds to the shared bed layer of the band for a height in metres. */
    addBed(key: string, container: Container, bandHeight: number): void;
    /** Removes and destroys a bed. */
    removeBed(key: string): void;
    /** Adds to the shared shadow layer of the band for a height in metres. */
    addShadow(key: string, container: Container, bandHeight: number): void;
    /** Removes and destroys a shadow. */
    removeShadow(key: string): void;
    /** Adds an item that belongs to no band, such as a preview. */
    addDrawable(key: string, container: Container): void;
    /** Removes an unbanded item and returns it; the caller destroys it. */
    removeDrawable(key: string): Container | undefined;
    /** Looks a key up among unbanded and band items. */
    getDrawable(key: string): Container | undefined;
    /** Adds a container above the bands, or at `options.zIndex`. */
    addOverlayContainer(
        container: Container,
        options?: { zIndex?: number }
    ): void;
    removeOverlayContainer(container: Container): void;
    /** Re-sorts every sortable sublayer and the bands. */
    sortChildren(): void;
}
