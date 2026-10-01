#!/usr/bin/env bun
/**
 * Copies modules from a banana checkout into track-layout and rewrites
 * their import specifiers to track-layout's layout (relative, with `.js`).
 *
 * Usage:
 *   bun scripts/port-from-banana.ts <banana-root> <banana-file>=<track-layout-file> [...]
 *
 * Relative and `@/` specifiers that resolve to a module in MODULE_MAP, and
 * package specifiers listed in PACKAGE_MAP (`track-layout` itself), are
 * rewritten. Other package specifiers (e.g. `@ue-too/curve`) are left alone.
 * Any other specifier is left as-is and reported as UNMAPPED so it can be
 * handled by hand.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { MODULE_MAP, PACKAGE_MAP } from './banana-module-map.js';

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
    } else if (specifier in PACKAGE_MAP) {
        return relativeSpecifier(destFile, PACKAGE_MAP[specifier]);
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
