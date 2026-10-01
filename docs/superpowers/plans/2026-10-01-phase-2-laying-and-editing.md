# track-layout Phase 2 (Laying and Editing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move banana's track-laying and editing logic into `track-layout` and export it as `track-layout/editing` (0.2.0). That logic is the preview-curve calculator, the curve engine, and the layout, joint-direction, duplicate-to-side and catenary tools. Then switch banana over.

**Architecture:** Lift and decouple, as in phase 1. The 10 files are copied from banana `92ca5a3` by the existing porting script, extended so that it maps the bare `'track-layout'` import to the package's own root. The changes come after the copy, each with tests:
- the joint-direction factory takes its context
- the engine takes the graph plus a window-to-world converter instead of extending the board's input tracker
- the unused `convert2WindowPosition` goes
- `insertJointIntoTrackSegment` returns `number | null`
- the whole-graph console dumps go

Banana builds the converter with a new helper, owns the graph, and imports from `track-layout/editing`.

**Tech Stack:** Bun 1.3, TypeScript 5.8 (`bundler` resolution, `.js` specifiers), Prettier 3, `@ue-too/being|board|curve|math` 0.19 (being becomes an optional peer), banana: React/Vite/Pixi 8.20.1.

**Spec:** `docs/superpowers/specs/2026-10-01-track-layout-phase-2-editing-design.md`. Its parent is `docs/superpowers/specs/2026-10-01-track-layout-extraction-design.md`. Read the phase 2 spec first.

## Global Constraints

- **Entry point:** `track-layout/editing`, a new subpath. The package root (`track-layout`) does not re-export the editing modules.
- **Peer dependency:** `@ue-too/being ^0.19.0`, marked optional in `peerDependenciesMeta`. Dev dependency `@ue-too/being 0.19.0`. The other `@ue-too` peers are unchanged (`^0.19.0`).
- **Release:** `track-layout` 0.2.0.
- **Bun only** (never npm, pnpm, yarn or node to install or run). Tests import from `bun:test`.
- **TypeScript:** `moduleResolution: "bundler"`. Relative imports in `track-layout` end in `.js`. Inside the package, editing files import the model from `'../index.js'`, never from `'track-layout'`.
- **`src/editing/` may import:** each other, `../index.js` and `@ue-too/*`. Nothing else: no Pixi, React, zustand, banana code, DOM or canvas.
- **Prettier:** 4-space indent, single quotes, `es5` trailing commas, width 80, sorted imports. Run `bun run format` before every commit; `bun run format:check` must pass.
- **`@ue-too/being` 0.19 events:** events with an empty payload are sent with no payload argument (`machine.happens('startLayout')`, not `happens('startLayout', {})`).
- **Expected numbers in `track-layout`:** `bun test` grows 275 → 280 → 282 → 316 → 319 → 320, and `bun run typecheck` is clean after every task.
- **Expected numbers in banana:** `bun test` is 734 at the start, 737 after Task 6 and 732 after Task 7. `bunx tsc --noEmit -p tsconfig.json` reports 11 errors before Task 7 and 9 after: the 2 in `joint-direction-state-machine.ts` leave with the file. The 9 that remain are:
  - `BananaToolbar.tsx` ×2
  - `DepotPanel.tsx` ×1
  - `train-editor-tool-switcher.ts` ×2
  - `train-editor-toolbar.tsx` ×2
  - `init-app.ts` ×2, "Cannot find name 'result'"
- **No outward actions without the owner's go-ahead:** don't publish to npm, push, or open PRs.

## Conventions

- **TL** = `/Users/vincent.yy.chang/dev/track/main` (`track-layout`), on branch `feat/phase-2-editing`, which already exists and holds the spec. **BN** = `/Users/vincent.yy.chang/dev/banana/main`.
- **Commits** are conventional, and every commit message ends with the co-author trailer your harness specifies.
- **"Replace X with Y"** means an exact-text replacement where X occurs exactly once (unless the step gives another count). If X isn't found, stop and report. Don't improvise.
- **Characterization tests** record what the code does today. If one fails against code the task didn't change, fix the expectation, never the code, and say so in the commit message.
- **TL scratch:** the git-ignored `.superpowers/` folder is build-process scratch. Never commit, format or edit it.

## File Structure

**track-layout (TL):**
- **Modify:**
  - `scripts/banana-module-map.ts`: adds the editing modules, `PACKAGE_MAP` and `entryPointFor`
  - `scripts/port-from-banana.ts`: maps package specifiers via `PACKAGE_MAP`
  - `scripts/repoint-banana-imports.ts`: repoints to `track-layout/editing` or `track-layout`
  - `package.json`: `./editing` export, `@ue-too/being` as an optional peer and a dev dependency
  - `README.md`
- **Create (ported):** in `src/editing/`, the files `new-joint.ts`, `duplicate-geometry.ts`, `types.ts`, `curve-engine.ts`, `layout-kmt-state-machine.ts` (gains `createLayoutStateMachine`), `joint-direction-state-machine.ts`, `duplicate-to-side-engine.ts`, `duplicate-to-side-state-machine.ts`, `catenary-layout-engine.ts`, `catenary-layout-state-machine.ts`; plus `test/duplicate-geometry.test.ts`.
- **Create (new):**
  - `src/editing/index.ts`
  - `test/curve-engine.test.ts`, `test/preview-curve-calculator.test.ts`, `test/editing-state-machines.test.ts`, `test/editing-entry.test.ts`

**banana (BN)**, on the new branch `feat/track-layout-phase-2`:
- **Create:** `src/utils/window-to-world.ts`, `test/window-to-world.test.ts`
- **Delete:** the 10 moved source files, `src/trains/input-state-machine/utils/` and `test/duplicate-geometry.test.ts`
- **Modify:**
  - `package.json`, `bun.lock`
  - `src/trains/tracks/index.ts`, `src/trains/input-state-machine/index.ts`
  - `src/trains/input-state-machine/{tool-switcher-state-machine,kmt-state-machine-extension}.ts`
  - `src/trains/tracks/render-system.ts`
  - `src/utils/init-app.ts`
  - `src/components/toolbar/{BananaToolbar,TimetablePanel}.tsx`
  - `src/hooks/use-render-sync.ts`
  - `src/scene-serialization.ts`

---

### Task 1: Port the editing modules

**Files:**
- Modify: `scripts/banana-module-map.ts`, `scripts/port-from-banana.ts`, `scripts/repoint-banana-imports.ts`, `package.json` (dev dependency)
- Port: the 10 `src/editing/*.ts` files and `test/duplicate-geometry.test.ts`
- Modify after porting: `src/editing/joint-direction-state-machine.ts`, `src/editing/layout-kmt-state-machine.ts`
- Create: `src/editing/index.ts`

**Interfaces:**
- Produces (from `scripts/banana-module-map.ts`):
  - `PACKAGE_MAP: Record<string, string>`, which maps `'track-layout'` to `'src/index'`
  - `entryPointFor(moduleId: string): string`, which returns `'track-layout/editing'` for `src/editing/*` modules and `'track-layout'` otherwise
- Produces:
  - `createJointDirectionStateMachine(context: JointDirectionContext): JointDirectionStateMachine`
  - `createLayoutStateMachine(context: LayoutContext): LayoutStateMachine`, exported from `src/editing/layout-kmt-state-machine.ts`
  - everything else as in banana `92ca5a3`

- [ ] **Step 1: Confirm the starting point**

```bash
cd /Users/vincent.yy.chang/dev/track/main && git branch --show-current && git status --short && bun test 2>&1 | grep -E "^ *[0-9]+ (pass|fail)"
git -C /Users/vincent.yy.chang/dev/banana/main fetch -q origin && git -C /Users/vincent.yy.chang/dev/banana/main checkout -q main && git -C /Users/vincent.yy.chang/dev/banana/main pull -q && git -C /Users/vincent.yy.chang/dev/banana/main log --oneline -1
```

Expected:
- `feat/phase-2-editing`, with a clean tree.
- `275 pass`, `0 fail`.
- banana on `main` at `92ca5a3 refactor: use the track-layout package for the track and station model (#18)`, or a later commit. If it's later, check that the 10 files in Step 6 still exist.

- [ ] **Step 2: Extend `scripts/banana-module-map.ts`.** Replace:

```ts
    'src/stations/types': 'src/stations/types',
};
```

with:

```ts
    'src/stations/types': 'src/stations/types',
    'src/trains/tracks/new-joint': 'src/editing/new-joint',
    'src/trains/tracks/duplicate-geometry': 'src/editing/duplicate-geometry',
    'src/trains/input-state-machine/types': 'src/editing/types',
    'src/trains/input-state-machine/curve-engine': 'src/editing/curve-engine',
    'src/trains/input-state-machine/layout-kmt-state-machine':
        'src/editing/layout-kmt-state-machine',
    'src/trains/input-state-machine/joint-direction-state-machine':
        'src/editing/joint-direction-state-machine',
    'src/trains/input-state-machine/duplicate-to-side-engine':
        'src/editing/duplicate-to-side-engine',
    'src/trains/input-state-machine/duplicate-to-side-state-machine':
        'src/editing/duplicate-to-side-state-machine',
    'src/trains/input-state-machine/catenary-layout-engine':
        'src/editing/catenary-layout-engine',
    'src/trains/input-state-machine/catenary-layout-state-machine':
        'src/editing/catenary-layout-state-machine',
};

/**
 * Package specifiers that banana files import, mapped to the track-layout
 * module each one resolves to inside this repo.
 */
export const PACKAGE_MAP: Record<string, string> = {
    'track-layout': 'src/index',
};

/** The package entry point that exposes a track-layout module. */
export function entryPointFor(moduleId: string): string {
    return moduleId.startsWith('src/editing/')
        ? 'track-layout/editing'
        : 'track-layout';
}
```

- [ ] **Step 3: Teach `scripts/port-from-banana.ts` about package specifiers**

Replace:

```ts
import { MODULE_MAP } from './banana-module-map.js';
```

with:

```ts
import { MODULE_MAP, PACKAGE_MAP } from './banana-module-map.js';
```

Replace:

```ts
    } else if (specifier.startsWith('.')) {
        target = resolve(dirname(sourceFile), specifier);
    } else {
        return specifier;
    }
```

with:

```ts
    } else if (specifier.startsWith('.')) {
        target = resolve(dirname(sourceFile), specifier);
    } else if (specifier in PACKAGE_MAP) {
        return relativeSpecifier(destFile, PACKAGE_MAP[specifier]);
    } else {
        return specifier;
    }
```

Replace:

```ts
    const mapped = MODULE_MAP[moduleId];
    if (mapped === undefined) {
        unmapped.push(specifier);
        return specifier;
    }
    let rewritten = toPosix(
        relative(dirname(destFile), join(REPO_ROOT, mapped))
    );
    if (!rewritten.startsWith('.')) {
        rewritten = `./${rewritten}`;
    }
    return `${rewritten}.js`;
}
```

with:

```ts
    const mapped = MODULE_MAP[moduleId];
    if (mapped === undefined) {
        unmapped.push(specifier);
        return specifier;
    }
    return relativeSpecifier(destFile, mapped);
}

/** A relative `.js` specifier from `destFile` to a repo module id. */
function relativeSpecifier(destFile: string, moduleId: string): string {
    let rewritten = toPosix(
        relative(dirname(destFile), join(REPO_ROOT, moduleId))
    );
    if (!rewritten.startsWith('.')) {
        rewritten = `./${rewritten}`;
    }
    return `${rewritten}.js`;
}
```

Then update its header comment. Replace:

```ts
 * Relative and `@/` specifiers that resolve to a module in MODULE_MAP are
 * rewritten. Package specifiers (e.g. `@ue-too/curve`) are left alone. Any
 * other specifier is left as-is and reported as UNMAPPED so it can be
 * handled by hand.
```

with:

```ts
 * Relative and `@/` specifiers that resolve to a module in MODULE_MAP, and
 * package specifiers listed in PACKAGE_MAP (`track-layout` itself), are
 * rewritten. Other package specifiers (e.g. `@ue-too/curve`) are left alone.
 * Any other specifier is left as-is and reported as UNMAPPED so it can be
 * handled by hand.
```

- [ ] **Step 4: Teach `scripts/repoint-banana-imports.ts` the editing entry point**

Replace:

```ts
import { MODULE_MAP } from './banana-module-map.js';

const PACKAGE_NAME = 'track-layout';
```

with:

```ts
import { MODULE_MAP, entryPointFor } from './banana-module-map.js';
```

Replace:

```ts
                return `${keyword}${space}${clause}${fromPart}${quote}${PACKAGE_NAME}${quote}`;
```

with:

```ts
                const entryPoint = entryPointFor(MODULE_MAP[moduleId]!);
                return `${keyword}${space}${clause}${fromPart}${quote}${entryPoint}${quote}`;
```

Replace:

```ts
 * Rewrites imports in a banana checkout so that modules which moved to
 * track-layout are imported from the `track-layout` package instead.
```

with:

```ts
 * Rewrites imports in a banana checkout so that modules which moved to
 * track-layout are imported from the package instead: `track-layout/editing`
 * for modules under src/editing/, `track-layout` for everything else.
```

- [ ] **Step 5: Add `@ue-too/being` as a dev dependency**

Run: `bun add -d @ue-too/being@0.19.0 && grep -n '"@ue-too/being"' package.json`
Expected: `"@ue-too/being": "0.19.0"` under `devDependencies`. The peer entry comes in Task 5.

- [ ] **Step 6: Port the files**

```bash
cd /Users/vincent.yy.chang/dev/track/main && bun scripts/port-from-banana.ts /Users/vincent.yy.chang/dev/banana/main \
  src/trains/tracks/new-joint.ts=src/editing/new-joint.ts \
  src/trains/tracks/duplicate-geometry.ts=src/editing/duplicate-geometry.ts \
  src/trains/input-state-machine/types.ts=src/editing/types.ts \
  src/trains/input-state-machine/curve-engine.ts=src/editing/curve-engine.ts \
  src/trains/input-state-machine/layout-kmt-state-machine.ts=src/editing/layout-kmt-state-machine.ts \
  src/trains/input-state-machine/joint-direction-state-machine.ts=src/editing/joint-direction-state-machine.ts \
  src/trains/input-state-machine/duplicate-to-side-engine.ts=src/editing/duplicate-to-side-engine.ts \
  src/trains/input-state-machine/duplicate-to-side-state-machine.ts=src/editing/duplicate-to-side-state-machine.ts \
  src/trains/input-state-machine/catenary-layout-engine.ts=src/editing/catenary-layout-engine.ts \
  src/trains/input-state-machine/catenary-layout-state-machine.ts=src/editing/catenary-layout-state-machine.ts \
  test/duplicate-geometry.test.ts=test/duplicate-geometry.test.ts \
  && grep -l "from 'track-layout'" src/editing/*.ts test/duplicate-geometry.test.ts; echo "exit=$?"
```

Expected: eleven `ported …` lines, then `done; 0 unmapped specifier(s)`. The `grep -l` finds nothing (`exit=1`), because every `'track-layout'` import became `'../index.js'`.

- [ ] **Step 7: The joint-direction factory takes its context**

This is change 3. The verbatim factory builds its machine with a stub `{ setup, cleanup }` context that lacks the required members, so the package wouldn't typecheck.

In `src/editing/joint-direction-state-machine.ts`, replace:

```ts
export function createJointDirectionStateMachine(): JointDirectionStateMachine {
```

with:

```ts
export function createJointDirectionStateMachine(
    context: JointDirectionContext
): JointDirectionStateMachine {
```

and replace:

```ts
        'IDLE',
        {
            setup: () => {},
            cleanup: () => {},
        }
    );
}
```

with:

```ts
        'IDLE',
        context
    );
}
```

- [ ] **Step 8: Add `createLayoutStateMachine`**

It moves from banana's `input-state-machine/utils/factory.ts`, which banana deletes in Task 7. In `src/editing/layout-kmt-state-machine.ts`, replace:

```ts
import { NO_OP, TemplateState } from '@ue-too/being';
```

with:

```ts
import { NO_OP, TemplateState, TemplateStateMachine } from '@ue-too/being';
```

and replace:

```ts
export type LayoutStateMachine = StateMachine<
    LayoutEvents,
    LayoutContext,
    LayoutStates
>;
```

with:

```ts
export type LayoutStateMachine = StateMachine<
    LayoutEvents,
    LayoutContext,
    LayoutStates
>;

/**
 * Creates the layout tool's state machine. The context is usually a
 * CurveCreationEngine.
 */
export function createLayoutStateMachine(
    context: LayoutContext
): LayoutStateMachine {
    return new TemplateStateMachine<LayoutEvents, LayoutContext, LayoutStates>(
        {
            IDLE: new LayoutIDLEState(),
            HOVER_FOR_STARTING_POINT: new LayoutHoverForStartingPointState(),
            HOVER_FOR_ENDING_POINT: new LayoutHoverForEndingPointState(),
            HOVER_FOR_CURVE_DELETION: new LayoutHoverForCurveDeletionState(),
        },
        'IDLE',
        context
    );
}
```

- [ ] **Step 9: Write `src/editing/index.ts`**

```ts
export * from './catenary-layout-engine.js';
export * from './catenary-layout-state-machine.js';
export * from './curve-engine.js';
export * from './duplicate-geometry.js';
export * from './duplicate-to-side-engine.js';
export * from './duplicate-to-side-state-machine.js';
export * from './joint-direction-state-machine.js';
export * from './layout-kmt-state-machine.js';
export * from './new-joint.js';
export * from './types.js';
```

- [ ] **Step 10: Format, typecheck, test**

Run: `bun run format && bun run format:check && bun run typecheck && bun test 2>&1 | grep -E "^ *[0-9]+ (pass|fail)|^Ran"`
Expected:
- Prettier is clean, and the typecheck prints nothing. Without Step 7 it would report two errors in `joint-direction-state-machine.ts`.
- `280 pass`, `0 fail`, `Ran 280 tests across 24 files`.

- [ ] **Step 11: Commit**

```bash
git add -A && git commit -m "feat(editing): port the laying and editing modules" -m "Ported from banana 92ca5a3: the preview-curve calculator, curve engine, layout, joint-direction, duplicate-to-side and catenary tools, duplicate geometry, and createLayoutStateMachine (from banana's input-state-machine/utils/factory.ts). The joint-direction factory now takes its context, which the package's typecheck requires. The porting scripts learn PACKAGE_MAP and the track-layout/editing entry point."
```

---

### Task 2: The engine takes its graph and a coordinate converter

This is changes 1 and 2 of the spec.

**Files:**
- Create: `test/curve-engine.test.ts`
- Modify: `src/editing/curve-engine.ts`, `src/editing/layout-kmt-state-machine.ts`

**Interfaces:**
- Produces:
  - `new CurveCreationEngine(trackGraph: TrackGraph, convertWindowToWorld: (position: Point) => Point)`
  - `CurveCreationEngine.convert2WorldPosition(p)`, which delegates to the converter
- Removed:
  - the `extends ObservableInputTracker` base, along with the canvas and camera
  - the `CurveCreationEngine.trackGraph` getter
  - `CurveCreationEngine.convert2WindowPosition` and `LayoutContext.convert2WindowPosition`

- [ ] **Step 1: Write the failing test** in `test/curve-engine.test.ts`

Tasks 3 and 4 extend this file.

```ts
import type { Point } from '@ue-too/math';
import { describe, expect, it } from 'bun:test';

import { CurveCreationEngine } from '../src/editing/curve-engine.js';
import { TrackGraph } from '../src/tracks/track.js';

/** An engine whose window coordinates are world coordinates. */
function setup() {
    const graph = new TrackGraph();
    const engine = new CurveCreationEngine(graph, position => ({
        ...position,
    }));
    return { graph, engine };
}

/** Lays one curve the way the layout tool does; returns endCurve's result. */
function lay(engine: CurveCreationEngine, from: Point, to: Point) {
    engine.hoverForStartingPoint(from);
    engine.startCurve();
    engine.hoveringForEndJoint(to);
    return engine.endCurve();
}

describe('CurveCreationEngine construction', () => {
    it('edits the graph it is given', () => {
        const { graph, engine } = setup();
        lay(engine, { x: 0, y: 0 }, { x: 100, y: 0 });
        expect(graph.trackSegments).toHaveLength(1);
    });

    it('converts window positions with the injected function', () => {
        const engine = new CurveCreationEngine(new TrackGraph(), p => ({
            x: p.x * 2,
            y: p.y + 1,
        }));
        expect(engine.convert2WorldPosition({ x: 3, y: 4 })).toEqual({
            x: 6,
            y: 5,
        });
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test test/curve-engine.test.ts`
Expected: `2 fail`.
- The first fails with `Expected length: 1 / Received length: 0`, because the engine creates and edits its own graph.
- The second fails because the conversion still goes through the canvas.

- [ ] **Step 3: Decouple the engine.** In `src/editing/curve-engine.ts`, replace:

```ts
import {
    Canvas,
    Observable,
    ObservableBoardCamera,
    ObservableInputTracker,
    Observer,
    SubscriptionOptions,
    SynchronousObservable,
    convertFromCanvas2ViewPort,
    convertFromCanvas2Window,
    convertFromViewPort2Canvas,
    convertFromViewport2World,
    convertFromWindow2Canvas,
    convertFromWorld2Viewport,
} from '@ue-too/board';
```

with:

```ts
import {
    Observable,
    Observer,
    SubscriptionOptions,
    SynchronousObservable,
} from '@ue-too/board';
```

Replace:

```ts
export class CurveCreationEngine
    extends ObservableInputTracker
    implements LayoutContext
{
    private _trackGraph: TrackGraph;
```

with:

```ts
export class CurveCreationEngine implements LayoutContext {
    private _trackGraph: TrackGraph;
    private _convertWindowToWorld: (position: Point) => Point;
```

Replace:

```ts
    private _camera: ObservableBoardCamera;

    constructor(canvas: Canvas, camera: ObservableBoardCamera) {
        super(canvas);
        this._trackGraph = new TrackGraph();
        this._camera = camera;
    }
```

with:

```ts
    /**
     * @param trackGraph - The graph this engine edits. The app owns it.
     * @param convertWindowToWorld - Converts a window (pointer) position to
     *   world coordinates.
     */
    constructor(
        trackGraph: TrackGraph,
        convertWindowToWorld: (position: Point) => Point
    ) {
        this._trackGraph = trackGraph;
        this._convertWindowToWorld = convertWindowToWorld;
    }
```

Delete the getter, including the blank line after it:

```ts
    get trackGraph(): TrackGraph {
        return this._trackGraph;
    }

```

Replace:

```ts
    // position is in raw window coordinates space
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

    // position is in the world space
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
}
```

with:

```ts
    /** Converts a window (pointer) position to world coordinates. */
    convert2WorldPosition(position: Point): Point {
        return this._convertWindowToWorld(position);
    }
}
```

- [ ] **Step 4: Drop `convert2WindowPosition` from `LayoutContext`.** In `src/editing/layout-kmt-state-machine.ts`, replace:

```ts
    convert2WorldPosition: (position: Point) => Point;
    convert2WindowPosition: (position: Point) => Point;
```

with:

```ts
    convert2WorldPosition: (position: Point) => Point;
```

- [ ] **Step 5: Run the tests**

Run: `bun test test/curve-engine.test.ts && bun run typecheck && bun test 2>&1 | grep -E "^ *[0-9]+ (pass|fail)"`
Expected: `2 pass` for the file, a clean typecheck, then `282 pass`, `0 fail`.

- [ ] **Step 6: Format and commit**

```bash
bun run format && bun run format:check \
  && git add -A && git commit -m "refactor(editing): the curve engine takes its graph and a window-to-world converter" -m "CurveCreationEngine no longer extends ObservableInputTracker or holds a canvas and camera; the app passes the TrackGraph and a convertWindowToWorld function. The trackGraph getter and the unused convert2WindowPosition (engine and LayoutContext) are removed."
```

---

### Task 3: Characterization tests for laying and the tool machines

These tests describe today's behaviour. They pass against the current code; nothing under `src/` changes in this task.

**Files:**
- Modify: `test/curve-engine.test.ts`
- Create: `test/preview-curve-calculator.test.ts`, `test/editing-state-machines.test.ts`

- [ ] **Step 1: Extend the imports of `test/curve-engine.test.ts`.** Replace:

```ts
import { CurveCreationEngine } from '../src/editing/curve-engine.js';
import { TrackGraph } from '../src/tracks/track.js';
```

with:

```ts
import {
    CurveCreationEngine,
    type DeletionHighlightState,
} from '../src/editing/curve-engine.js';
import { TrackGraph } from '../src/tracks/track.js';
import { ELEVATION } from '../src/tracks/types.js';
```

- [ ] **Step 2: Append to `test/curve-engine.test.ts`**

```ts
/** A straight A(0,0) — B(100,0) laid through the engine. */
function withStraightTrack() {
    const context = setup();
    lay(context.engine, { x: 0, y: 0 }, { x: 100, y: 0 });
    return context;
}

const counts = (graph: TrackGraph) => ({
    segments: graph.trackSegments.length,
    joints: graph.getJoints().length,
});

describe('CurveCreationEngine start-joint snapping', () => {
    it('starts a brand-new joint in empty space', () => {
        const { engine } = setup();
        engine.hoverForStartingPoint({ x: 0, y: 0 });
        expect(engine.newStartJointType?.type).toBe('new');
    });

    it('extends from a dead-end joint', () => {
        const { engine } = withStraightTrack();
        engine.hoverForStartingPoint({ x: 100, y: 0 });
        expect(engine.newStartJointType?.type).toBe('extendingTrack');
    });

    it('branches from the middle of a curve', () => {
        const { engine } = withStraightTrack();
        engine.hoverForStartingPoint({ x: 50, y: 0.2 });
        expect(engine.newStartJointType?.type).toBe('branchCurve');
    });

    it('snaps beside a track as a constrained joint', () => {
        const { engine } = withStraightTrack();
        engine.hoverForStartingPoint({ x: 50, y: 1.2 });
        expect(engine.newStartJointType?.type).toBe('contrained');
    });

    it('branches from a joint that already joins two tracks', () => {
        const { engine } = withStraightTrack();
        lay(engine, { x: 100, y: 0 }, { x: 200, y: 0 });
        engine.hoverForStartingPoint({ x: 100, y: 0 });
        expect(engine.newStartJointType?.type).toBe('branchJoint');
    });
});

describe('CurveCreationEngine laying', () => {
    it('lays a segment between two new joints and returns the end point', () => {
        const { graph, engine } = setup();
        const end = lay(engine, { x: 0, y: 0 }, { x: 100, y: 0 });
        expect(end).toMatchObject({ x: 100, y: 0 });
        expect(engine.lastCurveSuccess).toBe(true);
        expect(counts(graph)).toEqual({ segments: 1, joints: 2 });
    });

    it('extends a dead end into a second segment', () => {
        const { graph, engine } = withStraightTrack();
        expect(lay(engine, { x: 100, y: 0 }, { x: 200, y: 0 })).not.toBeNull();
        expect(counts(graph)).toEqual({ segments: 2, joints: 3 });
    });

    it('branches from the middle of a curve by splitting it', () => {
        const { graph, engine } = withStraightTrack();
        expect(lay(engine, { x: 50, y: 0.2 }, { x: 80, y: 40 })).not.toBeNull();
        expect(counts(graph)).toEqual({ segments: 3, joints: 4 });
    });

    it('clears the preview after a commit', () => {
        const { engine } = withStraightTrack();
        expect(engine.previewCurve).toBeNull();
        expect(engine.newStartJointType).toBeNull();
    });
});

describe('CurveCreationEngine refused commits', () => {
    it('refuses to extend a dead end back over its own track', () => {
        const { graph, engine } = withStraightTrack();
        expect(lay(engine, { x: 100, y: 0 }, { x: 0, y: 30 })).toBeNull();
        expect(engine.lastCurveSuccess).toBe(false);
        expect(counts(graph)).toEqual({ segments: 1, joints: 2 });
    });

    it('refuses to extend a track with a different gauge', () => {
        const { graph, engine } = withStraightTrack();
        engine.setCurrentGauge(1.435);
        expect(lay(engine, { x: 100, y: 0 }, { x: 200, y: 0 })).toBeNull();
        expect(counts(graph)).toEqual({ segments: 1, joints: 2 });
    });

    it('refuses a sloped branch', () => {
        const { graph, engine } = withStraightTrack();
        engine.setCurrentJointElevation(ELEVATION.ABOVE_1);
        expect(lay(engine, { x: 50, y: 0.2 }, { x: 80, y: 40 })).toBeNull();
        expect(counts(graph)).toEqual({ segments: 1, joints: 2 });
    });

    it('refuses to branch from the middle of a protected segment', () => {
        const { graph, engine } = withStraightTrack();
        graph.setSegmentProtectionCheck(() => true);
        expect(lay(engine, { x: 50, y: 0.2 }, { x: 80, y: 40 })).toBeNull();
        expect(lay(engine, { x: 80, y: 40 }, { x: 50, y: 0.2 })).toBeNull();
        expect(counts(graph)).toEqual({ segments: 1, joints: 2 });
    });
});

describe('CurveCreationEngine deletion', () => {
    it('highlights the hovered segment and deletes it', () => {
        const { graph, engine } = withStraightTrack();
        const segment = graph
            .getJoints()[0]
            .joint.connections.values()
            .next().value!;
        const highlights: DeletionHighlightState[] = [];
        engine.onDeletionHighlightChange(state => highlights.push(state));

        engine.hoverForCurveDeletion({ x: 50, y: 0.2 });
        expect(highlights).toEqual([{ segmentNumber: segment }]);

        engine.deleteCurrentCurve();
        expect(counts(graph)).toEqual({ segments: 0, joints: 0 });
        expect(highlights.at(-1)).toBeNull();
    });
});

describe('CurveCreationEngine events', () => {
    it('publishes preview draw data while hovering and clears it on cancel', () => {
        const { engine } = setup();
        const previews: unknown[] = [];
        engine.onPreviewDrawDataChange(data => previews.push(data));

        engine.hoverForStartingPoint({ x: 0, y: 0 });
        engine.hoveringForEndJoint({ x: 100, y: 0 });
        expect(Array.isArray(previews.at(-1))).toBe(true);
        expect((previews.at(-1) as unknown[]).length).toBeGreaterThan(0);

        engine.cancelCurrentCurve();
        expect(previews.at(-1)).toBeUndefined();
    });

    it('publishes the start projection, or null away from track', () => {
        const { engine } = withStraightTrack();
        const projections: unknown[] = [];
        engine.onPreviewStartProjectionChange(p => projections.push(p));

        engine.hoverForStartingPoint({ x: 100, y: 0 });
        expect(projections.at(-1)).toMatchObject({
            hit: true,
            hitType: 'joint',
        });

        engine.hoverForStartingPoint({ x: 500, y: 500 });
        expect(projections.at(-1)).toBeNull();
    });

    it('reports tension and elevation changes', () => {
        const { engine } = setup();
        const tensions: number[] = [];
        const elevations: (ELEVATION | null)[] = [];
        engine.onTensionChange(t => tensions.push(t));
        engine.onElevationChange(e => elevations.push(e));

        engine.bumpTension();
        engine.setCurrentJointElevation(ELEVATION.ABOVE_1);

        expect(tensions).toEqual([1.1]);
        expect(engine.currentTension).toBe(1.1);
        expect(elevations).toEqual([ELEVATION.ABOVE_1]);
    });
});
```

- [ ] **Step 3: Write `test/preview-curve-calculator.test.ts`**

```ts
import type { Point } from '@ue-too/math';
import { describe, expect, it } from 'bun:test';

import {
    PreviewCurveCalculator,
    TENSION_DEFAULT,
    TENSION_MAX,
    TENSION_MIN,
} from '../src/editing/new-joint.js';
import type {
    BrandNewJoint,
    ExtendingTrackJoint,
} from '../src/editing/types.js';
import { ELEVATION } from '../src/tracks/types.js';

function brandNew(x: number, y: number): BrandNewJoint {
    return { type: 'new', position: { x, y }, elevation: ELEVATION.GROUND };
}

/** A dead-end joint at (x, y) whose track continues along `tangent`. */
function extending(x: number, y: number, tangent: Point): ExtendingTrackJoint {
    return {
        type: 'extendingTrack',
        position: { x, y },
        elevation: ELEVATION.GROUND,
        constraint: {
            hitType: 'joint',
            jointNumber: 0,
            projectionPoint: { x, y },
            tangent,
            curvature: 0,
            endingJoint: true,
        },
    };
}

const EAST = { x: 1, y: 0 };

describe('PreviewCurveCalculator curve type', () => {
    it('joins two brand-new joints with a straight line', () => {
        const { cps, startAndEndSwitched } =
            new PreviewCurveCalculator().getPreviewCurve(
                brandNew(0, 0),
                brandNew(100, 0)
            );
        // A straight line is a quadratic with its midpoint as control point.
        // (The endpoints also carry a `z: 0` from the joint positions.)
        expect(startAndEndSwitched).toBe(false);
        expect(cps).toHaveLength(3);
        expect(cps[0]).toMatchObject({ x: 0, y: 0 });
        expect(cps[1]).toEqual({ x: 50, y: 0 });
        expect(cps[2]).toMatchObject({ x: 100, y: 0 });
    });

    it('uses a quadratic from a constrained start to a brand-new end', () => {
        const { cps } = new PreviewCurveCalculator().getPreviewCurve(
            extending(0, 0, EAST),
            brandNew(100, 50)
        );
        expect(cps).toHaveLength(3);
    });

    it('uses a reversed quadratic from a brand-new start to a constrained end', () => {
        const { cps } = new PreviewCurveCalculator().getPreviewCurve(
            brandNew(0, 50),
            extending(100, 0, EAST)
        );
        expect(cps).toHaveLength(3);
    });

    it('uses a cubic between two constrained joints', () => {
        const { cps } = new PreviewCurveCalculator().getPreviewCurve(
            extending(0, 0, EAST),
            extending(100, 50, EAST)
        );
        expect(cps).toHaveLength(4);
    });

    it('draws a straight line from a constrained start when straight-line mode is on', () => {
        const calculator = new PreviewCurveCalculator();
        calculator.toggleStraightLine();
        const { cps } = calculator.getPreviewCurve(
            extending(0, 0, EAST),
            brandNew(100, 0)
        );
        for (const point of cps) {
            expect(point.y).toBeCloseTo(0);
        }
    });
});

describe('PreviewCurveCalculator tension', () => {
    it('starts at the default tension', () => {
        expect(new PreviewCurveCalculator().tension).toBe(TENSION_DEFAULT);
    });

    it('clamps to the allowed range and rounds to one decimal', () => {
        const calculator = new PreviewCurveCalculator();
        calculator.tension = 99;
        expect(calculator.tension).toBe(TENSION_MAX);
        calculator.tension = -1;
        expect(calculator.tension).toBe(TENSION_MIN);
        calculator.tension = 1.26;
        expect(calculator.tension).toBe(1.3);
    });

    it('pushes cubic control points further along the tangents at higher tension', () => {
        const distanceOfFirstControlPoint = (tension: number) => {
            const calculator = new PreviewCurveCalculator();
            calculator.tension = tension;
            const { cps } = calculator.getPreviewCurve(
                extending(0, 0, EAST),
                extending(100, 50, EAST)
            );
            return Math.hypot(cps[1].x - cps[0].x, cps[1].y - cps[0].y);
        };
        expect(distanceOfFirstControlPoint(2)).toBeGreaterThan(
            distanceOfFirstControlPoint(0.5)
        );
    });
});

describe('PreviewCurveCalculator tangent direction', () => {
    it('turns a constrained start tangent to face the end point', () => {
        // The joint's tangent points east but the end lies to the west: the
        // curve must leave the joint heading west, not east.
        const { cps } = new PreviewCurveCalculator().getPreviewCurve(
            extending(100, 0, EAST),
            brandNew(0, 0)
        );
        expect(cps[1].x).toBeLessThan(100);
    });
});
```

- [ ] **Step 4: Write `test/editing-state-machines.test.ts`**

```ts
import type { Point } from '@ue-too/math';
import { describe, expect, it } from 'bun:test';

import { CatenaryLayoutEngine } from '../src/editing/catenary-layout-engine.js';
import { createCatenaryLayoutStateMachine } from '../src/editing/catenary-layout-state-machine.js';
import { CurveCreationEngine } from '../src/editing/curve-engine.js';
import { DuplicateToSideEngine } from '../src/editing/duplicate-to-side-engine.js';
import { createDuplicateToSideStateMachine } from '../src/editing/duplicate-to-side-state-machine.js';
import {
    type JointDirectionContext,
    createJointDirectionStateMachine,
} from '../src/editing/joint-direction-state-machine.js';
import { createLayoutStateMachine } from '../src/editing/layout-kmt-state-machine.js';
import { TrackGraph } from '../src/tracks/track.js';

/** Window coordinates are world coordinates in these tests. */
const identity = (position: Point) => ({ ...position });

/** A graph holding one straight segment A(0,0) — B(100,0). */
function straightTrack() {
    const graph = new TrackGraph();
    const a = graph.createNewEmptyJoint({ x: 0, y: 0 }, { x: 1, y: 0 });
    const b = graph.createNewEmptyJoint({ x: 100, y: 0 }, { x: 1, y: 0 });
    graph.connectJoints(a, b, [{ x: 50, y: 0 }]);
    const segment = graph.getJoint(a)!.connections.get(b)!;
    return { graph, segment };
}

describe('layout state machine with a curve engine', () => {
    function setup() {
        const graph = new TrackGraph();
        const engine = new CurveCreationEngine(graph, identity);
        const machine = createLayoutStateMachine(engine);
        return { graph, machine };
    }

    it('lays chained segments click by click', () => {
        const { graph, machine } = setup();
        machine.happens('startLayout');
        expect(machine.currentState).toBe('HOVER_FOR_STARTING_POINT');

        machine.happens('pointerMove', { x: 0, y: 0 });
        machine.happens('leftPointerUp', { x: 0, y: 0 });
        expect(machine.currentState).toBe('HOVER_FOR_ENDING_POINT');

        machine.happens('pointerMove', { x: 100, y: 0 });
        machine.happens('leftPointerUp', { x: 100, y: 0 });
        expect(machine.currentState).toBe('HOVER_FOR_ENDING_POINT');
        expect(graph.trackSegments).toHaveLength(1);

        // The end point became the next start: one more click extends it.
        machine.happens('pointerMove', { x: 200, y: 0 });
        machine.happens('leftPointerUp', { x: 200, y: 0 });
        expect(graph.trackSegments).toHaveLength(2);
        expect(graph.getJoints()).toHaveLength(3);
    });

    it('goes back to choosing a start when a commit is refused', () => {
        const { graph, machine } = setup();
        machine.happens('startLayout');
        machine.happens('pointerMove', { x: 0, y: 0 });
        machine.happens('leftPointerUp', { x: 0, y: 0 });
        // Click without moving: there is no preview curve, so endCurve fails.
        machine.happens('leftPointerUp', { x: 0, y: 0 });
        expect(machine.currentState).toBe('HOVER_FOR_STARTING_POINT');
        expect(graph.trackSegments).toHaveLength(0);
    });

    it('escape steps back from the end point, then leaves the tool', () => {
        const { machine } = setup();
        machine.happens('startLayout');
        machine.happens('pointerMove', { x: 0, y: 0 });
        machine.happens('leftPointerUp', { x: 0, y: 0 });
        machine.happens('escapeKey');
        expect(machine.currentState).toBe('HOVER_FOR_STARTING_POINT');
        machine.happens('escapeKey');
        expect(machine.currentState).toBe('IDLE');
    });

    it('deletes the clicked segment in deletion mode', () => {
        const { graph, machine } = setup();
        machine.happens('startLayout');
        machine.happens('pointerMove', { x: 0, y: 0 });
        machine.happens('leftPointerUp', { x: 0, y: 0 });
        machine.happens('pointerMove', { x: 100, y: 0 });
        machine.happens('leftPointerUp', { x: 100, y: 0 });

        machine.happens('startDeletion');
        expect(machine.currentState).toBe('HOVER_FOR_CURVE_DELETION');
        machine.happens('pointerMove', { x: 50, y: 0.2 });
        machine.happens('leftPointerUp', { x: 50, y: 0.2 });
        expect(graph.trackSegments).toHaveLength(0);

        machine.happens('endDeletion');
        expect(machine.currentState).toBe('HOVER_FOR_STARTING_POINT');
    });
});

describe('catenary state machine with its engine', () => {
    it('selects a segment, flips the side and commits on a click away', () => {
        const { graph, segment } = straightTrack();
        const engine = new CatenaryLayoutEngine(graph, identity);
        const machine = createCatenaryLayoutStateMachine(engine);
        const commits: { segmentNumber: number; side: 1 | -1 }[] = [];
        engine.onCommit(commit => commits.push(commit));

        machine.happens('leftPointerUp', { x: 50, y: 0.2 });
        expect(machine.currentState).toBe('PREVIEWING');

        machine.happens('F');
        machine.happens('leftPointerUp', { x: 50, y: 30 });

        expect(commits).toEqual([{ segmentNumber: segment, side: -1 }]);
        expect(machine.currentState).toBe('IDLE_FOR_SOURCE');
    });
});

describe('duplicate-to-side state machine with its engine', () => {
    it('lays a parallel copy of the selected segment', () => {
        const { graph } = straightTrack();
        const engine = new DuplicateToSideEngine(graph, identity);
        const machine = createDuplicateToSideStateMachine(engine);

        machine.happens('leftPointerUp', { x: 50, y: 0.2 });
        expect(machine.currentState).toBe('PREVIEWING');
        machine.happens('leftPointerUp', { x: 50, y: 30 });

        expect(graph.trackSegments).toHaveLength(2);
        const copy = graph.trackSegments[1].curve.getControlPoints();
        const offset = copy[0].y;
        expect(Math.abs(offset)).toBeGreaterThan(0);
        expect(copy[copy.length - 1].y).toBeCloseTo(offset);
        expect(machine.currentState).toBe('IDLE_FOR_SOURCE');
    });
});

describe('joint-direction state machine', () => {
    /** One switch joint (number 7) at the origin with an eastward tangent. */
    function recordingContext() {
        const calls: string[] = [];
        const context: JointDirectionContext = {
            setup: () => {},
            cleanup: () => {},
            convert2WorldPosition: identity,
            getHoveredSwitchJoint: position =>
                Math.hypot(position.x, position.y) < 10 ? 7 : null,
            showHoverIndicator: joint => calls.push(`hover ${joint}`),
            clearHoverIndicator: () => calls.push('clear hover'),
            selectJoint: joint => calls.push(`select ${joint}`),
            deselectJoint: () => calls.push('deselect'),
            cycleDirection: (joint, direction) =>
                calls.push(`cycle ${joint} ${direction}`),
            getSelectedJointTangent: () => ({ x: 1, y: 0 }),
            getSelectedJointPosition: () => ({ x: 0, y: 0 }),
        };
        return { calls, context };
    }

    it('hovers, selects and cycles a switch by the side clicked', () => {
        const { calls, context } = recordingContext();
        const machine = createJointDirectionStateMachine(context);

        machine.happens('pointerMove', { x: 1, y: 0 });
        expect(machine.currentState).toBe('HOVERING');
        machine.happens('leftPointerDown', { x: 1, y: 0 });
        expect(machine.currentState).toBe('SELECTED');

        machine.happens('leftPointerDown', { x: 3, y: 0 });
        machine.happens('leftPointerDown', { x: -3, y: 0 });

        expect(calls).toEqual([
            'hover 7',
            'clear hover',
            'select 7',
            'cycle 7 tangent',
            'cycle 7 reverseTangent',
        ]);
    });

    it('deselects when clicking away from any switch', () => {
        const { calls, context } = recordingContext();
        const machine = createJointDirectionStateMachine(context);
        machine.happens('pointerMove', { x: 1, y: 0 });
        machine.happens('leftPointerDown', { x: 1, y: 0 });

        machine.happens('leftPointerDown', { x: 50, y: 50 });

        expect(calls.at(-1)).toBe('deselect');
        expect(machine.currentState).toBe('IDLE');
    });
});
```

- [ ] **Step 5: Run them against the unchanged code**

Run: `bun test test/curve-engine.test.ts test/preview-curve-calculator.test.ts test/editing-state-machines.test.ts 2>&1 | grep -E "\(fail\)|^ *[0-9]+ (pass|fail)" && bun run typecheck && bun test 2>&1 | grep -E "^ *[0-9]+ (pass|fail)"`
Expected:
- `36 pass`, `0 fail` across the three files (engine 19, calculator 9, state machines 8).
- A clean typecheck.
- `316 pass`, `0 fail` overall.

If a case fails, see "Characterization tests" under Conventions.

- [ ] **Step 6: Format and commit**

```bash
bun run format && bun run format:check \
  && git add -A && git commit -m "test(editing): characterize laying, the preview curves and the tool machines" -m "First tests for the curve engine (snapping categories, laying, refused commits, deletion, events), the preview-curve calculator, and the layout, catenary, duplicate-to-side and joint-direction state machines."
```

---

### Task 4: Return the split's result and stop the console dumps

This is changes 4 and 5 of the spec.

**Files:**
- Modify: `test/curve-engine.test.ts`, `src/editing/curve-engine.ts`, `src/editing/layout-kmt-state-machine.ts`

**Interfaces:**
- Produces:
  - `CurveCreationEngine.insertJointIntoTrackSegment(start, end, atT): number | null`
  - `LayoutContext.insertJointIntoTrackSegment(...) => number | null`

- [ ] **Step 1: Write the failing tests.** In `test/curve-engine.test.ts`, replace:

```ts
import { describe, expect, it } from 'bun:test';
```

with:

```ts
import { describe, expect, it, spyOn } from 'bun:test';
```

and append:

```ts
describe('CurveCreationEngine.insertJointIntoTrackSegment', () => {
    it('returns the new joint number', () => {
        const { graph, engine } = withStraightTrack();
        const [a, b] = graph.getJoints().map(j => j.jointNumber);
        const m = engine.insertJointIntoTrackSegment(a, b, 0.5);
        expect(typeof m).toBe('number');
        expect(graph.getJoint(m!)).not.toBeNull();
    });

    it('returns null when the segment is protected', () => {
        const { graph, engine } = withStraightTrack();
        graph.setSegmentProtectionCheck(() => true);
        const [a, b] = graph.getJoints().map(j => j.jointNumber);
        expect(engine.insertJointIntoTrackSegment(a, b, 0.5)).toBeNull();
    });
});

describe('CurveCreationEngine console output', () => {
    it('does not dump the whole graph when committing or splitting', () => {
        const { graph, engine } = withStraightTrack();
        const segmentDump = spyOn(graph, 'logTrackSegments');
        const jointDump = spyOn(graph, 'logJoints');

        lay(engine, { x: 100, y: 0 }, { x: 200, y: 0 });
        const [a, b] = graph.getJoints().map(j => j.jointNumber);
        engine.insertJointIntoTrackSegment(a, b, 0.5);

        expect(segmentDump).not.toHaveBeenCalled();
        expect(jointDump).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test test/curve-engine.test.ts`
Expected: `3 fail`, `19 pass`. Today the engine returns `undefined` from the split and calls both dump methods.

- [ ] **Step 3: Implement.** In `src/editing/curve-engine.ts`, replace:

```ts
        // this._trackGraph.logJoints();
        console.log('---track segments---');
        this._trackGraph.logTrackSegments();
        console.log('---track segments---');
        this.cancelCurrentCurve();

        return res;
    }

    insertJointIntoTrackSegment(
        startJointNumber: number,
        endJointNumber: number,
        atT: number
    ) {
        this._trackGraph.insertJointIntoTrackSegment(
            startJointNumber,
            endJointNumber,
            atT
        );
        this._trackGraph.logJoints();
    }
```

with:

```ts
        this.cancelCurrentCurve();

        return res;
    }

    /**
     * Splits the segment between two directly connected joints. Returns the
     * new joint's number, or null when the graph refuses the split.
     */
    insertJointIntoTrackSegment(
        startJointNumber: number,
        endJointNumber: number,
        atT: number
    ): number | null {
        return this._trackGraph.insertJointIntoTrackSegment(
            startJointNumber,
            endJointNumber,
            atT
        );
    }
```

In `src/editing/layout-kmt-state-machine.ts`, replace:

```ts
    insertJointIntoTrackSegment: (
        startJointNumber: number,
        endJointNumber: number,
        atT: number
    ) => void;
```

with:

```ts
    insertJointIntoTrackSegment: (
        startJointNumber: number,
        endJointNumber: number,
        atT: number
    ) => number | null;
```

- [ ] **Step 4: Run the tests**

Run: `bun test test/curve-engine.test.ts && bun run typecheck && bun test 2>&1 | grep -E "^ *[0-9]+ (pass|fail)"`
Expected: `22 pass` for the file, a clean typecheck, then `319 pass`, `0 fail`.

- [ ] **Step 5: Format and commit**

```bash
bun run format && bun run format:check \
  && git add -A && git commit -m "fix(editing): return the split's joint and stop dumping the graph to the console" -m "CurveCreationEngine.insertJointIntoTrackSegment (and LayoutContext) return number | null from the graph. The engine no longer calls logTrackSegments after every commit or logJoints after every split."
```

---

### Task 5: Package surface for `track-layout/editing`

**Files:**
- Create: `test/editing-entry.test.ts`
- Modify: `package.json`, `README.md`

- [ ] **Step 1: Write the entry-point guard test** in `test/editing-entry.test.ts`

```ts
import { describe, expect, it } from 'bun:test';

import * as editing from '../src/editing/index.js';

describe('editing entry point', () => {
    it('exposes the laying and editing API', () => {
        for (const name of [
            'CurveCreationEngine',
            'PreviewCurveCalculator',
            'createLayoutStateMachine',
            'createJointDirectionStateMachine',
            'DuplicateToSideEngine',
            'createDuplicateToSideStateMachine',
            'CatenaryLayoutEngine',
            'createCatenaryLayoutStateMachine',
            'computeDuplicateGeometry',
            'TENSION_DEFAULT',
        ]) {
            expect(editing).toHaveProperty(name);
        }
    });
});
```

Run: `bun test test/editing-entry.test.ts`
Expected: `1 pass`. Task 1 built the index; this test guards it from now on.

- [ ] **Step 2: Export `./editing` and make `@ue-too/being` an optional peer.** In `package.json`, replace:

```json
            "default": "./dist/index.js"
        },
        "./package.json": "./package.json"
```

with:

```json
            "default": "./dist/index.js"
        },
        "./editing": {
            "types": "./dist/editing/index.d.ts",
            "import": "./dist/editing/index.js",
            "default": "./dist/editing/index.js"
        },
        "./package.json": "./package.json"
```

Replace:

```json
    "peerDependencies": {
        "@ue-too/board": "^0.19.0",
```

with:

```json
    "peerDependencies": {
        "@ue-too/being": "^0.19.0",
        "@ue-too/board": "^0.19.0",
```

Replace:

```json
        "@ue-too/math": "^0.19.0"
    },
    "devDependencies": {
```

with:

```json
        "@ue-too/math": "^0.19.0"
    },
    "peerDependenciesMeta": {
        "@ue-too/being": {
            "optional": true
        }
    },
    "devDependencies": {
```

- [ ] **Step 3: Document the editing entry point.** In `README.md`, insert this section after the `## Example` section's closing code fence and before `## Development`:

````markdown
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

````

- [ ] **Step 4: Build and check what ships**

```bash
bun run build && ls dist/editing | head -3 && bun pm pack --dry-run 2>&1 | grep "Total files" \
  && node --input-type=module -e "import('./dist/editing/index.js').then(m => console.log('editing exports:', Object.keys(m).length))"
```

Expected:
- `dist/editing/` exists.
- `Total files: 105`.
- `editing exports: 25`, which shows the emitted ESM loads in plain Node.

- [ ] **Step 5: Full check and commit**

```bash
bun run format && bun run format:check && bun run typecheck && bun test 2>&1 | grep -E "^ *[0-9]+ (pass|fail)|^Ran" \
  && git add -A && git commit -m "feat(editing): export track-layout/editing" -m "Adds the ./editing export and @ue-too/being as an optional peer dependency, with a README section and an entry-point guard test."
```

Expected: `320 pass`, `0 fail`, `Ran 320 tests across 28 files`.

---

### Task 6 (banana): A window-to-world helper

This task branches banana and adds the conversion that leaves the engine, before anything uses it.

**Files:**
- Create: BN `src/utils/window-to-world.ts`, BN `test/window-to-world.test.ts`

**Interfaces:**
- Produces: `createWindowToWorld(canvas: Canvas, camera: ObservableBoardCamera): (position: Point) => Point`, from `@/utils/window-to-world`.

- [ ] **Step 1: Branch**

```bash
cd /Users/vincent.yy.chang/dev/banana/main && git checkout -q main && git pull -q && git checkout -b feat/track-layout-phase-2 \
  && bun install --frozen-lockfile >/dev/null && bun test 2>&1 | grep -E "^ *[0-9]+ (pass|fail)" && bunx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"
```

Expected: `734 pass`, `0 fail`, then `11`.

- [ ] **Step 2: Write the failing test** in BN `test/window-to-world.test.ts`

```ts
import type { Canvas, ObservableBoardCamera } from '@ue-too/board';
import { describe, expect, it } from 'bun:test';

import { createWindowToWorld } from '../src/utils/window-to-world';

/** A 200 × 100 canvas whose top-left corner sits at window (10, 20). */
const canvas = {
    width: 200,
    height: 100,
    position: { x: 10, y: 20 },
} as Canvas;

function cameraAt(x: number, y: number, zoomLevel: number, rotation = 0) {
    return {
        position: { x, y },
        zoomLevel,
        rotation,
    } as ObservableBoardCamera;
}

describe('createWindowToWorld', () => {
    it('maps the canvas centre to the camera position', () => {
        const toWorld = createWindowToWorld(canvas, cameraAt(500, 300, 2));
        const world = toWorld({ x: 110, y: 70 });
        expect(world.x).toBeCloseTo(500);
        expect(world.y).toBeCloseTo(300);
    });

    it('scales window offsets by the zoom level', () => {
        const toWorld = createWindowToWorld(canvas, cameraAt(500, 300, 2));
        const world = toWorld({ x: 130, y: 90 });
        expect(world.x).toBeCloseTo(510);
        expect(world.y).toBeCloseTo(310);
    });

    it('reads the camera on every call', () => {
        const camera = cameraAt(0, 0, 1);
        const toWorld = createWindowToWorld(canvas, camera);
        camera.position = { x: 40, y: 0 };
        expect(toWorld({ x: 110, y: 70 }).x).toBeCloseTo(40);
    });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `bun test test/window-to-world.test.ts`
Expected: FAIL. `../src/utils/window-to-world` can't be found.

- [ ] **Step 4: Write BN `src/utils/window-to-world.ts`**

It's the conversion `CurveCreationEngine.convert2WorldPosition` used to do.

```ts
import {
    type Canvas,
    type ObservableBoardCamera,
    convertFromCanvas2ViewPort,
    convertFromViewport2World,
    convertFromWindow2Canvas,
} from '@ue-too/board';
import type { Point } from '@ue-too/math';

/**
 * Returns a function that converts a window (pointer) position to world
 * coordinates for the board's current canvas and camera. The canvas and
 * camera are read on every call, so pans, zooms and resizes are picked up.
 */
export function createWindowToWorld(
    canvas: Canvas,
    camera: ObservableBoardCamera
): (position: Point) => Point {
    return position => {
        const pointInCanvas = convertFromWindow2Canvas(position, canvas);
        const pointInViewPort = convertFromCanvas2ViewPort(pointInCanvas, {
            x: canvas.width / 2,
            y: canvas.height / 2,
        });
        return convertFromViewport2World(
            pointInViewPort,
            camera.position,
            camera.zoomLevel,
            camera.rotation,
            false
        );
    };
}
```

- [ ] **Step 5: Run the tests**

Run: `bun test test/window-to-world.test.ts && bun test 2>&1 | grep -E "^ *[0-9]+ (pass|fail)" && bunx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"`
Expected: `3 pass`, then `737 pass`, `0 fail`, then `11`.

- [ ] **Step 6: Format and commit**

```bash
bun run format && bun run format:check | tail -1 \
  && git add -A && git commit -m "feat(utils): window-to-world conversion helper" -m "The conversion CurveCreationEngine did with its canvas and camera, as a standalone helper; the engine will take it as a function once it moves to track-layout/editing."
```

---

### Task 7 (banana): Switch banana to `track-layout/editing`

**Files:**
- Modify:
  - BN `package.json`, `bun.lock`
  - BN `src/trains/tracks/index.ts`, `src/trains/input-state-machine/index.ts`
  - BN `src/trains/input-state-machine/tool-switcher-state-machine.ts`, `src/trains/input-state-machine/kmt-state-machine-extension.ts`
  - BN `src/trains/tracks/render-system.ts`
  - BN `src/utils/init-app.ts`
  - BN `src/components/toolbar/BananaToolbar.tsx`, `src/components/toolbar/TimetablePanel.tsx`
  - BN `src/hooks/use-render-sync.ts`
  - BN `src/scene-serialization.ts`
- Delete: the 10 moved files, `src/trains/input-state-machine/utils/` and `test/duplicate-geometry.test.ts`

**Interfaces:**
- Consumes, from Tasks 1–5:
  - `CurveCreationEngine(trackGraph, convertWindowToWorld)`
  - `createLayoutStateMachine(context)`
  - `createJointDirectionStateMachine(context)`
- Consumes, from Task 6: `createWindowToWorld`.
- Produces: `BananaAppComponents.trackGraph: TrackGraph`.

- [ ] **Step 1: Pack `track-layout`**

Run: `cd /Users/vincent.yy.chang/dev/track/main && bun run pack:local && ls .pack`
Expected: `track-layout-local.tgz`.

- [ ] **Step 2: Install the tarball by editing `package.json`.** `bun add <tarball>` fails with `DependencyLoop` while banana depends on the registry version. In BN `package.json`, replace:

```json
        "track-layout": "^0.1.0",
```

with:

```json
        "track-layout": "../../track/main/.pack/track-layout-local.tgz",
```

then run:

```bash
cd /Users/vincent.yy.chang/dev/banana/main && bun install && grep -c "createLayoutStateMachine" node_modules/track-layout/dist/editing/layout-kmt-state-machine.d.ts && grep -n "track-layout" bun.lock | cut -c1-90
```

Expected:
- `1`.
- Exactly two `bun.lock` lines mention `track-layout`: the workspace dependency and the package entry, both with the tarball path.

- [ ] **Step 3: Delete the moved files.** Do this BEFORE repointing; otherwise the script rewrites them too.

```bash
git rm -q src/trains/tracks/new-joint.ts src/trains/tracks/duplicate-geometry.ts \
  src/trains/input-state-machine/{types,curve-engine,layout-kmt-state-machine,joint-direction-state-machine,duplicate-to-side-engine,duplicate-to-side-state-machine,catenary-layout-engine,catenary-layout-state-machine}.ts \
  test/duplicate-geometry.test.ts && git rm -rq src/trains/input-state-machine/utils
```

- [ ] **Step 4: Trim the barrels**

In BN `src/trains/tracks/index.ts`, delete:

```ts
export * from './new-joint';
```

In BN `src/trains/input-state-machine/index.ts`, delete these three lines, which leaves only `export * from './train-kmt-state-machine';`:

```ts
export * from './layout-kmt-state-machine';
export * from './utils';
export * from './curve-engine';
```

- [ ] **Step 5: Repoint imports**

Run: `bun /Users/vincent.yy.chang/dev/track/main/scripts/repoint-banana-imports.ts /Users/vincent.yy.chang/dev/banana/main`
Expected:
- It repoints 4 files: `init-app.ts`, `render-system.ts`, `kmt-state-machine-extension.ts` and `tool-switcher-state-machine.ts`.
- `done; 4 file(s) changed`.
- Their imports of the moved modules now come from `'track-layout/editing'`.

- [ ] **Step 6: Fix the imports that went through barrels or the deleted `utils/`**

In BN `src/trains/input-state-machine/tool-switcher-state-machine.ts`, replace:

```ts
import {
    CurveCreationEngine,
    TrainPlacementStateMachine,
    createLayoutStateMachine,
} from '.';
```

with:

```ts
import {
    CurveCreationEngine,
    createLayoutStateMachine,
} from 'track-layout/editing';

import { TrainPlacementStateMachine } from '.';
```

In BN `src/trains/input-state-machine/kmt-state-machine-extension.ts`, replace:

```ts
import { createLayoutStateMachine } from './utils';
```

with:

```ts
import { createLayoutStateMachine } from 'track-layout/editing';
```

In BN `src/trains/tracks/render-system.ts`, replace:

```ts
import { CurveCreationEngine } from '../input-state-machine';
```

with:

```ts
import { CurveCreationEngine } from 'track-layout/editing';
```

- [ ] **Step 7: Rework `init-app.ts`: banana owns the graph and the converter**

In BN `src/utils/init-app.ts`, replace:

```ts
import { createLayoutStateMachine } from '@/trains/input-state-machine/utils';
```

with:

```ts
import { createLayoutStateMachine } from 'track-layout/editing';
```

Replace:

```ts
import { StationManager } from 'track-layout';
```

with:

```ts
import { StationManager } from 'track-layout';
import { TrackGraph } from 'track-layout';
```

Replace:

```ts
import i18n from '@/i18n';
```

with:

```ts
import i18n from '@/i18n';
import { createWindowToWorld } from '@/utils/window-to-world';
```

Replace:

```ts
    const curveEngine = new CurveCreationEngine(
        baseComponents.canvasProxy,
        baseComponents.camera
    );
```

with:

```ts
    const trackGraph = new TrackGraph();
    const windowToWorld = createWindowToWorld(
        baseComponents.canvasProxy,
        baseComponents.camera
    );
    const curveEngine = new CurveCreationEngine(trackGraph, windowToWorld);
```

Replace this text, which appears **twice** (in the duplicate-to-side and catenary engine constructors):

```ts
        curveEngine.trackGraph,
        position => curveEngine.convert2WorldPosition(position)
    );
```

with:

```ts
        trackGraph,
        windowToWorld
    );
```

Delete these lines, including the blank line after each statement:

```ts
    const jointDirectionSubStateMachine = createJointDirectionStateMachine();

    const trackGraph = curveEngine.trackGraph;
```

Replace:

```ts
    jointDirectionSubStateMachine.setContext({
        setup: () => {},
        cleanup: () => {},
        convert2WorldPosition: pos => {
            return curveEngine.convert2WorldPosition(pos);
        },
```

with:

```ts
    const jointDirectionSubStateMachine = createJointDirectionStateMachine({
        setup: () => {},
        cleanup: () => {},
        convert2WorldPosition: windowToWorld,
```

The rest of that object literal, and its closing `});`, stay as they are.

Replace:

```ts
    curveEngine: CurveCreationEngine;
```

with:

```ts
    curveEngine: CurveCreationEngine;
    trackGraph: TrackGraph;
```

Replace:

```ts
    return {
        ...baseComponents,
        curveEngine,
```

with:

```ts
    return {
        ...baseComponents,
        curveEngine,
        trackGraph,
```

Finally, in `init-app.ts` only, replace every remaining `curveEngine.trackGraph` with `trackGraph`. There should be 8 left.

```bash
grep -c "curveEngine\.trackGraph" src/utils/init-app.ts; sed -i '' 's/curveEngine\.trackGraph/trackGraph/g' src/utils/init-app.ts; grep -c "curveEngine\.trackGraph" src/utils/init-app.ts
```

Expected: `8`, then `0`.

- [ ] **Step 8: Use `app.trackGraph` everywhere else**

```bash
for f in src/components/toolbar/BananaToolbar.tsx src/components/toolbar/TimetablePanel.tsx src/hooks/use-render-sync.ts src/scene-serialization.ts; do printf "%s %s\n" "$f" "$(grep -c 'app\.curveEngine\.trackGraph' $f)"; sed -i '' 's/app\.curveEngine\.trackGraph/app.trackGraph/g' $f; done; grep -rn "curveEngine\.trackGraph" src test; echo "exit=$?"
```

Expected:
- Counts of 6, 2, 7 and 5.
- `grep` then finds nothing (`exit=1`).

- [ ] **Step 9: Format and verify**

```bash
bun run format >/dev/null && bun run format:check | tail -1 \
  && bunx tsc --noEmit -p tsconfig.json 2>&1 | grep "error TS" | sed -E 's/\(([0-9]+),[0-9]+\)//' | sort | uniq -c; \
  bun test 2>&1 | grep -E "^ *[0-9]+ (pass|fail)"; bun run build 2>&1 | grep -E "built in|error"
```

Expected:
- Prettier is clean.
- Exactly the **9** errors listed in Global Constraints, with nothing in `joint-direction-state-machine.ts`.
- `732 pass`, `0 fail`.
- `✓ built in …`.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "refactor: use track-layout/editing for laying and editing" -m "Installs the locally packed track-layout tarball, deletes banana's copies of the curve engine, preview-curve calculator and the layout, joint-direction, duplicate-to-side and catenary tools, and repoints imports to track-layout/editing. init-app now creates the TrackGraph, builds the window-to-world converter, passes both to the engines, builds the joint-direction machine with its context, and exposes the graph as app.trackGraph."
```

---

### Task 8: Verification gate, release 0.2.0, pin it in banana

**Files:**
- Modify: TL `package.json` (version), BN `package.json`, BN `bun.lock`

- [ ] **Step 1: Full `track-layout` check**

```bash
cd /Users/vincent.yy.chang/dev/track/main && bun run format:check | tail -1 && bun run typecheck && bun test 2>&1 | grep -E "^ *[0-9]+ (pass|fail)|^Ran" && bun run build >/dev/null && bun pm pack --dry-run 2>&1 | grep "Total files"
```

Expected: Prettier is clean, the typecheck is clean, `320 pass`, `0 fail`, `Ran 320 tests across 28 files`, then `Total files: 105`.

- [ ] **Step 2: Full banana check**

```bash
cd /Users/vincent.yy.chang/dev/banana/main && bun run format:check | tail -1 && bunx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"; bun test 2>&1 | grep -E "^ *[0-9]+ (pass|fail)"; bun run build 2>&1 | grep "built in"
```

Expected: Prettier is clean, then `9`, then `732 pass`, `0 fail`, then `✓ built in …`.

- [ ] **Step 3: Owner play-test (STOP and ask)**

Ask the owner to run `bun run dev` in banana and check:
- Lay track, extend a dead end, branch at a joint, branch mid-curve, and delete track.
- In the layout tool: F and G flip the end/start tangent, Q toggles straight line, the scroll wheel changes tension (the toolbar's tension readout follows), and the arrow keys change elevation (the toolbar's elevation follows).
- The duplicate-to-side tool lays a parallel copy.
- The catenary tool: masts appear on the chosen side, and F flips the side.
- The joint-direction tool: hover a switch, select it, click either side to cycle, click away to deselect.
- Branching off the middle of a platform's track is refused.
- Save, reload the page, and load the scene.
- Pan and zoom, then lay track. The snapping follows the pointer, which shows the window-to-world helper matches.

Continue only after the owner confirms.

- [ ] **Step 4: Owner go-ahead to publish (STOP and ask).** Don't continue without it.

- [ ] **Step 5: Version and publish**

In TL `package.json`, change `"version": "0.1.0"` to `"version": "0.2.0"`, then:

```bash
cd /Users/vincent.yy.chang/dev/track/main && git add package.json && git commit -m "chore(release): track-layout 0.2.0"
```

The owner publishes. If needed they run `! bunx npm login`, then `! cd /Users/vincent.yy.chang/dev/track/main && bun publish`.

Verify with `curl -s https://registry.npmjs.org/track-layout | grep -o '"latest":"[^"]*"'`, which should print `"latest":"0.2.0"`.

- [ ] **Step 6: Pin the published version in banana**

Run: `cd /Users/vincent.yy.chang/dev/banana/main && bun add track-layout@^0.2.0`

If that also fails with `DependencyLoop`, set `"track-layout": "^0.2.0"` in `package.json` and run `bun install`.

Then verify:

```bash
grep -n '"track-layout"' package.json && grep '"version"' node_modules/track-layout/package.json && grep -c "\.pack" package.json bun.lock; rm -rf node_modules/track-layout && bun install --frozen-lockfile >/dev/null && bun test 2>&1 | grep -E "^ *[0-9]+ (pass|fail)" && bun run build 2>&1 | grep "built in"
```

Expected:
- `"track-layout": "^0.2.0"`, and `"version": "0.2.0"` in `node_modules`.
- `0` `.pack` mentions in both files.
- `732 pass`, `0 fail`, then `✓ built in …`.

- [ ] **Step 7: Commit**

```bash
git add package.json bun.lock && git commit -m "chore(deps): use published track-layout 0.2.0"
```

- [ ] **Step 8: Hand off**

Report:
- TL `feat/phase-2-editing` with 320 tests, and BN `feat/track-layout-phase-2` with 732 tests and 9 type errors.
- That 0.2.0 is published.

Pushing either branch, opening PRs and merging are the owner's decisions; offer superpowers:finishing-a-development-branch.
