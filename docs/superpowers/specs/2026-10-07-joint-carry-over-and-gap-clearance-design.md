# Bridges and gaps across joints, and a gap clearance option: design

- **Date:** 2026-10-07
- **Status:** Approved in conversation; written spec awaiting the owner's review
- **Source:** track-layout `main` at `f7eaae5` (0.8.0)
- **Builds on:** [line-style bridges, tunnels and per-segment line styles](./2026-10-07-line-style-bridges-tunnels-design.md)
- **Release:** the next release, likely 0.9.0 (it adds an option), through the Release workflow, triggered by the owner

## Goal

Two changes to how the `centerline` and `rails` styles draw crossings:

1. **Carry marks across joints.** A deck (the upper track's parapets) or a gap (the cut in the lower track) is clamped to its own segment today.
    - So a crossing near a joint leaves a stub of the next segment's line inside the bridge, or a deck that stops without a wing.
    - Marks grow as 1/sin θ, so this is visible at shallow crossings near junctions, the typical flying junction:
        - 2.7 m at 90°
        - 7.9 m at 20°
        - up to the 25 m cap
    - With this change, a mark continues onto the segments beyond the joint.
2. **Gap clearance option.** An app can set how far the gap in the lower track reaches past the upper track's parapets. Today it is fixed at 0.5 m.

## Non-goals

- The `detailed` style, which has no decks or gaps.
- Previews, which still get no crossing marks.
- Saving the clearance with the layout. It is a view setting, like `renderStyle`.
- Per-segment or per-crossing clearances.
- Changing how crossings are found (`getCrossings`) or classified (`classifyCrossing`).

## Decisions

| Topic                  | Decision                                                                                                                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Approach               | Pull at draw time. When the renderer builds a segment's marks, it also walks its joint neighbours, up to 25 m of track, and takes the part of their marks that reaches it. Nothing new is stored, so load order and removal stay correct as they are. |
| Rejected: push         | Storing each segment's overflow on its neighbours is new state that every remove, restyle and load order would have to keep right.                                                                                                |
| Rejected: model        | Marks are a rendering concern; `TrackCurveManager` stays as it is.                                                                                                                                                               |
| Junctions              | Overflow continues onto **every** segment at the joint: all the branches under a bridge are cut, and all the branches on it are bridged.                                                                                         |
| Chaining               | Overflow longer than the next segment chains on, still within the 25 m cap. It stops at an open end.                                                                                                                             |
| Wings                  | Only at a deck's true ends: inside a segment, or at an open end. Never at a joint the deck continues across.                                                                                                                     |
| Clearance option       | `bridgeGapClearance` in metres on `TrackRenderSystem`, an option and a setter. It defaults to 0.5 (`GAP_CLEARANCE`) and is clamped to [0, 25]; a non-finite value is ignored. Changing it redraws line-style track.            |

## Geometry (`src/pixi/line-track-geometry.ts`)

### Spans replace centre-and-half-length marks

```ts
/** A deck or gap over [from, to] of a segment's arc length, with a wing flag for each end of a deck. */
export type MarkSpan = {
    kind: 'deck' | 'gap';
    from: number;
    to: number;
    /** A deck's wing at `from` / `to`; ignored for gaps. */
    wings: { start: boolean; end: boolean };
};
```

- `crossingMark(self, other, terrain, renderStyle, gapClearance = GAP_CLEARANCE)` still returns `{ kind, s, halfLength } | null`. The only change is `L_gap = (P_upper + gapClearance) / sin θ + r·|cot θ|`, still capped at `MAX_MARK_HALF_LENGTH`.
- `LineTrackInput.marks?: MarkSpan[]` replaces `CrossingMark[]`.
- `buildLineTrack` draws spans as it draws marks today:
    - **Gaps:** clamped to the segment, merged, and cut from the track lines and a bridge preset's parapets, but not from portals or wings.
    - **Decks:** merged, each with parapets at ±P.
    - **Wings:** a merged deck's start wing comes from the span that gives its smallest `from`, and its end wing from the span that gives its largest `to`. Wings are drawn as the flags say.

### New helpers (pure)

```ts
/** A mark's span on its own segment, clamped, and how far it overflows each end. */
export function markSpan(
    mark: CrossingMark,
    length: number
): { span: MarkSpan; overflow: { start: number; end: number } };

/** The part of an overflow that lands on a neighbour entered at its start or end, and what is left over. */
export function carrySpan(
    kind: MarkSpan['kind'],
    overflow: number,
    length: number,
    enteringAt: 'start' | 'end'
): { span: MarkSpan; remaining: number };
```

- **`markSpan`:**
    - `from = max(0, s − L)` and `to = min(length, s + L)`.
    - `overflow.start = max(0, L − s)` and `overflow.end = max(0, s + L − length)`.
    - A deck's wing flags are true at an end that lies inside the segment (zero overflow). At an end that overflows, the flag starts false, and the renderer sets it once it knows whether a neighbour continues the deck.
- **`carrySpan`:**
    - Entering at `'start'`, the span is `[0, min(overflow, length)]`. Entering at `'end'`, it is `[max(0, length − overflow), length]`.
    - `remaining = max(0, overflow − length)`.
    - The wing at the entry side is false. The wing at the far side is true when `remaining === 0`, since the deck ends inside this segment.
    - When `remaining > 0`, the far side's flag starts false and the renderer resolves it the same way as for `markSpan`.

## Renderer (`TrackRenderSystem`, line styles only)

### Building a segment's spans (`_crossingMarks` becomes `_markSpans`)

1. **Own marks:** for each `getCrossings(n)` result, `crossingMark(…, this._bridgeGapClearance)` then `markSpan`.
    - At an end that overflows: if a segment sits at that joint (`getSegmentsAtJoint`, excluding `n`), the deck continues there and gets no wing. If not (an open end), the deck ends there with a wing.
2. **Carried marks:** from each end of `n`, walk back along the segments at that joint, and the segments beyond them, for up to `MAX_MARK_HALF_LENGTH` of track.
    - Keep a visited set, so loops of track end the walk.
    - For each segment `m` reached, with `D` the length of the segments walked between `m` and `n`: take each of `m`'s own marks whose overflow toward this path is `o > D`, and carry `o − D` onto `n` with `carrySpan`, entering at the end the walk arrived through.
    - If some is left over at `n`'s far end, the far wing follows the same open-end rule as step 1.
3. **Partners:** recorded as today, for own crossings only.

### Redraws

- **Who is redrawn:** when a segment's crossings can change (add, remove, a style change), the renderer redraws:
    - its partners and preset neighbours, as today
    - the segments within `MAX_MARK_HALF_LENGTH` of track along the joints of the segment and of each partner, found with the same walk
- **Records:** only segments that have a record are redrawn, as today. In a full redraw (render-style switch, constructor), each segment is drawn once, as today.
- **The setter:** `bridgeGapClearance` redraws every line-style segment in place, and does nothing in `detailed`.

### Option

```ts
type TrackRenderSystemOptions = {
    // ...unchanged, plus:
    /** How far (m) a gap reaches past the upper track's parapets. Default 0.5; clamped to [0, 25]. */
    bridgeGapClearance?: number;
};
```

## Package surface

- **No new exports.** `bridgeGapClearance` is an option and accessor on the already-exported `TrackRenderSystem`. `MarkSpan`, `markSpan` and `carrySpan` are internal; tests import them from `src/`.
- **README,** under "Render styles": a sentence on decks and gaps continuing across joints and junctions, and the `bridgeGapClearance` option with its default and range.

## Testing (`bun test`, typecheck, format check, build)

- **Geometry (`test/line-track-geometry.test.ts`):**
    - **`markSpan`:**
        - a mark inside the segment has zero overflow and wings at both ends
        - one past each end gives the right overflow and no wing there
    - **`carrySpan`:**
        - entering at the start and at the end
        - an overflow shorter than the segment has a far wing
        - a longer one leaves `remaining` and no far wing
    - **`buildLineTrack` with spans:**
        - a gap span at the segment start cuts from 0
        - a deck span with `wings.start: false` has no start wing
        - overlapping own and carried deck spans merge, keeping their outer wing flags
    - **`crossingMark` with `gapClearance`:** 0 and 3 give `(P + 0) / sin θ` and `(P + 3) / sin θ` at 90°, and the existing tests still pass with the default.
- **Renderer (`test/track-render-system.test.ts`):**
    - **Gap near a joint:** lower track A–B–C with a joint at x = 100, and an upper track crossing at 90° at x = 99. Its half-gap (P + 0.5 ≈ 2.53 m) reaches about 1.53 m past the joint. Segment A–B's line ends at x ≈ 96.47, and segment B–C's line starts at x ≈ 101.53, not at 100.
    - **Deck near a joint:** the upper track's deck reaches its joint. The next segment draws parapets from the joint with no wing there and a wing at the far end, and the first segment has no wing at the joint.
    - **Junction:** a gap reaching a joint with two segments beyond it cuts both.
    - **Chain:** a shallow crossing whose gap runs across a short (5 m) segment cuts it whole and continues onto the segment after it.
    - **Open end:** a deck reaching a track end with nothing beyond it gets a wing there.
    - **Removal:** removing the upper track restores the lower segments on both sides of the joint unbroken.
    - **Load order:** the same layout loaded from a save draws the same spans.
    - **Clearance option:**
        - the setter makes the gap longer, and redraws in place
        - the option given to the constructor is used
        - it survives a render-style switch
        - −1 is clamped to 0 and 99 to 25
        - `NaN` is ignored
        - in `detailed` it changes nothing

## Apps

- **Clapham:** a **Gap** setting next to Render (0 / 0.5 / 1 / 2 / 3 / 5 m), shown only in Centreline and Rails, not saved, default 0.5. It is specified in clapham's line-style controls spec and needs this release.
- **Banana:** no change.
