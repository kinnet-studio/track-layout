# track-layout phase 2: laying and editing — design

- **Date:** 2026-10-01
- **Status:** Approved design; ready for an implementation plan
- **Parent spec:** `docs/superpowers/specs/2026-10-01-track-layout-extraction-design.md` (phases 2–4 outline)
- **Source:** banana `main` at `92ca5a3` (phase 1 merged), `~/dev/banana/main`
- **Package:** `track-layout` 0.1.0 published; this phase releases 0.2.0

## Goal

Move banana's track-laying and editing logic into `track-layout` and export it as `track-layout/editing`. That logic covers:
- the preview-curve calculator
- the curve engine
- the layout, joint-direction, duplicate-to-side and catenary tools

Banana keeps its tool switcher and uses the package's machines and engines. The new canvas layout editor will later compose the same machines into its own tool switcher.

## Non-goals

- A shared tool switcher. The package exports the individual machines and engines, and each app composes its own switcher. A shared one can be designed with the new app.
- Splitting `CurveCreationEngine` into a pure service and a controller. This phase lifts and decouples the engine; it does not restructure it.
- Station placement (phase 3) and renderers (phase 4).
- Removing the remaining debug `console.log` calls. Only the two full-graph dumps go (change 5).
- New laying constraints such as minimum radius, maximum grade or grid snapping.

## Decisions

| Topic | Decision |
|---|---|
| Approach | Lift and decouple, as in phase 1. |
| Scope | Machines and engines only; no shared tool switcher. |
| Entry point | New subpath `track-layout/editing`. The package root does not re-export it. |
| Peer | `@ue-too/being ^0.19.0`, optional (`peerDependenciesMeta`). |
| Graph ownership | The app creates the `TrackGraph` and passes it to the engine. The engine no longer exposes `trackGraph`. |
| Coordinates | The engine takes a `convertWindowToWorld` function and no longer extends `ObservableInputTracker`. |
| Banana base | A new branch `feat/track-layout-phase-2` from banana `main`. |
| Release | `track-layout` 0.2.0. Banana uses the local tarball while the phase is in progress, then pins `^0.2.0`. |

## What moves

All destinations are under `track-layout/src/editing/`.

| banana source | destination |
|---|---|
| `src/trains/tracks/new-joint.ts` (`PreviewCurveCalculator`) | `new-joint.ts` |
| `src/trains/tracks/duplicate-geometry.ts` | `duplicate-geometry.ts` |
| `src/trains/input-state-machine/types.ts` | `types.ts` |
| `src/trains/input-state-machine/curve-engine.ts` | `curve-engine.ts` |
| `src/trains/input-state-machine/layout-kmt-state-machine.ts` | `layout-kmt-state-machine.ts` |
| `src/trains/input-state-machine/joint-direction-state-machine.ts` | `joint-direction-state-machine.ts` |
| `src/trains/input-state-machine/duplicate-to-side-engine.ts` | `duplicate-to-side-engine.ts` |
| `src/trains/input-state-machine/duplicate-to-side-state-machine.ts` | `duplicate-to-side-state-machine.ts` |
| `src/trains/input-state-machine/catenary-layout-engine.ts` | `catenary-layout-engine.ts` |
| `src/trains/input-state-machine/catenary-layout-state-machine.ts` | `catenary-layout-state-machine.ts` |
| `createLayoutStateMachine` from `src/trains/input-state-machine/utils/factory.ts` | added to `layout-kmt-state-machine.ts`, next to the states, as the other machines' factories are |

- The ten files import only each other, `track-layout` (the model) and `@ue-too/*`.
- Inside the package, model imports point at the package's own modules (`'../index.js'`), not at `'track-layout'`.
- `src/editing/index.ts` re-exports these modules. `package.json` `exports` gains `"./editing": { "types", "import", "default" }`.
- Banana's `utils/factory.ts` has two other helpers, `createCurveCreationEngine` and `createLayouyStateMachineWithDefaultContext`. Neither is used, so banana deletes the whole `input-state-machine/utils/` folder.

**Stays in banana:**
- `tool-switcher-state-machine.ts` and `kmt-state-machine-extension.ts`
- `train-kmt-state-machine.ts`
- the station placement machines (phase 3)
- the renderers (phase 4)
- `procedural-tracks.ts`

## Changes made during the move

1. **The app owns the graph, and the engine takes a coordinate converter.**
   - Constructor: `new CurveCreationEngine(trackGraph: TrackGraph, convertWindowToWorld: (position: Point) => Point)`.
     - The engine no longer extends `ObservableInputTracker`.
     - It drops its `canvas` and `camera` fields and stops importing the board's coordinate helpers.
     - `convert2WorldPosition(p)` stays, because `LayoutContext` needs it, but it now delegates to the injected function.
   - The `trackGraph` getter is removed. Banana's `init-app`:
     - creates the `TrackGraph`
     - builds a `windowToWorld(canvas, camera)` helper, which is the code that leaves the engine
     - passes both to the engine
     - passes the same helper to the duplicate-to-side and catenary engines and to the joint-direction context
     - exposes the graph as `app.trackGraph` (`BananaAppComponents.trackGraph`)

     Every `curveEngine.trackGraph` in banana becomes `trackGraph`: 31 uses across `init-app` (11), `use-render-sync.ts` (7), `BananaToolbar.tsx` (6), `scene-serialization.ts` (5) and `TimetablePanel.tsx` (2).
2. **`convert2WindowPosition` is removed** from the engine and from `LayoutContext`. The layout state machine never calls it, and nothing else in banana calls the engine's version.
3. **The joint-direction factory takes its context.**
   - New signature: `createJointDirectionStateMachine(context: JointDirectionContext)`.
   - Banana passes the object it now hands to `setContext`, built before the machine.
   - Today the factory builds the machine with a stub context (`{ setup, cleanup }`) that lacks the required members. That causes banana's 2 type errors in this file, which must not move into the package's clean typecheck. Banana's pre-existing `tsc` errors go from 11 to 9.
4. **`insertJointIntoTrackSegment` returns `number | null`** on `CurveCreationEngine` and in `LayoutContext`, passing through the graph's result (phase 1 made the graph return it). This was a follow-up from phase 1's final review.
5. **The engine stops dumping the whole graph to the console:**
   - It no longer calls `trackGraph.logTrackSegments()` after every commit (`curve-engine.ts:894`).
   - It no longer calls `trackGraph.logJoints()` after every split (`:911`).

   That's output proportional to the whole layout on every edit. The other debug logging stays as a known follow-up.

Everything else in the engine's API is unchanged:
- `startCurve`/`endCurve` and the hover methods
- the gauge setter (`setCurrentGauge`)
- tension (`currentTension`, `bumpTension`, `lowerTension`) and elevation
- `onElevationChange` and `onTensionChange`
- the preview-draw-data, start/end projection and deletion-highlight observables
- phase 1's check that refuses a branch off the middle of a platform's track

## Testing

### In track-layout

Order: port verbatim, then change 1 (the minimum needed to build an engine in a test), then characterization tests, then changes 2–5, each with its own tests.

- **Ported:** `duplicate-geometry.test.ts` (5 tests).
- **Preview-curve calculator:**
  - which curve type each start/end joint combination produces (straight, quadratic, reversed quadratic, cubic)
  - how tension affects the control points
  - flipping the tangents to face the chord
- **Curve engine**, using an identity `convertWindowToWorld` so that window coordinates equal world coordinates:
  - **Snapping:** the start joint type reported after hovering over empty space (`new`), a dead end (`extendingTrack`), a joint with several connections (`branchJoint`), the middle of a curve (`branchCurve`) and beside a track (`contrained`).
  - **A full lay:** start, hover start, hover end, commit. It yields the expected joints and segment, and the end point becomes the next start.
  - **Refused commits:** each leaves the graph unchanged:
    - extending a dead end back over its own track
    - a gauge mismatch at a branch joint or curve
    - a sloped branch
    - branching off the middle of a protected segment, with no orphaned joint
  - **Deletion:** hovering highlights a segment, and deleting removes it.
  - **Observables:** preview draw data fires while hovering and clears on cancel; projections fire.
- **State machines**, each driven through a fake context that records calls:
  - layout: idle → hover for start → hover for end → commit and chain → failure path → escape → deletion mode
  - joint direction: hover, select, cycle
  - duplicate-to-side and catenary: their commit paths
- **Typecheck** stays clean, which proves change 3.

### In banana

On branch `feat/track-layout-phase-2`, using the 0.2.0 tarball:
- `bun test` gives 729 passing tests: 734 minus `duplicate-geometry.test.ts`'s 5.
- `tsc` shows 9 errors: the previous 11 minus the 2 in `joint-direction-state-machine.ts`, which moves away.
- The build and format check are clean.

**Owner play-test**, once at the end:
- lay, extend, branch at a joint and mid-curve, and delete track
- the flip-tangent, straight-line, tension and elevation keys
- duplicate to side
- catenary
- the joint-direction tool
- branching off the middle of a platform's track is refused
- save and reload

## Banana's side

1. Branch `feat/track-layout-phase-2` from `main`.
2. Install the 0.2.0 tarball (`bun run pack:local` in `track-layout`, `bun add` in banana).
3. Delete:
   - the 10 moved files
   - `input-state-machine/utils/`
   - `test/duplicate-geometry.test.ts`
4. Repoint imports. The repoint script maps modules that moved to `src/editing/` to `'track-layout/editing'` and everything else to `'track-layout'`.
   - Barrel imports are fixed by hand, as in phase 1. `render-system.ts` imports `CurveCreationEngine` from `'../input-state-machine'`. The tool switcher imports `CurveCreationEngine` and `createLayoutStateMachine` from `'.'`, together with `TrainPlacementStateMachine`.
   - `input-state-machine/index.ts` keeps only its banana exports.
5. Apply changes 1 and 3 in `init-app`, and switch `curveEngine.trackGraph` to `trackGraph`.
6. Verify (729 / 9 / build / format), then the owner play-test. You publish 0.2.0, banana pins `^0.2.0`, and banana opens a PR.

## Known follow-ups (out of scope)

- The remaining debug logging in the engine and the model.
- A shared editing tool switcher, decided with the new app's spec.
- From phase 1:
  - `TrackCurveManager.experimental()` builds draw data without style (phase 4)
  - multiple `track-layout` import statements in banana files

## Risks

- **Removing the `trackGraph` getter touches 31 uses across 5 banana files.** A missed one fails `tsc`, not just at runtime, so the typecheck catches it.
- **The coordinate conversion moves from the engine to banana.** If the helper differs from the engine's code, snapping would be offset. The helper is the engine's own code moved unchanged, and the play-test covers snapping.
- **The tests describing today's behaviour are new**, written against an engine that has never had tests. A case that fails against the unchanged code means the expectation is wrong, never the code.
