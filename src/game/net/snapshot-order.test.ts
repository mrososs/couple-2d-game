import { describe, expect, test } from 'vitest';
import { SnapshotOrder } from './snapshot-order.ts';

describe("the guest's snapshot order", () => {
  test('nothing applies before a full snapshot; then deltas apply in order', () => {
    const o = new SnapshotOrder();
    expect(o.accept('r1', 1, false)).toBe('resync');
    expect(o.accept('r1', 2, true)).toBe('apply');
    expect(o.accept('r1', 3, false)).toBe('apply');
    expect(o.accept('r1', 4, false)).toBe('apply');
    expect(o.isSynced).toBe(true);
  });

  test('a repeated or older snapshot is dropped', () => {
    const o = new SnapshotOrder();
    o.accept('r1', 5, true);
    o.accept('r1', 6, false);
    expect(o.accept('r1', 6, false)).toBe('drop');
    expect(o.accept('r1', 4, false)).toBe('drop');
    expect(o.accept('r1', 5, true)).toBe('drop');
    expect(o.accept('r1', 7, false)).toBe('apply');
  });

  test('a gap stops deltas until a full snapshot arrives', () => {
    const o = new SnapshotOrder();
    o.accept('r1', 1, true);
    expect(o.accept('r1', 3, false)).toBe('resync');
    expect(o.isSynced).toBe(false);
    expect(o.accept('r1', 4, false)).toBe('resync');
    expect(o.accept('r1', 5, true)).toBe('apply');
    expect(o.accept('r1', 6, false)).toBe('apply');
  });

  test('a restarted level is a new run: its deltas wait for its first full snapshot', () => {
    const o = new SnapshotOrder();
    o.accept('r1', 30, true);
    expect(o.accept('r2', 2, false)).toBe('resync');
    expect(o.accept('r2', 1, true)).toBe('apply');
    expect(o.currentRun).toBe('r2');
    expect(o.accept('r2', 2, false)).toBe('apply');
  });

  test('a new connection waits for a whole picture again', () => {
    const o = new SnapshotOrder();
    o.accept('r1', 1, true);
    o.invalidate();
    expect(o.accept('r1', 2, false)).toBe('resync');
    expect(o.accept('r1', 3, true)).toBe('apply');
  });
});
