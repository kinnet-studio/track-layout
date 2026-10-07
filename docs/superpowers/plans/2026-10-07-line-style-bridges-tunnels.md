# Line-style bridges, tunnels and per-segment line styles: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `centerline` and `rails` track styles draw bridges at grade-separated crossings, underground track as lighter broken lines with tunnel portals, and a saved per-segment `lineStyle`.

**Architecture:**
- The model gains a saved `lineStyle` segment style field and two read-only queries, `getCrossings` and `getSegmentsAtJoint`.
- A pure module, `src/pixi/line-track-geometry.ts`, turns one segment's samples, heights, terrain, style, crossing marks and run ends into coloured polylines.
- `TrackRenderSystem` strokes those polylines. It keeps a partner map so that adding, removing or restyling a segment redraws the tracks it crosses and the preset tracks beside it.

**Tech Stack:** TypeScript, Bun (`bun test`), Pixi 8 `Graphics`, `@ue-too/curve` `BCurve`.

**Spec:** `docs/superpowers/specs/2026-10-07-line-style-bridges-tunnels-design.md`. Read it with this plan. Every constant and formula below comes from it.

## Global Constraints

- **Tooling:**
    - Use Bun only. Tests import from `bun:test`.
    - Never pipe `bun test` into `head`; redirect its output to a file and read the file.
- **Formatting:** Prettier with 4 spaces, single quotes and trailing comma `es5`. `bun run format:check` must be clean before every commit.
- **Imports:**
    - Relative imports in `src/` use a `.js` extension. Keep `moduleResolution: bundler`.
    - Files in `src/pixi/` import model code from `'../index.js'`.
- **Dependencies:** none new. The `@ue-too/*` packages stay peers at `^0.19.0`.
- **`src/pixi/` import rules:** it must not import `@ue-too/being`. Outside `src/pixi/`, it may import only the type-only modules allowed by `test/pixi-entry.test.ts`.
- **`detailed` style:** what it draws must not change. That includes its zoomed-out Bezier line and its `__underground__N` overlay.
- **Points in tests:** points from the curve engine carry `z: 0`. Compare coordinates with `toBeCloseTo`, never compare points with `toEqual`.
- **Baseline:** `bun test` is 503 pass, 0 fail; `bun run typecheck` is clean. Every task ends with the whole suite passing and the typecheck clean.
- **Git:**
    - Branch `claude/bridge-underground-track-render-3rg5de`.
    - Conventional commits scoped to the area, each ending with:

      ```
      Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
      Claude-Session: https://claude.ai/code/session_01BPEoTwHcBwykxbH38mcaXN
      ```

    - Don't publish or bump the version; the owner releases 0.8.0.
- **Constants from the spec:**

  | constant                | value     | constant              | value       |
  | ----------------------- | --------- | --------------------- | ----------- |
  | `PARAPET_MARGIN`        | 1.5       | `CROSSING_MERGE_T`    | 0.05        |
  | `MARK_LENGTH`           | 1.5       | `JOINT_TOUCH_DISTANCE`| 0.5         |
  | `MARK_ANGLE`            | π/4       | `CROSSING_MIN_SIN`    | 0.02        |
  | `DECK_CLEARANCE`        | 1.5       | `MAX_PATTERN_REPEATS` | 4000        |
  | `GAP_CLEARANCE`         | 0.5       | `RESTROKE_ZOOM_STEP`  | `Math.SQRT2`|
  | `MAX_MARK_HALF_LENGTH`  | 25        | `UNDERGROUND_LIGHTEN` | 0.5         |
  | `LINE_TRACK_SAMPLE_LEN` | 2         |                       |             |

## Review Focus

1. **Loading a saved layout that has crossings.** Segments arrive in save order, and a partner may not be drawn yet. Every gap and deck must still be there afterwards. (Task 6: `draws bridges after loading a saved layout`.)
2. **Switching render styles back and forth with crossings present.** The partner map and records are rebuilt, with no stale gaps or missing decks. (Task 6: `keeps bridges right across render-style switches`.)
3. **Deleting a track that crossed two others.** Both must be redrawn unbroken. (Task 6: `restores every track a deleted upper track crossed`.)
4. **A track that crosses the same track twice.** It must get two gaps, not one. (Task 2: `reports two crossings with the same track, sorted by t`; Task 6: `cuts a gap at each of two crossings`.)
5. **Zooming far in on a long patterned or underground segment.** The dash count must stay bounded. (Task 3: `caps the repeats on a very long interval`.)

---

### Task 1: The saved `lineStyle` segment style field

**Files:**
- Modify: `src/tracks/types.ts`:
    - add the types after `ELEVATION_MAX`, around line 30
    - add the fields to `TrackSegment` (32–53), `TrackSegmentDrawData` (86–117) and `SerializedTrackSegment` (214–229)
    - add the validation after the `bedWidth` check in `validateSerializedTrackData`, around line 434
- Modify: `src/tracks/segment-style.ts` (whole file: types, copies, `STYLE_KEYS`, `applyStylePatch`)
- Modify: `src/tracks/utils.ts:262`, the draw-data literal in `makeTrackSegmentDrawDataFromSplit`
- Modify: `src/tracks/trackcurve-manager.ts`:
    - `setNewSegmentStyle` (127–138)
    - `serialize` (around 1160–1180)
    - `deserialize` (around 1416)
- Modify: `src/tracks/track.ts:1428`, the style argument in `loadFromSerializedData`
- Test: `test/segment-line-style.test.ts` (new)

**Interfaces:**
- **Produces** (from the package root, through `types.js` and `segment-style.js`):

  ```ts
  export const LINE_PRESETS = ['tunnel', 'bridge', 'planned', 'disused'] as const;
  export type LinePreset = (typeof LINE_PRESETS)[number];
  export const LINE_PATTERNS = ['solid', 'dashed', 'dotted', 'dash-dot'] as const;
  export type LinePattern = (typeof LINE_PATTERNS)[number];
  export type TrackLineStyle = { preset?: LinePreset; pattern?: LinePattern; color?: number; width?: number };
  // segment-style.ts
  export function normalizeLineStyle(style: TrackLineStyle | undefined): TrackLineStyle | undefined;
  ```

- `TrackSegment.lineStyle?`, `TrackSegmentDrawData.lineStyle?`, `SerializedTrackSegment.lineStyle?`, `SegmentStyle.lineStyle?`, and `'lineStyle'` in `SegmentStyleFields`.

- [ ] **Step 1: Write the failing tests** in `test/segment-line-style.test.ts`.
    - Use a local `layStraight(graph, x0 = 0, y = 0)` that returns the segment number, copied from `test/segment-style.test.ts:19-24`.
    - Use a local `withLineStyle(value: unknown)` that builds a save and sets `saved.segments[0].lineStyle = value`, as `withBedWidth` does in `test/segment-style.test.ts:334-340`.

```ts
describe('normalizeLineStyle', () => {
    it('drops unset fields and returns a copy', () => {
        const style = { preset: 'planned' as const, color: undefined };
        const out = normalizeLineStyle(style)!;
        expect(out).toEqual({ preset: 'planned' });
        expect('color' in out).toBe(false);
        expect(out).not.toBe(style);
    });
    it('is undefined for no style and for a style with no fields', () => {
        expect(normalizeLineStyle(undefined)).toBeUndefined();
        expect(normalizeLineStyle({})).toBeUndefined();
        expect(normalizeLineStyle({ width: undefined })).toBeUndefined();
    });
});

describe('applyStylePatch lineStyle', () => {
    const current = { lineStyle: { preset: 'disused' as const, color: 0xff0000 } };
    it('replaces the whole line style', () => {
        expect(applyStylePatch(current, { lineStyle: { pattern: 'dotted' } }).lineStyle)
            .toEqual({ pattern: 'dotted' });
    });
    it('clears it with undefined or an empty style', () => {
        for (const lineStyle of [undefined, {}]) {
            expect(applyStylePatch(current, { lineStyle }).lineStyle).toBeUndefined();
        }
    });
    it('keeps it when the patch has no lineStyle key', () => {
        expect(applyStylePatch(current, { bed: true }).lineStyle).toEqual(current.lineStyle);
    });
});

it('styleFieldsOf copies the line style', () => {
    const source = { lineStyle: { color: 0xff0000 } };
    const copy = styleFieldsOf(source);
    source.lineStyle.color = 1;
    expect(copy.lineStyle).toEqual({ color: 0xff0000 });
});

describe('setNewSegmentStyle lineStyle', () => {
    it('lays new track with it, keeps it through other changes, and clears it', () => {
        const graph = new TrackGraph();
        graph.setNewSegmentStyle({ lineStyle: { preset: 'tunnel' } });
        const n = layStraight(graph);
        expect(graph.getTrackSegmentWithJoints(n)!.lineStyle).toEqual({ preset: 'tunnel' });
        graph.setNewSegmentStyle({ bed: true });
        expect(graph.newSegmentStyle.lineStyle).toEqual({ preset: 'tunnel' });
        graph.setNewSegmentStyle({ lineStyle: undefined });
        expect(graph.newSegmentStyle.lineStyle).toBeUndefined();
    });
});

it('setSegmentStyle puts it on the segment, its pieces and the event', () => {
    const graph = new TrackGraph();
    const n = layStraight(graph);
    const changes: SegmentStyleChange[] = [];
    graph.onSegmentStyleChanged(change => changes.push(change));
    const lineStyle = { pattern: 'dash-dot' as const, color: 0x2266cc };
    graph.setSegmentStyle(n, { lineStyle });
    expect(changes[0]!.style.lineStyle).toEqual(lineStyle);
    expect(graph.getTrackSegmentWithJoints(n)!.lineStyle).toEqual(lineStyle);
    const pieces = graph.trackCurveManager.persistedDrawData.filter(
        d => d.originalTrackSegment.trackSegmentNumber === n
    );
    expect(pieces.length).toBeGreaterThan(0);
    for (const piece of pieces) expect(piece.lineStyle).toEqual(lineStyle);
});

describe('saving and loading lineStyle', () => {
    it('writes it only when set, and loads it back', async () => {
        const graph = new TrackGraph();
        const styled = layStraight(graph, 0);
        const plain = layStraight(graph, 0, 50); // y = 50, clear of the first
        graph.setSegmentStyle(styled, { lineStyle: { preset: 'bridge', width: 2 } });
        const saved = JSON.parse(JSON.stringify(graph.serialize()));
        const bySegment = (n: number) => saved.segments.find((s: { segmentNumber: number }) => s.segmentNumber === n);
        expect(bySegment(styled).lineStyle).toEqual({ preset: 'bridge', width: 2 });
        expect('lineStyle' in bySegment(plain)).toBe(false);

        const loaded = new TrackGraph();
        await loaded.loadFromSerializedData(saved, { yieldToFrame: async () => {} });
        expect(loaded.getTrackSegmentWithJoints(styled)!.lineStyle).toEqual({ preset: 'bridge', width: 2 });
        expect(loaded.getTrackSegmentWithJoints(plain)!.lineStyle).toBeUndefined();
        expect(TrackCurveManager.deserialize(saved.segments).getTrackSegmentWithJoints(styled)!.lineStyle)
            .toEqual({ preset: 'bridge', width: 2 });
    });
});

describe('validateSerializedTrackData lineStyle', () => {
    it('accepts a full style and an empty one', () => {
        for (const ok of [{ preset: 'bridge', pattern: 'dash-dot', color: 0xffffff, width: 8 }, {}]) {
            expect(validateSerializedTrackData(withLineStyle(ok))).toEqual({ valid: true });
        }
    });
    it('rejects each bad field with its own message', () => {
        const cases: [unknown, string][] = [
            ['x', 'segments[0].lineStyle must be an object'],
            [null, 'segments[0].lineStyle must be an object'],
            [[], 'segments[0].lineStyle must be an object'],
            [{ preset: 'viaduct' }, 'segments[0].lineStyle.preset must be one of tunnel, bridge, planned, disused'],
            [{ pattern: 'wavy' }, 'segments[0].lineStyle.pattern must be one of solid, dashed, dotted, dash-dot'],
            ...[-1, 0x1000000, 1.5, 'red'].map(color => [{ color }, 'segments[0].lineStyle.color must be an integer from 0 to 0xFFFFFF'] as [unknown, string]),
            ...[0.5, 9, '2'].map(width => [{ width }, 'segments[0].lineStyle.width must be a number from 1 to 8'] as [unknown, string]),
        ];
        for (const [value, error] of cases) {
            expect(validateSerializedTrackData(withLineStyle(value))).toEqual({ valid: false, error });
        }
    });
});

it('splitting a segment keeps its line style on both halves', () => {
    const graph = new TrackGraph();
    const n = layStraight(graph);
    graph.setSegmentStyle(n, { lineStyle: { preset: 'planned' } });
    const splits: SegmentSplitInfo[] = [];
    graph.onSegmentSplit(info => splits.push(info));
    graph.insertJointIntoTrackSegmentUsingTrackNumber(n, 0.5);
    for (const half of [splits[0]!.firstNewSegment, splits[0]!.secondNewSegment]) {
        expect(graph.getTrackSegmentWithJoints(half)!.lineStyle).toEqual({ preset: 'planned' });
    }
});
```


- [ ] **Step 2: Run the tests to confirm they fail.**

Run: `bun test test/segment-line-style.test.ts > /tmp/t1.log 2>&1; tail -20 /tmp/t1.log`

Expected: FAIL. `normalizeLineStyle` is not exported, and `lineStyle` is not a known style key.

- [ ] **Step 3: Add the types and the fields** in `src/tracks/types.ts`, as in Interfaces. Give each `lineStyle?` field a one-line doc comment: "How the line render styles draw this segment; unset fields come from the preset."

- [ ] **Step 4: Add validation** to `validateSerializedTrackData`, after the `bedWidth` check.
    - Check only when `s.lineStyle !== undefined`.
    - "Object" means `typeof v === 'object' && v !== null && !Array.isArray(v)`.
    - `preset` and `pattern` are checked against `LINE_PRESETS` and `LINE_PATTERNS`, with the list joined by `', '` in the message.
    - `color` must satisfy `Number.isInteger(c) && c >= 0 && c <= 0xffffff`.
    - `width` must satisfy `typeof w === 'number' && w >= 1 && w <= 8`.
    - The messages are exactly those in the test.

- [ ] **Step 5: Wire the field through `segment-style.ts`.**
    - `normalizeLineStyle` returns a new object holding only the defined fields, or `undefined` when none are defined.
    - Add `lineStyle?: TrackLineStyle` to `SegmentStyle`, and `'lineStyle'` to the `SegmentStyleFields` `Pick` and to `STYLE_KEYS`.
    - `segmentFieldsFromStyle`, `withStyleDefaults` and `styleFieldsOf` set `lineStyle: normalizeLineStyle(x.lineStyle)`.
    - `applyStylePatch` ends with `merged.lineStyle = normalizeLineStyle(merged.lineStyle)`.

- [ ] **Step 6: Wire the field through the model.**
    - `makeTrackSegmentDrawDataFromSplit` adds `lineStyle: originalTrackSegment.lineStyle`.
    - `setNewSegmentStyle`'s loop condition also lets an explicit `undefined` through for `'lineStyle'`, as it does for `'catenarySide'`. The result's `lineStyle` is normalized.
    - `TrackCurveManager.serialize` spreads `...(lineStyle ? { lineStyle: { ...lineStyle } } : {})` into each segment.
    - `TrackCurveManager.deserialize` and `TrackGraph.loadFromSerializedData` pass `lineStyle: segment.lineStyle` in the style argument. `loadSegmentWithId` already applies `withStyleDefaults`.

- [ ] **Step 7: Run the new tests, the whole suite and the typecheck.**

Run: `bun test > /tmp/t1-all.log 2>&1; tail -5 /tmp/t1-all.log; bun run typecheck`

Expected: 0 fail, and the typecheck exits 0.

- [ ] **Step 8: Format and commit.**

```bash
bun run format && bun run format:check
git add src/tracks test/segment-line-style.test.ts
git commit   # feat(tracks): save a lineStyle on each segment  (+ attribution lines)
```

---

### Task 2: `getCrossings` and `getSegmentsAtJoint`

**Files:**
- Modify: `src/tracks/trackcurve-manager.ts`: add the type at the top level near the imports, and the two methods after `checkForCollisions` (299–340)
- Create: `test/track-helpers.ts`
- Test: `test/track-crossings.test.ts` (new)

**Interfaces:**
- **Produces:**

  ```ts
  /** Where another segment crosses this one. `t` and `otherT` are Bezier parameters. */
  export type TrackCrossing = { otherSegment: number; t: number; otherT: number };
  class TrackCurveManager {
      getCrossings(segmentNumber: number): TrackCrossing[];          // sorted by t; [] for an unknown segment
      getSegmentsAtJoint(jointNumber: number, position: Point): number[]; // ascending, no duplicates
  }
  // test/track-helpers.ts
  export function layLine(graph: TrackGraph, from: Point, to: Point,
      elevation?: ELEVATION /* GROUND */, control?: Point /* midpoint */): number;
  ```

- [ ] **Step 1: Write the test helper and the failing tests.**
    - `layLine` creates a joint at `from` whose tangent is the unit vector toward `control`, and one at `to` whose tangent is the unit vector from `control` to `to`.
    - It calls `expect(graph.connectJoints(a, b, [control])).toBe(true)`, and returns `graph.getJoint(a)!.connections.get(b)!`.

```ts
const cm = (g: TrackGraph) => g.trackCurveManager;

it('finds a crossing once from each side, at the exact point', () => {
    const graph = new TrackGraph();
    const h = layLine(graph, { x: 0, y: 0 }, { x: 100, y: 0 });
    const v = layLine(graph, { x: 50, y: -50 }, { x: 50, y: 50 }, ELEVATION.ABOVE_1);
    for (const [self, other] of [[h, v], [v, h]]) {
        const crossings = cm(graph).getCrossings(self);
        expect(crossings).toHaveLength(1);
        expect(crossings[0]!.otherSegment).toBe(other);
        expect(crossings[0]!.t).toBeCloseTo(0.5, 6);
        expect(crossings[0]!.otherT).toBeCloseTo(0.5, 6);
    }
});

it('refines an oblique crossing', () => {
    const graph = new TrackGraph();
    const h = layLine(graph, { x: 0, y: 0 }, { x: 100, y: 0 });
    layLine(graph, { x: 0, y: -30 }, { x: 100, y: 30 }, ELEVATION.ABOVE_1);
    const [c] = cm(graph).getCrossings(h);
    expect(c!.t).toBeCloseTo(0.5, 6);
    expect(c!.otherT).toBeCloseTo(0.5, 6);
});

it('reports two crossings with the same track, sorted by t', () => {
    const graph = new TrackGraph();
    const h = layLine(graph, { x: 0, y: 0 }, { x: 100, y: 0 });
    layLine(graph, { x: 20, y: -40 }, { x: 80, y: -40 }, ELEVATION.ABOVE_1, { x: 50, y: 120 });
    // y(u) = -40 + 320u - 320u², x(u) = 20 + 60u, and h's t = x / 100
    const us = [(320 - Math.sqrt(51200)) / 640, (320 + Math.sqrt(51200)) / 640];
    const crossings = cm(graph).getCrossings(h);
    expect(crossings).toHaveLength(2);
    crossings.forEach((c, i) => {
        expect(c.otherT).toBeCloseTo(us[i]!, 6);
        expect(c.t).toBeCloseTo((20 + 60 * us[i]!) / 100, 6);
    });
});

it('ignores a continuation and the branches of a junction', () => {
    const graph = new TrackGraph();
    const east = { x: 1, y: 0 };
    const [a, b, c, d] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 60 }]
        .map(p => graph.createNewEmptyJoint(p, east));
    expect(graph.connectJoints(a!, b!, [{ x: 50, y: 0 }])).toBe(true);
    expect(graph.connectJoints(b!, c!, [{ x: 150, y: 0 }])).toBe(true);
    expect(graph.connectJoints(b!, d!, [{ x: 150, y: 0 }])).toBe(true);
    for (const n of cm(graph).livingEntities) expect(cm(graph).getCrossings(n)).toEqual([]);
});

it('keeps a real crossing between segments that share a joint', () => {
    const graph = new TrackGraph();
    const a = graph.createNewEmptyJoint({ x: 0, y: 0 }, { x: 1, y: 0 });
    const b = graph.createNewEmptyJoint({ x: 100, y: 0 }, { x: 1, y: 0 });
    const e = graph.createNewEmptyJoint({ x: 60, y: -40 }, { x: -0.6, y: -1 });
    expect(graph.connectJoints(a, b, [{ x: 50, y: 0 }])).toBe(true);
    expect(graph.connectJoints(a, e, [{ x: 120, y: 60 }])).toBe(true);
    const straight = graph.getJoint(a)!.connections.get(b)!;
    // the loop is back on y = 0 at u = 0.75, x = 78.75
    const crossings = cm(graph).getCrossings(straight);
    expect(crossings).toHaveLength(1);
    expect(crossings[0]!.t).toBeCloseTo(0.7875, 6);
    expect(crossings[0]!.otherT).toBeCloseTo(0.75, 6);
});

it('forgets a removed segment, and knows nothing of an unknown one', () => {
    const graph = new TrackGraph();
    const h = layLine(graph, { x: 0, y: 0 }, { x: 100, y: 0 });
    const v = layLine(graph, { x: 50, y: -50 }, { x: 50, y: 50 }, ELEVATION.ABOVE_1);
    graph.removeTrackSegment(v);
    expect(cm(graph).getCrossings(h)).toEqual([]);
    expect(cm(graph).getCrossings(99)).toEqual([]);
});

describe('getSegmentsAtJoint', () => {
    it('finds the segments ending at a joint, and nothing for a joint not there', () => {
        const graph = new TrackGraph();
        const { joints } = layTrack(graph, [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }]);
        expect(cm(graph).getSegmentsAtJoint(joints[1]!, { x: 100, y: 0 })).toEqual([0, 1]);
        expect(cm(graph).getSegmentsAtJoint(joints[0]!, { x: 0, y: 0 })).toEqual([0]);
        expect(cm(graph).getSegmentsAtJoint(joints[2]!, { x: 100, y: 0 })).toEqual([]);
    });
});
```

`layTrack` is imported from `./station-placement-helpers.js`.

- [ ] **Step 2: Run the tests to confirm they fail.**

Run: `bun test test/track-crossings.test.ts > /tmp/t2.log 2>&1; tail -20 /tmp/t2.log`

Expected: FAIL. `getCrossings` is not a function.

- [ ] **Step 3: Implement `getCrossings`.** In order:
    1. Find candidates through `_internalRTree.search` with the curve's AABB, skipping the segment itself.
    2. For each candidate, call `curve.getCurveIntersections(other.curve)`; its `selfT` is ours.
    3. Sort the hits by `selfT`. A hit joins the current cluster when both its `t` and `otherT` are within `CROSSING_MERGE_T` (0.05) of the cluster's first hit. Each cluster becomes its mean.
    4. Refine each mean with Newton's method on `curve.get(t) − other.get(u) = 0`. Solve `curve.derivative(t)·dt − other.derivative(u)·du = other.get(u) − curve.get(t)` by Cramer's rule, for up to 8 iterations, stopping when both steps are below 1e-9. Keep the mean if the determinant falls below 1e-12 or the result leaves [0, 1].
    5. Drop the crossing when `|cross(unit tangents)| < CROSSING_MIN_SIN` (0.02).
    6. Drop it when the two segments share a joint (any of `t0Joint`/`t1Joint` equal) and `curve.get(t)` is within `JOINT_TOUCH_DISTANCE` (0.5) of that joint's end point on this curve.
    7. Return the crossings sorted by `t`.

    Keep the three constants as module-level `const`s in `trackcurve-manager.ts`.

- [ ] **Step 4: Implement `getSegmentsAtJoint`.** Search the R-tree with `new Rectangle(x − 0.5, y − 0.5, x + 0.5, y + 0.5)`, keep the entries with `t0Joint === jointNumber || t1Joint === jointNumber`, and return their `trackSegmentNumber`s, deduplicated and ascending.

- [ ] **Step 5: Run the new tests, the whole suite and the typecheck.**

Run: `bun test > /tmp/t2-all.log 2>&1; tail -5 /tmp/t2-all.log; bun run typecheck`

Expected: 0 fail, and the typecheck exits 0.

- [ ] **Step 6: Format and commit.**

```bash
bun run format && bun run format:check
git add src/tracks/trackcurve-manager.ts test/track-helpers.ts test/track-crossings.test.ts
git commit   # feat(tracks): query crossings and the segments at a joint  (+ attribution lines)
```

---

### Task 3: Line geometry: styles, samples, underground runs and patterns

**Files:**
- Create: `src/pixi/line-track-geometry.ts`
- Test: `test/line-track-geometry.test.ts` (new)
- Modify: `test/pixi-entry.test.ts:71-76`. Add `'buildLineTrack'` and `'resolveLineStyle'` to the "keeps the geometry and colour helpers internal" list.

**Interfaces:**
- **Consumes:** `TrackLineStyle`, `LinePreset`, `LinePattern` (Task 1), and `TerrainSampler` from `./tunnel-geometry.js`.
- **Produces** (internal to the package; the renderer imports them in Task 5):

```ts
export const LINE_TRACK_SAMPLE_LEN = 2;
export const PARAPET_MARGIN = 1.5;     export const MARK_LENGTH = 1.5;
export const MARK_ANGLE = Math.PI / 4; export const DECK_CLEARANCE = 1.5;
export const GAP_CLEARANCE = 0.5;      export const MAX_MARK_HALF_LENGTH = 25;
export const UNDERGROUND_LIGHTEN = 0.5; export const RESTROKE_ZOOM_STEP = Math.SQRT2;
export const MAX_PATTERN_REPEATS = 4000;
export const PATTERN_PX: Record<LinePattern, readonly number[]>; // solid [], dashed [6,4], dotted [1.5,3], dash-dot [8,3,1.5,3]
export type ResolvedLineStyle = { preset: LinePreset | undefined; pattern: LinePattern; color: number; width: number };
export function resolveLineStyle(style?: TrackLineStyle): ResolvedLineStyle;
export function lightenColor(color: number, amount: number): number; // each channel c + (255 − c)·amount, rounded
export function parapetOffset(gauge: number): number;                // gauge / 2 + PARAPET_MARGIN
export type LineSample = { point: Point; tangent: Point; normal: Point; t: number; s: number };
export function sampleLine(curve: BCurve): LineSample[];
export type LineHeights = { from: number; to: number };              // metres at t = 0 and t = 1
export function heightAt(heights: LineHeights, t: number): number;   // linear in t
export function buriedByTerrain(heights: LineHeights, t: number, point: Point, terrain: TerrainSampler | null): boolean;
export function isUnderground(heights: LineHeights, t: number, point: Point,
    lineStyle: TrackLineStyle | undefined, terrain: TerrainSampler | null): boolean;
export function patternIntervals(s0: number, s1: number, lengths: readonly number[]): [number, number][];
export type LineTrackInput = {
    samples: LineSample[]; heights: LineHeights; gauge: number; lineStyle?: TrackLineStyle;
    renderStyle: 'centerline' | 'rails'; terrain: TerrainSampler | null;
    /** Metres per screen pixel: 1 / zoom level. */
    metresPerPixel: number;
};
export type LineStroke = { points: Point[]; color: number };
export type LineTrackDrawing = { width: number; strokes: LineStroke[]; styled: boolean };
export function buildLineTrack(input: LineTrackInput): LineTrackDrawing;
```

- [ ] **Step 1: Write the failing tests** in `test/line-track-geometry.test.ts`.

```ts
const STRAIGHT = new BCurve([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }]);
const P = 1.067 / 2 + 1.5;
const W = 1.5 * Math.SQRT1_2; // a mark's reach along and across the track
const input = (o: Partial<LineTrackInput> = {}): LineTrackInput => ({
    samples: sampleLine(STRAIGHT), heights: { from: 0, to: 0 }, gauge: 1.067,
    renderStyle: 'centerline', terrain: null, metresPerPixel: 1, ...o,
});
/** Each stroke's [min x, max x], sorted. */
const xSpans = (strokes: LineStroke[]) => strokes
    .map(s => [Math.min(...s.points.map(p => p.x)), Math.max(...s.points.map(p => p.x))] as const)
    .sort((a, b) => a[0] - b[0]);
const expectSpans = (actual: readonly (readonly [number, number])[], expected: [number, number][]) => {
    expect(actual).toHaveLength(expected.length);
    actual.forEach(([a, b], i) => { expect(a).toBeCloseTo(expected[i]![0], 6); expect(b).toBeCloseTo(expected[i]![1], 6); });
};
const isPortalAt = (s: LineStroke, x: number) =>
    s.points.length === 4 && Math.abs(s.points[1]!.x - x) < 1e-6 && Math.abs(Math.abs(s.points[1]!.y) - P) < 1e-6;
```

Tests, each with the assertions listed:

- **`resolves each preset, with set fields winning`**
    - `resolveLineStyle()` → `{ preset: undefined, pattern: 'solid', color: 0x000000, width: 1 }`
    - `tunnel` → dashed / `0x000000`
    - `bridge` → solid / `0x000000`
    - `planned` → dashed / `0x000000`
    - `disused` → dotted / `0x999999`
    - `{ preset: 'disused', color: 0xff0000, pattern: 'dash-dot', width: 3 }` → dash-dot / `0xff0000` / 3
- **`lightens a colour per channel`**
    - `lightenColor(0x000000, 0.5)` → `0x808080`
    - `0xff0000` → `0xff8080`
    - `0x999999` → `0xcccccc`
    - `0xffffff` → `0xffffff`
- **`samples every 2 m with t, s and the normal`** on `STRAIGHT`:
    - 51 samples
    - the first point is `(0, 0)` and the last `(100, 0)`
    - `s` of the last sample is close to 100
    - `t` rises from 0 to 1
    - every normal is close to `(0, 1)`
- **`draws plain track as one solid line`**
    - `buildLineTrack(input())` → 1 stroke, colour `0x000000`, x span `[0, 100]`, all `y` close to 0
    - `width` is 1 and `styled` is false
- **`draws a line along each rail`**
    - `renderStyle: 'rails'` → 2 strokes, at `y = ±1.067/2`
- **`draws underground track as lighter dashes`**
    - heights `−10/−10` → every stroke colour `0x808080`
    - `expectSpans(xSpans(...), [[0,6],[10,16],…,[90,96]])` (10 spans)
    - `styled` is true
    - no stroke has 4 points with `|y| ≈ P`, so there are no portals
- **`splits a ramp at the ground and puts a portal there`**
    - heights `−10/10`
    - the grey strokes span `[0,6],[10,16],[20,26],[30,36],[40,46]`
    - one black line spans `[50, 100]`
    - one stroke satisfies `isPortalAt(s, 50)`. Its wing tips are at `x = 50 + W`, `y = ±(P + W)`: the open air is toward +x.
- **`uses the terrain`**
    - `terrain: { getHeight: () => 5 }` with heights `0/0` → all grey
    - `terrain: { getHeight: x => x / 10 - 2 }` with heights `0/0` → black `[0, 20]`, grey dashes from 20 on, and `isPortalAt(s, 20)` with wing tips at `x = 20 − W` (open air toward −x)
- **`scales patterns with zoom and width`**
    - heights `−10/−10` at `metresPerPixel: 0.5` → first spans `[0,3]`, `[5,8]`
    - heights `−10/−10` with `lineStyle: { width: 3 }` at `metresPerPixel: 1` → first spans `[0,18]`, `[30,48]`, with `width` 3 and `styled` true
- **`keeps the pattern phase from the segment start`**
    - `patternIntervals(52, 70, [6, 4])` → `[[52,56],[60,66]]`
    - `patternIntervals(0, 31, [8, 3, 1.5, 3])` → `[[0,8],[11,12.5],[15.5,23.5],[26.5,28]]`
    - `patternIntervals(3, 9, [])` → `[[3,9]]`
- **`caps the repeats on a very long interval`**
    - `patternIntervals(0, 1000, [0.006, 0.004])` has length 4000
    - its first interval is close to `[0, 0.15]`
    - its last interval ends at or before 1000
- **`draws an underground solid line dashed, and a set pattern as it is`**
    - heights `−10/−10` with `lineStyle: { pattern: 'solid' }` → the same spans as the default underground test
    - with `{ pattern: 'dotted' }` → first spans `[0,1.5]`, `[4.5,6]`
- **`draws a tunnel preset as underground wherever it is`**
    - `lineStyle: { preset: 'tunnel' }` with heights `0/0` → all grey dashes and no portal
    - Run-end portals come in Task 4.

- [ ] **Step 2: Run the tests to confirm they fail.**

Run: `bun test test/line-track-geometry.test.ts > /tmp/t3.log 2>&1; tail -20 /tmp/t3.log`

Expected: FAIL. The module is not found.

- [ ] **Step 3: Implement the module.**
    - **`sampleLine`:**
        - Use `max(2, ceil(fullLength / LINE_TRACK_SAMPLE_LEN))` steps, uniform in Bezier `t`.
        - The end points are the curve's first and last control points.
        - `tangent = PointCal.unitVector(curve.derivative(t))`, `normal = (−tangent.y, tangent.x)`, and `s = curve.lengthAtT(t)`.
    - **`buriedByTerrain`** is `heightAt(heights, t) < (terrain?.getHeight(point.x, point.y) ?? 0)`.
    - **`isUnderground`** is `lineStyle?.preset === 'tunnel' || buriedByTerrain(...)`.
    - **`patternIntervals`:**
        - Empty lengths give `[[s0, s1]]`.
        - Let C be the sum of the lengths. If `(s1 − s0) / C > MAX_PATTERN_REPEATS`, scale every length by `((s1 − s0) / C) / MAX_PATTERN_REPEATS`.
        - Walk the cycles from `floor(s0 / C) · C`. Entries at even index are "on"; clip each to `[s0, s1]` and drop the empty ones.
    - **`buildLineTrack`:**
        1. **Style:** `style = resolveLineStyle(input.lineStyle)`, and `len` is the last sample's `s`.
        2. **Runs:**
            - A tunnel preset is one underground run, `[0, len]`.
            - Otherwise, `rel_i = heightAt(t_i) − ground(point_i)`. Where the state changes between samples `i` and `i + 1`, the boundary is `s_i + (s_{i+1} − s_i) · rel_i / (rel_i − rel_{i+1})`.
            - Each boundary is a ground crossing. Its open-air side is +1 (toward larger `s`) when the run before it is underground, and −1 otherwise.
        3. **Lines:**
            - The offsets are `[0]` for centerline and `[−g/2, +g/2]` for rails.
            - For each run and offset: the pattern is the style's pattern above ground. Underground it is the style's pattern, with `solid` replaced by `dashed`, and the colour is `lightenColor(style.color, UNDERGROUND_LIGHTEN)`.
            - The lengths are `PATTERN_PX[pattern]`, each multiplied by `style.width · metresPerPixel`.
            - One polyline per interval: the point at the interval start, every sample strictly inside it, and the point at its end.
            - The point at `(s, offset)` interpolates the two bracketing samples' point and normal linearly, then adds `normal · offset`.
        4. **Portals:** one per ground crossing, as `[tip(−P), bar(−P), bar(+P), tip(+P)]`.
            - `bar(o)` is the point at `(s, o)`.
            - `tip(o) = bar(o) + MARK_LENGTH · (cos(MARK_ANGLE) · side · tangent + sin(MARK_ANGLE) · sign(o) · normal)`, where `side` is the open-air side.
            - The colour is `style.color`.
        5. **`styled`** is true if any line used non-empty lengths, or `style.width > 1`. `width` is `style.width`.

- [ ] **Step 4: Run the new tests, the whole suite and the typecheck.** Expected: 0 fail, and the typecheck exits 0.

- [ ] **Step 5: Format and commit.**

```bash
bun run format && bun run format:check
git add src/pixi/line-track-geometry.ts test/line-track-geometry.test.ts test/pixi-entry.test.ts
git commit   # feat(pixi): line geometry for styles, underground runs and patterns  (+ attribution lines)
```

---

### Task 4: Line geometry: crossings, decks, gaps and run ends

**Files:**
- Modify: `src/pixi/line-track-geometry.ts`
- Test: `test/line-track-geometry.test.ts`
- Modify: `test/pixi-entry.test.ts`. Add `'classifyCrossing'` to the internal list.

**Interfaces:**
- **Consumes:** Task 3's exports, and `VERTICAL_CLEARANCE` from `'../index.js'`.
- **Produces:**

```ts
export type CrossingSide = { curve: BCurve; t: number; gauge: number; heights: LineHeights; lineStyle?: TrackLineStyle };
export type CrossingKind = 'level' | 'buried' | 'over' | 'under';
export function classifyCrossing(self: CrossingSide, other: CrossingSide, terrain: TerrainSampler | null): CrossingKind;
export type CrossingMark = { kind: 'deck' | 'gap'; s: number; halfLength: number };
export function crossingMark(self: CrossingSide, other: CrossingSide, terrain: TerrainSampler | null,
    renderStyle: 'centerline' | 'rails'): CrossingMark | null;
export type RunEndNeighbour = { lineStyle?: TrackLineStyle; underground: boolean };
export function needsRunEndMark(lineStyle: TrackLineStyle | undefined, buriedHere: boolean,
    neighbours: RunEndNeighbour[]): boolean;
// LineTrackInput gains:
//   marks?: CrossingMark[];
//   runEnds?: { start: boolean; end: boolean };
```

- [ ] **Step 1: Write the failing tests**, added to `test/line-track-geometry.test.ts`.

```ts
const H = new BCurve([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }]);
const V = new BCurve([{ x: 50, y: -50 }, { x: 50, y: 0 }, { x: 50, y: 50 }]);
/** A straight track through (50, 0) at `deg` degrees to H. */
const at = (deg: number) => {
    const r = (deg * Math.PI) / 180, [c, s] = [Math.cos(r), Math.sin(r)];
    return new BCurve([{ x: 50 - 50 * c, y: -50 * s }, { x: 50, y: 0 }, { x: 50 + 50 * c, y: 50 * s }]);
};
const side = (curve: BCurve, height: number, o: Partial<CrossingSide> = {}): CrossingSide =>
    ({ curve, t: 0.5, gauge: 1.067, heights: { from: height, to: height }, ...o });
```

Tests, each with the assertions listed:

- **`classifies crossings`**
    - `classifyCrossing(side(H, 0), side(V, 10), null)` → `'under'`; the reverse → `'over'`
    - heights 0 and 2 → `'level'`
    - H at −10 under V at 0 → `'buried'`
    - V with `lineStyle: { preset: 'tunnel' }` at 10 over H at 0 → `'buried'`
    - with `terrain: { getHeight: () => 5 }`, H at 0 and V at 10 → `'buried'`
    - H as a ramp `{ from: 0, to: 20 }` against V at 10 → `'level'`
- **`sizes a deck and a gap at 90°`**
    - `crossingMark(side(V, 10), side(H, 0, { gauge: 1.435 }), null, 'centerline')` → `{ kind: 'deck', s ≈ 50, halfLength ≈ 1.435/2 + 1.5 }`
    - `crossingMark(side(H, 0), side(V, 10), null, 'centerline')` → `{ kind: 'gap', halfLength ≈ P + 0.5 }`
    - with `'rails'` → the same, since `cot 90° = 0`
- **`sizes a deck and a gap at 30°, and caps a shallow one`**
    - deck on `at(30)` over H → halfLength ≈ `(1.067/2 + 1.5) / 0.5 + P * Math.sqrt(3)`
    - gap on H under `at(30)`, `'rails'` → ≈ `(P + 0.5) / 0.5 + (1.067/2) * Math.sqrt(3)`
    - at `at(1)` → both halfLengths are exactly 25
- **`leaves level and buried crossings, and a bridge preset's deck, unmarked`**
    - `crossingMark` is `null` for a level crossing, for a buried one, and for an `over` side with `lineStyle: { preset: 'bridge' }`
    - an `under` bridge-preset side at 90° → gap halfLength ≈ `P + 0.5`, since `r = P` and `cot = 0`
- **`cuts a gap in every line`**
    - `marks: [{ kind: 'gap', s: 50, halfLength: 2.5 }]` → `expectSpans(xSpans, [[0, 47.5], [52.5, 100]])`
    - with `'rails'` → 4 strokes, two at each `y = ±1.067/2`
- **`draws a deck as parapets with wings`**
    - `marks: [{ kind: 'deck', s: 50, halfLength: 3 }]` → 3 strokes: the centreline and two parapets
    - each parapet has `points[1]` close to `(47, ±P)` and `points.at(-2)` close to `(53, ±P)`
    - `points[0]` is close to `(47 − W, ±(P + W))` and `points.at(-1)` to `(53 + W, ±(P + W))`
- **`clamps a deck at the segment end, with no wing there`**
    - `{ kind: 'deck', s: 1, halfLength: 3 }` → each parapet's `points[0]` is close to `(0, ±P)`, and its last point to `(4 + W, ±(P + W))`
- **`draws a bridge preset's parapets along the whole segment`**
    - `lineStyle: { preset: 'bridge' }, runEnds: { start: true, end: true }` → parapets run from wing tip `(−W, ±(P + W))` to `(100 + W, ±(P + W))`
    - with `runEnds: { start: false, end: false }` → they run from `(0, ±P)` to `(100, ±P)`
    - with a gap mark at s = 50 → each parapet is in two pieces
- **`puts a tunnel preset's portals at the run ends asked for`**
    - `lineStyle: { preset: 'tunnel' }, runEnds: { start: true, end: false }` → exactly one black stroke, which passes `isPortalAt(s, 0)`
    - its wing tips are at `x = −W`
- **`decides run-end marks`**
    - `needsRunEndMark` is true for:
        - tunnel with no neighbours
        - tunnel with a neighbour `{ underground: false }`
        - bridge with a neighbour `{ lineStyle: undefined, underground: false }`
    - It is false for:
        - tunnel with `buriedHere: true`
        - tunnel with a neighbour `{ underground: true }`
        - bridge with a neighbour `{ lineStyle: { preset: 'bridge' }, underground: false }`
        - `planned`
        - no style

- [ ] **Step 2: Run the tests to confirm they fail.** Expected: FAIL. `classifyCrossing` is not exported.

- [ ] **Step 3: Implement the crossing functions.**
    - **`classifyCrossing`:** the heights come from `heightAt` at each side's `t`, and the point is `self.curve.get(self.t)`.
        - `|Δ| < VERTICAL_CLEARANCE` → `level`
        - `isUnderground` on either side → `buried`
        - otherwise → `over` or `under`
    - **`crossingMark`:**
        - The tangents are the unit vectors of `derivative(t)`. Then `sin = |a × b|`, `cos = |a · b|` and `cot = cos / sin`.
        - When `sin < 1e-6`, the half-length is `MAX_MARK_HALF_LENGTH`.
        - `s = self.curve.lengthAtT(self.t)`.
        - The formulas are the spec's `L_deck` and `L_gap`, capped at `MAX_MARK_HALF_LENGTH`. `r` is `parapetOffset(self.gauge)` for a bridge preset, `self.gauge / 2` for rails, and 0 for centerline.
    - **`needsRunEndMark`:**
        - tunnel → `!buriedHere && !neighbours.some(n => n.underground)`
        - bridge → `!neighbours.some(n => n.lineStyle?.preset === 'bridge')`
        - anything else → false

- [ ] **Step 4: Extend `buildLineTrack`.**
    - Gap intervals are `[max(0, s − L), min(len, s + L)]`.
    - Subtract them from each run before splitting it into the pattern. The pattern phase stays measured from `s = 0`.
    - **Bridge preset:** parapets at ±P along each run, cut by the gaps. They are solid, in the run's colour. Prepend a start wing tip when `runEnds.start` and the piece starts at 0; append an end wing tip when `runEnds.end` and the piece ends at `len`.
    - **Decks:** for each deck mark and each of ±P, one polyline over the clamped interval. It gets a wing tip at an end only where that end wasn't clamped.
    - **Wing tip** at a parapet end: `end + MARK_LENGTH · (cos(MARK_ANGLE) · away + sin(MARK_ANGLE) · sign(o) · normal)`, where `away` is `−tangent` at the start end and `+tangent` at the far end.
    - **Tunnel preset:** a portal at `s = 0` (side −1) when `runEnds.start`, and at `s = len` (side +1) when `runEnds.end`.
    - Gaps don't cut portals or wings. All marks are solid at `style.width`, in the colour of the part they sit on; portals take `style.color`.

- [ ] **Step 5: Run the new tests, the whole suite and the typecheck.** Expected: 0 fail, and the typecheck exits 0.

- [ ] **Step 6: Format and commit.**

```bash
bun run format && bun run format:check
git add src/pixi/line-track-geometry.ts test/line-track-geometry.test.ts test/pixi-entry.test.ts
git commit   # feat(pixi): line geometry for bridges, gaps and run ends  (+ attribution lines)
```

---

### Task 5: Draw line-style track from the geometry

**Files:**
- Modify: `src/pixi/track-render-system.ts`:
    - delete `LINE_TRACK_SAMPLE_LEN` (74) and `sampleCurve` (89–108)
    - update the `TrackRenderStyle` doc comment (137–150)
    - add a field near `_undergroundIndicatorMap` (276–280)
    - change `_onSegmentStyleChanged` (498–516), `_onZoom` (556–562), `_buildLineTrack` (701–719, replaced), `_removeLaidTrack` (725–800), `_onRemoveTrackSegment` (1990–2008), `_onAddTrackSegment` (2010–2099) and `_drawLinePreview` (2744–2775)
- Modify: `test/pixi-helpers.ts:43-71`. `StrokedLine` gains `color: number; width: number; pixelLine: boolean`, read from `instruction.data.style`.
- Test: `test/track-render-system.test.ts`, in the "line styles" describe (503–717)

**Interfaces:**
- **Consumes:** Task 3 and Task 4's exports, and Task 1's `lineStyle` on segments and draw data.
- **Produces** (used by Task 6):

  ```ts
  /** module-level type in track-render-system.ts */
  type LineTrackRecord = { graphics: Graphics; input: LineTrackInput; styled: boolean; strokeZoom: number };
  private _lineTracks: Map<number, LineTrackRecord>;
  private _lineInputFor(curveNumber: number, segment: TrackSegmentWithCollision): LineTrackInput;
  private _drawLineSegment(curveNumber: number, segment: TrackSegmentWithCollision): void; // creates, or redraws in place
  private _redrawLineSegment(curveNumber: number): void;  // no-op without a record or a segment
  private _strokeLineDrawing(graphics: Graphics, drawing: LineTrackDrawing, zoom: number): void;
  ```

- [ ] **Step 1: Write the failing tests.**
    - Replace `keeps the dashed marker on underground track at every zoom level` (577–585) with `draws underground track lighter and dashed, with no overlay`:
        - `layTrack(graph, [A, B], ELEVATION.SUB_1)` in centerline
        - `host.bandKeys` equals `['__simplified__0']`
        - every stroke colour is `0x808080`, and there is more than one stroke
    - In `draws the preview as lines, without a tunnel` (612–625), replace the final length assertion: every preview stroke colour is `0x808080` (the preview is under the terrain at 5) and there are more than 2 strokes.
    - Add these tests (with `const P = 1.067 / 2 + 1.5`):
        - **`draws a ramp solid above ground and dashed below, with a portal`**
            - `layRamp(graph, SUB_1, ABOVE_1)`, centerline
            - the black strokes are a line spanning x `[50, 100]` and a portal whose `points[1]` is close to `(50, ±P)`
            - the grey strokes all lie at x ≤ 50
        - **`decides underground with the terrain`**
            - `scene({ terrain: flatTerrain(5) })`, ground track → every stroke `0x808080`
        - **`draws each segment in its line style`**
            - `graph.setNewSegmentStyle({ lineStyle: { preset: 'disused' } })` then lay → every stroke `0x999999`, more than 10 strokes
            - then `graph.setSegmentStyle(0, { lineStyle: { color: 0xff0000 } })` → one red stroke
        - **`draws a wider line at its width in world units`**
            - `lineStyle: { width: 3 }` at zoom 1 → strokes have `width` 3 and `pixelLine` false
            - after `await zoomTo(camera, 2)` → `width` 1.5
        - **`re-strokes styled lines only at √2 zoom steps`**
            - lay a `planned` segment (index 0), call `setNewSegmentStyle({ lineStyle: undefined })`, then lay a plain one, `layTrack(graph, [C, {x: 300, y: 0}])` (index 1)
            - spy on segment 1's `Graphics.clear` (`__simplified__1`)
            - segment 0 has 10 strokes; after `zoomTo(camera, 1.3)` still 10; after `zoomTo(camera, 1.5)` 15
            - the spy was never called
        - **`gives a lone tunnel segment a portal at each end`**
            - `lineStyle: { preset: 'tunnel' }`, ground track
            - the black strokes are exactly two portals, with `points[1].x` close to 0 and close to 100
            - every other stroke is `0x808080`
        - **`draws the preview in the new-track line style and underground`**
            - `setNewSegmentStyle({ lineStyle: { preset: 'planned' } })`, ground preview → more than 1 stroke, all `0x000000`
        - **`keeps the detailed style as it was`**
            - in `detailed`, with `setNewSegmentStyle({ lineStyle: { preset: 'planned' } })` and `layTrack(graph, [A, B], ELEVATION.SUB_1)`
            - `__simplified__0` has 1 stroke, colour `0x000000`
            - `host.bandKeys` contains `'__underground__0'`

- [ ] **Step 2: Run the tests to confirm they fail.**

Run: `bun test test/track-render-system.test.ts > /tmp/t5.log 2>&1; tail -30 /tmp/t5.log`

Expected: the new and changed tests FAIL; the others pass.

- [ ] **Step 3: Build laid line-style track from the geometry.**
    - **`_lineInputFor`:**
        - samples: `sampleLine(segment.curve)`
        - heights: `elevation.from/to × LEVEL_HEIGHT`
        - gauge, `lineStyle`, `renderStyle` (as `'centerline' | 'rails'`), terrain, and `metresPerPixel = 1 / camera.zoomLevel`
        - `runEnds` from `needsRunEndMark(lineStyle, buriedByTerrain(...at t = 0 / 1, at the curve's end points), [])` for each end
        - no marks yet
    - **`_drawLineSegment`:**
        - Without a record: create a `Graphics`, stroke it, and `addToBand('__simplified__N', graphics, band of the higher end, 'rail')` as today. Set both `_simplifiedTrackGraphicsMap` and `_lineTracks`.
        - With a record: `graphics.clear()`, stroke again, and update the record.
    - **`_strokeLineDrawing`:** group the strokes by colour. For each colour, `moveTo`/`lineTo` every polyline, then `stroke(width === 1 ? { color, pixelLine: true } : { color, width: width / zoom })`.
    - **`_onAddTrackSegment`:** for a line style, call `_drawLineSegment` and return, with no underground overlay. `detailed` is unchanged.
    - **`_onRemoveTrackSegment`** also deletes `_lineTracks`; **`_removeLaidTrack`** clears it.
    - **`_onSegmentStyleChanged`:** in a line style, also call `_redrawLineSegment(segmentNumber)`.

- [ ] **Step 4: Re-stroke on zoom.** In `_onZoom`, for a line style, re-stroke each record with `styled` and `max(z / strokeZoom, strokeZoom / z) ≥ RESTROKE_ZOOM_STEP`:
    - `buildLineTrack({ ...record.input, metresPerPixel: 1 / z })`
    - `graphics.clear()`, stroke again, and update `strokeZoom`

- [ ] **Step 5: Draw previews from the geometry.** In `_drawLinePreview`, replace `_buildLineTrack(...)` with a `Graphics` stroked from `buildLineTrack`:
    - samples of `drawData.curve`
    - `heights: drawData.elevation`, which is already in metres
    - `drawData.lineStyle`, current zoom, no marks
    - `runEnds` from `needsRunEndMark(..., [])`, but only at `originalTrackSegment.tValInterval.start === 0` / `end === 1`

  Then delete `_buildLineTrack`, and update the `TrackRenderStyle` doc to the spec's wording.

- [ ] **Step 6: Run the renderer tests, the whole suite and the typecheck.** Expected: 0 fail, and the typecheck exits 0.

- [ ] **Step 7: Format and commit.**

```bash
bun run format && bun run format:check
git add src/pixi/track-render-system.ts test/pixi-helpers.ts test/track-render-system.test.ts
git commit   # feat(pixi): draw line-style track from the line geometry  (+ attribution lines)
```

---

### Task 6: Bridges and gaps at crossings, run-end neighbours, README

**Files:**
- Modify: `src/pixi/track-render-system.ts`: `_lineInputFor`, `_drawLineSegment`, `_onAddTrackSegment`, `_onRemoveTrackSegment`, `_onSegmentStyleChanged`, `_removeLaidTrack`
- Modify: `README.md:159-172`, the "Render styles" bullet
- Test: `test/track-render-system.test.ts`, in a new `describe('TrackRenderSystem: crossings and runs')`

**Interfaces:**
- **Consumes:**
    - Task 2: `getCrossings`, `getSegmentsAtJoint`, and `layLine` from `./track-helpers.js`
    - Task 4: `crossingMark`, `needsRunEndMark`, `isUnderground`, `buriedByTerrain`
    - Task 5: the record helpers
- **Produces:**
    - `LineTrackRecord` gains `ends: { joint: number; position: Point }[]` (start, then end)
    - `private _linePartners: Map<number, Set<number>>`
    - `private _presetNeighbours(curveNumber: number, ends: LineTrackRecord['ends']): number[]`

- [ ] **Step 1: Write the failing tests.**

```ts
const P = 1.067 / 2 + 1.5;
const GAP = P + 0.5;          // half-gap at 90°
const DECK = 1.067 / 2 + 1.5; // half-deck at 90°
const W = 1.5 * Math.SQRT1_2;
const linesOf = (host: RecordingLayerHost, n: number) => strokedLines(host.bandItem(`__simplified__${n}`));
const xSpans = (lines: StrokedLine[]) => lines
    .map(l => [Math.min(...l.points.map(p => p.x)), Math.max(...l.points.map(p => p.x))])
    .sort((a, b) => a[0]! - b[0]!);
/** h along y = 0, then v across it at x = 50, one level up. */
function crossing(graph: TrackGraph) {
    const h = layLine(graph, { x: 0, y: 0 }, { x: 100, y: 0 });
    const v = layLine(graph, { x: 50, y: -50 }, { x: 50, y: 50 }, ELEVATION.ABOVE_1);
    return { h, v };
}
function expectBridge(host: RecordingLayerHost, h: number, v: number) {
    const spans = xSpans(linesOf(host, h));
    expect(spans).toHaveLength(2);
    expect(spans[0]![1]).toBeCloseTo(50 - GAP, 6);
    expect(spans[1]![0]).toBeCloseTo(50 + GAP, 6);
    const parapets = linesOf(host, v).filter(l => Math.abs(l.points[1]!.x - 50) > 1);
    const xs = parapets.map(l => l.points[1]!.x).sort((a, b) => a - b);
    expect(xs).toHaveLength(2);
    expect(xs[0]).toBeCloseTo(50 - P, 6);
    expect(xs[1]).toBeCloseTo(50 + P, 6);
    for (const p of parapets) {
        expect(p.points[0]!.y).toBeCloseTo(-DECK - W, 6);
        expect(p.points.at(-1)!.y).toBeCloseTo(DECK + W, 6);
    }
}
```

Tests, each with `renderer.renderStyle = 'centerline'` unless stated otherwise:

- **`draws a bridge where track crosses over other track`**: `crossing(graph)` → `expectBridge(host, h, v)`.
- **`draws the bridge when the upper track is laid first`**: lay v, then h → `expectBridge`.
- **`cuts every rail of the lower track`**: in `'rails'` → `linesOf(host, h)` has 4 lines, and `linesOf(host, v)` has 4 (2 rails and 2 parapets).
- **`restores the lower line when the upper track is removed`**: `graph.removeTrackSegment(v)` → `xSpans(linesOf(host, h))` is close to `[[0, 100]]`.
- **`restores every track a deleted upper track crossed`**
    - h1 along y = 0 and h2 along y = 20, both from x 0 to 100
    - v from `(50, −50)` to `(50, 50)` at ABOVE_1
    - each has 2 spans; after removing v, each has 1
- **`cuts a gap at each of two crossings`**
    - h, plus `layLine(graph, {x:20,y:-40}, {x:80,y:-40}, ELEVATION.ABOVE_1, {x:50,y:120})`
    - h has 3 spans
    - each crossing x, `20 + 60u` for the two `u` from Task 2, lies inside a gap: no span contains it
- **`draws nothing at a level crossing`**: v at GROUND → h has 1 stroke and v has 1.
- **`draws nothing where the lower track is underground`**
    - h at SUB_1 and v at GROUND
    - `linesOf(host, h)` deep-equals the same h drawn in a scene without v
    - v has 1 stroke
- **`treats a tunnel preset as underground at a crossing`**
    - `setNewSegmentStyle({ lineStyle: { preset: 'tunnel' } })` before laying v → h has 1 stroke
    - v has no stroke with `|points[1].x − 50| > 1` except its two portals, which lie at y ≈ ±50
- **`redraws the lower track when the upper becomes a tunnel`**: `crossing(graph)`, then `graph.setSegmentStyle(v, { lineStyle: { preset: 'tunnel' } })` → h has 1 stroke.
- **`draws bridges after loading a saved layout`**
    - build `crossing(source)` and `const saved = source.serialize()`
    - on the scene's graph: `await graph.loadFromSerializedData(saved, { yieldToFrame: async () => {} })` → `expectBridge(host, 0, 1)`
- **`keeps bridges right across render-style switches`**
    - `crossing(graph)` in centerline
    - switch to `'rails'` → h has 4 lines
    - switch to `'detailed'`, then `'centerline'` → `expectBridge`, and `host.bandKeys.filter(k => k.startsWith('__simplified__'))` equals `['__simplified__0', '__simplified__1']`
- **`puts tunnel portals only at the ends of a tunnel run`**
    - `layTrack(graph, [A, B, C])`, then `setSegmentStyle(0, { lineStyle: { preset: 'tunnel' } })` → segment 0's black strokes are 2 portals, at x ≈ 0 and x ≈ 100
    - `setSegmentStyle(1, tunnel)` → segment 0 has 1 portal (x ≈ 0) and segment 1 has 1 (x ≈ 200)
    - `graph.removeTrackSegment(1)` → segment 0 has 2 again
- **`puts viaduct wings only at the ends of a bridge run`**
    - `layTrack(graph, [A, B, C])`, then `setSegmentStyle(0, { lineStyle: { preset: 'bridge' } })` → segment 0's two parapets each end at x close to `100 + W`
    - `setSegmentStyle(1, bridge)` → they end at x close to 100, and segment 1's start at x close to 100

- [ ] **Step 2: Run the tests to confirm they fail.**

Run: `bun test test/track-render-system.test.ts > /tmp/t6.log 2>&1; tail -30 /tmp/t6.log`

Expected: the new tests FAIL. Gaps, decks and neighbour ends aren't drawn yet.

- [ ] **Step 3: Add marks, partners and neighbour ends to `_lineInputFor`.**
    - **Marks:** for each `getCrossings(n)` result, get the other segment with `getTrackSegmentWithJoints` (skip it if null). Build the two `CrossingSide`s, with heights in metres and the crossing's `t` / `otherT`. Push `crossingMark(self, other, terrain, renderStyle)` when it isn't null.
    - **Partners:** set `_linePartners.get(n)` to exactly the other segments found, and add `n` to each partner's set.
    - **Ends:** `t0Joint` at the curve's first control point and `t1Joint` at its last; record them as the `ends`.
    - **Run ends:** for each end, the neighbours are `getSegmentsAtJoint(joint, position)` without `n`. Each maps to `{ lineStyle, underground: isUnderground(heights_m, t_m, position, lineStyle_m, terrain) }`, with `t_m = 0` when its `t0Joint` is the joint and 1 otherwise. Then `runEnd = needsRunEndMark(lineStyle, buriedByTerrain(heights, t, position, terrain), neighbours)`.

- [ ] **Step 4: Redraw the tracks affected by a change.**
    - **`_presetNeighbours`** returns the segments at `ends` (through `getSegmentsAtJoint`), excluding `curveNumber`, whose `lineStyle?.preset` is `'tunnel'` or `'bridge'`.
    - **Add** (line style): `_drawLineSegment(n)`, then `_redrawLineSegment` for each partner and each preset neighbour. `_redrawLineSegment` already skips any without a record, which is what keeps loading in any order correct.
    - **Remove:** read the record's `ends` and the partners before deleting. Remove `n` from each partner's set and delete its entries. Then redraw the partners and `_presetNeighbours(n, ends)`.
    - **Style change** (line style): redraw `n`, its partners and its preset neighbours.
    - **`_removeLaidTrack`** clears `_linePartners`.

- [ ] **Step 5: Update the README's "Render styles" bullet.**
    - Replace "but keep the dashed marker over underground track" with: "They draw a bridge (parapets and wings) where track crosses at least 3 m over other track, which is cut beneath it, and underground track as lighter, broken lines with a portal where it reaches the surface."
    - Add a sub-bullet: "Each segment's `lineStyle` (`{ preset?, pattern?, color?, width? }`, saved with the layout) changes how the line styles draw it. Presets are `tunnel` (drawn and treated as underground), `bridge` (parapets along the segment), `planned` (dashed) and `disused` (dotted, grey); set fields win over the preset. Patterns and widths are in screen pixels." Follow it with the example `graph.setSegmentStyle(n, { lineStyle: { preset: 'planned', color: 0x2266cc } })`.
    - Change "Lines are one pixel wide at any zoom" to "Lines are one pixel wide at any zoom unless a `lineStyle` sets a width".

- [ ] **Step 6: Run full verification.**

Run:

```bash
bun run typecheck && bun test > /tmp/t6-all.log 2>&1; tail -5 /tmp/t6-all.log
bun run format:check && bun run build
```

Expected: the typecheck exits 0, the tests show 0 fail, and the format check and build are clean.

- [ ] **Step 7: Commit and push.**

```bash
git add src/pixi/track-render-system.ts test/track-render-system.test.ts README.md
git commit   # feat(pixi): draw bridges and gaps where line-style track crosses  (+ attribution lines)
git push -u origin claude/bridge-underground-track-render-3rg5de
```
