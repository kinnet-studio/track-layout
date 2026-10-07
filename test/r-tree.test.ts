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

/** A seeded pseudo-random generator (mulberry32), so a failure reproduces. */
function random(seed: number): () => number {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Thin 5 × 0.1 boxes end to end in rows 10 apart: the boxes of short straight
 * track laid in parallel rows.
 */
function rowsOfBoxes(rows: number, perRow: number): Map<string, Rectangle> {
    const boxes = new Map<string, Rectangle>();
    for (let row = 0; row < rows; row++) {
        for (let i = 0; i < perRow; i++) {
            boxes.set(
                `${row}:${i}`,
                new Rectangle(i * 5, row * 10, i * 5 + 5, row * 10 + 0.1)
            );
        }
    }
    return boxes;
}

/** Expects `tree` to hold each live item once, found by a search of its box. */
function expectHolds(tree: RTree<string>, live: Map<string, Rectangle>) {
    const all = tree.getAllObjects();
    expect(all.length).toBe(live.size);
    expect(new Set(all)).toEqual(new Set(live.keys()));
    for (const [id, box] of live) {
        expect(tree.search(box)).toContain(id);
    }
}

describe('RTree removal', () => {
    for (const rows of [2, 3, 10]) {
        it(`removes every box of ${rows} parallel rows, one at a time`, () => {
            const boxes = rowsOfBoxes(rows, 30);
            const tree = new RTree<string>();
            for (const [id, box] of boxes) tree.insert(box, id);

            const live = new Map(boxes);
            for (const [id, box] of boxes) {
                expect(tree.remove(box, id)).toBe(true);
                live.delete(id);
                expectHolds(tree, live);
            }
        });
    }

    it('keeps every live item through random inserts and removals', () => {
        const next = random(7);
        const tree = new RTree<string>();
        const live = new Map<string, Rectangle>();
        for (let op = 0; op < 3000; op++) {
            if (live.size > 0 && next() < 0.45) {
                const ids = [...live.keys()];
                const id = ids[Math.floor(next() * ids.length)];
                expect(tree.remove(live.get(id)!, id)).toBe(true);
                live.delete(id);
            } else {
                const x = next() * 500;
                const y = next() * 500;
                const box = new Rectangle(
                    x,
                    y,
                    x + next() * 20,
                    y + next() * 20
                );
                tree.insert(box, `${op}`);
                live.set(`${op}`, box);
            }
            if (op % 25 === 0) expectHolds(tree, live);
        }
        expectHolds(tree, live);
    });

    it('takes new items after every item was removed', () => {
        const boxes = rowsOfBoxes(3, 30);
        const tree = new RTree<string>();
        for (const [id, box] of boxes) tree.insert(box, id);
        for (const [id, box] of boxes) tree.remove(box, id);

        const box = new Rectangle(1, 1, 2, 2);
        tree.insert(box, 'new');

        expect(tree.getAllObjects()).toEqual(['new']);
        expect(tree.search(box)).toEqual(['new']);
    });
});
