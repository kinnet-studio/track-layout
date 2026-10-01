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
