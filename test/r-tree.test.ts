import { describe, expect, it } from 'bun:test';

import { RTree, Rectangle } from '../src/shared/r-tree.js';

type Item = { id: string; x: number; y: number };

const ITEMS: Item[] = [
    { id: 'A', x: 1, y: 1 },
    { id: 'B', x: 2, y: 3 },
    { id: 'C', x: 5, y: 2 },
    { id: 'D', x: 8, y: 7 },
    { id: 'E', x: 3, y: 8 },
    { id: 'F', x: 6, y: 4 },
    { id: 'G', x: 9, y: 1 },
    { id: 'H', x: 2, y: 6 },
];

/** An R-tree (4 entries per node) holding each item as a 0.2 × 0.2 box. */
function treeWithItems(): RTree<Item> {
    const tree = new RTree<Item>(4);
    for (const item of ITEMS) {
        tree.insert(
            new Rectangle(
                item.x - 0.1,
                item.y - 0.1,
                item.x + 0.1,
                item.y + 0.1
            ),
            item
        );
    }
    return tree;
}

const ids = (items: Item[]) => items.map(item => item.id).sort();

describe('RTree', () => {
    it('holds every inserted item', () => {
        expect(ids(treeWithItems().getAllObjects())).toEqual(
            ITEMS.map(item => item.id)
        );
    });

    it('finds the items inside a search rectangle', () => {
        const tree = treeWithItems();
        expect(ids(tree.search(new Rectangle(0, 0, 4, 4)))).toEqual(['A', 'B']);
    });

    it('removes an item by its data', () => {
        const tree = treeWithItems();
        expect(tree.removeByData(ITEMS[2])).toBe(true);
        expect(ids(tree.getAllObjects())).toEqual([
            'A',
            'B',
            'D',
            'E',
            'F',
            'G',
            'H',
        ]);
        expect(ids(tree.search(new Rectangle(4, 1, 6, 3)))).toEqual([]);
    });

    it('reports false when removing an item it does not hold', () => {
        const tree = treeWithItems();
        expect(tree.removeByData({ id: 'Z', x: 0, y: 0 })).toBe(false);
    });
});
