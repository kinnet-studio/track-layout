import { describe, expect, it } from 'bun:test';

import { StationManager } from '../src/stations/station-manager.js';
import { TrackAlignedPlatformManager } from '../src/stations/track-aligned-platform-manager.js';
import type { TrackAlignedPlatform } from '../src/stations/track-aligned-platform-types.js';
import { bareStation } from './station-placement-helpers.js';

function platformFor(stationId: number): Omit<TrackAlignedPlatform, 'id'> {
    return {
        stationId,
        spine: [{ trackSegment: 0, tStart: 0, tEnd: 1, side: 1 }],
        offset: 2,
        outerVertices: [{ x: 0, y: 5 }],
        stopPositions: [],
    };
}

/** A station manager whose events are logged in the order they fire. */
function loggedStations() {
    const stations = new StationManager();
    const log: string[] = [];
    stations.onStationAdded(id => log.push(`added ${id}`));
    stations.onStationRemoved(id => log.push(`removed ${id}`));
    stations.onChange(() => log.push('change'));
    return { stations, log };
}

/** A platform manager whose events are logged in the order they fire. */
function loggedPlatforms() {
    const platforms = new TrackAlignedPlatformManager();
    const log: string[] = [];
    platforms.onPlatformAdded(id => log.push(`added ${id}`));
    platforms.onPlatformRemoved(id => log.push(`removed ${id}`));
    platforms.onChange(() => log.push('change'));
    return { platforms, log };
}

describe('StationManager add and remove events', () => {
    it('fires onStationAdded from both create paths, before onChange', () => {
        const { stations, log } = loggedStations();
        const id = stations.createStation(bareStation({ x: 0, y: 0 }));
        stations.createStationWithId(5, {
            ...bareStation({ x: 0, y: 0 }),
            id: 5,
        });
        expect(log).toEqual([`added ${id}`, 'change', 'added 5', 'change']);
    });

    it('fires onStationRemoved after the before-destroy hook and before onChange', () => {
        const { stations, log } = loggedStations();
        const id = stations.createStation(bareStation({ x: 0, y: 0 }));
        stations.setOnDestroyStation(hooked => log.push(`hook ${hooked}`));
        log.length = 0;

        stations.destroyStation(id);
        expect(log).toEqual([`hook ${id}`, `removed ${id}`, 'change']);
    });

    it('fires no removed event for a station that does not exist', () => {
        const { stations, log } = loggedStations();
        stations.destroyStation(3);
        expect(log).toEqual(['change']);
    });

    it('stops firing once unsubscribed', () => {
        const stations = new StationManager();
        const ids: number[] = [];
        const offAdded = stations.onStationAdded(id => ids.push(id));
        const offRemoved = stations.onStationRemoved(id => ids.push(-id));
        offAdded();
        offRemoved();
        const id = stations.createStation(bareStation({ x: 0, y: 0 }));
        stations.destroyStation(id);
        expect(ids).toEqual([]);
    });
});

describe('TrackAlignedPlatformManager add and remove events', () => {
    it('fires onPlatformAdded from both create paths, before onChange', () => {
        const { platforms, log } = loggedPlatforms();
        const id = platforms.createPlatform(platformFor(0));
        platforms.createPlatformWithId(7, platformFor(0));
        expect(log).toEqual([`added ${id}`, 'change', 'added 7', 'change']);
    });

    it('fires onPlatformRemoved after the before-destroy hook and before onChange', () => {
        const { platforms, log } = loggedPlatforms();
        const id = platforms.createPlatform(platformFor(0));
        platforms.setOnBeforeDestroy(hooked => log.push(`hook ${hooked}`));
        log.length = 0;

        platforms.destroyPlatform(id);
        expect(log).toEqual([`hook ${id}`, `removed ${id}`, 'change']);
    });

    it('fires one removed event per platform of a station, then one onChange', () => {
        const { platforms, log } = loggedPlatforms();
        const a = platforms.createPlatform(platformFor(1));
        const other = platforms.createPlatform(platformFor(2));
        const b = platforms.createPlatform(platformFor(1));
        log.length = 0;

        platforms.destroyPlatformsForStation(1);
        expect(log).toEqual([`removed ${a}`, `removed ${b}`, 'change']);
        expect(platforms.getPlatform(other)).not.toBeNull();
    });

    it('fires no removed event for a platform that does not exist', () => {
        const { platforms, log } = loggedPlatforms();
        platforms.destroyPlatform(3);
        expect(log).toEqual(['change']);
    });

    it('stops firing once unsubscribed', () => {
        const platforms = new TrackAlignedPlatformManager();
        const ids: number[] = [];
        const offAdded = platforms.onPlatformAdded(id => ids.push(id));
        const offRemoved = platforms.onPlatformRemoved(id => ids.push(-id));
        offAdded();
        offRemoved();
        const id = platforms.createPlatform(platformFor(0));
        platforms.destroyPlatform(id);
        expect(ids).toEqual([]);
    });
});

describe('station delete cascade', () => {
    it('removes the station’s platforms before the station itself', () => {
        const stations = new StationManager();
        const platforms = new TrackAlignedPlatformManager();
        stations.setOnDestroyStation(stationId => {
            for (const { id } of platforms.getPlatformsByStation(stationId)) {
                platforms.destroyPlatform(id);
            }
        });
        const stationId = stations.createStation(bareStation({ x: 0, y: 0 }));
        const p1 = platforms.createPlatform(platformFor(stationId));
        const p2 = platforms.createPlatform(platformFor(stationId));

        const log: string[] = [];
        platforms.onPlatformRemoved(id => log.push(`platform ${id}`));
        stations.onStationRemoved(id => log.push(`station ${id}`));
        stations.destroyStation(stationId);
        expect(log).toEqual([
            `platform ${p1}`,
            `platform ${p2}`,
            `station ${stationId}`,
        ]);
    });
});
