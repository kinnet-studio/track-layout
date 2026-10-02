import { describe, expect, it } from 'bun:test';
import { Container } from 'pixi.js';

import { WorldRenderSystem } from '../src/pixi/world-render-system.js';
import { LEVEL_HEIGHT } from '../src/tracks/constants.js';
import { ELEVATION, ELEVATION_VALUES } from '../src/tracks/types.js';

/** The z-index of the sublayer a container sits in, and of that sublayer's band. */
function placement(container: Container) {
    return {
        sublayerZ: container.parent?.zIndex,
        bandZ: container.parent?.parent?.zIndex,
    };
}

describe('WorldRenderSystem', () => {
    it('maps each elevation level to its band, lowest first', () => {
        const host = new WorldRenderSystem();

        expect(host.bandCount).toBe(7);
        ELEVATION_VALUES.forEach((level, index) => {
            expect(host.getElevationBandIndex(level * LEVEL_HEIGHT)).toBe(
                index
            );
        });
    });

    it("puts an elevation between levels in the upper level's band", () => {
        const host = new WorldRenderSystem();

        expect(host.getElevationBandIndex(5)).toBe(4);
        expect(host.getElevationBandIndex(15)).toBe(5);
        expect(host.getElevationBandIndex(-5)).toBe(3);
        expect(host.resolveElevationLevel(15)).toBe(ELEVATION.ABOVE_2);
        expect(host.resolveElevationLevel(0)).toBe(ELEVATION.GROUND);
    });

    it('puts an elevation outside the levels in the ground band', () => {
        const host = new WorldRenderSystem();

        expect(host.getElevationBandIndex(40)).toBe(3);
        expect(host.getElevationBandIndex(-40)).toBe(3);
    });

    it('stacks a band as bed, drawable, rail, onTrack, catenary, shadow', () => {
        const host = new WorldRenderSystem();
        const items = {
            bed: new Container(),
            drawable: new Container(),
            rail: new Container(),
            onTrack: new Container(),
            catenary: new Container(),
            shadow: new Container(),
        };
        host.addBed('bed', items.bed, ELEVATION.ABOVE_1);
        host.addToBand('drawable', items.drawable, 4, 'drawable');
        host.addToBand('rail', items.rail, 4, 'rail');
        host.addToBand('onTrack', items.onTrack, 4, 'onTrack');
        host.addToBand('catenary', items.catenary, 4, 'catenary');
        host.addShadow('shadow', items.shadow, ELEVATION.ABOVE_1);

        expect(
            Object.values(items).map(item => placement(item).sublayerZ)
        ).toEqual([0, 1, 2, 3, 4, 5]);
        expect(
            Object.values(items).every(item => placement(item).bandZ === 4)
        ).toBe(true);
    });

    it('gives each band a terrain occlusion container just below it', () => {
        const host = new WorldRenderSystem();

        expect(host.getTerrainOcclusionContainer(0)?.zIndex).toBe(-0.5);
        expect(host.getTerrainOcclusionContainer(4)?.zIndex).toBe(3.5);
        expect(host.terrainBaseContainer.zIndex).toBe(-1);
    });

    it('moves a key that is added again to its new band and sublayer', () => {
        const host = new WorldRenderSystem();
        const item = new Container();

        host.addToBand('item', item, 3, 'drawable');
        host.addToBand('item', item, 5, 'rail');

        expect(placement(item)).toEqual({ sublayerZ: 2, bandZ: 5 });
        expect(host.getBandIndex('item')).toBe(5);
    });

    it('returns band and unbanded items on removal without destroying them', () => {
        const host = new WorldRenderSystem();
        const banded = new Container();
        const unbanded = new Container();
        host.addToBand('banded', banded, 3, 'drawable');
        host.addDrawable('unbanded', unbanded);

        expect(host.getDrawable('banded')).toBe(banded);
        expect(host.getDrawable('unbanded')).toBe(unbanded);
        expect(host.removeFromBand('banded')).toBe(banded);
        expect(host.removeDrawable('unbanded')).toBe(unbanded);
        expect(banded.destroyed).toBe(false);
        expect(banded.parent).toBeNull();
        expect(unbanded.parent).toBeNull();
        expect(host.getDrawable('banded')).toBeUndefined();
    });

    it('destroys beds and shadows on removal', () => {
        const host = new WorldRenderSystem();
        const bed = new Container();
        const shadow = new Container();
        host.addBed('bed', bed, ELEVATION.GROUND);
        host.addShadow('shadow', shadow, ELEVATION.GROUND);

        host.removeBed('bed');
        host.removeShadow('shadow');

        expect(bed.destroyed).toBe(true);
        expect(shadow.destroyed).toBe(true);
    });

    it('draws overlays above the bands unless given a z-index', () => {
        const host = new WorldRenderSystem();
        const overlay = new Container();
        const below = new Container();

        host.addOverlayContainer(overlay);
        host.addOverlayContainer(below, { zIndex: -2 });

        expect(overlay.parent).toBe(host.container);
        expect(overlay.zIndex).toBe(3);
        expect(below.zIndex).toBe(-2);
        host.removeOverlayContainer(overlay);
        expect(overlay.parent).toBeNull();
    });

    it('destroys everything it holds on cleanup', () => {
        const host = new WorldRenderSystem();
        const items = [new Container(), new Container(), new Container()];
        host.addToBand('banded', items[0], 3, 'rail');
        host.addBed('bed', items[1], ELEVATION.GROUND);
        host.addDrawable('unbanded', items[2]);

        host.cleanup();

        expect(items.every(item => item.destroyed)).toBe(true);
        expect(host.container.destroyed).toBe(true);
    });
});
