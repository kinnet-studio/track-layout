# Side-by-side crossing decks as one bridge: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the line styles, decks over the same lower segment, at the same level and side by side, draw as one wider bridge, and the lower track's gap runs unbroken beneath it.

**Architecture:**
- A pure function, `sharedBridgePairs`, takes the decks over one lower segment and returns the neighbouring pairs that share a bridge, with the side of each that faces the other.
- `MarkSpan` gains `shared` flags, and `buildLineTrack` leaves out a shared side's parapet.
- `TrackRenderSystem` caches each segment's decks-over list beside its marks. It sets `shared` on own and carried decks from the lower segment's list, joins the lower segment's gaps between paired crossings, and redraws one ring further: the other tracks over the same lower segment.

**Tech Stack:** TypeScript, Bun (`bun test`), Pixi 8 `Graphics`, `@ue-too/curve` `BCurve`.

**Spec:** `docs/superpowers/specs/2026-10-07-shared-crossing-bridges-design.md`. It builds on the two earlier bridge specs it links to.

## Global Constraints

- **Tooling:**
    - Use Bun only. Tests import from `bun:test`.
    - Never pipe `bun test` into `head`; redirect its output to a file.
- **Formatting:** Prettier (4 spaces, single quotes, trailing comma `es5`). `bun run format:check` must be clean before every commit.
- **Imports:** relative imports in `src/` use `.js`. `src/pixi/` imports model code from `'../index.js'`.
- **No new exports** from the package root or from `track-layout/pixi`. Everything new is internal to `src/pixi/line-track-geometry.ts`, and tests import it from `src/`.
- **`detailed` and previews** draw exactly as today.
- **Constants:**
    - `SHARED_BRIDGE_SPACE = 2` (m).
    - `SHARED_BRIDGE_MIN_APART = 0.5` (m).
    - Same level means within `VERTICAL_CLEARANCE` (3 m).
    - *P* is `parapetOffset(gauge)` = `gauge / 2 + 1.5`.
- **Normals:** a sample's normal is its tangent turned a quarter turn toward +y, so a track laid toward +y has normal (−1, 0), and its `positive` side is −x.
- **Test values:**
    - Renderer tests use the default gauge 1.067:
        - `P = 1.067 / 2 + 1.5` (≈ 2.0335), so tracks share up to `2 * P + 2` (≈ 6.067 m) apart.
        - `GAP = P + 0.5` and `DECK = 1.067 / 2 + 1.5` are the half-lengths at 90°.
        - `W = 1.5 * Math.SQRT1_2` is a wing's reach.
    - Geometry tests set the gauge they need.
    - Compare coordinates with `toBeCloseTo`.
- **Baseline:** `bun test` 646 pass across 49 files; the typecheck is clean. Each task ends with the whole suite passing and the typecheck clean.
- **Git:**
    - Branch `claude/hopeful-hypatia-shf366`. Push it; never force.
    - Conventional commits, each ending with:

      ```
      Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
      Claude-Session: https://claude.ai/code/session_014SPy47W4VtNtgvYEGHPbLV
      ```

    - Don't bump the version or publish.

## Review Focus

1. **The branches of a junction, diverging as they bridge a track** (the owner's screenshot). Both should share one bridge even though their tangents differ. (Task 3: `merges the branches of a junction that diverge over the track`.)
2. **Side-by-side tracks laid in opposite directions.** Their normals point opposite ways, but each must still leave out the side facing the other. (Task 1: `faces each other when laid in opposite directions`; Task 3: `merges tracks laid in opposite directions`.)
3. **The lower track laid after the upper tracks**, as when a road is added under existing line. The pair must still share. (Task 3: `merges decks when the lower track is laid last`.)
4. **Side-by-side tracks of different gauges.** The limit must use each track's own *P*. (Task 1: `uses each track's own parapet offset`.)
5. **Upper tracks that cross each other right over the lower track.** They must not pair and nothing may break: each keeps its own deck. (Task 1: `does not pair crossings under 0.5 m apart`; Task 3: `keeps two decks where the upper tracks cross over the lower track`.)

---

### Task 1: `sharedBridgePairs`

**Files:**
- Modify: `src/pixi/line-track-geometry.ts`: add the constants next to `GAP_CLEARANCE` (~line 33), and the types and function after `crossingMark` (~line 330)
- Test: `test/line-track-geometry.test.ts`, a new `describe('sharedBridgePairs')`
- Modify: `test/pixi-entry.test.ts`: add `'sharedBridgePairs'` to the "keeps the geometry and colour helpers internal" list

**Interfaces:**
- **Produces:**

  ```ts
  export const SHARED_BRIDGE_SPACE = 2;
  export const SHARED_BRIDGE_MIN_APART = 0.5;
  export type OverCrossing = {
      segment: number; point: Point; s: number; normal: Point; gauge: number; height: number;
  };
  export type SharedBridgePair = {
      a: { segment: number; s: number; side: 1 | -1 };
      b: { segment: number; s: number; side: 1 | -1 };
  };
  export function sharedBridgePairs(over: readonly OverCrossing[]): SharedBridgePair[];
  ```

- [ ] **Step 1: Write the failing tests.** Add a helper for a vertical upper track crossing y = 0:

```ts
/** A track laid toward +y crossing the x axis at `x`, one level up, at gauge 1.435. */
const over = (segment: number, x: number, o: Partial<OverCrossing> = {}): OverCrossing => ({
    segment, point: { x, y: 0 }, s: x, normal: { x: -1, y: 0 }, gauge: 1.435, height: 10, ...o,
});
```

- **`pairs two tracks 4 m apart at one level, each facing the other`:**
    - `sharedBridgePairs([over(0, 48), over(1, 52)])` equals
      `[{ a: { segment: 0, s: 48, side: -1 }, b: { segment: 1, s: 52, side: 1 } }]`.
- **`pairs up to 2 m between the parapets`:** P = 0.7175 + 1.5, so the limit is ≈ 6.435.
    - `[over(0, 50), over(1, 56.4)]` gives one pair.
    - `[over(0, 50), over(1, 56.5)]` gives `[]`.
- **`pairs tracks within 3 m of height`:**
    - `over(1, 52, { height: 12.9 })` with `over(0, 48)` gives one pair.
    - `height: 13` gives `[]`.
- **`pairs only neighbours, so the middle of three faces both ways`:**
    - `[over(0, 46), over(1, 50), over(2, 54)]` gives two pairs: `(0, 1)` and `(1, 2)`.
    - Segment 1 has side `1` as `b` in the first and `-1` as `a` in the second.
- **`gives the same pairs whatever the input order`:** `[over(2, 54), over(0, 46), over(1, 50)]` equals the previous result.
- **`judges diverging tracks by where they are closest, from either side`:** at gauge 1.067 the limit is ≈ 6.067.
    - Take `tilted = { x: -Math.cos(r), y: Math.sin(r) }` with `r = 20°` in radians.
    - `[over(0, 50, { gauge: 1.067 }), over(1, 56.2, { gauge: 1.067, normal: tilted })]` gives one pair. Across a it's 6.2 m, across b ≈ 5.83 m.
    - With the normals the other way round, it also gives one pair.
- **`faces each other when laid in opposite directions`** (Review Focus 2):
    - `[over(0, 48), over(1, 52, { normal: { x: 1, y: 0 } })]` gives one pair, with `a.side === -1` and `b.side === -1`.
- **`uses each track's own parapet offset`** (Review Focus 4): with gauges 1.067 and 1.435, the limit is 2.0335 + 2.2175 + 2 = 6.251.
    - `[over(0, 50, { gauge: 1.067 }), over(1, 56.2)]` gives one pair.
    - `[over(0, 50, { gauge: 1.067 }), over(1, 56.3)]` gives `[]`.
- **`does not pair crossings under 0.5 m apart`** (Review Focus 5):
    - `[over(0, 50), over(1, 50.4)]` gives `[]`.

- [ ] **Step 2: Run the tests to confirm they fail.**

Run: `bun test test/line-track-geometry.test.ts > /tmp/t1.log 2>&1; tail -20 /tmp/t1.log`

Expected: FAIL. `sharedBridgePairs` is not exported.

- [ ] **Step 3: Implement**, as the spec's "Which decks share a bridge" says:
    - Sort a copy by `s`, then by `segment`.
    - For each neighbouring pair, with Δ = b.point − a.point, require all three:
        - `|hₐ − h_b| < VERTICAL_CLEARANCE`
        - `|Δ| ≥ SHARED_BRIDGE_MIN_APART`
        - `min(|Δ·Nₐ|, |Δ·N_b|) ≤ parapetOffset(gₐ) + parapetOffset(g_b) + SHARED_BRIDGE_SPACE`
    - The sides are `sign(Δ·Nₐ)` and `sign(−Δ·N_b)`.
    - Doc comments follow the spec's wording.

- [ ] **Step 4: Run the whole suite and the typecheck.**

Run: `bun test > /tmp/t1-all.log 2>&1; tail -5 /tmp/t1-all.log; bun run typecheck`

Expected: 0 fail; the typecheck exits 0.

- [ ] **Step 5: Format and commit.**

```bash
bun run format && bun run format:check
git add src/pixi/line-track-geometry.ts test/line-track-geometry.test.ts test/pixi-entry.test.ts
git commit   # feat(pixi): find side-by-side decks that share a bridge  (+ attribution)
```

---

### Task 2: Leave out shared parapets in `buildLineTrack`

**Files:**
- Modify: `src/pixi/line-track-geometry.ts`:
    - `MarkSpan` (~335-342)
    - `carrySpan` (~381-405)
    - the deck loop at the end of `buildLineTrack` (~801-822)
- Test: `test/line-track-geometry.test.ts`, in the `carrySpan` and `buildLineTrack with spans` describes

**Interfaces:**
- **Consumes:** nothing from Task 1.
- **Produces:**

  ```ts
  // MarkSpan gains:
  shared?: { positive: boolean; negative: boolean };
  export function carrySpan(kind: MarkSpan['kind'], overflow: number, length: number,
      enteringAt: 'start' | 'end', shared?: MarkSpan['shared']): { span: MarkSpan; remaining: number };
  ```

- [ ] **Step 1: Write the failing tests.**
    - The file's `STRAIGHT` runs along +x, so its normal is (0, 1): `positive` is +y.
    - `parapets` (already in the file) picks the strokes with a point at |y| ≈ P; `input()` uses gauge 1.067, so P is the file's `P`.
    - **`carries the shared sides onto a neighbour`:** `carrySpan('deck', 2, 100, 'start', { positive: true, negative: false }).span.shared` equals `{ positive: true, negative: false }`. Without the argument, `span.shared` is `undefined`, and the key is left out, so the existing `toEqual` cases still pass.
    - **`leaves out the parapet on a shared side`:**
        - Input: `marks: [{ kind: 'deck', from: 47, to: 53, wings: { start: true, end: true }, shared: { positive: true, negative: false } }]`.
        - There is one parapet, with `points[1].y ≈ -P`, a first point at x ≈ `47 - W` and a last at x ≈ `53 + W`.
    - **`draws no parapets on a deck shared on both sides`:**
        - With `shared: { positive: true, negative: true }`, `parapets(strokes)` is empty.
        - `xSpans(strokes)` is `[[0, 100]]`: only the centre line.
    - **`draws a shared side only where no shared span covers it`:**
        - Input: `marks: [{ kind: 'deck', from: 40, to: 50, wings: { start: true, end: true }, shared: { positive: true, negative: false } }, { kind: 'deck', from: 45, to: 60, wings: { start: true, end: true } }]`.
        - The negative parapet (y ≈ −P) runs from x ≈ `40 - W` to `60 + W`.
        - The positive parapet (y ≈ P) has a first point at exactly x ≈ 50, with no wing, and a last point at x ≈ `60 + W`.
    - **`draws the same with no side shared`:** `buildLineTrack` with `shared: { positive: false, negative: false }` on a deck equals `buildLineTrack` with the same deck and no `shared` (`toEqual`).

- [ ] **Step 2: Run the tests to confirm they fail.**

Run: `bun test test/line-track-geometry.test.ts > /tmp/t2.log 2>&1; tail -20 /tmp/t2.log`

Expected: FAIL. Both parapets are drawn, and `carrySpan` drops `shared`.

- [ ] **Step 3: Implement.**
    - **`carrySpan`** sets `span.shared` only when the argument is given.
    - **In `buildLineTrack`**, for each merged deck (clamped to `[from, to]`, as today) and each offset in `parapets`:
        - Find the side: `offset > 0` is `positive`.
        - Merge and clamp the deck spans whose `shared?.[side]` is true, as `gapIntervals` does for gaps, and cut them out with `subtractGaps(from, to, …)`.
        - Draw each piece with `parapetStroke`, in the colour of the run at the piece's centre.
        - A piece's start wing is `deck.wings.start` only when the piece starts at `from` (within `EMPTY_INTERVAL`); likewise its end wing.
    - Gaps and `bridge`-preset parapets don't change.

- [ ] **Step 4: Run the whole suite and the typecheck.** Expected: 0 fail; the typecheck exits 0.

- [ ] **Step 5: Format and commit.**

```bash
bun run format && bun run format:check
git add src/pixi/line-track-geometry.ts test/line-track-geometry.test.ts
git commit   # feat(pixi): leave out the parapets a neighbouring deck shares  (+ attribution)
```

---

### Task 3: Share bridges in the renderer

**Files:**
- Modify: `src/pixi/track-render-system.ts`:
    - the `CrossingMarks` type (~125)
    - `_findCrossingMarks` (~962)
    - `_markSpans` (~1010)
    - `_redrawLineNeighbours` (~1253)
    - a new `_sharedSides` beside `_markSpans`
- Test: `test/track-render-system.test.ts`, a new describe after 'marks across joints'

**Interfaces:**
- **Consumes:**
    - Task 1's `OverCrossing`, `sharedBridgePairs` and `SHARED_BRIDGE_MIN_APART`.
    - Task 2's `MarkSpan.shared`.
- **Produces:**

  ```ts
  /** An own mark, with the segment it crosses and the crossing's arc length along that segment. */
  type OwnMark = CrossingMark & { other: number; otherS: number };
  type CrossingMarks = { marks: readonly OwnMark[]; partners: ReadonlySet<number>; over: readonly OverCrossing[] };
  /** The sides of `curveNumber`'s deck `mark` that a neighbour shares; undefined when none. */
  private _sharedSides(curveNumber: number, mark: OwnMark): MarkSpan['shared'] | undefined;
  ```

- [ ] **Step 1: Write the failing tests.** Add `describe('TrackRenderSystem: shared bridges')`, with its body in `for (const style of ['centerline', 'rails'] as const)`, so each test runs in both styles with `renderer.renderStyle = style`. Helpers:

```ts
const GAP = P + 0.5;
const DECK = 1.067 / 2 + 1.5;
const linesOf = (host: RecordingLayerHost, n: number) => strokedLines(host.bandItem(`__simplified__${n}`));
/** A straight upper track across y = 0 at `x`, laid toward +y. */
const upper = (graph: TrackGraph, x: number, elevation = ELEVATION.ABOVE_1) =>
    layLine(graph, { x, y: -50 }, { x, y: 50 }, elevation);
/** The x of each parapet of a vertical track whose centre line is at `x`, sorted. */
const parapetXs = (host: RecordingLayerHost, n: number, x: number) =>
    linesOf(host, n).map(l => l.points[1]!.x).filter(px => Math.abs(Math.abs(px - x) - P) < 1e-6).sort((a, b) => a - b);
/** The lower line's pieces as [min x, max x], one per piece whatever the style. */
const cutsOf = (host: RecordingLayerHost, n: number) => /* xSpans, deduplicated within 1e-6 */;
/** Lines a track draws besides its parapets: 1 in centerline, 2 in rails. */
const LINES = style === 'rails' ? 2 : 1;
```

The lower track is `h = layLine(graph, { x: 0, y: 0 }, { x: 100, y: 0 })` unless a test says otherwise.

- **`draws side-by-side decks as one bridge`:**
    - Upper tracks at 48 and 52.
    - `parapetXs(u1, 48) ≈ [48 - P]` and `parapetXs(u2, 52) ≈ [52 + P]`.
    - Each remaining parapet's first point has y ≈ `-DECK - W` and its last ≈ `DECK + W`.
    - `cutsOf(h) ≈ [[0, 48 - GAP], [52 + GAP, 100]]`.
- **`joins the gaps of a shared bridge`:**
    - Upper tracks at 47.25 and 52.75. That's 5.5 m apart: within 6.067, but more than 2 × GAP.
    - Each draws one parapet.
    - `cutsOf(h) ≈ [[0, 47.25 - GAP], [52.75 + GAP, 100]]`.
- **`keeps decks 8 m apart as two bridges`:**
    - Upper tracks at 46 and 54.
    - Each draws two parapets.
    - `cutsOf(h)` has three pieces.
- **`keeps decks at different levels apart`:**
    - `upper(graph, 48)` and `upper(graph, 52, ELEVATION.ABOVE_2)`.
    - Each draws two parapets.
- **`draws no parapets on the middle of three`:**
    - Upper tracks at 46, 50 and 54.
    - The middle one gives `[]`, the outer ones `[46 - P]` and `[54 + P]`.
    - `cutsOf(h) ≈ [[0, 46 - GAP], [54 + GAP, 100]]`.
- **`brings back the inner parapet when a neighbour is removed`:**
    - The first scene, then `graph.removeTrackSegment(u2)`.
    - `parapetXs(u1, 48) ≈ [48 - P, 48 + P]`.
- **`leaves out the inner parapet when a neighbour is added`:**
    - Lay h and u1; u1 has two parapets.
    - Lay u2; u1 then has `[48 - P]`.
- **`brings back the inner parapet when a neighbour becomes a tunnel or a bridge`:**
    - The first scene, then `graph.setSegmentStyle(u2, { lineStyle: { preset: 'tunnel' } })`: u1 has two parapets.
    - Then `{ preset: 'bridge' }`: u1 still has two.
- **`merges the branches of a junction that diverge over the track`** (Review Focus 1):
    - The joints, all at `ELEVATION.ABOVE_1`:
        - `j0` at (50, −40), tangent (0, 1)
        - `j1` at (50, 20), tangent (0, 1)
        - `j2` at (60, 20), tangent `PointCal.unitVector({ x: 10, y: 30 })`
    - `b1 = connectJoints(j0, j1, [{ x: 50, y: -10 }])` and `b2 = connectJoints(j0, j2, [{ x: 50, y: -10 }])`, each read back with `graph.getJoint(j0)!.connections.get(…)!`. b2 crosses y = 0 at x ≈ 54.44, about 12.5° off b1.
    - Then lay h.
    - `parapetXs(b1, 50) ≈ [50 - P]`.
    - `linesOf(host, b2)` has `LINES + 1` lines.
    - `cutsOf(h)` has two pieces.
- **`merges tracks laid in opposite directions`** (Review Focus 2):
    - `u1 = upper(graph, 48)` and `u2 = layLine(graph, { x: 52, y: 50 }, { x: 52, y: -50 }, ELEVATION.ABOVE_1)`.
    - `[48 - P]` and `[52 + P]`.
- **`merges decks when the lower track is laid last`** (Review Focus 3):
    - Lay u1 (48) and u2 (52), then h.
    - Same parapets and cuts as the first test.
- **`keeps two decks where the upper tracks cross over the lower track`** (Review Focus 5):
    - `layLine(graph, { x: 40, y: -50 }, { x: 60, y: 50 }, ELEVATION.ABOVE_1)` and `layLine(graph, { x: 60, y: -50 }, { x: 40, y: 50 }, ELEVATION.ABOVE_1)` cross each other at (50, 0), on h.
    - Each has `LINES + 2` lines.

- [ ] **Step 2: Run the tests to confirm they fail.**

Run: `bun test test/track-render-system.test.ts > /tmp/t3.log 2>&1; tail -30 /tmp/t3.log`

Expected: the sharing tests FAIL, because each upper track draws two parapets. The 8 m, different-level and crossing tests already pass.

- [ ] **Step 3: Record what the lower track sees.** In `_findCrossingMarks`:
    - Push each mark as `{ ...mark, other: crossing.otherSegment, otherS: other.curve.lengthAtT(crossing.otherT) }`.
    - When the mark is a `gap` and `other.lineStyle?.preset !== 'bridge'`, push an `OverCrossing`:
        - `segment`: `crossing.otherSegment`
        - `point`: `segment.curve.get(crossing.t)`
        - `s`: `mark.s`
        - `normal`: the unit `other.curve.derivative(crossing.otherT)` turned toward +y, as `sampleLine` does
        - `gauge`: `other.gauge`
        - `height`: `heightAt(heightsOf(other), crossing.otherT)`

- [ ] **Step 4: Set shared sides and join gaps.**
    - **`_sharedSides(curveNumber, mark)`:**
        - Read the lower segment `mark.other` from the model; return `undefined` when it's gone.
        - Run `sharedBridgePairs` on `_crossingMarksOf(lower, segment).over`.
        - For each pair side whose `segment === curveNumber` and whose `|s − mark.otherS| < SHARED_BRIDGE_MIN_APART`, set `positive` (side 1) or `negative` (side −1).
        - Return `undefined` when neither is set.
    - **In `_markSpans`:**
        - Each own deck span gets `shared = this._sharedSides(curveNumber, mark)`, left out when `undefined`.
        - Then, for each pair in `sharedBridgePairs(own.over)`, push `{ kind: 'gap', from: a.s, to: b.s, wings: { start: false, end: false } }`.

- [ ] **Step 5: Redraw one ring further.**
    - In `_redrawLineNeighbours`, for each partner `p`, add every `q` in `this._linePartners.get(p)`, and `this._reachOf(q, ends)` with `ends = this._endsOf(q)` when it's not null.
    - `curveNumber` is still deleted from the set before redrawing.
    - Update the method's doc comment to name the new ring.

- [ ] **Step 6: Run the whole suite and the typecheck.** Expected: 0 fail; the typecheck exits 0.

- [ ] **Step 7: Format and commit.**

```bash
bun run format && bun run format:check
git add src/pixi/track-render-system.ts test/track-render-system.test.ts
git commit   # feat(pixi): draw side-by-side crossing decks as one bridge  (+ attribution)
```

---

### Task 4: Carry shared sides across joints; README; verification

**Files:**
- Modify: `src/pixi/track-render-system.ts`: `_carriedSpans` (~1046)
- Modify: `README.md`: the "Render styles" bullet (~159-175)
- Test: `test/track-render-system.test.ts`, in the 'shared bridges' describe

**Interfaces:**
- **Consumes:**
    - Task 3's `OwnMark` and `_sharedSides`.
    - Task 2's `carrySpan(…, shared)`.
- **Produces:** nothing new.

- [ ] **Step 1: Write the failing tests.** For the joint scenes, build each upper track from joints with tangent (0, 1) at `ELEVATION.ABOVE_1`, at (x, −50), (x, 1) and (x, 50), so the deck (half-length `DECK` ≈ 2.03) runs 1.03 m past the joint at y = 1.
    - **`keeps the shared side on a deck carried across a joint`:**
        - Both upper tracks, at 48 and 52, are connected bottom to top: `connectJoints(lowJ, midJ, …)` then `connectJoints(midJ, highJ, …)`.
        - The top segments give `parapetXs ≈ [48 - P]` and `[52 + P]`.
        - Each has a first point at y ≈ 1 and a last at y ≈ `DECK + W`.
    - **`swaps the shared side for a segment laid the other way`:**
        - As above, but u2's top segment is `connectJoints(highJ, midJ, [{ x: 52, y: 25.5 }])`, which runs toward −y.
        - Its `parapetXs` is still `[52 + P]`.
    - **`keeps two decks when a lower-track joint lies between them`** (the spec's known limitation):
        - `layTrack(graph, [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }])` as the lower track, with upper tracks at 48 and 52.
        - Each draws two parapets.
    - **`draws a shared bridge the same after loading a saved layout`:**
        - Build the first test's scene in a source `TrackGraph` and `serialize()` it.
        - `await graph.loadFromSerializedData(saved, { yieldToFrame: async () => {} })` into the scene's graph. The pattern is in 'crossings and runs' (~line 1095).
        - The first test's parapets and cuts.

- [ ] **Step 2: Run the tests to confirm they fail.**

Run: `bun test test/track-render-system.test.ts > /tmp/t4.log 2>&1; tail -30 /tmp/t4.log`

Expected:
- The two carry tests FAIL: the top segments draw both parapets.
- The limitation and load tests already pass. They pin the behaviour.

- [ ] **Step 3: Implement.** In `_carriedSpans`, for a carried `deck` mark of the reached segment `number`:
    - Take `shared = this._sharedSides(number, mark)`.
    - When `facingStart !== (enteringAt === 'end')`, the reached segment runs the other way: swap `positive` and `negative`.
    - Pass it to `carrySpan`. Gaps carry no `shared`.

- [ ] **Step 4: Update the README.** In the "Render styles" line-style text, after "…onto every segment there (all the branches at a junction).", add:

  > Tracks side by side over the same track, at the same level and with no more than 2 m between their parapets, share one bridge: only the outer parapets are drawn, and the gap beneath runs unbroken.

- [ ] **Step 5: Run the full verification.**

Run:

```bash
bun run typecheck && bun test > /tmp/t4-all.log 2>&1; tail -5 /tmp/t4-all.log
bun run format:check && bun run build
```

Expected: the typecheck exits 0, 0 tests fail, and the format check and build are clean.

- [ ] **Step 6: Commit and push.**

```bash
git add src/pixi/track-render-system.ts test/track-render-system.test.ts README.md
git commit   # feat(pixi): keep a shared bridge's sides across joints  (+ attribution)
git push -u origin claude/hopeful-hypatia-shf366
```
