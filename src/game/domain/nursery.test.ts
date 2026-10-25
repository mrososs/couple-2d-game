import { describe, expect, test } from 'vitest';
import { L3_BEDDING, L3_PIECES, L3_ROOM } from './levels/content.ts';
import { cellsOf, footprint, NurseryLayout, SafeSleepCheck } from './nursery.ts';

const layout = () => new NurseryLayout(L3_ROOM, L3_PIECES);

/** A layout the level accepts: tall furniture on walls, the cot clear of the window. */
function goodLayout(): NurseryLayout {
  const l = layout();
  expect(l.place('dresser', { col: 1, row: 0, rotation: 0 })).toBeNull();
  expect(l.place('changing', { col: 7, row: 0, rotation: 0 })).toBeNull();
  expect(l.place('shelf', { col: 9, row: 0, rotation: 0 })).toBeNull();
  expect(l.place('rocker', { col: 10, row: 5, rotation: 0 })).toBeNull();
  expect(l.place('wardrobe', { col: 12, row: 0, rotation: 90 })).toBeNull();
  expect(l.place('crib', { col: 0, row: 3, rotation: 0 })).toBeNull();
  return l;
}

describe('NurseryLayout', () => {
  test('a sensible layout has no issues', () => {
    expect(goodLayout().evaluate()).toEqual([]);
  });

  test('rotation swaps a footprint', () => {
    const wardrobe = L3_PIECES.find((p) => p.id === 'wardrobe')!;
    expect(footprint(wardrobe, 0)).toEqual({ w: 3, h: 1 });
    expect(footprint(wardrobe, 90)).toEqual({ w: 1, h: 3 });
    expect(cellsOf(wardrobe, { col: 12, row: 0, rotation: 90 })).toEqual([
      { col: 12, row: 0 },
      { col: 12, row: 1 },
      { col: 12, row: 2 },
    ]);
  });

  test('hard rules stop a piece being put down', () => {
    const l = layout();
    expect(l.place('wardrobe', { col: 11, row: 0, rotation: 0 })).toBe('outOfRoom');
    expect(l.place('rocker', { col: 5, row: 5, rotation: 0 })).toBe('blocksDoor');
    expect(l.place('dresser', { col: 0, row: 0, rotation: 0 })).toBeNull();
    expect(l.place('shelf', { col: 1, row: 0, rotation: 0 })).toBe('overlap');
  });

  test('a piece can be moved onto cells it already covers', () => {
    const l = layout();
    l.place('dresser', { col: 0, row: 0, rotation: 0 });
    expect(l.place('dresser', { col: 1, row: 0, rotation: 0 })).toBeNull();
  });

  test('the cot under the window is a safety issue', () => {
    const l = goodLayout();
    l.lift('crib');
    l.place('crib', { col: 2, row: 1, rotation: 0 });
    expect(l.evaluate()).toContainEqual({ kind: 'cribByWindow', pieceId: 'crib' });
  });

  test('tall furniture away from a wall cannot be anchored', () => {
    const l = goodLayout();
    l.lift('dresser');
    l.place('dresser', { col: 3, row: 3, rotation: 0 });
    expect(l.evaluate()).toContainEqual({ kind: 'notAnchored', pieceId: 'dresser' });
  });

  test('a cot walled in by other furniture is unreachable from the door', () => {
    const l = layout();
    expect(l.place('crib', { col: 0, row: 0, rotation: 0 })).toBeNull();
    // Furniture on every free side of the cot's corner cuts it off from the door.
    expect(l.place('shelf', { col: 2, row: 0, rotation: 90 })).toBeNull();
    expect(l.place('dresser', { col: 2, row: 2, rotation: 90 })).toBeNull();
    expect(l.place('changing', { col: 0, row: 3, rotation: 0 })).toBeNull();
    expect(l.evaluate()).toContainEqual({ kind: 'unreachable', pieceId: 'crib' });
  });

  test('pieces not yet placed are listed', () => {
    expect(layout().evaluate().filter((i) => i.kind === 'notPlaced')).toHaveLength(L3_PIECES.length);
  });

  test('the cot and the wardrobe need two people; the rest one', () => {
    expect(L3_PIECES.filter((p) => p.heavy).map((p) => p.id)).toEqual(['crib', 'wardrobe']);
  });
});

describe('SafeSleepCheck', () => {
  test('the cot starts full of soft things and only the fitted sheet belongs', () => {
    const check = new SafeSleepCheck(L3_BEDDING);
    expect(check.isSafe()).toBe(false);
    expect(check.findings().unsafeLeft.map((b) => b.id)).toEqual(['pillow', 'bumper', 'plush', 'quilt']);
  });

  test('clearing the loose things and keeping the sheet makes it safe', () => {
    const check = new SafeSleepCheck(L3_BEDDING);
    for (const id of ['pillow', 'bumper', 'plush', 'quilt']) check.takeOut(id);
    expect(check.isSafe()).toBe(true);
    expect(check.contents().map((b) => b.id)).toEqual(['sheet']);
  });

  test('taking the fitted sheet out is not safer: it has to go back', () => {
    const check = new SafeSleepCheck(L3_BEDDING);
    for (const id of ['pillow', 'bumper', 'plush', 'quilt', 'sheet']) check.takeOut(id);
    expect(check.findings().safeMissing.map((b) => b.id)).toEqual(['sheet']);
    check.putBack('sheet');
    expect(check.isSafe()).toBe(true);
  });

  test('every bedding item explains itself', () => {
    for (const b of L3_BEDDING) expect(b.why.length).toBeGreaterThan(10);
  });
});
