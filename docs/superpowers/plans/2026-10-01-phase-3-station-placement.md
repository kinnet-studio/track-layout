# track-layout Phase 3 (Station Placement) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move banana's island, single-spine and dual-spine station placement tools into `track-layout` and export them as `track-layout/station-placement` (0.3.0). Then switch banana over.

**Architecture:** Lift and decouple, as in phases 1 and 2. The existing porting script copies the three machine files from banana `13f1062`. The changes come after the copy, each with tests:

- The engines take preview interfaces instead of banana's render systems, commit only through the managers, and read the gauge from a getter.
- The engines take a window-to-world converter instead of extending the board's input tracker.
- The managers fire id-only add and remove events.
- The island tool gains a factory, the hint keys are typed, and the dead code goes.
- The duplicated spine-path helpers move into one module.

Banana draws stations and platforms from the manager events through a new, tested helper, and imports the tools from `track-layout/station-placement`.

**Tech Stack:** Bun 1.3, TypeScript 5.8 (`bundler` resolution, `.js` specifiers), Prettier 3, `@ue-too/being|board|curve|math` 0.19. Banana: React, Vite, Pixi 8.20.1.

**Spec:** `docs/superpowers/specs/2026-10-01-track-layout-phase-3-station-placement-design.md`. It is in track-layout, and banana's `feat/track-layout-phase-3` holds the same file. Its parent is `docs/superpowers/specs/2026-10-01-track-layout-extraction-design.md`. Read the phase 3 spec first. Its "Changes made during the move" are numbered 1–9, and the tasks below refer to those numbers.

## Global Constraints

- **Entry point:** `track-layout/station-placement`, a new subpath. The package root (`track-layout`) does not re-export it.
- **Dependencies:** no new peers. `peerDependencies` and `peerDependenciesMeta` stay as they are.
- **`src/station-placement/` may import** each other, `../index.js`, `@ue-too/being` and `@ue-too/math`. Nothing else: no `@ue-too/board`, Pixi, React, zustand, banana code, DOM or canvas.
- **Release:** `track-layout` 0.3.0, through the Release workflow on `main`.
- **Bun only** (never npm, pnpm, yarn or node to install or run). Tests import from `bun:test`.
- **TypeScript:**
    - `moduleResolution: "bundler"`.
    - Relative imports in `track-layout` end in `.js`. Station-placement files import the model from `'../index.js'`, never from `'track-layout'`.
    - The target is ES2022, so `Array.prototype.findLast` is not available.
- **Prettier:** 4-space indent, single quotes, `es5` trailing commas, width 80, sorted imports. Run `bun run format` before every commit; `bun run format:check` must pass.
- **`@ue-too/being` 0.19 events:** events with an empty payload are sent with no payload argument (`machine.happens('startPlacement')` for the island tool).
- **Expected numbers in `track-layout`:**

    | After          | `bun test` | Test files |
    | -------------- | ---------- | ---------- |
    | Start, Task 1  | 327        | 29         |
    | Task 2         | 330        | 30         |
    | Task 3         | 356        | 33         |
    | Task 4         | 366        | 34         |
    | Task 5         | 369        | 34         |
    | Task 6         | 375        | 35         |
    | Task 7         | 378        | 36         |

    `bun run typecheck` is clean after every task. `bun pm pack --dry-run` reports `Total files: 123` after Task 7.

- **Expected numbers in banana:**
    - `bun test` is 733 (54 files) at the start, and 741 (56 files) after Task 8 and after Task 9.
    - `bunx tsc --noEmit -p tsconfig.json` reports the same 9 errors throughout:
        - `BananaToolbar.tsx` ×2
        - `DepotPanel.tsx` ×1
        - `train-editor-tool-switcher.ts` ×2
        - `train-editor-toolbar.tsx` ×2
        - `init-app.ts` ×2, "Cannot find name 'result'"
- **track-layout's `bun.lock`:** install with `bun install --frozen-lockfile`. On Bun 1.3.14 a plain `bun install` rewrites the lockfile's peer section. That change has nothing to do with this phase; never commit it.
- **Test output noise:** `TrackGraph.connectJoints` logs `connectJoints <a> <b>` lines while tests run. That is expected.
- **No outward actions without the owner's go-ahead:** don't push, open or merge PRs, run the Release workflow or publish.

## Conventions

- **Checkouts.** `TL` is the track-layout checkout and `BN` the banana checkout. Set both once per shell:
    - in the cloud session: `export TL=/home/user/track-layout BN=/home/user/banana`
    - on the owner's Mac: `export TL=~/dev/track/main BN=~/dev/banana/main`
- **Branches:**
    - TL `feat/phase-3-station-placement` already exists and holds the spec copy and this plan.
    - BN `feat/track-layout-phase-3` already exists and holds the spec.
- **Test counts.** Never pipe `bun test` into `head`. Define this once per shell:

    ```bash
    tcount() { bun test > "${TMPDIR:-/tmp}/bun-test.txt" 2>&1; grep -E "^ *[0-9]+ (pass|fail)|^Ran" "${TMPDIR:-/tmp}/bun-test.txt"; }
    ```

- **Commits** are conventional, and every commit message ends with the co-author trailer your harness specifies. Stage the paths the step names. In TL, never `git add -A`, so that `bun.lock` stays out.
- **Edits are written in a fixed form:**
    - "In `F`, replace: X with: Y" is an exact-text replacement where X occurs exactly once.
    - "replace all N occurrences" means exactly N. If the count differs, stop and report. Don't improvise.
    - "Delete from the line A up to, but not including, the line B" removes that range of lines.
    - "Delete:" removes those lines.
- **Characterization tests** record what the code does today. If one fails against code the task didn't change, fix the expectation, never the code, and say so in the commit message.

## Review Focus

1. **The gauge changes between pressing and releasing an island drag.** The station is built with the gauge current at release. Task 3: `builds the station with the gauge current at release`.
2. **A spine tool is restarted for another station mid-pick.** The half-picked spine is forgotten, and the platform belongs to the new station. Task 3: `forgets a half-picked spine when restarted for another station`.
3. **A single-spine outline is closed at once, as with a double-click on the start anchor.** A platform with no outer vertices is created. That is today's behaviour, now pinned. Task 3: `creates a platform with no outer vertices when the outline is closed at once`.
4. **A hint key has no translation in one of banana's locales.** The toast would show the raw key. Task 8: `station placement hint translations`.
5. **A scene loads over existing stations and platforms.** The old visuals go, and the new ones are drawn once each, at their station's elevation. Task 8: `swaps the visuals once each when a scene load replaces the stations`.

## File Structure

**track-layout (TL):**

- **Modify:** `scripts/banana-module-map.ts`, `src/stations/station-manager.ts`, `src/stations/track-aligned-platform-manager.ts`, `package.json`, `README.md`
- **Create (ported):** `src/station-placement/station-placement-state-machine.ts`, `src/station-placement/single-spine-placement-state-machine.ts`, `src/station-placement/dual-spine-placement-state-machine.ts`
- **Create (new):**
    - `src/station-placement/preview.ts`, `src/station-placement/spine-path.ts`, `src/station-placement/index.ts`
    - `test/station-placement-helpers.ts`
    - `test/station-placement-coordinates.test.ts`, `test/station-placement-island.test.ts`, `test/single-spine-placement.test.ts`, `test/dual-spine-placement.test.ts`, `test/station-manager-events.test.ts`, `test/spine-path.test.ts`, `test/station-placement-entry.test.ts`

**banana (BN):**

- **Create:** `src/stations/station-render-wiring.ts`, `test/station-render-wiring.test.ts`, `test/station-hint-translations.test.ts`
- **Delete:** `src/stations/station-placement-state-machine.ts`, `src/stations/single-spine-placement-state-machine.ts`, `src/stations/dual-spine-placement-state-machine.ts`
- **Modify:**
    - `package.json`, `bun.lock`
    - `src/utils/init-app.ts`
    - `src/trains/input-state-machine/tool-switcher-state-machine.ts`, `src/trains/input-state-machine/kmt-state-machine-extension.ts`
    - `src/scene-serialization.ts`
    - `src/components/toolbar/BananaToolbar.tsx`, `src/components/toolbar/StationListPanel.tsx`
    - `src/stations/station-render-system.ts`, `src/stations/track-aligned-platform-render-system.ts`

---

### Task 1: Port the placement tools behind preview interfaces

This task does the port together with changes 2, 3 and 4.

- The verbatim files import banana's two render systems and `useGaugeStore`, which don't exist in the package. Replacing them is what a clean typecheck needs.
- It also removes the dual-spine tool's unreachable cap-pairing step (part of change 8). That step's only preview call, `showCapPairingPreview`, isn't in the interface, so the typecheck needs it gone too.

**Files:**

- Modify: `scripts/banana-module-map.ts`
- Port: the three `src/station-placement/*-state-machine.ts` files
- Create: `src/station-placement/preview.ts`, `src/station-placement/index.ts`

**Interfaces:**

- **Produces** the four preview interfaces in `src/station-placement/preview.ts`: `StationPlacementPreview`, `SpinePlacementPreview`, `SingleSpinePlacementPreview` and `DualSpinePlacementPreview`. Their signatures are in the spec's change 2.
- **Constructors after this task.** `canvas` and `camera` stay until Task 2.
    - `new StationPlacementEngine(canvas, trackGraph, camera, stationManager, preview: StationPlacementPreview, getGauge: () => number)`
    - `new SingleSpinePlacementEngine(canvas, trackGraph, camera, stationManager, platformManager, preview: SingleSpinePlacementPreview, onHint?)`
    - `new DualSpinePlacementEngine(canvas, trackGraph, camera, stationManager, platformManager, preview: DualSpinePlacementPreview, onHint?)`
- **Dual-spine:** `DUAL_SPINE_PLACEMENT_STATES` no longer lists `'PICK_CAP_PAIRING'`, and `DualSpineContext` no longer has `updateCapPairingHover`, `pickCapPairing` or `hasCapPairing`.
- **`entryPointFor(moduleId)`** returns `'track-layout/station-placement'` for `src/station-placement/*` modules.

- [ ] **Step 1: Confirm the starting point**

```bash
cd "$TL" && git fetch -q origin && git checkout -q feat/phase-3-station-placement && git status --short && bun install --frozen-lockfile >/dev/null && tcount
git -C "$BN" fetch -q origin && git -C "$BN" checkout -q feat/track-layout-phase-3 && git -C "$BN" status --short && git -C "$BN" log --oneline -3
```

Expected:

- A clean tree on `feat/phase-3-station-placement`.
- `327 pass`, `0 fail`, `Ran 327 tests across 29 files`.
- banana on `feat/track-layout-phase-3`, with a clean tree. The two spec commits sit on top of `13f1062 docs: track-layout extraction handoff and phase 3 and 4 briefs (#20)`.

- [ ] **Step 2: Map the three modules and the new entry point**

In `scripts/banana-module-map.ts`, replace:

```ts
    'src/trains/input-state-machine/catenary-layout-state-machine':
        'src/editing/catenary-layout-state-machine',
};
```

with:

```ts
    'src/trains/input-state-machine/catenary-layout-state-machine':
        'src/editing/catenary-layout-state-machine',
    'src/stations/station-placement-state-machine':
        'src/station-placement/station-placement-state-machine',
    'src/stations/single-spine-placement-state-machine':
        'src/station-placement/single-spine-placement-state-machine',
    'src/stations/dual-spine-placement-state-machine':
        'src/station-placement/dual-spine-placement-state-machine',
};
```

In `scripts/banana-module-map.ts`, replace:

```ts
    'track-layout/editing': 'src/editing/index',
};

/** The package entry point that exposes a track-layout module. */
export function entryPointFor(moduleId: string): string {
    return moduleId.startsWith('src/editing/')
        ? 'track-layout/editing'
        : 'track-layout';
}
```

with:

```ts
    'track-layout/editing': 'src/editing/index',
    'track-layout/station-placement': 'src/station-placement/index',
};

/** The package entry point that exposes a track-layout module. */
export function entryPointFor(moduleId: string): string {
    if (moduleId.startsWith('src/editing/')) return 'track-layout/editing';
    if (moduleId.startsWith('src/station-placement/')) {
        return 'track-layout/station-placement';
    }
    return 'track-layout';
}
```

- [ ] **Step 3: Port the files**

```bash
cd "$TL" && bun scripts/port-from-banana.ts "$BN" \
  src/stations/station-placement-state-machine.ts=src/station-placement/station-placement-state-machine.ts \
  src/stations/single-spine-placement-state-machine.ts=src/station-placement/single-spine-placement-state-machine.ts \
  src/stations/dual-spine-placement-state-machine.ts=src/station-placement/dual-spine-placement-state-machine.ts
```

Expected: three `ported …` lines and `done; 4 unmapped specifier(s)`. These are the four imports the next steps replace:

- `UNMAPPED @/stores/gauge-store` and `UNMAPPED ./station-render-system` under the island file
- `UNMAPPED ./track-aligned-platform-render-system` under each spine file

- [ ] **Step 4: Write the preview interfaces (change 2)**

Create `src/station-placement/preview.ts`:

```ts
import type { Point } from '@ue-too/math';

/**
 * What the island station placement engine shows while a station is being
 * dragged out. The app implements it with its renderer.
 */
export interface StationPlacementPreview {
    /** Show a station outline centred on `center`, running along `direction`. */
    showPreview(
        center: Point,
        direction: Point,
        length: number,
        trackSpacing: number
    ): void;
    hidePreview(): void;
}

/** Preview calls shared by the single- and dual-spine platform tools. */
export interface SpinePlacementPreview {
    /** Highlight the side of a segment, at `projectionT`, that a pick would use. */
    showTrackHighlight(
        segmentId: number,
        projectionT: number,
        side: 1 | -1,
        offset: number
    ): void;
    /** Clear everything this preview has shown, the track highlight included. */
    hidePreview(): void;
}

/** What the single-spine platform tool shows while a platform is drawn. */
export interface SingleSpinePlacementPreview extends SpinePlacementPreview {
    showPlacementPreview(
        spinePoints: Point[],
        outerVertices: Point[],
        startAnchor: Point | null,
        endAnchor: Point | null
    ): void;
}

/** What the dual-spine platform tool shows while a platform pair is drawn. */
export interface DualSpinePlacementPreview extends SpinePlacementPreview {
    showDualSpinePlacementPreview(
        spineAPoints: Point[],
        spineBPoints: Point[],
        capAVertices: Point[],
        capBVertices: Point[],
        spineAStartAnchor: Point | null,
        spineAEndAnchor: Point | null,
        spineBStartAnchor: Point | null,
        spineBEndAnchor: Point | null
    ): void;
    /** The rubber-band line from the last cap vertex to the cursor or snap. */
    showCapDrawingHover(
        lastPoint: Point | null,
        cursorOrSnap: Point,
        closingAnchor: Point | null,
        isNearClosing: boolean
    ): void;
}
```

- [ ] **Step 5: The island engine uses its preview and a gauge getter**

In `src/station-placement/station-placement-state-machine.ts`, replace:

```ts
import type { StationManager } from '../index.js';

import { useGaugeStore } from '@/stores/gauge-store';

import type { StationRenderSystem } from './station-render-system';
```

with:

```ts
import type { StationManager } from '../index.js';
import type { StationPlacementPreview } from './preview.js';
```

In `src/station-placement/station-placement-state-machine.ts`, replace:

```ts
    private _stationRenderSystem: StationRenderSystem;
```

with:

```ts
    private _preview: StationPlacementPreview;
    private _getGauge: () => number;
```

In `src/station-placement/station-placement-state-machine.ts`, replace:

```ts
        stationManager: StationManager,
        stationRenderSystem: StationRenderSystem
    ) {
```

with:

```ts
        stationManager: StationManager,
        preview: StationPlacementPreview,
        getGauge: () => number
    ) {
```

In `src/station-placement/station-placement-state-machine.ts`, replace:

```ts
        this._stationRenderSystem = stationRenderSystem;
```

with:

```ts
        this._preview = preview;
        this._getGauge = getGauge;
```

The commit no longer tells the renderer (change 3); the gauge comes from the getter (change 4).

In `src/station-placement/station-placement-state-machine.ts`, replace:

```ts
        const stationId = createIslandStation(
            this._trackGraph,
            this._stationManager,
            {
                position: center,
                direction,
                length: dist,
                elevation: ELEVATION.GROUND,
                gauge: useGaugeStore.getState().currentGauge,
            }
        );
        this._stationRenderSystem.addStation(stationId);
```

with:

```ts
        createIslandStation(this._trackGraph, this._stationManager, {
            position: center,
            direction,
            length: dist,
            elevation: ELEVATION.GROUND,
            gauge: this._getGauge(),
        });
```

`createBareStation` stays until Task 5, but stops calling the renderer.

In `src/station-placement/station-placement-state-machine.ts`, replace:

```ts
        this._stationRenderSystem.addStation(stationId);
        return stationId;
```

with:

```ts
        return stationId;
```

In `src/station-placement/station-placement-state-machine.ts`, replace all 4 occurrences of `this._stationRenderSystem.` with `this._preview.`.

- [ ] **Step 6: The single-spine engine uses its preview**

In `src/station-placement/single-spine-placement-state-machine.ts`, replace:

```ts
import type { TrackAlignedPlatformRenderSystem } from './track-aligned-platform-render-system';
```

with:

```ts
import type { SingleSpinePlacementPreview } from './preview.js';
```

In `src/station-placement/single-spine-placement-state-machine.ts`, replace:

```ts
    private _platformRenderSystem: TrackAlignedPlatformRenderSystem;
```

with:

```ts
    private _preview: SingleSpinePlacementPreview;
```

In `src/station-placement/single-spine-placement-state-machine.ts`, replace:

```ts
        platformRenderSystem: TrackAlignedPlatformRenderSystem,
```

with:

```ts
        preview: SingleSpinePlacementPreview,
```

In `src/station-placement/single-spine-placement-state-machine.ts`, replace:

```ts
        this._platformRenderSystem = platformRenderSystem;
```

with:

```ts
        this._preview = preview;
```

In `src/station-placement/single-spine-placement-state-machine.ts`, delete:

```ts
        const elevation = station.elevation;
        this._platformRenderSystem.addPlatform(platformId, elevation);
```

In `src/station-placement/single-spine-placement-state-machine.ts`, replace all 7 occurrences of `this._platformRenderSystem.` with `this._preview.`.

- [ ] **Step 7: The dual-spine engine uses its preview and loses the unreachable pairing step**

In `src/station-placement/dual-spine-placement-state-machine.ts`, replace:

```ts
import type { TrackAlignedPlatformRenderSystem } from './track-aligned-platform-render-system';
```

with:

```ts
import type { DualSpinePlacementPreview } from './preview.js';
```

In `src/station-placement/dual-spine-placement-state-machine.ts`, replace:

```ts
    private _platformRenderSystem: TrackAlignedPlatformRenderSystem;
```

with:

```ts
    private _preview: DualSpinePlacementPreview;
```

In `src/station-placement/dual-spine-placement-state-machine.ts`, replace:

```ts
        platformRenderSystem: TrackAlignedPlatformRenderSystem,
```

with:

```ts
        preview: DualSpinePlacementPreview,
```

In `src/station-placement/dual-spine-placement-state-machine.ts`, replace:

```ts
        this._platformRenderSystem = platformRenderSystem;
```

with:

```ts
        this._preview = preview;
```

In `src/station-placement/dual-spine-placement-state-machine.ts`, delete:

```ts
        const elevation = station.elevation;
        this._platformRenderSystem.addPlatform(platformIdA, elevation);
        this._platformRenderSystem.addPlatform(platformIdB, elevation);
```

Now the pairing step. No transition leads into `PICK_CAP_PAIRING`; `confirmSpineBEnd` picks the pairing itself through `_autoDetectCapPairing`, which stays.

In `src/station-placement/dual-spine-placement-state-machine.ts`, delete:

```ts
    'PICK_CAP_PAIRING',
```

In `src/station-placement/dual-spine-placement-state-machine.ts`, delete:

```ts
    // Cap pairing
    updateCapPairingHover: (position: Point) => void;
    pickCapPairing: (position: Point) => boolean;
```

In `src/station-placement/dual-spine-placement-state-machine.ts`, delete:

```ts
    readonly hasCapPairing: boolean;
```

In `src/station-placement/dual-spine-placement-state-machine.ts`, delete:

```ts
    private _hasCapPairing = false;
```

In `src/station-placement/dual-spine-placement-state-machine.ts`, delete:

```ts
    get hasCapPairing(): boolean {
        return this._hasCapPairing;
    }
```

In `src/station-placement/dual-spine-placement-state-machine.ts`, delete from the line `    updateCapPairingHover(position: Point): void {` up to, but not including, the line `    updateCapHover(position: Point, cap: 'A' | 'B'): void {`. That removes `updateCapPairingHover` and `pickCapPairing`.

In `src/station-placement/dual-spine-placement-state-machine.ts`, replace:

```ts
        }

        this._hasCapPairing = true;
    }
```

with:

```ts
        }
    }
```

In `src/station-placement/dual-spine-placement-state-machine.ts`, delete:

```ts
        this._hasCapPairing = false;
```

In `src/station-placement/dual-spine-placement-state-machine.ts`, delete from the line `/**` that opens the comment ` * After both spines are confirmed, the user clicks to choose which spine B` up to, but not including, the line `class DualSpineDrawEndCap1State extends TemplateState<`. That removes `DualSpinePickCapPairingState` and its comment.

In `src/station-placement/dual-spine-placement-state-machine.ts`, delete:

```ts
            PICK_CAP_PAIRING: new DualSpinePickCapPairingState(),
```

In `src/station-placement/dual-spine-placement-state-machine.ts`, replace all 9 occurrences of `this._platformRenderSystem.` with `this._preview.`.

- [ ] **Step 8: Write the entry barrel**

Create `src/station-placement/index.ts`:

```ts
export * from './dual-spine-placement-state-machine.js';
export * from './preview.js';
export * from './single-spine-placement-state-machine.js';
export * from './station-placement-state-machine.js';
```

`package.json` exports it in Task 7.

- [ ] **Step 9: Format, typecheck, test, and check no banana tie is left**

```bash
cd "$TL" && bun run format >/dev/null && bun run format:check | tail -1 && bun run typecheck && tcount; grep -rn "RenderSystem\|useGaugeStore\|addStation\|addPlatform\|hasCapPairing\|updateCapPairingHover\|pickCapPairing\|PICK_CAP" src/station-placement; echo "grep-exit=$?"
```

Expected:

- Prettier is clean and the typecheck prints nothing.
- `327 pass`, `0 fail`, `Ran 327 tests across 29 files`. No test touches the new files yet.
- `grep` finds nothing (`grep-exit=1`). `_autoDetectCapPairing` stays; the pattern names only what went.

- [ ] **Step 10: Commit**

```bash
git add scripts/banana-module-map.ts src/station-placement && git commit -m "feat(station-placement): port the station placement tools" -m "Ported from banana 13f1062. The engines take preview interfaces instead of banana's render systems, commit only through the managers, and read the island gauge from a getter. The dual-spine tool's unreachable cap-pairing step goes, since its preview call isn't part of the interface. The module map learns the track-layout/station-placement entry point."
```

---

### Task 2: The engines take a window-to-world converter

This is change 1. Once the canvas and camera are gone, an engine can be built in a test.

**Files:**

- Modify: the three engine files in `src/station-placement/`
- Create: `test/station-placement-helpers.ts`, `test/station-placement-coordinates.test.ts`

**Interfaces:**

- Produces the final constructors:
    - `new StationPlacementEngine(trackGraph, convertWindowToWorld: (position: Point) => Point, stationManager, preview, getGauge)`
    - `new SingleSpinePlacementEngine(trackGraph, convertWindowToWorld, stationManager, platformManager, preview, onHint?)`
    - `new DualSpinePlacementEngine(trackGraph, convertWindowToWorld, stationManager, platformManager, preview, onHint?)`
- `convert2WorldPosition(p)` returns `convertWindowToWorld(p)`. `convert2WindowPosition` is gone from the engines and from `StationPlacementContext`.
- Produces in `test/station-placement-helpers.ts`:
    - `identity(p)`
    - `class RecordingPreview`, which implements all three previews and has `calls: { method: string; args: unknown[] }[]`, `get methods(): string[]` and `lastArgs(method): unknown[] | undefined`

The engine files are:

- `src/station-placement/station-placement-state-machine.ts`
- `src/station-placement/single-spine-placement-state-machine.ts`
- `src/station-placement/dual-spine-placement-state-machine.ts`

- [ ] **Step 1: Write the test helper**

Create `test/station-placement-helpers.ts`:

```ts
import type { Point } from '@ue-too/math';

import type {
    DualSpinePlacementPreview,
    SingleSpinePlacementPreview,
    StationPlacementPreview,
} from '../src/station-placement/preview.js';

/** Window coordinates are world coordinates in these tests. */
export const identity = (position: Point) => ({ ...position });

export type PreviewCall = { method: string; args: unknown[] };

/** A preview for any of the three tools that records every call. */
export class RecordingPreview
    implements
        StationPlacementPreview,
        SingleSpinePlacementPreview,
        DualSpinePlacementPreview
{
    calls: PreviewCall[] = [];

    /** The method names called, in order. */
    get methods(): string[] {
        return this.calls.map(call => call.method);
    }

    /** The arguments of the most recent call to `method`. */
    lastArgs(method: string): unknown[] | undefined {
        return this.calls.filter(call => call.method === method).at(-1)?.args;
    }

    private _record(method: string, args: unknown[]): void {
        this.calls.push({ method, args });
    }

    showPreview(...args: unknown[]): void {
        this._record('showPreview', args);
    }
    hidePreview(...args: unknown[]): void {
        this._record('hidePreview', args);
    }
    showTrackHighlight(...args: unknown[]): void {
        this._record('showTrackHighlight', args);
    }
    showPlacementPreview(...args: unknown[]): void {
        this._record('showPlacementPreview', args);
    }
    showDualSpinePlacementPreview(...args: unknown[]): void {
        this._record('showDualSpinePlacementPreview', args);
    }
    showCapDrawingHover(...args: unknown[]): void {
        this._record('showCapDrawingHover', args);
    }
}
```

- [ ] **Step 2: Write the failing test**

Create `test/station-placement-coordinates.test.ts`:

```ts
import type { Point } from '@ue-too/math';
import { describe, expect, it } from 'bun:test';

import { DualSpinePlacementEngine } from '../src/station-placement/dual-spine-placement-state-machine.js';
import { SingleSpinePlacementEngine } from '../src/station-placement/single-spine-placement-state-machine.js';
import { StationPlacementEngine } from '../src/station-placement/station-placement-state-machine.js';
import { StationManager } from '../src/stations/station-manager.js';
import { TrackAlignedPlatformManager } from '../src/stations/track-aligned-platform-manager.js';
import { TrackGraph } from '../src/tracks/track.js';
import { RecordingPreview } from './station-placement-helpers.js';

/** A converter that is clearly not the identity. */
const shift = (p: Point) => ({ x: p.x + 1000, y: p.y - 5 });

describe('station placement engines convert with the injected function', () => {
    it('island', () => {
        const engine = new StationPlacementEngine(
            new TrackGraph(),
            shift,
            new StationManager(),
            new RecordingPreview(),
            () => 1.067
        );
        expect(engine.convert2WorldPosition({ x: 1, y: 2 })).toEqual({
            x: 1001,
            y: -3,
        });
    });

    it('single-spine', () => {
        const engine = new SingleSpinePlacementEngine(
            new TrackGraph(),
            shift,
            new StationManager(),
            new TrackAlignedPlatformManager(),
            new RecordingPreview()
        );
        expect(engine.convert2WorldPosition({ x: 1, y: 2 })).toEqual({
            x: 1001,
            y: -3,
        });
    });

    it('dual-spine', () => {
        const engine = new DualSpinePlacementEngine(
            new TrackGraph(),
            shift,
            new StationManager(),
            new TrackAlignedPlatformManager(),
            new RecordingPreview()
        );
        expect(engine.convert2WorldPosition({ x: 1, y: 2 })).toEqual({
            x: 1001,
            y: -3,
        });
    });
});
```

Run: `bun test test/station-placement-coordinates.test.ts`
Expected: FAIL, 3 tests, with `TypeError: undefined is not an object`. Each constructor still takes the canvas first, so the converter lands where the camera was.

- [ ] **Step 3: Drop the board helpers from each engine.** The three engines share this code word for word.

In each engine file, delete:

```ts
import {
    Canvas,
    ObservableBoardCamera,
    ObservableInputTracker,
    convertFromCanvas2ViewPort,
    convertFromCanvas2Window,
    convertFromViewPort2Canvas,
    convertFromViewport2World,
    convertFromWindow2Canvas,
    convertFromWorld2Viewport,
} from '@ue-too/board';
```

In each engine file, replace:

```ts
    private _camera: ObservableBoardCamera;
```

with:

```ts
    private _convertWindowToWorld: (position: Point) => Point;
```

In each engine file, replace:

```ts
        canvas: Canvas,
        trackGraph: TrackGraph,
        camera: ObservableBoardCamera,
```

with:

```ts
        trackGraph: TrackGraph,
        convertWindowToWorld: (position: Point) => Point,
```

In each engine file, replace:

```ts
        super(canvas);
        this._trackGraph = trackGraph;
        this._camera = camera;
```

with:

```ts
        this._trackGraph = trackGraph;
        this._convertWindowToWorld = convertWindowToWorld;
```

In each engine file, replace:

```ts
    convert2WorldPosition(position: Point): Point {
        const pointInCanvas = convertFromWindow2Canvas(position, this.canvas);
        const pointInViewPort = convertFromCanvas2ViewPort(pointInCanvas, {
            x: this.canvas.width / 2,
            y: this.canvas.height / 2,
        });
        return convertFromViewport2World(
            pointInViewPort,
            this._camera.position,
            this._camera.zoomLevel,
            this._camera.rotation,
            false
        );
    }

    convert2WindowPosition(position: Point): Point {
        const pointInViewPort = convertFromWorld2Viewport(
            position,
            this._camera.position,
            this._camera.zoomLevel,
            this._camera.rotation
        );
        const pointInCanvas = convertFromViewPort2Canvas(pointInViewPort, {
            x: this.canvas.width / 2,
            y: this.canvas.height / 2,
        });
        return convertFromCanvas2Window(pointInCanvas, this.canvas);
    }
```

with:

```ts
    convert2WorldPosition(position: Point): Point {
        return this._convertWindowToWorld(position);
    }
```

- [ ] **Step 4: Stop extending the input tracker**

In `src/station-placement/station-placement-state-machine.ts`, replace:

```ts
export class StationPlacementEngine
    extends ObservableInputTracker
    implements StationPlacementContext
{
```

with:

```ts
export class StationPlacementEngine implements StationPlacementContext {
```

In `src/station-placement/single-spine-placement-state-machine.ts`, replace:

```ts
export class SingleSpinePlacementEngine
    extends ObservableInputTracker
    implements SingleSpineContext
{
```

with:

```ts
export class SingleSpinePlacementEngine implements SingleSpineContext {
```

In `src/station-placement/dual-spine-placement-state-machine.ts`, replace:

```ts
export class DualSpinePlacementEngine
    extends ObservableInputTracker
    implements DualSpineContext
{
```

with:

```ts
export class DualSpinePlacementEngine implements DualSpineContext {
```

No state calls `convert2WindowPosition`.

In `src/station-placement/station-placement-state-machine.ts`, delete:

```ts
    convert2WindowPosition: (position: Point) => Point;
```

- [ ] **Step 5: Format, typecheck, test**

```bash
cd "$TL" && bun run format >/dev/null && bun run format:check | tail -1 && bun run typecheck && tcount; grep -rn "ue-too/board\|_camera\|canvas\|convert2Window" src/station-placement; echo "grep-exit=$?"
```

Expected:

- Prettier is clean and the typecheck prints nothing.
- `330 pass`, `0 fail`, `Ran 330 tests across 30 files`.
- `grep-exit=1`.

- [ ] **Step 6: Commit**

```bash
git add src/station-placement test/station-placement-helpers.ts test/station-placement-coordinates.test.ts && git commit -m "refactor(station-placement): take a window-to-world converter" -m "The three engines no longer extend ObservableInputTracker or keep a canvas and camera. They take a convertWindowToWorld function, as the phase 2 engines do. The unused convert2WindowPosition goes."
```

---

### Task 3: Characterization tests for the three tools

These tests describe today's behaviour, and pass against it; nothing under `src/` changes in this task. Each machine runs on its real engine, a real `TrackGraph` and real managers, with an identity converter and a `RecordingPreview`.

**Files:**

- Modify: `test/station-placement-helpers.ts`
- Create: `test/station-placement-island.test.ts`, `test/single-spine-placement.test.ts`, `test/dual-spine-placement.test.ts`

**Interfaces:**

- Consumes the Task 2 constructors and `RecordingPreview`.
- Produces in `test/station-placement-helpers.ts`:
    - `layTrack(graph, points, elevation?) => { joints: number[]; segments: number[] }`, which lays straight segments along x, so that a point at x on a 0–100 segment projects to t = x / 100
    - `bareStation(position)`

- [ ] **Step 1: Add the track helpers**

In `test/station-placement-helpers.ts`, replace:

```ts
import type {
    DualSpinePlacementPreview,
    SingleSpinePlacementPreview,
    StationPlacementPreview,
} from '../src/station-placement/preview.js';
```

with:

```ts
import type {
    DualSpinePlacementPreview,
    SingleSpinePlacementPreview,
    StationPlacementPreview,
} from '../src/station-placement/preview.js';
import type { TrackGraph } from '../src/tracks/track.js';
import { ELEVATION } from '../src/tracks/types.js';
```

Append to `test/station-placement-helpers.ts`:

```ts
/**
 * Lays straight segments through `points`, in order, along the x axis, and
 * returns their joint and segment ids. Each segment's t runs with x, so a
 * point at x on a 0–100 segment projects to t = x / 100.
 */
export function layTrack(
    graph: TrackGraph,
    points: Point[],
    elevation: ELEVATION = ELEVATION.GROUND
): { joints: number[]; segments: number[] } {
    const joints = points.map(point =>
        graph.createNewEmptyJoint(point, { x: 1, y: 0 }, elevation)
    );
    const segments: number[] = [];
    for (let i = 0; i + 1 < joints.length; i++) {
        const [a, b] = [points[i], points[i + 1]];
        graph.connectJoints(joints[i], joints[i + 1], [
            { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        ]);
        segments.push(
            graph.getJoint(joints[i])!.connections.get(joints[i + 1])!
        );
    }
    return { joints, segments };
}

/** A station with no platforms, as the station list creates one. */
export function bareStation(position: Point) {
    return {
        name: 'Station',
        position,
        elevation: ELEVATION.GROUND,
        platforms: [],
        trackSegments: [],
        joints: [],
        trackAlignedPlatforms: [] as number[],
    };
}
```

- [ ] **Step 2: Island tests**

Create `test/station-placement-island.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';

import {
    StationPlacementEngine,
    StationPlacementStateMachine,
} from '../src/station-placement/station-placement-state-machine.js';
import { StationManager } from '../src/stations/station-manager.js';
import { TrackGraph } from '../src/tracks/track.js';
import { ELEVATION } from '../src/tracks/types.js';
import { RecordingPreview, identity } from './station-placement-helpers.js';

function setup(getGauge: () => number = () => 1.435) {
    const graph = new TrackGraph();
    const stations = new StationManager();
    const preview = new RecordingPreview();
    const engine = new StationPlacementEngine(
        graph,
        identity,
        stations,
        preview,
        getGauge
    );
    const machine = new StationPlacementStateMachine(engine);
    machine.happens('startPlacement');
    return { graph, stations, preview, machine };
}

describe('island station placement', () => {
    it('drags out a station and creates it on release', () => {
        const { graph, stations, preview, machine } = setup();
        expect(machine.currentState).toBe('HOVER_FOR_START');

        machine.happens('leftPointerUp', { x: 0, y: 0 });
        expect(machine.currentState).toBe('HOVER_FOR_END');
        expect(preview.lastArgs('showPreview')).toEqual([
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            0.5,
            10.4,
        ]);

        machine.happens('pointerMove', { x: 100, y: 0 });
        expect(preview.lastArgs('showPreview')).toEqual([
            { x: 50, y: 0 },
            { x: 1, y: 0 },
            100,
            10.4,
        ]);

        machine.happens('leftPointerUp', { x: 100, y: 0 });
        expect(machine.currentState).toBe('HOVER_FOR_START');
        expect(preview.methods.at(-1)).toBe('hidePreview');

        const created = stations.getStations();
        expect(created).toHaveLength(1);
        const { station } = created[0];
        expect(station.position).toEqual({ x: 50, y: 0 });
        expect(station.elevation).toBe(ELEVATION.GROUND);
        expect(station.platforms).toHaveLength(2);
        expect(station.trackSegments).toHaveLength(2);
        expect(station.joints).toHaveLength(4);
        expect(graph.trackSegments).toHaveLength(2);
        for (const segmentId of station.trackSegments) {
            expect(graph.getTrackSegmentWithJoints(segmentId)?.gauge).toBe(
                1.435
            );
        }
    });

    it('builds the station with the gauge current at release', () => {
        let gauge = 1.067;
        const { graph, stations, machine } = setup(() => gauge);
        machine.happens('leftPointerUp', { x: 0, y: 0 });
        gauge = 1.435;
        machine.happens('leftPointerUp', { x: 100, y: 0 });
        const { station } = stations.getStations()[0];
        for (const segmentId of station.trackSegments) {
            expect(graph.getTrackSegmentWithJoints(segmentId)?.gauge).toBe(
                1.435
            );
        }
    });

    it('ignores pointer moves closer than 0.5 m to the start', () => {
        const { preview, machine } = setup();
        machine.happens('leftPointerUp', { x: 0, y: 0 });
        const callsAfterStart = preview.calls.length;
        machine.happens('pointerMove', { x: 0.3, y: 0 });
        expect(preview.calls).toHaveLength(callsAfterStart);
    });

    it('creates nothing for a drag shorter than 2 m', () => {
        const { graph, stations, preview, machine } = setup();
        machine.happens('leftPointerUp', { x: 0, y: 0 });
        machine.happens('leftPointerUp', { x: 1.5, y: 0 });
        expect(machine.currentState).toBe('HOVER_FOR_START');
        expect(preview.methods.at(-1)).toBe('hidePreview');
        expect(stations.getStations()).toHaveLength(0);
        expect(graph.trackSegments).toHaveLength(0);
    });

    it('escape drops the start point, then leaves the tool', () => {
        const { stations, preview, machine } = setup();
        machine.happens('leftPointerUp', { x: 0, y: 0 });
        machine.happens('escapeKey');
        expect(machine.currentState).toBe('HOVER_FOR_START');
        expect(preview.methods.at(-1)).toBe('hidePreview');

        machine.happens('escapeKey');
        expect(machine.currentState).toBe('IDLE');
        expect(stations.getStations()).toHaveLength(0);
    });

    it('endPlacement leaves the tool from either hover state', () => {
        const { preview, machine } = setup();
        machine.happens('endPlacement');
        expect(machine.currentState).toBe('IDLE');

        machine.happens('startPlacement');
        machine.happens('leftPointerUp', { x: 0, y: 0 });
        machine.happens('endPlacement');
        expect(machine.currentState).toBe('IDLE');
        expect(preview.methods.at(-1)).toBe('hidePreview');
    });
});
```

- [ ] **Step 3: Single-spine tests**

Create `test/single-spine-placement.test.ts`:

```ts
import type { Point } from '@ue-too/math';
import { describe, expect, it } from 'bun:test';

import {
    SingleSpinePlacementEngine,
    createSingleSpinePlacementStateMachine,
} from '../src/station-placement/single-spine-placement-state-machine.js';
import { computePlatformOffset } from '../src/stations/platform-offset.js';
import { StationManager } from '../src/stations/station-manager.js';
import { TrackAlignedPlatformManager } from '../src/stations/track-aligned-platform-manager.js';
import { TrackGraph } from '../src/tracks/track.js';
import {
    RecordingPreview,
    bareStation,
    identity,
    layTrack,
} from './station-placement-helpers.js';

/**
 * A 0–100 straight track (or `points`), a bare station at (50, 10), and the
 * single-spine machine already started for it.
 */
function setup(
    points: Point[] = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
    ],
    stationPosition: Point = { x: 50, y: 10 }
) {
    const graph = new TrackGraph();
    const track = layTrack(graph, points);
    const stations = new StationManager();
    const platforms = new TrackAlignedPlatformManager();
    const preview = new RecordingPreview();
    const hints: string[] = [];
    const engine = new SingleSpinePlacementEngine(
        graph,
        identity,
        stations,
        platforms,
        preview,
        key => hints.push(key)
    );
    const machine = createSingleSpinePlacementStateMachine(engine);
    const stationId = stations.createStation(bareStation(stationPosition));
    machine.happens('startPlacement', { stationId });
    return {
        graph,
        track,
        stations,
        platforms,
        preview,
        hints,
        machine,
        stationId,
    };
}

const click = (machine: ReturnType<typeof setup>['machine'], point: Point) => {
    machine.happens('pointerMove', point);
    machine.happens('leftPointerUp', point);
};

/** The start anchor from the most recent placement preview. */
const startAnchor = (preview: RecordingPreview) =>
    preview.lastArgs('showPlacementPreview')![2] as Point;

describe('single-spine placement: picking', () => {
    it('starts in PICK_START with the first hint', () => {
        const { machine, hints } = setup();
        expect(machine.currentState).toBe('PICK_START');
        expect(hints).toEqual(['hintPickStart']);
    });

    it('highlights the side of the track under the cursor, and hides it off the track', () => {
        const { graph, track, preview, machine } = setup();
        const segment = graph.getTrackSegmentWithJoints(track.segments[0])!;
        const offset = computePlatformOffset(segment.gauge, segment.bedWidth);

        machine.happens('pointerMove', { x: 50, y: 3 });
        const [segmentId, t, side, highlightOffset] =
            preview.lastArgs('showTrackHighlight')!;
        expect(segmentId).toBe(track.segments[0]);
        expect(t as number).toBeCloseTo(0.5);
        expect(side).toBe(1);
        expect(highlightOffset).toBe(offset);

        machine.happens('pointerMove', { x: 50, y: -3 });
        expect(preview.lastArgs('showTrackHighlight')![2]).toBe(-1);

        machine.happens('pointerMove', { x: 50, y: 50 });
        expect(preview.methods.at(-1)).toBe('hidePreview');
    });

    it('refuses a start pick off the track', () => {
        const { machine, hints } = setup();
        click(machine, { x: 50, y: 50 });
        expect(machine.currentState).toBe('PICK_START');
        expect(hints).toEqual(['hintPickStart']);
    });

    it('refuses a start pick more than 500 m from the station', () => {
        const { machine, hints } = setup(undefined, { x: 50, y: 600 });
        click(machine, { x: 50, y: 3 });
        expect(machine.currentState).toBe('PICK_START');
        expect(hints).toEqual(['hintPickStart']);
    });

    it('a refused end click drops back to PICK_START', () => {
        const { machine } = setup();
        click(machine, { x: 10, y: 3 });
        expect(machine.currentState).toBe('PICK_END');
        click(machine, { x: 50, y: 50 });
        expect(machine.currentState).toBe('PICK_START');
    });
});

describe('single-spine placement: creating a platform', () => {
    it('creates a platform from a spine on one segment and its outer vertices', () => {
        const {
            graph,
            track,
            stations,
            platforms,
            preview,
            hints,
            machine,
            stationId,
        } = setup();
        const segment = graph.getTrackSegmentWithJoints(track.segments[0])!;
        const offset = computePlatformOffset(segment.gauge, segment.bedWidth);
        let changes = 0;
        platforms.onChange(() => changes++);

        click(machine, { x: 10, y: 3 });
        click(machine, { x: 90, y: 3 });
        expect(machine.currentState).toBe('DRAW_OUTER');
        click(machine, { x: 90, y: 15 });
        click(machine, { x: 10, y: 15 });
        expect(platforms.getAllPlatforms()).toHaveLength(0);

        click(machine, startAnchor(preview));
        expect(machine.currentState).toBe('PICK_START');
        expect(hints).toEqual([
            'hintPickStart',
            'hintPickEnd',
            'hintDrawOuter',
            'hintPlatformCreated',
        ]);
        expect(preview.methods.at(-1)).toBe('hidePreview');

        const created = platforms.getAllPlatforms();
        expect(created).toHaveLength(1);
        const { id, platform } = created[0];
        expect(platform.stationId).toBe(stationId);
        expect(platform.spine).toHaveLength(1);
        expect(platform.spine[0]).toMatchObject({
            trackSegment: track.segments[0],
            side: 1,
        });
        expect(platform.spine[0].tStart).toBeCloseTo(0.1);
        expect(platform.spine[0].tEnd).toBeCloseTo(0.9);
        expect(platform.offset).toBe(offset);
        expect(platform.outerVertices).toEqual([
            { x: 90, y: 15 },
            { x: 10, y: 15 },
        ]);
        expect(platform.stopPositions.length).toBeGreaterThan(0);

        const station = stations.getStation(stationId)!;
        expect(station.trackAlignedPlatforms).toEqual([id]);
        // The station moved from (50, 10) onto the platform's first stop.
        expect(station.position.y).toBeCloseTo(0);
        // createPlatform notifies, then finalize notifies again after linking.
        expect(changes).toBe(2);
    });

    it('creates a platform with no outer vertices when the outline is closed at once', () => {
        const { platforms, preview, machine } = setup();
        click(machine, { x: 10, y: 3 });
        click(machine, { x: 90, y: 3 });
        click(machine, startAnchor(preview));
        expect(platforms.getAllPlatforms()[0].platform.outerVertices).toEqual(
            []
        );
    });

    it('forgets a half-picked spine when restarted for another station', () => {
        const { stations, platforms, preview, machine } = setup();
        click(machine, { x: 10, y: 3 });
        machine.happens('endPlacement');

        const second = stations.createStation(bareStation({ x: 50, y: -10 }));
        machine.happens('startPlacement', { stationId: second });
        expect(machine.currentState).toBe('PICK_START');
        click(machine, { x: 20, y: 3 });
        click(machine, { x: 80, y: 3 });
        click(machine, startAnchor(preview));

        const { platform } = platforms.getAllPlatforms()[0];
        expect(platform.stationId).toBe(second);
        expect(platform.spine[0].tStart).toBeCloseTo(0.2);
    });

    it('builds a spine across a joint that does not branch', () => {
        const { track, platforms, preview, machine } = setup(
            [
                { x: 0, y: 0 },
                { x: 100, y: 0 },
                { x: 200, y: 0 },
            ],
            { x: 100, y: 10 }
        );
        click(machine, { x: 50, y: 3 });
        click(machine, { x: 150, y: 3 });
        expect(machine.currentState).toBe('DRAW_OUTER');
        click(machine, { x: 150, y: 15 });
        click(machine, startAnchor(preview));

        const { platform } = platforms.getAllPlatforms()[0];
        expect(platform.spine).toHaveLength(2);
        expect(platform.spine[0]).toMatchObject({
            trackSegment: track.segments[0],
            tEnd: 1,
            side: 1,
        });
        expect(platform.spine[1]).toMatchObject({
            trackSegment: track.segments[1],
            tStart: 0,
            side: 1,
        });
        expect(platform.spine[0].tStart).toBeCloseTo(0.5);
        expect(platform.spine[1].tEnd).toBeCloseTo(0.5);
    });

    it('refuses a spine through a branching joint', () => {
        const { graph, track, platforms, hints, machine } = setup(
            [
                { x: 0, y: 0 },
                { x: 100, y: 0 },
                { x: 200, y: 0 },
            ],
            { x: 100, y: 10 }
        );
        const branchEnd = graph.createNewEmptyJoint(
            { x: 200, y: 40 },
            { x: 1, y: 0 }
        );
        graph.connectJoints(track.joints[1], branchEnd, [{ x: 150, y: 0 }]);

        click(machine, { x: 50, y: 3 });
        click(machine, { x: 150, y: 3 });
        expect(machine.currentState).toBe('PICK_START');
        expect(hints).not.toContain('hintDrawOuter');
        expect(platforms.getAllPlatforms()).toHaveLength(0);
    });
});

describe('single-spine placement: leaving', () => {
    it('escape steps back to PICK_START, then leaves the tool', () => {
        const { platforms, preview, machine } = setup();
        click(machine, { x: 10, y: 3 });
        machine.happens('escapeKey');
        expect(machine.currentState).toBe('PICK_START');
        expect(preview.methods.at(-1)).toBe('hidePreview');

        click(machine, { x: 10, y: 3 });
        click(machine, { x: 90, y: 3 });
        machine.happens('escapeKey');
        expect(machine.currentState).toBe('PICK_START');

        machine.happens('escapeKey');
        expect(machine.currentState).toBe('IDLE');
        expect(platforms.getAllPlatforms()).toHaveLength(0);
    });

    it('endPlacement leaves the tool from any state', () => {
        for (const clicks of [0, 1, 2]) {
            const { preview, machine } = setup();
            if (clicks >= 1) click(machine, { x: 10, y: 3 });
            if (clicks >= 2) click(machine, { x: 90, y: 3 });
            machine.happens('endPlacement');
            expect(machine.currentState).toBe('IDLE');
            expect(preview.methods.at(-1)).toBe('hidePreview');
        }
    });
});
```

- [ ] **Step 4: Dual-spine tests**

Create `test/dual-spine-placement.test.ts`:

```ts
import type { Point } from '@ue-too/math';
import { describe, expect, it } from 'bun:test';

import {
    DualSpinePlacementEngine,
    type DualSpineStates,
    createDualSpinePlacementStateMachine,
} from '../src/station-placement/dual-spine-placement-state-machine.js';
import { computePlatformOffset } from '../src/stations/platform-offset.js';
import { StationManager } from '../src/stations/station-manager.js';
import { TrackAlignedPlatformManager } from '../src/stations/track-aligned-platform-manager.js';
import { TrackGraph } from '../src/tracks/track.js';
import { ELEVATION } from '../src/tracks/types.js';
import {
    RecordingPreview,
    bareStation,
    identity,
    layTrack,
} from './station-placement-helpers.js';

/**
 * Two parallel 0–100 tracks, A along y = 0 and B along y = 20 (B optionally
 * raised), a bare station between them, and the dual-spine machine started.
 */
function setup(trackBElevation: ELEVATION = ELEVATION.GROUND) {
    const graph = new TrackGraph();
    const trackA = layTrack(graph, [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
    ]);
    const trackB = layTrack(
        graph,
        [
            { x: 0, y: 20 },
            { x: 100, y: 20 },
        ],
        trackBElevation
    );
    const stations = new StationManager();
    const platforms = new TrackAlignedPlatformManager();
    const preview = new RecordingPreview();
    const hints: string[] = [];
    const engine = new DualSpinePlacementEngine(
        graph,
        identity,
        stations,
        platforms,
        preview,
        key => hints.push(key)
    );
    const machine = createDualSpinePlacementStateMachine(engine);
    const stationId = stations.createStation(bareStation({ x: 50, y: 10 }));
    machine.happens('startPlacement', { stationId });
    return {
        graph,
        trackA,
        trackB,
        stations,
        platforms,
        preview,
        hints,
        machine,
        stationId,
    };
}

type Machine = ReturnType<typeof setup>['machine'];

const click = (machine: Machine, point: Point) => {
    machine.happens('pointerMove', point);
    machine.happens('leftPointerUp', point);
};

/** Spine A start and end anchors, then spine B's, from the latest preview. */
const anchors = (preview: RecordingPreview) => {
    const args = preview.lastArgs('showDualSpinePlacementPreview')!;
    return {
        aStart: args[4] as Point,
        aEnd: args[5] as Point,
        bStart: args[6] as Point,
        bEnd: args[7] as Point,
    };
};

/** Picks spine A left to right and spine B in the given order. */
function pickSpines(machine: Machine, bFrom: number, bTo: number) {
    click(machine, { x: 10, y: 3 });
    click(machine, { x: 90, y: 3 });
    click(machine, { x: bFrom, y: 17 });
    click(machine, { x: bTo, y: 17 });
}

describe('dual-spine placement: creating a platform pair', () => {
    it('picks both spines, draws both caps, and creates two platforms', () => {
        const {
            graph,
            trackA,
            trackB,
            stations,
            platforms,
            preview,
            hints,
            machine,
            stationId,
        } = setup();
        const segmentA = graph.getTrackSegmentWithJoints(trackA.segments[0])!;
        const offset = computePlatformOffset(segmentA.gauge, segmentA.bedWidth);
        expect(machine.currentState).toBe('PICK_SPINE_A_START');

        click(machine, { x: 10, y: 3 });
        expect(machine.currentState).toBe('PICK_SPINE_A_END');
        click(machine, { x: 90, y: 3 });
        expect(machine.currentState).toBe('PICK_SPINE_B_START');
        click(machine, { x: 10, y: 17 });
        expect(machine.currentState).toBe('PICK_SPINE_B_END');
        click(machine, { x: 90, y: 17 });
        expect(machine.currentState).toBe('DRAW_END_CAP_1');

        // Cap A runs from spine A's end to spine B's end.
        machine.happens('pointerMove', { x: 95, y: 10 });
        expect(preview.lastArgs('showCapDrawingHover')).toEqual([
            anchors(preview).aEnd,
            { x: 95, y: 10 },
            anchors(preview).bEnd,
            false,
        ]);
        click(machine, { x: 95, y: 10 });
        click(machine, anchors(preview).bEnd);
        expect(machine.currentState).toBe('DRAW_END_CAP_2');

        // Cap B runs from spine B's start back to spine A's start.
        click(machine, { x: 5, y: 10 });
        click(machine, anchors(preview).aStart);
        expect(machine.currentState).toBe('PICK_SPINE_A_START');

        expect(hints).toEqual([
            'hintDualPickSpineAStart',
            'hintDualPickSpineAEnd',
            'hintDualPickSpineBStart',
            'hintDualPickSpineBEnd',
            'hintDualDrawCap1',
            'hintDualDrawCap2',
            'hintPlatformCreated',
        ]);
        expect(preview.methods.at(-1)).toBe('hidePreview');

        const created = platforms.getAllPlatforms();
        expect(created).toHaveLength(2);
        const [a, b] = created;
        expect(a.platform.stationId).toBe(stationId);
        expect(b.platform.stationId).toBe(stationId);
        expect(a.platform.spine[0]).toMatchObject({
            trackSegment: trackA.segments[0],
            side: 1,
        });
        expect(b.platform.spine[0]).toMatchObject({
            trackSegment: trackB.segments[0],
            side: -1,
        });
        expect(a.platform.offset).toBe(offset);
        expect(b.platform.offset).toBe(offset);
        // Both platforms share the spines' midline; the drawn caps are not kept.
        expect(a.platform.outerVertices.length).toBeGreaterThan(0);
        expect(b.platform.outerVertices).toEqual(a.platform.outerVertices);
        expect(a.platform.outerVertices).not.toContainEqual({ x: 95, y: 10 });

        expect(stations.getStation(stationId)!.trackAlignedPlatforms).toEqual([
            a.id,
            b.id,
        ]);
    });

    it('keeps spine B as picked when its ends already face spine A’s', () => {
        const { preview, machine } = setup();
        pickSpines(machine, 10, 90);
        const { aStart, aEnd, bStart, bEnd } = anchors(preview);
        expect(bStart.x).toBeCloseTo(aStart.x);
        expect(bEnd.x).toBeCloseTo(aEnd.x);
    });

    it('reverses spine B when it was picked the other way round', () => {
        const { platforms, preview, machine } = setup();
        pickSpines(machine, 90, 10);
        const { aStart, aEnd, bStart, bEnd } = anchors(preview);
        expect(bStart.x).toBeCloseTo(aStart.x);
        expect(bEnd.x).toBeCloseTo(aEnd.x);

        click(machine, anchors(preview).bEnd);
        click(machine, anchors(preview).aStart);
        const spineB = platforms.getAllPlatforms()[1].platform.spine[0];
        expect(spineB.tStart).toBeCloseTo(0.1);
        expect(spineB.tEnd).toBeCloseTo(0.9);
    });
});

describe('dual-spine placement: refusals', () => {
    it('refuses spine B on a track at another elevation', () => {
        const { machine, hints } = setup(ELEVATION.ABOVE_1);
        click(machine, { x: 10, y: 3 });
        click(machine, { x: 90, y: 3 });
        click(machine, { x: 10, y: 17 });
        expect(machine.currentState).toBe('PICK_SPINE_B_START');
        expect(hints).not.toContain('hintDualPickSpineBEnd');
    });

    it('a refused end click drops back to picking that spine’s start', () => {
        const { machine } = setup();
        click(machine, { x: 10, y: 3 });
        click(machine, { x: 50, y: 50 });
        expect(machine.currentState).toBe('PICK_SPINE_A_START');

        click(machine, { x: 10, y: 3 });
        click(machine, { x: 90, y: 3 });
        click(machine, { x: 10, y: 17 });
        click(machine, { x: 50, y: 50 });
        expect(machine.currentState).toBe('PICK_SPINE_B_START');
    });
});

describe('dual-spine placement: leaving', () => {
    it('escape steps back one stage at a time', () => {
        const { machine, stationId } = setup();
        const steps: [number, DualSpineStates][] = [
            [1, 'PICK_SPINE_A_START'],
            [2, 'PICK_SPINE_A_START'],
            [3, 'PICK_SPINE_B_START'],
            [4, 'PICK_SPINE_A_START'],
        ];
        for (const [clicks, after] of steps) {
            machine.happens('endPlacement');
            machine.happens('startPlacement', { stationId });
            const points = [
                { x: 10, y: 3 },
                { x: 90, y: 3 },
                { x: 10, y: 17 },
                { x: 90, y: 17 },
            ];
            for (const point of points.slice(0, clicks)) click(machine, point);
            machine.happens('escapeKey');
            expect(machine.currentState).toBe(after);
        }
        machine.happens('escapeKey');
        expect(machine.currentState).toBe('IDLE');
    });

    it('escape from the second cap starts over', () => {
        const { platforms, preview, machine } = setup();
        pickSpines(machine, 10, 90);
        click(machine, anchors(preview).bEnd);
        expect(machine.currentState).toBe('DRAW_END_CAP_2');
        machine.happens('escapeKey');
        expect(machine.currentState).toBe('PICK_SPINE_A_START');
        expect(preview.methods.at(-1)).toBe('hidePreview');
        expect(platforms.getAllPlatforms()).toHaveLength(0);
    });

    it('endPlacement leaves the tool from a cap state', () => {
        const { machine } = setup();
        pickSpines(machine, 10, 90);
        machine.happens('endPlacement');
        expect(machine.currentState).toBe('IDLE');
    });
});
```

- [ ] **Step 5: Format, typecheck, test**

```bash
cd "$TL" && bun run format >/dev/null && bun run format:check | tail -1 && bun run typecheck && tcount
```

Expected: Prettier is clean, the typecheck prints nothing, and `356 pass`, `0 fail`, `Ran 356 tests across 33 files`. That is 6 island, 12 single-spine and 8 dual-spine tests. If one fails, the expectation is wrong (see Conventions).

- [ ] **Step 6: Commit**

```bash
git add test/station-placement-helpers.ts test/station-placement-island.test.ts test/single-spine-placement.test.ts test/dual-spine-placement.test.ts && git commit -m "test(station-placement): characterize the three placement tools" -m "Each tool runs on its real engine, a real track graph and real managers, with a preview that records its calls: commit paths, refusals, hint order, escape and endPlacement. It also pins three cases the spec implies: the island gauge is read at release, a restarted spine tool forgets its half-picked spine, and an outline closed at once creates a platform with no outer vertices."
```

---

### Task 4: Add and remove events on the managers

This is change 5.

**Files:**

- Modify: `src/stations/station-manager.ts`, `src/stations/track-aligned-platform-manager.ts`
- Create: `test/station-manager-events.test.ts`

**Interfaces:**

- **Produces on `StationManager`:**
    - `onStationAdded(callback: (id: number) => void, options?: SubscriptionOptions): () => void`
    - `onStationRemoved(callback: (id: number) => void, options?: SubscriptionOptions): () => void`
- **Produces on `TrackAlignedPlatformManager`:**
    - `onPlatformAdded(callback: (id: number) => void, options?: SubscriptionOptions): () => void`
    - `onPlatformRemoved(callback: (id: number) => void, options?: SubscriptionOptions): () => void`
- **When they fire:**
    - Added fires after the entity is created, and before that call's `onChange`.
    - Removed fires after the before-destroy hook and the entity's removal, and before `onChange`. It fires only for an entity that existed.
    - `destroyPlatformsForStation` fires once per platform, then its one `onChange`.

- [ ] **Step 1: Write the failing test**

Create `test/station-manager-events.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';

import { StationManager } from '../src/stations/station-manager.js';
import { TrackAlignedPlatformManager } from '../src/stations/track-aligned-platform-manager.js';
import type { TrackAlignedPlatform } from '../src/stations/track-aligned-platform-types.js';
import { bareStation } from './station-placement-helpers.js';

function platformFor(stationId: number): Omit<TrackAlignedPlatform, 'id'> {
    return {
        stationId,
        spine: [{ trackSegment: 0, tStart: 0, tEnd: 1, side: 1 }],
        offset: 2,
        outerVertices: [{ x: 0, y: 5 }],
        stopPositions: [],
    };
}

/** A station manager whose events are logged in the order they fire. */
function loggedStations() {
    const stations = new StationManager();
    const log: string[] = [];
    stations.onStationAdded(id => log.push(`added ${id}`));
    stations.onStationRemoved(id => log.push(`removed ${id}`));
    stations.onChange(() => log.push('change'));
    return { stations, log };
}

/** A platform manager whose events are logged in the order they fire. */
function loggedPlatforms() {
    const platforms = new TrackAlignedPlatformManager();
    const log: string[] = [];
    platforms.onPlatformAdded(id => log.push(`added ${id}`));
    platforms.onPlatformRemoved(id => log.push(`removed ${id}`));
    platforms.onChange(() => log.push('change'));
    return { platforms, log };
}

describe('StationManager add and remove events', () => {
    it('fires onStationAdded from both create paths, before onChange', () => {
        const { stations, log } = loggedStations();
        const id = stations.createStation(bareStation({ x: 0, y: 0 }));
        stations.createStationWithId(5, {
            ...bareStation({ x: 0, y: 0 }),
            id: 5,
        });
        expect(log).toEqual([`added ${id}`, 'change', 'added 5', 'change']);
    });

    it('fires onStationRemoved after the before-destroy hook and before onChange', () => {
        const { stations, log } = loggedStations();
        const id = stations.createStation(bareStation({ x: 0, y: 0 }));
        stations.setOnDestroyStation(hooked => log.push(`hook ${hooked}`));
        log.length = 0;

        stations.destroyStation(id);
        expect(log).toEqual([`hook ${id}`, `removed ${id}`, 'change']);
    });

    it('fires no removed event for a station that does not exist', () => {
        const { stations, log } = loggedStations();
        stations.destroyStation(3);
        expect(log).toEqual(['change']);
    });

    it('stops firing once unsubscribed', () => {
        const stations = new StationManager();
        const ids: number[] = [];
        const offAdded = stations.onStationAdded(id => ids.push(id));
        const offRemoved = stations.onStationRemoved(id => ids.push(-id));
        offAdded();
        offRemoved();
        const id = stations.createStation(bareStation({ x: 0, y: 0 }));
        stations.destroyStation(id);
        expect(ids).toEqual([]);
    });
});

describe('TrackAlignedPlatformManager add and remove events', () => {
    it('fires onPlatformAdded from both create paths, before onChange', () => {
        const { platforms, log } = loggedPlatforms();
        const id = platforms.createPlatform(platformFor(0));
        platforms.createPlatformWithId(7, platformFor(0));
        expect(log).toEqual([`added ${id}`, 'change', 'added 7', 'change']);
    });

    it('fires onPlatformRemoved after the before-destroy hook and before onChange', () => {
        const { platforms, log } = loggedPlatforms();
        const id = platforms.createPlatform(platformFor(0));
        platforms.setOnBeforeDestroy(hooked => log.push(`hook ${hooked}`));
        log.length = 0;

        platforms.destroyPlatform(id);
        expect(log).toEqual([`hook ${id}`, `removed ${id}`, 'change']);
    });

    it('fires one removed event per platform of a station, then one onChange', () => {
        const { platforms, log } = loggedPlatforms();
        const a = platforms.createPlatform(platformFor(1));
        const other = platforms.createPlatform(platformFor(2));
        const b = platforms.createPlatform(platformFor(1));
        log.length = 0;

        platforms.destroyPlatformsForStation(1);
        expect(log).toEqual([`removed ${a}`, `removed ${b}`, 'change']);
        expect(platforms.getPlatform(other)).not.toBeNull();
    });

    it('fires no removed event for a platform that does not exist', () => {
        const { platforms, log } = loggedPlatforms();
        platforms.destroyPlatform(3);
        expect(log).toEqual(['change']);
    });

    it('stops firing once unsubscribed', () => {
        const platforms = new TrackAlignedPlatformManager();
        const ids: number[] = [];
        const offAdded = platforms.onPlatformAdded(id => ids.push(id));
        const offRemoved = platforms.onPlatformRemoved(id => ids.push(-id));
        offAdded();
        offRemoved();
        const id = platforms.createPlatform(platformFor(0));
        platforms.destroyPlatform(id);
        expect(ids).toEqual([]);
    });
});

describe('station delete cascade', () => {
    it('removes the station’s platforms before the station itself', () => {
        const stations = new StationManager();
        const platforms = new TrackAlignedPlatformManager();
        stations.setOnDestroyStation(stationId => {
            for (const { id } of platforms.getPlatformsByStation(stationId)) {
                platforms.destroyPlatform(id);
            }
        });
        const stationId = stations.createStation(bareStation({ x: 0, y: 0 }));
        const p1 = platforms.createPlatform(platformFor(stationId));
        const p2 = platforms.createPlatform(platformFor(stationId));

        const log: string[] = [];
        platforms.onPlatformRemoved(id => log.push(`platform ${id}`));
        stations.onStationRemoved(id => log.push(`station ${id}`));
        stations.destroyStation(stationId);
        expect(log).toEqual([
            `platform ${p1}`,
            `platform ${p2}`,
            `station ${stationId}`,
        ]);
    });
});
```

Run: `bun test test/station-manager-events.test.ts`
Expected: FAIL with `stations.onStationAdded is not a function`.

- [ ] **Step 2: Station events.**

In `src/stations/station-manager.ts`, replace:

```ts
import { SynchronousObservable } from '@ue-too/board';
```

with:

```ts
import {
    Observable,
    type SubscriptionOptions,
    SynchronousObservable,
} from '@ue-too/board';
```

In `src/stations/station-manager.ts`, replace:

```ts
    private _changeObservable: SynchronousObservable<[]> =
        new SynchronousObservable<[]>();
```

with:

```ts
    private _changeObservable: SynchronousObservable<[]> =
        new SynchronousObservable<[]>();
    private _stationAddedObservable: Observable<[number]> =
        new SynchronousObservable<[number]>();
    private _stationRemovedObservable: Observable<[number]> =
        new SynchronousObservable<[number]>();
```

In `src/stations/station-manager.ts`, replace:

```ts
    private _notifyChanged(): void {
```

with:

```ts
    /**
     * Subscribe to a station being created, by `createStation` or
     * `createStationWithId`. Fires before `onChange`.
     */
    onStationAdded(
        callback: (id: number) => void,
        options?: SubscriptionOptions
    ): () => void {
        return this._stationAddedObservable.subscribe(callback, options);
    }

    /**
     * Subscribe to a station being destroyed. Fires after the before-destroy
     * hook and the entity's removal, before `onChange`, and only for a
     * station that existed.
     */
    onStationRemoved(
        callback: (id: number) => void,
        options?: SubscriptionOptions
    ): () => void {
        return this._stationRemovedObservable.subscribe(callback, options);
    }

    private _notifyChanged(): void {
```

In `src/stations/station-manager.ts`, replace:

```ts
        if (entity) entity.id = id;
        this._notifyChanged();
        return id;
```

with:

```ts
        if (entity) entity.id = id;
        this._stationAddedObservable.notify(id);
        this._notifyChanged();
        return id;
```

In `src/stations/station-manager.ts`, replace:

```ts
        this._manager.createEntityWithId(id, { ...station, id });
        this._notifyChanged();
```

with:

```ts
        this._manager.createEntityWithId(id, { ...station, id });
        this._stationAddedObservable.notify(id);
        this._notifyChanged();
```

In `src/stations/station-manager.ts`, replace:

```ts
    destroyStation(id: number): void {
        this._onDestroyStation?.(id);
        this._manager.destroyEntity(id);
        this._notifyChanged();
```

with:

```ts
    destroyStation(id: number): void {
        const existed = this._manager.getEntity(id) !== null;
        this._onDestroyStation?.(id);
        this._manager.destroyEntity(id);
        if (existed) this._stationRemovedObservable.notify(id);
        this._notifyChanged();
```

- [ ] **Step 3: Platform events.**

In `src/stations/track-aligned-platform-manager.ts`, replace:

```ts
    private _changeObservable: Observable<[]> = new SynchronousObservable<[]>();
```

with:

```ts
    private _changeObservable: Observable<[]> = new SynchronousObservable<[]>();
    private _platformAddedObservable: Observable<[number]> =
        new SynchronousObservable<[number]>();
    private _platformRemovedObservable: Observable<[number]> =
        new SynchronousObservable<[number]>();
```

In `src/stations/track-aligned-platform-manager.ts`, replace:

```ts
    // -----------------------------------------------------------------------
    // CRUD
    // -----------------------------------------------------------------------
```

with:

```ts
    /**
     * Subscribe to a platform being created, by `createPlatform` or
     * `createPlatformWithId`. Fires before `onChange`.
     *
     * The placement tools link a new platform to its station only after
     * creating it, so while this fires the station's `trackAlignedPlatforms`
     * doesn't list it yet. Listen to `onChange`, which they fire again once
     * the link is set, if you need it.
     */
    onPlatformAdded(
        callback: (id: number) => void,
        options?: SubscriptionOptions
    ): () => void {
        return this._platformAddedObservable.subscribe(callback, options);
    }

    /**
     * Subscribe to a platform being destroyed, by `destroyPlatform` or once per
     * platform by `destroyPlatformsForStation`. Fires after the before-destroy
     * hook and the entity's removal, before `onChange`, and only for a
     * platform that existed.
     */
    onPlatformRemoved(
        callback: (id: number) => void,
        options?: SubscriptionOptions
    ): () => void {
        return this._platformRemovedObservable.subscribe(callback, options);
    }

    // -----------------------------------------------------------------------
    // CRUD
    // -----------------------------------------------------------------------
```

In `src/stations/track-aligned-platform-manager.ts`, replace (the end of `createPlatformWithId`):

```ts
            id,
        } as TrackAlignedPlatform);
        this._changeObservable.notify();
    }
```

with:

```ts
            id,
        } as TrackAlignedPlatform);
        this._platformAddedObservable.notify(id);
        this._changeObservable.notify();
    }
```

In `src/stations/track-aligned-platform-manager.ts`, replace:

```ts
        if (entity) entity.id = id;
        this._changeObservable.notify();
        return id;
```

with:

```ts
        if (entity) entity.id = id;
        this._platformAddedObservable.notify(id);
        this._changeObservable.notify();
        return id;
```

`destroyPlatform` already reads `const platform = this._manager.getEntity(id);`.

In `src/stations/track-aligned-platform-manager.ts`, replace:

```ts
        this._manager.destroyEntity(id);
        this._changeObservable.notify();
    }
```

with:

```ts
        this._manager.destroyEntity(id);
        if (platform) this._platformRemovedObservable.notify(id);
        this._changeObservable.notify();
    }
```

In `src/stations/track-aligned-platform-manager.ts`, replace (inside `destroyPlatformsForStation`):

```ts
            this._manager.destroyEntity(index);
        }
```

with:

```ts
            this._manager.destroyEntity(index);
            this._platformRemovedObservable.notify(index);
        }
```

- [ ] **Step 4: Format, typecheck, test**

```bash
cd "$TL" && bun run format >/dev/null && bun run format:check | tail -1 && bun run typecheck && tcount
```

Expected: Prettier is clean, the typecheck prints nothing, and `366 pass`, `0 fail`, `Ran 366 tests across 34 files`.

- [ ] **Step 5: Commit**

```bash
git add src/stations/station-manager.ts src/stations/track-aligned-platform-manager.ts test/station-manager-events.test.ts && git commit -m "feat(stations): add and remove events on the station and platform managers" -m "StationManager gains onStationAdded and onStationRemoved, and TrackAlignedPlatformManager gains onPlatformAdded and onPlatformRemoved. They carry the id, fire before the coarse onChange, and fire removed only for an entity that existed. Renderers can subscribe instead of being told by the placement tools."
```

---

### Task 5: Island factory, typed hint keys and the remaining dead code

These are changes 6 and 7, and the rest of change 8.

**Files:**

- Modify: the three engine files, and `test/station-placement-island.test.ts`, `test/single-spine-placement.test.ts`, `test/dual-spine-placement.test.ts`

**Interfaces:**

- **Produces:**
    - `createStationPlacementStateMachine(context: StationPlacementContext): StationPlacementStateMachine`
    - `SINGLE_SPINE_HINT_KEYS` and `SingleSpineHintKey`
    - `DUAL_SPINE_HINT_KEYS` and `DualSpineHintKey`
- **`onHint` is typed** `(key: SingleSpineHintKey) => void` or `(key: DualSpineHintKey) => void`.
- **Removed:** `StationPlacementEngine.createBareStation`, and `showHint` from both spine contexts and engines.

- [ ] **Step 1: Write the failing tests**

In `test/station-placement-island.test.ts`, replace:

```ts
import {
    StationPlacementEngine,
    StationPlacementStateMachine,
} from '../src/station-placement/station-placement-state-machine.js';
```

with:

```ts
import {
    StationPlacementEngine,
    StationPlacementStateMachine,
    createStationPlacementStateMachine,
} from '../src/station-placement/station-placement-state-machine.js';
```

Append to `test/station-placement-island.test.ts`:

```ts
describe('createStationPlacementStateMachine', () => {
    it('builds a machine that places a station', () => {
        const stations = new StationManager();
        const engine = new StationPlacementEngine(
            new TrackGraph(),
            identity,
            stations,
            new RecordingPreview(),
            () => 1.067
        );
        const machine = createStationPlacementStateMachine(engine);
        machine.happens('startPlacement');
        machine.happens('leftPointerUp', { x: 0, y: 0 });
        machine.happens('leftPointerUp', { x: 50, y: 0 });
        expect(stations.getStations()).toHaveLength(1);
    });
});
```

In `test/single-spine-placement.test.ts`, replace:

```ts
import {
    SingleSpinePlacementEngine,
    createSingleSpinePlacementStateMachine,
} from '../src/station-placement/single-spine-placement-state-machine.js';
```

with:

```ts
import {
    SINGLE_SPINE_HINT_KEYS,
    SingleSpinePlacementEngine,
    createSingleSpinePlacementStateMachine,
} from '../src/station-placement/single-spine-placement-state-machine.js';
```

Append to `test/single-spine-placement.test.ts`:

```ts
describe('single-spine hint keys', () => {
    it('lists the keys a placement emits, in order', () => {
        const { preview, hints, machine } = setup();
        click(machine, { x: 10, y: 3 });
        click(machine, { x: 90, y: 3 });
        click(machine, { x: 90, y: 15 });
        click(machine, startAnchor(preview));
        expect(hints).toEqual([...SINGLE_SPINE_HINT_KEYS]);
    });
});
```

In `test/dual-spine-placement.test.ts`, replace:

```ts
import {
    DualSpinePlacementEngine,
    type DualSpineStates,
```

with:

```ts
import {
    DUAL_SPINE_HINT_KEYS,
    DualSpinePlacementEngine,
    type DualSpineStates,
```

Append to `test/dual-spine-placement.test.ts`:

```ts
describe('dual-spine hint keys', () => {
    it('lists the keys a placement emits, in order', () => {
        const { preview, hints, machine } = setup();
        pickSpines(machine, 10, 90);
        click(machine, anchors(preview).bEnd);
        click(machine, anchors(preview).aStart);
        expect(hints).toEqual([...DUAL_SPINE_HINT_KEYS]);
    });
});
```

Run: `bun test test/station-placement-island.test.ts test/single-spine-placement.test.ts test/dual-spine-placement.test.ts`
Expected: FAIL. All three files report `Export named '…' not found`.

- [ ] **Step 2: Add the island factory (change 6).**

Append to `src/station-placement/station-placement-state-machine.ts`:

```ts
/**
 * Creates the island station placement tool's state machine. The context is
 * usually a StationPlacementEngine.
 */
export function createStationPlacementStateMachine(
    context: StationPlacementContext
): StationPlacementStateMachine {
    return new StationPlacementStateMachine(context);
}
```

- [ ] **Step 3: Remove `createBareStation` (change 8).** Nothing calls it; banana's station list creates bare stations itself.

In `src/station-placement/station-placement-state-machine.ts`, delete from the line `    /**` that opens the comment `     * Creates a station with no platforms, no tracks, and no joints.` up to, but not including, the line `    setup(): void {}`.

- [ ] **Step 4: Type the single-spine hint keys (change 7) and remove `showHint` (change 8)**

In `src/station-placement/single-spine-placement-state-machine.ts`, replace:

```ts
// ---------------------------------------------------------------------------
// Context
```

with:

```ts
/**
 * The hint keys the single-spine tool passes to `onHint`, in the order it
 * emits them.
 */
export const SINGLE_SPINE_HINT_KEYS = [
    'hintPickStart',
    'hintPickEnd',
    'hintDrawOuter',
    'hintPlatformCreated',
] as const;

export type SingleSpineHintKey = (typeof SINGLE_SPINE_HINT_KEYS)[number];

// ---------------------------------------------------------------------------
// Context
```

In `src/station-placement/single-spine-placement-state-machine.ts`, replace:

```ts
    private _onHint: (key: string) => void;
```

with:

```ts
    private _onHint: (key: SingleSpineHintKey) => void;
```

In `src/station-placement/single-spine-placement-state-machine.ts`, replace:

```ts
        onHint?: (key: string) => void
```

with:

```ts
        onHint?: (key: SingleSpineHintKey) => void
```

In `src/station-placement/single-spine-placement-state-machine.ts`, delete:

```ts
    showHint: (key: string) => void;
```

In `src/station-placement/single-spine-placement-state-machine.ts`, delete:

```ts
    showHint(key: string): void {
        this._onHint(key);
    }
```

- [ ] **Step 5: The same for the dual-spine tool**

In `src/station-placement/dual-spine-placement-state-machine.ts`, replace:

```ts
// ---------------------------------------------------------------------------
// Context
```

with:

```ts
/**
 * The hint keys the dual-spine tool passes to `onHint`, in the order it
 * emits them.
 */
export const DUAL_SPINE_HINT_KEYS = [
    'hintDualPickSpineAStart',
    'hintDualPickSpineAEnd',
    'hintDualPickSpineBStart',
    'hintDualPickSpineBEnd',
    'hintDualDrawCap1',
    'hintDualDrawCap2',
    'hintPlatformCreated',
] as const;

export type DualSpineHintKey = (typeof DUAL_SPINE_HINT_KEYS)[number];

// ---------------------------------------------------------------------------
// Context
```

In `src/station-placement/dual-spine-placement-state-machine.ts`, replace:

```ts
    private _onHint: (key: string) => void;
```

with:

```ts
    private _onHint: (key: DualSpineHintKey) => void;
```

In `src/station-placement/dual-spine-placement-state-machine.ts`, replace:

```ts
        onHint?: (key: string) => void
```

with:

```ts
        onHint?: (key: DualSpineHintKey) => void
```

In `src/station-placement/dual-spine-placement-state-machine.ts`, delete:

```ts
    showHint: (key: string) => void;
```

In `src/station-placement/dual-spine-placement-state-machine.ts`, delete:

```ts
    showHint(key: string): void {
        this._onHint(key);
    }
```

- [ ] **Step 6: Format, typecheck, test**

```bash
cd "$TL" && bun run format >/dev/null && bun run format:check | tail -1 && bun run typecheck && tcount; grep -rn "showHint\|createBareStation" src; echo "grep-exit=$?"
```

Expected:

- Prettier is clean and the typecheck prints nothing.
- `369 pass`, `0 fail`, `Ran 369 tests across 34 files`.
- `grep-exit=1`.

- [ ] **Step 7: Commit**

```bash
git add src/station-placement test/station-placement-island.test.ts test/single-spine-placement.test.ts test/dual-spine-placement.test.ts && git commit -m "feat(station-placement): island factory, typed hint keys, dead code removed" -m "Adds createStationPlacementStateMachine, and SINGLE_SPINE_HINT_KEYS and DUAL_SPINE_HINT_KEYS with their union types, which now type onHint. Removes the unused createBareStation and showHint."
```

---

### Task 6: Share the spine-path helpers

This is change 9. Both spine engines carry their own copy of `_buildSpinePath`, `_pathToSpineEntries` and `_sharedJointT`. The copies are identical apart from comments and one type annotation. The characterization tests from Task 3 guard the move.

**Files:**

- Create: `src/station-placement/spine-path.ts`, `test/spine-path.test.ts`
- Modify: `src/station-placement/single-spine-placement-state-machine.ts`, `src/station-placement/dual-spine-placement-state-machine.ts`

**Interfaces:**

- **Produces in `src/station-placement/spine-path.ts`:**
    - `buildSpinePath(trackGraph: TrackGraph, startSeg: number, startT: number, side: 1 | -1, endSeg: number, endT: number): SpineEntry[] | null`
    - `sharedJointT(seg: { t0Joint: number; t1Joint: number }, other: { t0Joint: number; t1Joint: number }): 0 | 1`
- **The module stays internal:** `index.ts` doesn't re-export it, and Task 7's entry test checks that.

- [ ] **Step 1: Write the failing test**

Create `test/spine-path.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';

import {
    buildSpinePath,
    sharedJointT,
} from '../src/station-placement/spine-path.js';
import { TrackGraph } from '../src/tracks/track.js';
import { layTrack } from './station-placement-helpers.js';

describe('buildSpinePath', () => {
    it('keeps the picked range on a single segment', () => {
        const graph = new TrackGraph();
        const { segments } = layTrack(graph, [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
        ]);
        expect(
            buildSpinePath(graph, segments[0], 0.8, -1, segments[0], 0.2)
        ).toEqual([
            { trackSegment: segments[0], tStart: 0.8, tEnd: 0.2, side: -1 },
        ]);
    });

    it('runs across a joint that does not branch', () => {
        const graph = new TrackGraph();
        const { segments } = layTrack(graph, [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 200, y: 0 },
        ]);
        expect(
            buildSpinePath(graph, segments[0], 0.5, 1, segments[1], 0.5)
        ).toEqual([
            { trackSegment: segments[0], tStart: 0.5, tEnd: 1, side: 1 },
            { trackSegment: segments[1], tStart: 0, tEnd: 0.5, side: 1 },
        ]);
    });

    it('flips the side onto a segment that runs the other way', () => {
        const graph = new TrackGraph();
        const a = graph.createNewEmptyJoint({ x: 0, y: 0 }, { x: 1, y: 0 });
        const b = graph.createNewEmptyJoint({ x: 100, y: 0 }, { x: 1, y: 0 });
        const c = graph.createNewEmptyJoint({ x: 200, y: 0 }, { x: 1, y: 0 });
        graph.connectJoints(a, b, [{ x: 50, y: 0 }]);
        graph.connectJoints(c, b, [{ x: 150, y: 0 }]);
        const ab = graph.getJoint(a)!.connections.get(b)!;
        const cb = graph.getJoint(c)!.connections.get(b)!;

        expect(buildSpinePath(graph, ab, 0.5, 1, cb, 0.5)).toEqual([
            { trackSegment: ab, tStart: 0.5, tEnd: 1, side: 1 },
            { trackSegment: cb, tStart: 1, tEnd: 0.5, side: -1 },
        ]);
    });

    it('returns null when the only way runs through a branching joint', () => {
        const graph = new TrackGraph();
        const { joints, segments } = layTrack(graph, [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 200, y: 0 },
        ]);
        const branchEnd = graph.createNewEmptyJoint(
            { x: 200, y: 40 },
            { x: 1, y: 0 }
        );
        graph.connectJoints(joints[1], branchEnd, [{ x: 150, y: 0 }]);
        expect(
            buildSpinePath(graph, segments[0], 0.5, 1, segments[1], 0.5)
        ).toBeNull();
    });
});

describe('sharedJointT', () => {
    it('gives the t of the joint the segment shares with the other', () => {
        expect(
            sharedJointT({ t0Joint: 1, t1Joint: 2 }, { t0Joint: 2, t1Joint: 3 })
        ).toBe(1);
        expect(
            sharedJointT({ t0Joint: 2, t1Joint: 3 }, { t0Joint: 1, t1Joint: 2 })
        ).toBe(0);
    });

    it('falls back to 1 when the segments share no joint', () => {
        expect(
            sharedJointT({ t0Joint: 1, t1Joint: 2 }, { t0Joint: 3, t1Joint: 4 })
        ).toBe(1);
    });
});
```

Run: `bun test test/spine-path.test.ts`
Expected: FAIL with `Cannot find module '../src/station-placement/spine-path.js'`.

- [ ] **Step 2: Move the single-spine engine's copy into `spine-path.ts`**

Create `src/station-placement/spine-path.ts` with this header:

```ts
/**
 * Builds the spine of a track-aligned platform between two picked points,
 * shared by the single- and dual-spine placement tools.
 */
import type { SpineEntry, TrackGraph } from '../index.js';
```

Below the header, move the single-spine engine's three helpers. They are everything from the comment `Builds a spine path from \`startSeg\` to \`endSeg\`` to the end of `_sharedJointT`, at the bottom of the class. Turn them into module functions:

- **Dedent** them by one level (4 spaces).
- **`buildSpinePath`.** `private _buildSpinePath(` becomes `export function buildSpinePath(`, with `trackGraph: TrackGraph` as its first parameter.
- **`pathToSpineEntries`.** `private _pathToSpineEntries(` becomes `function pathToSpineEntries(`, not exported, also with `trackGraph: TrackGraph` first.
- **`sharedJointT`.** `private _sharedJointT(` becomes `export function sharedJointT(`.
- **References:**
    - `this._trackGraph` becomes `trackGraph`.
    - `this._pathToSpineEntries(path, startT, side, endT)` becomes `pathToSpineEntries(trackGraph, path, startT, side, endT)`.
    - `this._sharedJointT(` becomes `sharedJointT(`.
- **Doc comments.** Keep them. The first, one-line `Converts a sequence of segment IDs into SpineEntry objects.` comment is a duplicate of the longer one under it; drop it.

No `this.` is left in the module.

- [ ] **Step 3: Both engines call the module.** In each spine engine:

- Delete its copy of the three helpers: everything from the comment `Builds a spine path from \`startSeg\` to \`endSeg\`` to the end of `_sharedJointT`. That is the end of the engine class, so the class's closing `}` follows.
- Replace `this._buildSpinePath(` with `buildSpinePath(this._trackGraph, `. That is 2 occurrences in the single-spine engine and 4 in the dual-spine engine.
- Import it next to the preview import: `import { buildSpinePath } from './spine-path.js';`

- [ ] **Step 4: Format, typecheck, test**

```bash
cd "$TL" && bun run format >/dev/null && bun run format:check | tail -1 && bun run typecheck && tcount; grep -n "_buildSpinePath\|_pathToSpineEntries\|_sharedJointT" src/station-placement/*.ts; echo "grep-exit=$?"
```

Expected:

- Prettier is clean and the typecheck prints nothing.
- `375 pass`, `0 fail`, `Ran 375 tests across 35 files`. Every Task 3 test still passes, so behaviour is unchanged.
- `grep-exit=1`.

- [ ] **Step 5: Commit**

```bash
git add src/station-placement test/spine-path.test.ts && git commit -m "refactor(station-placement): share the spine-path helpers" -m "The single- and dual-spine engines each carried a copy of the spine path search. It moves into an internal spine-path module with its own tests, and both engines call it."
```

---

### Task 7: Package surface for `track-layout/station-placement`

**Files:**

- Create: `test/station-placement-entry.test.ts`
- Modify: `package.json`, `README.md`

- [ ] **Step 1: Write the entry-point guard test**

Create `test/station-placement-entry.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';

import * as root from '../src/index.js';
import * as stationPlacement from '../src/station-placement/index.js';
// Type-only exports: the typecheck fails if any of these goes missing.
import type {
    DualSpineContext,
    DualSpineEvents,
    DualSpineHintKey,
    DualSpinePlacementPreview,
    DualSpinePlacementStateMachine,
    DualSpineStates,
    SingleSpineContext,
    SingleSpineEvents,
    SingleSpineHintKey,
    SingleSpinePlacementPreview,
    SingleSpinePlacementStateMachine,
    SingleSpineStates,
    SpinePlacementPreview,
    StationPlacementContext,
    StationPlacementEvents,
    StationPlacementPreview,
    StationPlacementStates,
} from '../src/station-placement/index.js';

const RUNTIME_EXPORTS = [
    'StationPlacementEngine',
    'StationPlacementStateMachine',
    'createStationPlacementStateMachine',
    'SingleSpinePlacementEngine',
    'createSingleSpinePlacementStateMachine',
    'SINGLE_SPINE_PLACEMENT_STATES',
    'SINGLE_SPINE_HINT_KEYS',
    'DualSpinePlacementEngine',
    'createDualSpinePlacementStateMachine',
    'DUAL_SPINE_PLACEMENT_STATES',
    'DUAL_SPINE_HINT_KEYS',
];

describe('station-placement entry point', () => {
    it('exposes the three placement tools', () => {
        for (const name of RUNTIME_EXPORTS) {
            expect(stationPlacement).toHaveProperty(name);
        }
    });

    it('keeps the spine-path helpers internal', () => {
        expect(stationPlacement).not.toHaveProperty('buildSpinePath');
        expect(stationPlacement).not.toHaveProperty('sharedJointT');
    });

    it('is not re-exported from the package root', () => {
        for (const name of RUNTIME_EXPORTS) {
            expect(root).not.toHaveProperty(name);
        }
    });
});
```

Run: `bun test test/station-placement-entry.test.ts`
Expected: `3 pass`. Task 1 built the barrel; from now on this test guards it, along with the type-only exports, which the typecheck covers.

- [ ] **Step 2: Export `./station-placement`.**

In `package.json`, replace:

```json
            "default": "./dist/editing/index.js"
        },
        "./package.json": "./package.json"
```

with:

```json
            "default": "./dist/editing/index.js"
        },
        "./station-placement": {
            "types": "./dist/station-placement/index.d.ts",
            "import": "./dist/station-placement/index.js",
            "default": "./dist/station-placement/index.js"
        },
        "./package.json": "./package.json"
```

- [ ] **Step 3: Document the entry point.**

In `README.md`, replace:

````markdown
layout.happens('leftPointerUp', { x: 100, y: 0 }); // lays a segment
```

## Development
````

with:

````markdown
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
  `onStationRemoved` and `onPlatformRemoved`.
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

## Development
````

- [ ] **Step 4: Build and check what ships**

```bash
cd "$TL" && bun run build >/dev/null && ls dist/station-placement/*.js && bun pm pack --dry-run 2>&1 | grep "Total files" \
  && node --input-type=module -e "import('./dist/station-placement/index.js').then(m => console.log('station-placement exports:', Object.keys(m).length))"
```

Expected:

- six `.js` files, including `spine-path.js`
- `Total files: 123`
- `station-placement exports: 11`, which shows the emitted ESM loads in plain Node

- [ ] **Step 5: Full check and commit**

```bash
bun run format >/dev/null && bun run format:check | tail -1 && bun run typecheck && tcount \
  && git add package.json README.md test/station-placement-entry.test.ts && git commit -m "feat(station-placement): export track-layout/station-placement" -m "Adds the ./station-placement export, with a README section and an entry-point guard test. No new peer dependencies."
```

Expected: `378 pass`, `0 fail`, `Ran 378 tests across 36 files`.

---

### Task 8 (banana): Install the tarball and draw from manager events

This task installs the packed 0.3.0 in banana and adds the helper that keeps the renderers in step with the managers. Nothing uses the helper until Task 9.

**Files:**

- Modify: BN `package.json`, `bun.lock`
- Create: BN `src/stations/station-render-wiring.ts`, `test/station-render-wiring.test.ts`, `test/station-hint-translations.test.ts`

**Interfaces:**

- **Consumes** Task 4's four events, and Task 5's `SINGLE_SPINE_HINT_KEYS` and `DUAL_SPINE_HINT_KEYS`.
- **Produces:** `wireStationRenderers(stationManager, platformManager, stationRenderSystem: Pick<StationRenderSystem, 'addStation' | 'removeStation'>, platformRenderSystem: Pick<TrackAlignedPlatformRenderSystem, 'addPlatform' | 'removePlatform'>): () => void`.

- [ ] **Step 1: Pack `track-layout`**

Run: `cd "$TL" && bun run pack:local && ls .pack`
Expected: `track-layout-local.tgz`.

- [ ] **Step 2: Point banana at the tarball.** `bun add <tarball>` fails with `DependencyLoop` while banana depends on the registry version, so edit `package.json` instead. The relative path differs per machine:

```bash
cd "$BN" && TGZ=$(python3 -c "import os,sys;print(os.path.relpath(sys.argv[1], sys.argv[2]))" "$TL/.pack/track-layout-local.tgz" "$BN") \
  && perl -pi -e "s#\"track-layout\": \"\\^0\\.2\\.0\"#\"track-layout\": \"$TGZ\"#" package.json && grep -n '"track-layout"' package.json \
  && bun install && grep -c "onStationAdded" node_modules/track-layout/dist/stations/station-manager.d.ts && grep -n "track-layout" bun.lock | cut -c1-90
```

Expected:

- `package.json` names the tarball: `../track-layout/.pack/track-layout-local.tgz` in the cloud session, `../../track/main/.pack/track-layout-local.tgz` on the owner's Mac.
- `1`.
- Exactly two `bun.lock` lines mention `track-layout`, both with the tarball path.

Then `tcount`. Expected: still `733 pass`, `0 fail`. The new version only adds to the API.

- [ ] **Step 3: Write the failing tests**

Create `test/station-render-wiring.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import {
    ELEVATION,
    StationManager,
    type TrackAlignedPlatform,
    TrackAlignedPlatformManager,
} from 'track-layout';

import { wireStationRenderers } from '../src/stations/station-render-wiring';

function station(elevation: ELEVATION = ELEVATION.GROUND) {
    return {
        name: 'Station',
        position: { x: 0, y: 0 },
        elevation,
        platforms: [],
        trackSegments: [],
        joints: [],
        trackAlignedPlatforms: [] as number[],
    };
}

function platformFor(stationId: number): Omit<TrackAlignedPlatform, 'id'> {
    return {
        stationId,
        spine: [{ trackSegment: 0, tStart: 0, tEnd: 1, side: 1 }],
        offset: 2,
        outerVertices: [{ x: 0, y: 5 }],
        stopPositions: [],
    };
}

/** Real managers wired to renderers that record their calls. */
function setup() {
    const stations = new StationManager();
    const platforms = new TrackAlignedPlatformManager();
    const calls: string[] = [];
    const unwire = wireStationRenderers(
        stations,
        platforms,
        {
            addStation: id => calls.push(`addStation ${id}`),
            removeStation: id => calls.push(`removeStation ${id}`),
        },
        {
            addPlatform: (id, elevation) =>
                calls.push(`addPlatform ${id} at ${elevation}`),
            removePlatform: id => calls.push(`removePlatform ${id}`),
        }
    );
    return { stations, platforms, calls, unwire };
}

describe('wireStationRenderers', () => {
    it('draws a station when it is created and removes it when destroyed', () => {
        const { stations, calls } = setup();
        const id = stations.createStation(station());
        stations.destroyStation(id);
        expect(calls).toEqual([`addStation ${id}`, `removeStation ${id}`]);
    });

    it('draws a platform at its station’s elevation', () => {
        const { stations, platforms, calls } = setup();
        const stationId = stations.createStation(station(ELEVATION.ABOVE_1));
        const id = platforms.createPlatform(platformFor(stationId));
        const orphan = platforms.createPlatform(platformFor(99));
        expect(calls.slice(1)).toEqual([
            `addPlatform ${id} at ${ELEVATION.ABOVE_1}`,
            `addPlatform ${orphan} at 0`,
        ]);
    });

    it('removes a deleted station’s platforms, then the station', () => {
        const { stations, platforms, calls } = setup();
        stations.setOnDestroyStation(stationId => {
            for (const { id } of platforms.getPlatformsByStation(stationId)) {
                platforms.destroyPlatform(id);
            }
        });
        const stationId = stations.createStation(station());
        const p1 = platforms.createPlatform(platformFor(stationId));
        const p2 = platforms.createPlatform(platformFor(stationId));
        calls.length = 0;

        stations.destroyStation(stationId);
        expect(calls).toEqual([
            `removePlatform ${p1}`,
            `removePlatform ${p2}`,
            `removeStation ${stationId}`,
        ]);
    });

    it('swaps the visuals once each when a scene load replaces the stations', () => {
        const { stations, platforms, calls } = setup();
        stations.setOnDestroyStation(stationId => {
            for (const { id } of platforms.getPlatformsByStation(stationId)) {
                platforms.destroyPlatform(id);
            }
        });
        const old = stations.createStation(station());
        const oldPlatform = platforms.createPlatform(platformFor(old));
        calls.length = 0;

        // The order scene-serialization.ts replaces them in.
        for (const { id } of stations.getStations())
            stations.destroyStation(id);
        for (const { id } of platforms.getAllPlatforms()) {
            platforms.destroyPlatform(id);
        }
        stations.createStationWithId(4, {
            ...station(ELEVATION.ABOVE_1),
            id: 4,
        });
        platforms.createPlatformWithId(9, platformFor(4));

        expect(calls).toEqual([
            `removePlatform ${oldPlatform}`,
            `removeStation ${old}`,
            'addStation 4',
            `addPlatform 9 at ${ELEVATION.ABOVE_1}`,
        ]);
    });

    it('stops drawing once unwired', () => {
        const { stations, platforms, calls, unwire } = setup();
        unwire();
        const stationId = stations.createStation(station());
        platforms.destroyPlatform(
            platforms.createPlatform(platformFor(stationId))
        );
        stations.destroyStation(stationId);
        expect(calls).toEqual([]);
    });
});
```

Create `test/station-hint-translations.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import {
    DUAL_SPINE_HINT_KEYS,
    SINGLE_SPINE_HINT_KEYS,
} from 'track-layout/station-placement';

import en from '../src/i18n/locales/en';
import ja from '../src/i18n/locales/ja';
import zhTW from '../src/i18n/locales/zh-TW';

describe('station placement hint translations', () => {
    for (const [locale, { translation }] of Object.entries({
        en,
        ja,
        'zh-TW': zhTW,
    })) {
        it(`${locale} translates every hint key`, () => {
            for (const key of [
                ...SINGLE_SPINE_HINT_KEYS,
                ...DUAL_SPINE_HINT_KEYS,
            ]) {
                expect(translation).toHaveProperty(key);
            }
        });
    }
});
```

Run: `bun test test/station-render-wiring.test.ts test/station-hint-translations.test.ts`
Expected:

- the wiring tests FAIL with `Cannot find module '../src/stations/station-render-wiring'`
- the 3 translation tests pass. Every key is already translated in `en`, `ja` and `zh-TW`; the test guards it from now on.

- [ ] **Step 4: Write `src/stations/station-render-wiring.ts`**

It subscribes:

- `onStationAdded` → `addStation(id)`
- `onStationRemoved` → `removeStation(id)`
- `onPlatformAdded` → `addPlatform(id, elevation)`, where `elevation` is the platform's station's elevation, or `0` when the platform or station can't be found. That's the lookup `scene-serialization.ts` does today.
- `onPlatformRemoved` → `removePlatform(id)`

It returns one function that calls all four unsubscribers. Import the two render-system types with `import type`, so the tests don't load Pixi.

- [ ] **Step 5: Format, typecheck, test**

```bash
cd "$BN" && bun run format >/dev/null && bun run format:check | tail -1 \
  && bunx tsc --noEmit -p tsconfig.json 2>&1 | grep "error TS" | sed -E 's/\(([0-9]+),[0-9]+\).*//' | sort | uniq -c; tcount
```

Expected:

- Prettier is clean.
- The **9** errors listed in Global Constraints.
- `741 pass`, `0 fail`, `Ran 741 tests across 56 files`.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock src/stations/station-render-wiring.ts test/station-render-wiring.test.ts test/station-hint-translations.test.ts && git commit -m "feat(stations): draw stations and platforms from manager events" -m "Installs the locally packed track-layout 0.3.0 and adds wireStationRenderers, which subscribes the station and platform renderers to the managers' new add and remove events. A test checks that every station placement hint key is translated."
```

---

### Task 9 (banana): Switch banana to `track-layout/station-placement`

**Files:**

- Delete: BN `src/stations/station-placement-state-machine.ts`, `src/stations/single-spine-placement-state-machine.ts`, `src/stations/dual-spine-placement-state-machine.ts`
- Modify:
    - BN `src/utils/init-app.ts`
    - `src/trains/input-state-machine/tool-switcher-state-machine.ts`, `src/trains/input-state-machine/kmt-state-machine-extension.ts`
    - `src/scene-serialization.ts`
    - `src/components/toolbar/BananaToolbar.tsx`, `src/components/toolbar/StationListPanel.tsx`
    - `src/stations/station-render-system.ts`, `src/stations/track-aligned-platform-render-system.ts`

**Interfaces:**

- Consumes the Task 2 constructors, `createStationPlacementStateMachine`, the preview interfaces, and `wireStationRenderers` from Task 8.

- [ ] **Step 1: Delete the moved files.** Do this before repointing; otherwise the script rewrites them too.

```bash
cd "$BN" && git rm -q src/stations/station-placement-state-machine.ts src/stations/single-spine-placement-state-machine.ts src/stations/dual-spine-placement-state-machine.ts
```

- [ ] **Step 2: Repoint imports**

Run: `bun "$TL/scripts/repoint-banana-imports.ts" "$BN"`
Expected:

- It repoints 3 files: `kmt-state-machine-extension.ts`, `tool-switcher-state-machine.ts` and `init-app.ts`.
- `done; 3 file(s) changed`.
- Their imports of the three modules now come from `'track-layout/station-placement'`.

- [ ] **Step 3: Rewire `init-app.ts`**

Merge the three repointed imports into one, and add the helper and the gauge store.

In `src/utils/init-app.ts`, replace:

```ts
import {
    DualSpinePlacementEngine,
    createDualSpinePlacementStateMachine,
} from 'track-layout/station-placement';
import {
    SingleSpinePlacementEngine,
    createSingleSpinePlacementStateMachine,
} from 'track-layout/station-placement';
import {
    StationPlacementEngine,
    StationPlacementStateMachine,
} from 'track-layout/station-placement';
import { StationRenderSystem } from '@/stations/station-render-system';
```

with:

```ts
import {
    DualSpinePlacementEngine,
    SingleSpinePlacementEngine,
    StationPlacementEngine,
    createDualSpinePlacementStateMachine,
    createSingleSpinePlacementStateMachine,
    createStationPlacementStateMachine,
} from 'track-layout/station-placement';
import { StationRenderSystem } from '@/stations/station-render-system';
import { wireStationRenderers } from '@/stations/station-render-wiring';
import { useGaugeStore } from '@/stores/gauge-store';
```

Wire the renderers right after they're created.

In `src/utils/init-app.ts`, replace:

```ts
    trackGraph.setSegmentProtectionCheck(segNum => {
```

with:

```ts
    baseComponents.cleanups.push(
        wireStationRenderers(
            stationManager,
            trackAlignedPlatformManager,
            stationRenderSystem,
            trackAlignedPlatformRenderSystem
        )
    );

    trackGraph.setSegmentProtectionCheck(segNum => {
```

In `src/utils/init-app.ts`, replace:

```ts
    const stationPlacementEngine = new StationPlacementEngine(
        baseComponents.canvasProxy,
        trackGraph,
        baseComponents.camera,
        stationManager,
        stationRenderSystem
    );
    const stationStateMachine = new StationPlacementStateMachine(
        stationPlacementEngine
    );
```

with:

```ts
    const stationPlacementEngine = new StationPlacementEngine(
        trackGraph,
        windowToWorld,
        stationManager,
        stationRenderSystem,
        () => useGaugeStore.getState().currentGauge
    );
    const stationStateMachine = createStationPlacementStateMachine(
        stationPlacementEngine
    );
```

In `src/utils/init-app.ts`, replace:

```ts
new SingleSpinePlacementEngine(
        baseComponents.canvasProxy,
        trackGraph,
        baseComponents.camera,
        stationManager,
```

with:

```ts
new SingleSpinePlacementEngine(
        trackGraph,
        windowToWorld,
        stationManager,
```

In `src/utils/init-app.ts`, replace:

```ts
new DualSpinePlacementEngine(
        baseComponents.canvasProxy,
        trackGraph,
        baseComponents.camera,
        stationManager,
```

with:

```ts
new DualSpinePlacementEngine(
        trackGraph,
        windowToWorld,
        stationManager,
```

The station-delete cascade no longer removes platform visuals by hand.

In `src/utils/init-app.ts`, replace:

```ts
            // will handle resource cleanup. We only need the render removal +
            // entity destruction here.
```

with:

```ts
            // will handle resource cleanup. We only need the entity destruction
            // here; its removal event takes the platform's visuals away.
```

In `src/utils/init-app.ts`, delete:

```ts
            trackAlignedPlatformRenderSystem.removePlatform(id);
```

- [ ] **Step 4: Delete the manual renderer calls the events now cover.** First, scene load.

In `src/scene-serialization.ts`, delete:

```ts
            app.stationRenderSystem.removeStation(id);
```

In `src/scene-serialization.ts`, delete:

```ts
            app.stationRenderSystem.addStation(id);
```

In `src/scene-serialization.ts`, delete:

```ts
            app.trackAlignedPlatformRenderSystem.removePlatform(id);
```

In `src/scene-serialization.ts`, delete:

```ts
            const elevation =
                app.stationManager.getStation(platform.stationId)?.elevation ??
                0;
            app.trackAlignedPlatformRenderSystem.addPlatform(id, elevation);
```

Track import:

In `src/components/toolbar/BananaToolbar.tsx`, delete:

```ts
                    app.stationRenderSystem.removeStation(id);
```

In `src/components/toolbar/BananaToolbar.tsx`, delete:

```ts
                    app.stationRenderSystem.addStation(id);
```

The station list's delete and create. `reassignPlatform`'s `removeStation`/`addStation` pairs stay: they redraw stations that still exist, which no event covers.

In `src/components/toolbar/StationListPanel.tsx`, replace:

```ts
        stationRenderSystem.removeStation(id);
        stationManager.destroyStation(id);
        if (pickingForStation === id)
```

with:

```ts
        stationManager.destroyStation(id);
        if (pickingForStation === id)
```

In `src/components/toolbar/StationListPanel.tsx`, replace:

```ts
        const stationId = stationManager.createStation({
            name: 'Station',
            position: { x: pos.x, y: pos.y },
```

with:

```ts
        stationManager.createStation({
            name: 'Station',
            position: { x: pos.x, y: pos.y },
```

In `src/components/toolbar/StationListPanel.tsx`, delete:

```ts
        stationRenderSystem.addStation(stationId);
```

- [ ] **Step 5: The renderers implement the preview interfaces**

In `src/stations/station-render-system.ts`, replace:

```ts
import type { Platform } from 'track-layout';
```

with:

```ts
import type { Platform } from 'track-layout';
import type { StationPlacementPreview } from 'track-layout/station-placement';
```

In `src/stations/station-render-system.ts`, replace:

```ts
export class StationRenderSystem {
```

with:

```ts
export class StationRenderSystem implements StationPlacementPreview {
```

In `src/stations/track-aligned-platform-render-system.ts`, replace:

```ts
import type { TrackAlignedPlatform } from 'track-layout';
```

with:

```ts
import type { TrackAlignedPlatform } from 'track-layout';
import type {
    DualSpinePlacementPreview,
    SingleSpinePlacementPreview,
} from 'track-layout/station-placement';
```

In `src/stations/track-aligned-platform-render-system.ts`, replace:

```ts
export class TrackAlignedPlatformRenderSystem {
```

with:

```ts
export class TrackAlignedPlatformRenderSystem
    implements SingleSpinePlacementPreview, DualSpinePlacementPreview
{
```

Nothing calls `showCapPairingPreview` any more.

In `src/stations/track-aligned-platform-render-system.ts`, delete from the line `    /**` that opens the comment `     * Show the cap-pairing preview: both spines plus connection lines showing` up to, but not including, the line `    /**` that opens the comment `     * Overlay on top of the current preview: a trailing line from the last cap`.

- [ ] **Step 6: Format and verify**

```bash
cd "$BN" && bun run format >/dev/null && bun run format:check | tail -1 \
  && bunx tsc --noEmit -p tsconfig.json 2>&1 | grep "error TS" | sed -E 's/\(([0-9]+),[0-9]+\).*//' | sort | uniq -c; tcount; bun run build 2>&1 | grep -E "built in|error" \
  ; grep -rn "showCapPairingPreview\|RenderSystem\.\(add\|remove\)Platform" src; grep -rn "stationRenderSystem\.\(add\|remove\)Station" src | cut -c1-90
```

Expected:

- Prettier is clean.
- Exactly the **9** errors listed in Global Constraints.
- `741 pass`, `0 fail`.
- `✓ built in …`.
- The `Platform` grep finds only `station-render-wiring.ts`. The `Station` grep finds only `station-render-wiring.ts` and `reassignPlatform`'s four calls in `StationListPanel.tsx`.

- [ ] **Step 7: Commit**

```bash
git add -A src && git commit -m "refactor: use track-layout/station-placement for station placement" -m "Deletes banana's copies of the island, single-spine and dual-spine placement tools and imports them from track-layout/station-placement. init-app builds the engines with the window-to-world converter, the render systems as previews and a gauge getter, and wires the renderers to the manager events. The manual add and remove calls the events now cover are gone, except reassignPlatform's redraw. The render systems implement the preview interfaces, and the unused showCapPairingPreview goes."
```

---

### Task 10: Verification gate, release 0.3.0, pin it in banana

**Files:**

- Modify: BN `package.json`, `bun.lock`

- [ ] **Step 1: Full `track-layout` check**

```bash
cd "$TL" && bun run format:check | tail -1 && bun run typecheck && tcount && bun run build >/dev/null && bun pm pack --dry-run 2>&1 | grep "Total files" && git status --short
```

Expected:

- Prettier is clean, and so is the typecheck.
- `378 pass`, `0 fail`, `Ran 378 tests across 36 files`.
- `Total files: 123`.
- A clean tree, with `bun.lock` unchanged.

- [ ] **Step 2: Full banana check**

```bash
cd "$BN" && bun run format:check | tail -1 && bunx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"; tcount; bun run build 2>&1 | grep "built in"
```

Expected: Prettier is clean, then `9`, then `741 pass` and `0 fail`, then `✓ built in …`.

- [ ] **Step 3: Owner go-ahead to push both branches (STOP and ask).** On a yes, push both: `git -C "$TL" push -u origin feat/phase-3-station-placement` and `git -C "$BN" push -u origin feat/track-layout-phase-3`.

- [ ] **Step 4: Owner play-test (STOP and ask)**

The owner checks out both branches on their machine. banana's committed tarball path is the executor's, so the owner repeats Task 8 Steps 1–2 with their own `TL` and `BN`, without committing, then runs `bun run dev` in banana. They check:

- Place an island station by dragging; it draws with the toolbar's current gauge.
- Single-spine: the track highlight follows the cursor's side. Pick a start and an end, then draw outer vertices; clicking the start anchor creates the platform.
- Dual-spine: pick both spines and draw both caps (pairing is automatic). Two platforms appear.
- Hint toasts appear at each step, in the current language.
- Edit stop positions on a new platform.
- From the station list: create an empty station, delete a station (its platforms disappear too), and reassign an island platform between stations.
- Import track data with stations.
- Save, reload the page, and load the scene. Stations and platforms are drawn once each, at the right elevation.
- Branching off the middle of a platform's track is still refused.

Continue only after the owner confirms.

- [ ] **Step 5: Open the track-layout PR (STOP and ask).** With the owner's go-ahead:
    1. Open a PR from `feat/phase-3-station-placement` to `main`. CI runs format, typecheck, tests and build.
    2. The owner merges it.

- [ ] **Step 6: Release 0.3.0 (STOP and ask).** With the owner's go-ahead, on `main`:
    1. Run the **Release** workflow with `dry-run` checked and `auto` as the bump. Its log should bump to `0.3.0`, because there are `feat` commits since `v0.2.0`.
    2. Then run it again for real.

    Verify with `curl -s https://registry.npmjs.org/track-layout | grep -o '"latest":"[^"]*"'`, which should print `"latest":"0.3.0"`.

- [ ] **Step 7: Pin the published version in banana**

```bash
cd "$BN" && perl -pi -e 's#"track-layout": "[^"]*\.pack/track-layout-local\.tgz"#"track-layout": "^0.3.0"#' package.json && bun install \
  && grep -n '"track-layout"' package.json && grep '"version"' node_modules/track-layout/package.json && grep -c "\.pack" package.json bun.lock; tcount; bun run build 2>&1 | grep "built in"
```

Expected:

- `"track-layout": "^0.3.0"`, and `"version": "0.3.0"` in `node_modules`.
- `0` `.pack` mentions in both files.
- `741 pass`, `0 fail`, then `✓ built in …`.

- [ ] **Step 8: Commit, push and open banana's PR (STOP and ask before the push and the PR)**

```bash
git add package.json bun.lock && git commit -m "chore(deps): use published track-layout 0.3.0"
```

With the owner's go-ahead, push `feat/track-layout-phase-3` and open its PR against `main`.

- [ ] **Step 9: Hand off**

Report:

- track-layout 0.3.0 is published, from TL `feat/phase-3-station-placement` (378 tests).
- BN `feat/track-layout-phase-3` has 741 tests and 9 type errors, and its PR is open.
- The spec's known issues stay out of scope.

Merging banana's PR is the owner's decision; offer superpowers:finishing-a-development-branch.
