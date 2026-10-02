# track-layout Phase 4 (Pixi Renderers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move banana's Pixi renderers for track, stations, platforms and joint directions, with the elevation layer host they draw into, into `track-layout` as `track-layout/pixi` (0.4.0). Then switch banana over.

**Architecture:** Lift and decouple, as in phases 1–3. The porting script copies seven modules from banana. Then, each with tests:

- The renderers take a `LayerHost` interface, which the moved `WorldRenderSystem` implements, and the track renderer takes its engines as optional, structurally typed preview sources.
- Characterization tests pin what every renderer registers with the host, headless under `bun test`.
- The station and platform renderers subscribe to their managers.
- Restyling a segment redraws all of it.

Banana deletes its copies and its wiring helper, draws its trains, buildings, signals and terrain into the package's `WorldRenderSystem`, and imports the renderers from `track-layout/pixi`.

**Tech Stack:** Bun 1.3, TypeScript 5.8 (`bundler` resolution, `.js` specifiers), Prettier 3, `@ue-too/being|board|curve|math` 0.19, `pixi.js` 8.20.1. Banana: React, Vite.

**Spec:** `docs/superpowers/specs/2026-10-02-track-layout-phase-4-pixi-renderers-design.md`. It is in track-layout, and banana's `feat/track-layout-phase-4` holds the same file. Its parent is `docs/superpowers/specs/2026-10-01-track-layout-extraction-design.md`. Read the phase 4 spec first. Its "Changes made during the move" are numbered 1–7, and the tasks below refer to those numbers.

## Global Constraints

- **Entry point:** `track-layout/pixi`, a new subpath. The package root (`track-layout`) does not re-export it.
- **Dependencies:** `pixi.js` at exactly `8.20.1`, as an optional peer (`peerDependencies` and `peerDependenciesMeta`) and as a dev dependency. Nothing else new.
- **`src/pixi/` may import** each other, `../index.js`, `pixi.js`, `@ue-too/board`, `@ue-too/curve` and `@ue-too/math`, plus, with `import type` only, `../editing/preview-types.js` and `../station-placement/preview.js`. Nothing else: no `@ue-too/being`, no other editing or station-placement module, no React, zustand or banana code.
- **Release:** `track-layout` 0.4.0, through the Release workflow on `main`.
- **Bun only** (never npm, pnpm, yarn or node to install or run). Tests import from `bun:test`.
- **TypeScript:**
    - `moduleResolution: "bundler"`.
    - Relative imports in `track-layout` end in `.js`. Pixi files import the model from `'../index.js'`, never from `'track-layout'`.
    - The target is ES2022, so `Array.prototype.findLast` is not available.
- **Prettier:** 4-space indent, single quotes, `es5` trailing commas, width 80, sorted imports. Run `bun run format` before every commit; `bun run format:check` must pass.
- **Expected numbers in `track-layout`:**

    | After         | `bun test` | Test files |
    | ------------- | ---------- | ---------- |
    | Start         | 379        | 36         |
    | Task 1        | 387        | 37         |
    | Task 2        | 392        | 38         |
    | Task 3        | 422        | 40         |
    | Task 4        | 445        | 43         |
    | Task 5        | 450        | 44         |
    | Task 6        | 460        | 45         |
    | Task 7        | 465        | 46         |

    `bun run typecheck` is clean after every task. After Task 7, `bun run build` then `bun pm pack --dry-run` reports `Total files: 156`.

- **Expected numbers in banana:**
    - `bun test` is 741 (56 files) at the start and after installing the tarball, and 728 (54 files) after Task 8.
    - `bunx tsc --noEmit -p tsconfig.json` reports the same 9 errors throughout:
        - `BananaToolbar.tsx` ×2
        - `DepotPanel.tsx` ×1
        - `train-editor-tool-switcher.ts` ×2
        - `train-editor-toolbar.tsx` ×2
        - `init-app.ts` ×2, "Cannot find name 'result'"
- **track-layout's `bun.lock`:**
    - At the start, install with `bun install --frozen-lockfile`.
    - Task 1 adds `pixi.js`, so it runs a plain `bun install` and commits `bun.lock`. That diff also adds `@ue-too/being` to the lockfile's optional peers, which `main`'s lockfile was missing. That is expected.
    - After Task 1, install with `bun install --frozen-lockfile` again, and never commit `bun.lock` outside Task 1.
- **Test output noise.** These lines are expected while the tests run:
    - `connectJoints <a> <b>` from `TrackGraph.connectJoints`
    - a whole segment object, logged as `segment {` by `removeTrackSegment`
    - `something wrong in the sorting of track segments draw order`
    - `PixiJS Deprecation Warning: addChild: Only Containers will be allowed to add children`, when tunnel walls are built
- **No outward actions without the owner's go-ahead:** don't push, open or merge PRs, run the Release workflow or publish.

## Conventions

- **Checkouts.** `TL` is the track-layout checkout and `BN` the banana checkout. Set both once per shell:
    - in the cloud session: `export TL=/home/user/track-layout BN=/home/user/banana`
    - on the owner's Mac: `export TL=~/dev/track/main BN=~/dev/banana/main`
- **Branches:**
    - TL `feat/phase-4-pixi-renderers` already exists and holds the spec copy and this plan.
    - BN `feat/track-layout-phase-4` already exists and holds the spec. Tasks 1–7 port from it, so don't change its source files before Task 8.
- **Test counts.** Never pipe `bun test` into `head`. Define this once per shell:

    ```bash
    tcount() { bun test > "${TMPDIR:-/tmp}/bun-test.txt" 2>&1; grep -E "^ *[0-9]+ (pass|fail)|^Ran" "${TMPDIR:-/tmp}/bun-test.txt"; }
    ```

- **Commits** are conventional, and every commit message ends with the co-author trailer your harness specifies. Stage the paths the step names. In TL, never `git add -A`.
- **Edits are written in a fixed form:**
    - "In `F`, replace: X with: Y" is an exact-text replacement where X occurs exactly once.
    - "replace all N occurrences" means exactly N. If the count differs, stop and report. Don't improvise.
    - "Delete:" removes those lines.
- **Characterization tests** record what the code does today. If one fails against code the task didn't change, fix the expectation, never the code, and say so in the commit message.

## Review Focus

1. **A segment is restyled while the camera is zoomed out, or with the elevation gradient on.** The rebuilt pieces follow the current display settings, so nothing pops into view. Task 6: `keeps the rebuilt pieces hidden while zoomed out` and `rebuilds the ballast with the elevation gradient when it is on`.
2. **A scene load replaces existing stations and platforms.** The old visuals go and the new ones are drawn once each, at their station's elevation. Task 5: `swaps the visuals once each when a scene load replaces the stations`.
3. **A renderer is cleaned up and another built in its place, as on a hot reload.** The old one stops listening to its sources and managers, so nothing is drawn twice. Task 2: `unsubscribes from every source on cleanup`. Task 5: `stops following the managers after cleanup`.
4. **An app has no texture renderer or no terrain.** Track is still drawn: without textures as the simplified line and an untextured drawable, and without terrain on flat ground at height 0. Task 3: `draws no rails or shadows without a texture renderer` and `treats missing terrain as flat ground, so track below ground is in a tunnel`.
5. **A tool highlights a segment that no longer exists**, for example one deleted between hover and highlight. Nothing is drawn and nothing throws. Task 3: `draws no highlight for a segment that does not exist`. Task 4: `draws no track highlight for a segment that does not exist`.

## File Structure

**track-layout (TL):**

- **Modify:**
    - `package.json`, `bun.lock`, `scripts/banana-module-map.ts`, `README.md`
    - `src/editing/curve-engine.ts`, `src/editing/duplicate-to-side-engine.ts`, `src/editing/catenary-layout-engine.ts`, `src/editing/index.ts`
    - `src/tracks/trackcurve-manager.ts` (one getter's type)
    - `test/curve-engine.test.ts` (one import)
- **Create (ported):** under `src/pixi/`: `world-render-system.ts`, `track-render-system.ts`, `geometry-utils.ts`, `tunnel-geometry.ts`, `joint-direction-render-system.ts`, `station-render-system.ts`, `track-aligned-platform-render-system.ts`; and `test/tunnel-geometry.test.ts`
- **Create (new):**
    - `src/pixi/layer-host.ts`, `src/pixi/preview-sources.ts`, `src/pixi/index.ts`, `src/editing/preview-types.ts`
    - `test/pixi-helpers.ts`
    - `test/track-render-sources.test.ts`, `test/world-render-system.test.ts`, `test/track-render-system.test.ts`, `test/station-render-system.test.ts`, `test/track-aligned-platform-render-system.test.ts`, `test/joint-direction-render-system.test.ts`, `test/station-render-events.test.ts`, `test/track-restyle.test.ts`, `test/pixi-entry.test.ts`

**banana (BN):**

- **Delete:**
    - `src/world-render-system.ts`, `src/trains/tracks/render-system.ts`, `src/trains/tracks/geometry-utils.ts`, `src/trains/tracks/tunnel-geometry.ts`, `src/trains/tracks/joint-direction-render-system.ts`, `src/stations/station-render-system.ts`, `src/stations/track-aligned-platform-render-system.ts`
    - `src/stations/station-render-wiring.ts`, `src/utils.ts`
    - `test/tunnel-geometry.test.ts`, `test/station-render-wiring.test.ts`
- **Modify:**
    - `package.json`, `bun.lock`
    - `src/utils/init-app.ts`, `src/scene-serialization.ts`
    - `src/buildings/render-system.ts`, `src/signals/signal-render-system.ts`, `src/terrain/terrain-render-system.ts`, `src/trains/train-render-system.ts`, `src/trains/tracks/debug-overlay-render-system.ts`, `src/components/toolbar/StationListPanel.tsx`

---

### Task 1: Port the renderers

**Files:**

- Modify: TL `package.json`, `bun.lock`, `scripts/banana-module-map.ts`
- Create: TL `src/pixi/world-render-system.ts`, `src/pixi/track-render-system.ts`, `src/pixi/geometry-utils.ts`, `src/pixi/tunnel-geometry.ts`, `src/pixi/joint-direction-render-system.ts`, `src/pixi/station-render-system.ts`, `src/pixi/track-aligned-platform-render-system.ts`, `test/tunnel-geometry.test.ts`

**Interfaces:**

- **Produces:** the seven modules under `src/pixi/`, verbatim from banana apart from changes 3 and 5. `tunnel-geometry.ts` exports `type TerrainSampler = { getHeight(x: number, y: number): number }`, and the track renderer's constructor takes `TerrainSampler | null` where it took `TerrainData`. The renderers still take `WorldRenderSystem` and the track renderer still takes the engines positionally; Task 2 changes both.

- [ ] **Step 1: Check the starting point**

Run: `cd "$TL" && git checkout -q feat/phase-4-pixi-renderers && git status --short && bun install --frozen-lockfile >/dev/null && tcount`
Expected: a clean tree and `379 pass`, `0 fail`, `Ran 379 tests across 36 files`.

- [ ] **Step 2: Add `pixi.js`.** In `package.json`, replace:

```json
        "@ue-too/math": "^0.19.0"
    },
    "peerDependenciesMeta": {
        "@ue-too/being": {
            "optional": true
        }
    },
```

with:

```json
        "@ue-too/math": "^0.19.0",
        "pixi.js": "8.20.1"
    },
    "peerDependenciesMeta": {
        "@ue-too/being": {
            "optional": true
        },
        "pixi.js": {
            "optional": true
        }
    },
```

and replace:

```json
        "@ue-too/math": "0.19.0",
        "prettier": "^3.5.3",
```

with:

```json
        "@ue-too/math": "0.19.0",
        "pixi.js": "8.20.1",
        "prettier": "^3.5.3",
```

Run: `bun install >/dev/null && bun install --frozen-lockfile >/dev/null && echo frozen-ok && git diff --stat`
Expected: `frozen-ok`, then `bun.lock` and `package.json` changed. The lockfile diff adds `pixi.js` and its dependencies, and lists `@ue-too/being` and `pixi.js` under `optionalPeers`.

- [ ] **Step 3: Map the moved modules.** In `scripts/banana-module-map.ts`, replace:

```ts
    'src/stations/dual-spine-placement-state-machine':
        'src/station-placement/dual-spine-placement-state-machine',
};
```

with:

```ts
    'src/stations/dual-spine-placement-state-machine':
        'src/station-placement/dual-spine-placement-state-machine',
    'src/world-render-system': 'src/pixi/world-render-system',
    'src/trains/tracks/render-system': 'src/pixi/track-render-system',
    'src/trains/tracks/geometry-utils': 'src/pixi/geometry-utils',
    'src/trains/tracks/tunnel-geometry': 'src/pixi/tunnel-geometry',
    'src/trains/tracks/joint-direction-render-system':
        'src/pixi/joint-direction-render-system',
    'src/stations/station-render-system': 'src/pixi/station-render-system',
    'src/stations/track-aligned-platform-render-system':
        'src/pixi/track-aligned-platform-render-system',
};
```

replace:

```ts
    'track-layout/station-placement': 'src/station-placement/index',
};
```

with:

```ts
    'track-layout/station-placement': 'src/station-placement/index',
    'track-layout/pixi': 'src/pixi/index',
};
```

and replace:

```ts
        return 'track-layout/station-placement';
    }
    return 'track-layout';
```

with:

```ts
        return 'track-layout/station-placement';
    }
    if (moduleId.startsWith('src/pixi/')) return 'track-layout/pixi';
    return 'track-layout';
```

- [ ] **Step 4: Port**

```bash
cd "$TL" && bun scripts/port-from-banana.ts "$BN" \
  src/world-render-system.ts=src/pixi/world-render-system.ts \
  src/trains/tracks/render-system.ts=src/pixi/track-render-system.ts \
  src/trains/tracks/geometry-utils.ts=src/pixi/geometry-utils.ts \
  src/trains/tracks/tunnel-geometry.ts=src/pixi/tunnel-geometry.ts \
  src/trains/tracks/joint-direction-render-system.ts=src/pixi/joint-direction-render-system.ts \
  src/stations/station-render-system.ts=src/pixi/station-render-system.ts \
  src/stations/track-aligned-platform-render-system.ts=src/pixi/track-aligned-platform-render-system.ts
```

Expected: seven `ported` lines, `UNMAPPED @/terrain/terrain-data` under the track renderer, `UNMAPPED ../../terrain/terrain-data` under `tunnel-geometry`, and `done; 2 unmapped specifier(s)`.

- [ ] **Step 5: See the typecheck fail**

Run: `bun run typecheck 2>&1 | grep "error TS"`
Expected: exactly three errors:

- `src/pixi/track-render-system.ts`: `Cannot find module '@/terrain/terrain-data'`
- `src/pixi/track-render-system.ts`: `Module '"../shared/entity-manager.js"' has no exported member 'clearShadowCache'`. The module map still sends banana's `src/utils` to the entity manager, which is what that file held in phase 1. The shadow helpers are dead code (spec change 5), so the import goes.
- `src/pixi/tunnel-geometry.ts`: `Cannot find module '../../terrain/terrain-data'`

- [ ] **Step 6: Terrain sampler and dead shadow cache (changes 3 and 5).** These edits apply to the unformatted port output.

In `src/pixi/tunnel-geometry.ts`, delete:

```ts
import type { TerrainData } from '../../terrain/terrain-data';
```

replace:

```ts
export type TunnelEntranceEdgePoint = { x: number; y: number };
```

with:

```ts
/** Terrain height at a world position. */
export type TerrainSampler = { getHeight(x: number, y: number): number };

export type TunnelEntranceEdgePoint = { x: number; y: number };
```

and replace:

```ts
    terrainData: Pick<TerrainData, 'getHeight'> | null,
```

with:

```ts
    terrainData: TerrainSampler | null,
```

In `src/pixi/track-render-system.ts`, delete:

```ts
import type { TerrainData } from '@/terrain/terrain-data';
import { clearShadowCache } from '../shared/entity-manager.js';
```

replace:

```ts
import { computeTunnelEntranceGeometry } from './tunnel-geometry.js';
```

with:

```ts
import {
    type TerrainSampler,
    computeTunnelEntranceGeometry,
} from './tunnel-geometry.js';
```

replace both occurrences of `TerrainData | null` with `TerrainSampler | null` (the `_terrainData` field and the constructor's `terrainData` parameter), and in the `sunAngle` setter delete:

```ts
        clearShadowCache();
```

- [ ] **Step 7: Move the tunnel-geometry tests.** Copy banana's tests, pointing them at the package's modules:

```bash
cd "$TL" && sed -e "s#import type { TrackSegmentDrawData } from 'track-layout';#import type { TrackSegmentDrawData } from '../src/index.js';#" \
  -e "s#from '../src/trains/tracks/tunnel-geometry';#from '../src/pixi/tunnel-geometry.js';#" \
  "$BN/test/tunnel-geometry.test.ts" > test/tunnel-geometry.test.ts && grep -n "from '" test/tunnel-geometry.test.ts
```

Expected: four imports: `@ue-too/curve`, `bun:test`, `../src/index.js` and `../src/pixi/tunnel-geometry.js`.

- [ ] **Step 8: Verify**

Run: `bun run format >/dev/null && bun run typecheck && bun run format:check && tcount`
Expected: a clean typecheck, `All matched files use Prettier code style!`, `387 pass`, `0 fail`, `Ran 387 tests across 37 files`.

- [ ] **Step 9: Commit**

```bash
git add package.json bun.lock scripts/banana-module-map.ts src/pixi test/tunnel-geometry.test.ts
git commit -m "feat(pixi): port banana's renderers" -m "Copied from banana d91f613 with scripts/port-from-banana.ts. A terrain sampler replaces banana's TerrainData, and the dead shadow-cache call goes. tunnel-geometry's 8 tests move with it."
```

---

### Task 2: Layer host interface and optional preview sources

**Files:**

- Create: TL `src/pixi/layer-host.ts`, `src/pixi/preview-sources.ts`, `src/editing/preview-types.ts`, `test/pixi-helpers.ts`, `test/track-render-sources.test.ts`
- Modify: TL `src/pixi/world-render-system.ts`, `src/pixi/track-render-system.ts`, `src/pixi/station-render-system.ts`, `src/pixi/track-aligned-platform-render-system.ts`, `src/pixi/joint-direction-render-system.ts`, `src/editing/curve-engine.ts`, `src/editing/duplicate-to-side-engine.ts`, `src/editing/catenary-layout-engine.ts`, `src/editing/index.ts`, `test/curve-engine.test.ts`

**Interfaces:**

- **Consumes:** Task 1's modules and `TerrainSampler`.
- **Produces:**
    - `interface LayerHost` (the 15 members below), implemented by `WorldRenderSystem`. All four renderers take `LayerHost` as their first parameter.
    - `interface CurveCreationPreviewSource`, `DuplicateToSidePreviewSource`, `CatenaryLayoutPreviewSource` in `src/pixi/preview-sources.ts`.
    - `type TrackRenderSystemOptions = { textureRenderer?: TrackTextureRenderer | null; terrain?: TerrainSampler | null; curveCreation?; duplicateToSide?; catenaryLayout? }`, and `new TrackRenderSystem(host: LayerHost, trackCurveManager: TrackCurveManager, camera: ObservableBoardCamera, options: TrackRenderSystemOptions = {})`.
    - `src/editing/preview-types.ts` with `PreviewDrawData`, `DeletionHighlightState`, `DuplicateHighlightState`, `CatenaryHighlightState`, `CatenaryPreviewState`, re-exported by `src/editing/index.ts`.
    - Test helpers in `test/pixi-helpers.ts`: `textureRenderer`, `drawKey(segment, start = 0, end = 1)`, `camera()`, `zoomTo(camera, zoomLevel)`, `RecordingLayerHost` (with `bandOf`, `sublayerOf`, `bandItem`, `bedElevationOf`, `bed`, `shadowElevationOf`, `shadow`, `bandKeys`, `bedKeys`, `shadowKeys`, `drawableKeys`, `overlays`), `fakeCurveCreationSource()`, `fakeDuplicateToSideSource()`, `fakeCatenaryLayoutSource()` (each `{ source, subscriptions, emit(method, payload) }`).

- [ ] **Step 1: Write the test helpers.** Create `test/pixi-helpers.ts`. The texture stub returns a new texture per call because the renderers destroy theirs on cleanup. The camera's zoom event arrives a microtask after `setZoomLevel`, hence `zoomTo`.

```ts
import { DefaultBoardCamera } from '@ue-too/board';
import { type Container, Texture } from 'pixi.js';

import type { ELEVATION } from '../src/index.js';
import type {
    CatenaryLayoutPreviewSource,
    CurveCreationPreviewSource,
    DuplicateToSidePreviewSource,
} from '../src/pixi/preview-sources.js';
import type { TrackTextureRenderer } from '../src/pixi/track-render-system.js';
import {
    type BandSublayer,
    WorldRenderSystem,
} from '../src/pixi/world-render-system.js';

/**
 * Generates every texture as a new empty texture, so meshes build headless.
 * Each call returns its own texture because the renderers destroy theirs on
 * cleanup.
 */
export const textureRenderer: TrackTextureRenderer = {
    renderer: {
        textureGenerator: { generateTexture: () => new Texture() },
    },
};

/** The track renderer's key for the draw data of one segment piece. */
export function drawKey(segment: number, start = 0, end = 1): string {
    return JSON.stringify({
        trackSegmentNumber: segment,
        tValInterval: { start, end },
    });
}

/** A camera at zoom 1, which shows the simplified track. */
export function camera(): DefaultBoardCamera {
    return new DefaultBoardCamera();
}

/** Zooms the camera and waits for its zoom event, which arrives a microtask later. */
export async function zoomTo(
    camera: DefaultBoardCamera,
    zoomLevel: number
): Promise<void> {
    camera.setZoomLevel(zoomLevel);
    await Promise.resolve();
}

/**
 * The real {@link WorldRenderSystem}, recording where each key went so tests
 * can ask without walking the scene graph.
 */
export class RecordingLayerHost extends WorldRenderSystem {
    private _bandItems = new Map<
        string,
        { container: Container; bandIndex: number; sublayer: BandSublayer }
    >();
    private _beds = new Map<
        string,
        { container: Container; elevation: ELEVATION }
    >();
    private _shadows = new Map<
        string,
        { container: Container; elevation: ELEVATION }
    >();
    private _drawables = new Map<string, Container>();
    private _overlays = new Set<Container>();

    override addToBand(
        key: string,
        container: Container,
        bandIndex: number,
        sublayer: BandSublayer
    ): void {
        super.addToBand(key, container, bandIndex, sublayer);
        this._bandItems.set(key, { container, bandIndex, sublayer });
    }
    override removeFromBand(key: string): Container | undefined {
        this._bandItems.delete(key);
        return super.removeFromBand(key);
    }
    override addBed(
        key: string,
        container: Container,
        elevation: ELEVATION
    ): void {
        super.addBed(key, container, elevation);
        this._beds.set(key, { container, elevation });
    }
    override removeBed(key: string): void {
        this._beds.delete(key);
        super.removeBed(key);
    }
    override addShadow(
        key: string,
        container: Container,
        elevation: ELEVATION
    ): void {
        super.addShadow(key, container, elevation);
        this._shadows.set(key, { container, elevation });
    }
    override removeShadow(key: string): void {
        this._shadows.delete(key);
        super.removeShadow(key);
    }
    override addDrawable(key: string, container: Container): void {
        super.addDrawable(key, container);
        this._drawables.set(key, container);
    }
    override removeDrawable(key: string): Container | undefined {
        this._drawables.delete(key);
        return super.removeDrawable(key);
    }
    override addOverlayContainer(
        container: Container,
        options?: { zIndex?: number }
    ): void {
        super.addOverlayContainer(container, options);
        this._overlays.add(container);
    }
    override removeOverlayContainer(container: Container): void {
        this._overlays.delete(container);
        super.removeOverlayContainer(container);
    }

    bandOf(key: string): number | undefined {
        return this._bandItems.get(key)?.bandIndex;
    }
    sublayerOf(key: string): BandSublayer | undefined {
        return this._bandItems.get(key)?.sublayer;
    }
    bandItem(key: string): Container | undefined {
        return this._bandItems.get(key)?.container;
    }
    bedElevationOf(key: string): ELEVATION | undefined {
        return this._beds.get(key)?.elevation;
    }
    bed(key: string): Container | undefined {
        return this._beds.get(key)?.container;
    }
    shadowElevationOf(key: string): ELEVATION | undefined {
        return this._shadows.get(key)?.elevation;
    }
    shadow(key: string): Container | undefined {
        return this._shadows.get(key)?.container;
    }
    /** The band keys, sorted. */
    get bandKeys(): string[] {
        return [...this._bandItems.keys()].sort();
    }
    /** The bed keys, sorted. */
    get bedKeys(): string[] {
        return [...this._beds.keys()].sort();
    }
    /** The shadow keys, sorted. */
    get shadowKeys(): string[] {
        return [...this._shadows.keys()].sort();
    }
    /** The unbanded drawable keys, sorted. */
    get drawableKeys(): string[] {
        return [...this._drawables.keys()].sort();
    }
    /** The overlay containers, in the order they were added. */
    get overlays(): Container[] {
        return [...this._overlays];
    }
}

export type FakeSubscription = {
    method: string;
    observer: (payload: unknown) => void;
    signal: AbortSignal | undefined;
};

/**
 * A stand-in preview source: it records each subscription, and `emit` sends
 * a payload to the observers of one method.
 */
function fakeSource<S>(methods: readonly string[]) {
    const subscriptions: FakeSubscription[] = [];
    const source: Record<
        string,
        (
            observer: (payload: unknown) => void,
            options?: { signal?: AbortSignal }
        ) => void
    > = {};
    for (const method of methods) {
        source[method] = (observer, options) => {
            subscriptions.push({ method, observer, signal: options?.signal });
        };
    }
    return {
        source: source as unknown as S,
        subscriptions,
        emit(method: string, payload: unknown): void {
            for (const subscription of subscriptions) {
                if (subscription.method === method) {
                    subscription.observer(payload);
                }
            }
        },
    };
}

export function fakeCurveCreationSource() {
    return fakeSource<CurveCreationPreviewSource>([
        'onPreviewDrawDataChange',
        'onDeletionHighlightChange',
        'onPreviewStartProjectionChange',
        'onPreviewEndProjectionChange',
    ]);
}

export function fakeDuplicateToSideSource() {
    return fakeSource<DuplicateToSidePreviewSource>([
        'onPreviewDrawDataChange',
        'onHighlightChange',
    ]);
}

export function fakeCatenaryLayoutSource() {
    return fakeSource<CatenaryLayoutPreviewSource>([
        'onHighlightChange',
        'onPreviewChange',
    ]);
}
```

- [ ] **Step 2: Write the failing test.** Create `test/track-render-sources.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';

import { CatenaryLayoutEngine } from '../src/editing/catenary-layout-engine.js';
import { CurveCreationEngine } from '../src/editing/curve-engine.js';
import { DuplicateToSideEngine } from '../src/editing/duplicate-to-side-engine.js';
import { TrackRenderSystem } from '../src/pixi/track-render-system.js';
import { TrackGraph } from '../src/tracks/track.js';
import {
    RecordingLayerHost,
    camera,
    drawKey,
    fakeCatenaryLayoutSource,
    fakeCurveCreationSource,
    fakeDuplicateToSideSource,
    textureRenderer,
} from './pixi-helpers.js';
import { identity, layTrack } from './station-placement-helpers.js';

function rendererWithAllSources() {
    const curveCreation = fakeCurveCreationSource();
    const duplicateToSide = fakeDuplicateToSideSource();
    const catenaryLayout = fakeCatenaryLayoutSource();
    const renderer = new TrackRenderSystem(
        new RecordingLayerHost(),
        new TrackGraph().trackCurveManager,
        camera(),
        {
            curveCreation: curveCreation.source,
            duplicateToSide: duplicateToSide.source,
            catenaryLayout: catenaryLayout.source,
        }
    );
    return { renderer, curveCreation, duplicateToSide, catenaryLayout };
}

describe('TrackRenderSystem preview sources', () => {
    it('draws laid track with no sources', () => {
        const host = new RecordingLayerHost();
        const graph = new TrackGraph();
        new TrackRenderSystem(host, graph.trackCurveManager, camera(), {
            textureRenderer,
        });

        layTrack(graph, [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
        ]);

        expect(host.sublayerOf(drawKey(0))).toBe('drawable');
        expect(host.sublayerOf(`__rail__${drawKey(0)}`)).toBe('rail');
    });

    it('subscribes to every method of each source it is given', () => {
        const { curveCreation, duplicateToSide, catenaryLayout } =
            rendererWithAllSources();

        expect(curveCreation.subscriptions.map(s => s.method)).toEqual([
            'onPreviewDrawDataChange',
            'onDeletionHighlightChange',
            'onPreviewStartProjectionChange',
            'onPreviewEndProjectionChange',
        ]);
        expect(duplicateToSide.subscriptions.map(s => s.method)).toEqual([
            'onPreviewDrawDataChange',
            'onHighlightChange',
        ]);
        expect(catenaryLayout.subscriptions.map(s => s.method)).toEqual([
            'onHighlightChange',
            'onPreviewChange',
        ]);
    });

    it('subscribes only to the sources it is given', () => {
        const curveCreation = fakeCurveCreationSource();
        new TrackRenderSystem(
            new RecordingLayerHost(),
            new TrackGraph().trackCurveManager,
            camera(),
            { curveCreation: curveCreation.source }
        );

        expect(curveCreation.subscriptions).toHaveLength(4);
    });

    it('unsubscribes from every source on cleanup', () => {
        const { renderer, curveCreation, duplicateToSide, catenaryLayout } =
            rendererWithAllSources();
        const all = [
            ...curveCreation.subscriptions,
            ...duplicateToSide.subscriptions,
            ...catenaryLayout.subscriptions,
        ];
        expect(all.every(s => s.signal?.aborted === false)).toBe(true);

        renderer.cleanup();

        expect(all.every(s => s.signal?.aborted === true)).toBe(true);
    });

    it('accepts the editing engines as sources', () => {
        const graph = new TrackGraph();
        const build = () =>
            new TrackRenderSystem(
                new RecordingLayerHost(),
                graph.trackCurveManager,
                camera(),
                {
                    textureRenderer,
                    curveCreation: new CurveCreationEngine(graph, identity),
                    duplicateToSide: new DuplicateToSideEngine(graph, identity),
                    catenaryLayout: new CatenaryLayoutEngine(graph, identity),
                }
            );

        expect(build).not.toThrow();
    });
});
```

- [ ] **Step 3: See it fail**

Run: `bun run typecheck 2>&1 | grep -c "error TS"; bun test test/track-render-sources.test.ts 2>&1 | grep -E " pass$| fail$"`
Expected: `5` typecheck errors: one in `test/pixi-helpers.ts` (`Cannot find module '../src/pixi/preview-sources.js'`) and four in `test/track-render-sources.test.ts` (`Argument of type 'DefaultBoardCamera' is not assignable to parameter of type 'CurveCreationEngine'`). Then `0 pass`, `5 fail`.

- [ ] **Step 4: The layer host (change 1).** Create `src/pixi/layer-host.ts`:

```ts
import type { Container } from 'pixi.js';

import type { ELEVATION } from '../index.js';
import type { BandSublayer } from './world-render-system.js';

/**
 * Where the renderers put what they draw. Content is grouped into one band
 * per elevation level, and each band has sublayers that fix the draw order
 * within it.
 *
 * {@link WorldRenderSystem} is the default implementation. An app whose own
 * content (trains, buildings) must interleave with track by elevation draws
 * it into the same host.
 */
export interface LayerHost {
    /** Adds a container to a band's sublayer, or moves it there if the key exists. */
    addToBand(
        key: string,
        container: Container,
        bandIndex: number,
        sublayer: BandSublayer
    ): void;
    /** Removes a band item and returns it; the caller destroys it. */
    removeFromBand(key: string): Container | undefined;
    /** Sets a band item's draw order within its sublayer. */
    setOrderInBand(key: string, order: number): void;
    /** The band index for a raw elevation in world units. */
    getElevationBandIndex(rawElevation: number): number;
    /** The elevation level for a raw elevation in world units. */
    resolveElevationLevel(rawElevation: number): ELEVATION;
    /** Adds to the shared bed layer at an elevation. */
    addBed(key: string, container: Container, elevation: ELEVATION): void;
    /** Removes and destroys a bed. */
    removeBed(key: string): void;
    /** Adds to the shared shadow layer at an elevation. */
    addShadow(key: string, container: Container, elevation: ELEVATION): void;
    /** Removes and destroys a shadow. */
    removeShadow(key: string): void;
    /** Adds an item that belongs to no band, such as a preview. */
    addDrawable(key: string, container: Container): void;
    /** Removes an unbanded item and returns it; the caller destroys it. */
    removeDrawable(key: string): Container | undefined;
    /** Looks a key up among unbanded and band items. */
    getDrawable(key: string): Container | undefined;
    /** Adds a container above the bands, or at `options.zIndex`. */
    addOverlayContainer(
        container: Container,
        options?: { zIndex?: number }
    ): void;
    removeOverlayContainer(container: Container): void;
    /** Re-sorts every sortable sublayer and the bands. */
    sortChildren(): void;
}
```

In `src/pixi/world-render-system.ts`, replace:

```ts
import { ELEVATION, ELEVATION_VALUES } from '../index.js';
```

with:

```ts
import { ELEVATION, ELEVATION_VALUES } from '../index.js';
import type { LayerHost } from './layer-host.js';
```

and replace `export class WorldRenderSystem {` with `export class WorldRenderSystem implements LayerHost {`.

In each of `station-render-system.ts`, `track-aligned-platform-render-system.ts` and `joint-direction-render-system.ts`, replace the import of `WorldRenderSystem` from `'./world-render-system.js'` with `import type { LayerHost } from './layer-host.js';`, and the two `WorldRenderSystem` type annotations (the `_worldRenderSystem` field and the constructor's `worldRenderSystem` parameter) with `LayerHost`. Field and parameter names stay.

- [ ] **Step 5: The payload types (change 2).** Create `src/editing/preview-types.ts`. The four state types move here verbatim with their comments; `PreviewDrawData` is the duplicate engine's private type, now exported.

```ts
import type { Point } from '@ue-too/math';

import type { TrackSegmentDrawData } from '../index.js';

/**
 * Draw data for the track a tool is previewing, one entry per piece.
 * `undefined` clears the preview.
 */
export type PreviewDrawData = {
    index: number;
    drawData: TrackSegmentDrawData & {
        positiveOffsets: Point[];
        negativeOffsets: Point[];
    };
}[];

/**
 * Highlight payload for the curve deletion tool.
 * Non-null while the cursor is over a deletable segment.
 */
export type DeletionHighlightState = {
    segmentNumber: number;
} | null;

/**
 * Highlight payload for the duplicate-to-side tool.
 * `hover` = candidate under the cursor while no source is selected.
 * `selected` = the currently locked-in source while a preview is shown.
 */
export type DuplicateHighlightState = {
    segmentNumber: number;
    kind: 'hover' | 'selected';
} | null;

/**
 * Highlight payload for the catenary layout tool.
 * `hover` = candidate under the cursor while no source is selected.
 * `selected` = the currently locked-in source while a preview is shown.
 */
export type CatenaryHighlightState = {
    segmentNumber: number;
    kind: 'hover' | 'selected';
} | null;

/**
 * Preview payload emitted while the user is choosing a side.
 */
export type CatenaryPreviewState = {
    segmentNumber: number;
    side: 1 | -1;
} | null;
```

Then:

- In `src/editing/curve-engine.ts`:
    - delete the `DeletionHighlightState` type and its doc comment
    - import `DeletionHighlightState` and `PreviewDrawData` with `import type` from `'./preview-types.js'`
    - replace the three inline `{ index: number; drawData: TrackSegmentDrawData & { positiveOffsets: Point[]; negativeOffsets: Point[] } }[]` types with `PreviewDrawData`: the `_previewDrawDataObservable` field's type, its initializer, and `onPreviewDrawDataChange`'s observer
    - drop `TrackSegmentDrawData` from the `'../index.js'` import; nothing else uses it
- In `src/editing/duplicate-to-side-engine.ts`: delete the private `PreviewDrawData` type and the `DuplicateHighlightState` type with its doc comment, import both with `import type` from `'./preview-types.js'`, and drop `TrackSegmentDrawData` from the `'../index.js'` import.
- In `src/editing/catenary-layout-engine.ts`: delete `CatenaryHighlightState` and `CatenaryPreviewState` with their doc comments, and import both with `import type` from `'./preview-types.js'`.
- In `src/editing/index.ts`, after `export * from './new-joint.js';`, add `export * from './preview-types.js';`.
- In `test/curve-engine.test.ts`, replace:

    ```ts
    import {
        CurveCreationEngine,
        type DeletionHighlightState,
    } from '../src/editing/curve-engine.js';
    ```

    with:

    ```ts
    import { CurveCreationEngine } from '../src/editing/curve-engine.js';
    import type { DeletionHighlightState } from '../src/editing/preview-types.js';
    ```

- [ ] **Step 6: The preview sources (change 2).** Create `src/pixi/preview-sources.ts`:

```ts
import type { Observer, SubscriptionOptions } from '@ue-too/board';

import type {
    CatenaryHighlightState,
    CatenaryPreviewState,
    DeletionHighlightState,
    DuplicateHighlightState,
    PreviewDrawData,
} from '../editing/preview-types.js';
import type { ProjectionPositiveResult } from '../index.js';

/** Subscribes an observer to one stream of preview payloads. */
type Subscribe<T> = (
    observer: Observer<[T]>,
    options?: SubscriptionOptions
) => void;

/**
 * The previews the track renderer draws for the curve tool. The
 * `CurveCreationEngine` from `track-layout/editing` is one.
 */
export interface CurveCreationPreviewSource {
    onPreviewDrawDataChange: Subscribe<PreviewDrawData | undefined>;
    onDeletionHighlightChange: Subscribe<DeletionHighlightState>;
    onPreviewStartProjectionChange: Subscribe<ProjectionPositiveResult | null>;
    onPreviewEndProjectionChange: Subscribe<ProjectionPositiveResult | null>;
}

/**
 * The previews the track renderer draws for the duplicate-to-side tool. The
 * `DuplicateToSideEngine` from `track-layout/editing` is one.
 */
export interface DuplicateToSidePreviewSource {
    onPreviewDrawDataChange: Subscribe<PreviewDrawData | undefined>;
    onHighlightChange: Subscribe<DuplicateHighlightState>;
}

/**
 * The previews the track renderer draws for the catenary tool. The
 * `CatenaryLayoutEngine` from `track-layout/editing` is one.
 */
export interface CatenaryLayoutPreviewSource {
    onHighlightChange: Subscribe<CatenaryHighlightState>;
    onPreviewChange: Subscribe<CatenaryPreviewState>;
}
```

- [ ] **Step 7: The track renderer's options (change 2).** In `src/pixi/track-render-system.ts`:

Replace the four imports from `'../editing/index.js'` (lines 10–20 after Task 1's formatting: `CurveCreationEngine`; `CatenaryHighlightState, CatenaryLayoutEngine, CatenaryPreviewState`; `DeletionHighlightState`; `DuplicateHighlightState, DuplicateToSideEngine`) with:

```ts
import type {
    CatenaryHighlightState,
    CatenaryPreviewState,
    DeletionHighlightState,
    DuplicateHighlightState,
} from '../editing/preview-types.js';
```

Replace:

```ts
import {
    WorldRenderSystem,
    findElevationInterval,
} from './world-render-system.js';
```

with:

```ts
import type { LayerHost } from './layer-host.js';
import type {
    CatenaryLayoutPreviewSource,
    CurveCreationPreviewSource,
    DuplicateToSidePreviewSource,
} from './preview-sources.js';
import { findElevationInterval } from './world-render-system.js';
```

Replace:

```ts
export class TrackRenderSystem {
    private _worldRenderSystem: WorldRenderSystem;
```

with:

```ts
/**
 * What a {@link TrackRenderSystem} draws besides the laid track. Every field
 * is optional: a renderer given none draws the track graph and nothing else.
 */
export type TrackRenderSystemOptions = {
    /** Generates the rail, ballast and bed textures; without it those meshes are skipped. */
    textureRenderer?: TrackTextureRenderer | null;
    /** Terrain heights; without it the ground is flat at height 0. */
    terrain?: TerrainSampler | null;
    curveCreation?: CurveCreationPreviewSource;
    duplicateToSide?: DuplicateToSidePreviewSource;
    catenaryLayout?: CatenaryLayoutPreviewSource;
};

export class TrackRenderSystem {
    private _worldRenderSystem: LayerHost;
```

Replace the constructor's signature and first two statements:

```ts
    constructor(
        worldRenderSystem: WorldRenderSystem,
        trackCurveManager: TrackCurveManager,
        curveCreationEngine: CurveCreationEngine,
        camera: ObservableBoardCamera,
        textureRenderer?: TrackTextureRenderer | null,
        terrainData?: TerrainSampler | null,
        duplicateToSideEngine?: DuplicateToSideEngine,
        catenaryLayoutEngine?: CatenaryLayoutEngine
    ) {
        this._worldRenderSystem = worldRenderSystem;
        this._terrainData = terrainData ?? null;
```

with:

```ts
    constructor(
        worldRenderSystem: LayerHost,
        trackCurveManager: TrackCurveManager,
        camera: ObservableBoardCamera,
        options: TrackRenderSystemOptions = {}
    ) {
        const { curveCreation, duplicateToSide, catenaryLayout } = options;
        this._worldRenderSystem = worldRenderSystem;
        this._terrainData = options.terrain ?? null;
```

Then, in the constructor:

- wrap the `curveCreationEngine.onPreviewDrawDataChange(…)` and `curveCreationEngine.onDeletionHighlightChange(…)` subscriptions in `if (curveCreation) { … }`, calling them on `curveCreation`
- rename `duplicateToSideEngine` to `duplicateToSide` and `catenaryLayoutEngine` to `catenaryLayout` in their existing `if` blocks
- call the two projection subscriptions as `curveCreation?.onPreviewStartProjectionChange(…)` and `curveCreation?.onPreviewEndProjectionChange(…)`
- replace `this._textureRenderer = textureRenderer ?? null;` with `this._textureRenderer = options.textureRenderer ?? null;`

The subscriptions keep their handlers, their order and their `{ signal: this._abortController.signal }`.

- [ ] **Step 8: Verify**

Run: `bun run format >/dev/null && bun run typecheck && bun test test/track-render-sources.test.ts 2>&1 | grep -E " pass$| fail$" && tcount`
Expected: a clean typecheck, `5 pass`, then `392 pass`, `0 fail`, `Ran 392 tests across 38 files`.

- [ ] **Step 9: Commit**

```bash
git add src/pixi src/editing test/pixi-helpers.ts test/track-render-sources.test.ts test/curve-engine.test.ts
git commit -m "feat(pixi): layer host interface and optional preview sources"
```

---

### Task 3: Characterize the layer host and the track renderer

**Files:**

- Create: TL `test/world-render-system.test.ts`, `test/track-render-system.test.ts`

**Interfaces:**

- **Consumes:** Task 2's helpers, `TrackRenderSystem` with its options, `WorldRenderSystem`, and `TerrainSampler` from `src/pixi/tunnel-geometry.js`.

These tests describe the code as it is: write them, run them, and expect them to pass. Key facts they rely on:

- Seven bands, `SUB_3` to `ABOVE_3`, so the ground band is 3. A raw elevation between levels goes in the upper level's band; one outside the levels goes in the ground band.
- The track renderer's keys: the draw-data key (`drawKey`), `__rail__`, `__catenary__`, `__cutting__`, `__cutting_cover__`, `__tunnel_wall__` and `__tunnel_ceiling__` plus that key, `__simplified__<segment>`, `__underground__<segment>`, and `__preview__<i>` / `__preview_rail__<i>` for previews. Shadows and beds use the draw-data key.
- A shadow goes one level below its track, and is the mesh itself, not a container around it. A bed goes at the track's level.
- Below zoom 5 the simplified line shows; from 5 the detailed track shows.
- The first overlay the track renderer adds holds, in order: the duplicate, deletion and catenary highlights, the catenary preview, and the two projection dots.

- [ ] **Step 1: Write the layer host tests.** Create `test/world-render-system.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { Container } from 'pixi.js';

import { WorldRenderSystem } from '../src/pixi/world-render-system.js';
import { LEVEL_HEIGHT } from '../src/tracks/constants.js';
import { ELEVATION, ELEVATION_VALUES } from '../src/tracks/types.js';

/** The z-index of the sublayer a container sits in, and of that sublayer's band. */
function placement(container: Container) {
    return {
        sublayerZ: container.parent?.zIndex,
        bandZ: container.parent?.parent?.zIndex,
    };
}

describe('WorldRenderSystem', () => {
    it('maps each elevation level to its band, lowest first', () => {
        const host = new WorldRenderSystem();

        expect(host.bandCount).toBe(7);
        ELEVATION_VALUES.forEach((level, index) => {
            expect(host.getElevationBandIndex(level * LEVEL_HEIGHT)).toBe(
                index
            );
        });
    });

    it("puts an elevation between levels in the upper level's band", () => {
        const host = new WorldRenderSystem();

        expect(host.getElevationBandIndex(5)).toBe(4);
        expect(host.getElevationBandIndex(15)).toBe(5);
        expect(host.getElevationBandIndex(-5)).toBe(3);
        expect(host.resolveElevationLevel(15)).toBe(ELEVATION.ABOVE_2);
        expect(host.resolveElevationLevel(0)).toBe(ELEVATION.GROUND);
    });

    it('puts an elevation outside the levels in the ground band', () => {
        const host = new WorldRenderSystem();

        expect(host.getElevationBandIndex(40)).toBe(3);
        expect(host.getElevationBandIndex(-40)).toBe(3);
    });

    it('stacks a band as bed, drawable, rail, onTrack, catenary, shadow', () => {
        const host = new WorldRenderSystem();
        const items = {
            bed: new Container(),
            drawable: new Container(),
            rail: new Container(),
            onTrack: new Container(),
            catenary: new Container(),
            shadow: new Container(),
        };
        host.addBed('bed', items.bed, ELEVATION.ABOVE_1);
        host.addToBand('drawable', items.drawable, 4, 'drawable');
        host.addToBand('rail', items.rail, 4, 'rail');
        host.addToBand('onTrack', items.onTrack, 4, 'onTrack');
        host.addToBand('catenary', items.catenary, 4, 'catenary');
        host.addShadow('shadow', items.shadow, ELEVATION.ABOVE_1);

        expect(
            Object.values(items).map(item => placement(item).sublayerZ)
        ).toEqual([0, 1, 2, 3, 4, 5]);
        expect(
            Object.values(items).every(item => placement(item).bandZ === 4)
        ).toBe(true);
    });

    it('gives each band a terrain occlusion container just below it', () => {
        const host = new WorldRenderSystem();

        expect(host.getTerrainOcclusionContainer(0)?.zIndex).toBe(-0.5);
        expect(host.getTerrainOcclusionContainer(4)?.zIndex).toBe(3.5);
        expect(host.terrainBaseContainer.zIndex).toBe(-1);
    });

    it('moves a key that is added again to its new band and sublayer', () => {
        const host = new WorldRenderSystem();
        const item = new Container();

        host.addToBand('item', item, 3, 'drawable');
        host.addToBand('item', item, 5, 'rail');

        expect(placement(item)).toEqual({ sublayerZ: 2, bandZ: 5 });
        expect(host.getBandIndex('item')).toBe(5);
    });

    it('returns band and unbanded items on removal without destroying them', () => {
        const host = new WorldRenderSystem();
        const banded = new Container();
        const unbanded = new Container();
        host.addToBand('banded', banded, 3, 'drawable');
        host.addDrawable('unbanded', unbanded);

        expect(host.getDrawable('banded')).toBe(banded);
        expect(host.getDrawable('unbanded')).toBe(unbanded);
        expect(host.removeFromBand('banded')).toBe(banded);
        expect(host.removeDrawable('unbanded')).toBe(unbanded);
        expect(banded.destroyed).toBe(false);
        expect(banded.parent).toBeNull();
        expect(unbanded.parent).toBeNull();
        expect(host.getDrawable('banded')).toBeUndefined();
    });

    it('destroys beds and shadows on removal', () => {
        const host = new WorldRenderSystem();
        const bed = new Container();
        const shadow = new Container();
        host.addBed('bed', bed, ELEVATION.GROUND);
        host.addShadow('shadow', shadow, ELEVATION.GROUND);

        host.removeBed('bed');
        host.removeShadow('shadow');

        expect(bed.destroyed).toBe(true);
        expect(shadow.destroyed).toBe(true);
    });

    it('draws overlays above the bands unless given a z-index', () => {
        const host = new WorldRenderSystem();
        const overlay = new Container();
        const below = new Container();

        host.addOverlayContainer(overlay);
        host.addOverlayContainer(below, { zIndex: -2 });

        expect(overlay.parent).toBe(host.container);
        expect(overlay.zIndex).toBe(3);
        expect(below.zIndex).toBe(-2);
        host.removeOverlayContainer(overlay);
        expect(overlay.parent).toBeNull();
    });

    it('destroys everything it holds on cleanup', () => {
        const host = new WorldRenderSystem();
        const items = [new Container(), new Container(), new Container()];
        host.addToBand('banded', items[0], 3, 'rail');
        host.addBed('bed', items[1], ELEVATION.GROUND);
        host.addDrawable('unbanded', items[2]);

        host.cleanup();

        expect(items.every(item => item.destroyed)).toBe(true);
        expect(host.container.destroyed).toBe(true);
    });
});
```

- [ ] **Step 2: Write the track renderer tests.** Create `test/track-render-system.test.ts`:

```ts
import { BCurve } from '@ue-too/curve';
import { describe, expect, it } from 'bun:test';
import type { Container, Graphics } from 'pixi.js';

import {
    TrackRenderSystem,
    type TrackRenderSystemOptions,
} from '../src/pixi/track-render-system.js';
import type { TerrainSampler } from '../src/pixi/tunnel-geometry.js';
import { TrackGraph } from '../src/tracks/track.js';
import { ELEVATION } from '../src/tracks/types.js';
import {
    RecordingLayerHost,
    camera,
    drawKey,
    fakeCatenaryLayoutSource,
    fakeCurveCreationSource,
    fakeDuplicateToSideSource,
    textureRenderer,
    zoomTo,
} from './pixi-helpers.js';
import { layTrack } from './station-placement-helpers.js';

const A = { x: 0, y: 0 };
const B = { x: 100, y: 0 };
const C = { x: 200, y: 0 };
const KEY = drawKey(0);

/** A renderer on a fresh graph, with the texture stub unless options say otherwise. */
function scene(options: TrackRenderSystemOptions = {}) {
    const host = new RecordingLayerHost();
    const graph = new TrackGraph();
    const cam = camera();
    const renderer = new TrackRenderSystem(host, graph.trackCurveManager, cam, {
        textureRenderer,
        ...options,
    });
    return { host, graph, camera: cam, renderer };
}

/** Lays one straight segment from A to B, ramping from `from` to `to`. */
function layRamp(graph: TrackGraph, from: ELEVATION, to: ELEVATION) {
    const start = graph.createNewEmptyJoint(A, { x: 1, y: 0 }, from);
    const end = graph.createNewEmptyJoint(B, { x: 1, y: 0 }, to);
    graph.connectJoints(start, end, [{ x: 50, y: 0 }]);
}

/** Terrain at one height everywhere. */
const flatTerrain = (height: number): TerrainSampler => ({
    getHeight: () => height,
});

/** The overlay that holds the highlights and the projection dots. */
function topOverlay(host: RecordingLayerHost): Container {
    return host.overlays[0]!;
}

/** Whether a graphics object has anything drawn in it. */
function drawn(graphics: Container | undefined): boolean {
    return (graphics as Graphics).context.instructions.length > 0;
}

describe('TrackRenderSystem: laid track', () => {
    it('draws ground track in the ground band, with no shadow or bed', () => {
        const { host, graph } = scene();

        layTrack(graph, [A, B]);

        expect(host.bandKeys).toEqual([
            `__rail__${KEY}`,
            '__simplified__0',
            KEY,
        ]);
        expect(host.sublayerOf(KEY)).toBe('drawable');
        expect(host.sublayerOf(`__rail__${KEY}`)).toBe('rail');
        expect(host.sublayerOf('__simplified__0')).toBe('rail');
        expect(host.bandOf(KEY)).toBe(3);
        expect(host.shadowKeys).toEqual([]);
        expect(host.bedKeys).toEqual([]);
    });

    it('draws elevated track in its band and its shadow one level below', () => {
        const { host, graph } = scene();

        layTrack(graph, [A, B], ELEVATION.ABOVE_2);

        expect(host.bandOf(KEY)).toBe(5);
        expect(host.bandOf(`__rail__${KEY}`)).toBe(5);
        expect(host.shadowElevationOf(KEY)).toBe(ELEVATION.ABOVE_1);
    });

    it('draws a ramp in the band of its higher end', () => {
        const { host, graph } = scene();

        layRamp(graph, ELEVATION.GROUND, ELEVATION.ABOVE_1);

        expect(host.bandOf(KEY)).toBe(4);
        expect(host.shadowElevationOf(KEY)).toBe(ELEVATION.GROUND);
    });

    it('draws a bed at the track level and catenary in the catenary sublayer', () => {
        const { host, graph } = scene();
        graph.setNewSegmentStyle({ bed: true, electrified: true });

        layTrack(graph, [A, B], ELEVATION.ABOVE_1);

        expect(host.bedElevationOf(KEY)).toBe(ELEVATION.ABOVE_1);
        expect(host.sublayerOf(`__catenary__${KEY}`)).toBe('catenary');
        expect(host.bandOf(`__catenary__${KEY}`)).toBe(4);
    });

    it('draws no rails or shadows without a texture renderer', () => {
        const { host, graph } = scene({ textureRenderer: null });

        layTrack(graph, [A, B], ELEVATION.ABOVE_1);

        expect(host.bandKeys).toEqual(['__simplified__0', KEY]);
        expect(host.shadowKeys).toEqual([]);
    });

    it('removes everything a deleted segment registered', () => {
        const { host, graph } = scene();
        graph.setNewSegmentStyle({ bed: true, electrified: true });
        const { segments } = layTrack(graph, [A, B, C], ELEVATION.ABOVE_1);

        graph.removeTrackSegment(segments[0]!);

        const other = drawKey(1);
        expect(host.bandKeys).toEqual([
            `__catenary__${other}`,
            `__rail__${other}`,
            '__simplified__1',
            other,
        ]);
        expect(host.bedKeys).toEqual([other]);
        expect(host.shadowKeys).toEqual([other]);
    });

    it('reports the band of a draw-data piece, or null for an unknown one', () => {
        const { renderer, graph } = scene();
        layTrack(graph, [A, B], ELEVATION.ABOVE_1);

        expect(
            renderer.getTrackBandIndex({
                trackSegmentNumber: 0,
                tValInterval: { start: 0, end: 1 },
            })
        ).toBe(4);
        expect(
            renderer.getTrackBandIndex({
                trackSegmentNumber: 7,
                tValInterval: { start: 0, end: 1 },
            })
        ).toBeNull();
    });
});

describe('TrackRenderSystem: display settings', () => {
    it('shows the simplified track below zoom 5 and the detailed track from 5', async () => {
        const { host, graph, camera } = scene();
        graph.setNewSegmentStyle({ bed: true });
        layTrack(graph, [A, B], ELEVATION.ABOVE_1);
        const detailed = () => [
            host.bandItem(KEY)!.visible,
            host.bandItem(`__rail__${KEY}`)!.visible,
            host.shadow(KEY)!.visible,
        ];

        expect(host.bandItem('__simplified__0')!.visible).toBe(true);
        expect(detailed()).toEqual([false, false, false]);

        await zoomTo(camera, 5);
        expect(host.bandItem('__simplified__0')!.visible).toBe(false);
        expect(detailed()).toEqual([true, true, true]);

        await zoomTo(camera, 4.9);
        expect(host.bandItem('__simplified__0')!.visible).toBe(true);
    });

    it('swaps solid and gradient ballast when the elevation gradient is toggled', () => {
        const { host, graph, renderer } = scene();
        layTrack(graph, [A, B]);
        const ballast = host.bandItem(KEY)!.children[0]!;
        const [gradient, solid] = ballast.children;

        expect([gradient!.visible, solid!.visible]).toEqual([false, true]);
        renderer.showElevationGradient = true;
        expect([gradient!.visible, solid!.visible]).toEqual([true, false]);
    });

    it('moves a level shadow with the sun angle', () => {
        const { host, graph, renderer } = scene();
        layTrack(graph, [A, B], ELEVATION.ABOVE_1);
        const shadow = host.shadow(KEY)!;
        const before = { x: shadow.position.x, y: shadow.position.y };

        renderer.sunAngle = 90;

        expect(renderer.sunAngle).toBe(90);
        expect(before.x).toBeLessThan(0);
        expect(shadow.position.x).toBeCloseTo(0);
        expect(shadow.position.y).toBeCloseTo(-before.x * Math.SQRT2);
    });
});

describe('TrackRenderSystem: terrain', () => {
    it('treats missing terrain as flat ground, so track below ground is in a tunnel', () => {
        const { host, graph } = scene();

        layTrack(graph, [A, B], ELEVATION.SUB_1);

        expect(host.sublayerOf(`__tunnel_wall__${KEY}`)).toBe('drawable');
        expect(host.sublayerOf(`__tunnel_ceiling__${KEY}`)).toBe('catenary');
        expect(host.bandOf(`__tunnel_wall__${KEY}`)).toBe(2);
        expect(host.bandOf('__underground__0')).toBe(3);
    });

    it('puts ground-level track under higher terrain in a tunnel', () => {
        const { host, graph } = scene({ terrain: flatTerrain(20) });

        layTrack(graph, [A, B]);

        expect(host.bandOf(`__tunnel_wall__${KEY}`)).toBe(3);
        expect(host.bandOf('__underground__0')).toBe(5);
    });

    it('gives a ramp that crosses the terrain a cutting and a cover', () => {
        const { host, graph } = scene({ terrain: flatTerrain(5) });

        layRamp(graph, ELEVATION.GROUND, ELEVATION.ABOVE_1);

        expect(host.sublayerOf(`__cutting__${KEY}`)).toBe('drawable');
        expect(host.sublayerOf(`__cutting_cover__${KEY}`)).toBe('catenary');
    });

    it('draws no tunnel for track above the terrain', () => {
        const { host, graph } = scene({ terrain: flatTerrain(5) });

        layTrack(graph, [A, B], ELEVATION.ABOVE_1);

        expect(host.bandKeys.filter(key => key.includes('tunnel'))).toEqual([]);
    });
});

describe('TrackRenderSystem: previews and highlights', () => {
    function previewData(graph: TrackGraph) {
        return graph.trackCurveManager.getPreviewDrawData(
            new BCurve([A, { x: 50, y: 0 }, B]),
            ELEVATION.GROUND,
            ELEVATION.GROUND
        );
    }

    it('draws curve-tool preview track and clears it on undefined', () => {
        const curveCreation = fakeCurveCreationSource();
        const { host, graph } = scene({ curveCreation: curveCreation.source });

        curveCreation.emit('onPreviewDrawDataChange', previewData(graph));
        expect(host.bandKeys).toEqual(['__preview__0', '__preview_rail__0']);
        expect(host.sublayerOf('__preview__0')).toBe('drawable');
        expect(host.sublayerOf('__preview_rail__0')).toBe('rail');

        curveCreation.emit('onPreviewDrawDataChange', undefined);
        expect(host.bandKeys).toEqual([]);
    });

    it('replaces the previous preview rather than adding to it', () => {
        const duplicateToSide = fakeDuplicateToSideSource();
        const { host, graph } = scene({
            duplicateToSide: duplicateToSide.source,
        });

        duplicateToSide.emit('onPreviewDrawDataChange', previewData(graph));
        duplicateToSide.emit('onPreviewDrawDataChange', previewData(graph));

        expect(host.bandKeys).toEqual(['__preview__0', '__preview_rail__0']);
    });

    it('shows and hides the projection dots', () => {
        const curveCreation = fakeCurveCreationSource();
        const { host, graph } = scene({ curveCreation: curveCreation.source });
        layTrack(graph, [A, B]);
        const projection = graph.project({ x: 30, y: 0 });
        const [startDot, endDot] = topOverlay(host).children.slice(4);

        expect([startDot!.visible, endDot!.visible]).toEqual([false, false]);
        curveCreation.emit('onPreviewStartProjectionChange', projection);
        curveCreation.emit('onPreviewEndProjectionChange', projection);
        expect([startDot!.visible, endDot!.visible]).toEqual([true, true]);
        expect(startDot!.position.x).toBeCloseTo(30);

        curveCreation.emit('onPreviewStartProjectionChange', null);
        expect(startDot!.visible).toBe(false);
    });

    it('draws each tool highlight on its own graphics and clears it on null', () => {
        const curveCreation = fakeCurveCreationSource();
        const duplicateToSide = fakeDuplicateToSideSource();
        const catenaryLayout = fakeCatenaryLayoutSource();
        const { host, graph } = scene({
            curveCreation: curveCreation.source,
            duplicateToSide: duplicateToSide.source,
            catenaryLayout: catenaryLayout.source,
        });
        layTrack(graph, [A, B]);
        const [duplicate, deletion, catenary, catenaryPreview] =
            topOverlay(host).children;

        duplicateToSide.emit('onHighlightChange', {
            segmentNumber: 0,
            kind: 'hover',
        });
        curveCreation.emit('onDeletionHighlightChange', { segmentNumber: 0 });
        catenaryLayout.emit('onHighlightChange', {
            segmentNumber: 0,
            kind: 'selected',
        });
        catenaryLayout.emit('onPreviewChange', { segmentNumber: 0, side: 1 });
        expect(
            [duplicate, deletion, catenary, catenaryPreview].map(drawn)
        ).toEqual([true, true, true, true]);

        duplicateToSide.emit('onHighlightChange', null);
        curveCreation.emit('onDeletionHighlightChange', null);
        catenaryLayout.emit('onHighlightChange', null);
        catenaryLayout.emit('onPreviewChange', null);
        expect(
            [duplicate, deletion, catenary, catenaryPreview].map(drawn)
        ).toEqual([false, false, false, false]);
    });

    it('draws no highlight for a segment that does not exist', () => {
        const curveCreation = fakeCurveCreationSource();
        const { host } = scene({ curveCreation: curveCreation.source });

        curveCreation.emit('onDeletionHighlightChange', { segmentNumber: 9 });

        expect(drawn(topOverlay(host).children[1])).toBe(false);
    });
});

describe('TrackRenderSystem: cleanup', () => {
    it('removes everything it registered with the host', () => {
        const curveCreation = fakeCurveCreationSource();
        const { host, graph, renderer } = scene({
            curveCreation: curveCreation.source,
            terrain: flatTerrain(5),
        });
        graph.setNewSegmentStyle({ bed: true, electrified: true });
        layTrack(graph, [A, B], ELEVATION.ABOVE_1);
        layRamp(graph, ELEVATION.SUB_1, ELEVATION.GROUND);
        curveCreation.emit(
            'onPreviewDrawDataChange',
            graph.trackCurveManager.getPreviewDrawData(
                new BCurve([C, { x: 250, y: 0 }, { x: 300, y: 0 }]),
                ELEVATION.GROUND,
                ELEVATION.GROUND
            )
        );
        expect(host.bandKeys.length).toBeGreaterThan(0);

        renderer.cleanup();

        expect(host.bandKeys).toEqual([]);
        expect(host.bedKeys).toEqual([]);
        expect(host.shadowKeys).toEqual([]);
        expect(host.overlays).toEqual([]);
    });
});
```

- [ ] **Step 3: Run them**

Run: `bun run format >/dev/null && bun run typecheck && bun test test/world-render-system.test.ts test/track-render-system.test.ts 2>&1 | grep -E "^\(fail\)| pass$| fail$"`
Expected: a clean typecheck and `30 pass`, `0 fail`. A failure here means an expectation is wrong (see Conventions).

- [ ] **Step 4: Verify**

Run: `bun run format:check && tcount`
Expected: `422 pass`, `0 fail`, `Ran 422 tests across 40 files`.

- [ ] **Step 5: Commit**

```bash
git add test/world-render-system.test.ts test/track-render-system.test.ts
git commit -m "test(pixi): characterize the layer host and the track renderer"
```

---

### Task 4: Characterize the station, platform and joint-direction renderers

**Files:**

- Create: TL `test/station-render-system.test.ts`, `test/track-aligned-platform-render-system.test.ts`, `test/joint-direction-render-system.test.ts`

**Interfaces:**

- **Consumes:** Task 2's helpers, `createIslandStation` from `src/stations/station-factory.js`, and `bareStation` and `layTrack` from `test/station-placement-helpers.ts`.

As in Task 3, these describe the code as it is. Each fixture creates its stations and platforms before building the renderer, so the tests draw them with explicit `addStation` and `addPlatform` calls. That keeps them valid after Task 5, when the renderers also start drawing what the managers create. Facts they rely on:

- Keys: `station-<id>`, `track-aligned-platform-<id>`, and the unbanded previews `station-preview` and `track-aligned-platform-preview` at z-index 9999. Both renderers put their items in the drawable sublayer at order 450.
- Without a texture renderer, a station is an empty container, and a platform isn't drawn at all.
- `StationRenderSystem.cleanup()` leaves its preview in the host. The platform renderer's removes it.
- `JointDirectionRenderSystem` cleans up with `dispose()`, which destroys its overlay without calling `removeOverlayContainer`.
- The joint overlay holds the highlight container, the arrow container and the hover graphics, in that order. The selected branch is green (`0x22c55e`) and the others grey (`0x9ca3af`). The hover dot's radius is 8 divided by the zoom level.

- [ ] **Step 1: Write the station renderer tests.** Create `test/station-render-system.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import type { Graphics } from 'pixi.js';

import { StationRenderSystem } from '../src/pixi/station-render-system.js';
import type { TrackTextureRenderer } from '../src/pixi/track-render-system.js';
import { createIslandStation } from '../src/stations/station-factory.js';
import { StationManager } from '../src/stations/station-manager.js';
import { TrackGraph } from '../src/tracks/track.js';
import { ELEVATION } from '../src/tracks/types.js';
import { RecordingLayerHost, textureRenderer } from './pixi-helpers.js';
import { bareStation } from './station-placement-helpers.js';

/**
 * A renderer over a graph that already holds an island station with two
 * platforms, centred on the origin. The station exists before the renderer,
 * so the tests draw it explicitly.
 */
function scene(
    elevation = ELEVATION.GROUND,
    texture: TrackTextureRenderer | null = textureRenderer
) {
    const host = new RecordingLayerHost();
    const graph = new TrackGraph();
    const stations = new StationManager();
    const id = createIslandStation(graph, stations, {
        position: { x: 0, y: 0 },
        direction: { x: 1, y: 0 },
        length: 100,
        elevation,
    });
    const renderer = new StationRenderSystem(host, stations, graph, texture);
    return { host, graph, stations, renderer, id };
}

describe('StationRenderSystem', () => {
    it("draws a station's platforms in the drawable sublayer of its band, at order 450", () => {
        const { host, renderer, id } = scene(ELEVATION.ABOVE_1);

        renderer.addStation(id);

        const key = `station-${id}`;
        expect(host.bandKeys).toEqual([key]);
        expect(host.sublayerOf(key)).toBe('drawable');
        expect(host.bandOf(key)).toBe(4);
        expect(host.bandItem(key)!.zIndex).toBe(450);
        expect(host.bandItem(key)!.children).toHaveLength(2);
    });

    it('draws a station with no platforms as an empty container', () => {
        const { host, stations, renderer } = scene();
        const id = stations.createStation(bareStation({ x: 0, y: 0 }));

        renderer.addStation(id);

        expect(host.bandItem(`station-${id}`)!.children).toHaveLength(0);
    });

    it('draws empty platforms without a texture renderer', () => {
        const { host, renderer, id } = scene(ELEVATION.GROUND, null);

        renderer.addStation(id);

        expect(host.bandItem(`station-${id}`)!.children).toHaveLength(0);
    });

    it('ignores a second add and an unknown id', () => {
        const { host, renderer, id } = scene();
        renderer.addStation(id);
        const first = host.bandItem(`station-${id}`);

        renderer.addStation(id);
        renderer.addStation(99);

        expect(host.bandItem(`station-${id}`)).toBe(first);
        expect(host.bandKeys).toEqual([`station-${id}`]);
    });

    it('removes and destroys a station', () => {
        const { host, renderer, id } = scene();
        renderer.addStation(id);
        const container = host.bandItem(`station-${id}`)!;

        renderer.removeStation(id);

        expect(host.bandKeys).toEqual([]);
        expect(container.destroyed).toBe(true);
    });

    it('shows the placement preview as one unbanded drawable, and hides it', () => {
        const { host, renderer } = scene();

        renderer.showPreview({ x: 0, y: 0 }, { x: 1, y: 0 }, 50, 10.4);
        renderer.showPreview({ x: 5, y: 0 }, { x: 1, y: 0 }, 60, 10.4);

        expect(host.drawableKeys).toEqual(['station-preview']);
        const preview = host.getDrawable('station-preview') as Graphics;
        expect(preview.zIndex).toBe(9999);
        expect(preview.context.instructions.length).toBeGreaterThan(0);

        renderer.hidePreview();
        expect(host.drawableKeys).toEqual([]);
        expect(preview.destroyed).toBe(true);
    });

    it('removes its stations on cleanup, but leaves its preview', () => {
        const { host, renderer, id } = scene();
        renderer.addStation(id);
        renderer.showPreview({ x: 0, y: 0 }, { x: 1, y: 0 }, 50, 10.4);

        renderer.cleanup();

        expect(host.bandKeys).toEqual([]);
        expect(host.drawableKeys).toEqual(['station-preview']);
    });
});
```

- [ ] **Step 2: Write the platform renderer tests.** Create `test/track-aligned-platform-render-system.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import type { Graphics } from 'pixi.js';

import { TrackAlignedPlatformRenderSystem } from '../src/pixi/track-aligned-platform-render-system.js';
import type { TrackTextureRenderer } from '../src/pixi/track-render-system.js';
import { TrackAlignedPlatformManager } from '../src/stations/track-aligned-platform-manager.js';
import { TrackGraph } from '../src/tracks/track.js';
import { RecordingLayerHost, textureRenderer } from './pixi-helpers.js';
import { layTrack } from './station-placement-helpers.js';

const PREVIEW = 'track-aligned-platform-preview';

/**
 * A renderer over one straight segment, 0 to 100 along x, and a platform
 * along its left side for station 1. The platform exists before the
 * renderer, so the tests draw it explicitly.
 */
function scene(texture: TrackTextureRenderer | null = textureRenderer) {
    const host = new RecordingLayerHost();
    const graph = new TrackGraph();
    layTrack(graph, [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
    ]);
    const platforms = new TrackAlignedPlatformManager();
    const id = platforms.createPlatform({
        stationId: 1,
        spine: [{ trackSegment: 0, tStart: 0, tEnd: 1, side: 1 }],
        offset: 2,
        outerVertices: [
            { x: 100, y: 8 },
            { x: 0, y: 8 },
        ],
        stopPositions: [],
    });
    const renderer = new TrackAlignedPlatformRenderSystem(
        host,
        platforms,
        graph,
        texture
    );
    return { host, graph, platforms, renderer, id };
}

function previewGraphics(host: RecordingLayerHost): Graphics {
    return host.getDrawable(PREVIEW) as Graphics;
}

describe('TrackAlignedPlatformRenderSystem', () => {
    it('draws a platform in the drawable sublayer of the band for the elevation given, at order 450', () => {
        const { host, renderer, id } = scene();

        renderer.addPlatform(id, 1);

        const key = `track-aligned-platform-${id}`;
        expect(host.bandKeys).toEqual([key]);
        expect(host.sublayerOf(key)).toBe('drawable');
        expect(host.bandOf(key)).toBe(4);
        expect(host.bandItem(key)!.zIndex).toBe(450);
        expect(host.bandItem(key)!.children).toHaveLength(1);
    });

    it('draws nothing without a texture renderer', () => {
        const { host, renderer, id } = scene(null);

        renderer.addPlatform(id, 0);

        expect(host.bandKeys).toEqual([]);
    });

    it('ignores a second add and an unknown id', () => {
        const { host, renderer, id } = scene();
        renderer.addPlatform(id, 0);
        const first = host.bandItem(`track-aligned-platform-${id}`);

        renderer.addPlatform(id, 2);
        renderer.addPlatform(99, 0);

        expect(host.bandItem(`track-aligned-platform-${id}`)).toBe(first);
        expect(host.bandOf(`track-aligned-platform-${id}`)).toBe(3);
        expect(host.bandKeys).toHaveLength(1);
    });

    it('removes and destroys a platform', () => {
        const { host, renderer, id } = scene();
        renderer.addPlatform(id, 0);
        const container = host.bandItem(`track-aligned-platform-${id}`)!;

        renderer.removePlatform(id);

        expect(host.bandKeys).toEqual([]);
        expect(container.destroyed).toBe(true);
    });

    it('draws every preview on one unbanded graphics at z-index 9999', () => {
        const { host, renderer } = scene();

        renderer.showTrackHighlight(0, 0.5, 1, 2);
        const preview = previewGraphics(host);
        expect(host.drawableKeys).toEqual([PREVIEW]);
        expect(preview.zIndex).toBe(9999);
        expect(preview.context.instructions.length).toBeGreaterThan(0);

        renderer.showPlacementPreview(
            [
                { x: 0, y: 2 },
                { x: 100, y: 2 },
            ],
            [{ x: 100, y: 8 }],
            { x: 0, y: 2 },
            { x: 100, y: 2 }
        );
        renderer.showDualSpinePlacementPreview(
            [
                { x: 0, y: 2 },
                { x: 100, y: 2 },
            ],
            [
                { x: 0, y: 12 },
                { x: 100, y: 12 },
            ],
            [{ x: 100, y: 7 }],
            [],
            { x: 0, y: 2 },
            { x: 100, y: 2 },
            { x: 0, y: 12 },
            null
        );
        renderer.showCapDrawingHover(
            { x: 100, y: 7 },
            { x: 50, y: 7 },
            { x: 0, y: 2 },
            false
        );

        expect(previewGraphics(host)).toBe(preview);
        expect(preview.context.instructions.length).toBeGreaterThan(0);
    });

    it('draws no track highlight for a segment that does not exist', () => {
        const { host, renderer } = scene();

        renderer.showTrackHighlight(9, 0.5, 1, 2);

        expect(host.drawableKeys).toEqual([]);
    });

    it('removes its preview with hidePreview', () => {
        const { host, renderer } = scene();
        renderer.showTrackHighlight(0, 0.5, 1, 2);
        const preview = previewGraphics(host);

        renderer.hidePreview();

        expect(host.drawableKeys).toEqual([]);
        expect(preview.destroyed).toBe(true);
    });

    it('removes its platforms and preview on cleanup', () => {
        const { host, renderer, id } = scene();
        renderer.addPlatform(id, 0);
        renderer.showTrackHighlight(0, 0.5, 1, 2);

        renderer.cleanup();

        expect(host.bandKeys).toEqual([]);
        expect(host.drawableKeys).toEqual([]);
    });
});
```

- [ ] **Step 3: Write the joint-direction renderer tests.** Create `test/joint-direction-render-system.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import type { Container, Graphics } from 'pixi.js';

import { JointDirectionRenderSystem } from '../src/pixi/joint-direction-render-system.js';
import { JointDirectionPreferenceMap } from '../src/tracks/joint-direction-preference-map.js';
import { TrackGraph } from '../src/tracks/track.js';
import { ELEVATION } from '../src/tracks/types.js';
import { RecordingLayerHost, camera, zoomTo } from './pixi-helpers.js';

/** Joint 1 at (100, 0) is a switch: it branches to joints 2 and 3. */
function scene() {
    const host = new RecordingLayerHost();
    const graph = new TrackGraph();
    const joints = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 40 },
    ].map(position =>
        graph.createNewEmptyJoint(position, { x: 1, y: 0 }, ELEVATION.GROUND)
    );
    graph.connectJoints(joints[0]!, joints[1]!, [{ x: 50, y: 0 }]);
    graph.connectJoints(joints[1]!, joints[2]!, [{ x: 150, y: 0 }]);
    graph.connectJoints(joints[1]!, joints[3]!, [{ x: 150, y: 0 }]);
    const preferences = new JointDirectionPreferenceMap();
    const cam = camera();
    const renderer = new JointDirectionRenderSystem(
        host,
        graph,
        preferences,
        cam
    );
    const [overlay] = host.overlays;
    const [highlights, arrows, hover] = overlay!.children as [
        Container,
        Container,
        Graphics,
    ];
    return {
        host,
        preferences,
        camera: cam,
        renderer,
        overlay: overlay!,
        highlights,
        arrows,
        hover,
    };
}

/** The colour of a graphics object's first stroke. */
function strokeColor(graphics: Container): number | undefined {
    const instruction = (graphics as Graphics).context.instructions.find(
        i => i.action === 'stroke'
    );
    return (instruction?.data as { style?: { color?: number } })?.style?.color;
}

describe('JointDirectionRenderSystem', () => {
    it('registers one hidden overlay, shown and hidden with the tool', () => {
        const { host, overlay, renderer } = scene();

        expect(host.overlays).toHaveLength(1);
        expect(overlay.visible).toBe(false);
        renderer.show();
        expect(overlay.visible).toBe(true);
        renderer.hide();
        expect(overlay.visible).toBe(false);
    });

    it('draws a highlight and an arrow for each branch of a selected switch', () => {
        const { renderer, highlights, arrows } = scene();

        renderer.selectJoint(1);

        expect(renderer.selectedJoint).toBe(1);
        expect(highlights.children).toHaveLength(2);
        expect(arrows.children).toHaveLength(2);

        renderer.deselectJoint();
        expect(renderer.selectedJoint).toBeNull();
        expect(highlights.children).toHaveLength(0);
        expect(arrows.children).toHaveLength(0);
    });

    it('draws nothing for a joint that does not branch', () => {
        const { renderer, highlights } = scene();

        renderer.selectJoint(0);

        expect(highlights.children).toHaveLength(0);
    });

    it('colours the preferred branch green and the other grey', () => {
        const { renderer, preferences, highlights } = scene();
        preferences.set(1, 'tangent', 3);

        renderer.selectJoint(1);

        expect(highlights.children.map(strokeColor)).toEqual([
            0x9ca3af, 0x22c55e,
        ]);
        preferences.set(1, 'tangent', 2);
        renderer.refresh();
        expect(highlights.children.map(strokeColor)).toEqual([
            0x22c55e, 0x9ca3af,
        ]);
    });

    it('sizes the hover dot to stay the same on screen as the camera zooms', async () => {
        const { renderer, camera, hover } = scene();

        renderer.showHoverIndicator(1);
        expect(hover.getLocalBounds().width).toBeCloseTo(16);

        await zoomTo(camera, 2);
        renderer.showHoverIndicator(1);
        expect(hover.getLocalBounds().width).toBeCloseTo(8);

        renderer.clearHoverIndicator();
        expect(hover.context.instructions).toHaveLength(0);
    });

    it('redraws a selection when the camera zooms', async () => {
        const { renderer, camera, highlights } = scene();
        renderer.selectJoint(1);
        const before = highlights.children[0];

        await zoomTo(camera, 2);

        expect(highlights.children).toHaveLength(2);
        expect(highlights.children[0]).not.toBe(before);
    });

    it('clears the selection and hover when hidden', () => {
        const { renderer, highlights, hover } = scene();
        renderer.show();
        renderer.selectJoint(1);
        renderer.showHoverIndicator(1);

        renderer.hide();

        expect(renderer.selectedJoint).toBeNull();
        expect(highlights.children).toHaveLength(0);
        expect(hover.context.instructions).toHaveLength(0);
    });

    it('destroys its overlay on dispose without calling removeOverlayContainer', () => {
        const { host, overlay, renderer } = scene();

        renderer.dispose();

        expect(overlay.destroyed).toBe(true);
        expect(host.overlays).toEqual([overlay]);
    });
});
```

- [ ] **Step 4: Run them**

Run: `bun run format >/dev/null && bun run typecheck && bun test test/station-render-system.test.ts test/track-aligned-platform-render-system.test.ts test/joint-direction-render-system.test.ts 2>&1 | grep -E "^\(fail\)| pass$| fail$"`
Expected: a clean typecheck and `23 pass`, `0 fail`.

- [ ] **Step 5: Verify**

Run: `bun run format:check && tcount`
Expected: `445 pass`, `0 fail`, `Ran 445 tests across 43 files`.

- [ ] **Step 6: Commit**

```bash
git add test/station-render-system.test.ts test/track-aligned-platform-render-system.test.ts test/joint-direction-render-system.test.ts
git commit -m "test(pixi): characterize the station, platform and joint-direction renderers"
```

---

### Task 5: The station and platform renderers follow their managers

**Files:**

- Create: TL `test/station-render-events.test.ts`
- Modify: TL `src/pixi/station-render-system.ts`, `src/pixi/track-aligned-platform-render-system.ts`, `test/track-aligned-platform-render-system.test.ts`

**Interfaces:**

- **Consumes:** the managers' phase 3 events: `StationManager.onStationAdded` / `onStationRemoved` and `TrackAlignedPlatformManager.onPlatformAdded` / `onPlatformRemoved`, each `(cb: (id: number) => void, options?: SubscriptionOptions) => () => void`.
- **Produces:** `new TrackAlignedPlatformRenderSystem(host: LayerHost, platformManager: TrackAlignedPlatformManager, stationManager: StationManager, trackGraph: TrackGraph, textureRenderer?: TrackTextureRenderer | null)`. `StationRenderSystem`'s constructor is unchanged. Both subscribe in their constructors and stop on `cleanup()`.

- [ ] **Step 1: Write the failing tests.** These are banana's five `wireStationRenderers` cases, against the real renderers. Create `test/station-render-events.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import type { Container } from 'pixi.js';

import { StationRenderSystem } from '../src/pixi/station-render-system.js';
import { TrackAlignedPlatformRenderSystem } from '../src/pixi/track-aligned-platform-render-system.js';
import type { BandSublayer } from '../src/pixi/world-render-system.js';
import { StationManager } from '../src/stations/station-manager.js';
import { TrackAlignedPlatformManager } from '../src/stations/track-aligned-platform-manager.js';
import type { TrackAlignedPlatform } from '../src/stations/track-aligned-platform-types.js';
import { TrackGraph } from '../src/tracks/track.js';
import { ELEVATION } from '../src/tracks/types.js';
import { RecordingLayerHost, textureRenderer } from './pixi-helpers.js';
import { bareStation, layTrack } from './station-placement-helpers.js';

/** A recording host that also logs band additions (+) and removals (-) in order. */
class LoggingLayerHost extends RecordingLayerHost {
    log: string[] = [];

    override addToBand(
        key: string,
        container: Container,
        bandIndex: number,
        sublayer: BandSublayer
    ): void {
        this.log.push(`+${key}`);
        super.addToBand(key, container, bandIndex, sublayer);
    }
    override removeFromBand(key: string): Container | undefined {
        this.log.push(`-${key}`);
        return super.removeFromBand(key);
    }
}

function platformFor(stationId: number): Omit<TrackAlignedPlatform, 'id'> {
    return {
        stationId,
        spine: [{ trackSegment: 0, tStart: 0, tEnd: 1, side: 1 }],
        offset: 2,
        outerVertices: [
            { x: 100, y: 8 },
            { x: 0, y: 8 },
        ],
        stopPositions: [],
    };
}

/** Both renderers over real managers, with banana's station-delete cascade. */
function scene() {
    const host = new LoggingLayerHost();
    const graph = new TrackGraph();
    layTrack(graph, [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
    ]);
    const stations = new StationManager();
    const platforms = new TrackAlignedPlatformManager();
    stations.setOnDestroyStation(stationId => {
        for (const { id } of platforms.getPlatformsByStation(stationId)) {
            platforms.destroyPlatform(id);
        }
    });
    const stationRenderer = new StationRenderSystem(
        host,
        stations,
        graph,
        textureRenderer
    );
    const platformRenderer = new TrackAlignedPlatformRenderSystem(
        host,
        platforms,
        stations,
        graph,
        textureRenderer
    );
    return {
        host,
        stations,
        platforms,
        stationRenderer,
        platformRenderer,
    };
}

function station(elevation: ELEVATION = ELEVATION.GROUND) {
    return { ...bareStation({ x: 0, y: 0 }), elevation };
}

describe('station and platform renderers follow their managers', () => {
    it('draws a station when it is created and removes it when destroyed', () => {
        const { host, stations } = scene();

        const id = stations.createStation(station());
        stations.destroyStation(id);

        expect(host.log).toEqual([`+station-${id}`, `-station-${id}`]);
    });

    it("draws a platform at its station's elevation, or at ground without one", () => {
        const { host, stations, platforms } = scene();
        const stationId = stations.createStation(station(ELEVATION.ABOVE_1));

        const id = platforms.createPlatform(platformFor(stationId));
        const orphan = platforms.createPlatform(platformFor(99));

        expect(host.bandOf(`track-aligned-platform-${id}`)).toBe(4);
        expect(host.bandOf(`track-aligned-platform-${orphan}`)).toBe(3);
    });

    it("removes a deleted station's platforms, then the station", () => {
        const { host, stations, platforms } = scene();
        const stationId = stations.createStation(station());
        const p1 = platforms.createPlatform(platformFor(stationId));
        const p2 = platforms.createPlatform(platformFor(stationId));
        host.log.length = 0;

        stations.destroyStation(stationId);

        expect(host.log).toEqual([
            `-track-aligned-platform-${p1}`,
            `-track-aligned-platform-${p2}`,
            `-station-${stationId}`,
        ]);
    });

    it('swaps the visuals once each when a scene load replaces the stations', () => {
        const { host, stations, platforms } = scene();
        const old = stations.createStation(station());
        const oldPlatform = platforms.createPlatform(platformFor(old));
        host.log.length = 0;

        // The order banana's scene load replaces them in: the stations
        // block (destroy the old, create the restored), then the platforms
        // block (destroy the remaining, create the restored).
        for (const { id } of stations.getStations()) {
            stations.destroyStation(id);
        }
        stations.createStationWithId(4, {
            ...station(ELEVATION.ABOVE_1),
            id: 4,
        });
        for (const { id } of platforms.getAllPlatforms()) {
            platforms.destroyPlatform(id);
        }
        platforms.createPlatformWithId(9, platformFor(4));

        expect(host.log).toEqual([
            `-track-aligned-platform-${oldPlatform}`,
            `-station-${old}`,
            '+station-4',
            '+track-aligned-platform-9',
        ]);
        expect(host.bandOf('track-aligned-platform-9')).toBe(4);
    });

    it('stops following the managers after cleanup', () => {
        const { host, stations, platforms, stationRenderer, platformRenderer } =
            scene();
        stationRenderer.cleanup();
        platformRenderer.cleanup();
        host.log.length = 0;

        const stationId = stations.createStation(station());
        platforms.destroyPlatform(
            platforms.createPlatform(platformFor(stationId))
        );
        stations.destroyStation(stationId);

        expect(host.log).toEqual([]);
    });
});
```

- [ ] **Step 2: See them fail**

Run: `bun run typecheck 2>&1 | grep "error TS"; bun test test/station-render-events.test.ts 2>&1 | grep -E " pass$| fail$"`
Expected: one typecheck error, `Expected 3-4 arguments, but got 5` for the platform renderer, and `1 pass`, `4 fail`. The cleanup test passes already, since nothing is drawn yet.

- [ ] **Step 3: Subscribe the station renderer.** In `src/pixi/station-render-system.ts`:

- add a field `private _abortController = new AbortController();` after `_platformTexture`
- give the constructor this doc comment:

    ```ts
    /**
     * Draws each station the manager creates from now on, and removes each
     * one it destroys. Stations that already exist are drawn with
     * {@link addStation}.
     */
    ```

- at the end of the constructor, add:

    ```ts
            const options = { signal: this._abortController.signal };
            stationManager.onStationAdded(id => this.addStation(id), options);
            stationManager.onStationRemoved(id => this.removeStation(id), options);
    ```

- make `this._abortController.abort();` the first statement of `cleanup()`.

- [ ] **Step 4: Subscribe the platform renderer.** In `src/pixi/track-aligned-platform-render-system.ts`:

- add `import type { StationManager } from '../index.js';` next to the other model imports
- add a field `private _stationManager: StationManager;` after `_platformManager`, and `private _abortController = new AbortController();` after `_platformTexture`
- add the parameter `stationManager: StationManager` after `platformManager`, assign it to `this._stationManager`, and give the constructor this doc comment:

    ```ts
    /**
     * Draws each platform the manager creates from now on, at its station's
     * elevation, and removes each one it destroys. Platforms that already
     * exist are drawn with {@link addPlatform}.
     */
    ```

- at the end of the constructor, add:

    ```ts
            const options = { signal: this._abortController.signal };
            platformManager.onPlatformAdded(
                id => this.addPlatform(id, this._stationElevation(id)),
                options
            );
            platformManager.onPlatformRemoved(
                id => this.removePlatform(id),
                options
            );
    ```

- add, after the constructor, `private _stationElevation(platformId: number): number` with the doc comment `/** The elevation of a platform's station, or 0 when either is missing. */`. It returns `this._stationManager.getStation(platform.stationId)?.elevation ?? 0` for the platform `this._platformManager.getPlatform(platformId)`, and `0` when that is `null`. This is the lookup banana's `wireStationRenderers` does.
- make `this._abortController.abort();` the first statement of `cleanup()`.

- [ ] **Step 5: Update the platform renderer's test fixture.** In `test/track-aligned-platform-render-system.test.ts`, import `StationManager` from `'../src/stations/station-manager.js'`, and in `scene()` pass `new StationManager()` as the third constructor argument, between `platforms` and `graph`.

- [ ] **Step 6: Verify**

Run: `bun run format >/dev/null && bun run typecheck && bun test test/station-render-events.test.ts 2>&1 | grep -E " pass$| fail$" && bun run format:check && tcount`
Expected: a clean typecheck, `5 pass`, then `450 pass`, `0 fail`, `Ran 450 tests across 44 files`.

- [ ] **Step 7: Commit**

```bash
git add src/pixi/station-render-system.ts src/pixi/track-aligned-platform-render-system.ts test/station-render-events.test.ts test/track-aligned-platform-render-system.test.ts
git commit -m "feat(pixi): station and platform renderers follow their managers"
```

---

### Task 6: Redraw every piece of a restyled segment

**Files:**

- Create: TL `test/track-restyle.test.ts`
- Modify: TL `src/pixi/track-render-system.ts`, `src/tracks/trackcurve-manager.ts`

**Interfaces:**

- **Consumes:** `TrackGraph.setNewSegmentStyle`, `TrackGraph.setSegmentStyle`, and the renderer's private `_onDelete(key)` and `_onNewTrackData(index, drawDataList)`.
- **Produces:** `TrackCurveManager.persistedDrawData` typed as `(TrackSegmentDrawData & { callback(index: number): void; positiveOffsets: Point[]; negativeOffsets: Point[] })[]`. The runtime value is unchanged.

- [ ] **Step 1: Write the failing tests.** Each test lays segment 0 with one style and restyles it, and lays segment 1, 50 m away, directly with the final style, as the reference. Create `test/track-restyle.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import type { MeshSimple } from 'pixi.js';

import { TrackRenderSystem } from '../src/pixi/track-render-system.js';
import type { SegmentStyle } from '../src/tracks/segment-style.js';
import { TrackGraph } from '../src/tracks/track.js';
import { ELEVATION } from '../src/tracks/types.js';
import {
    RecordingLayerHost,
    camera,
    drawKey,
    textureRenderer,
} from './pixi-helpers.js';
import { layTrack } from './station-placement-helpers.js';

/**
 * Segment 0, laid with `before`, then restyled with `patch`; and segment 1,
 * laid apart from it with the style segment 0 ends up with.
 */
function restyled(before: Partial<SegmentStyle>, patch: Partial<SegmentStyle>) {
    const host = new RecordingLayerHost();
    const graph = new TrackGraph();
    new TrackRenderSystem(host, graph.trackCurveManager, camera(), {
        textureRenderer,
    });
    graph.setNewSegmentStyle(before);
    layTrack(
        graph,
        [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
        ],
        ELEVATION.ABOVE_1
    );
    graph.setNewSegmentStyle(patch);
    layTrack(
        graph,
        [
            { x: 0, y: 50 },
            { x: 100, y: 50 },
        ],
        ELEVATION.ABOVE_1
    );
    const pieces = (segment: number) => {
        const key = drawKey(segment);
        return {
            drawable: host.bandItem(key),
            rail: host.bandItem(`__rail__${key}`),
            catenary: host.bandItem(`__catenary__${key}`),
            bedElevation: host.bedElevationOf(key),
            shadow: host.shadow(key),
        };
    };
    const before0 = pieces(0);
    const before1 = pieces(1);
    graph.setSegmentStyle(0, patch);
    return { host, before0, before1, after0: pieces(0), after1: pieces(1) };
}

/** The texture of the rail mesh in a rail container. */
function railTexture(rail: ReturnType<typeof restyled>['after0']['rail']) {
    return (rail!.children[0] as MeshSimple).texture;
}

describe('restyling a laid segment', () => {
    it('rebuilds its drawable, rails and shadow', () => {
        const { before0, after0 } = restyled({}, { trackStyle: 'slab' });

        expect(after0.drawable).not.toBe(before0.drawable);
        expect(after0.rail).not.toBe(before0.rail);
        expect(after0.shadow).not.toBe(before0.shadow);
        expect(before0.drawable!.destroyed).toBe(true);
    });

    it('draws slab rails after a change to slab track', () => {
        const { after0, after1 } = restyled({}, { trackStyle: 'slab' });

        expect(railTexture(after0.rail)).toBe(railTexture(after1.rail));
    });

    it('draws ballasted rails after a change back from slab', () => {
        const { after0, after1 } = restyled(
            { trackStyle: 'slab' },
            { trackStyle: 'ballasted' }
        );

        expect(railTexture(after0.rail)).toBe(railTexture(after1.rail));
    });

    it('adds a bed when bed is turned on, and removes it when turned off', () => {
        const on = restyled({}, { bed: true });
        expect(on.before0.bedElevation).toBeUndefined();
        expect(on.after0.bedElevation).toBe(ELEVATION.ABOVE_1);

        const off = restyled({ bed: true }, { bed: false });
        expect(off.after0.bedElevation).toBeUndefined();
    });

    it('rebuilds the bed at its new width', () => {
        const { host } = restyled(
            { bed: true, bedWidth: 4 },
            { bed: true, bedWidth: 10 }
        );
        const width = (segment: number) =>
            host.bed(drawKey(segment))!.getLocalBounds().height;

        expect(width(0)).toBeCloseTo(width(1));
        expect(width(0)).toBeGreaterThan(9);
    });

    it('adds catenary when electrified, on the side given, and removes it when not', () => {
        const on = restyled({}, { electrified: true, catenarySide: -1 });
        // The bounds across the track, relative to its centreline: segment 0
        // runs along y = 0 and segment 1 along y = 50.
        const across = (catenary: typeof on.after0.catenary, y: number) => {
            const bounds = catenary!.getLocalBounds();
            return [bounds.minY - y, bounds.maxY - y];
        };
        expect(on.before0.catenary).toBeUndefined();
        const [restyled0, laid1] = [
            across(on.after0.catenary, 0),
            across(on.after1.catenary, 50),
        ];
        expect(restyled0[0]).toBeCloseTo(laid1[0]!);
        expect(restyled0[1]).toBeCloseTo(laid1[1]!);

        const off = restyled({ electrified: true }, { electrified: false });
        expect(off.after0.catenary).toBeUndefined();
    });

    it('leaves other segments untouched', () => {
        const { before1, after1 } = restyled({}, { bed: true });

        expect(after1.drawable).toBe(before1.drawable);
        expect(after1.rail).toBe(before1.rail);
        expect(after1.shadow).toBe(before1.shadow);
    });

    it('keeps the rebuilt pieces hidden while zoomed out', () => {
        const { after0 } = restyled({}, { bed: true });

        expect(after0.drawable!.visible).toBe(false);
        expect(after0.rail!.visible).toBe(false);
    });

    it('rebuilds the ballast with the elevation gradient when it is on', () => {
        const host = new RecordingLayerHost();
        const graph = new TrackGraph();
        const renderer = new TrackRenderSystem(
            host,
            graph.trackCurveManager,
            camera(),
            { textureRenderer }
        );
        layTrack(graph, [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
        ]);
        renderer.showElevationGradient = true;

        graph.setSegmentStyle(0, { bed: true });

        const [gradient, solid] = host.bandItem(drawKey(0))!.children[0]!
            .children;
        expect([gradient!.visible, solid!.visible]).toEqual([true, false]);
    });

    it('keeps the restyled segment in its band', () => {
        const { host } = restyled({}, { trackStyle: 'slab', bed: true });

        expect(host.bandOf(drawKey(0))).toBe(4);
        expect(host.bandOf(`__rail__${drawKey(0)}`)).toBe(4);
    });
});
```

- [ ] **Step 2: See them fail**

Run: `bun run format >/dev/null && bun test test/track-restyle.test.ts 2>&1 | grep -E "^\(fail\)| pass$| fail$"`
Expected: `5 pass`, `5 fail`. The failing ones are `rebuilds its drawable, rails and shadow`, `draws slab rails after a change to slab track`, `draws ballasted rails after a change back from slab`, `adds a bed when bed is turned on, and removes it when turned off` and `rebuilds the bed at its new width`. The catenary, other-segment, zoom, gradient and band tests pass already: today's handler rebuilds catenary, and the others guard the rebuild.

- [ ] **Step 3: Rebuild every piece (change 6).** In `src/pixi/track-render-system.ts`, replace `_onSegmentStyleChanged` and its doc comment with:

```ts
    /**
     * Redraws every piece of a segment whose style changed in the model
     * (TrackGraph.setSegmentStyle). The draw data already carries the new
     * style, so each piece goes through the same remove-and-add path as a
     * draw-data change.
     */
    private _onSegmentStyleChanged({
        segmentNumber,
    }: SegmentStyleChange): void {
        const pieces = this._trackCurveManager.persistedDrawData.filter(
            drawData =>
                drawData.originalTrackSegment.trackSegmentNumber ===
                segmentNumber
        );
        if (pieces.length === 0) return;
        for (const drawData of pieces) {
            this._onDelete(
                JSON.stringify({
                    trackSegmentNumber: segmentNumber,
                    tValInterval: drawData.originalTrackSegment.tValInterval,
                })
            );
        }
        this._onNewTrackData(-1, pieces);
    }
```

`_onNewTrackData` re-sorts the bands and applies the current zoom level and gradient setting itself.

In `src/tracks/trackcurve-manager.ts`, replace:

```ts
    get persistedDrawData(): (TrackSegmentDrawData & {
        callback(index: number): void;
    })[] {
```

with:

```ts
    get persistedDrawData(): (TrackSegmentDrawData & {
        callback(index: number): void;
        positiveOffsets: Point[];
        negativeOffsets: Point[];
    })[] {
```

- [ ] **Step 4: Verify**

Run: `bun run format >/dev/null && bun run typecheck && bun test test/track-restyle.test.ts 2>&1 | grep -E " pass$| fail$" && bun run format:check && tcount`
Expected: a clean typecheck, `10 pass`, then `460 pass`, `0 fail`, `Ran 460 tests across 45 files`.

- [ ] **Step 5: Commit**

```bash
git add src/pixi/track-render-system.ts src/tracks/trackcurve-manager.ts test/track-restyle.test.ts
git commit -m "fix(pixi): redraw every piece of a restyled segment"
```

---

### Task 7: Package surface for `track-layout/pixi`

**Files:**

- Create: TL `src/pixi/index.ts`, `test/pixi-entry.test.ts`
- Modify: TL `package.json`, `README.md`, `src/pixi/station-render-system.ts`, `src/pixi/track-aligned-platform-render-system.ts`

**Interfaces:**

- **Produces:** the `track-layout/pixi` entry point, exporting `WorldRenderSystem`, `LayerHost`, `BandSublayer`, `findElevationInterval`, `TrackRenderSystem`, `TrackRenderSystemOptions`, `TrackTextureRenderer`, `TerrainSampler`, `CurveCreationPreviewSource`, `DuplicateToSidePreviewSource`, `CatenaryLayoutPreviewSource`, `StationRenderSystem`, `TrackAlignedPlatformRenderSystem` and `JointDirectionRenderSystem`.

- [ ] **Step 1: Write the entry point.** Create `src/pixi/index.ts`. Named exports, not `export *`, keep the colour and geometry helpers internal:

```ts
export { JointDirectionRenderSystem } from './joint-direction-render-system.js';
export type { LayerHost } from './layer-host.js';
export type {
    CatenaryLayoutPreviewSource,
    CurveCreationPreviewSource,
    DuplicateToSidePreviewSource,
} from './preview-sources.js';
export { StationRenderSystem } from './station-render-system.js';
export { TrackAlignedPlatformRenderSystem } from './track-aligned-platform-render-system.js';
export {
    TrackRenderSystem,
    type TrackRenderSystemOptions,
    type TrackTextureRenderer,
} from './track-render-system.js';
export type { TerrainSampler } from './tunnel-geometry.js';
export {
    type BandSublayer,
    WorldRenderSystem,
    findElevationInterval,
} from './world-render-system.js';
```

- [ ] **Step 2: Write the failing test.** Create `test/pixi-entry.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import * as root from '../src/index.js';
import * as pixi from '../src/pixi/index.js';
// Type-only exports: the typecheck fails if any of these goes missing.
import type {
    BandSublayer,
    CatenaryLayoutPreviewSource,
    CurveCreationPreviewSource,
    DuplicateToSidePreviewSource,
    LayerHost,
    TerrainSampler,
    TrackRenderSystemOptions,
    TrackTextureRenderer,
} from '../src/pixi/index.js';

const RUNTIME_EXPORTS = [
    'WorldRenderSystem',
    'findElevationInterval',
    'TrackRenderSystem',
    'StationRenderSystem',
    'TrackAlignedPlatformRenderSystem',
    'JointDirectionRenderSystem',
];

const SRC = join(import.meta.dir, '..', 'src');

/** Every import statement in a source file: its specifier and whether it is type-only. */
function importsOf(file: string): { specifier: string; typeOnly: boolean }[] {
    const text = readFileSync(file, 'utf8');
    return [
        ...text.matchAll(/^import\s+(type\s+)?[^;]*?from\s+'([^']+)';/gms),
    ].map(match => ({
        specifier: match[2]!,
        typeOnly: match[1] !== undefined,
    }));
}

/** The modules outside src/pixi that src/pixi may import, all type-only. */
const ALLOWED_OUTSIDE = [
    '../editing/preview-types.js',
    '../station-placement/preview.js',
];

describe('pixi entry point', () => {
    it('exposes the renderers and the layer host', () => {
        for (const name of RUNTIME_EXPORTS) {
            expect(pixi).toHaveProperty(name);
        }
    });

    it('keeps the geometry and colour helpers internal', () => {
        for (const name of [
            'ballastHalfWidth',
            'computeTunnelEntranceGeometry',
            'interpolateRgb',
            'getElevationColorRgb',
        ]) {
            expect(pixi).not.toHaveProperty(name);
        }
    });

    it('is not re-exported from the package root', () => {
        for (const name of RUNTIME_EXPORTS) {
            expect(root).not.toHaveProperty(name);
        }
    });

    it('imports the editing and station-placement entry points only for preview types', () => {
        const outside = readdirSync(join(SRC, 'pixi'))
            .flatMap(name => importsOf(join(SRC, 'pixi', name)))
            .filter(
                ({ specifier }) =>
                    specifier.startsWith('../editing/') ||
                    specifier.startsWith('../station-placement/')
            );

        expect(outside.length).toBeGreaterThan(0);
        for (const { specifier, typeOnly } of outside) {
            expect(ALLOWED_OUTSIDE).toContain(specifier);
            expect(typeOnly).toBe(true);
        }
    });

    it('reaches @ue-too/being through none of its imports', () => {
        const files = [
            ...readdirSync(join(SRC, 'pixi')).map(name =>
                join(SRC, 'pixi', name)
            ),
            join(SRC, 'editing', 'preview-types.ts'),
            join(SRC, 'station-placement', 'preview.ts'),
        ];
        for (const file of files) {
            expect(
                importsOf(file).map(({ specifier }) => specifier)
            ).not.toContain('@ue-too/being');
        }
    });
});
```

- [ ] **Step 3: See it fail**

Run: `bun run format >/dev/null && bun test test/pixi-entry.test.ts 2>&1 | grep -E "^\(fail\)| pass$| fail$"`
Expected: `4 pass`, `1 fail`: `imports the editing and station-placement entry points only for preview types`. The station and platform renderers import their preview interfaces from `'../station-placement/index.js'`, which also re-exports the state machines, and those import `@ue-too/being`.

- [ ] **Step 4: Import the previews directly.** In `src/pixi/station-render-system.ts` and `src/pixi/track-aligned-platform-render-system.ts`, change the specifier `'../station-placement/index.js'` to `'../station-placement/preview.js'` (one occurrence in each file).

- [ ] **Step 5: Export the subpath.** In `package.json`, replace:

```json
        "./station-placement": {
            "types": "./dist/station-placement/index.d.ts",
            "import": "./dist/station-placement/index.js",
            "default": "./dist/station-placement/index.js"
        },
```

with:

```json
        "./station-placement": {
            "types": "./dist/station-placement/index.d.ts",
            "import": "./dist/station-placement/index.js",
            "default": "./dist/station-placement/index.js"
        },
        "./pixi": {
            "types": "./dist/pixi/index.d.ts",
            "import": "./dist/pixi/index.js",
            "default": "./dist/pixi/index.js"
        },
```

- [ ] **Step 6: Document it.** In `README.md`, insert this section before `## Development`:

````markdown
## Drawing a layout with Pixi

`track-layout/pixi` holds Pixi 8 renderers for track, stations,
track-aligned platforms and joint-direction indicators. It needs the
optional peer `pixi.js` at `8.20.1`, but not `@ue-too/being`.

- **Layer host.** The renderers draw into a `LayerHost`, which orders
  content by elevation band. `WorldRenderSystem` is the default one: add
  its `container` to your stage under the camera transform. Draw your own
  elevation-ordered content (trains, buildings) into the same host so it
  interleaves with track.
- **Track.** `TrackRenderSystem` draws the track graph. Its options are all
  optional:
    - `textureRenderer`, such as `{ renderer: app.renderer }`. Without it
      there are no rails, ballast textures or shadows.
    - `terrain`, anything with `getHeight(x, y)`. Without it the ground is
      flat at height 0, so track below ground level is drawn in a tunnel.
    - `curveCreation`, `duplicateToSide` and `catenaryLayout`: the engines
      from `track-layout/editing`, whose previews and highlights it draws.
- **Stations and platforms** are drawn as the managers create them and
  removed as they destroy them. Build the renderers before loading a
  scene, or draw what already exists with `addStation` and `addPlatform`.
  Both renderers also implement the station placement previews.
- Each renderer's `cleanup()` removes what it drew and stops listening
  (`dispose()` for `JointDirectionRenderSystem`).

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

````

- [ ] **Step 7: Verify the build**

Run: `bun run format >/dev/null && bun run typecheck && bun run build >/dev/null && grep -ho "from '[^']*'" dist/pixi/*.js | sort -u && bun pm pack --dry-run 2>&1 | grep "Total files"`
Expected: a clean typecheck, then exactly these runtime imports:

```
from '../index.js'
from './geometry-utils.js'
from './joint-direction-render-system.js'
from './station-render-system.js'
from './track-aligned-platform-render-system.js'
from './track-render-system.js'
from './tunnel-geometry.js'
from './world-render-system.js'
from '@ue-too/math'
from 'pixi.js'
```

and `Total files: 156`.

- [ ] **Step 8: Verify**

Run: `bun run format:check && tcount`
Expected: `465 pass`, `0 fail`, `Ran 465 tests across 46 files`.

- [ ] **Step 9: Commit**

```bash
git add package.json README.md src/pixi/index.ts src/pixi/station-render-system.ts src/pixi/track-aligned-platform-render-system.ts test/pixi-entry.test.ts
git commit -m "feat(pixi): export track-layout/pixi"
```

---

### Task 8 (banana): Switch banana to `track-layout/pixi`

**Files:**

- Modify: BN `package.json`, `bun.lock`, `src/utils/init-app.ts`, `src/scene-serialization.ts`, `src/signals/signal-render-system.ts`, `src/trains/train-render-system.ts`, and, through the repoint script, `src/buildings/render-system.ts`, `src/terrain/terrain-render-system.ts`, `src/trains/tracks/debug-overlay-render-system.ts`, `src/components/toolbar/StationListPanel.tsx`
- Delete: BN `src/world-render-system.ts`, `src/trains/tracks/render-system.ts`, `src/trains/tracks/geometry-utils.ts`, `src/trains/tracks/tunnel-geometry.ts`, `src/trains/tracks/joint-direction-render-system.ts`, `src/stations/station-render-system.ts`, `src/stations/track-aligned-platform-render-system.ts`, `src/stations/station-render-wiring.ts`, `src/utils.ts`, `test/tunnel-geometry.test.ts`, `test/station-render-wiring.test.ts`

**Interfaces:**

- **Consumes:** everything Task 7 exports, and the constructors from Tasks 2 and 5.

- [ ] **Step 1: Pack `track-layout`**

Run: `cd "$TL" && bun run pack:local && ls .pack`
Expected: `track-layout-local.tgz`.

- [ ] **Step 2: Point banana at the tarball.** `bun add <tarball>` fails with `DependencyLoop` while banana depends on the registry version, so edit `package.json` instead. The relative path differs per machine:

```bash
cd "$BN" && git checkout -q feat/track-layout-phase-4 && git status --short \
  && TGZ=$(python3 -c "import os,sys;print(os.path.relpath(sys.argv[1], sys.argv[2]))" "$TL/.pack/track-layout-local.tgz" "$BN") \
  && perl -pi -e "s#\"track-layout\": \"\\^0\\.3\\.0\"#\"track-layout\": \"$TGZ\"#" package.json && grep -n '"track-layout"' package.json \
  && bun install >/dev/null && ls node_modules/track-layout/dist/pixi/index.d.ts && grep -c "track-layout@" bun.lock
```

Expected:

- a clean tree before the edit
- `package.json` names the tarball: `../track-layout/.pack/track-layout-local.tgz` in the cloud session, `../../track/main/.pack/track-layout-local.tgz` on the owner's Mac
- `node_modules/track-layout/dist/pixi/index.d.ts`
- `1`

Then `tcount` and `bunx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"`. Expected: still `741 pass`, `0 fail`, and `9`. Banana doesn't use the new entry point yet.

- [ ] **Step 3: Delete the moved files**

```bash
cd "$BN" && git rm -q src/world-render-system.ts src/trains/tracks/render-system.ts src/trains/tracks/geometry-utils.ts \
  src/trains/tracks/tunnel-geometry.ts src/trains/tracks/joint-direction-render-system.ts \
  src/stations/station-render-system.ts src/stations/track-aligned-platform-render-system.ts \
  src/stations/station-render-wiring.ts src/utils.ts test/tunnel-geometry.test.ts test/station-render-wiring.test.ts
```

- [ ] **Step 4: Repoint imports**

Run: `cd "$TL" && bun scripts/repoint-banana-imports.ts "$BN"`
Expected: `repointed` for exactly these seven files, then `done; 7 file(s) changed`:

- `src/components/toolbar/StationListPanel.tsx`
- `src/trains/tracks/debug-overlay-render-system.ts`
- `src/trains/train-render-system.ts`
- `src/buildings/render-system.ts`
- `src/signals/signal-render-system.ts`
- `src/terrain/terrain-render-system.ts`
- `src/utils/init-app.ts`

Run: `cd "$BN" && bunx tsc --noEmit -p tsconfig.json 2>&1 | grep "error TS" | grep -v "BananaToolbar\|DepotPanel\|train-editor\|Cannot find name 'result'"`
Expected: exactly four errors, which steps 5 and 6 fix:

- `src/scene-serialization.ts`: `File '…/src/utils/index.ts' is not a module.` With `src/utils.ts` gone, `@/utils` resolves to the empty `src/utils/index.ts`.
- `src/utils/init-app.ts`: `Cannot find module '@/stations/station-render-wiring'`
- `src/utils/init-app.ts`: `Expected 3-4 arguments, but got 8.` (the track renderer)
- `src/utils/init-app.ts`: `Argument of type 'TrackGraph' is not assignable to parameter of type 'StationManager'.` (the platform renderer)

- [ ] **Step 5: Rewire `init-app`.** In `src/utils/init-app.ts`:

Delete these six lines, which the repoint left scattered through the `@/` imports:

```ts
import { StationRenderSystem } from 'track-layout/pixi';
import { wireStationRenderers } from '@/stations/station-render-wiring';
import { TrackAlignedPlatformRenderSystem } from 'track-layout/pixi';
import { JointDirectionRenderSystem } from 'track-layout/pixi';
import { TrackRenderSystem } from 'track-layout/pixi';
import { WorldRenderSystem } from 'track-layout/pixi';
```

Replace:

```ts
    createStationPlacementStateMachine,
} from 'track-layout/station-placement';
```

with:

```ts
    createStationPlacementStateMachine,
} from 'track-layout/station-placement';
import {
    JointDirectionRenderSystem,
    StationRenderSystem,
    TrackAlignedPlatformRenderSystem,
    TrackRenderSystem,
    WorldRenderSystem,
} from 'track-layout/pixi';
```

Replace:

```ts
    const trackRenderSystem = new TrackRenderSystem(
        worldRenderSystem,
        trackGraph.trackCurveManager,
        curveEngine,
        baseComponents.camera,
        { renderer: baseComponents.app.renderer },
        terrainData,
        duplicateToSideEngine,
        catenaryLayoutEngine
    );
```

with:

```ts
    const trackRenderSystem = new TrackRenderSystem(
        worldRenderSystem,
        trackGraph.trackCurveManager,
        baseComponents.camera,
        {
            textureRenderer: { renderer: baseComponents.app.renderer },
            terrain: terrainData,
            curveCreation: curveEngine,
            duplicateToSide: duplicateToSideEngine,
            catenaryLayout: catenaryLayoutEngine,
        }
    );
```

Replace:

```ts
        new TrackAlignedPlatformRenderSystem(
            worldRenderSystem,
            trackAlignedPlatformManager,
            trackGraph,
            { renderer: baseComponents.app.renderer }
        );

    baseComponents.cleanups.push(
        wireStationRenderers(
            stationManager,
            trackAlignedPlatformManager,
            stationRenderSystem,
            trackAlignedPlatformRenderSystem
        )
    );
```

with:

```ts
        new TrackAlignedPlatformRenderSystem(
            worldRenderSystem,
            trackAlignedPlatformManager,
            stationManager,
            trackGraph,
            { renderer: baseComponents.app.renderer }
        );
```

- [ ] **Step 6: The remaining files**

In `src/scene-serialization.ts`, delete:

```ts
import { clearShadowCache } from '@/utils';
```

delete:

```ts
    // Clear caches that reference old track geometry before replacing tracks.
    clearShadowCache();

```

and replace:

```ts
    // Load stations before track-aligned platforms: wireStationRenderers
    // draws each platform at its station's elevation, so the station must
    // exist first. The managers' add and remove events add and remove the
    // visuals.
```

with:

```ts
    // Load stations before track-aligned platforms: the platform renderer
    // draws each platform at its station's elevation, so the station must
    // exist first. The renderers add and remove the visuals on the managers'
    // add and remove events.
```

In `src/signals/signal-render-system.ts`, replace:

```ts
import type { TrackTextureRenderer } from 'track-layout/pixi';
import type { WorldRenderSystem } from 'track-layout/pixi';
```

with:

```ts
import type { TrackTextureRenderer, WorldRenderSystem } from 'track-layout/pixi';
```

In `src/trains/train-render-system.ts`, delete `import { WorldRenderSystem } from 'track-layout/pixi';` and replace:

```ts
import {
    TrackRenderSystem,
    type TrackTextureRenderer,
} from 'track-layout/pixi';
```

with:

```ts
import {
    TrackRenderSystem,
    type TrackTextureRenderer,
    WorldRenderSystem,
} from 'track-layout/pixi';
```

- [ ] **Step 7: Verify**

```bash
cd "$BN" && bun run format >/dev/null && bunx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS" && tcount \
  && bun run build >/dev/null && echo build-ok && bun run format:check \
  && grep -rn "world-render-system\|tracks/render-system\|clearShadowCache\|wireStationRenderers\|station-render-wiring\|tunnel-geometry\|geometry-utils\|joint-direction-render-system\|station-render-system\|track-aligned-platform-render-system" src test
```

Expected: `9`, `728 pass`, `0 fail`, `Ran 728 tests across 54 files`, `build-ok`, `All matched files use Prettier code style!`, and no `grep` output.

- [ ] **Step 8: Commit**

```bash
git add -A src test package.json bun.lock
git commit -m "refactor: use track-layout/pixi for the track and station renderers" -m "Uses the local 0.4.0 tarball until the release."
```

---

### Task 9: Verification gate, release 0.4.0, pin it in banana

This task stops twice for the owner: for the play-test, and for the release.

- [ ] **Step 1: Whole-branch reviews.** Review TL `feat/phase-4-pixi-renderers` against `main` and BN `feat/track-layout-phase-4` against `main`, with the spec in hand, and fix what they find. Then rerun both repositories' checks: TL `bun run typecheck`, `bun run format:check`, `tcount` (465); BN `tsc` (9 errors), `tcount` (728), `bun run build`, `bun run format:check`.

- [ ] **Step 2: Owner play-test** on banana with the tarball (`bun run dev`):

- track styles, beds and electrification
- elevation bands, and how track is ordered against trains and buildings
- shadows, including a sun-angle change
- tunnels and cuttings on terrain
- catenary masts
- the previews and highlights of every laying, editing and placement tool
- stations and platforms: placing, deleting, reassigning, and creating from the station list
- joint-direction indicators
- zooming in and out across the detail threshold
- the elevation-gradient toggle
- save and reload

Restyling laid track can't be play-tested, because banana has no tool for it. Task 6's tests cover it.

- [ ] **Step 3: Release.** With the owner's go-ahead: push TL, open its PR, and after it merges the owner runs the Release workflow (dry run first). The phase's `feat` commits make `auto` choose 0.4.0. Wait until `npm view track-layout version` prints `0.4.0`; npm's validation can take a while after publishing.

- [ ] **Step 4: Pin the release in banana**

```bash
cd "$BN" && perl -pi -e 's#"track-layout": "[^"]*\.pack/track-layout-local\.tgz"#"track-layout": "^0.4.0"#' package.json && bun install \
  && grep -n '"track-layout"' package.json && grep -c "\.pack" package.json bun.lock
```

Expected: `"track-layout": "^0.4.0"`, and `0` for both files. Then a frozen reinstall (`rm -rf node_modules && bun install --frozen-lockfile`), `tcount` (728), `tsc` (9), `bun run build` and `bun run format:check`.

- [ ] **Step 5: Commit and open banana's PR** (with the owner's go-ahead)

```bash
git add package.json bun.lock
git commit -m "chore(deps): use published track-layout 0.4.0"
```
