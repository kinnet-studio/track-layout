# track-layout

Railway track layout model for freeform, real-scale Bezier track: a track
graph with junctions and elevation, stations and platforms, and save/load.

Extracted from [banana](https://banana.vntchang.dev), a 2D railway simulator.
Built on the [@ue-too](https://github.com/kinnet-studio/ue-too) packages,
which are peer dependencies.

> Status: 0.x. APIs may change between minor versions.

## Install

```bash
bun add track-layout @ue-too/board @ue-too/curve @ue-too/math
```

## Example

```ts
import { TrackGraph } from 'track-layout';

const graph = new TrackGraph();
const east = { x: 1, y: 0 };
const a = graph.createNewEmptyJoint({ x: 0, y: 0 }, east);
const b = graph.createNewEmptyJoint({ x: 100, y: 0 }, east);

// Straight track is a quadratic curve with its midpoint as control point.
graph.setNewSegmentStyle({ trackStyle: 'slab' });
graph.connectJoints(a, b, [{ x: 50, y: 0 }], 1.067);

const saved = JSON.stringify(graph.serialize());
```

## Heights

Heights are free values in metres, not levels. A joint, a segment end and a
station each hold one. `createNewEmptyJoint` takes the joint's height as its
third argument, and the example above lays flat track at 0 m.

- **Range and rounding.** Heights run from `HEIGHT_MIN` (-200 m) to
  `HEIGHT_MAX` (200 m) and are rounded to 0.01 m. The model rounds the
  heights it is given when it lays, splits, saves and loads; `roundHeight`,
  `clampHeight` and `isValidHeight` are exported for your own code.
- **Migrating level saves.** Older saves held heights as whole levels of
  10 m, from -3 to +3. `levelsToMetres` converts a save's track and
  stations before you load them. It returns new objects, and passes
  malformed entries through as they are for validation to report.
  `stationManager.serialize()` writes its stations inside a `stations`
  field, so pass the inner array.

    ```ts
    import { StationManager, levelsToMetres } from 'track-layout';

    // `old` holds what graph.serialize() and stationManager.serialize()
    // wrote, in levels.
    const migrated = levelsToMetres({
        track: old.track,
        stations: old.stations.stations,
    });
    await graph.loadFromSerializedData(migrated.track);
    const stationManager = StationManager.deserialize({
        ...old.stations,
        stations: migrated.stations,
    });
    ```

- **Changing a laid joint's height.** `graph.setJointElevation(joint, metres)`
  moves the joint, rounded to 0.01 m, and the end of each segment that meets
  it. Each segment is rebuilt in place and keeps its segment number, curve,
  gauge, style and offsets, so anything that refers to it by number, such as
  a platform, stays valid. It is split again at the crossings its new
  heights make. It returns `null`, or says why nothing changed:
  `'unknownJoint'`, `'outOfRange'` (outside `HEIGHT_MIN` to `HEIGHT_MAX`) or
  `'protectedSegment'` (a segment at the joint is protected by the check set
  with `setSegmentProtectionCheck`, such as one with a platform). It doesn't
  check the laying rules, so it can leave a junction with a sloped branch.
  A height the joint already has changes nothing.
- **Reacting to it.** `graph.onSegmentElevationChanged(segmentNumber => ...)`
  fires for each rebuilt segment. The segment's pieces are deleted and added
  again through the usual draw-data events, with no segment add or remove
  event. One event fires per segment, as each is rebuilt, so the graph is
  fully consistent only once `setJointElevation` returns: a listener that
  reads neighbouring segments should defer the read. `TrackRenderSystem`
  listens: after a height change it redraws the segment's pieces, its
  zoomed-out line and its underground mark, and, in `'centerline'` and
  `'rails'`, the crossings the segment takes part in.

```ts
const refused = graph.setJointElevation(joint, 7.5);
if (refused !== null) showWarning(refused);
graph.onSegmentElevationChanged(n => console.log('redraw', n));
```

## Upgrading from 0.13

0.14.0 holds heights in metres where 0.13.0 held levels.

- **Removed exports.** `ELEVATION`, `ELEVATION_VALUES`, `ELEVATION_MIN`,
  `ELEVATION_MAX` and `LEVEL_HEIGHT` are gone. Use a height in metres
  instead (`ELEVATION.GROUND` is 0, `ELEVATION.ABOVE_1` is 10,
  `ELEVATION.SUB_1` is -10, and so on), within `HEIGHT_MIN` to
  `HEIGHT_MAX`.
- **Changes that still compile.** These now take or give metres, so code
  that passes or reads levels builds without an error but means something
  else:
    - **Station and platform heights.** `createIslandStation({ elevation })`,
      `StationManager.createStation` and
      `TrackAlignedPlatformRenderSystem.addPlatform(id, elevation)` take
      metres: 1 now means 1 m, not level 1 (10 m).
    - **Beds and shadows.** `LayerHost.addBed` and `addShadow` take a band
      height in metres, such as 10 where 0.13 took level 1.
    - **Band helpers.** `host.resolveElevationLevel` and
      `findElevationInterval` return band heights in metres, such as 10,
      instead of levels.
    - **Stepping.** The engine's bump and lower methods step 1 m by
      default, where they moved one 10 m level. Call
      `engine.setElevationStep(10)` to step 10 m as before.
    - **Engine events.** `engine.onElevationChange` reports metres.
    - **Heights beyond the bands.** `host.getElevationBandIndex` clamps a
      height below -30 m or above 30 m to the lowest or highest band, where
      0.13 put it in the ground band.
- **Saved data.** Convert track and stations saved in levels with
  `levelsToMetres` before you load them (see [Heights](#heights)).

## Laying and editing track

`track-layout/editing` holds the laying engine and the editing tools as
state machines: layout, joint direction, duplicate to side and catenary.
They need the optional peer `@ue-too/being`.

```ts
import { TrackGraph } from 'track-layout';
import {
    CurveCreationEngine,
    createLayoutStateMachine,
} from 'track-layout/editing';

const graph = new TrackGraph();
// Replace with your camera's window-to-world conversion.
const windowToWorld = (p: { x: number; y: number }) => p;
const engine = new CurveCreationEngine(graph, windowToWorld);
const layout = createLayoutStateMachine(engine);

layout.happens('startLayout');
layout.happens('pointerMove', { x: 0, y: 0 });
layout.happens('leftPointerUp', { x: 0, y: 0 });
layout.happens('pointerMove', { x: 100, y: 0 });
layout.happens('leftPointerUp', { x: 100, y: 0 }); // lays a segment
```

When the engine can't lay a curve, the layout goes back to choosing a start
and lays nothing. `engine.onCurveRefused` says why, with a `CurveRefusal`:
for example `extendAngle` when the curve doesn't carry on from the track end
it extends, or `gaugeMismatch`. `engine.lastCurveRefusal` holds the last
reason, and is null once a curve is laid.

```ts
engine.onCurveRefused(refusal => showWarning(refusal));
```

The engine's bump and lower methods (such as `bumpEndJointElevation`) step
a joint's height by `engine.elevationStep`, 1 m by default.
`engine.setElevationStep(metres)` changes it, rounded to 0.01 m, and throws
a `RangeError` below 0.01 m. Steps land on multiples of the step, so from
3.5 m a 1 m step goes to 4 m. Heights stay within `HEIGHT_MIN` to
`HEIGHT_MAX`. `engine.previewGradient` gives the preview curve's rise over
its length as a percentage (rising is positive), or `null` with no preview
or a preview shorter than 0.01 m.

```ts
engine.setElevationStep(0.5);
const gradient = engine.previewGradient; // e.g. 2.5 for a 2.5% climb
```

## Placing stations

`track-layout/station-placement` holds the station placement tools as
state machines: island stations, single-spine platforms and dual-spine
platform pairs. Like the editing tools, they need `@ue-too/being`.

- **Previews.** Each engine draws its preview through an interface you
  implement with your renderer: `StationPlacementPreview`,
  `SingleSpinePlacementPreview` or `DualSpinePlacementPreview`.
- **Commits** go to the managers. Draw new stations and platforms from
  `StationManager.onStationAdded` and
  `TrackAlignedPlatformManager.onPlatformAdded`, and remove them on
  `onStationRemoved` and `onPlatformRemoved`. The spine tools also link
  each new platform to its station, and move a station onto its first
  platform; `TrackAlignedPlatformManager.onChange` signals that, not a
  `StationManager` event.
- **Hints.** The spine tools report each step through `onHint`, with keys
  from `SINGLE_SPINE_HINT_KEYS` and `DUAL_SPINE_HINT_KEYS`.

```ts
import {
    StationManager,
    TrackAlignedPlatformManager,
    TrackGraph,
} from 'track-layout';
import {
    SingleSpinePlacementEngine,
    type SingleSpinePlacementPreview,
    createSingleSpinePlacementStateMachine,
} from 'track-layout/station-placement';

const graph = new TrackGraph();
const stations = new StationManager();
const platforms = new TrackAlignedPlatformManager();
// Replace with your renderer's preview and your camera's conversion.
const preview: SingleSpinePlacementPreview = {
    showTrackHighlight() {},
    showPlacementPreview() {},
    hidePreview() {},
};
const windowToWorld = (p: { x: number; y: number }) => p;

platforms.onPlatformAdded(id => console.log('draw', platforms.getPlatform(id)));

const engine = new SingleSpinePlacementEngine(
    graph,
    windowToWorld,
    stations,
    platforms,
    preview,
    key => console.log(key) // e.g. 'hintPickStart'
);
const tool = createSingleSpinePlacementStateMachine(engine);
const stationId = stations.createStation({
    name: 'Central',
    position: { x: 50, y: 10 },
    elevation: 0, // metres
    platforms: [],
    trackSegments: [],
    joints: [],
    trackAlignedPlatforms: [],
});
tool.happens('startPlacement', { stationId });
// Then pointerMove / leftPointerUp: pick the spine's start and end on a
// track, add outer vertices, and click the start anchor to create it.
```

## Drawing a layout with Pixi

`track-layout/pixi` holds Pixi 8 renderers for track, stations,
track-aligned platforms and joint-direction indicators. It needs the
optional peer `pixi.js`, 8.20.1 or a later 8.x, but not `@ue-too/being`.

- **Layer host.** The renderers draw into a `LayerHost`, which orders
  content by height band. `WorldRenderSystem` is the default one: add
  its `container` to your stage under the camera transform. Draw your own
  height-ordered content (trains, buildings) into the same host so it
  interleaves with track.
    - **Bands.** The default host has seven bands, at the heights in
      `DETAILED_BAND_HEIGHTS`: -30, -20, -10, 0, 10, 20 and 30 m. A height
      between two bands goes in the upper one, and a height beyond the
      lowest or highest band is clamped to it, so everything below -30 m
      shares the lowest band and everything above 30 m the highest. Band
      order sets draw order only; the heights themselves are not capped at
      30 m. `host.getElevationBandIndex(metres)` gives the band for a
      height.
- **Track.** `TrackRenderSystem` draws the track the graph already holds
  when it is built, then track as the graph adds and removes it. Its
  options are all optional:
    - `textureRenderer`, such as `{ renderer: app.renderer }`. Without it
      detailed track is only the zoomed-out line, and that is hidden from
      zoom level 5 up: zoomed-in track (ballast, rails, beds, shadows,
      tunnels and cuttings) isn't drawn, and neither are detailed stations
      or platforms (catenary poles still are). Apps that draw detailed
      track for people should always pass one.
    - `terrain`, anything with `getHeight(x, y)`. Without it the ground is
      flat at height 0, so track below ground level is drawn in a tunnel
      (given a `textureRenderer`).
    - `curveCreation`, `duplicateToSide` and `catenaryLayout`: the engines
      from `track-layout/editing`, whose previews and highlights it draws.
- **Stations and platforms.** `StationRenderSystem` and
  `TrackAlignedPlatformRenderSystem` draw the stations and platforms their
  managers already hold when they are built, then draw and remove them as
  the managers create and destroy them. Both renderers also implement the
  station placement previews.
- **Render styles.** Set a renderer's `renderStyle` to draw with lines
  instead of textures. It redraws everything when the style changes.
    - `TrackRenderSystem`: `'detailed'` (the default: textured track when
      zoomed in, a line when zoomed out), `'centerline'` (a line along the
      middle of each segment) or `'rails'` (a line along each rail, the
      segment's gauge apart). The line styles show at every zoom level and
      draw the previews the same way. They leave out ballast, beds,
      shadows, catenary masts and tunnel walls and cuttings. They draw a
      bridge (parapets and wings) where track crosses at least 3 m over
      other track, which is cut beneath it, and underground track as
      lighter, broken lines with a portal where it reaches the surface. A
      deck or gap near a joint carries on across it, onto every segment
      there (all the branches at a junction). Tracks side by side over the
      same track, at the same height and with no more than 2 m between
      their parapets, share one bridge: only the outer parapets are drawn,
      and the gap beneath runs unbroken. Highlights and snap dots are drawn
      as in `'detailed'`.
        - Each segment's `lineStyle` (`{ preset?, pattern?, color?, width? }`,
          saved with the layout) changes how the line styles draw it.
          Presets are `tunnel` (drawn and treated as underground), `bridge`
          (parapets along the segment), `planned` (dashed) and `disused`
          (dotted, grey); set fields win over the preset. Patterns and
          widths are in screen pixels.

            ```ts
            graph.setSegmentStyle(n, {
                lineStyle: { preset: 'planned', color: 0x2266cc },
            });
            ```

        - `bridgeGapClearance` (option and property): how far, in metres, a
          gap reaches past the upper track's parapets; 0.5 by default, from
          0 to 25.
    - `StationRenderSystem` and `TrackAlignedPlatformRenderSystem`:
      `'detailed'` (the default) or `'outline'`, which outlines each
      platform. The two platforms that make up an island are outlined
      separately, so a line runs down its middle.
    - Lines are one pixel wide at any zoom unless a `lineStyle` sets a
      width, and the line styles need no `textureRenderer`.
- **Joint directions.**
  `new JointDirectionRenderSystem(host, trackGraph, preferenceMap, camera)`
  draws its indicators while the joint-direction tool is shown: call
  `show()` when the tool activates and `hide()` when it deactivates.
- Each renderer's `cleanup()` removes what it drew and stops listening
  (`dispose()` for `JointDirectionRenderSystem`). `StationRenderSystem`'s
  `cleanup()` leaves its placement preview, so call `hidePreview()` first
  if one is showing.

```ts
import { DefaultBoardCamera } from '@ue-too/board';
import { Application } from 'pixi.js';
import {
    StationManager,
    TrackAlignedPlatformManager,
    TrackGraph,
} from 'track-layout';
import { CurveCreationEngine } from 'track-layout/editing';
import {
    StationRenderSystem,
    TrackAlignedPlatformRenderSystem,
    TrackRenderSystem,
    WorldRenderSystem,
} from 'track-layout/pixi';

const app = new Application();
await app.init();
const camera = new DefaultBoardCamera();
const graph = new TrackGraph();
const stations = new StationManager();
const platforms = new TrackAlignedPlatformManager();
// Replace with your camera's window-to-world conversion.
const windowToWorld = (p: { x: number; y: number }) => p;

const host = new WorldRenderSystem();
app.stage.addChild(host.container); // apply the camera's transform to it
const textureRenderer = { renderer: app.renderer };

new TrackRenderSystem(host, graph.trackCurveManager, camera, {
    textureRenderer,
    curveCreation: new CurveCreationEngine(graph, windowToWorld),
});
new StationRenderSystem(host, stations, graph, textureRenderer);
new TrackAlignedPlatformRenderSystem(
    host,
    platforms,
    stations,
    graph,
    textureRenderer
);
```

## Development

```bash
bun install
bun test
bun run typecheck
bun run build
bun run pack:local   # writes .pack/track-layout-local.tgz for trying in an app
```

## Releasing

Releases are published from GitHub Actions: run the **Release** workflow on `main` (or a `version/*` branch for a patch to an older line).

- **Version bump:** `auto` reads the conventional commits since the last `v*` tag (`bun scripts/next-version.ts`); `patch`, `minor` and `major` force one.
- **Dry run:** bumps and packs in the runner, then stops without publishing or pushing. It can run on any branch.
- A release commits `chore(release): track-layout x.y.z`, tags `vx.y.z`, publishes to npm with provenance, opens a GitHub release, and, from `main`, creates a `version/x.y.z` branch.

npm trusts the workflow through trusted publishing, so no npm token is stored.
