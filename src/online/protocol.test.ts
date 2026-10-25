import { describe, expect, test } from 'vitest';
import { formatOnlineCode, normalizeRoomCode, ROOM_CODE_ALPHABET, toOnlineError } from './protocol.ts';

describe('online room codes', () => {
  test('codes are read the way people type them', () => {
    expect(normalizeRoomCode('ABCDEF')).toBe('ABCDEF');
    expect(normalizeRoomCode('abc-def')).toBe('ABCDEF');
    expect(normalizeRoomCode(' ab c de f ')).toBe('ABCDEF');
    expect(normalizeRoomCode('K7M-٢٣٤')).toBe('K7M234');
  });

  test('anything that cannot be a code is rejected before it reaches the server', () => {
    for (const bad of ['', 'ABCDE', 'ABCDEFG', 'ABCDE0', 'ABCDE1', 'ABCDEI', 'ABCDEO']) expect(normalizeRoomCode(bad), bad).toBeNull();
  });

  test('the alphabet has 32 characters, none of them easy to misread', () => {
    expect(ROOM_CODE_ALPHABET).toHaveLength(32);
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[IO01]/);
  });

  test('codes are shown as two groups of three', () => {
    expect(formatOnlineCode('K7M234')).toBe('K7M-234');
  });
});

describe('toOnlineError', () => {
  test('a game function error keeps its key and detail', () => {
    const error = toOnlineError({ message: 'puzzles_unsolved', code: 'P0001', details: 'l1.plan_review' });
    expect(error.key).toBe('puzzles_unsolved');
    expect(error.detail).toBe('l1.plan_review');
  });

  test('a refused write is a permission error, a failed fetch a network error', () => {
    expect(toOnlineError({ message: 'permission denied for table level_progress', code: '42501' }).key).toBe('permission_denied');
    expect(toOnlineError({ message: 'TypeError: Failed to fetch' }).key).toBe('network');
    expect(toOnlineError(null).key).toBe('unknown');
  });
});
