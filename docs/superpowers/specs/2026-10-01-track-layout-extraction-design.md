# track-layout: extracting banana's track and station logic — design

- **Date:** 2026-10-01
- **Status:** Approved design; phase 1 ready for an implementation plan
- **Source:** banana `main` at `b26692b` (`~/dev/banana/main`)
- **Target repo:** `~/dev/track/main`, published to npm as `track-layout`

## Goal

Move banana's track-laying and station-placement logic into a standalone,
npm-published library, `track-layout`. Two apps will consume it:

1. **banana**, the railway simulator it comes from. Banana switches to the
   package one phase at a time and deletes its own copy as it goes.
2. **A new infinite-canvas railroad layout editor.** It lays freeform,
   real-scale Bezier track (the same model as banana) without trains,
   timetables, signals or terrain. The app is a separate, later project and is
   not set up here.

## Non-goals

- Building the new layout editor app. It gets its own spec once phase 2 ships.
- Shared scene files between banana and the editor. Each app keeps its own
  save envelope, and `track-layout` only provides per-manager serialization.
- Undo/redo or a command layer. These can be added later on top of the lifted
  APIs.
- Removing the `@ue-too/*` dependencies. `track-layout` keeps depending on them.
- Splitting trains, timetables, signals, terrain or buildings out of banana.
- New track constraints such as minimum radius, maximum grade or grid snapping.

## Decisions

| Topic | Decision |
|---|---|
| Package name | `track-layout`: unscoped, not under `@ue-too`. Available on npm, and the punctuation-collision rule doesn't block it (`tracklayout` is also free). |
| Repo | `~/dev/track/main` is the library itself. |
| `@ue-too` | Kept as **peer** dependencies at `^0.19.0`. Banana upgrades from 0.17.3. |
| Scope | Model + serialization, laying/editing, station placement, Pixi renderers, each in its own phase. |
| Approach | **Lift and decouple.** Move the code mostly as-is, keep its APIs, cut the banana ties by injecting dependencies, and fix the known problems along the way. |
| Banana migration | One phase at a time. Each phase ends with banana on the published package and its copy deleted. |
| Git history | Fresh. The first code commit names banana `b26692b` as its source. |
| Splits under platforms | Blocked by the existing segment-protection check. Recomputing platform references after a split is a follow-up. |

## Package shape

### Entry points

One package. Its subpath exports are added phase by phase:

| Import | Phase | Contents | Peer deps |
|---|---|---|---|
| `track-layout` | 1 | Track graph, joints, segments, R-tree, entity manager, station and platform models, joint-direction preferences, serialization and validation | `@ue-too/board`, `@ue-too/curve`, `@ue-too/math` |
| `track-layout/editing` | 2 | Preview-curve calculator, curve engine, layout, joint-direction, duplicate-to-side and catenary state machines and engines | + `@ue-too/being` |
| `track-layout/station-placement` | 3 | Island station, single-spine and dual-spine placement state machines, and the preview interfaces | + `@ue-too/being` |
| `track-layout/pixi` | 4 | Track, station, platform and joint-direction renderers | + `pixi.js` (`^8.14.0`) |

`@ue-too/being` and `pixi.js` are marked optional in `peerDependenciesMeta`.
The `@ue-too` packages are peers, not regular dependencies, because both
apps must share one instance of the observable and state-machine types.

### Tooling

- **Bun** is the runtime and package manager. Tests use `bun test` with
  `bun:test` imports.
- **TypeScript.** `tsc -p tsconfig.build.json` emits ESM and `.d.ts` files
  into `dist/` without bundling, so subpath imports stay tree-shakeable.
  `package.json` `exports` maps each subpath to its `types` and `import`
  targets.
- **Prettier** uses banana's `.prettierrc` (4-space indent, single quotes,
  `es5` trailing commas, sorted imports).
- **CI** (GitHub Actions) runs `prettier --check`, `tsc --noEmit` and
  `bun test`.

### Source layout

```
src/
  index.ts                 # root entry (phase 1)
  shared/
    entity-manager.ts      # GenericEntityManager, from banana src/utils.ts
    r-tree.ts              # from banana src/trains/r-tree.ts
  tracks/                  # from banana src/trains/tracks/ (model files only)
  stations/                # from banana src/stations/ (model files only)
  editing/                 # phase 2
  station-placement/       # phase 3
  pixi/                    # phase 4
test/
```

File names match banana's, so each moved file can be diffed against its
original.

### Release loop

1. While a phase is in progress, banana uses the working copy through
   `bun link` (`bun link` in `track/main`, then `bun link track-layout` in
   banana).
2. At the end of the phase, publish: 0.1.0 after phase 1, 0.2.0 after phase 2,
   and so on.
3. Banana replaces the link with the published version and deletes its copy of
   the moved code.

The package stays at 0.x while banana is its only consumer. A breaking change
between phases is acceptable as long as banana moves to the new release in the
same phase.

## Phase 1: model and serialization (`track-layout` root)

### What moves

The moved files only import each other and the `@ue-too` peers, except for the
timetable types, which change 4 removes.

| banana source | track-layout destination |
|---|---|
| `src/trains/tracks/track.ts` (TrackGraph) | `src/tracks/track.ts` |
| `src/trains/tracks/trackcurve-manager.ts` | `src/tracks/trackcurve-manager.ts` |
| `src/trains/tracks/trackjoint-manager.ts` | `src/tracks/trackjoint-manager.ts` |
| `src/trains/tracks/types.ts` | `src/tracks/types.ts` |
| `src/trains/tracks/utils.ts` | `src/tracks/utils.ts` |
| `src/trains/tracks/constants.ts` | `src/tracks/constants.ts` |
| `src/trains/tracks/gauge-presets.ts` | `src/tracks/gauge-presets.ts` |
| `src/trains/tracks/parallel-spacing.ts` | `src/tracks/parallel-spacing.ts` |
| `src/trains/tracks/joint-direction-preference-map.ts` | `src/tracks/joint-direction-preference-map.ts` |
| `src/trains/r-tree.ts` | `src/shared/r-tree.ts` |
| `src/utils.ts` (`GenericEntityManager` only) | `src/shared/entity-manager.ts` |
| `src/stations/types.ts` | `src/stations/types.ts` |
| `src/stations/station-manager.ts` | `src/stations/station-manager.ts` |
| `src/stations/station-factory.ts` | `src/stations/station-factory.ts` |
| `src/stations/track-aligned-platform-manager.ts` | `src/stations/track-aligned-platform-manager.ts` |
| `src/stations/track-aligned-platform-types.ts` | `src/stations/track-aligned-platform-types.ts` |
| `src/stations/track-aligned-platform-migration.ts` | `src/stations/track-aligned-platform-migration.ts` |
| `src/stations/spine-utils.ts` | `src/stations/spine-utils.ts` |
| `src/stations/arc-length-resolver.ts` | `src/stations/arc-length-resolver.ts` |
| `src/stations/platform-offset.ts` | `src/stations/platform-offset.ts` |
| `src/stations/stop-position-utils.ts` | `src/stations/stop-position-utils.ts` |

The root `src/index.ts` re-exports these modules' public symbols. It does not
re-export rendering or input code; banana's barrels do, which is what pulls
Pixi and train code in by accident.

### What stays in banana during phase 1

- Curve engine and the layout/tool state machines (phase 2).
- Placement state machines (phase 3).
- Renderers, plus `geometry-utils.ts` and `tunnel-geometry.ts` (phase 4).
- The debug overlay, which reads trains.
- `procedural-tracks.ts`, a dev and stress-test tool.
- The shadow helpers in `src/utils.ts` (phase 4).
- The scene envelope in `scene-serialization.ts`.
- `track-arc-utils.ts`, which depends on formations.

All of these change their imports to `track-layout`.

### Changes made during the move

1. **Segment style moves into the model.**
   - `TrackSegment` already declares `trackStyle`, `electrified`,
     `catenarySide`, `bed` and `bedWidth`, but they are filled in by
     `TrackRenderSystem._onNewTrackData`
     (banana `render-system.ts:2049-2063`), not by the model.
   - `TrackGraph` gets a new-segment style, set with
     `setNewSegmentStyle(style: Partial<SegmentStyle>)`. The graph applies it
     to every segment it creates. Splits already copy style from the parent
     segment (`track.ts:164`).
   - New `TrackGraph.setSegmentStyle(segmentNumber, patch)` fires a new
     `onSegmentStyleChanged({ segmentNumber, style })` observable. Banana's
     catenary tool calls it instead of changing the renderer's per-segment
     data directly (`render-system.ts:299-302, 402-451`).
   - Remove the `visualProps` fallback in `TrackCurveManager.serialize()`
     (`trackcurve-manager.ts:1137-1158`) and `getVisualPropsForSegment`.
     Serialization reads only from the segment.
   - `SegmentStyle` is `{ trackStyle, electrified, catenarySide, bed, bedWidth }`.
     It ships with exported `DEFAULT_SEGMENT_STYLE`: `trackStyle: 'ballasted'`,
     `electrified: false`, `bed: false` and `bedWidth: 3`, with
     `catenarySide` unset. These match banana's current renderer and
     `render-settings-store` defaults.
   - When loading, each style field missing from a saved segment gets its
     default written into the model.
   - Banana: the toolbar and `use-render-sync` push style into
     `trackGraph.setNewSegmentStyle`, the renderer's stamping step is removed,
     and the renderer reads style from the segment, re-rendering on
     `onSegmentStyleChanged`.
2. **`bedWidth` is saved.** Add `bedWidth?: number` to
   `SerializedTrackSegment` and restore it in `loadSegmentWithId`. Older saves
   without it still load.
3. **No direct `requestAnimationFrame`.** `loadFromSerializedData` takes an
   optional `yieldToFrame?: () => Promise<void>` alongside `onProgress`. By
   default it uses double-rAF when `requestAnimationFrame` exists and
   `setTimeout(0)` otherwise, so banana behaves as before without being
   rewired.
4. **No timetable code in the package.**
   - Remove `findShiftsReferencingStopPosition` from `StationManager`
     (`station-manager.ts:183`) and `TrackAlignedPlatformManager`
     (`track-aligned-platform-manager.ts:234`), along with their
     `ShiftTemplateManager`/`ShiftTemplate` type imports.
   - Banana gets equivalent free functions in its timetable module, used by
     `PlatformEditorPanel.tsx:330,338`.
5. **Platforms stay valid when a segment is split.**
   - `insertJointIntoTrackSegmentUsingTrackNumber` and
     `insertJointIntoTrackSegment` refuse to split a protected segment, using
     the existing `setSegmentProtectionCheck` callback (`track.ts:70`) that
     `removeTrackSegment` already uses.
   - A refusal uses each method's existing failure return:
     `insertJointIntoTrackSegmentUsingTrackNumber` returns `null` (its
     signature is `number | null`), and `insertJointIntoTrackSegment` takes its
     early-return path.
   - Banana's curve engine treats a refused split as a rejected commit, so
     branching off the middle of a platform's track does nothing.

### Save format

Unchanged, except for the optional `bedWidth` in each segment. Existing
validation (`validateSerializedTrackData`) and the shape-detection migrations
(legacy dual-spine platforms, filling in missing stop IDs) move along with
their managers.

### Banana's side of phase 1

1. Upgrade `@ue-too/*` from 0.17.3 to 0.19.0. Banana doesn't use
   `CompositeState` or `HierarchicalStateMachine`, which 0.19 removed. Run the
   tests and play-test before going further.
2. `bun link track-layout`, and repoint every import of a moved module.
3. Delete the moved files. Remove `GenericEntityManager` from
   `src/utils.ts`, which keeps its shadow helpers.
4. Rewire style through the model (change 1) and move the shift lookup
   (change 4).
5. Pass the verification gate (below), publish `track-layout@0.1.0`, and pin
   it in banana.

## Phases 2–4 (outline; each gets its own spec and plan)

### Phase 2: laying and editing (`track-layout/editing`)

- **Moves:**
  - `new-joint.ts` (`PreviewCurveCalculator`), `curve-engine.ts`
  - `layout-kmt-state-machine.ts`, `input-state-machine/types.ts`
  - `joint-direction-state-machine.ts`
  - `duplicate-to-side-engine.ts`, `duplicate-to-side-state-machine.ts`,
    `duplicate-geometry.ts`
  - `catenary-layout-engine.ts`, `catenary-layout-state-machine.ts`
- **Graph ownership is inverted.** The app creates the `TrackGraph` and passes
  it to `CurveCreationEngine` (banana `curve-engine.ts:113` currently creates
  it). Banana stops reaching the graph through `curveEngine.trackGraph`.
- **No canvas or camera inside the engine.** It no longer extends
  `ObservableInputTracker(canvas)` and takes a
  `convertWindowToWorld(p: Point): Point` function instead, the pattern
  `DuplicateToSideEngine` already uses (`init-app.ts:560-563`).
- **Push-style setters stay as they are:** gauge, projection buffer and bed
  settings.
- **Banana keeps** the tool switcher, the KMT extension and train placement.
  The package exports the individual tool state machines and their context
  types, and each app composes its own tool switcher.

### Phase 3: station placement (`track-layout/station-placement`)

- **Moves:** `station-placement-state-machine.ts`,
  `single-spine-placement-state-machine.ts`,
  `dual-spine-placement-state-machine.ts`.
- **Previews go through interfaces the app implements**
  (`showPreview`, `hidePreview`, `showTrackHighlight`, `show*Preview`), not
  calls into banana's render systems.
- **Commits go through the managers.** The managers gain granular add/remove
  events that renderers subscribe to; the state machines no longer call
  `renderSystem.addStation`/`addPlatform` directly.
- **Gauge comes from an injected getter**, not `useGaugeStore.getState()`.
- The exact interface shapes are settled in the phase 3 spec.

### Phase 4: Pixi renderers (`track-layout/pixi`)

- **Moves:** `render-system.ts` (tracks), `station-render-system.ts`,
  `track-aligned-platform-render-system.ts`,
  `joint-direction-render-system.ts`, `geometry-utils.ts`,
  `tunnel-geometry.ts`, and the shadow helpers.
- **The debug overlay stays in banana**, because it reads trains and the
  proximity detector.
- **Layer host interface.** Banana's `WorldRenderSystem` orders tracks,
  trains and buildings by elevation. It is replaced by a small layer-host
  interface that banana's `WorldRenderSystem` implements. The package ships a
  basic default for apps without other elevation-ordered content.
- **Terrain is optional.** Tunnels use an optional terrain sampler (height at a
  point) instead of importing banana's `terrain-data`. With no sampler there
  are no tunnels.

### Order

Each phase builds on the previous phase's published release. The new editor
app can start once phase 2 ships; until phase 4 it needs its own throwaway
renderer.

## Testing and verification

### In track-layout

- **Ported tests.** These move with the code, with import paths changed and
  test bodies untouched:
  - `serialization.test.ts`, `entity-manager.test.ts`,
    `joint-direction-preference-map.test.ts`, `gauge-presets.test.ts`,
    `parallel-spacing.test.ts`
  - `arc-length-resolver.test.ts`, `platform-offset.test.ts`,
    `spine-utils.test.ts`, `stop-position-utils.test.ts`
  - `station-manager-cascade.test.ts`,
    `station-manager-change-notification.test.ts`
  - `track-aligned-platform-manager.test.ts`,
    `track-aligned-platform-migration.test.ts`
  - `scene-dual-spine-station-link.test.ts`
  - `station-manager-stop-crud.test.ts` and
    `track-aligned-platform-stop-crud.test.ts`. Their
    `ShiftTemplateManager` cases stay in banana alongside the moved helper.
- **New characterization tests**, written against current behaviour before the
  code changes:
  - `connectJoints`; `insertJointIntoTrackSegment*`, including flat vs.
    sloped segments
  - `removeTrackSegment`, including the switch-side guard and orphan-joint
    cleanup
  - `project` hit categories
- **New tests for the changes:**
  - style saved and reloaded with no renderer
  - `setNewSegmentStyle` applied when segments are created and copied on
    splits
  - `setSegmentStyle` firing `onSegmentStyleChanged`
  - `bedWidth` saved and reloaded
  - default style filled in when loading old saves
  - a split refused on a protected segment
  - `yieldToFrame` called between loading batches
- **Golden save file.** A real banana scene saved before the migration is
  checked in as `test/fixtures/banana-scene-b26692b.json`. Load then save must
  reproduce identical
  tracks, stations, track-aligned platforms and joint-direction preferences,
  apart from the style defaults and `bedWidth` being filled in.
- **CI:** `prettier --check`, `tsc --noEmit`, `bun test`.

### In banana, at the end of each phase

- `bun test` passes in full against the linked package. That includes the
  train, signal and timetable tests that use `TrackGraph` as a fixture, which
  act as integration coverage.
- **Manual play-test checklist:**
  - lay, extend, branch at a joint and branch mid-curve
  - delete track
  - change style and electrify
  - save and reload a new scene, and load a scene saved before the migration
  - place island, single-spine and dual-spine stations
  - edit stop positions
  - run a train across a junction
- Banana switches from `bun link` to the published version only after both
  pass.

## Known issues and follow-ups (out of scope)

- Recomputing track-aligned platform and island-station references after a
  segment split, instead of blocking the split.
- Island-station `Platform.track` and stop positions are not protected
  against segment deletion.
- `extendTrackFromJoint`, `branchToNewJoint` and `createNewTrackSegment`
  (used only by banana's procedural tracks) don't mark draw data as dirty.
- `pointOnJoint` scans every joint (`track.ts:944`); joints are not in the
  R-tree.
- Draw data and z-ordering (`orderTest`) live in `TrackCurveManager`. They
  are pure but render-oriented, and may move toward `track-layout/pixi` in
  phase 4.
- Undo/redo and a command layer for the editor app.

## Risks

- **The `@ue-too` upgrade from 0.17 to 0.19** can change behaviour beyond
  removed APIs, for example "camera owns copies of its limit objects" (#449).
  It's mitigated by doing the upgrade as its own first step, with a test and
  play-test gate.
- **Moving style into the model** changes how banana's renderer gets style.
  A missed code path would draw a segment with the default style. It's
  mitigated by the style tests and the play-test checklist (including old
  saves).
- **Blocking splits under platforms** is a visible behaviour change in banana.
  Branching off the middle of a platform's track is now refused rather than
  silently corrupting platform references.
