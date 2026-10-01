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

## Development

```bash
bun install
bun test
bun run typecheck
bun run build
bun run pack:local   # writes .pack/track-layout-local.tgz for trying in an app
```
