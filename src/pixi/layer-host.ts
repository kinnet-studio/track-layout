import type { Container } from 'pixi.js';

import type { ELEVATION } from '../index.js';
import type { BandSublayer } from './world-render-system.js';

/**
 * Where the renderers put what they draw. Content is grouped into one band
 * per elevation level, and each band has sublayers that fix the draw order
 * within it.
 *
 * {@link WorldRenderSystem} is the default implementation. An app whose own
 * content (trains, buildings) must interleave with track by elevation draws
 * it into the same host.
 */
export interface LayerHost {
    /** Adds a container to a band's sublayer, or moves it there if the key exists. */
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
    /** The band index for a raw elevation in world units. */
    getElevationBandIndex(rawElevation: number): number;
    /** The elevation level for a raw elevation in world units. */
    resolveElevationLevel(rawElevation: number): ELEVATION;
    /** Adds to the shared bed layer at an elevation. */
    addBed(key: string, container: Container, elevation: ELEVATION): void;
    /** Removes and destroys a bed. */
    removeBed(key: string): void;
    /** Adds to the shared shadow layer at an elevation. */
    addShadow(key: string, container: Container, elevation: ELEVATION): void;
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
