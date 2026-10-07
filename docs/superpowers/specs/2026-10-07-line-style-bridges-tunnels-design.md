# Line-style bridges, tunnels and per-segment line styles: design

- **Date:** 2026-10-07
- **Status:** Approved in conversation; written spec awaiting the owner's review
- **Source:** track-layout `main` at `c82fc89` (0.7.0), clapham `main` at `c164488`, banana `main` at `0c86543`
- **Package:** `track-layout` 0.7.0 published; this work releases 0.8.0
- **Baseline:** `bun test` 503 pass across 46 files; `bun run typecheck` clean

## Goal

The `centerline` and `rails` render styles (0.6.0) draw every segment as a plain black line. This work makes them show three things:

1. **Bridges.** Where two tracks cross at different heights, the higher one is drawn as a simple, untextured bridge: two parapet lines with splayed wings. The lower track's line is cut in a gap under it.
2. **Underground track.** Track below the terrain is drawn as a lighter, dashed line. A tunnel portal mark goes where a ramp enters the ground. This replaces the grey dashed overlay that the line styles draw today, which only covers segments underground at both ends.
3. **Per-segment line styles.** Each segment can have a saved `lineStyle`, with a preset (`tunnel`, `bridge`, `planned`, `disused`) and any of pattern, colour and width. It is drawn in both line styles and keeps working where the segment crosses another track.

## Non-goals

- **The `detailed` style.** It keeps its textured track, beds, shadows, tunnels and cuttings, and ignores `lineStyle`. Its zoomed-out line and dashed underground overlay are unchanged.
- **Moving terrain into track-layout.** Terrain stays in banana. The renderer keeps reading it through the existing `TerrainSampler` (`getHeight(x, y)`); with none, the ground is flat at 0, as in clapham.
- **App UI.** Clapham's controls for setting line styles get their own spec in clapham once 0.8.0 is published. Banana uses `detailed` and track-layout 0.5.0, and doesn't change.
- **Bridges in previews.** Previews get underground dashes, portals and the new-track line style, but no crossing marks.
- **Fixing line-style band order.** A line-style segment stays in the band of its higher end. Cutting the lower line is what keeps a bridge correct whichever band each track is in.
- **A crossing index in the model.** Crossings are queried when a line is built; nothing new is stored.

## Decisions

| Topic                  | Decision                                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Terrain                | Stays in banana. Underground is decided with the existing optional `TerrainSampler`, flat at 0 without one.                                                                                |
| Approach               | Two read-only model queries (`getCrossings`, `getSegmentsAtJoint`), a pure geometry module in `src/pixi/`, and renderer wiring with a partner map for redraws.                             |
| Bridge look            | Parapets with splayed wings on the upper track, plus a real gap in the lower track's line. Nothing is filled, so it works over any background or terrain.                                  |
| Grade separation       | The heights at the crossing differ by at least `VERTICAL_CLEARANCE` (3 m), the threshold `intersectionSatisfiesVerticalClearance` already uses.                                            |
| Buried crossings       | No bridge and no gap when either track is underground at the crossing.                                                                                                                     |
| Underground look       | Lighter colour, broken pattern, portal marks where the track crosses ground level.                                                                                                         |
| Line style storage     | A new optional segment style field `lineStyle`, saved with the layout, set through `setSegmentStyle` / `setNewSegmentStyle`, redrawn through `onSegmentStyleChanged`.                      |
| Line style properties  | `preset`, `pattern`, `color`, `width`. Fields set on the style win over the preset's values.                                                                                               |
| Presets                | `tunnel` (counts as underground everywhere), `bridge` (parapets along the whole segment), `planned` (dashed), `disused` (dotted, grey).                                                    |
| Pattern and width unit | Screen pixels, so patterns survive zooming out. Styled lines are re-stroked from cached samples when the zoom has moved by a factor of √2. Plain solid 1 px lines are drawn as today.      |
| Release                | `track-layout` 0.8.0 through the Release workflow, which the owner triggers. Clapham pins `^0.8.0` in its follow-up spec.                                                                  |

## Model changes (`src/tracks/`)

### 1. `TrackCurveManager.getCrossings`

```ts
/** Where another segment crosses this one. `t` and `otherT` are Bezier parameters. */
export type TrackCrossing = { otherSegment: number; t: number; otherT: number };

getCrossings(segmentNumber: number): TrackCrossing[];
```

- It searches the R-tree with the segment's AABB, skips the segment itself, and runs `curve.getCurveIntersections(other.curve)` on each candidate. The result is sorted by `t`.
- **Hits are merged and refined.** `getCurveIntersections` is approximate: a single perpendicular crossing comes back as up to four hits about 0.01 apart in `t`. Hits within `CROSSING_MERGE_T` (0.05) of each other in both `t` and `otherT` are merged into their mean. The mean is then refined with Newton's method on `curve.get(t) − other.get(otherT) = 0`, for up to 8 iterations. If the tangents are parallel or the result leaves [0, 1], the mean is kept.
- **Touches are dropped.** Two rules, applied after refinement:
    - **Tangential:** an intersection is dropped when the tracks meet at sin θ < `CROSSING_MIN_SIN` (0.02, about 1°). The branches of a junction leave their joint with the same tangent, and their raw hits can land more than a metre from it. Tracks that touch this tangentially aren't crossing.
    - **Shared joint:** when the two segments share a joint *J*, an intersection within `JOINT_TOUCH_DISTANCE` (0.5 m) of *J* is dropped. That covers a joint where the tracks meet at an angle.
    - A real crossing elsewhere between two segments that share a joint is kept.
- **Duplicates:** refined crossings with the same other segment within `CROSSING_DEDUPE_DISTANCE` (0.5 m) of each other are one crossing; the first is kept. Short segments otherwise split one crossing's raw hits into several clusters.
- Returns `[]` for a segment that doesn't exist.
- It doesn't read or change the stored `collision` arrays.

### 2. `TrackCurveManager.getSegmentsAtJoint`

```ts
/** The segments with an end at joint `jointNumber`, which sits at `position`. */
getSegmentsAtJoint(jointNumber: number, position: Point): number[];
```

- It searches the R-tree in a 1 m box around `position` and keeps entries whose `t0Joint` or `t1Joint` is `jointNumber`.
- It takes a position so that it stays an R-tree lookup. The renderer also needs it after a segment has gone from the model, when only the joint numbers and end points it remembered are left.

### 3. The `lineStyle` segment style field

```ts
export type LinePreset = 'tunnel' | 'bridge' | 'planned' | 'disused';
export type LinePattern = 'solid' | 'dashed' | 'dotted' | 'dash-dot';

/** How the line styles draw a segment. Unset fields come from the preset, then the defaults. */
export type TrackLineStyle = {
    preset?: LinePreset;
    pattern?: LinePattern;
    /** 0xRRGGBB. */
    color?: number;
    /** Line width in screen pixels, 1 to 8. */
    width?: number;
};
```

`lineStyle?: TrackLineStyle` goes everywhere the existing style fields go:

- **Types:** `TrackSegment`, `TrackSegmentDrawData`, `SerializedTrackSegment`, `SegmentStyle` (optional, unset by default) and `SegmentStyleFields`.
- **`segment-style.ts`:**
    - `STYLE_KEYS` gains `lineStyle`.
    - `styleFieldsOf` and `segmentFieldsFromStyle` copy it shallowly (`{ ...lineStyle }`), so two segments never share one object.
    - `withStyleDefaults` leaves it unset when a save has none.
    - In `applyStylePatch`, a `lineStyle` key replaces the whole object, and `lineStyle: undefined` clears it. An object with no fields set is stored as unset.
- **`setNewSegmentStyle({ lineStyle: undefined })`** clears it, as it already does for `catenarySide`.
- **Draw data** copies it in `makeTrackSegmentDrawDataFromSplit` (`utils.ts`). `setSegmentStyle` already assigns the merged style to the draw data.
- **Save and load:**
    - `TrackCurveManager.serialize` writes `lineStyle` only when it is set.
    - `loadSegmentWithId` and the loader in `track.ts` pass it through the `style` argument.
    - Older saves load unchanged.
- **Validation** (`types.ts`, beside the `bedWidth` check), when `lineStyle` is present:
    - it must be an object
    - `preset` must be one of the four presets
    - `pattern` must be one of the four patterns
    - `color` must be an integer from 0 to 0xFFFFFF
    - `width` must be a finite number from 1 to 8
    - Errors follow the existing form, for example `segments[3].lineStyle.pattern must be one of solid, dashed, dotted, dash-dot`.
- **Splitting a segment** keeps its `lineStyle`, because `track.ts` already copies style with `styleFieldsOf`.

## Line geometry (`src/pixi/line-track-geometry.ts`, pure)

The module takes plain data and returns stroke instructions, with no Pixi objects, so it can be tested on its own.

### Parameterization

- Lines are sampled every `LINE_TRACK_SAMPLE_LEN` (2 m) of arc length, as `sampleCurve` does today.
- The samples are uniform in Bezier `t`, with `max(2, ceil(fullLength / 2))` steps. Each sample also carries its arc length `s = curve.lengthAtT(t)`, its unit tangent and its normal.
- **Elevation** is linear in Bezier `t`, through `getElevationAtT`, as everywhere else in the model.
- **Crossing positions** convert from `t` to `s` with `curve.lengthAtT(t)`.
- **Pattern, gap and deck lengths** are measured in `s`.

### Resolving a style

`resolveLineStyle(lineStyle?: TrackLineStyle): ResolvedLineStyle` applies the preset, then any fields set on the style:

| preset   | pattern | colour     | behaviour                           |
| -------- | ------- | ---------- | ----------------------------------- |
| (none)   | solid   | `0x000000` | none                                |
| `tunnel` | dashed  | `0x000000` | counts as underground everywhere    |
| `bridge` | solid   | `0x000000` | parapets along the whole segment    |
| `planned`| dashed  | `0x000000` | none                                |
| `disused`| dotted  | `0x999999` | none                                |

The width defaults to 1.

### Underground

A point at Bezier `t` is underground when the segment's preset is `tunnel`, or when `getElevationAtT(t)` is below the terrain height there (the sampler, or 0 without one).

- **Runs.** The samples are grouped into runs above and below ground.
    - Where the state changes between two samples, the boundary is found by linear interpolation of (track height − ground height).
    - That boundary is a **ground crossing**.
- **Look.**
    - Underground runs use the resolved pattern, except that `solid` becomes `dashed`.
    - Their colour is mixed `UNDERGROUND_LIGHTEN` (0.5) of the way to white. Default black becomes `0x808080`.
- **Portals.** Each ground crossing gets a portal: a bar across the track from −*P* to +*P* (see the sizes below). Its ends are bent `MARK_ANGLE` (45°) for `MARK_LENGTH` (1.5 m) toward the open-air side. It is drawn in the above-ground colour.
- **Tunnel-preset ends.** A `tunnel` segment gets a portal at an end unless one of these holds there:
    - the track is below ground at that end anyway
    - another segment at that joint is underground at its own end there

  So a tunnel made of several segments gets portals only at its two ends. An open end (no other segment at the joint) does get one.

### Patterns

Lengths are in screen pixels at width 1, and scale with the width:

| pattern    | on / off (px)             |
| ---------- | ------------------------- |
| `solid`    | none                      |
| `dashed`   | 6 on, 4 off               |
| `dotted`   | 1.5 on, 3 off             |
| `dash-dot` | 8 on, 3 off, 1.5 on, 3 off|

- The geometry module takes the current zoom (pixels per metre) and turns these into metres.
- The pattern's phase runs along `s` from the segment's start, so it doesn't restart after a gap or a portal.
- A line interval is never cut into more than `MAX_PATTERN_REPEATS` (4000) repeats. When it would be, the lengths are scaled up so that it gets exactly that many. Only very long track at very high zoom is affected.

### Crossings

`classifyCrossing` takes a crossing as seen from one segment and returns one of four results:

| result   | when                                                                                                                         | drawn                                            |
| -------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `level`  | the heights at the crossing differ by less than `VERTICAL_CLEARANCE` (3 m)                                                    | nothing                                          |
| `buried` | the heights differ by 3 m or more, and either track is underground at the crossing (terrain or `tunnel` preset)               | nothing                                          |
| `over`   | this segment is at least 3 m higher, and neither track is underground                                                         | a crossing deck on this segment                  |
| `under`  | this segment is at least 3 m lower, and neither track is underground                                                          | a gap in this segment                            |

The crossing angle θ is the angle between the two tangents at the crossing, folded into (0°, 90°].

**Crossing deck** (on the `over` segment):

- Two parapet lines at ±*P* from the centreline, running over `s_c ± L_deck`.
- `L_deck = (g_lower / 2 + DECK_CLEARANCE) / sin θ + P · |cot θ|`, capped at `MAX_MARK_HALF_LENGTH`.
- Each parapet end has a `MARK_LENGTH` wing, bent `MARK_ANGLE` outward: away from the centreline, and on along the track away from the deck. This is the `╲___╱` shape.
- A `bridge`-preset segment draws no crossing deck; its full-length parapets already cover the crossing.
- Decks that overlap or touch on one segment merge into one, with wings only at its outer ends.

**Gap** (on the `under` segment):

- Every line the segment draws is cut over `s_c ± L_gap`. That means the centreline, or both rails, and its own parapets if it is a `bridge` preset.
- `L_gap = (P_upper + GAP_CLEARANCE) / sin θ + r · |cot θ|`, capped at `MAX_MARK_HALF_LENGTH`.
- `r` is the segment's outermost line offset: 0 for `centerline`, `g / 2` for `rails`, or *P* for a `bridge` preset.

Gaps cut the track lines and parapets, not portals or wings.

**Clamping.** Decks and gaps are clamped to the segment they belong to, and a clamped deck end gets no wing. A crossing within a few metres of a joint can therefore leave a stub of the neighbouring segment's line, or a parapet without a wing. That's accepted.

### `bridge` preset

- Parapets at ±*P* run along the whole segment.
- Wings go at each end unless another segment at that joint is also a `bridge` preset. So a viaduct made of several segments gets wings only at its two ends.
- An open end gets wings.

### Colours and marks

- Portals, parapets and wings are solid, at the segment's resolved width.
- They take the colour of the part of the line they sit on: lightened when it is underground, except that portals always take the above-ground colour.

### Sizes

| name                       | value                                |
| -------------------------- | ------------------------------------ |
| *P* (parapet offset)       | `gauge / 2 + PARAPET_MARGIN` (1.5 m) |
| `MARK_LENGTH`              | 1.5 m                                |
| `MARK_ANGLE`               | 45°                                  |
| `DECK_CLEARANCE`           | 1.5 m                                |
| `GAP_CLEARANCE`            | 0.5 m                                |
| `MAX_MARK_HALF_LENGTH`     | 25 m                                 |
| `CROSSING_MERGE_T`         | 0.05                                 |
| `JOINT_TOUCH_DISTANCE`     | 0.5 m                                |
| `CROSSING_MIN_SIN`         | 0.02                                 |
| `CROSSING_DEDUPE_DISTANCE` | 0.5 m                                |
| `MAX_PATTERN_REPEATS`      | 4000                                 |
| `UNDERGROUND_LIGHTEN`      | 0.5                                  |
| `RESTROKE_ZOOM_STEP`       | √2                                   |

## Renderer integration (`TrackRenderSystem`, line styles only)

- **One graphics object per segment, as today.** It has the same key (`__simplified__N`), the band of the segment's higher end and the `rail` sublayer.
    - `_buildLineTrack` now builds it from the geometry module's output.
    - A segment is **styled** when its drawing depends on the zoom: it has a patterned run (any underground run, or a pattern other than `solid`), or a width above 1.
    - An unstyled segment strokes with `pixelLine`, exactly as today. That includes a solid width-1 `bridge` preset and any crossing marks, which are sized in metres.
    - A styled segment:
        - at width 1 still strokes with `pixelLine`, with its pattern turned into metres at the current zoom
        - when wider, strokes at `width / zoom` world units
- **The dashed overlay** (`_undergroundIndicatorMap`) is no longer drawn in the line styles. `detailed` keeps it.
- **Partner map.** `segment → crossing partners`, plus each drawn segment's joints and end points.
    - **Add:** call `getCrossings(n)`, record the partners both ways, and draw `n`. Then redraw each partner, and each segment at `n`'s joints that has a `tunnel` or `bridge` preset.
    - **Remove:** destroy `n`'s graphics and redraw its recorded partners. The model no longer has `n`, so their gaps or decks go. Then find the preset segments at `n`'s remembered joints with `getSegmentsAtJoint`, redraw them, and forget `n`.
    - **Style change** (`onSegmentStyleChanged`): redraw `n`, its partners, and the preset segments at its joints. A `lineStyle` change can turn a crossing buried or change a run's ends. Gauge isn't a style field, so it can't change here.
        - It also fixes an existing gap: today a style change doesn't redraw a line-style segment at all.
    - **Render-style switch:** the existing full redraw rebuilds the map. Switching to `detailed` clears it.
    - **Redraw** rebuilds a segment's graphics in place, from `getTrackSegmentWithJoints(n)`.
- **Zoom.** Each styled segment remembers the zoom it was stroked at, *z₀*. On a zoom event, any segment where max(z/z₀, z₀/z) ≥ √2 is re-stroked from its cached samples and runs, without sampling again.
- **Previews** (`_drawLinePreview`):
    - Each preview piece is drawn with its own elevation and the new-track `lineStyle`, which comes from the draw data.
    - It gets underground runs, portals and, for a `bridge` preset, full-length parapets with wings at both ends.
    - It gets no crossing marks and no joint-neighbour checks.
    - Zooming doesn't re-stroke a preview; it is redrawn on its next change.
- **Load.** Each add redraws partners that are already laid, so a segment with *k* crossings laid after it is drawn *k* + 1 times. Crossings are sparse, so loading isn't batched.
- **Terrain** is sampled when a line is built, as today. There is no setter.

## Package surface

- **Package root:**
    - `TrackCrossing`, `TrackLineStyle`, `LinePreset`, `LinePattern`
    - `LINE_PRESETS` and `LINE_PATTERNS`, the allowed values, for an app's dropdowns
    - `normalizeLineStyle`, the gate every stored `lineStyle` passes through: it keeps only valid values and clamps `width` to 1 to 8
    - the methods `getCrossings` and `getSegmentsAtJoint`
- **`track-layout/pixi`:** no new exports. The geometry module is internal, and tests import it from `src/`.
- **Docs:**
    - The `TrackRenderStyle` comment: the line styles draw bridges at grade-separated crossings, underground track lighter and broken with portals, and each segment's `lineStyle`.
    - README, "Drawing a layout with Pixi": a short subsection on bridges, underground track and `lineStyle`, with a `setSegmentStyle(n, { lineStyle: { preset: 'planned', color: 0x2266cc } })` example.

## Testing (`bun test`, typecheck, format check)

- **`test/track-crossings.test.ts`** (model):
    - an X crossing is found from both segments, once, with `t` / `otherT` refined to the exact crossing
    - a continuation and a junction that share a joint report nothing
    - two segments that share a joint and also cross elsewhere report only the crossing
    - a removed segment drops out of its partner's crossings
    - `getSegmentsAtJoint` finds both ends of a junction, and nothing at an unrelated joint
- **`test/segment-line-style.test.ts`** (model):
    - `applyStylePatch` replaces and clears `lineStyle`, and turns `{}` into unset
    - `styleFieldsOf` copies it, so the source can be mutated without effect
    - `setNewSegmentStyle` clears it
    - `setSegmentStyle` fires the style event with it
    - it is written by `serialize` only when set, and loads back
    - an older save without it loads
    - each validation error
    - splitting a segment keeps it
- **`test/line-track-geometry.test.ts`** (pure geometry):
    - `resolveLineStyle` for each preset, with fields set on top
    - with flat ground and with a sampler: underground runs; a ramp's ground crossing at the interpolated point; a portal there; no portal on fully underground track
    - underground `solid` becomes `dashed`, and the colour lightens
    - pattern lengths in metres at two zoom levels and at width 3; phase continues across a gap
    - `classifyCrossing` for `level`, `over`, `under` and `buried`, by terrain and by `tunnel` preset
    - `L_deck` and `L_gap` at 90°, at 30°, and capped at a shallow angle; `r` for `centerline`, `rails` and a `bridge` preset
    - clamping at a segment end, with no wing there
    - `tunnel` and `bridge` run ends with and without matching neighbours, and at an open end
- **`test/track-render-system.test.ts`**, extending the "line styles" section through `RecordingLayerHost` and `strokedLines`:
    - in both line styles, a segment over another gets parapets with wings, and the lower line has a gap
    - removing the upper segment restores the lower line unbroken
    - a level crossing and a buried crossing draw no marks
    - an underground segment is drawn broken and lighter, with no separate overlay
    - a ramp gets a portal
    - a preview is drawn underground and with the new-track line style
    - the upper segment becoming a `tunnel` preset redraws its partner unbroken
    - a `lineStyle` change redraws the segment and a `tunnel`-preset neighbour's portal
    - styled segments re-stroke after a √2 zoom change; unstyled ones and smaller zoom changes don't
    - `detailed` ignores `lineStyle` and still draws its overlay (the existing tests cover the rest)

## Release and apps

- **track-layout:**
    - Develop on `claude/bridge-underground-track-render-3rg5de`.
    - Release 0.8.0 through the Release workflow, dry run first, triggered by the owner.
    - Before release, clapham can be tried against `bun run pack:local`.
- **clapham:** a follow-up spec pins `^0.8.0` and adds a line-style control for selected segments and for new track.
- **banana:** no change.

## Known issues noticed, out of scope

These come from reading banana's code; they haven't been reproduced by running it.

- Banana's `TrackRenderSystem` is given the original flat `TerrainData` in `init-app`. Loading a scene or importing terrain only calls `terrainRenderSystem.setTerrainData`, so tunnels and underground lines keep using the flat terrain.
- `serializeSceneData` writes `app.terrainData`, the original object, so loaded or imported terrain looks like it would be lost on re-save.
- `TrackCurveManager`'s stored `collision` arrays are one-sided, and after a load they include touches at shared joints. `getCrossings` doesn't use them.
