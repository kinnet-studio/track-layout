# Side-by-side crossing decks as one bridge: design

- **Date:** 2026-10-07
- **Status:** Approved in conversation; written spec awaiting the owner's review
- **Source:** track-layout `main` at `7d966a9` (0.10.0)
- **Builds on:** [line-style bridges, tunnels and per-segment line styles](./2026-10-07-line-style-bridges-tunnels-design.md) and [bridges and gaps across joints](./2026-10-07-joint-carry-over-and-gap-clearance-design.md)
- **Baseline:** `bun test` 646 pass across 49 files; `bun run typecheck` clean
- **Release:** 0.11.0, through the Release workflow, triggered by the owner

## Goal

In the `centerline` and `rails` styles, each upper track at a grade-separated crossing draws its own deck: two parapets with wings. Nothing looks at the track beside it.

- Two tracks closer than 2*P* (about 4.4 m at standard gauge) get decks that overlap, so their four parapets cross each other. That is what happens just past a flying junction, where two diverging tracks bridge the same lower track.
- Tracks a little further apart get two thin bridges with a sliver of open space between them.

With this change, decks over the same lower segment, at the same level and side by side, make **one wider bridge**:

- each upper track leaves out the parapet, and its wings, on the side facing its neighbour, so only the two outer parapets are drawn
- the lower track's gap runs unbroken under the whole bridge

## Non-goals

- **`bridge`-preset segments.** Their full-length parapets stay as they are, and they take no part in sharing: a `bridge` segment beside another `bridge` segment, or beside a crossing deck, keeps both parapets. Merging viaducts could come later.
- **A lower-track joint between the two crossings.** Two upper tracks share a bridge only when they cross the **same lower segment**. When a joint in the lower track falls between their crossings, they draw two decks, as today.
- **Options.** Sharing is always on in the line styles, with a fixed allowance. Nothing is added to `TrackRenderSystemOptions` and nothing is saved.
- **The `detailed` style and previews,** which draw no crossing decks.
- **Changing how crossings are found (`getCrossings`) or classified (`classifyCrossing`).**

## Decisions

| Topic                  | Decision                                                                                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spacing                | Two decks share when the space between their inner parapets is at most `SHARED_BRIDGE_SPACE` (2 m): centrelines within *P*<sub>a</sub> + *P*<sub>b</sub> + 2 m, about 6.4 m at standard gauge. Ordinary double track and diverging tracks just past a junction merge; tracks clearly apart don't. |
| Same level             | Their heights at the crossing differ by less than `VERTICAL_CLEARANCE` (3 m), the threshold that already makes a crossing `level`.                                                                                                     |
| Scope                  | Crossing decks only. `bridge`-preset segments keep their parapets.                                                                                                                                                                   |
| Option                 | None: always on, with a fixed allowance.                                                                                                                                                                                             |
| Approach               | Grouped from the lower segment's crossings, at draw time. One pure function decides which decks over a lower segment share, and both the upper and the lower tracks use it on the same cached list, so they can't disagree. Nothing new is stored in the model. |
| Rejected: neighbour search | Each upper track searching around its deck for tracks alongside. The lower track would need separate logic to join its gaps, the two could disagree near the threshold, and it needs more R-tree queries per draw.          |
| Rejected: clipping     | Drawing every deck as today and clipping parapets that fall inside another deck. It needs the same knowledge of other tracks, plus polygon clipping, and doesn't join the lower track's gaps.                                         |

## Geometry (`src/pixi/line-track-geometry.ts`)

### Which decks share a bridge

```ts
/** The most space (m) between two decks' inner parapets for them to make one bridge. */
export const SHARED_BRIDGE_SPACE = 2;

/** Crossing points closer than this (m) mean two upper tracks meet over the lower one. */
export const SHARED_BRIDGE_MIN_APART = 0.5;

/** A track that crosses over a lower segment with a deck, as the lower segment sees it. */
export type OverCrossing = {
    /** The upper segment. */
    segment: number;
    /** Where it crosses the lower segment. */
    point: Point;
    /** Arc length of the crossing along the lower segment. */
    s: number;
    /** The upper track's unit normal at the crossing (its tangent turned a quarter turn toward +y). */
    normal: Point;
    gauge: number;
    /** The upper track's height at the crossing, in metres. */
    height: number;
    /** How far (m) the upper track's deck reaches each way from the crossing. */
    reach: number;
};

/** Two neighbouring decks over one lower segment that make one bridge. */
export type SharedBridgePair = {
    /** Each deck, with the side of its own normal (+1 or −1) that faces the other. */
    a: { segment: number; s: number; side: 1 | -1 };
    b: { segment: number; s: number; side: 1 | -1 };
};

/** The pairs of neighbouring decks over one lower segment that share a bridge. */
export function sharedBridgePairs(
    over: readonly OverCrossing[]
): SharedBridgePair[];
```

- **Neighbours.** The crossings are sorted by `s` (then by `segment`, so that the order doesn't depend on the input's). Each one is compared only with the next one along the lower segment. In a run of three side-by-side tracks the outer two are never compared, since the middle one lies between them.
- **The rule.** Neighbours *a* and *b* (with *s*<sub>a</sub> ≤ *s*<sub>b</sub>) share a bridge when all of these hold:
    - **Same level:** |*h*<sub>a</sub> − *h*<sub>b</sub>| < `VERTICAL_CLEARANCE`.
    - **Not meeting:** |*b*.point − *a*.point| ≥ `SHARED_BRIDGE_MIN_APART` (0.5 m, the same distance `getCrossings` uses for touches at a shared joint). Crossing points closer than that mean the two tracks meet over the lower track, at a junction or a crossing on the bridge, and which side faces the other isn't defined. They keep their own decks, as today.
    - **Not crossing on the bridge:** the two centre lines, continued straight from their crossing points (along the tangents, from the normals), don't meet within either deck: |*t*| > `reach` along *a* and |*u*| > `reach` along *b*, where they meet at *a*.point + *t*·*T*<sub>a</sub> = *b*.point + *u*·*T*<sub>b</sub>. Tracks that cross or join on the bridge change sides along it, so leaving out the parapets facing each other at the crossing would leave out the wrong ones further on. They keep their own decks. Parallel tracks never meet. Branches that join well beyond the deck, like the two tracks just past a flying junction, still pair.
    - **Close enough:** with Δ = *b*.point − *a*.point, min(|Δ · *N*<sub>a</sub>|, |Δ · *N*<sub>b</sub>|) ≤ *P*<sub>a</sub> + *P*<sub>b</sub> + `SHARED_BRIDGE_SPACE`, where *P* is `parapetOffset(gauge)`. Δ · *N* is how far apart the two crossings are, measured across that track. Taking the smaller makes the rule symmetric: it gives the same answer from either track, and for diverging tracks it judges them by where they are closest.
- **Sides.** *a*'s side is the sign of Δ · *N*<sub>a</sub>, and *b*'s is the sign of −Δ · *N*<sub>b</sub>.
    - Δ lies along the lower track, which `getCrossings` only reports crossed at sin θ ≥ 0.02, so with |Δ| ≥ 0.5 m neither product is zero.
- **Which crossings go in.** The caller passes only real decks: crossings the lower segment classifies as `under` (so not `level` or `buried`), whose upper track isn't a `bridge` preset.

### Spans

`MarkSpan` gains an optional field:

```ts
export type MarkSpan = {
    // ...unchanged, plus:
    /**
     * A deck's sides whose parapet is left out, because a neighbouring deck
     * shares the bridge there: `positive` is the side the normal points to.
     * Ignored for gaps. None when omitted.
     */
    shared?: { positive: boolean; negative: boolean };
};
```

- **`markSpan`** leaves it unset; the renderer sets it.
- **`carrySpan`** gains an optional `shared` argument and copies it onto the span it returns. The renderer swaps the sides when the neighbour runs the other way (see below).

### Drawing (`buildLineTrack`)

- **Gaps** are drawn as today. The spans that join a lower track's gaps are ordinary gap spans, so the existing merging turns them into one cut.
- **Decks** are merged as today (`mergedSpans`), keeping their wing flags. Then each side's parapet is drawn on its own:
    1. Take the merged deck, clamped to the segment.
    2. Cut out every stretch covered by a deck span that shares this side, clamped to the segment, with the subtraction used for gaps (`subtractGaps`).
    3. Draw what is left as parapets at this side's offset, each in the colour of the run its centre lies on.
    4. A piece gets a wing at an end only when that end is the merged deck's own end and the deck's wing flag says so. An end made by cutting out a shared stretch gets none.
- Usually a deck shares a side along its whole length, so that side draws nothing. Step 2 only matters when a segment has overlapping decks and only some of them share a side: a track bridging two lower tracks close together, with a neighbour alongside over just one of them.
- **With no `shared` on any span** the strokes are exactly as today.

## Renderer (`TrackRenderSystem`, line styles only)

### Cache

`CrossingMarks` (the per-segment entry in `_markCache`) gains:

- **`over: OverCrossing[]`**: the tracks that make decks over this segment, as this segment sees them. `_findCrossingMarks` already builds both sides of each crossing:
    - an entry goes in when `crossingMark(self, across, …)` returns a gap and `across` isn't a `bridge` preset
    - `point` is `self.curve.get(t)`, `s` is `self.curve.lengthAtT(t)`, `normal` is the upper track's unit tangent at `otherT` turned toward +y, `height` is `heightAt(heightsOf(other), otherT)`, and `reach` is the half-length of the deck the upper track draws there, `crossingMark(across, self, …).halfLength`
- **The lower segment of each deck:** each own mark records the segment it crosses, so the renderer can look up that segment's `over` list.

The cache is dropped exactly as today. Adding, removing or re-presetting a track drops the cached marks of the segments it crosses, so their `over` lists are rebuilt before anything reads them.

### Building a segment's spans (`_markSpans`, `_carriedSpans`)

- **Shared sides.** A new helper `_sharedSides(segment, lower)` runs `sharedBridgePairs` on `_crossingMarksOf(lower).over` and returns the sides on which `segment` has a neighbour. Results aren't cached: they depend on other tracks, and the lists they come from are.
    - Each **own deck** gets `shared` from it.
    - Each **carried deck** gets the `shared` of the reached segment's deck, swapped (positive ↔ negative) when the reached segment runs the other way to the one being drawn.
    - The joint walk keeps one direction, so the two run the same way exactly when `facingStart === (enteringAt === 'end')`.
- **Joined gaps.** On a lower segment, each pair from `sharedBridgePairs` on its own `over` list adds a gap span over [*s*<sub>a</sub>, *s*<sub>b</sub>]. It lies between two crossing points on the segment, so it never overflows and is never carried. Each crossing's own gap still covers the ends of the cut.
- **Agreement.** The upper and lower tracks both read the lower segment's list. So even when `getCrossings` reports a crossing from only one of its segments, the bridge and the gap under it agree: a crossing missing from the lower segment's list is unshared from both sides.

### Redraws

`_redrawLineNeighbours(curveNumber, partners, ends)` adds one ring to what it redraws. For each partner, it also redraws:

- that partner's other partners (from `_linePartners`): the other tracks over the same lower segment, which can gain or lose a shared side
- the segments in reach of those tracks (`_reachOf`), which can carry a deck whose shared sides changed

That covers adding a track, removing one (from its recorded partners) and a preset change, the three paths that call it. A segment with no record is skipped, as today.

The full redraws (the constructor and a render-style switch) still draw each segment once. The model already holds every segment, so the first draw of each sees all its neighbours.

### Unchanged

- `bridgeGapClearance` doesn't affect sharing. Its setter redraws everything as today.
- `detailed` and previews.

## Package surface

- **No new exports.** `SHARED_BRIDGE_SPACE`, `SHARED_BRIDGE_MIN_APART`, `OverCrossing`, `SharedBridgePair`, `sharedBridgePairs` and the `MarkSpan.shared` field are internal, like the rest of the geometry module; tests import them from `src/`.
- **README,** under "Render styles": a sentence saying that decks over the same track at the same level, with no more than 2 m between their parapets, are drawn as one bridge.

## Testing (`bun test`, typecheck, format check, build)

- **Geometry (`test/line-track-geometry.test.ts`):**
    - **`sharedBridgePairs`:**
        - two parallel tracks 4 m apart at the same height make one pair, each facing the other
        - the spacing threshold at gauge 1.435 (*P* + *P* + 2 ≈ 6.44 m): 6.4 m apart pair, 6.5 m apart don't
        - heights 2.9 m apart pair; 3 m apart don't
        - three tracks give two pairs, and the middle one faces both ways
        - the input's order doesn't change the result
        - two diverging tracks give the same answer from either side
        - crossing points under 0.5 m apart don't pair
        - tracks whose centre lines meet within a deck don't pair; ones that meet beyond both decks do
    - **`buildLineTrack`:**
        - a deck sharing its positive side draws only its negative parapet, with both wings
        - a deck sharing both sides draws no parapets
        - overlapping decks where only one shares a side: that side's parapet runs only over the unshared stretch, with no wing at the cut
        - with no `shared`, the strokes are the same as before
    - **`carrySpan`** passes `shared` through.
- **Renderer (`test/track-render-system.test.ts`), in both line styles:**
    - two parallel upper tracks 4 m apart over a lower track: each draws only its outer parapet with its wings, and the lower line has one cut spanning both
    - 8 m apart: two full decks and two cuts
    - upper tracks at different levels: no sharing
    - three upper tracks: the middle one draws no parapets
    - **Updates:**
        - removing one upper track brings back the other's inner parapet
        - adding one redraws the track already there
        - changing one to the `tunnel` or `bridge` preset brings back its neighbour's parapet
    - **Across joints:**
        - a shared deck carried across a joint in the upper tracks keeps its shared side
        - it also keeps it when the next segment was laid the other way
    - **Known limitation:** a joint in the lower track between the two crossings means no sharing; both decks draw as today
    - **Load order:** the same scene loaded from a save draws the same strokes

## Release and apps

- **track-layout:** develop on `claude/hopeful-hypatia-shf366`. Release 0.11.0 through the Release workflow, dry run first, triggered by the owner. Before release, clapham can be tried against `bun run pack:local`.
- **Clapham:** a dependency bump to `^0.11.0` once it is published. No UI change.
- **Banana:** uses `detailed`; no change.
