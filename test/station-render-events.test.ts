import { describe, expect, it } from 'bun:test';
import type { Container } from 'pixi.js';

import { StationRenderSystem } from '../src/pixi/station-render-system.js';
import { TrackAlignedPlatformRenderSystem } from '../src/pixi/track-aligned-platform-render-system.js';
import type { BandSublayer } from '../src/pixi/world-render-system.js';
import { StationManager } from '../src/stations/station-manager.js';
import { TrackAlignedPlatformManager } from '../src/stations/track-aligned-platform-manager.js';
import type { TrackAlignedPlatform } from '../src/stations/track-aligned-platform-types.js';
import { TrackGraph } from '../src/tracks/track.js';
import { ELEVATION } from '../src/tracks/types.js';
import { RecordingLayerHost, textureRenderer } from './pixi-helpers.js';
import { bareStation, layTrack } from './station-placement-helpers.js';

/** A recording host that also logs band additions (+) and removals (-) in order. */
class LoggingLayerHost extends RecordingLayerHost {
    log: string[] = [];

    override addToBand(
        key: string,
        container: Container,
        bandIndex: number,
        sublayer: BandSublayer
    ): void {
        this.log.push(`+${key}`);
        super.addToBand(key, container, bandIndex, sublayer);
    }
    override removeFromBand(key: string): Container | undefined {
        this.log.push(`-${key}`);
        return super.removeFromBand(key);
    }
}

function platformFor(stationId: number): Omit<TrackAlignedPlatform, 'id'> {
    return {
        stationId,
        spine: [{ trackSegment: 0, tStart: 0, tEnd: 1, side: 1 }],
        offset: 2,
        outerVertices: [
            { x: 100, y: 8 },
            { x: 0, y: 8 },
        ],
        stopPositions: [],
    };
}

/** Both renderers over real managers, with banana's station-delete cascade. */
function scene() {
    const host = new LoggingLayerHost();
    const graph = new TrackGraph();
    layTrack(graph, [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
    ]);
    const stations = new StationManager();
    const platforms = new TrackAlignedPlatformManager();
    stations.setOnDestroyStation(stationId => {
        for (const { id } of platforms.getPlatformsByStation(stationId)) {
            platforms.destroyPlatform(id);
        }
    });
    const stationRenderer = new StationRenderSystem(
        host,
        stations,
        graph,
        textureRenderer
    );
    const platformRenderer = new TrackAlignedPlatformRenderSystem(
        host,
        platforms,
        stations,
        graph,
        textureRenderer
    );
    return {
        host,
        stations,
        platforms,
        stationRenderer,
        platformRenderer,
    };
}

function station(elevation: ELEVATION = ELEVATION.GROUND) {
    return { ...bareStation({ x: 0, y: 0 }), elevation };
}

describe('station and platform renderers follow their managers', () => {
    it('draws a station when it is created and removes it when destroyed', () => {
        const { host, stations } = scene();

        const id = stations.createStation(station());
        stations.destroyStation(id);

        expect(host.log).toEqual([`+station-${id}`, `-station-${id}`]);
    });

    it("draws a platform at its station's elevation, or at ground without one", () => {
        const { host, stations, platforms } = scene();
        const stationId = stations.createStation(station(ELEVATION.ABOVE_1));

        const id = platforms.createPlatform(platformFor(stationId));
        const orphan = platforms.createPlatform(platformFor(99));

        expect(host.bandOf(`track-aligned-platform-${id}`)).toBe(4);
        expect(host.bandOf(`track-aligned-platform-${orphan}`)).toBe(3);
    });

    it("removes a deleted station's platforms, then the station", () => {
        const { host, stations, platforms } = scene();
        const stationId = stations.createStation(station());
        const p1 = platforms.createPlatform(platformFor(stationId));
        const p2 = platforms.createPlatform(platformFor(stationId));
        host.log.length = 0;

        stations.destroyStation(stationId);

        expect(host.log).toEqual([
            `-track-aligned-platform-${p1}`,
            `-track-aligned-platform-${p2}`,
            `-station-${stationId}`,
        ]);
    });

    it('swaps the visuals once each when a scene load replaces the stations', () => {
        const { host, stations, platforms } = scene();
        const old = stations.createStation(station());
        const oldPlatform = platforms.createPlatform(platformFor(old));
        host.log.length = 0;

        // The order banana's scene load replaces them in: the stations
        // block (destroy the old, create the restored), then the platforms
        // block (destroy the remaining, create the restored).
        for (const { id } of stations.getStations()) {
            stations.destroyStation(id);
        }
        stations.createStationWithId(4, {
            ...station(ELEVATION.ABOVE_1),
            id: 4,
        });
        for (const { id } of platforms.getAllPlatforms()) {
            platforms.destroyPlatform(id);
        }
        platforms.createPlatformWithId(9, platformFor(4));

        expect(host.log).toEqual([
            `-track-aligned-platform-${oldPlatform}`,
            `-station-${old}`,
            '+station-4',
            '+track-aligned-platform-9',
        ]);
        expect(host.bandOf('track-aligned-platform-9')).toBe(4);
    });

    it('stops following the managers after cleanup', () => {
        const { host, stations, platforms, stationRenderer, platformRenderer } =
            scene();
        stationRenderer.cleanup();
        platformRenderer.cleanup();
        host.log.length = 0;

        const stationId = stations.createStation(station());
        platforms.destroyPlatform(
            platforms.createPlatform(platformFor(stationId))
        );
        stations.destroyStation(stationId);

        expect(host.log).toEqual([]);
    });
});
