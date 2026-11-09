import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { StationManager } from '../src/stations/station-manager.js';
import { TrackAlignedPlatformManager } from '../src/stations/track-aligned-platform-manager.js';
import { levelsToMetres } from '../src/tracks/heights.js';
import { JointDirectionPreferenceMap } from '../src/tracks/joint-direction-preference-map.js';
import { TrackGraph } from '../src/tracks/track.js';

const fixture = JSON.parse(
    readFileSync(
        join(import.meta.dir, 'fixtures', 'banana-scene-b26692b.json'),
        'utf8'
    )
);

// The fixture was saved in levels. Convert it to metres, as a loader of old
// files does, before the model reads it.
const metres = levelsToMetres({
    track: fixture.tracks,
    stations: fixture.stations.stations,
});
const tracks = metres.track;
const stations = { ...fixture.stations, stations: metres.stations };

/** A JSON round trip drops undefined fields, like saving a scene to disk does. */
function asSaved<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
}

describe('golden banana scene (b26692b)', () => {
    it('converts the fixture heights to metres, times 10', () => {
        expect(tracks.joints.map(j => j.elevation)).toEqual(
            fixture.tracks.joints.map(
                (j: { elevation: number }) => j.elevation * 10
            )
        );
        expect(tracks.segments.map(s => s.elevation)).toEqual(
            fixture.tracks.segments.map(
                (s: { elevation: { from: number; to: number } }) => ({
                    from: s.elevation.from * 10,
                    to: s.elevation.to * 10,
                })
            )
        );
        expect(
            stations.stations.map((s: { elevation: number }) => s.elevation)
        ).toEqual(
            fixture.stations.stations.map(
                (s: { elevation: number }) => s.elevation * 10
            )
        );
        expect(tracks.joints.some(j => j.elevation === 10)).toBe(true);
    });

    it('reloads the tracks, filling in style defaults', async () => {
        const graph = new TrackGraph();
        await graph.loadFromSerializedData(tracks);

        // b26692b saves omit style on unstyled segments and never include
        // bedWidth. Loading fills both in (bedWidth only where bed is on).
        const expected = structuredClone(tracks);
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
        const manager = StationManager.deserialize(stations);
        expect(asSaved(manager.serialize())).toEqual(stations);
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
