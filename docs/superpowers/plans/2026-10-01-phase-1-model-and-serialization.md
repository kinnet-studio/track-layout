# track-layout Phase 1 (Model and Serialization) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move banana's track and station model (track graph, segments, R-tree, station and platform managers, serialization) into the standalone `track-layout` package, fix the known model problems along the way, and switch banana over to the package.

**Architecture:** Lift and decouple. The model files are copied from banana `b26692b` by a script that rewrites their imports. The changes come after the verbatim copy, each with its own tests:
- segment style moves into the model
- `bedWidth` is saved
- splits respect platform protection
- the loader no longer calls `requestAnimationFrame` directly
- timetable code moves out

Banana then installs a locally packed tarball of the package, deletes its own copies, and repoints its imports with a second script.

**Tech Stack:** Bun 1.3 (runtime, package manager, `bun test`), TypeScript 5.8 (`moduleResolution: bundler`, ESM, `tsc` emit), Prettier 3 with `@trivago/prettier-plugin-sort-imports`, `@ue-too/board|curve|math` 0.19 as peers, React/Vite/Pixi 8.20.1 in banana.

**Spec:** `docs/superpowers/specs/2026-10-01-track-layout-extraction-design.md` (in this repo). Read it before starting.

## Global Constraints

- **Package name:** `track-layout`, unscoped.
- **Peer dependencies:** `@ue-too/board`, `@ue-too/curve` and `@ue-too/math` at `^0.19.0`; dev dependencies are pinned to `0.19.0`.
- **Banana dependencies:** every `@ue-too/*` at `^0.19.0`, and `pixi.js` at `8.20.1` (exact).
- **Bun only.** Never use npm, pnpm, yarn or node to install or run anything. Tests import from `bun:test`.
- **TypeScript resolution:** `moduleResolution: "bundler"`, never `NodeNext`. Relative imports in `track-layout` source and tests end in `.js` (`'./track.js'`).
- **What `src/` may import:** each other and the three `@ue-too` peers. Nothing from pixi.js, React, zustand, banana's timetable, trains or terrain, and no DOM APIs. The one exception is the feature-detected `requestAnimationFrame` in `defaultYieldToFrame`.
- **Prettier:** 4-space indent, single quotes, `es5` trailing commas, width 80, imports sorted. Run `bun run format` before every commit; `bun run format:check` must pass.
- **Save format changes are additive only:** an optional `bedWidth` on saved segments.
- **`DEFAULT_SEGMENT_STYLE`** is `{ trackStyle: 'ballasted', electrified: false, bed: false, bedWidth: 3 }`.
- **`bedWidth` rule:** a segment stores `bedWidth` only while `bed` is true. On load, `bedWidth` defaults to 3 only for segments with `bed: true`.
- **Banana typecheck:** `bunx tsc --noEmit -p tsconfig.json` must report exactly the 11 pre-existing errors and nothing new:
  - `BananaToolbar.tsx` ×2
  - `DepotPanel.tsx` ×1
  - `train-editor-tool-switcher.ts` ×2
  - `train-editor-toolbar.tsx` ×2
  - `joint-direction-state-machine.ts` ×2
  - `init-app.ts` ×2, "Cannot find name 'result'"
- **Banana tests:** 948 before the swap, 734 after it.
- **No outward actions without the owner's go-ahead:** don't publish to npm, push, or open PRs.

## Conventions

- **TL** = `/Users/vincent.yy.chang/dev/track/main` (this repo, `track-layout`). **BN** = `/Users/vincent.yy.chang/dev/banana/main`.
- **Branches:** TL work happens on `feat/phase-1-model`, BN work on `feat/track-layout-phase-1`.
- **Commits** are conventional (`feat: …`, `refactor(tracks): …`). End every commit message with the co-author trailer your harness specifies.
- **Characterization tests** record what the code does today. If one fails against unchanged code, the test's expectation is wrong. Fix the expectation, never the code, and say so in the commit message.
- **"Replace X with Y"** means an exact-text replacement where X occurs exactly once (unless the step gives another count). If X isn't found, stop and report. Don't improvise.

## File Structure

**track-layout (TL) after phase 1:**

```
package.json                  scripts, exports map, peers
tsconfig.json                 typecheck config (src, test, scripts; bun types)
tsconfig.build.json           emit config (src only → dist/)
.prettierrc / .prettierignore / .gitignore
.github/workflows/ci.yml      format:check, typecheck, test, build
README.md
scripts/
  banana-module-map.ts        banana module id → track-layout module id (shared by both scripts)
  port-from-banana.ts         copies banana files here, rewriting imports
  repoint-banana-imports.ts   rewrites banana imports of moved modules to 'track-layout'
  generate-golden-fixture.ts  one-shot: writes test/fixtures/banana-scene-b26692b.json
src/
  index.ts                    root entry: re-exports every module below
  shared/entity-manager.ts    GenericEntityManager (from banana src/utils.ts)
  shared/r-tree.ts            RTree, Rectangle (from banana src/trains/r-tree.ts, demo removed)
  tracks/                     constants, gauge-presets, parallel-spacing, joint-direction-preference-map,
                              types, utils, trackjoint-manager, trackcurve-manager, track,
                              segment-style (new)
  stations/                   types, stop-position-utils, station-manager, station-factory,
                              track-aligned-platform-{types,migration,manager}, spine-utils,
                              arc-length-resolver, platform-offset
test/
  fixtures/banana-scene-b26692b.json
  23 test files (16 ported, 7 new)
```

**banana (BN) files touched:**
- `package.json`
- `src/utils.ts`
- `src/trains/index.ts`, `src/trains/tracks/index.ts`
- `src/hooks/use-render-sync.ts`
- `src/trains/tracks/render-system.ts`
- `src/utils/init-app.ts`
- `src/trains/input-state-machine/curve-engine.ts`
- `src/trains/input-state-machine/utils/factory.ts`
- `src/components/toolbar/PlatformEditorPanel.tsx`
- `src/timetable/stop-position-references.ts` (new)
- `test/stop-position-references.test.ts` (new)
- about 68 files whose imports get repointed
- deletes 20 source files and 16 test files

---

### Task 1: Scaffold track-layout and port the leaf track modules

**Files:**
- Create:
  - `package.json`, `tsconfig.json`, `tsconfig.build.json`
  - `.prettierrc`, `.prettierignore`, `.gitignore`
  - `.github/workflows/ci.yml`
  - `scripts/banana-module-map.ts`, `scripts/port-from-banana.ts`, `scripts/repoint-banana-imports.ts`
  - `src/index.ts`
- Port (via script):
  - `src/tracks/constants.ts`, `src/tracks/gauge-presets.ts`
  - `src/tracks/parallel-spacing.ts`, `src/tracks/joint-direction-preference-map.ts`
  - `test/gauge-presets.test.ts`, `test/parallel-spacing.test.ts`, `test/joint-direction-preference-map.test.ts`

**Interfaces:**
- Produces:
  - `bun scripts/port-from-banana.ts <banana-root> <banana-file>=<tl-file> ...` prints `ported a -> b` per file, `  UNMAPPED <spec>` for each import it couldn't map, and `done; N unmapped specifier(s)`.
  - `bun scripts/repoint-banana-imports.ts <banana-root>` prints `repointed <file>` and `done; N file(s) changed`.
  - `MODULE_MAP` is exported from `scripts/banana-module-map.ts`.

- [ ] **Step 1: Create the branch**

```bash
git -C /Users/vincent.yy.chang/dev/track/main checkout -b feat/phase-1-model
```

- [ ] **Step 2: Write `package.json`**

```json
{
    "name": "track-layout",
    "version": "0.0.0",
    "type": "module",
    "sideEffects": false,
    "main": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "exports": {
        ".": {
            "types": "./dist/index.d.ts",
            "import": "./dist/index.js"
        },
        "./package.json": "./package.json"
    },
    "files": ["dist"],
    "scripts": {
        "build": "rm -rf dist && tsc -p tsconfig.build.json",
        "typecheck": "tsc --noEmit -p tsconfig.json",
        "test": "bun test",
        "format": "prettier --write .",
        "format:check": "prettier --check .",
        "pack:local": "bun run build && mkdir -p .pack && bun pm pack --filename .pack/track-layout-local.tgz --quiet",
        "prepublishOnly": "bun run typecheck && bun test && bun run build"
    },
    "peerDependencies": {
        "@ue-too/board": "^0.19.0",
        "@ue-too/curve": "^0.19.0",
        "@ue-too/math": "^0.19.0"
    },
    "devDependencies": {
        "@trivago/prettier-plugin-sort-imports": "^5.2.0",
        "@types/bun": "^1.3.0",
        "@ue-too/board": "0.19.0",
        "@ue-too/curve": "0.19.0",
        "@ue-too/math": "0.19.0",
        "prettier": "^3.5.3",
        "typescript": "^5.8.0"
    }
}
```

- [ ] **Step 3: Write `tsconfig.json` and `tsconfig.build.json`**

`tsconfig.json`:

```json
{
    "compilerOptions": {
        "declaration": true,
        "esModuleInterop": true,
        "isolatedModules": true,
        "module": "ESNext",
        "moduleResolution": "bundler",
        "noEmit": true,
        "skipLibCheck": true,
        "strict": true,
        "target": "ES2022",
        "types": ["bun"]
    },
    "include": ["src", "test", "scripts"]
}
```

`tsconfig.build.json`:

```json
{
    "extends": "./tsconfig.json",
    "compilerOptions": {
        "noEmit": false,
        "outDir": "dist",
        "rootDir": "src",
        "sourceMap": true,
        "types": []
    },
    "include": ["src"]
}
```

- [ ] **Step 4: Write `.prettierrc`, `.prettierignore` and `.gitignore`**

`.prettierrc`:

```json
{
    "arrowParens": "avoid",
    "bracketSpacing": true,
    "importOrder": ["<THIRD_PARTY_MODULES>", "^\\.\\.?/", "^\\.\\.?$"],
    "importOrderSeparation": true,
    "importOrderSortSpecifiers": true,
    "plugins": ["@trivago/prettier-plugin-sort-imports"],
    "printWidth": 80,
    "semi": true,
    "singleQuote": true,
    "tabWidth": 4,
    "trailingComma": "es5",
    "useTabs": false
}
```

`.prettierignore`:

```
dist
node_modules
.pack
bun.lock
package.json
docs
test/fixtures
```

`.gitignore`:

```
node_modules/
dist/
.pack/
*.tsbuildinfo
.DS_Store
```

- [ ] **Step 5: Write `.github/workflows/ci.yml`**

```yaml
name: CI

permissions:
    contents: read

on:
    push:
        branches: ['main']
    pull_request:
        branches: ['main']

jobs:
    check:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v4
            - uses: oven-sh/setup-bun@v2
              with:
                  bun-version: 1.3.13
            - run: bun install --frozen-lockfile
            - run: bun run format:check
            - run: bun run typecheck
            - run: bun test
            - run: bun run build
```

- [ ] **Step 6: Install**

Run: `cd /Users/vincent.yy.chang/dev/track/main && bun install`
Expected: the packages install and `bun.lock` is created.

- [ ] **Step 7: Write `scripts/banana-module-map.ts`**

```ts
/**
 * Where each module moved from banana (b26692b) now lives in track-layout.
 * Keys and values are repo-relative module ids without an extension.
 */
export const MODULE_MAP: Record<string, string> = {
    'src/utils': 'src/shared/entity-manager',
    'src/trains/r-tree': 'src/shared/r-tree',
    'src/trains/tracks/constants': 'src/tracks/constants',
    'src/trains/tracks/gauge-presets': 'src/tracks/gauge-presets',
    'src/trains/tracks/joint-direction-preference-map':
        'src/tracks/joint-direction-preference-map',
    'src/trains/tracks/parallel-spacing': 'src/tracks/parallel-spacing',
    'src/trains/tracks/track': 'src/tracks/track',
    'src/trains/tracks/trackcurve-manager': 'src/tracks/trackcurve-manager',
    'src/trains/tracks/trackjoint-manager': 'src/tracks/trackjoint-manager',
    'src/trains/tracks/types': 'src/tracks/types',
    'src/trains/tracks/utils': 'src/tracks/utils',
    'src/stations/arc-length-resolver': 'src/stations/arc-length-resolver',
    'src/stations/platform-offset': 'src/stations/platform-offset',
    'src/stations/spine-utils': 'src/stations/spine-utils',
    'src/stations/station-factory': 'src/stations/station-factory',
    'src/stations/station-manager': 'src/stations/station-manager',
    'src/stations/stop-position-utils': 'src/stations/stop-position-utils',
    'src/stations/track-aligned-platform-manager':
        'src/stations/track-aligned-platform-manager',
    'src/stations/track-aligned-platform-migration':
        'src/stations/track-aligned-platform-migration',
    'src/stations/track-aligned-platform-types':
        'src/stations/track-aligned-platform-types',
    'src/stations/types': 'src/stations/types',
};
```

- [ ] **Step 8: Write `scripts/port-from-banana.ts`**

```ts
#!/usr/bin/env bun
/**
 * Copies modules from a banana checkout into track-layout and rewrites
 * their import specifiers to track-layout's layout (relative, with `.js`).
 *
 * Usage:
 *   bun scripts/port-from-banana.ts <banana-root> <banana-file>=<track-layout-file> [...]
 *
 * Relative and `@/` specifiers that resolve to a module in MODULE_MAP are
 * rewritten. Package specifiers (e.g. `@ue-too/curve`) are left alone. Any
 * other specifier is left as-is and reported as UNMAPPED so it can be
 * handled by hand.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { MODULE_MAP } from './banana-module-map.js';

const REPO_ROOT = resolve(import.meta.dir, '..');

const SPECIFIER_PATTERNS = [
    /(\bfrom\s+)(['"])([^'"]+)\2/g,
    /(\bimport\s+)(['"])([^'"]+)\2/g,
    /(\bimport\s*\(\s*)(['"])([^'"]+)\2/g,
];

function toPosix(path: string): string {
    return path.split(sep).join('/');
}

function rewriteSpecifier(
    specifier: string,
    bananaRoot: string,
    sourceFile: string,
    destFile: string,
    unmapped: string[]
): string {
    let target: string;
    if (specifier.startsWith('@/')) {
        target = join(bananaRoot, 'src', specifier.slice(2));
    } else if (specifier.startsWith('.')) {
        target = resolve(dirname(sourceFile), specifier);
    } else {
        return specifier;
    }
    const moduleId = toPosix(relative(bananaRoot, target)).replace(
        /\.(ts|tsx|js)$/,
        ''
    );
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

function main(): void {
    const [bananaRootArg, ...pairs] = process.argv.slice(2);
    if (bananaRootArg === undefined || pairs.length === 0) {
        console.error(
            'usage: bun scripts/port-from-banana.ts <banana-root> <banana-file>=<track-layout-file> [...]'
        );
        process.exit(1);
    }
    const bananaRoot = resolve(bananaRootArg);
    let unmappedCount = 0;
    for (const pair of pairs) {
        const [from, to] = pair.split('=');
        if (from === undefined || to === undefined) {
            console.error(`bad pair: ${pair}`);
            process.exit(1);
        }
        const sourceFile = join(bananaRoot, from);
        const destFile = join(REPO_ROOT, to);
        const unmapped: string[] = [];
        let text = readFileSync(sourceFile, 'utf8');
        for (const pattern of SPECIFIER_PATTERNS) {
            text = text.replace(
                pattern,
                (_match, prefix: string, quote: string, specifier: string) =>
                    `${prefix}${quote}${rewriteSpecifier(specifier, bananaRoot, sourceFile, destFile, unmapped)}${quote}`
            );
        }
        mkdirSync(dirname(destFile), { recursive: true });
        writeFileSync(destFile, text);
        console.log(`ported ${from} -> ${to}`);
        for (const specifier of unmapped) {
            console.log(`  UNMAPPED ${specifier}`);
        }
        unmappedCount += unmapped.length;
    }
    console.log(`done; ${unmappedCount} unmapped specifier(s)`);
}

main();
```

- [ ] **Step 9: Write `scripts/repoint-banana-imports.ts`**

It is used in Task 13; it lives here with the other porting tool.

```ts
#!/usr/bin/env bun
/**
 * Rewrites imports in a banana checkout so that modules which moved to
 * track-layout are imported from the `track-layout` package instead.
 *
 * Usage:
 *   bun scripts/repoint-banana-imports.ts <banana-root>
 *
 * Scans every .ts/.tsx file under <banana-root>/src and <banana-root>/test.
 * An import or export-from statement is repointed when its specifier
 * resolves to a moved module. banana's `src/utils` only lost
 * GenericEntityManager, so imports from it are repointed only when
 * GenericEntityManager is the sole imported name.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { MODULE_MAP } from './banana-module-map.js';

const PACKAGE_NAME = 'track-layout';
const PARTIALLY_MOVED = 'src/utils';

const STATEMENT_PATTERN =
    /\b(import|export)(\s+(?:type\s+)?)(\{[^}]*\}|\*(?:\s+as\s+\w+)?|\w+)(\s+from\s+)(['"])([^'"]+)\5/g;

function listSourceFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
            files.push(...listSourceFiles(path));
        } else if (/\.(ts|tsx)$/.test(entry)) {
            files.push(path);
        }
    }
    return files;
}

function moduleIdFor(
    specifier: string,
    bananaRoot: string,
    file: string
): string | null {
    let target: string;
    if (specifier.startsWith('@/')) {
        target = join(bananaRoot, 'src', specifier.slice(2));
    } else if (specifier.startsWith('.')) {
        target = resolve(dirname(file), specifier);
    } else {
        return null;
    }
    return relative(bananaRoot, target)
        .split(sep)
        .join('/')
        .replace(/\.(ts|tsx|js)$/, '');
}

function shouldRepoint(moduleId: string, clause: string): boolean {
    if (moduleId === PARTIALLY_MOVED) {
        return /^\{\s*GenericEntityManager\s*,?\s*\}$/.test(clause.trim());
    }
    return moduleId in MODULE_MAP;
}

function main(): void {
    const bananaRootArg = process.argv[2];
    if (bananaRootArg === undefined) {
        console.error(
            'usage: bun scripts/repoint-banana-imports.ts <banana-root>'
        );
        process.exit(1);
    }
    const bananaRoot = resolve(bananaRootArg);
    const files = [
        ...listSourceFiles(join(bananaRoot, 'src')),
        ...listSourceFiles(join(bananaRoot, 'test')),
    ];
    let changedFiles = 0;
    for (const file of files) {
        const original = readFileSync(file, 'utf8');
        const updated = original.replace(
            STATEMENT_PATTERN,
            (
                match,
                keyword: string,
                space: string,
                clause: string,
                fromPart: string,
                quote: string,
                specifier: string
            ) => {
                const moduleId = moduleIdFor(specifier, bananaRoot, file);
                if (moduleId === null || !shouldRepoint(moduleId, clause)) {
                    return match;
                }
                return `${keyword}${space}${clause}${fromPart}${quote}${PACKAGE_NAME}${quote}`;
            }
        );
        if (updated !== original) {
            writeFileSync(file, updated);
            changedFiles++;
            console.log(`repointed ${relative(bananaRoot, file)}`);
        }
    }
    console.log(`done; ${changedFiles} file(s) changed`);
}

main();
```

- [ ] **Step 10: Port the leaf modules and their tests**

```bash
cd /Users/vincent.yy.chang/dev/track/main && bun scripts/port-from-banana.ts /Users/vincent.yy.chang/dev/banana/main \
  src/trains/tracks/constants.ts=src/tracks/constants.ts \
  src/trains/tracks/gauge-presets.ts=src/tracks/gauge-presets.ts \
  src/trains/tracks/parallel-spacing.ts=src/tracks/parallel-spacing.ts \
  src/trains/tracks/joint-direction-preference-map.ts=src/tracks/joint-direction-preference-map.ts \
  test/gauge-presets.test.ts=test/gauge-presets.test.ts \
  test/parallel-spacing.test.ts=test/parallel-spacing.test.ts \
  test/joint-direction-preference-map.test.ts=test/joint-direction-preference-map.test.ts
```

Expected: seven `ported …` lines, then `done; 0 unmapped specifier(s)`.

- [ ] **Step 11: Write `src/index.ts`**

```ts
export * from './tracks/constants.js';
export * from './tracks/gauge-presets.js';
export * from './tracks/joint-direction-preference-map.js';
export * from './tracks/parallel-spacing.js';
```

- [ ] **Step 12: Run the tests**

Run: `bun test`
Expected: `38 pass`, `0 fail` (gauge-presets 10, parallel-spacing 4, joint-direction-preference-map 24).

- [ ] **Step 13: Typecheck, build, format**

Run: `bun run typecheck && bun run build && ls dist && bun run format && bun run format:check`
Expected:
- `typecheck` prints nothing.
- `dist/` holds `index.js`, `index.d.ts` and `tracks/`.
- The last line is `All matched files use Prettier code style!`

- [ ] **Step 14: Commit**

```bash
git add -A && git commit -m "feat: scaffold track-layout and port the leaf track modules" -m "Ported from banana b26692b (src/trains/tracks/{constants,gauge-presets,parallel-spacing,joint-direction-preference-map}.ts and their tests). Adds the porting scripts used for the rest of the extraction."
```

---

### Task 2: Port the entity manager and the R-tree (without its demo)

**Files:**
- Create:
  - `src/shared/entity-manager.ts`: banana `src/utils.ts` lines 6–224
  - `src/shared/r-tree.ts`: banana `src/trains/r-tree.ts` lines 1–453, plus an export line
  - `test/r-tree.test.ts`
- Port: `test/entity-manager.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Produces: `GenericEntityManager<T>`, `RTree<T>` and `Rectangle`, exported from `src/shared/*` and the root.

- [ ] **Step 1: Confirm the source line ranges**

Run:

```bash
sed -n '6p;224p' /Users/vincent.yy.chang/dev/banana/main/src/utils.ts; sed -n '449p;453p;455p' /Users/vincent.yy.chang/dev/banana/main/src/trains/r-tree.ts
```

Expected, five lines:

```
export class GenericEntityManager<T> {
}
interface InsertResult<T> {
}
// Example usage and testing
```

If anything else prints, stop and report.

- [ ] **Step 2: Write the failing R-tree test** in `test/r-tree.test.ts`

```ts
import { describe, expect, it } from 'bun:test';

import { RTree, Rectangle } from '../src/shared/r-tree.js';

type Item = { id: string; x: number; y: number };

const ITEMS: Item[] = [
    { id: 'A', x: 1, y: 1 },
    { id: 'B', x: 2, y: 3 },
    { id: 'C', x: 5, y: 2 },
    { id: 'D', x: 8, y: 7 },
    { id: 'E', x: 3, y: 8 },
    { id: 'F', x: 6, y: 4 },
    { id: 'G', x: 9, y: 1 },
    { id: 'H', x: 2, y: 6 },
];

/** An R-tree (4 entries per node) holding each item as a 0.2 × 0.2 box. */
function treeWithItems(): RTree<Item> {
    const tree = new RTree<Item>(4);
    for (const item of ITEMS) {
        tree.insert(
            new Rectangle(
                item.x - 0.1,
                item.y - 0.1,
                item.x + 0.1,
                item.y + 0.1
            ),
            item
        );
    }
    return tree;
}

const ids = (items: Item[]) => items.map(item => item.id).sort();

describe('RTree', () => {
    it('holds every inserted item', () => {
        expect(ids(treeWithItems().getAllObjects())).toEqual(
            ITEMS.map(item => item.id)
        );
    });

    it('finds the items inside a search rectangle', () => {
        const tree = treeWithItems();
        expect(ids(tree.search(new Rectangle(0, 0, 4, 4)))).toEqual([
            'A',
            'B',
        ]);
    });

    it('removes an item by its data', () => {
        const tree = treeWithItems();
        expect(tree.removeByData(ITEMS[2])).toBe(true);
        expect(ids(tree.getAllObjects())).toEqual([
            'A',
            'B',
            'D',
            'E',
            'F',
            'G',
            'H',
        ]);
        expect(ids(tree.search(new Rectangle(4, 1, 6, 3)))).toEqual([]);
    });

    it('reports false when removing an item it does not hold', () => {
        const tree = treeWithItems();
        expect(tree.removeByData({ id: 'Z', x: 0, y: 0 })).toBe(false);
    });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `bun test test/r-tree.test.ts`
Expected: FAIL. The module `../src/shared/r-tree.js` can't be found.

- [ ] **Step 4: Create the two shared modules**

The R-tree keeps everything up to the demo (lines 1–453) and exports only `RTree` and `Rectangle`. The demo's `Point` interface and its `console.log` calls are gone.

```bash
cd /Users/vincent.yy.chang/dev/track/main && mkdir -p src/shared \
  && sed -n '6,224p' /Users/vincent.yy.chang/dev/banana/main/src/utils.ts > src/shared/entity-manager.ts \
  && { sed -n '1,453p' /Users/vincent.yy.chang/dev/banana/main/src/trains/r-tree.ts; echo; echo 'export { RTree, Rectangle };'; } > src/shared/r-tree.ts
```

- [ ] **Step 5: Port the entity-manager test and give it explicit test imports**

```bash
bun scripts/port-from-banana.ts /Users/vincent.yy.chang/dev/banana/main test/entity-manager.test.ts=test/entity-manager.test.ts
```

Expected: `done; 0 unmapped specifier(s)`.

Banana's version relies on global `describe`/`it`, so insert this as the first line of `test/entity-manager.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'bun:test';
```

- [ ] **Step 6: Export from the root.** Append to `src/index.ts`:

```ts
export * from './shared/entity-manager.js';
export * from './shared/r-tree.js';
```

- [ ] **Step 7: Run the tests**

Run: `bun test`
Expected: `59 pass`, `0 fail`. The output contains no "Points in rectangle" or "Remaining objects" lines, because the demo is gone.

- [ ] **Step 8: Typecheck, format, commit**

```bash
bun run typecheck && bun run format && bun run format:check \
  && git add -A && git commit -m "feat: port the entity manager and the R-tree" -m "From banana b26692b src/utils.ts (GenericEntityManager only) and src/trains/r-tree.ts. The R-tree's import-time demo is dropped and replaced by test/r-tree.test.ts."
```

---

### Task 3: Port the track model

**Files:**
- Port:
  - `src/tracks/types.ts`, `src/tracks/utils.ts`
  - `src/tracks/trackjoint-manager.ts`, `src/tracks/trackcurve-manager.ts`, `src/tracks/track.ts`
  - `test/serialization.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Produces, unchanged from banana:
  - `TrackGraph`, `SegmentSplitInfo`
  - `TrackCurveManager`, `TrackJointManager`
  - from `types.ts`: `ELEVATION`, `TrackSegment`, `SerializedTrackData`, `SerializedTrackSegment`, `ProjectionResult`, `validateSerializedTrackData`, and the rest
- `TrackGraph` methods later tasks use:
  - `createNewEmptyJoint(position, tangent, elevation?) => number`
  - `connectJoints(start, end, controlPoints, gauge?) => boolean`
  - `insertJointIntoTrackSegmentUsingTrackNumber(segment, t) => number | null`
  - `insertJointIntoTrackSegment(startJoint, endJoint, t)`
  - `removeTrackSegment(segment)`
  - `setSegmentProtectionCheck(fn)`
  - `getJoint(n)`, `getJoints()`, `getTrackSegmentWithJoints(n)`, `project(point)`, `jointIsEndingTrack(n)`
  - `serialize()`, `loadFromSerializedData(data, options?)`
  - `onSegmentSplit(cb)`, `onSegmentRemoved(cb)`
  - `trackSegments`, `trackCurveManager`

- [ ] **Step 1: Port the files**

```bash
cd /Users/vincent.yy.chang/dev/track/main && bun scripts/port-from-banana.ts /Users/vincent.yy.chang/dev/banana/main \
  src/trains/tracks/types.ts=src/tracks/types.ts \
  src/trains/tracks/utils.ts=src/tracks/utils.ts \
  src/trains/tracks/trackjoint-manager.ts=src/tracks/trackjoint-manager.ts \
  src/trains/tracks/trackcurve-manager.ts=src/tracks/trackcurve-manager.ts \
  src/trains/tracks/track.ts=src/tracks/track.ts \
  test/serialization.test.ts=test/serialization.test.ts
```

Expected: `done; 0 unmapped specifier(s)`.

- [ ] **Step 2: Add explicit test imports.** Insert this as the first line of `test/serialization.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'bun:test';
```

- [ ] **Step 3: Export from the root.** Append to `src/index.ts`:

```ts
export * from './tracks/track.js';
export * from './tracks/trackcurve-manager.js';
export * from './tracks/trackjoint-manager.js';
export * from './tracks/types.js';
export * from './tracks/utils.js';
```

- [ ] **Step 4: Run the tests**

Run: `bun test`
Expected: `101 pass`, `0 fail`.

- [ ] **Step 5: Typecheck, format, commit**

```bash
bun run typecheck && bun run format && bun run format:check \
  && git add -A && git commit -m "feat: port the track model" -m "TrackGraph, TrackCurveManager, TrackJointManager, track types and utils from banana b26692b, with the serialization tests."
```

---

### Task 4: Port the station model without its timetable code

**Files:**
- Port:
  - `src/stations/{types,stop-position-utils,station-manager,station-factory,track-aligned-platform-types,track-aligned-platform-migration,track-aligned-platform-manager,spine-utils,arc-length-resolver,platform-offset}.ts`
  - 11 test files (listed in Step 1)
- Modify:
  - `src/stations/station-manager.ts`, `src/stations/track-aligned-platform-manager.ts`
  - `test/station-manager-stop-crud.test.ts`, `test/track-aligned-platform-stop-crud.test.ts`
  - `test/station-manager-cascade.test.ts`, `test/track-aligned-platform-migration.test.ts`
  - `src/index.ts`

**Interfaces:**
- Produces: `StationManager`, `TrackAlignedPlatformManager`, `createIslandStation`, and the station and platform types and helpers, as in banana.
- Removes: `findShiftsReferencingStopPosition` from both managers. Banana re-adds it as free functions in Task 12.

- [ ] **Step 1: Port the files**

```bash
cd /Users/vincent.yy.chang/dev/track/main && bun scripts/port-from-banana.ts /Users/vincent.yy.chang/dev/banana/main \
  src/stations/types.ts=src/stations/types.ts \
  src/stations/stop-position-utils.ts=src/stations/stop-position-utils.ts \
  src/stations/station-manager.ts=src/stations/station-manager.ts \
  src/stations/station-factory.ts=src/stations/station-factory.ts \
  src/stations/track-aligned-platform-types.ts=src/stations/track-aligned-platform-types.ts \
  src/stations/track-aligned-platform-migration.ts=src/stations/track-aligned-platform-migration.ts \
  src/stations/track-aligned-platform-manager.ts=src/stations/track-aligned-platform-manager.ts \
  src/stations/spine-utils.ts=src/stations/spine-utils.ts \
  src/stations/arc-length-resolver.ts=src/stations/arc-length-resolver.ts \
  src/stations/platform-offset.ts=src/stations/platform-offset.ts \
  test/arc-length-resolver.test.ts=test/arc-length-resolver.test.ts \
  test/platform-offset.test.ts=test/platform-offset.test.ts \
  test/spine-utils.test.ts=test/spine-utils.test.ts \
  test/stop-position-utils.test.ts=test/stop-position-utils.test.ts \
  test/station-manager-cascade.test.ts=test/station-manager-cascade.test.ts \
  test/station-manager-change-notification.test.ts=test/station-manager-change-notification.test.ts \
  test/track-aligned-platform-manager.test.ts=test/track-aligned-platform-manager.test.ts \
  test/track-aligned-platform-migration.test.ts=test/track-aligned-platform-migration.test.ts \
  test/scene-dual-spine-station-link.test.ts=test/scene-dual-spine-station-link.test.ts \
  test/station-manager-stop-crud.test.ts=test/station-manager-stop-crud.test.ts \
  test/track-aligned-platform-stop-crud.test.ts=test/track-aligned-platform-stop-crud.test.ts
```

Expected: `done; 8 unmapped specifier(s)`. Exactly these are flagged:
- `@/timetable/shift-template-manager` and `@/timetable/types`, under both `station-manager.ts` and `track-aligned-platform-manager.ts`
- `../src/timetable/shift-template-manager` and `../src/timetable/types`, under both `*-stop-crud.test.ts` files

- [ ] **Step 2: Strip the timetable code from `src/stations/station-manager.ts`**

Delete these two import lines:

```ts
import type { ShiftTemplateManager } from '@/timetable/shift-template-manager';
import type { ShiftTemplate } from '@/timetable/types';
```

Then delete this method and its doc comment, plus one adjacent blank line:

```ts
    /**
     * Return the list of shift templates whose scheduled stops reference the
     * given stop position on an island platform. Used by the editor panel to
     * surface a deletion guard before removing a referenced stop.
     */
    findShiftsReferencingStopPosition(
        stationId: number,
        platformId: number,
        stopPositionId: number,
        shiftTemplateManager: ShiftTemplateManager
    ): ShiftTemplate[] {
        const result: ShiftTemplate[] = [];
        for (const template of shiftTemplateManager.getAllTemplates()) {
            for (const stop of template.stops) {
                if (
                    stop.platformKind === 'island' &&
                    stop.stationId === stationId &&
                    stop.platformId === platformId &&
                    stop.stopPositionId === stopPositionId
                ) {
                    result.push(template);
                    break;
                }
            }
        }
        return result;
    }
```

- [ ] **Step 3: Strip the timetable code from `src/stations/track-aligned-platform-manager.ts`**

Delete these two import lines:

```ts
import type { ShiftTemplateManager } from '@/timetable/shift-template-manager';
import type { ShiftTemplate } from '@/timetable/types';
```

Then delete this method, plus one adjacent blank line:

```ts
    findShiftsReferencingStopPosition(
        platformId: number,
        stopPositionId: number,
        shiftTemplateManager: ShiftTemplateManager
    ): ShiftTemplate[] {
        const result: ShiftTemplate[] = [];
        for (const template of shiftTemplateManager.getAllTemplates()) {
            for (const stop of template.stops) {
                if (
                    stop.platformKind === 'trackAligned' &&
                    stop.platformId === platformId &&
                    stop.stopPositionId === stopPositionId
                ) {
                    result.push(template);
                    break;
                }
            }
        }
        return result;
    }
```

- [ ] **Step 4: Strip the timetable cases from the two stop-crud tests**

In `test/station-manager-stop-crud.test.ts`:
- Delete the imports `import { ShiftTemplateManager } from '../src/timetable/shift-template-manager';` and `import { DayOfWeek } from '../src/timetable/types';`.
- Delete everything from the line `describe('StationManager.findShiftsReferencingStopPosition', () => {` to the end of the file. That's 2 tests.

In `test/track-aligned-platform-stop-crud.test.ts`:
- Delete the same two imports.
- Delete everything from `describe('TrackAlignedPlatformManager.findShiftsReferencingStopPosition', () => {` to the end of the file. That's 3 tests.

Each file must still end with a single newline after the last remaining `});`.

- [ ] **Step 5: Fix the stale test typings** (banana never typechecked its tests)

In `test/station-manager-cascade.test.ts`, the helper builds platforms in the legacy two-spine shape. Replace:

```ts
        spineA: segments.map(seg => ({
            trackSegment: seg,
            tStart: 0,
            tEnd: 1,
            side: 1 as const,
        })),
        spineB: null,
        offset: 2.0,
        outerVertices: {
            kind: 'single',
            vertices: [
                { x: 0, y: 5 },
                { x: 10, y: 5 },
            ],
        },
        stopPositions: [],
```

with:

```ts
        spine: segments.map(seg => ({
            trackSegment: seg,
            tStart: 0,
            tEnd: 1,
            side: 1 as const,
        })),
        offset: 2.0,
        outerVertices: [
            { x: 0, y: 5 },
            { x: 10, y: 5 },
        ],
        stopPositions: [],
```

In `test/track-aligned-platform-migration.test.ts`, replace:

```ts
        expect(faceB.spine).toEqual(legacy.spineB);
```

with:

```ts
        expect(faceB.spine).toEqual(legacy.spineB!);
```

- [ ] **Step 6: Export from the root.** Append to `src/index.ts`:

```ts
export * from './stations/arc-length-resolver.js';
export * from './stations/platform-offset.js';
export * from './stations/spine-utils.js';
export * from './stations/station-factory.js';
export * from './stations/station-manager.js';
export * from './stations/stop-position-utils.js';
export * from './stations/track-aligned-platform-manager.js';
export * from './stations/track-aligned-platform-migration.js';
export * from './stations/track-aligned-platform-types.js';
export * from './stations/types.js';
```

- [ ] **Step 7: Verify that no timetable code is left**

Run: `grep -rn "timetable\|findShifts\|ShiftTemplate" src test`
Expected: exactly one hit. It's a comment in `src/stations/track-aligned-platform-manager.ts` that reads "…so the caller can rewrite timetable references."

- [ ] **Step 8: Run the tests and the typecheck**

Run: `bun test && bun run typecheck`
Expected: `218 pass`, `0 fail`, and typecheck prints nothing.

- [ ] **Step 9: Format and commit**

```bash
bun run format && bun run format:check \
  && git add -A && git commit -m "feat: port the station model without timetable code" -m "Station and track-aligned platform managers, factory, spine and stop helpers from banana b26692b. findShiftsReferencingStopPosition stays with banana's timetable. Two ported tests get typing fixes (legacy spineA/spineB shape; nullable spineB)."
```

---

### Task 5: Golden save file from the verbatim port

The port is still banana's model code, unchanged. Saving a layout now produces exactly what banana `b26692b` would have saved.

**Files:**
- Create:
  - `scripts/generate-golden-fixture.ts`
  - `test/fixtures/banana-scene-b26692b.json` (generated)
  - `test/golden-scene.test.ts`

**Interfaces:**
- Consumes:
  - `TrackGraph`
  - `StationManager.createStation`, `StationManager.deserialize`
  - `TrackAlignedPlatformManager.createPlatform`, `TrackAlignedPlatformManager.deserialize`
  - `JointDirectionPreferenceMap.set`, `JointDirectionPreferenceMap.deserialize`
  - `createIslandStation(graph, stationManager, options)`
- Produces: the fixture `{ source, tracks, stations, trackAlignedPlatforms, jointDirectionPreferences }`. Task 8 changes the golden test's expectation.

- [ ] **Step 1: Write `scripts/generate-golden-fixture.ts`**

```ts
#!/usr/bin/env bun
/**
 * Generates test/fixtures/banana-scene-b26692b.json: a layout saved by the
 * verbatim port of banana's model code (banana b26692b), before any
 * track-layout changes. The golden-scene test loads it and saves it again to
 * prove old banana saves keep loading.
 *
 * Run once, right after the verbatim port, and commit the output. Re-running
 * it after the model changes would produce a different file.
 *
 * Usage: bun scripts/generate-golden-fixture.ts
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createIslandStation } from '../src/stations/station-factory.js';
import { StationManager } from '../src/stations/station-manager.js';
import { TrackAlignedPlatformManager } from '../src/stations/track-aligned-platform-manager.js';
import { JointDirectionPreferenceMap } from '../src/tracks/joint-direction-preference-map.js';
import { TrackGraph } from '../src/tracks/track.js';
import { ELEVATION } from '../src/tracks/types.js';

const GAUGE = 1.067;

// Straight track is a quadratic curve whose control point is the midpoint;
// @ue-too/curve cannot compute bounds for two-point (linear) curves.

function segmentBetween(graph: TrackGraph, a: number, b: number): number {
    const segment = graph.getJoint(a)?.connections.get(b);
    if (segment === undefined) {
        throw new Error(`no segment between joints ${a} and ${b}`);
    }
    return segment;
}

const graph = new TrackGraph();
const east = { x: 1, y: 0 };
const north = { x: 0, y: 1 };

// Main line A-B, then a curve B-C.
const a = graph.createNewEmptyJoint({ x: 0, y: 0 }, east, ELEVATION.GROUND);
const b = graph.createNewEmptyJoint({ x: 100, y: 0 }, east, ELEVATION.GROUND);
const c = graph.createNewEmptyJoint(
    { x: 200, y: 50 },
    east,
    ELEVATION.GROUND
);
graph.connectJoints(a, b, [{ x: 50, y: 0 }], GAUGE);
graph.connectJoints(b, c, [{ x: 150, y: 0 }], GAUGE);

// Branch off the middle of A-B: splits it at M, then M-D diverges.
const abSegment = segmentBetween(graph, a, b);
const m = graph.insertJointIntoTrackSegmentUsingTrackNumber(abSegment, 0.5);
if (m === null) {
    throw new Error('split failed');
}
const d = graph.createNewEmptyJoint(
    { x: 100, y: -40 },
    { x: 1, y: -1 },
    ELEVATION.GROUND
);
graph.connectJoints(m, d, [{ x: 80, y: 0 }], GAUGE);

// Elevated line crossing the main line.
const e = graph.createNewEmptyJoint(
    { x: 75, y: -80 },
    north,
    ELEVATION.ABOVE_1
);
const f = graph.createNewEmptyJoint(
    { x: 75, y: 80 },
    north,
    ELEVATION.ABOVE_1
);
graph.connectJoints(e, f, [{ x: 75, y: 0 }], GAUGE);

// Sloped ramp.
const g = graph.createNewEmptyJoint(
    { x: 200, y: -50 },
    east,
    ELEVATION.GROUND
);
const h = graph.createNewEmptyJoint(
    { x: 300, y: -50 },
    east,
    ELEVATION.ABOVE_1
);
graph.connectJoints(g, h, [{ x: 250, y: -50 }], GAUGE);

// Styles, written the way banana's renderer stamped them onto segments.
const bc = graph.getTrackSegmentWithJoints(segmentBetween(graph, b, c))!;
bc.trackStyle = 'slab';
const md = graph.getTrackSegmentWithJoints(segmentBetween(graph, m, d))!;
md.electrified = true;
md.catenarySide = -1;
const gh = graph.getTrackSegmentWithJoints(segmentBetween(graph, g, h))!;
gh.bed = true;

// Stations.
const stationManager = new StationManager();
createIslandStation(graph, stationManager, {
    position: { x: 0, y: 200 },
    direction: east,
    length: 120,
    elevation: ELEVATION.GROUND,
    name: 'Island',
});

const bcNumber = segmentBetween(graph, b, c);
const riverside = stationManager.createStation({
    name: 'Riverside',
    position: { x: 150, y: 10 },
    elevation: ELEVATION.GROUND,
    platforms: [],
    trackSegments: [bcNumber],
    joints: [],
    trackAlignedPlatforms: [],
});
const platformManager = new TrackAlignedPlatformManager();
const platformId = platformManager.createPlatform({
    stationId: riverside,
    spine: [{ trackSegment: bcNumber, tStart: 0.2, tEnd: 0.8, side: 1 }],
    offset: 2.5,
    outerVertices: [
        { x: 120, y: 5 },
        { x: 170, y: 15 },
    ],
    stopPositions: [
        {
            id: 0,
            trackSegmentId: bcNumber,
            direction: 'tangent',
            tValue: 0.5,
        },
    ],
});
stationManager.getStation(riverside)!.trackAlignedPlatforms.push(platformId);

// Joint direction preferences at the junction.
const preferences = new JointDirectionPreferenceMap();
preferences.set(m, 'tangent', b);
preferences.set(m, 'reverseTangent', a);

const fixture = {
    source: 'banana b26692b model code, verbatim port; scripts/generate-golden-fixture.ts',
    tracks: graph.serialize(),
    stations: stationManager.serialize(),
    trackAlignedPlatforms: platformManager.serialize(),
    jointDirectionPreferences: preferences.serialize(),
};

const out = join(
    import.meta.dir,
    '..',
    'test',
    'fixtures',
    'banana-scene-b26692b.json'
);
writeFileSync(out, `${JSON.stringify(fixture, null, 4)}\n`);
console.log(`wrote ${out}`);
```

- [ ] **Step 2: Generate the fixture and sanity-check it**

```bash
cd /Users/vincent.yy.chang/dev/track/main && mkdir -p test/fixtures && bun scripts/generate-golden-fixture.ts \
  && bun -e "const f = await Bun.file('test/fixtures/banana-scene-b26692b.json').json(); console.log(f.tracks.joints.length, f.tracks.segments.length, f.stations.stations.length, f.trackAlignedPlatforms.platforms.length, f.jointDirectionPreferences.length)"
```

Expected:
- The model code's debug logging may print some lines (`connectJoints …`, `Max entities reached…`).
- Then a `wrote …/banana-scene-b26692b.json` line.
- Then `13 8 2 1 1`.

- [ ] **Step 3: Write `test/golden-scene.test.ts`**

```ts
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { StationManager } from '../src/stations/station-manager.js';
import { TrackAlignedPlatformManager } from '../src/stations/track-aligned-platform-manager.js';
import { JointDirectionPreferenceMap } from '../src/tracks/joint-direction-preference-map.js';
import { TrackGraph } from '../src/tracks/track.js';

const fixture = JSON.parse(
    readFileSync(
        join(import.meta.dir, 'fixtures', 'banana-scene-b26692b.json'),
        'utf8'
    )
);

/** A JSON round trip drops undefined fields, like saving a scene to disk does. */
function asSaved<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
}

describe('golden banana scene (b26692b)', () => {
    it('reloads and re-saves the tracks unchanged', async () => {
        const graph = new TrackGraph();
        await graph.loadFromSerializedData(fixture.tracks);
        expect(asSaved(graph.serialize())).toEqual(fixture.tracks);
    });

    it('reloads and re-saves the stations unchanged', () => {
        const manager = StationManager.deserialize(fixture.stations);
        expect(asSaved(manager.serialize())).toEqual(fixture.stations);
    });

    it('reloads and re-saves the track-aligned platforms unchanged', () => {
        const manager = TrackAlignedPlatformManager.deserialize(
            fixture.trackAlignedPlatforms
        );
        expect(asSaved(manager.serialize())).toEqual(
            fixture.trackAlignedPlatforms
        );
    });

    it('reloads and re-saves the joint direction preferences unchanged', () => {
        const preferences = JointDirectionPreferenceMap.deserialize(
            fixture.jointDirectionPreferences
        );
        expect(asSaved(preferences.serialize())).toEqual(
            fixture.jointDirectionPreferences
        );
    });
});
```

- [ ] **Step 4: Run it**

Run: `bun test test/golden-scene.test.ts && bun test`
Expected: `4 pass` for the file, then `222 pass`, `0 fail` overall. This test is a regression guard and passes against the verbatim port by construction. Task 8 changes its tracks expectation.

- [ ] **Step 5: Typecheck, format, commit**

```bash
bun run typecheck && bun run format && bun run format:check \
  && git add -A && git commit -m "test: golden save file from the verbatim banana model" -m "scripts/generate-golden-fixture.ts saves a representative layout (mid-segment branch, elevated crossing, sloped ramp, slab/electrified/bed styles, island station, track-aligned platform, joint preferences) with banana b26692b's model code, before any change."
```

---

### Task 6: Characterization tests for the graph operations

**Files:**
- Create: `test/track-graph-operations.test.ts`

**Interfaces:**
- Consumes: the `TrackGraph` methods listed in Task 3, plus the `SegmentSplitInfo` type.

- [ ] **Step 1: Write `test/track-graph-operations.test.ts`**

```ts
import { describe, expect, it } from 'bun:test';

import { type SegmentSplitInfo, TrackGraph } from '../src/tracks/track.js';
import { ELEVATION } from '../src/tracks/types.js';

const EAST = { x: 1, y: 0 };

/**
 * A(0,0) — B(100,0): one straight segment along +x. Straight track is a
 * quadratic curve whose control point is the midpoint.
 */
function straightLine(gauge = 1.067) {
    const graph = new TrackGraph();
    const a = graph.createNewEmptyJoint({ x: 0, y: 0 }, EAST);
    const b = graph.createNewEmptyJoint({ x: 100, y: 0 }, EAST);
    graph.connectJoints(a, b, [{ x: 50, y: 0 }], gauge);
    const ab = graph.getJoint(a)!.connections.get(b)!;
    return { graph, a, b, ab };
}

/**
 * A — M — B along +x with a branch M — D diverging on M's tangent side, so
 * M is a switch: tangent side {B, D}, reverse-tangent side {A}.
 */
function junction() {
    const { graph, a, b, ab } = straightLine();
    const m = graph.insertJointIntoTrackSegmentUsingTrackNumber(ab, 0.5)!;
    const d = graph.createNewEmptyJoint({ x: 100, y: -40 }, { x: 1, y: -1 });
    graph.connectJoints(m, d, [{ x: 80, y: 0 }]);
    const am = graph.getJoint(a)!.connections.get(m)!;
    const mb = graph.getJoint(m)!.connections.get(b)!;
    const md = graph.getJoint(m)!.connections.get(d)!;
    return { graph, a, b, m, d, am, mb, md };
}

describe('TrackGraph.connectJoints', () => {
    it('creates a segment and records it on both joints', () => {
        const { graph, a, b, ab } = straightLine();
        expect(graph.getJoint(b)!.connections.get(a)).toBe(ab);
        expect(graph.getTrackSegmentWithJoints(ab)).not.toBeNull();
    });

    it('files the neighbour on the side its tangent points to', () => {
        const { graph, a, b } = straightLine();
        expect([...graph.getJoint(a)!.direction.tangent]).toEqual([b]);
        expect([...graph.getJoint(a)!.direction.reverseTangent]).toEqual([]);
        expect([...graph.getJoint(b)!.direction.reverseTangent]).toEqual([
            a,
        ]);
        expect([...graph.getJoint(b)!.direction.tangent]).toEqual([]);
    });

    it('stores the gauge on the segment', () => {
        const { graph, ab } = straightLine(1.435);
        expect(graph.getTrackSegmentWithJoints(ab)!.gauge).toBe(1.435);
    });

    it('refuses to connect two joints that are already connected', () => {
        const { graph, a, b } = straightLine();
        expect(graph.connectJoints(a, b, [{ x: 50, y: 0 }])).toBe(false);
    });

    it('refuses an unknown joint', () => {
        const { graph, a } = straightLine();
        expect(graph.connectJoints(a, 999, [{ x: 10, y: 0 }])).toBe(false);
    });
});

describe('TrackGraph.insertJointIntoTrackSegmentUsingTrackNumber', () => {
    it('splits a flat segment and returns the new joint', () => {
        const { graph, a, b, ab } = straightLine();
        const m = graph.insertJointIntoTrackSegmentUsingTrackNumber(ab, 0.5);

        expect(m).not.toBeNull();
        expect(graph.getTrackSegmentWithJoints(ab)).toBeNull();
        expect(graph.getJoint(m!)!.position.x).toBeCloseTo(50);
        expect(graph.getJoint(m!)!.position.y).toBeCloseTo(0);
        expect(graph.getJoint(a)!.connections.has(b)).toBe(false);
        expect(graph.getJoint(a)!.connections.has(m!)).toBe(true);
        expect(graph.getJoint(b)!.connections.has(m!)).toBe(true);
    });

    it('notifies split subscribers with both new segments', () => {
        const { graph, ab } = straightLine();
        const events: SegmentSplitInfo[] = [];
        graph.onSegmentSplit(info => events.push(info));

        const m = graph.insertJointIntoTrackSegmentUsingTrackNumber(ab, 0.5);

        expect(events).toHaveLength(1);
        expect(events[0].oldSegmentNumber).toBe(ab);
        expect(events[0].splitT).toBe(0.5);
        expect(events[0].newJointNumber).toBe(m!);
        expect(
            graph.getTrackSegmentWithJoints(events[0].firstNewSegment)
        ).not.toBeNull();
        expect(
            graph.getTrackSegmentWithJoints(events[0].secondNewSegment)
        ).not.toBeNull();
    });

    it('keeps the gauge on both halves', () => {
        const { graph, ab } = straightLine(1.435);
        const events: SegmentSplitInfo[] = [];
        graph.onSegmentSplit(info => events.push(info));
        graph.insertJointIntoTrackSegmentUsingTrackNumber(ab, 0.5);
        const { firstNewSegment, secondNewSegment } = events[0];
        expect(graph.getTrackSegmentWithJoints(firstNewSegment)!.gauge).toBe(
            1.435
        );
        expect(graph.getTrackSegmentWithJoints(secondNewSegment)!.gauge).toBe(
            1.435
        );
    });

    it('refuses to split a sloped segment', () => {
        const graph = new TrackGraph();
        const a = graph.createNewEmptyJoint(
            { x: 0, y: 0 },
            EAST,
            ELEVATION.GROUND
        );
        const b = graph.createNewEmptyJoint(
            { x: 100, y: 0 },
            EAST,
            ELEVATION.ABOVE_1
        );
        graph.connectJoints(a, b, [{ x: 50, y: 0 }]);
        const ab = graph.getJoint(a)!.connections.get(b)!;
        let splits = 0;
        graph.onSegmentSplit(() => splits++);

        expect(
            graph.insertJointIntoTrackSegmentUsingTrackNumber(ab, 0.5)
        ).toBeNull();
        expect(graph.getTrackSegmentWithJoints(ab)).not.toBeNull();
        expect(splits).toBe(0);
    });

    it('returns null for an unknown segment', () => {
        const { graph } = straightLine();
        expect(
            graph.insertJointIntoTrackSegmentUsingTrackNumber(999, 0.5)
        ).toBeNull();
    });
});

describe('TrackGraph.insertJointIntoTrackSegment', () => {
    it('splits the segment between two connected joints', () => {
        const { graph, a, b, ab } = straightLine();
        let splits = 0;
        graph.onSegmentSplit(() => splits++);

        graph.insertJointIntoTrackSegment(a, b, 0.5);

        expect(splits).toBe(1);
        expect(graph.getTrackSegmentWithJoints(ab)).toBeNull();
        expect(graph.getJoint(a)!.connections.has(b)).toBe(false);
    });
});

describe('TrackGraph.removeTrackSegment', () => {
    it('removes the segment and deletes joints left with no connections', () => {
        const { graph, a, b, ab } = straightLine();
        const removed: number[] = [];
        graph.onSegmentRemoved(segment => removed.push(segment));

        graph.removeTrackSegment(ab);

        expect(graph.getTrackSegmentWithJoints(ab)).toBeNull();
        expect(graph.getJoint(a)).toBeNull();
        expect(graph.getJoint(b)).toBeNull();
        expect(removed).toEqual([ab]);
    });

    it('keeps a segment the protection check reports as protected', () => {
        const { graph, ab } = straightLine();
        graph.setSegmentProtectionCheck(segment => segment === ab);
        const removed: number[] = [];
        graph.onSegmentRemoved(segment => removed.push(segment));

        graph.removeTrackSegment(ab);

        expect(graph.getTrackSegmentWithJoints(ab)).not.toBeNull();
        expect(removed).toEqual([]);
    });

    it('refuses to empty the single-track side of a switch', () => {
        const { graph, am } = junction();
        graph.removeTrackSegment(am);
        expect(graph.getTrackSegmentWithJoints(am)).not.toBeNull();
    });

    it('allows removing one leg of the branching side', () => {
        const { graph, m, b, d, mb } = junction();

        graph.removeTrackSegment(mb);

        expect(graph.getTrackSegmentWithJoints(mb)).toBeNull();
        expect(graph.getJoint(b)).toBeNull();
        expect([...graph.getJoint(m)!.direction.tangent]).toEqual([d]);
    });
});

describe('TrackGraph.project', () => {
    it('reports a joint hit at a joint position', () => {
        const { graph, a } = straightLine();
        const result = graph.project({ x: 0, y: 0 });
        expect(result.hit).toBe(true);
        if (result.hit && result.hitType === 'joint') {
            expect(result.jointNumber).toBe(a);
            expect(result.endingJoint).toBe(true);
        } else {
            throw new Error(
                `expected a joint hit, got ${JSON.stringify(result)}`
            );
        }
    });

    it('reports a curve hit on the track away from joints', () => {
        const { graph, ab } = straightLine();
        const result = graph.project({ x: 50, y: 0.2 });
        if (result.hit && result.hitType === 'curve') {
            expect(result.curve).toBe(ab);
            expect(result.atT).toBeCloseTo(0.5, 2);
        } else {
            throw new Error(
                `expected a curve hit, got ${JSON.stringify(result)}`
            );
        }
    });

    it('reports no hit far from any track', () => {
        const { graph } = straightLine();
        expect(graph.project({ x: 50, y: 30 })).toEqual({ hit: false });
    });
});

describe('TrackGraph.jointIsEndingTrack', () => {
    it('is true for a dead end and false for a switch', () => {
        const { graph, a, m } = junction();
        expect(graph.jointIsEndingTrack(a)).toBe(true);
        expect(graph.jointIsEndingTrack(m)).toBe(false);
    });
});
```

- [ ] **Step 2: Run it against the unchanged code**

Run: `bun test test/track-graph-operations.test.ts && bun test`
Expected: `19 pass` for the file, then `241 pass`, `0 fail` overall. If a case fails, see "Characterization tests" under Conventions.

- [ ] **Step 3: Typecheck, format, commit**

```bash
bun run typecheck && bun run format && bun run format:check \
  && git add -A && git commit -m "test: characterize TrackGraph connect, split, remove and project"
```

---

### Task 7: Refuse to split protected segments

**Files:**
- Create: `test/split-protection.test.ts`
- Modify: `src/tracks/track.ts`

**Interfaces:**
- Produces:
  - `TrackGraph.isSegmentProtected(segmentNumber: number): boolean`
  - `TrackGraph.insertJointIntoTrackSegment(start, end, atT): number | null`. It returns the new joint, or `null` when it refuses.
- Both split methods return `null` for a protected segment.

- [ ] **Step 1: Write the failing test** in `test/split-protection.test.ts`

```ts
import { describe, expect, it } from 'bun:test';

import { TrackGraph } from '../src/tracks/track.js';
import { ELEVATION } from '../src/tracks/types.js';

const EAST = { x: 1, y: 0 };

function straightLine() {
    const graph = new TrackGraph();
    const a = graph.createNewEmptyJoint({ x: 0, y: 0 }, EAST);
    const b = graph.createNewEmptyJoint({ x: 100, y: 0 }, EAST);
    graph.connectJoints(a, b, [{ x: 50, y: 0 }]);
    const ab = graph.getJoint(a)!.connections.get(b)!;
    return { graph, a, b, ab };
}

describe('TrackGraph.isSegmentProtected', () => {
    it('is false when no protection check is registered', () => {
        const { graph, ab } = straightLine();
        expect(graph.isSegmentProtected(ab)).toBe(false);
    });

    it('returns what the registered check reports', () => {
        const { graph, ab } = straightLine();
        graph.setSegmentProtectionCheck(segment => segment === ab);
        expect(graph.isSegmentProtected(ab)).toBe(true);
        expect(graph.isSegmentProtected(ab + 1)).toBe(false);
    });
});

describe('splitting a protected segment', () => {
    it('is refused by insertJointIntoTrackSegmentUsingTrackNumber', () => {
        const { graph, ab } = straightLine();
        graph.setSegmentProtectionCheck(() => true);
        let splits = 0;
        graph.onSegmentSplit(() => splits++);

        expect(
            graph.insertJointIntoTrackSegmentUsingTrackNumber(ab, 0.5)
        ).toBeNull();
        expect(graph.getTrackSegmentWithJoints(ab)).not.toBeNull();
        expect(graph.getJoints()).toHaveLength(2);
        expect(splits).toBe(0);
    });

    it('is refused by insertJointIntoTrackSegment', () => {
        const { graph, a, b, ab } = straightLine();
        graph.setSegmentProtectionCheck(() => true);
        let splits = 0;
        graph.onSegmentSplit(() => splits++);

        expect(graph.insertJointIntoTrackSegment(a, b, 0.5)).toBeNull();
        expect(graph.getTrackSegmentWithJoints(ab)).not.toBeNull();
        expect(graph.getJoints()).toHaveLength(2);
        expect(splits).toBe(0);
    });
});

describe('TrackGraph.insertJointIntoTrackSegment return value', () => {
    it('returns the new joint number on success', () => {
        const { graph, a, b } = straightLine();
        const m = graph.insertJointIntoTrackSegment(a, b, 0.5);
        expect(typeof m).toBe('number');
        expect(graph.getJoint(m!)!.connections.has(a)).toBe(true);
        expect(graph.getJoint(m!)!.connections.has(b)).toBe(true);
    });

    it('returns null for an unknown joint', () => {
        const { graph, a } = straightLine();
        expect(graph.insertJointIntoTrackSegment(a, 999, 0.5)).toBeNull();
    });

    it('returns null when the joints are not directly connected', () => {
        const { graph, a } = straightLine();
        const c = graph.createNewEmptyJoint({ x: 0, y: 50 }, EAST);
        expect(graph.insertJointIntoTrackSegment(a, c, 0.5)).toBeNull();
    });

    it('returns null for a sloped segment', () => {
        const graph = new TrackGraph();
        const a = graph.createNewEmptyJoint({ x: 0, y: 0 }, EAST);
        const b = graph.createNewEmptyJoint(
            { x: 100, y: 0 },
            EAST,
            ELEVATION.ABOVE_1
        );
        graph.connectJoints(a, b, [{ x: 50, y: 0 }]);
        expect(graph.insertJointIntoTrackSegment(a, b, 0.5)).toBeNull();
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test test/split-protection.test.ts`
Expected: `7 fail`, `1 pass`. The sloped case already returns `null`. The others fail with "isSegmentProtected is not a function" or because they receive `undefined`.

- [ ] **Step 3: Add `isSegmentProtected` to `src/tracks/track.ts`.** Replace:

```ts
    setSegmentProtectionCheck(check: (segmentNumber: number) => boolean): void {
        this._segmentProtectionCheck = check;
    }
```

with:

```ts
    setSegmentProtectionCheck(check: (segmentNumber: number) => boolean): void {
        this._segmentProtectionCheck = check;
    }

    /**
     * Whether the registered protection check reports the segment as
     * protected. Protected segments can be neither removed nor split.
     */
    isSegmentProtected(segmentNumber: number): boolean {
        return this._segmentProtectionCheck?.(segmentNumber) ?? false;
    }
```

- [ ] **Step 4: Guard `insertJointIntoTrackSegmentUsingTrackNumber`.** Replace:

```ts
        if (segment === null) {
            console.warn(
                'track segment number does not correspond to a track segment'
            );
            return null;
        }

        const newControlPointGroups = segment.curve.split(atT);
        const t0JointNumber = segment.t0Joint;
        const t1JointNumber = segment.t1Joint;

        const t0Joint = this._jointManager.getJoint(t0JointNumber);
```

with:

```ts
        if (segment === null) {
            console.warn(
                'track segment number does not correspond to a track segment'
            );
            return null;
        }

        if (this.isSegmentProtected(trackSegmentNumber)) {
            console.warn(
                `Cannot split segment ${trackSegmentNumber}: it is protected`
            );
            return null;
        }

        const newControlPointGroups = segment.curve.split(atT);
        const t0JointNumber = segment.t0Joint;
        const t1JointNumber = segment.t1Joint;

        const t0Joint = this._jointManager.getJoint(t0JointNumber);
```

- [ ] **Step 5: Give `insertJointIntoTrackSegment` a return contract and the guard**

Replace:

```ts
    insertJointIntoTrackSegment(
        startJointNumber: number,
        endJointNumber: number,
        atT: number
    ) {
        const startJoint = this._jointManager.getJoint(startJointNumber);
        const endJoint = this._jointManager.getJoint(endJointNumber);

        if (startJoint === null || endJoint === null) {
            console.warn('startJoint or endJoint not found');
            return;
        }
```

with:

```ts
    /**
     * Splits the segment between two directly connected joints at `atT`.
     * Returns the new joint's number, or null when the joints are unknown,
     * not directly connected, sloped, or the segment is protected.
     */
    insertJointIntoTrackSegment(
        startJointNumber: number,
        endJointNumber: number,
        atT: number
    ): number | null {
        const startJoint = this._jointManager.getJoint(startJointNumber);
        const endJoint = this._jointManager.getJoint(endJointNumber);

        if (startJoint === null || endJoint === null) {
            console.warn('startJoint or endJoint not found');
            return null;
        }
```

Then replace:

```ts
            console.warn(
                'trackSegment not found or not the correct track segment; something is wrong'
            );
            return;
        }

        const segment =
            this._trackCurveManager.getTrackSegmentWithJoints(
                trackSegmentNumber
            );

        if (segment === null) {
            console.warn(
                'track segment number does not correspond to a track segment'
            );
            return;
        }
```

with:

```ts
            console.warn(
                'trackSegment not found or not the correct track segment; something is wrong'
            );
            return null;
        }

        const segment =
            this._trackCurveManager.getTrackSegmentWithJoints(
                trackSegmentNumber
            );

        if (segment === null) {
            console.warn(
                'track segment number does not correspond to a track segment'
            );
            return null;
        }

        if (this.isSegmentProtected(trackSegmentNumber)) {
            console.warn(
                `Cannot split segment ${trackSegmentNumber}: it is protected`
            );
            return null;
        }
```

Then return the new joint at the end of that method. Replace:

```ts
            secondNewSegment: secondSegmentNumber,
            newJointNumber,
        });
    }

    get trackOffsets()
```

with:

```ts
            secondNewSegment: secondSegmentNumber,
            newJointNumber,
        });

        return newJointNumber;
    }

    get trackOffsets()
```

- [ ] **Step 6: Make `removeTrackSegment` use the same check.** Replace:

```ts
        if (
            this._segmentProtectionCheck !== null &&
            this._segmentProtectionCheck(trackSegmentNumber)
        ) {
            console.warn(
                `Cannot delete segment ${trackSegmentNumber}: protected by a track-aligned platform`
            );
            return;
        }
```

with:

```ts
        if (this.isSegmentProtected(trackSegmentNumber)) {
            console.warn(
                `Cannot delete segment ${trackSegmentNumber}: it is protected`
            );
            return;
        }
```

- [ ] **Step 7: Run the tests**

Run: `bun test test/split-protection.test.ts && bun test`
Expected: `8 pass` for the file, then `249 pass`, `0 fail` overall.

- [ ] **Step 8: Typecheck, format, commit**

```bash
bun run typecheck && bun run format && bun run format:check \
  && git add -A && git commit -m "fix(tracks): refuse to split protected segments" -m "Adds TrackGraph.isSegmentProtected, used by both split methods and removeTrackSegment. insertJointIntoTrackSegment now returns the new joint number or null."
```

---

### Task 8: Segment style lives in the model

**Files:**
- Create: `src/tracks/segment-style.ts`, `test/segment-style.test.ts`
- Modify:
  - `src/tracks/trackcurve-manager.ts`, `src/tracks/track.ts`, `src/tracks/types.ts`
  - `src/index.ts`
  - `test/golden-scene.test.ts`

**Interfaces:**
- Produces, from `src/tracks/segment-style.ts`:
  - `type SegmentStyle = { trackStyle: TrackStyle; electrified: boolean; catenarySide?: 1 | -1; bed: boolean; bedWidth: number }`
  - `type SegmentStyleFields = Pick<TrackSegment, 'trackStyle' | 'electrified' | 'catenarySide' | 'bed' | 'bedWidth'>`. All of its fields are optional.
  - `type SegmentStyleChange = { segmentNumber: number; style: SegmentStyleFields }`
  - `DEFAULT_SEGMENT_STYLE`
  - `segmentFieldsFromStyle(style: SegmentStyle): SegmentStyleFields`
  - `withStyleDefaults(saved: SegmentStyleFields): SegmentStyleFields`
  - `styleFieldsOf(segment: SegmentStyleFields): SegmentStyleFields`
- `TrackGraph` and `TrackCurveManager` both get:
  - `newSegmentStyle: Readonly<SegmentStyle>` (getter)
  - `setNewSegmentStyle(style: Partial<SegmentStyle>): void`
  - `setSegmentStyle(segmentNumber: number, patch: SegmentStyleFields): boolean`
  - `onSegmentStyleChanged(cb: (change: SegmentStyleChange) => void, options?)`
- Removed:
  - the `bedWidth`/`bedEnabled` accessors on `TrackGraph` and `TrackCurveManager`
  - `TrackCurveManager.getVisualPropsForSegment`
- Changed signatures:
  - `TrackCurveManager.createCurveWithJoints(curve, t0, t1, e0, e1, gauge?, exclude?, style?: SegmentStyleFields)`
  - `TrackCurveManager.loadSegmentWithId(..., splitTValues, style?: SegmentStyleFields)`
- Save format: `SerializedTrackSegment.bedWidth?: number`.

- [ ] **Step 1: Write the failing test** in `test/segment-style.test.ts`

```ts
import { BCurve } from '@ue-too/curve';
import { describe, expect, it } from 'bun:test';

import {
    DEFAULT_SEGMENT_STYLE,
    type SegmentStyleChange,
    type SegmentStyleFields,
} from '../src/tracks/segment-style.js';
import { type SegmentSplitInfo, TrackGraph } from '../src/tracks/track.js';
import {
    ELEVATION,
    type SerializedTrackData,
    validateSerializedTrackData,
} from '../src/tracks/types.js';

const EAST = { x: 1, y: 0 };

/** Lays a straight segment from (x0, y) to (x0 + 100, y) and returns its number. */
function layStraight(graph: TrackGraph, x0 = 0, y = 0): number {
    const a = graph.createNewEmptyJoint({ x: x0, y }, EAST);
    const b = graph.createNewEmptyJoint({ x: x0 + 100, y }, EAST);
    graph.connectJoints(a, b, [{ x: x0 + 50, y }]);
    return graph.getJoint(a)!.connections.get(b)!;
}

function styleOf(graph: TrackGraph, segment: number): SegmentStyleFields {
    const s = graph.getTrackSegmentWithJoints(segment)!;
    return {
        trackStyle: s.trackStyle,
        electrified: s.electrified,
        catenarySide: s.catenarySide,
        bed: s.bed,
        bedWidth: s.bedWidth,
    };
}

describe('DEFAULT_SEGMENT_STYLE', () => {
    it('is ballasted, not electrified, without a bed, bed width 3', () => {
        expect(DEFAULT_SEGMENT_STYLE).toEqual({
            trackStyle: 'ballasted',
            electrified: false,
            bed: false,
            bedWidth: 3,
        });
    });
});

describe('new segment style', () => {
    it('applies the defaults to new segments', () => {
        const graph = new TrackGraph();
        const segment = layStraight(graph);
        expect(styleOf(graph, segment)).toEqual({
            trackStyle: 'ballasted',
            electrified: false,
            catenarySide: undefined,
            bed: false,
            bedWidth: undefined,
        });
    });

    it('applies the style set with setNewSegmentStyle to later segments only', () => {
        const graph = new TrackGraph();
        const before = layStraight(graph, 0, 0);
        graph.setNewSegmentStyle({
            trackStyle: 'slab',
            electrified: true,
            catenarySide: 1,
        });
        const after = layStraight(graph, 0, 50);

        expect(styleOf(graph, before).trackStyle).toBe('ballasted');
        expect(styleOf(graph, after)).toEqual({
            trackStyle: 'slab',
            electrified: true,
            catenarySide: 1,
            bed: false,
            bedWidth: undefined,
        });
    });

    it('stores the bed width only while the bed is on', () => {
        const graph = new TrackGraph();
        graph.setNewSegmentStyle({ bedWidth: 4 });
        const withoutBed = layStraight(graph, 0, 0);
        graph.setNewSegmentStyle({ bed: true });
        const withBed = layStraight(graph, 0, 50);

        expect(styleOf(graph, withoutBed).bedWidth).toBeUndefined();
        expect(styleOf(graph, withBed)).toMatchObject({
            bed: true,
            bedWidth: 4,
        });
    });

    it('merges partial updates into newSegmentStyle', () => {
        const graph = new TrackGraph();
        graph.setNewSegmentStyle({ trackStyle: 'slab' });
        graph.setNewSegmentStyle({ bed: true });
        expect(graph.newSegmentStyle).toEqual({
            trackStyle: 'slab',
            electrified: false,
            bed: true,
            bedWidth: 3,
        });
    });

    it('clamps the bed width to at least 1 metre', () => {
        const graph = new TrackGraph();
        graph.setNewSegmentStyle({ bedWidth: 0.2 });
        expect(graph.newSegmentStyle.bedWidth).toBe(1);
    });

    it('is carried by preview draw data', () => {
        const graph = new TrackGraph();
        graph.setNewSegmentStyle({ trackStyle: 'slab', electrified: true });
        const preview = graph.trackCurveManager.getPreviewDrawData(
            new BCurve([
                { x: 0, y: 0 },
                { x: 50, y: 0 },
                { x: 100, y: 0 },
            ]),
            ELEVATION.GROUND,
            ELEVATION.GROUND
        );
        expect(preview.length).toBeGreaterThan(0);
        for (const { drawData } of preview) {
            expect(drawData.trackStyle).toBe('slab');
            expect(drawData.electrified).toBe(true);
        }
    });
});

describe('TrackGraph.setSegmentStyle', () => {
    it('updates the segment and notifies subscribers', () => {
        const graph = new TrackGraph();
        const segment = layStraight(graph);
        const changes: SegmentStyleChange[] = [];
        graph.onSegmentStyleChanged(change => changes.push(change));

        expect(
            graph.setSegmentStyle(segment, {
                electrified: true,
                catenarySide: -1,
            })
        ).toBe(true);

        expect(styleOf(graph, segment)).toMatchObject({
            electrified: true,
            catenarySide: -1,
        });
        expect(changes).toEqual([
            {
                segmentNumber: segment,
                style: {
                    trackStyle: 'ballasted',
                    electrified: true,
                    catenarySide: -1,
                    bed: false,
                    bedWidth: undefined,
                },
            },
        ]);
    });

    it('updates the draw data renderers read', () => {
        const graph = new TrackGraph();
        const segment = layStraight(graph);
        graph.setSegmentStyle(segment, { trackStyle: 'slab' });
        const drawData = graph.trackCurveManager.persistedDrawData.filter(
            entry => entry.originalTrackSegment.trackSegmentNumber === segment
        );
        expect(drawData.length).toBeGreaterThan(0);
        for (const entry of drawData) {
            expect(entry.trackStyle).toBe('slab');
        }
    });

    it('returns false and stays silent for an unknown segment', () => {
        const graph = new TrackGraph();
        let changes = 0;
        graph.onSegmentStyleChanged(() => changes++);
        expect(graph.setSegmentStyle(999, { electrified: true })).toBe(false);
        expect(changes).toBe(0);
    });

    it('widens edge snapping when a bed width is added', () => {
        const graph = new TrackGraph();
        const segment = layStraight(graph);
        // 1.8 m from the centreline is outside the edge-snap band of a bare
        // track (gauge/2 + gauge/2 + 0.5 buffer = 1.567 m) but inside it once
        // the segment has a 4 m bed (2 + 0.53 + 0.5 = 3.03 m).
        const probe = { x: 50, y: 1.8 };
        expect(graph.project(probe).hit).toBe(false);

        graph.setSegmentStyle(segment, { bed: true, bedWidth: 4 });

        const result = graph.project(probe);
        expect(result.hit && result.hitType).toBe('edge');
    });
});

describe('style on split segments', () => {
    it('copies the parent segment style to both halves', () => {
        const graph = new TrackGraph();
        const segment = layStraight(graph);
        graph.setSegmentStyle(segment, {
            trackStyle: 'slab',
            electrified: true,
            catenarySide: 1,
            bed: true,
            bedWidth: 5,
        });
        const splits: SegmentSplitInfo[] = [];
        graph.onSegmentSplit(info => splits.push(info));

        graph.insertJointIntoTrackSegmentUsingTrackNumber(segment, 0.5);

        const expected: SegmentStyleFields = {
            trackStyle: 'slab',
            electrified: true,
            catenarySide: 1,
            bed: true,
            bedWidth: 5,
        };
        expect(styleOf(graph, splits[0].firstNewSegment)).toEqual(expected);
        expect(styleOf(graph, splits[0].secondNewSegment)).toEqual(expected);
    });
});

describe('saving and loading style', () => {
    it('round-trips every style field without a renderer', async () => {
        const graph = new TrackGraph();
        graph.setNewSegmentStyle({
            trackStyle: 'slab',
            electrified: true,
            catenarySide: -1,
            bed: true,
            bedWidth: 4.5,
        });
        const segment = layStraight(graph);
        const saved = JSON.parse(JSON.stringify(graph.serialize()));

        expect(saved.segments[0]).toMatchObject({
            trackStyle: 'slab',
            electrified: true,
            catenarySide: -1,
            bed: true,
            bedWidth: 4.5,
        });

        const restored = new TrackGraph();
        await restored.loadFromSerializedData(saved);
        expect(styleOf(restored, segment)).toEqual({
            trackStyle: 'slab',
            electrified: true,
            catenarySide: -1,
            bed: true,
            bedWidth: 4.5,
        });
    });

    it('fills in defaults for saves without style fields', async () => {
        const graph = new TrackGraph();
        const plain = layStraight(graph, 0, 0);
        const bedded = layStraight(graph, 0, 50);
        const saved: SerializedTrackData = JSON.parse(
            JSON.stringify(graph.serialize())
        );
        for (const segment of saved.segments) {
            delete segment.trackStyle;
            delete segment.electrified;
            delete segment.catenarySide;
            delete segment.bed;
            delete segment.bedWidth;
        }
        saved.segments.find(s => s.segmentNumber === bedded)!.bed = true;

        const restored = new TrackGraph();
        await restored.loadFromSerializedData(saved);

        expect(styleOf(restored, plain)).toEqual({
            trackStyle: 'ballasted',
            electrified: false,
            catenarySide: undefined,
            bed: false,
            bedWidth: undefined,
        });
        expect(styleOf(restored, bedded)).toMatchObject({
            bed: true,
            bedWidth: 3,
        });
    });
});

describe('validateSerializedTrackData bedWidth', () => {
    function withBedWidth(bedWidth: unknown) {
        const graph = new TrackGraph();
        layStraight(graph);
        const saved = JSON.parse(JSON.stringify(graph.serialize()));
        saved.segments[0].bedWidth = bedWidth;
        return saved;
    }

    it('accepts a positive bed width', () => {
        expect(validateSerializedTrackData(withBedWidth(3))).toEqual({
            valid: true,
        });
    });

    it('rejects a non-positive or non-numeric bed width', () => {
        for (const bad of [0, -1, '3']) {
            expect(validateSerializedTrackData(withBedWidth(bad))).toEqual({
                valid: false,
                error: 'segments[0].bedWidth must be a positive number',
            });
        }
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test test/segment-style.test.ts`
Expected: FAIL. `../src/tracks/segment-style.js` can't be found.

- [ ] **Step 3: Create `src/tracks/segment-style.ts`**

```ts
import type { TrackSegment, TrackStyle } from './types.js';

/** Appearance applied to segments when they are created. */
export type SegmentStyle = {
    trackStyle: TrackStyle;
    electrified: boolean;
    /** Side of the catenary masts (1 = left, -1 = right of the curve direction). */
    catenarySide?: 1 | -1;
    bed: boolean;
    /** Bed width in metres, applied to new segments while `bed` is on. */
    bedWidth: number;
};

/** The style fields stored on each segment and saved with it. */
export type SegmentStyleFields = Pick<
    TrackSegment,
    'trackStyle' | 'electrified' | 'catenarySide' | 'bed' | 'bedWidth'
>;

/** Payload of TrackGraph.onSegmentStyleChanged. */
export type SegmentStyleChange = {
    segmentNumber: number;
    style: SegmentStyleFields;
};

export const DEFAULT_SEGMENT_STYLE: Readonly<SegmentStyle> = Object.freeze({
    trackStyle: 'ballasted',
    electrified: false,
    bed: false,
    bedWidth: 3,
});

/**
 * The fields stored on a segment laid with `style`. The bed width is only
 * stored while the bed is on, because snapping, parallel spacing and platform
 * offsets treat a stored bed width as the track's footprint.
 */
export function segmentFieldsFromStyle(
    style: SegmentStyle
): SegmentStyleFields {
    return {
        trackStyle: style.trackStyle,
        electrified: style.electrified,
        catenarySide: style.catenarySide,
        bed: style.bed,
        bedWidth: style.bed ? style.bedWidth : undefined,
    };
}

/** Fills style fields missing from a saved segment (older saves) with defaults. */
export function withStyleDefaults(
    saved: SegmentStyleFields
): SegmentStyleFields {
    const bed = saved.bed ?? DEFAULT_SEGMENT_STYLE.bed;
    return {
        trackStyle: saved.trackStyle ?? DEFAULT_SEGMENT_STYLE.trackStyle,
        electrified: saved.electrified ?? DEFAULT_SEGMENT_STYLE.electrified,
        catenarySide: saved.catenarySide,
        bed,
        bedWidth:
            saved.bedWidth ??
            (bed ? DEFAULT_SEGMENT_STYLE.bedWidth : undefined),
    };
}

/** Copies just the style fields off a segment. */
export function styleFieldsOf(segment: SegmentStyleFields): SegmentStyleFields {
    return {
        trackStyle: segment.trackStyle,
        electrified: segment.electrified,
        catenarySide: segment.catenarySide,
        bed: segment.bed,
        bedWidth: segment.bedWidth,
    };
}
```

- [ ] **Step 4: Edit `src/tracks/trackcurve-manager.ts`: imports and fields**

Replace:

```ts
import { LEVEL_HEIGHT } from './constants.js';
```

with:

```ts
import { LEVEL_HEIGHT } from './constants.js';
import {
    DEFAULT_SEGMENT_STYLE,
    type SegmentStyle,
    type SegmentStyleChange,
    type SegmentStyleFields,
    segmentFieldsFromStyle,
    styleFieldsOf,
    withStyleDefaults,
} from './segment-style.js';
```

Replace:

```ts
    TrackSegmentWithCollisionAndNumber,
    TrackStyle,
} from './types.js';
```

with:

```ts
    TrackSegmentWithCollisionAndNumber,
} from './types.js';
```

Replace:

```ts
    private _removeTrackSegmentObservable: Observable<[number]> =
        new SynchronousObservable<[number]>();
```

with:

```ts
    private _removeTrackSegmentObservable: Observable<[number]> =
        new SynchronousObservable<[number]>();
    private _segmentStyleChangedObservable: Observable<[SegmentStyleChange]> =
        new SynchronousObservable<[SegmentStyleChange]>();
```

Replace:

```ts
    /** Total width of the gravel bed foundation for newly created tracks. Used for snapping when bed is enabled. */
    private _bedWidth: number = 3;
    /** Whether the bed layer is enabled (affects snapping distance). */
    private _bedEnabled: boolean = false;
```

with:

```ts
    /** Style applied to newly created segments. Its bed settings also size snapping for the track being laid. */
    private _newSegmentStyle: SegmentStyle = { ...DEFAULT_SEGMENT_STYLE };
```

- [ ] **Step 5: Edit `src/tracks/trackcurve-manager.ts`: style API in place of the bed accessors**

Replace:

```ts
    /** Get the current bed width for newly created tracks. */
    get bedWidth(): number {
        return this._bedWidth;
    }

    /** Set the bed width for newly created tracks (affects snapping). */
    set bedWidth(value: number) {
        this._bedWidth = Math.max(1, value);
    }

    /** Whether the bed layer is enabled for snapping. */
    get bedEnabled(): boolean {
        return this._bedEnabled;
    }

    /** Toggle bed layer for snapping. When off, snapping uses gauge only. */
    set bedEnabled(value: boolean) {
        this._bedEnabled = value;
    }
```

with:

```ts
    /** Style applied to segments created from now on. */
    get newSegmentStyle(): Readonly<SegmentStyle> {
        return this._newSegmentStyle;
    }

    /** Merges `style` into the style for new segments. The bed width is clamped to at least 1 m. */
    setNewSegmentStyle(style: Partial<SegmentStyle>): void {
        const next = { ...this._newSegmentStyle, ...style };
        next.bedWidth = Math.max(1, next.bedWidth);
        this._newSegmentStyle = next;
    }

    /**
     * Changes the style of an existing segment: the segment, its spatial-index
     * entry and its draw data. Returns false when the segment does not exist.
     */
    setSegmentStyle(segmentNumber: number, patch: SegmentStyleFields): boolean {
        const entity = this._internalTrackCurveManager.getEntity(segmentNumber);
        if (entity === null) {
            return false;
        }
        Object.assign(entity.segment, patch);
        const treeEntry = this._treeEntryFor(
            segmentNumber,
            entity.segment.curve
        );
        if (treeEntry !== undefined) {
            Object.assign(treeEntry, patch);
        }
        for (const drawData of this._persistedDrawData) {
            if (
                drawData.originalTrackSegment.trackSegmentNumber ===
                segmentNumber
            ) {
                Object.assign(drawData, patch);
            }
        }
        this._segmentStyleChangedObservable.notify({
            segmentNumber,
            style: styleFieldsOf(entity.segment),
        });
        return true;
    }

    onSegmentStyleChanged(
        callback: (change: SegmentStyleChange) => void,
        options?: SubscriptionOptions
    ) {
        return this._segmentStyleChangedObservable.subscribe(callback, options);
    }

    private _treeEntryFor(
        segmentNumber: number,
        curve: BCurve
    ): TrackSegmentWithCollisionAndNumber | undefined {
        const aabb = curve.AABB;
        return this._internalRTree
            .search(
                new Rectangle(aabb.min.x, aabb.min.y, aabb.max.x, aabb.max.y)
            )
            .find(entry => entry.trackSegmentNumber === segmentNumber);
    }
```

Then delete the whole `getVisualPropsForSegment(segmentNumber: number): … { … }` method. It starts at the line `    getVisualPropsForSegment(segmentNumber: number):` and ends just before `    getTrackSegment(segmentNumber: number): BCurve | null {`.

- [ ] **Step 6: Edit `src/tracks/trackcurve-manager.ts`: snapping, creation, preview, removal**

In `onTrackSegmentEdge`, replace:

```ts
                const newWidth = this._bedEnabled
                    ? this._bedWidth
                    : trackSegment.gauge;
```

with:

```ts
                const newWidth = this._newSegmentStyle.bed
                    ? this._newSegmentStyle.bedWidth
                    : trackSegment.gauge;
```

In `createCurveWithJoints`, replace the parameters:

```ts
        gauge: number = 1.067,
        excludeSegmentsForCollisionCheck: Set<number> = new Set(),
        bedWidth?: number,
        visualProps?: {
            trackStyle?: TrackStyle;
            electrified?: boolean;
            catenarySide?: 1 | -1;
            bed?: boolean;
        }
    ): number {
```

with:

```ts
        gauge: number = 1.067,
        excludeSegmentsForCollisionCheck: Set<number> = new Set(),
        /** Style for the new segment; defaults to the new-segment style. Splits pass the parent's style. */
        style: SegmentStyleFields = segmentFieldsFromStyle(
            this._newSegmentStyle
        )
    ): number {
```

and replace the segment entry fields:

```ts
            collision: collisions,
            gauge,
            bedWidth:
                bedWidth ?? (this._bedEnabled ? this._bedWidth : undefined),
            trackStyle: visualProps?.trackStyle,
            electrified: visualProps?.electrified,
            catenarySide: visualProps?.catenarySide,
            bed: visualProps?.bed,
            splits: insertionT,
            splitCurves: splits,
        };
```

with:

```ts
            collision: collisions,
            gauge,
            ...styleFieldsOf(style),
            splits: insertionT,
            splitCurves: splits,
        };
```

In `getPreviewDrawData`, replace:

```ts
            t0Joint: -1,
            t1Joint: -1,
            elevation: {
                from: t0Elevation,
                to: t1Elevation,
            },
            collision: collisions,
            gauge,
            splits: insertionT,
            splitCurves: splits,
        };
```

with:

```ts
            t0Joint: -1,
            t1Joint: -1,
            elevation: {
                from: t0Elevation,
                to: t1Elevation,
            },
            collision: collisions,
            gauge,
            ...segmentFieldsFromStyle(this._newSegmentStyle),
            splits: insertionT,
            splitCurves: splits,
        };
```

In `destroyCurve`, replace:

```ts
        const rectangle = new Rectangle(
            trackSegment.segment.curve.AABB.min.x,
            trackSegment.segment.curve.AABB.min.y,
            trackSegment.segment.curve.AABB.max.x,
            trackSegment.segment.curve.AABB.max.y
        );
        const trackSegmentTreeEntry = this._internalRTree
            .search(rectangle)
            .find(segment => segment.trackSegmentNumber === curveNumber);
```

with:

```ts
        const trackSegmentTreeEntry = this._treeEntryFor(
            curveNumber,
            trackSegment.segment.curve
        );
```

- [ ] **Step 7: Edit `src/tracks/trackcurve-manager.ts`: save and load**

In `serialize`, replace:

```ts
            .map(({ index, entity }) => {
                const visualProps = this.getVisualPropsForSegment(index);
                return {
```

with:

```ts
            .map(({ index, entity }) => {
                return {
```

and replace:

```ts
                    trackStyle:
                        entity.segment.trackStyle ?? visualProps?.trackStyle,
                    electrified:
                        entity.segment.electrified ?? visualProps?.electrified,
                    catenarySide:
                        entity.segment.catenarySide ??
                        visualProps?.catenarySide,
                    bed: entity.segment.bed ?? visualProps?.bed,
                };
```

with:

```ts
                    trackStyle: entity.segment.trackStyle,
                    electrified: entity.segment.electrified,
                    catenarySide: entity.segment.catenarySide,
                    bed: entity.segment.bed,
                    bedWidth: entity.segment.bedWidth,
                };
```

In `loadSegmentWithId`, replace the parameters:

```ts
        splitTValues: number[],
        visualProps?: {
            trackStyle?: TrackStyle;
            electrified?: boolean;
            catenarySide?: 1 | -1;
            bed?: boolean;
        }
    ): void {
```

with:

```ts
        splitTValues: number[],
        /** Saved style; missing fields get the defaults. */
        style: SegmentStyleFields = {}
    ): void {
```

and replace the entry fields:

```ts
            collision: collisions,
            gauge,
            trackStyle: visualProps?.trackStyle,
            electrified: visualProps?.electrified,
            catenarySide: visualProps?.catenarySide,
            bed: visualProps?.bed,
            splits: splitTValues,
            splitCurves: splits,
        };
```

with:

```ts
            collision: collisions,
            gauge,
            ...withStyleDefaults(style),
            splits: splitTValues,
            splitCurves: splits,
        };
```

In the static `deserialize`, replace:

```ts
                {
                    trackStyle: segment.trackStyle,
                    electrified: segment.electrified,
                    catenarySide: segment.catenarySide,
                    bed: segment.bed,
                }
            );
        }
        return manager;
```

with:

```ts
                {
                    trackStyle: segment.trackStyle,
                    electrified: segment.electrified,
                    catenarySide: segment.catenarySide,
                    bed: segment.bed,
                    bedWidth: segment.bedWidth,
                }
            );
        }
        return manager;
```

- [ ] **Step 8: Edit `src/tracks/track.ts`**

Replace:

```ts
import { LEVEL_HEIGHT } from './constants.js';
```

with:

```ts
import { LEVEL_HEIGHT } from './constants.js';
import {
    type SegmentStyle,
    type SegmentStyleChange,
    type SegmentStyleFields,
    styleFieldsOf,
} from './segment-style.js';
```

Splits copy the parent's style from the segment. This block appears twice, once in each split method; replace both occurrences:

```ts
        const originalGauge = segment.gauge;
        const originalBedWidth = segment.bedWidth;
        const originalVisualProps =
            this._trackCurveManager.getVisualPropsForSegment(
                trackSegmentNumber
            );
```

with:

```ts
        const originalGauge = segment.gauge;
        const originalStyle = styleFieldsOf(segment);
```

This block appears four times, in the two `createCurveWithJoints` calls of each split method; replace all four occurrences:

```ts
                originalGauge,
                new Set(),
                originalBedWidth,
                originalVisualProps
            );
```

with:

```ts
                originalGauge,
                new Set(),
                originalStyle
            );
```

Replace the bed accessors:

```ts
    /** Total width of the gravel bed foundation for newly laid tracks (meters). Affects snapping. */
    get bedWidth(): number {
        return this._trackCurveManager.bedWidth;
    }

    set bedWidth(value: number) {
        this._trackCurveManager.bedWidth = value;
    }

    get bedEnabled(): boolean {
        return this._trackCurveManager.bedEnabled;
    }

    set bedEnabled(value: boolean) {
        this._trackCurveManager.bedEnabled = value;
    }
```

with:

```ts
    /** Style applied to segments created from now on. */
    get newSegmentStyle(): Readonly<SegmentStyle> {
        return this._trackCurveManager.newSegmentStyle;
    }

    /** Merges `style` into the style for new segments. */
    setNewSegmentStyle(style: Partial<SegmentStyle>): void {
        this._trackCurveManager.setNewSegmentStyle(style);
    }

    /** Changes an existing segment's style. Returns false for an unknown segment. */
    setSegmentStyle(segmentNumber: number, patch: SegmentStyleFields): boolean {
        return this._trackCurveManager.setSegmentStyle(segmentNumber, patch);
    }

    /** Subscribe to style changes made with setSegmentStyle. */
    onSegmentStyleChanged(
        callback: (change: SegmentStyleChange) => void,
        options?: SubscriptionOptions
    ) {
        return this._trackCurveManager.onSegmentStyleChanged(
            callback,
            options
        );
    }
```

In `loadFromSerializedData`, replace:

```ts
                        catenarySide: segment.catenarySide,
                        bed: segment.bed,
                    }
                );
```

with:

```ts
                        catenarySide: segment.catenarySide,
                        bed: segment.bed,
                        bedWidth: segment.bedWidth,
                    }
                );
```

- [ ] **Step 9: Edit `src/tracks/types.ts`**

Replace:

```ts
    trackStyle?: TrackStyle;
    electrified?: boolean;
    catenarySide?: 1 | -1;
    bed?: boolean;
};

export type SerializedTrackData = {
```

with:

```ts
    trackStyle?: TrackStyle;
    electrified?: boolean;
    catenarySide?: 1 | -1;
    bed?: boolean;
    /** Bed width in metres; present on segments laid with a bed. */
    bedWidth?: number;
};

export type SerializedTrackData = {
```

Replace:

```ts
            return {
                valid: false,
                error: `${prefix}.splits must be a number[]`,
            };
        }
    }

    return { valid: true };
```

with:

```ts
            return {
                valid: false,
                error: `${prefix}.splits must be a number[]`,
            };
        }
        if (
            s.bedWidth !== undefined &&
            (typeof s.bedWidth !== 'number' || !(s.bedWidth > 0))
        ) {
            return {
                valid: false,
                error: `${prefix}.bedWidth must be a positive number`,
            };
        }
    }

    return { valid: true };
```

- [ ] **Step 10: Export from the root.** In `src/index.ts`, after the line `export * from './tracks/parallel-spacing.js';`, add:

```ts
export * from './tracks/segment-style.js';
```

- [ ] **Step 11: Run the style tests, then everything**

Run: `bun test test/segment-style.test.ts`
Expected: `16 pass`, `0 fail`.

Run: `bun test`
Expected: exactly one failure, `golden banana scene (b26692b) > reloads and re-saves the tracks unchanged`. Loading now fills in style defaults, which is intended.

- [ ] **Step 12: Update the golden expectation.** In `test/golden-scene.test.ts`, replace:

```ts
    it('reloads and re-saves the tracks unchanged', async () => {
        const graph = new TrackGraph();
        await graph.loadFromSerializedData(fixture.tracks);
        expect(asSaved(graph.serialize())).toEqual(fixture.tracks);
    });
```

with:

```ts
    it('reloads the tracks, filling in style defaults', async () => {
        const graph = new TrackGraph();
        await graph.loadFromSerializedData(fixture.tracks);

        // b26692b saves omit style on unstyled segments and never include
        // bedWidth. Loading fills both in (bedWidth only where bed is on).
        const expected = structuredClone(fixture.tracks);
        for (const segment of expected.segments) {
            segment.trackStyle ??= 'ballasted';
            segment.electrified ??= false;
            segment.bed ??= false;
            if (segment.bed) {
                segment.bedWidth ??= 3;
            }
        }
        expect(asSaved(graph.serialize())).toEqual(expected);
    });
```

- [ ] **Step 13: Run everything**

Run: `bun test && bun run typecheck`
Expected: `265 pass`, `0 fail`; typecheck prints nothing.

- [ ] **Step 14: Format and commit**

```bash
bun run format && bun run format:check \
  && git add -A && git commit -m "feat(tracks): keep segment style in the model" -m "New segments get the new-segment style (setNewSegmentStyle), existing ones change with setSegmentStyle (segment, R-tree entry and draw data; fires onSegmentStyleChanged). Splits copy the parent's style, preview draw data carries the new-segment style, and saves include bedWidth. Loading fills in defaults; bedWidth is stored only while bed is on. Replaces the bedEnabled/bedWidth accessors and getVisualPropsForSegment."
```

---

### Task 9: Load in batches without calling requestAnimationFrame directly

**Files:**
- Create: `test/load-batching.test.ts`
- Modify: `src/tracks/track.ts`

**Interfaces:**
- Produces:
  - `defaultYieldToFrame(): Promise<void>`, exported from `src/tracks/track.ts`
  - `loadFromSerializedData(data, { batchSize?, onProgress?, yieldToFrame? })`

- [ ] **Step 1: Write the failing test** in `test/load-batching.test.ts`

```ts
import { describe, expect, it } from 'bun:test';

import { TrackGraph } from '../src/tracks/track.js';
import type { SerializedTrackData } from '../src/tracks/types.js';

const EAST = { x: 1, y: 0 };

/** A save holding three parallel straight segments. */
function savedThreeSegments(): SerializedTrackData {
    const graph = new TrackGraph();
    for (const y of [0, 50, 100]) {
        const a = graph.createNewEmptyJoint({ x: 0, y }, EAST);
        const b = graph.createNewEmptyJoint({ x: 100, y }, EAST);
        graph.connectJoints(a, b, [{ x: 50, y }]);
    }
    return JSON.parse(JSON.stringify(graph.serialize()));
}

describe('TrackGraph.loadFromSerializedData batching', () => {
    it('calls yieldToFrame between batches and reports progress', async () => {
        const graph = new TrackGraph();
        let yields = 0;
        const progress: [number, number][] = [];

        await graph.loadFromSerializedData(savedThreeSegments(), {
            batchSize: 1,
            yieldToFrame: async () => {
                yields++;
            },
            onProgress: (loaded, total) => progress.push([loaded, total]),
        });

        expect(yields).toBe(2);
        expect(progress).toEqual([
            [1, 3],
            [2, 3],
            [3, 3],
        ]);
        expect(graph.trackSegments).toHaveLength(3);
    });

    it('loads in batches outside a browser by default', async () => {
        expect(typeof globalThis.requestAnimationFrame).toBe('undefined');
        const graph = new TrackGraph();

        await graph.loadFromSerializedData(savedThreeSegments(), {
            batchSize: 1,
        });

        expect(graph.trackSegments).toHaveLength(3);
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test test/load-batching.test.ts`
Expected: `2 fail`, both with `ReferenceError: requestAnimationFrame is not defined`.

- [ ] **Step 3: Add `defaultYieldToFrame` to `src/tracks/track.ts`.** Replace:

```ts
export type SegmentSplitInfo = {
```

with:

```ts
/**
 * Waits until the browser has painted (two animation frames), so progress UI
 * updates between loading batches. Outside a browser it waits one macrotask.
 */
export function defaultYieldToFrame(): Promise<void> {
    if (typeof requestAnimationFrame === 'function') {
        return new Promise(resolve =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        );
    }
    return new Promise(resolve => setTimeout(resolve, 0));
}

export type SegmentSplitInfo = {
```

- [ ] **Step 4: Use it in `loadFromSerializedData`.** Replace:

```ts
        options?: {
            batchSize?: number;
            onProgress?: (loaded: number, total: number) => void;
        }
    ): Promise<void> {
```

with:

```ts
        options?: {
            batchSize?: number;
            onProgress?: (loaded: number, total: number) => void;
            /** Awaited between batches; defaults to defaultYieldToFrame. */
            yieldToFrame?: () => Promise<void>;
        }
    ): Promise<void> {
```

Replace:

```ts
        const BATCH_SIZE = options?.batchSize ?? 50;
```

with:

```ts
        const BATCH_SIZE = options?.batchSize ?? 50;
        const yieldToFrame = options?.yieldToFrame ?? defaultYieldToFrame;
```

Replace:

```ts
            if (end < segments.length) {
                // Use double-rAF to guarantee the browser paints the progress
                // update before resuming the next batch of segment loading.
                await new Promise<void>(resolve =>
                    requestAnimationFrame(() =>
                        requestAnimationFrame(() => resolve())
                    )
                );
            }
```

with:

```ts
            if (end < segments.length) {
                await yieldToFrame();
            }
```

- [ ] **Step 5: Run the tests**

Run: `bun test test/load-batching.test.ts && bun test && bun run typecheck`
Expected: `2 pass` for the file, then `267 pass`, `0 fail` overall; typecheck prints nothing.

- [ ] **Step 6: Format and commit**

```bash
bun run format && bun run format:check \
  && git add -A && git commit -m "feat(tracks): injectable yield between loading batches" -m "loadFromSerializedData takes yieldToFrame; the default uses double requestAnimationFrame in a browser and setTimeout(0) elsewhere, so loading works outside the browser."
```

---

### Task 10: Package surface, README and local pack

**Files:**
- Create: `test/package-entry.test.ts`, `README.md`
- Modify: `package.json` (adds `description` and `license`)

- [ ] **Step 1: Write the public-surface guard test** in `test/package-entry.test.ts`

```ts
import { describe, expect, it } from 'bun:test';

import * as trackLayout from '../src/index.js';

describe('package entry', () => {
    it('exposes the model API', () => {
        for (const name of [
            'TrackGraph',
            'TrackCurveManager',
            'TrackJointManager',
            'GenericEntityManager',
            'RTree',
            'Rectangle',
            'JointDirectionPreferenceMap',
            'StationManager',
            'TrackAlignedPlatformManager',
            'createIslandStation',
            'validateSerializedTrackData',
            'DEFAULT_SEGMENT_STYLE',
            'defaultYieldToFrame',
            'ELEVATION',
        ]) {
            expect(trackLayout).toHaveProperty(name);
        }
    });
});
```

- [ ] **Step 2: Run it**

Run: `bun test test/package-entry.test.ts && bun test`
Expected: `1 pass`, then `268 pass`, `0 fail` across 23 files. It passes immediately because Tasks 1–9 built the index; it guards against later regressions.

- [ ] **Step 3: Add `description` and `license` to `package.json`.** After the `"version"` line, insert:

```json
    "description": "Railway track layout model: a Bezier track graph with junctions and elevation, stations and platforms, and save/load.",
    "license": "MIT",
```

MIT matches ue-too. Task 16 asks the owner to confirm it before publishing.

- [ ] **Step 4: Write `README.md`**

````markdown
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
````

- [ ] **Step 5: Check what would be published**

Run: `bun run build && bun pm pack --dry-run`
Expected:
- Only `package.json`, `README.md` and `dist/**` are listed: `Total files: 71`.
- Nothing from `src/`, `test/`, `scripts/` or `docs/`.

- [ ] **Step 6: Build the local tarball**

Run: `bun run pack:local && ls -la .pack`
Expected: `.pack/track-layout-local.tgz` exists. Git ignores it.

- [ ] **Step 7: Full check and commit**

```bash
bun run format && bun run format:check && bun run typecheck && bun test \
  && git add -A && git commit -m "docs: README and package metadata; guard the public surface"
```

---

### Task 11 (banana): Upgrade @ue-too to 0.19 and pixi.js to 8.20.1

**Files:**
- Modify: BN `package.json`, BN `bun.lock`

- [ ] **Step 1: Branch and record the baseline**

```bash
cd /Users/vincent.yy.chang/dev/banana/main && git checkout -b feat/track-layout-phase-1 \
  && bun test 2>&1 | grep -E "^ *[0-9]+ (pass|fail)" \
  && bunx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"
```

Expected: `948 pass`, `0 fail`, then `11`.

- [ ] **Step 2: Bump the versions**

```bash
sed -i '' -E 's/"(@ue-too\/[a-z-]+)": "\^0\.17\.3"/"\1": "^0.19.0"/; s/"pixi.js": "8.14.0"/"pixi.js": "8.20.1"/' package.json \
  && grep -E '"@ue-too|"pixi.js"' package.json
```

Expected: ten `@ue-too/*` lines at `"^0.19.0"` (animate, being, board, board-pixi-integration, board-pixi-react-integration, border, curve, dynamics, ecs, math) and `"pixi.js": "8.20.1"`.

- [ ] **Step 3: Install and verify**

```bash
bun install && bun test 2>&1 | grep -E "^ *[0-9]+ (pass|fail)" \
  && bunx tsc --noEmit -p tsconfig.json 2>&1 | grep "error TS" | sed -E 's/\(([0-9]+),[0-9]+\)//' | sort | uniq -c \
  && bun run build 2>&1 | tail -1 && bun run format:check | tail -1
```

Expected:
- `948 pass`, `0 fail`.
- The 11 pre-existing errors listed in Global Constraints, and no others.
- The build finishes (a chunk-size warning is normal).
- Prettier is clean.

- [ ] **Step 4: Owner play-test (STOP and ask)**

Ask the owner to run `bun run dev` and check:
- pan, zoom and rotate the board
- lay straight and curved track, and branch off a track
- place an island station and a track-aligned platform
- electrify a segment with the catenary tool
- run a train across a junction
- open the train editor and the terrain editor pages

Continue only after the owner confirms.

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock && git commit -m "chore(deps): upgrade @ue-too to 0.19 and pixi.js to 8.20.1" -m "@ue-too/board-pixi-integration 0.18+ requires exactly pixi.js 8.20.1. Tests, typecheck and build are unchanged."
```

---

### Task 12 (banana): Look up stop-position references in the timetable module

**Files:**
- Create: BN `src/timetable/stop-position-references.ts`, BN `test/stop-position-references.test.ts`
- Modify:
  - BN `src/components/toolbar/PlatformEditorPanel.tsx`
  - BN `src/stations/station-manager.ts`, BN `src/stations/track-aligned-platform-manager.ts`
  - BN `test/station-manager-stop-crud.test.ts`, BN `test/track-aligned-platform-stop-crud.test.ts`

**Interfaces:**
- Produces:
  - `findShiftsReferencingIslandStop(shiftTemplateManager, stationId, platformId, stopPositionId): ShiftTemplate[]`
  - `findShiftsReferencingTrackAlignedStop(shiftTemplateManager, platformId, stopPositionId): ShiftTemplate[]`

- [ ] **Step 1: Write the failing test** in BN `test/stop-position-references.test.ts`

```ts
import { describe, expect, it } from 'bun:test';

import { ShiftTemplateManager } from '../src/timetable/shift-template-manager';
import {
    findShiftsReferencingIslandStop,
    findShiftsReferencingTrackAlignedStop,
} from '../src/timetable/stop-position-references';
import { DayOfWeek, type ShiftTemplate } from '../src/timetable/types';

function templateStoppingAt(
    stop: Pick<
        ShiftTemplate['stops'][number],
        'stationId' | 'platformKind' | 'platformId' | 'stopPositionId'
    >
): ShiftTemplate {
    return {
        id: 's1',
        name: 'S1',
        activeDays: {
            [DayOfWeek.Monday]: true,
            [DayOfWeek.Tuesday]: false,
            [DayOfWeek.Wednesday]: false,
            [DayOfWeek.Thursday]: false,
            [DayOfWeek.Friday]: false,
            [DayOfWeek.Saturday]: false,
            [DayOfWeek.Sunday]: false,
        },
        stops: [{ ...stop, arrivalTime: null, departureTime: 100 }],
        legs: [],
    };
}

describe('findShiftsReferencingIslandStop', () => {
    it('returns templates whose scheduled stops match', () => {
        const stm = new ShiftTemplateManager();
        stm.addTemplate(
            templateStoppingAt({
                stationId: 0,
                platformKind: 'island',
                platformId: 0,
                stopPositionId: 0,
            })
        );
        const refs = findShiftsReferencingIslandStop(stm, 0, 0, 0);
        expect(refs).toHaveLength(1);
        expect(refs[0].id).toBe('s1');
    });

    it('returns empty when no template references the stop', () => {
        const stm = new ShiftTemplateManager();
        expect(findShiftsReferencingIslandStop(stm, 0, 0, 0)).toHaveLength(0);
    });
});

describe('findShiftsReferencingTrackAlignedStop', () => {
    it('returns templates whose scheduled stops match', () => {
        const stm = new ShiftTemplateManager();
        stm.addTemplate(
            templateStoppingAt({
                stationId: 1,
                platformKind: 'trackAligned',
                platformId: 4,
                stopPositionId: 1,
            })
        );
        const refs = findShiftsReferencingTrackAlignedStop(stm, 4, 1);
        expect(refs).toHaveLength(1);
        expect(refs[0].id).toBe('s1');
    });

    it('returns empty when no template references the stop', () => {
        const stm = new ShiftTemplateManager();
        expect(findShiftsReferencingTrackAlignedStop(stm, 4, 1)).toHaveLength(
            0
        );
    });

    it('does not match island stops with the same numbers', () => {
        const stm = new ShiftTemplateManager();
        stm.addTemplate(
            templateStoppingAt({
                stationId: 1,
                platformKind: 'island',
                platformId: 4,
                stopPositionId: 1,
            })
        );
        expect(findShiftsReferencingTrackAlignedStop(stm, 4, 1)).toHaveLength(
            0
        );
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test test/stop-position-references.test.ts`
Expected: FAIL. `../src/timetable/stop-position-references` can't be found.

- [ ] **Step 3: Create BN `src/timetable/stop-position-references.ts`**

```ts
import type { ShiftTemplateManager } from './shift-template-manager';
import type { ShiftTemplate } from './types';

/**
 * Shift templates whose scheduled stops reference the given stop position on
 * an island platform. Used by the platform editor to guard stop deletion.
 */
export function findShiftsReferencingIslandStop(
    shiftTemplateManager: ShiftTemplateManager,
    stationId: number,
    platformId: number,
    stopPositionId: number
): ShiftTemplate[] {
    return shiftTemplateManager
        .getAllTemplates()
        .filter(template =>
            template.stops.some(
                stop =>
                    stop.platformKind === 'island' &&
                    stop.stationId === stationId &&
                    stop.platformId === platformId &&
                    stop.stopPositionId === stopPositionId
            )
        );
}

/**
 * Shift templates whose scheduled stops reference the given stop position on
 * a track-aligned platform. Used by the platform editor to guard stop deletion.
 */
export function findShiftsReferencingTrackAlignedStop(
    shiftTemplateManager: ShiftTemplateManager,
    platformId: number,
    stopPositionId: number
): ShiftTemplate[] {
    return shiftTemplateManager
        .getAllTemplates()
        .filter(template =>
            template.stops.some(
                stop =>
                    stop.platformKind === 'trackAligned' &&
                    stop.platformId === platformId &&
                    stop.stopPositionId === stopPositionId
            )
        );
}
```

- [ ] **Step 4: Run it**

Run: `bun test test/stop-position-references.test.ts`
Expected: `5 pass`.

- [ ] **Step 5: Use the helpers in BN `src/components/toolbar/PlatformEditorPanel.tsx`**

Replace:

```ts
import type { ShiftTemplateManager } from '@/timetable/shift-template-manager';
```

with:

```ts
import type { ShiftTemplateManager } from '@/timetable/shift-template-manager';
import {
    findShiftsReferencingIslandStop,
    findShiftsReferencingTrackAlignedStop,
} from '@/timetable/stop-position-references';
```

Replace:

```ts
                refs = trackAlignedPlatformManager
                    .findShiftsReferencingStopPosition(
                        target.platformId,
                        stopId,
                        shiftTemplateManager
                    )
                    .map(s => ({ id: s.id, name: s.name }));
```

with:

```ts
                refs = findShiftsReferencingTrackAlignedStop(
                    shiftTemplateManager,
                    target.platformId,
                    stopId
                ).map(s => ({ id: s.id, name: s.name }));
```

Replace:

```ts
                refs = stationManager
                    .findShiftsReferencingStopPosition(
                        target.stationId,
                        target.platformId,
                        stopId,
                        shiftTemplateManager
                    )
                    .map(s => ({ id: s.id, name: s.name }));
```

with:

```ts
                refs = findShiftsReferencingIslandStop(
                    shiftTemplateManager,
                    target.stationId,
                    target.platformId,
                    stopId
                ).map(s => ({ id: s.id, name: s.name }));
```

- [ ] **Step 6: Remove the methods from banana's station managers**

Apply Task 4, Steps 2 and 3, to the BN files `src/stations/station-manager.ts` and `src/stations/track-aligned-platform-manager.ts`. The import lines are byte-identical in banana. That is: delete the two `@/timetable/...` type imports and the `findShiftsReferencingStopPosition` method (with the station manager's doc comment) in each file.

- [ ] **Step 7: Remove the moved cases from banana's stop-crud tests**

Apply Task 4, Step 4, to BN `test/station-manager-stop-crud.test.ts` and `test/track-aligned-platform-stop-crud.test.ts`.

- [ ] **Step 8: Verify**

```bash
grep -rn "findShiftsReferencingStopPosition" src test; bun test 2>&1 | grep -E "^ *[0-9]+ (pass|fail)" \
  && bunx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS" && bun run format && bun run format:check | tail -1
```

Expected:
- No `grep` hits.
- `948 pass`, `0 fail` (5 tests moved, none lost).
- `11`.
- Prettier is clean.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "refactor(timetable): look up stop-position references in the timetable module" -m "Replaces StationManager/TrackAlignedPlatformManager.findShiftsReferencingStopPosition with free functions so the station model no longer depends on the timetable (it moves to track-layout next)."
```

---

### Task 13 (banana): Switch banana to track-layout

**Files:**
- Modify:
  - BN `package.json`, `bun.lock`
  - BN `src/trains/index.ts`, `src/trains/tracks/index.ts`
  - BN `src/utils.ts`
  - BN `src/trains/input-state-machine/utils/factory.ts`
  - BN `src/hooks/use-render-sync.ts`
  - BN `src/trains/tracks/render-system.ts` (catenary preview only)
  - about 68 files whose imports the script repoints
- Delete: 20 source files and 16 test files (Step 4)

**Interfaces:**
- Consumes: `track-layout` 0.0.0 from `.pack/track-layout-local.tgz` (Task 10), including `TrackGraph.setNewSegmentStyle` and `TrackCurveManager.getTrackSegmentWithJoints`.

- [ ] **Step 1: Refresh the tarball**

Run: `cd /Users/vincent.yy.chang/dev/track/main && bun run pack:local`
Expected: `.pack/track-layout-local.tgz` is rewritten.

- [ ] **Step 2: Trim banana's barrel files**

In BN `src/trains/tracks/index.ts`, delete these three lines:

```ts
export * from './track';
export * from './trackcurve-manager';
export * from './trackjoint-manager';
```

In BN `src/trains/index.ts`, delete:

```ts
export * from './r-tree';
```

- [ ] **Step 3: Install the tarball**

```bash
cd /Users/vincent.yy.chang/dev/banana/main && bun add ../../track/main/.pack/track-layout-local.tgz \
  && grep -c "setNewSegmentStyle" node_modules/track-layout/dist/tracks/track.d.ts
```

Expected: `1`. If it prints `0`, the install is stale: `rm -rf node_modules/track-layout && bun install`, then check again.

- [ ] **Step 4: Delete the moved files.** Do this BEFORE repointing; otherwise the script rewrites them too.

```bash
git rm -q src/trains/tracks/{track,trackcurve-manager,trackjoint-manager,types,utils,constants,gauge-presets,parallel-spacing,joint-direction-preference-map}.ts \
  src/trains/r-tree.ts \
  src/stations/{types,station-manager,station-factory,track-aligned-platform-manager,track-aligned-platform-types,track-aligned-platform-migration,spine-utils,arc-length-resolver,platform-offset,stop-position-utils}.ts \
  test/{serialization,entity-manager,joint-direction-preference-map,gauge-presets,parallel-spacing,arc-length-resolver,platform-offset,spine-utils,stop-position-utils,station-manager-cascade,station-manager-change-notification,track-aligned-platform-manager,track-aligned-platform-migration,scene-dual-spine-station-link,station-manager-stop-crud,track-aligned-platform-stop-crud}.test.ts
```

- [ ] **Step 5: Remove `GenericEntityManager` from BN `src/utils.ts`**

Confirm the range first:

```bash
sed -n '6p;224p;225p;226p' src/utils.ts
```

Expected: `export class GenericEntityManager<T> {`, `}`, an empty line, `/**`.

Then delete lines 6–225, which is the class plus the blank line after it:

```bash
sed -i '' '6,225d' src/utils.ts && sed -n '1,8p' src/utils.ts
```

Expected: the file now starts with its three imports, a blank line, then `/**` and ` * Cache key for shadow calculations`.

- [ ] **Step 6: Repoint imports**

Run: `bun /Users/vincent.yy.chang/dev/track/main/scripts/repoint-banana-imports.ts /Users/vincent.yy.chang/dev/banana/main`
Expected: many `repointed …` lines, then `done; N file(s) changed` with N around 68.

- [ ] **Step 7: Fix the one import that went through a barrel.** In BN `src/trains/input-state-machine/utils/factory.ts`, replace:

```ts
import { TrackGraph } from '@/trains/tracks';
```

with:

```ts
import { TrackGraph } from 'track-layout';
```

- [ ] **Step 8: Push style into the model from `use-render-sync`**

The bed accessors are gone and style now lives in the model. In BN `src/hooks/use-render-sync.ts`, replace:

```ts
            if (state.trackStyle !== prev.trackStyle) {
                app.trackRenderSystem.trackStyle = state.trackStyle;
            }
            if (state.electrified !== prev.electrified) {
                app.trackRenderSystem.electrified = state.electrified;
            }
```

with:

```ts
            if (state.trackStyle !== prev.trackStyle) {
                app.curveEngine.trackGraph.setNewSegmentStyle({
                    trackStyle: state.trackStyle,
                });
            }
            if (state.electrified !== prev.electrified) {
                app.curveEngine.trackGraph.setNewSegmentStyle({
                    electrified: state.electrified,
                });
            }
```

Replace:

```ts
            if (state.bed !== prev.bed) {
                app.trackRenderSystem.bed = state.bed;
                app.curveEngine.trackGraph.bedEnabled = state.bed;
            }
            if (state.bedWidth !== prev.bedWidth) {
                app.trackRenderSystem.bedWidth = state.bedWidth;
                app.curveEngine.trackGraph.bedWidth = state.bedWidth;
            }
```

with:

```ts
            if (state.bed !== prev.bed) {
                app.curveEngine.trackGraph.setNewSegmentStyle({
                    bed: state.bed,
                });
            }
            if (state.bedWidth !== prev.bedWidth) {
                app.curveEngine.trackGraph.setNewSegmentStyle({
                    bedWidth: state.bedWidth,
                });
            }
```

Replace (in `applyAll`):

```ts
    app.trackRenderSystem.trackStyle = state.trackStyle;
    app.trackRenderSystem.electrified = state.electrified;
    app.curveEngine.trackGraph.projectionBuffer = state.projectionBuffer;
    app.trackRenderSystem.bed = state.bed;
    app.curveEngine.trackGraph.bedEnabled = state.bed;
    app.trackRenderSystem.bedWidth = state.bedWidth;
    app.curveEngine.trackGraph.bedWidth = state.bedWidth;
```

with:

```ts
    app.curveEngine.trackGraph.setNewSegmentStyle({
        trackStyle: state.trackStyle,
        electrified: state.electrified,
        bed: state.bed,
        bedWidth: state.bedWidth,
    });
    app.curveEngine.trackGraph.projectionBuffer = state.projectionBuffer;
```

- [ ] **Step 9: Make the catenary preview read the segment.** `getVisualPropsForSegment` is gone. In BN `src/trains/tracks/render-system.ts`, replace:

```ts
        const visualProps = this._trackCurveManager.getVisualPropsForSegment(
            state.segmentNumber
        );
        const gauge = visualProps?.gauge ?? 1.067;
```

with:

```ts
        const segment = this._trackCurveManager.getTrackSegmentWithJoints(
            state.segmentNumber
        );
        const gauge = segment?.gauge ?? 1.067;
```

and replace:

```ts
        const mastOffset = visualProps?.bed
            ? Math.max(bHw, (visualProps.bedWidth ?? 3) / 2)
            : bHw;
```

with:

```ts
        const mastOffset = segment?.bed
            ? Math.max(bHw, (segment.bedWidth ?? 3) / 2)
            : bHw;
```

- [ ] **Step 10: Format, then verify**

```bash
bun run format >/dev/null && bun run format:check | tail -1 \
  && grep -rn "bedEnabled\|getVisualPropsForSegment\|from '@/trains/r-tree'\|from '@/stations/station-manager'" src test; \
  bunx tsc --noEmit -p tsconfig.json 2>&1 | grep "error TS" | sed -E 's/\(([0-9]+),[0-9]+\)//' | sort | uniq -c; \
  bun test 2>&1 | grep -E "^ *[0-9]+ (pass|fail)"; bun run build 2>&1 | tail -1
```

Expected:
- Prettier is clean.
- No `grep` hits.
- Only the 11 pre-existing errors.
- `734 pass`, `0 fail`.
- The build finishes.

- [ ] **Step 11: Owner play-test (STOP and ask)**

Ask the owner to run `bun run dev` and check:
- Lay track with each Track Style option and with Electrified on and off. New segments must look as selected, and so must the preview.
- Turn Bed on, change Bed Width, and lay track. Snapping alongside bedded track uses the bed width.
- Hover the catenary tool over a segment (the preview masts show), then commit. Masts appear.
- Save the scene, reload the page, and load it. Styles, electrification and beds are kept.
- Load a scene saved before this branch from the scene picker. It looks as before.

Continue only after the owner confirms.

- [ ] **Step 12: Commit**

```bash
git add -A && git commit -m "refactor: use track-layout for the track and station model" -m "Installs the locally packed track-layout tarball, deletes banana's copies of the moved modules and tests, and repoints imports. Track style is pushed into the model (setNewSegmentStyle) instead of the renderer; the catenary preview reads gauge and bed from the segment."
```

---

### Task 14 (banana): Apply catenary through the model and drop the renderer's style state

**Files:**
- Modify: BN `src/trains/tracks/render-system.ts`, BN `src/utils/init-app.ts`

**Interfaces:**
- Consumes:
  - `TrackGraph.setSegmentStyle(segmentNumber, { electrified, catenarySide })`
  - `TrackCurveManager.onSegmentStyleChanged(cb, { signal })`
  - `SegmentStyleChange`

- [ ] **Step 1: Remove the renderer's style fields.** In BN `src/trains/tracks/render-system.ts`, delete:

```ts
    /** Current track visual style. */
    private _trackStyle: TrackStyle = 'ballasted';

    /** Whether newly laid tracks are electrified (catenary poles). */
    private _electrified: boolean = false;

    /** Total width of the gravel bed foundation in world units. Stamped per track when laid. */
    private _bedWidth: number = 3;

    /** Whether newly laid tracks will have a bed (gravel foundation below ballast). */
    private _bed: boolean = false;

```

- [ ] **Step 2: Stop handling catenary commits in the renderer and listen to the model.** Delete:

```ts
            catenaryLayoutEngine.onCommit(
                payload => {
                    this.applyCatenary(payload.segmentNumber, payload.side);
                },
                { signal: this._abortController.signal }
            );
```

Replace:

```ts
        this._trackCurveManager.onRemoveTrackSegment(
            this._onRemoveTrackSegment.bind(this),
            { signal: this._abortController.signal }
        );
```

with:

```ts
        this._trackCurveManager.onRemoveTrackSegment(
            this._onRemoveTrackSegment.bind(this),
            { signal: this._abortController.signal }
        );
        this._trackCurveManager.onSegmentStyleChanged(
            this._onSegmentStyleChanged.bind(this),
            { signal: this._abortController.signal }
        );
```

- [ ] **Step 3: Remove both stamping steps.** The model now fills style into all draw data.

In `_onNewTrackData`, replace:

```ts
        drawDataList.forEach(drawData => {
            // Stamp the current track style and electrification onto the draw data
            // so each segment retains the options that were active when it was laid down.
            if (drawData.trackStyle === undefined) {
                drawData.trackStyle = this._trackStyle;
            }
            if (drawData.electrified === undefined) {
                drawData.electrified = this._electrified;
            }
            if (drawData.bedWidth === undefined) {
                drawData.bedWidth = this._bedWidth;
            }
            if (drawData.bed === undefined) {
                drawData.bed = this._bed;
            }

            const key
```

with:

```ts
        drawDataList.forEach(drawData => {
            const key
```

In the preview handler, replace:

```ts
            const key = `__preview__${i}`;

            // Stamp current settings so texture builders use the active style.
            if (drawData.trackStyle === undefined) {
                drawData.trackStyle = this._trackStyle;
            }
            if (drawData.electrified === undefined) {
                drawData.electrified = this._electrified;
            }
            if (drawData.bedWidth === undefined) {
                drawData.bedWidth = this._bedWidth;
            }
            if (drawData.bed === undefined) {
                drawData.bed = this._bed;
            }
```

with:

```ts
            const key = `__preview__${i}`;
```

- [ ] **Step 4: Replace the style accessors and `applyCatenary`/`removeCatenary` with a style-change handler**

Delete everything from the line `    /** Current track visual style. */`, which now only precedes `get trackStyle(): TrackStyle {`, up to but not including the line `    get sunAngle(): number {`. That range holds:
- the `trackStyle` and `electrified` accessors
- `applyCatenary` and `removeCatenary`
- the `bedWidth` and `bed` accessors

In its place, insert:

```ts
    /**
     * Rebuilds catenary masts for a segment whose style changed in the model
     * (TrackGraph.setSegmentStyle). The draw data already carries the new
     * style; only the mast graphics need replacing.
     */
    private _onSegmentStyleChanged({ segmentNumber }: SegmentStyleChange): void {
        for (const drawData of this._trackCurveManager.persistedDrawData) {
            if (
                drawData.originalTrackSegment.trackSegmentNumber !==
                segmentNumber
            ) {
                continue;
            }
            const key = JSON.stringify({
                trackSegmentNumber: segmentNumber,
                tValInterval: drawData.originalTrackSegment.tValInterval,
            });

            const existing = this._catenaryMap.get(key);
            if (existing !== undefined) {
                const removed = this._worldRenderSystem.removeFromBand(
                    `__catenary__${key}`
                );
                removed?.destroy({ children: true });
                this._catenaryMap.delete(key);
            }

            const bandIndex = this._drawDataBandMap.get(key);
            if (!drawData.electrified || bandIndex === undefined) {
                continue;
            }
            const catenaryContainer = this._buildCatenaryForDrawData(drawData);
            this._worldRenderSystem.addToBand(
                `__catenary__${key}`,
                catenaryContainer,
                bandIndex,
                'catenary'
            );
            this._catenaryMap.set(key, catenaryContainer);
        }
    }

```

- [ ] **Step 5: Fix the imports in `render-system.ts`**

In the multi-line `import { … } from 'track-layout';` that lists `TrackSegmentDrawData`, remove the `TrackStyle,` entry; nothing uses it any more. Then add this line after that import:

```ts
import type { SegmentStyleChange } from 'track-layout';
```

- [ ] **Step 6: Route catenary commits to the model.** In BN `src/utils/init-app.ts`, replace:

```ts
    const trackGraph = curveEngine.trackGraph;
```

with:

```ts
    const trackGraph = curveEngine.trackGraph;
    catenaryLayoutEngine.onCommit(({ segmentNumber, side }) => {
        trackGraph.setSegmentStyle(segmentNumber, {
            electrified: true,
            catenarySide: side,
        });
    });
```

- [ ] **Step 7: Verify**

```bash
bun run format >/dev/null && bun run format:check | tail -1 \
  && grep -n "_trackStyle\|_electrified\b\|this\._bed\b\|this\._bedWidth\|applyCatenary\|removeCatenary" src/trains/tracks/render-system.ts; \
  bunx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"; bun test 2>&1 | grep -E "^ *[0-9]+ (pass|fail)"; bun run build 2>&1 | tail -1
```

Expected:
- Prettier is clean.
- No `grep` hits.
- `11`.
- `734 pass`, `0 fail`.
- The build finishes.

- [ ] **Step 8: Owner play-test (STOP and ask)**

Ask the owner to check, with the catenary tool:
- Electrify a straight segment and a curved one, on each side. Masts appear on the chosen side.
- Re-apply on the other side. The masts move.
- Save and reload. Electrification and side are kept.
- Laying with the Electrified toggle on still draws masts.

Continue only after the owner confirms.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "refactor(tracks): apply catenary through the track model" -m "The catenary tool's commit calls trackGraph.setSegmentStyle; the renderer rebuilds masts on onSegmentStyleChanged. Removes the renderer's own style fields, accessors and stamping."
```

---

### Task 15 (banana): Refuse to branch off a platform's track before changing anything

The curve engine has no test harness in banana; phase 2 moves it into `track-layout` with tests. Task 7's unit tests cover the graph-level guard. This task adds the engine's pre-check, so that one successful split at one end can't be followed by a refused split at the other, leaving an orphaned joint. It is verified by typecheck, the suite and a play-test.

**Files:**
- Modify: BN `src/trains/input-state-machine/curve-engine.ts`

- [ ] **Step 1: Add the pre-check.** In BN `src/trains/input-state-machine/curve-engine.ts`, replace:

```ts
        // END OF VALIDATION PIPELINE
```

with:

```ts
        if (
            (this._newStartJoint.type === 'branchCurve' &&
                this._trackGraph.isSegmentProtected(
                    this._newStartJoint.constraint.curve
                )) ||
            (this._newEndJoint.type === 'branchCurve' &&
                this._trackGraph.isSegmentProtected(
                    this._newEndJoint.constraint.curve
                ))
        ) {
            console.warn('cannot branch from a segment under a platform');
            this.cancelCurrentCurve();
            return null;
        }

        // END OF VALIDATION PIPELINE
```

- [ ] **Step 2: Verify**

```bash
bun run format >/dev/null && bun run format:check | tail -1 && bunx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"; bun test 2>&1 | grep -E "^ *[0-9]+ (pass|fail)"
```

Expected: Prettier is clean, then `11`, then `734 pass`, `0 fail`.

- [ ] **Step 3: Owner play-test (STOP and ask)**

Ask the owner to:
1. Place a single-spine platform on a segment.
2. Try to lay a branch starting from the middle of that segment, then one ending there. Nothing is created, and with the joint-number debug overlay on, no new joint appears.
3. Branch from a segment without a platform. That still works.
4. Try to delete the platform's track. That is still refused.

Continue only after the owner confirms.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "fix(tracks): refuse to branch from a segment under a platform" -m "The curve engine checks TrackGraph.isSegmentProtected for both ends while validating, before splitting anything, so a refused split can't leave an orphaned joint."
```

---

### Task 16: Verification gate, publish track-layout 0.1.0, pin it in banana

**Files:**
- Modify: TL `package.json` (version), BN `package.json`, BN `bun.lock`

- [ ] **Step 1: Full track-layout check**

```bash
cd /Users/vincent.yy.chang/dev/track/main && bun run format:check | tail -1 && bun run typecheck && bun test 2>&1 | grep -E "^ *[0-9]+ (pass|fail)|^Ran" && bun run build && bun pm pack --dry-run | tail -3
```

Expected:
- Prettier is clean, and typecheck prints nothing.
- `268 pass`, `0 fail`, `Ran 268 tests across 23 files`.
- The build succeeds, and the pack reports `Total files: 71`.

- [ ] **Step 2: Full banana check**

```bash
cd /Users/vincent.yy.chang/dev/banana/main && bun run format:check | tail -1 && bunx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"; bun test 2>&1 | grep -E "^ *[0-9]+ (pass|fail)"; bun run build 2>&1 | tail -1
```

Expected: Prettier is clean, then `11`, then `734 pass`, `0 fail`, then the build finishes.

- [ ] **Step 3: Owner play-test of the whole checklist (STOP and ask)**

This is the spec's checklist, run with `bun run dev` in banana:
- lay, extend, branch at a joint and branch mid-curve
- delete track
- change style and electrify
- save and reload a new scene, and load a scene saved before the migration
- place island, single-spine and dual-spine stations
- edit stop positions
- run a train across a junction

- [ ] **Step 4: Owner decisions (STOP and ask)**

1. Confirm the license (`MIT` in TL `package.json`).
2. Give the go-ahead to publish `track-layout@0.1.0` to npm.

Don't continue without both.

- [ ] **Step 5: Version and publish**

In TL `package.json`, change `"version": "0.0.0"` to `"version": "0.1.0"`, then:

```bash
cd /Users/vincent.yy.chang/dev/track/main && git add package.json && git commit -m "chore(release): track-layout 0.1.0"
```

The owner publishes, because it needs their npm login. Suggest they run `! bun publish` in this session; `prepublishOnly` runs typecheck, tests and build first.
Expected: `+ track-layout@0.1.0`. Verify it with `curl -s https://registry.npmjs.org/track-layout | grep -o '"latest":"[^"]*"'`, which should print `"latest":"0.1.0"`.

- [ ] **Step 6: Pin the published package in banana**

```bash
cd /Users/vincent.yy.chang/dev/banana/main && bun add track-layout@^0.1.0 \
  && grep '"track-layout"' package.json && grep '"version"' node_modules/track-layout/package.json \
  && bun test 2>&1 | grep -E "^ *[0-9]+ (pass|fail)" && bun run build 2>&1 | tail -1
```

Expected: `"track-layout": "^0.1.0"`, then `"version": "0.1.0"`, then `734 pass`, `0 fail`, then the build finishes.

- [ ] **Step 7: Commit**

```bash
git add package.json bun.lock && git commit -m "chore(deps): use published track-layout 0.1.0"
```

- [ ] **Step 8: Hand off**

Report:
- Both branches: TL `feat/phase-1-model` and BN `feat/track-layout-phase-1`.
- The test counts: TL 268, BN 734.
- That publishing is done.

Pushing, creating a GitHub repo for track-layout, opening banana's PR and merging are the owner's decisions; offer superpowers:finishing-a-development-branch.
