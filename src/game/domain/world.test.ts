import { describe, expect, test } from 'vitest';
import { LEVEL_IDS } from '../bridge/protocol.ts';
import { L1_CARDS, L2_PRODUCTS, L3_PIECES, LEVELS } from './levels/content.ts';
import { ObjectiveManager } from './objectives.ts';
import { APARTMENT, APARTMENT_AND_SHOP, buildMap, isWalkable, solidRects, TILE, type TileMap } from './tile-map.ts';

/** Every walkable cell reachable from a start cell, four-way. */
function reachable(map: TileMap, col: number, row: number): Set<string> {
  const seen = new Set<string>([`${col},${row}`]);
  const queue = [[col, row]];
  while (queue.length) {
    const [c, r] = queue.shift()!;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${c + dc},${r + dr}`;
      if (!seen.has(k) && isWalkable(map.cells[r + dr]?.[c + dc])) {
        seen.add(k);
        queue.push([c + dc, r + dr]);
      }
    }
  }
  return seen;
}

const cellOf = (x: number, y: number) => `${Math.floor(x / TILE)},${Math.floor(y / TILE)}`;

describe('the apartment', () => {
  const map = buildMap(APARTMENT);
  const fromLiving = reachable(map, 10, 15);

  test('every room opens onto the living room', () => {
    for (const room of map.rooms) expect(fromLiving.has(`${room.x + 1},${room.y + 1}`)).toBe(true);
  });

  test('wall faces sit above every room, broken only by doorways', () => {
    for (const room of map.rooms) {
      const above = map.cells[room.y - 1].slice(room.x, room.x + room.w);
      expect(above.every((c) => c === 'W' || c === 'd'), room.id).toBe(true);
      expect(above.includes('W'), room.id).toBe(true);
    }
  });

  test('solid rectangles cover exactly the solid cells', () => {
    const covered = new Set<string>();
    for (const r of solidRects(map)) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) covered.add(`${x},${y}`);
    for (let y = 0; y < map.rows; y++) for (let x = 0; x < map.cols; x++) expect(covered.has(`${x},${y}`)).toBe(!isWalkable(map.cells[y][x]));
  });

  test("level 1's cards and level 3's furniture start on reachable floor", () => {
    for (const card of L1_CARDS) expect(fromLiving.has(cellOf(card.x, card.y)), card.id).toBe(true);
    for (const piece of L3_PIECES) expect(fromLiving.has(cellOf(piece.x, piece.y - 1)), piece.id).toBe(true);
  });
});

describe('the apartment and the shop', () => {
  const map = buildMap(APARTMENT_AND_SHOP);
  const fromHall = reachable(map, 35, 17);

  test('the front door leads across the street into the shop and its storeroom', () => {
    expect(fromHall.has('42,15')).toBe(true);
    expect(fromHall.has('50,10')).toBe(true);
    expect(fromHall.has('59,2')).toBe(true);
  });

  test("level 2's products start on reachable floor", () => {
    for (const p of L2_PRODUCTS) expect(fromHall.has(cellOf(p.x, p.y - 1)), p.id).toBe(true);
  });
});

describe('levels', () => {
  test('three levels, in order, each with one learning objective and objectives to play', () => {
    expect(LEVELS.map((l) => l.id)).toEqual(LEVEL_IDS);
    for (const level of LEVELS) {
      expect(level.learning.length).toBeGreaterThan(5);
      expect(level.objectives.length).toBeGreaterThan(1);
      expect(level.objectives[0].hidden).toBeFalsy();
      expect(Object.keys(level.insights).length).toBeGreaterThan(2);
    }
  });

  test('the safe-sleep level cites recognised sources and says it is not medical advice', () => {
    const level3 = LEVELS[2];
    expect(level3.sources.map((s) => s.publisher)).toEqual(expect.arrayContaining(['UNICEF', 'American Academy of Pediatrics']));
    expect(level3.disclaimer).toBeTruthy();
    expect(level3.reviewNotes.length).toBeGreaterThan(0);
  });

  test('the budget level labels its prices as illustrative', () => {
    expect(LEVELS[1].disclaimer).toContain('توضيحية');
  });
});

describe('ObjectiveManager', () => {
  test('reveals, completes and reopens, and reports progress', () => {
    const o = new ObjectiveManager([{ id: 'a', text: 'A' }, { id: 'b', text: 'B', hidden: true }]);
    const seen: number[] = [];
    o.onChange((list) => seen.push(list.filter((x) => x.done).length));
    expect(o.current()?.id).toBe('a');
    expect(o.complete('a')).toBe(true);
    expect(o.complete('a')).toBe(false);
    expect(o.current()).toBeUndefined();
    o.reveal('b');
    expect(o.current()?.id).toBe('b');
    o.complete('b');
    expect(o.allDone()).toBe(true);
    o.reopen('b');
    expect(o.progress()).toEqual({ done: 1, total: 2 });
    expect(seen).toEqual([1, 1, 2, 1]);
  });

  test('an unknown objective is an error, not a silent no-op', () => {
    expect(() => new ObjectiveManager([]).complete('nope')).toThrow();
  });
});
