#!/usr/bin/env bun
/**
 * Rewrites imports in a banana checkout so that modules which moved to
 * track-layout are imported from the package instead: `track-layout/editing`
 * for modules under src/editing/, `track-layout` for everything else.
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

import { MODULE_MAP, entryPointFor } from './banana-module-map.js';

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
                const entryPoint = entryPointFor(MODULE_MAP[moduleId]!);
                return `${keyword}${space}${clause}${fromPart}${quote}${entryPoint}${quote}`;
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
