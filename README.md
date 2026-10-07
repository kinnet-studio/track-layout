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
    ELEVATION,
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
    elevation: ELEVATION.GROUND,
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
  content by elevation band. `WorldRenderSystem` is the default one: add
  its `container` to your stage under the camera transform. Draw your own
  elevation-ordered content (trains, buildings) into the same host so it
  interleaves with track.
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
      there (all the branches at a junction). Highlights and snap dots are
      drawn as in `'detailed'`.
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
