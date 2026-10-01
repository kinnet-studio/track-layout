import type { Point } from '@ue-too/math';

/**
 * What the island station placement engine shows while a station is being
 * dragged out. The app implements it with its renderer.
 */
export interface StationPlacementPreview {
    /** Show a station outline centred on `center`, running along `direction`. */
    showPreview(
        center: Point,
        direction: Point,
        length: number,
        trackSpacing: number
    ): void;
    hidePreview(): void;
}

/** Preview calls shared by the single- and dual-spine platform tools. */
export interface SpinePlacementPreview {
    /** Highlight the side of a segment, at `projectionT`, that a pick would use. */
    showTrackHighlight(
        segmentId: number,
        projectionT: number,
        side: 1 | -1,
        offset: number
    ): void;
    /** Clear everything this preview has shown, the track highlight included. */
    hidePreview(): void;
}

/** What the single-spine platform tool shows while a platform is drawn. */
export interface SingleSpinePlacementPreview extends SpinePlacementPreview {
    showPlacementPreview(
        spinePoints: Point[],
        outerVertices: Point[],
        startAnchor: Point | null,
        endAnchor: Point | null
    ): void;
}

/** What the dual-spine platform tool shows while a platform pair is drawn. */
export interface DualSpinePlacementPreview extends SpinePlacementPreview {
    showDualSpinePlacementPreview(
        spineAPoints: Point[],
        spineBPoints: Point[],
        capAVertices: Point[],
        capBVertices: Point[],
        spineAStartAnchor: Point | null,
        spineAEndAnchor: Point | null,
        spineBStartAnchor: Point | null,
        spineBEndAnchor: Point | null
    ): void;
    /** The rubber-band line from the last cap vertex to the cursor or snap. */
    showCapDrawingHover(
        lastPoint: Point | null,
        cursorOrSnap: Point,
        closingAnchor: Point | null,
        isNearClosing: boolean
    ): void;
}
