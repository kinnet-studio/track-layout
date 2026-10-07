# Bridges and gaps across joints, and a gap clearance option: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decks and gaps continue across joints instead of stopping at a segment end, and apps can set how far a gap reaches past the upper track's parapets.

**Architecture:**
- The pure geometry module's marks become explicit spans (`MarkSpan`) with wing flags. Two helpers clamp a mark to its segment (`markSpan`) and carry an overflow onto a neighbour (`carrySpan`).
- `TrackRenderSystem` builds each segment's spans from its own crossings, plus the overflow pulled from segments within 25 m along its joints.
- Redraws reach those segments too.
- A `bridgeGapClearance` option feeds `crossingMark`.

**Tech Stack:** TypeScript, Bun (`bun test`), Pixi 8 `Graphics`, `@ue-too/curve` `BCurve`.

**Spec:** `docs/superpowers/specs/2026-10-07-joint-carry-over-and-gap-clearance-design.md`. It builds on `docs/superpowers/specs/2026-10-07-line-style-bridges-tunnels-design.md`.

## Global Constraints

- **Tooling:**
    - Use Bun only. Tests import from `bun:test`.
    - Never pipe `bun test` into `head`; redirect its output to a file.
- **Formatting:** Prettier with 4 spaces, single quotes and trailing comma `es5`. `bun run format:check` must be clean before every commit.
- **Imports:** relative imports in `src/` use `.js`. `src/pixi/` imports model code from `'../index.js'`, and never imports `@ue-too/being`.
- **No new exports** from the package root or from `track-layout/pixi`. `MarkSpan`, `markSpan` and `carrySpan` are internal, so tests import them from `src/`.
- **`detailed`:** what it draws doesn't change, and previews still get no crossing marks.
- **Constants:**
    - `MAX_MARK_HALF_LENGTH` is 25 m: the cap on a mark and on the walk along joints.
    - `GAP_CLEARANCE` is 0.5: the default `bridgeGapClearance`.
    - `bridgeGapClearance` is clamped to [0, 25], and a non-finite value is ignored.
- **Test values:**
    - `P = 1.067 / 2 + 1.5` is the parapet offset at the default gauge.
    - `GAP = P + 0.5` and `DECK = 1.067 / 2 + 1.5` are the half-lengths at 90°.
    - `W = 1.5 * Math.SQRT1_2` is a wing's reach.
- **Points in tests:** compare coordinates with `toBeCloseTo`.
- **Baseline:** `bun test` 596 pass, and the typecheck is clean. Each task ends with the whole suite passing and the typecheck clean.
- **Git:**
    - Branch `claude/bridge-underground-track-render-3rg5de` (its history holds the merged 0.8.0 work). Push it, never force.
    - Conventional commits, each ending with:

      ```
      Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
      Claude-Session: https://claude.ai/code/session_01BPEoTwHcBwykxbH38mcaXN
      ```

    - Don't bump the version or publish.

## Review Focus

1. **The lower track laid after the upper one.** The neighbour's carried gap must still appear, since spans are pulled when each segment is drawn. (Task 2: `carries a gap onto track laid after the crossing`.)
2. **The lower segment split near the crossing.** The two new halves must show one gap across the new joint. (Task 2: `keeps one gap when the lower segment is split near the crossing`.)
3. **A loop of track near a crossing.** The walk along joints must stop. (Task 2: `stops walking at a loop of track`.)
4. **A crossing exactly at a joint.** Both segments must be cut once, with no stub and no doubled marks. (Task 2: `cuts both segments once at a crossing on the joint`.)
5. **Changing the clearance while a gap is carried.** The neighbour must be redrawn too. (Task 3: `redraws carried gaps when the clearance changes`.)

---

### Task 1: Spans in the geometry, and the gap clearance in `crossingMark`

**Files:**
- Modify: `src/pixi/line-track-geometry.ts`:
    - `CrossingMark` and `crossingMark` (lines 262-319)
    - `LineTrackInput.marks` (line 361)
    - `mergedSpans` and `gapIntervals` (523-560)
    - the gap and deck handling in `buildLineTrack` (from 638 on)
- Modify: `src/pixi/track-render-system.ts`. Where `_lineInputFor` passes `marks: this._crossingMarks(...)` (~787), pass `marks.map(mark => markSpan(mark, segment.curve.fullLength).span)` instead, so behaviour is unchanged.
- Modify: `test/line-track-geometry.test.ts`: existing mark-based cases go through `markSpan`; new cases are added.
- Modify: `test/pixi-entry.test.ts`: add `'markSpan'` and `'carrySpan'` to the "keeps the geometry and colour helpers internal" list.

**Interfaces:**
- **Produces:**

  ```ts
  export type MarkSpan = {
      kind: 'deck' | 'gap';
      from: number;
      to: number;
      wings: { start: boolean; end: boolean }; // decks only
  };
  export function markSpan(mark: CrossingMark, length: number):
      { span: MarkSpan; overflow: { start: number; end: number } };
  export function carrySpan(kind: MarkSpan['kind'], overflow: number, length: number,
      enteringAt: 'start' | 'end'): { span: MarkSpan; remaining: number };
  export function crossingMark(self, other, terrain, renderStyle, gapClearance?: number): CrossingMark | null;
  // LineTrackInput.marks?: MarkSpan[]   (was CrossingMark[])
  ```

- [ ] **Step 1: Write the failing tests.**
    - At the top of the geometry test file, add `const spans = (...marks: CrossingMark[]) => marks.map(mark => markSpan(mark, 100).span);`.
    - Change every existing `marks: [ … ]` input to `marks: spans( … )`, keeping each assertion as it is.
    - Add:

```ts
describe('markSpan', () => {
    it('keeps a mark inside the segment whole, with wings at both ends', () => {
        expect(markSpan({ kind: 'deck', s: 50, halfLength: 3 }, 100)).toEqual({
            span: { kind: 'deck', from: 47, to: 53, wings: { start: true, end: true } },
            overflow: { start: 0, end: 0 },
        });
    });
    it('clamps a mark past either end and reports the overflow, with no wing there', () => {
        const atStart = markSpan({ kind: 'deck', s: 1, halfLength: 3 }, 100);
        expect(atStart.span).toMatchObject({ from: 0, to: 4, wings: { start: false, end: true } });
        expect(atStart.overflow.start).toBeCloseTo(2, 9);
        const atEnd = markSpan({ kind: 'gap', s: 99, halfLength: 3 }, 100);
        expect(atEnd.span).toMatchObject({ from: 96, to: 100 });
        expect(atEnd.overflow.end).toBeCloseTo(2, 9);
    });
});

describe('carrySpan', () => {
    it('carries an overflow onto the start or end of a neighbour, with a wing at the far side', () => {
        expect(carrySpan('deck', 2, 100, 'start')).toEqual({
            span: { kind: 'deck', from: 0, to: 2, wings: { start: false, end: true } },
            remaining: 0,
        });
        expect(carrySpan('deck', 2, 100, 'end')).toEqual({
            span: { kind: 'deck', from: 98, to: 100, wings: { start: true, end: false } },
            remaining: 0,
        });
    });
    it('covers a neighbour shorter than the overflow and passes the rest on, with no far wing', () => {
        expect(carrySpan('gap', 7, 5, 'start')).toEqual({
            span: { kind: 'gap', from: 0, to: 5, wings: { start: false, end: false } },
            remaining: 2,
        });
    });
});

describe('buildLineTrack with spans', () => {
    it('cuts a gap span that starts at the segment start from 0', () => {
        const drawing = buildLineTrack(input({
            marks: [{ kind: 'gap', from: 0, to: 2, wings: { start: false, end: false } }],
        }));
        expectSpans(xSpans(drawing.strokes), [[2, 100]]);
    });
    it('draws no wing where a deck span says so', () => {
        const drawing = buildLineTrack(input({
            marks: [{ kind: 'deck', from: 0, to: 4, wings: { start: false, end: true } }],
        }));
        const parapets = drawing.strokes.filter(s => Math.abs(Math.abs(s.points[1]!.y) - P) < 1e-6);
        expect(parapets).toHaveLength(2);
        for (const p of parapets) {
            expect(p.points[0]!.x).toBeCloseTo(0, 6);
            expect(p.points.at(-1)!.x).toBeCloseTo(4 + W, 6);
        }
    });
    it('merges an own and a carried deck span, keeping their outer wing flags', () => {
        const drawing = buildLineTrack(input({
            marks: [
                { kind: 'deck', from: 95, to: 100, wings: { start: true, end: false } },
                { kind: 'deck', from: 97, to: 100, wings: { start: false, end: false } },
            ],
        }));
        const parapets = drawing.strokes.filter(s => Math.abs(Math.abs(s.points[1]!.y) - P) < 1e-6);
        expect(parapets).toHaveLength(2);
        for (const p of parapets) {
            expect(p.points[0]!.x).toBeCloseTo(95 - W, 6);
            expect(p.points.at(-1)!.x).toBeCloseTo(100, 6);
        }
    });
});

it('takes the gap clearance into crossingMark', () => {
    const under = side(H, 0), over = side(V, 10);
    expect(crossingMark(under, over, null, 'centerline', 0)!.halfLength).toBeCloseTo(P, 6);
    expect(crossingMark(under, over, null, 'centerline', 3)!.halfLength).toBeCloseTo(P + 3, 6);
    expect(crossingMark(under, over, null, 'centerline')!.halfLength).toBeCloseTo(P + 0.5, 6);
});
```

`H`, `V` and `side` already exist in the file (Task 4 of the 0.8.0 plan). The `parapets` filter matches |y| ≈ P, so it never picks up the centreline at y = 0.

- [ ] **Step 2: Run the tests to confirm they fail.**

Run: `bun test test/line-track-geometry.test.ts > /tmp/t1.log 2>&1; tail -20 /tmp/t1.log`

Expected: FAIL. `markSpan` is not exported.

- [ ] **Step 3: Implement.**
    - **`markSpan`:**
        - `from = max(0, s − L)` and `to = min(length, s + L)`.
        - `overflow.start = max(0, L − s)` and `overflow.end = max(0, s + L − length)`.
        - `wings.start = overflow.start === 0` and `wings.end = overflow.end === 0`.
    - **`carrySpan`:**
        - Entering at `'start'`, the span is `[0, min(overflow, length)]`. Entering at `'end'`, it is `[max(0, length − overflow), length]`.
        - `remaining = max(0, overflow − length)`.
        - The entry-side wing is false. The far wing is `remaining === 0`.
    - **`crossingMark`:** the new last parameter `gapClearance = GAP_CLEARANCE` replaces `GAP_CLEARANCE` in the gap formula.
    - **`mergedSpans`:**
        - It now takes `MarkSpan[]` and a kind, and returns merged spans with wings: sort by `from`, and merge when `next.from <= last.to`.
        - A merged span takes its start wing from the span with the smallest `from` (on a tie, OR the flags), and its end wing from the span with the largest `to` (same tie rule).
        - `gapIntervals` clamps as before.
    - **The deck loop** draws each merged deck span with `parapetStroke(..., wings, ...)` using the span's own `wings`, clamped to `[0, length]`. Drop the `rawFrom > 0` / `rawTo < length` wing logic.

- [ ] **Step 4: Run the geometry tests, the whole suite and the typecheck.**

Run: `bun test > /tmp/t1-all.log 2>&1; tail -5 /tmp/t1-all.log; bun run typecheck`

Expected: 0 fail; the typecheck exits 0.

- [ ] **Step 5: Format and commit.**

```bash
bun run format && bun run format:check
git add src/pixi test
git commit   # refactor(pixi): draw decks and gaps from spans; take the gap clearance  (+ attribution)
```

---

### Task 2: Carry marks across joints in the renderer

**Files:**
- Modify: `src/pixi/track-render-system.ts`:
    - `_crossingMarks` (~800-849) splits into `_crossingMarksOf` and `_markSpans`
    - `_lineInputFor` (~767-795)
    - `_redrawLineNeighbours` (~916-932)
    - `_forgetLineSegment` (~2368-2382)
- Test: `test/track-render-system.test.ts`, in a new `describe('TrackRenderSystem: marks across joints')`

**Interfaces:**
- **Consumes:** Task 1's `MarkSpan`, `markSpan`, `carrySpan`, and `crossingMark(…, gapClearance)`. Pass `GAP_CLEARANCE` for now; Task 3 swaps in the option.
- **Produces:**

  ```ts
  private _crossingMarksOf(curveNumber: number, segment: TrackSegmentWithCollision): { marks: CrossingMark[]; partners: Set<number> };
  private _markSpans(curveNumber: number, segment: TrackSegmentWithCollision, ends: LineTrackRecord['ends']): MarkSpan[]; // also records partners
  private _reachOf(curveNumber: number, ends: LineTrackRecord['ends']): number[];  // segments within MAX_MARK_HALF_LENGTH along joints
  ```

- [ ] **Step 1: Write the failing tests.** They live in a new describe that uses `layTrack`, `layLine`, `linesOf`/`xSpans` (copied into this describe), and the module-level `P` and `W`.

```ts
const GAP = P + 0.5;
const DECK = 1.067 / 2 + 1.5;
const xSpans = /* as in 'crossings and runs' */;
const linesOf = (host: RecordingLayerHost, n: number) => strokedLines(host.bandItem(`__simplified__${n}`));
const parapetsOf = (lines: StrokedLine[]) => lines.filter(l => Math.abs(Math.abs(l.points[1]!.y) - P) < 1e-6);
```

- **`carries a gap across the joint onto the next segment`:**
    - `layTrack(graph, [{0,0},{100,0},{200,0}])` (segments 0, 1).
    - `layLine(graph, {99,-50}, {99,50}, ELEVATION.ABOVE_1)`.
    - `xSpans(linesOf(host, 0))` is close to `[[0, 99 - GAP]]`, and `xSpans(linesOf(host, 1))` to `[[99 + GAP, 200]]`.
- **`carries a deck across the joint, with wings only at its true ends`:**
    - `layTrack(graph, [{0,0},{100,0},{200,0}], ELEVATION.ABOVE_1)`.
    - `layLine(graph, {99,-50}, {99,50})`.
    - Segment 0's two parapets run from `points[0].x ≈ 99 - DECK - W` to a last point `x ≈ 100`.
    - Segment 1's two parapets run from `points[0].x ≈ 100` to a last point `x ≈ 99 + DECK + W`.
- **`carries a gap onto every branch at a junction`:**
    - Joints A(0,0), B(100,0), C(200,0) and D(200,60), each with tangent (1,0).
    - `connectJoints(A,B,[{50,0}])`, `(B,C,[{150,0}])` and `(B,D,[{150,0}])`.
    - An upper `layLine` at x = 99 (ABOVE_1).
    - B–C's line has min x ≈ `99 + GAP`. B–D's has min x within 0.1 of `99 + GAP`.
- **`chains a gap across a short segment`:**
    - `layTrack(graph, [{0,0},{100,0},{105,0},{200,0}])` (segments 0, 1, 2).
    - An upper straight line through (99, 0) at 20°, ABOVE_1, from `(99 - 50cos20°, -50sin20°)` to `(99 + 50cos20°, 50sin20°)`.
    - With `L = (P + 0.5) / Math.sin(20° in rad)`:
        - segment 0 ends at `99 - L`
        - segment 1 draws no strokes
        - segment 2 starts at `99 + L`
- **`ends a deck at an open end with a wing`:**
    - One upper segment, `layTrack(graph, [{0,0},{100,0}], ELEVATION.ABOVE_1)`, and `layLine(graph, {99,-50}, {99,50})`.
    - Segment 0's parapets end at x ≈ `100 + W`.
- **`restores both sides of the joint when the upper track is removed`:**
    - The first scene, then `graph.removeTrackSegment(upper)`.
    - The spans are `[[0, 100]]` and `[[100, 200]]`.
- **`draws carried gaps after loading a saved layout`:**
    - The first scene is serialized from a source graph and loaded with `loadFromSerializedData(saved, { yieldToFrame: async () => {} })` into the scene's graph (centerline).
    - The spans are the same as in the first test.
- **`carries a gap onto track laid after the crossing`** (Review Focus 1):
    - Lay segment 0 (0→100) and the upper track at x = 99 first, then lay segment 1 from the joint.
    - `layTrack` makes new joints, so build segment 1 with `graph.connectJoints(joints[1], newJoint, [mid])`, where `joints` comes from the first `layTrack`.
    - Segment 1 starts at `99 + GAP`.
- **`keeps one gap when the lower segment is split near the crossing`** (Review Focus 2):
    - `layTrack(graph, [{0,0},{200,0}])`, an upper track at x = 99, then `graph.insertJointIntoTrackSegmentUsingTrackNumber(0, 0.5)`.
    - Of the two living lower segments, the one starting at x = 0 ends at `99 - GAP`, and the other starts at `99 + GAP`.
- **`stops walking at a loop of track`** (Review Focus 3):
    - A triangle: joints (95,0), (105,0) and (100,-8). Connect (95,0)–(105,0) via (100,0), (105,0)–(100,-8) via (102.5,-4), and (100,-8)–(95,0) via (97.5,-4). All three `connectJoints` return true.
    - An upper `layLine(graph, {96,5}, {96,-1}, ELEVATION.ABOVE_1)`, which crosses only the first side.
    - The scene draws without hanging, and the first side's line starts at `96 + GAP`.
- **`cuts both segments once at a crossing on the joint`** (Review Focus 4):
    - `layTrack` 0→100→200, and an upper track at x = 100.
    - Segment 0 is `[[0, 100 - GAP]]` and segment 1 is `[[100 + GAP, 200]]`.

- [ ] **Step 2: Run the tests to confirm they fail.**

Run: `bun test test/track-render-system.test.ts > /tmp/t2.log 2>&1; tail -30 /tmp/t2.log`

Expected: the carry tests FAIL (segment 1 starts at 100). The open-end wing test also fails, because there's no wing at a clamped end today.

- [ ] **Step 3: Split `_crossingMarks`.**
    - **`_crossingMarksOf`** returns the own crossing marks and the partner set, with no bookkeeping.
    - **`_markSpans`:**
        - Calls `_crossingMarksOf` and records the partners in `_linePartners` both ways, as `_crossingMarks` did.
        - Then for each own mark, `markSpan(mark, length)`. At an end with overflow, set that end's deck wing to true only when `getSegmentsAtJoint(end.joint, end.position)` has no segment other than `curveNumber` (an open end).
        - Then it appends the carried spans (Step 4).
        - `_lineInputFor` passes `marks: this._markSpans(curveNumber, segment, ends)`.

- [ ] **Step 4: Carry spans from the joints.** For each end `e` of `curveNumber` (`'start'` for `ends[0]`, `'end'` for `ends[1]`), walk:

```text
visited = { curveNumber }
queue   = [{ joint: e.joint, position: e.position, distance: 0 }]
while queue not empty:
  { joint, position, distance } = queue.shift()
  for m in getSegmentsAtJoint(joint, position) not in visited:
    visited.add(m); seg = getTrackSegmentWithJoints(m); if null continue
    facingStart = seg.t0Joint === joint            // m's end toward us
    for mark in _crossingMarksOf(m, seg).marks:
      o = markSpan(mark, seg.curve.fullLength).overflow[facingStart ? 'start' : 'end']
      if o > distance:
        { span, remaining } = carrySpan(mark.kind, o - distance, length, e side)
        if remaining > 0 and the far end of curveNumber is an open end: span's far wing = true
        push span
    next = distance + seg.curve.fullLength
    if next < MAX_MARK_HALF_LENGTH:
      queue.push({ the joint and position at m's other end, distance: next })
```

`_reachOf(curveNumber, ends)` is the same walk, returning every `m` it visits and computing no marks.

- [ ] **Step 5: Widen the redraws.**
    - `_redrawLineNeighbours(curveNumber, partners, ends)` adds `_reachOf(curveNumber, ends)`, plus `_reachOf(p, endsOf(p))` for each partner `p`. `endsOf(p)` is the record's `ends`, or `lineEndsOf` of the model segment.
    - `_forgetLineSegment` goes through it with the removed segment's recorded `ends`, as today.
    - Only segments with a record are redrawn, as today.

- [ ] **Step 6: Run the renderer tests, the whole suite and the typecheck.** Expected: 0 fail; the typecheck exits 0.

- [ ] **Step 7: Format and commit.**

```bash
bun run format && bun run format:check
git add src/pixi/track-render-system.ts test/track-render-system.test.ts
git commit   # feat(pixi): carry decks and gaps across joints  (+ attribution)
```

---

### Task 3: The `bridgeGapClearance` option, README and verification

**Files:**
- Modify: `src/pixi/track-render-system.ts`:
    - `TrackRenderSystemOptions` (~172-188)
    - the constructor (~397)
    - a `bridgeGapClearance` getter and setter next to `renderStyle` (~600-615)
    - `_crossingMarksOf`, which passes the option to `crossingMark`
- Modify: `README.md`, the "Render styles" bullet (~159-180)
- Test: `test/track-render-system.test.ts`

**Interfaces:**
- **Consumes:** Task 2's `_crossingMarksOf` and `_redrawLineSegment`.
- **Produces:** `TrackRenderSystemOptions.bridgeGapClearance?: number`, and `get/set bridgeGapClearance(metres: number)` on `TrackRenderSystem`.

- [ ] **Step 1: Write the failing tests** (in the 'marks across joints' describe):
    - **`takes the gap clearance from its options`:** `scene({ bridgeGapClearance: 3 })`, centerline, the `crossing` scene at x = 50. h's spans end at `50 - (P + 3)` and start at `50 + (P + 3)`.
    - **`redraws gaps in place when the clearance changes`:**
        - At the default, set `renderer.bridgeGapClearance = 0`.
        - The spans are at `50 ± P`, and `host.bandItem('__simplified__0')` is the same object as before.
    - **`redraws carried gaps when the clearance changes`** (Review Focus 5): in the gap-across-the-joint scene, setting 3 makes segment 1 start at `99 + P + 3`.
    - **`keeps the clearance across render-style switches`:** set 2, switch to `'rails'` then `'centerline'`, and h's gap is `50 ± (P + 2)`.
    - **`clamps the clearance and ignores a non-number`:**
        - `renderer.bridgeGapClearance = -1` gives a getter of 0.
        - `99` gives 25.
        - `NaN` leaves it at 25.
    - **`changes nothing in detailed`:** in `detailed`, setting 3 leaves `host.bandKeys` unchanged.

- [ ] **Step 2: Run the tests to confirm they fail.**

Run: `bun test test/track-render-system.test.ts > /tmp/t3.log 2>&1; tail -20 /tmp/t3.log`

Expected: FAIL (an unknown option or property).

- [ ] **Step 3: Implement.**
    - A private `_bridgeGapClearance = GAP_CLEARANCE`, set from the option through the same clamp as the setter.
    - **The setter:**
        - Ignores non-finite values and clamps to [0, `MAX_MARK_HALF_LENGTH`].
        - Returns if the value is unchanged.
        - Otherwise, in a line style, it calls `_redrawLineSegment` for every key in `_lineTracks`.
    - `_crossingMarksOf` passes `this._bridgeGapClearance` to `crossingMark`.
    - A doc comment on the option says it is metres past the upper track's parapets, default 0.5, clamped to [0, 25].

- [ ] **Step 4: Update the README.** In the "Render styles" line-style text:
    - add "A deck or gap near a joint carries on across it, onto every segment there (all the branches at a junction)".
    - add a sub-bullet: "`bridgeGapClearance` (option and property): how far, in metres, a gap reaches past the upper track's parapets; 0.5 by default, from 0 to 25."

- [ ] **Step 5: Run the full verification.**

Run:

```bash
bun run typecheck && bun test > /tmp/t3-all.log 2>&1; tail -5 /tmp/t3-all.log
bun run format:check && bun run build
```

Expected: the typecheck exits 0, 0 tests fail, and the format check and build are clean.

- [ ] **Step 6: Commit and push.**

```bash
git add src/pixi/track-render-system.ts test/track-render-system.test.ts README.md
git commit   # feat(pixi): add a bridgeGapClearance option  (+ attribution)
git push -u origin claude/bridge-underground-track-render-3rg5de
```
