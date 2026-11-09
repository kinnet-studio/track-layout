/** Resolution of the procedural track segment texture (power-of-two for repeat wrap). */
export const TRACK_TEX_SIZE = 64;

/** How far the ties stick out past the rails, in texture pixels. */
const TIE_OVERHANG = 4;

/** Ballast/slab half-width for a gauge, in metres. */
export const ballastHalfWidthForGauge = (gauge: number): number => {
    const tieHw =
        (gauge / 2) * ((TRACK_TEX_SIZE + TIE_OVERHANG * 2) / TRACK_TEX_SIZE);
    return tieHw + 0.15;
};
