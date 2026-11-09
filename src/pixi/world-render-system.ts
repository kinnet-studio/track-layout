import { Container } from 'pixi.js';

import type { LayerHost } from './layer-host.js';

/** The heights of the seven Detailed bands, in metres, lowest first. */
export const DETAILED_BAND_HEIGHTS: readonly number[] = [
    -30, -20, -10, 0, 10, 20, 30,
];

const LOWEST_BAND = 0;
const HIGHEST_BAND = DETAILED_BAND_HEIGHTS.length - 1;

/**
 * Use the upper bound when between bands so higher-elevation shadow draws on
 * top of lower-elevation content.
 */
export const getBandIndexForHeight = (metres: number): number => {
    if (metres <= DETAILED_BAND_HEIGHTS[LOWEST_BAND]) return LOWEST_BAND;
    if (metres >= DETAILED_BAND_HEIGHTS[HIGHEST_BAND]) return HIGHEST_BAND;
    const found = findElevationInterval(metres);
    if (found === null) return LOWEST_BAND;
    const lower = DETAILED_BAND_HEIGHTS.indexOf(found.interval[0]);
    return found.ratio > 0 ? lower + 1 : lower;
};

/**
 * Find which two band heights a height in metres falls between.
 *
 * @param metres - Height in metres
 * @returns The bounding band heights and interpolation ratio, or null if out of the bands' range
 */
export const findElevationInterval = (
    metres: number
): { interval: [number, number]; ratio: number } | null => {
    const heights = DETAILED_BAND_HEIGHTS;
    let left = 0;
    let right = heights.length - 1;
    while (left <= right) {
        const mid = left + Math.floor((right - left) / 2);
        const low = heights[mid];
        if (
            low <= metres &&
            mid + 1 < heights.length &&
            heights[mid + 1] >= metres
        ) {
            return {
                interval: [low, heights[mid + 1]],
                ratio: (metres - low) / (heights[mid + 1] - low),
            };
        } else if (metres < low) {
            right = mid - 1;
        } else {
            left = mid + 1;
        }
    }
    return null;
};

/**
 * Sublayer types within each elevation band.
 *
 * Draw order (bottom to top): bed → drawable → rail → onTrack → catenary → shadow.
 *
 * Shadow is drawn last within its band so a higher track's shadow (placed in
 * the band below the track's) paints over tracks/rails in that lower band.
 * Terrain occlusion for the next band still hides it because occlusion
 * containers sit between bands in the parent z-order.
 */
export type BandSublayer = 'drawable' | 'rail' | 'onTrack' | 'catenary';

/** Z-index constants for band sublayers. Shadow and bed are shared containers; the rest are sortable. */
const SUBLAYER_BED = 0;
const SUBLAYER_DRAWABLE = 1;
const SUBLAYER_RAIL = 2;
const SUBLAYER_ON_TRACK = 3;
const SUBLAYER_CATENARY = 4;
const SUBLAYER_SHADOW = 5;

const SUBLAYER_MAP: Record<BandSublayer, number> = {
    drawable: SUBLAYER_DRAWABLE,
    rail: SUBLAYER_RAIL,
    onTrack: SUBLAYER_ON_TRACK,
    catenary: SUBLAYER_CATENARY,
};

/**
 * A height band groups all render layers for a single band height.
 *
 * Each sublayer is a separate Container with its own z-index space,
 * so there is no hard cap on the number of items per sublayer.
 */
type ElevationBand = {
    container: Container;
    shadow: Container;
    bed: Container;
    drawable: Container;
    rail: Container;
    onTrack: Container;
    catenary: Container;
};

/**
 * Generic render system that manages elevation-based draw ordering for all
 * world objects (tracks, buildings, trains, etc.).
 *
 * Objects are organized into elevation bands. Each band contains sublayer
 * containers (shadow, bed, drawable, rail, onTrack, catenary) that enforce
 * draw order within the band. Band containers are sorted relative to each
 * other so higher-elevation content draws on top of lower-elevation content.
 *
 * Sub-renderers (TrackRenderSystem, BuildingRenderSystem, etc.) create
 * their own Graphics/Containers and register them here for unified draw ordering.
 */
/** Draw order (bottom to top): below (bands) → overlays. */
const Z_INDEX_BELOW = 0;
const Z_INDEX_OVERLAYS = 3;

export class WorldRenderSystem implements LayerHost {
    private _mainContainer: Container;
    /** Contains all elevation band containers. */
    private _drawDataBelow: Container;
    /** Non-banded drawables (previews, etc.) keyed by string. */
    private _drawableMap: Map<string, Container> = new Map();
    /** Shadow items keyed by string, with the band each sits in. */
    private _shadowMap: Map<
        string,
        { container: Container; bandIndex: number }
    > = new Map();
    /** Bed items keyed by string (shared per band, renders before rails). */
    private _bedMap: Map<string, { container: Container; bandIndex: number }> =
        new Map();
    /** Band items keyed by string. */
    private _bandItemMap: Map<
        string,
        { container: Container; bandIndex: number; sublayer: BandSublayer }
    > = new Map();
    /** Elevation bands indexed by band index. */
    private _bands: ElevationBand[] = [];

    /** Container for the base terrain visual (shading + contour lines). Renders below all bands. */
    private _terrainBaseContainer: Container;
    /**
     * Per-band terrain occlusion containers. Each sits between band[i-1] and band[i]
     * in the z-order, drawing opaque terrain to hide lower-elevation content.
     */
    private _terrainOcclusionContainers: Container[] = [];

    get container(): Container {
        return this._mainContainer;
    }

    /** Container for the base terrain layer (rendered below all elevation bands). */
    get terrainBaseContainer(): Container {
        return this._terrainBaseContainer;
    }

    /**
     * Get the terrain occlusion container for a given band index.
     * Content added here renders between band[index-1] and band[index],
     * hiding tracks at lower elevations where terrain is higher.
     *
     * @param bandIndex - Elevation band index (0 to bands.length - 1)
     */
    getTerrainOcclusionContainer(bandIndex: number): Container | undefined {
        return this._terrainOcclusionContainers[bandIndex];
    }

    /** Number of elevation bands. */
    get bandCount(): number {
        return this._bands.length;
    }

    constructor() {
        this._mainContainer = new Container();
        this._mainContainer.sortableChildren = true;
        this._drawDataBelow = new Container();
        this._drawDataBelow.sortableChildren = true;
        this._drawDataBelow.zIndex = Z_INDEX_BELOW;
        this._mainContainer.addChild(this._drawDataBelow);

        // Terrain base container renders below all elevation bands
        this._terrainBaseContainer = new Container();
        this._terrainBaseContainer.zIndex = -1;
        this._terrainBaseContainer.sortableChildren = true;
        this._drawDataBelow.addChild(this._terrainBaseContainer);

        for (let i = 0; i < DETAILED_BAND_HEIGHTS.length; i++) {
            // Terrain occlusion container sits between band[i-1] and band[i]
            const occlusionContainer = new Container();
            occlusionContainer.zIndex = i - 0.5;
            this._drawDataBelow.addChild(occlusionContainer);
            this._terrainOcclusionContainers.push(occlusionContainer);

            const band = this._createBand(i);
            this._drawDataBelow.addChild(band.container);
            this._bands.push(band);
        }
    }

    private _createBand(bandIndex: number): ElevationBand {
        const bandContainer = new Container();
        bandContainer.sortableChildren = true;
        bandContainer.zIndex = bandIndex;

        const shadow = new Container();
        shadow.zIndex = SUBLAYER_SHADOW;
        bandContainer.addChild(shadow);

        const bed = new Container();
        bed.zIndex = SUBLAYER_BED;
        bandContainer.addChild(bed);

        const drawable = new Container();
        drawable.sortableChildren = true;
        drawable.zIndex = SUBLAYER_DRAWABLE;
        bandContainer.addChild(drawable);

        const rail = new Container();
        rail.sortableChildren = true;
        rail.zIndex = SUBLAYER_RAIL;
        bandContainer.addChild(rail);

        const onTrack = new Container();
        onTrack.sortableChildren = true;
        onTrack.zIndex = SUBLAYER_ON_TRACK;
        bandContainer.addChild(onTrack);

        const catenary = new Container();
        catenary.sortableChildren = true;
        catenary.zIndex = SUBLAYER_CATENARY;
        bandContainer.addChild(catenary);

        return {
            container: bandContainer,
            shadow,
            bed,
            drawable,
            rail,
            onTrack,
            catenary,
        };
    }

    /**
     * Add a sibling container alongside the draw data layers.
     *
     * @param options.zIndex - Custom z-index. Omit for overlays (drawn on top).
     */
    addOverlayContainer(
        container: Container,
        options?: { zIndex?: number }
    ): void {
        container.zIndex = options?.zIndex ?? Z_INDEX_OVERLAYS;
        this._mainContainer.addChild(container);
        this._mainContainer.sortChildren();
    }

    removeOverlayContainer(container: Container): void {
        this._mainContainer.removeChild(container);
    }

    // -------------------------------------------------------------------------
    // Non-banded drawables (previews, ephemeral items)
    // -------------------------------------------------------------------------

    /**
     * Add a non-banded drawable directly to the below layer.
     *
     * Use this for ephemeral items (previews) that don't belong to a
     * specific elevation band. For elevation-aware items, use {@link addToBand}.
     */
    addDrawable(key: string, container: Container): void {
        this._drawableMap.set(key, container);
        this._drawDataBelow.addChild(container);
    }

    getDrawable(key: string): Container | undefined {
        return (
            this._drawableMap.get(key) ?? this._bandItemMap.get(key)?.container
        );
    }

    /**
     * Remove a non-banded drawable. Returns the container so the caller
     * can decide whether to destroy it.
     */
    removeDrawable(key: string): Container | undefined {
        const container = this._drawableMap.get(key);
        if (container !== undefined) {
            this._drawDataBelow.removeChild(container);
            this._drawableMap.delete(key);
        }
        return container;
    }

    setDrawableZIndex(key: string, zIndex: number): void {
        const container = this._drawableMap.get(key);
        if (container !== undefined) {
            container.zIndex = zIndex;
        }
    }

    // -------------------------------------------------------------------------
    // Band-based items (tracks, buildings, stations, trains, catenary)
    // -------------------------------------------------------------------------

    /**
     * Add a container to a specific elevation band and sublayer.
     *
     * If the key already exists, the container is moved to the new band/sublayer
     * (efficient reparenting for items that change elevation, e.g. moving trains).
     *
     * @param key - Unique identifier for the item
     * @param container - The pixi container to add
     * @param bandIndex - Elevation band index (from {@link getElevationBandIndex})
     * @param sublayer - Which sublayer within the band
     */
    addToBand(
        key: string,
        container: Container,
        bandIndex: number,
        sublayer: BandSublayer
    ): void {
        const existing = this._bandItemMap.get(key);
        if (existing) {
            if (
                existing.bandIndex === bandIndex &&
                existing.sublayer === sublayer
            ) {
                return; // Already in the right place
            }
            const oldBand = this._bands[existing.bandIndex];
            if (oldBand) {
                oldBand[existing.sublayer].removeChild(existing.container);
            }
        }

        const band = this._bands[bandIndex];
        if (band) {
            band[sublayer].addChild(container);
        }
        this._bandItemMap.set(key, { container, bandIndex, sublayer });
    }

    /**
     * Remove a band item. Returns the container so the caller can destroy it.
     */
    removeFromBand(key: string): Container | undefined {
        const item = this._bandItemMap.get(key);
        if (item === undefined) return undefined;

        const band = this._bands[item.bandIndex];
        if (band) {
            band[item.sublayer].removeChild(item.container);
        }
        this._bandItemMap.delete(key);
        return item.container;
    }

    /**
     * Set the draw order of a band item within its sublayer.
     */
    setOrderInBand(key: string, order: number): void {
        const item = this._bandItemMap.get(key);
        if (item !== undefined) {
            item.container.zIndex = order;
        }
    }

    /**
     * Get the band index of an item added via {@link addToBand}.
     */
    getBandIndex(key: string): number | undefined {
        return this._bandItemMap.get(key)?.bandIndex;
    }

    // -------------------------------------------------------------------------
    // Shadow (shared container per elevation)
    // -------------------------------------------------------------------------

    /**
     * Add shadow graphics to the shadow container of the band for
     * `bandHeight`, in metres. A height between bands goes in the band above,
     * as with {@link getElevationBandIndex}.
     *
     * For tracks, TrackRenderSystem passes the band below the track's top
     * height, so the shadow falls just below the track and terrain in the
     * track's own band hides it. For buildings: use the band above the base
     * height (shadow falls on the ground next to the building, below
     * elevated objects).
     */
    addShadow(key: string, container: Container, bandHeight: number): void {
        const bandIndex = getBandIndexForHeight(bandHeight);
        this._bands[bandIndex].shadow.addChild(container);
        this._shadowMap.set(key, { container, bandIndex });
    }

    removeShadow(key: string): void {
        const shadow = this._shadowMap.get(key);
        if (shadow !== undefined) {
            this._bands[shadow.bandIndex].shadow.removeChild(shadow.container);
            shadow.container.destroy({ children: true });
            this._shadowMap.delete(key);
        }
    }

    // -------------------------------------------------------------------------
    // Bed (shared container per elevation)
    // -------------------------------------------------------------------------

    /**
     * Add a bed container to the shared bed layer of the band for
     * `bandHeight`, in metres. A height between bands goes in the band above,
     * as with {@link getElevationBandIndex}.
     *
     * All bed items in the same band render together before any track
     * drawables, preventing one track's bed from covering another track's
     * rails at junctions.
     */
    addBed(key: string, container: Container, bandHeight: number): void {
        const bandIndex = getBandIndexForHeight(bandHeight);
        this._bands[bandIndex].bed.addChild(container);
        this._bedMap.set(key, { container, bandIndex });
    }

    removeBed(key: string): void {
        const bed = this._bedMap.get(key);
        if (bed !== undefined) {
            this._bands[bed.bandIndex].bed.removeChild(bed.container);
            bed.container.destroy({ children: true });
            this._bedMap.delete(key);
        }
    }

    // -------------------------------------------------------------------------
    // Elevation helpers
    // -------------------------------------------------------------------------

    /**
     * Map a height in metres to the elevation band index
     * used for z-ordering.
     */
    getElevationBandIndex(metres: number): number {
        return getBandIndexForHeight(metres);
    }

    /**
     * Resolve a height in metres to the height of its band, in metres.
     * Useful for determining which shadow/bed container to use.
     */
    resolveElevationLevel(metres: number): number {
        return DETAILED_BAND_HEIGHTS[getBandIndexForHeight(metres)];
    }

    // -------------------------------------------------------------------------
    // Sort / cleanup
    // -------------------------------------------------------------------------

    sortChildren(): void {
        for (const band of this._bands) {
            band.drawable.sortChildren();
            band.rail.sortChildren();
            band.onTrack.sortChildren();
            band.catenary.sortChildren();
        }
        this._drawDataBelow.sortChildren();
    }

    cleanup(): void {
        this._shadowMap.forEach(({ container, bandIndex }) => {
            this._bands[bandIndex].shadow.removeChild(container);
            container.destroy({ children: true });
        });
        this._shadowMap.clear();

        this._bedMap.forEach(({ container, bandIndex }) => {
            this._bands[bandIndex].bed.removeChild(container);
            container.destroy({ children: true });
        });
        this._bedMap.clear();

        this._bandItemMap.forEach(({ container, bandIndex, sublayer }) => {
            const band = this._bands[bandIndex];
            if (band) {
                band[sublayer].removeChild(container);
            }
            container.destroy({ children: true });
        });
        this._bandItemMap.clear();

        this._drawableMap.forEach(container => {
            this._drawDataBelow.removeChild(container);
            container.destroy({ children: true });
        });
        this._drawableMap.clear();

        this._terrainBaseContainer.destroy({ children: true });
        for (const oc of this._terrainOcclusionContainers) {
            oc.destroy({ children: true });
        }
        this._terrainOcclusionContainers = [];

        this._drawDataBelow.destroy({ children: true });
        this._mainContainer.destroy({ children: true });
    }
}
