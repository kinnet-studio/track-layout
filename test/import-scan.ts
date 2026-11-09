import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every module a source file references, with whether the reference is
 * type-only: `import ... from` and `export ... from` statements (including
 * `export *`, multi-line clauses and either quote style), side-effect
 * `import 'x'` and dynamic `import('x')` with a string literal. Only
 * statements that start `import type` or `export type` count as type-only.
 */
export function importsOf(
    file: string
): { specifier: string; typeOnly: boolean }[] {
    const text = readFileSync(file, 'utf8');
    const statements = [
        ...text.matchAll(
            /^(?:import|export)\s+(type\s+)?[\w\s{},*$]*?\bfrom\s*(['"])([^'"\n]+)\2/gm
        ),
    ].map(match => ({
        specifier: match[3]!,
        typeOnly: match[1] !== undefined,
    }));
    const sideEffects = [
        ...text.matchAll(/^import\s*(['"])([^'"\n]+)\1/gm),
    ].map(match => ({ specifier: match[2]!, typeOnly: false }));
    const dynamic = [
        ...text.matchAll(/\bimport\s*\(\s*(['"`])([^'"`\n]+)\1\s*\)/g),
    ].map(match => ({ specifier: match[2]!, typeOnly: false }));
    return [...statements, ...sideEffects, ...dynamic];
}

/** Every .ts file under a directory (relative to the repo root), recursively. */
export function filesUnder(dir: string): string[] {
    const root = join(import.meta.dir, '..', dir);
    const walk = (current: string): string[] =>
        readdirSync(current).flatMap(name => {
            const path = join(current, name);
            return statSync(path).isDirectory()
                ? walk(path)
                : path.endsWith('.ts')
                  ? [path]
                  : [];
        });
    return walk(root);
}
