#!/usr/bin/env bun
/**
 * Prints the version bump (`patch`, `minor` or `major`) that the
 * conventional commits since the last `v*` tag call for. The release
 * workflow passes it to `npm version`.
 *
 * Usage:
 *   bun scripts/next-version.ts
 *
 * A `feat` commit is a minor bump and anything else a patch. A breaking
 * change (`type!:` or a `BREAKING CHANGE:` footer) is a major bump, except
 * while the version is 0.x, where it is a minor bump.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type Bump = 'major' | 'minor' | 'patch';

const BREAKING_SUBJECT = /^\w+(\([^)]*\))?!:/;
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE:/m;
const FEATURE_SUBJECT = /^feat(\([^)]*\))?!?:/;

/** The bump `commits` (full messages) call for on top of `currentVersion`. */
export function bumpFor(currentVersion: string, commits: string[]): Bump {
    if (commits.length === 0) {
        throw new Error('no commits since the last release');
    }
    const breaking = commits.some(
        message =>
            BREAKING_SUBJECT.test(message) || BREAKING_FOOTER.test(message)
    );
    if (breaking) {
        return currentVersion.startsWith('0.') ? 'minor' : 'major';
    }
    return commits.some(message => FEATURE_SUBJECT.test(message))
        ? 'minor'
        : 'patch';
}

function git(...args: string[]): string {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

if (import.meta.main) {
    const root = resolve(import.meta.dir, '..');
    const { version } = JSON.parse(
        readFileSync(resolve(root, 'package.json'), 'utf8')
    );
    const tag = git('describe', '--tags', '--abbrev=0', '--match', 'v*');
    const commits = git('log', '--format=%B%x00', `${tag}..HEAD`)
        .split('\0')
        .map(message => message.trim())
        .filter(message => message.length > 0);
    console.log(bumpFor(version, commits));
}
