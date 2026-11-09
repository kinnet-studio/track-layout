import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { filesUnder, importsOf } from './import-scan.js';

const pkg = JSON.parse(
    readFileSync(join(import.meta.dir, '..', 'package.json'), 'utf8')
);

describe('three entry point', () => {
    it('imports nothing from pixi.js, src/pixi or @ue-too/being', () => {
        const files = filesUnder('src/three');
        expect(files.length).toBeGreaterThan(0);
        for (const file of files) {
            for (const { specifier, typeOnly } of importsOf(file)) {
                if (typeOnly) continue;
                expect(specifier).not.toMatch(
                    /^pixi\.js|\/pixi\/|^@ue-too\/being/
                );
            }
        }
    });

    it('is listed in package.json exports', () => {
        expect(pkg.exports['./three'].import).toBe('./dist/three/index.js');
        expect(pkg.exports['./three'].types).toBe('./dist/three/index.d.ts');
        expect(pkg.peerDependencies.three).toBe('^0.186.1');
        expect(pkg.peerDependenciesMeta.three.optional).toBe(true);
        expect(pkg.devDependencies.three).toBe('0.186.1');
        expect(pkg.devDependencies['@types/three']).toBe('0.186.0');
    });
});
