/** Resolution of the procedural platform texture (power-of-two for repeat wrap). */
export const PLATFORM_TEX_SIZE = 128;

/** Yellow safety-line width as a fraction of the texture. */
export const SAFETY_LINE_FRAC = 0.06;

/** Texture u where the safety line, drawn from u = 0, ends. */
export const SAFETY_LINE_U =
    Math.round(PLATFORM_TEX_SIZE * SAFETY_LINE_FRAC) / PLATFORM_TEX_SIZE;

/**
 * World-space width (m) of the safety line along a platform's track edge,
 * the same on every platform whatever its width. The meshes give the line
 * its own strip, from u = 0 to SAFETY_LINE_U, this wide.
 */
export const SAFETY_LINE_WIDTH = 0.25;
