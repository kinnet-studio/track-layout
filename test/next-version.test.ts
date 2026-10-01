import { describe, expect, it } from 'bun:test';

import { bumpFor } from '../scripts/next-version.js';

describe('bumpFor', () => {
    it('bumps the patch for fixes and chores', () => {
        expect(bumpFor('0.2.0', ['fix(tracks): x', 'chore: y'])).toBe('patch');
    });

    it('bumps the minor for a feature', () => {
        expect(bumpFor('0.2.0', ['fix: x', 'feat(editing): y'])).toBe('minor');
    });

    it('bumps the major for a breaking change from 1.0 on', () => {
        expect(bumpFor('1.4.2', ['feat!: drop x'])).toBe('major');
        expect(bumpFor('1.4.2', ['refactor(editing)!: y'])).toBe('major');
        expect(
            bumpFor('1.4.2', ['fix: x\n\nBREAKING CHANGE: the engine moved'])
        ).toBe('major');
        expect(bumpFor('1.4.2', ['fix: x\n\nBREAKING-CHANGE: y'])).toBe(
            'major'
        );
    });

    it('bumps the minor for a breaking change while the version is 0.x', () => {
        expect(bumpFor('0.2.0', ['feat(editing)!: y'])).toBe('minor');
    });

    it('does not read "breaking" in prose as a breaking change', () => {
        expect(bumpFor('1.0.0', ['fix: breaking change in docs'])).toBe(
            'patch'
        );
    });

    it('refuses to release with no commits', () => {
        expect(() => bumpFor('0.2.0', [])).toThrow('no commits');
    });
});
