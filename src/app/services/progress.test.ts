import { Injector, runInInjectionContext } from '@angular/core';
import { describe, expect, test } from 'vitest';
import type { LevelResult } from '../../game/bridge/protocol.ts';
import { KEY_VALUE_STORE, MemoryStore } from './kv-store.ts';
import { Progress } from './progress.ts';
import { applyResult, DEFAULT_SAVE, isUnlocked, normalizeSave, totalStars } from './progress-rules.ts';

const result = (levelId: LevelResult['levelId'], stars: number, durationSec = 120): LevelResult => ({ levelId, stars, durationSec, insights: [], metrics: {} });

describe('progression rules', () => {
  test('only the first level is open at the start', () => {
    expect(isUnlocked(DEFAULT_SAVE, 'level01')).toBe(true);
    expect(isUnlocked(DEFAULT_SAVE, 'level02')).toBe(false);
    expect(isUnlocked(DEFAULT_SAVE, 'level03')).toBe(false);
  });

  test('finishing a level opens the next and says so once', () => {
    const first = applyResult(DEFAULT_SAVE, result('level01', 2));
    expect(first.unlocked).toBe('level02');
    expect(isUnlocked(first.save, 'level02')).toBe(true);
    expect(applyResult(first.save, result('level01', 3)).unlocked).toBeNull();
    expect(applyResult(first.save, result('level03', 1)).unlocked).toBeNull();
  });

  test('the best stars and time are kept, and plays are counted', () => {
    let save = applyResult(DEFAULT_SAVE, result('level01', 3, 200)).save;
    save = applyResult(save, result('level01', 1, 90)).save;
    expect(save.records.level01).toMatchObject({ stars: 3, bestTimeSec: 90, plays: 2 });
    expect(totalStars(save)).toBe(3);
  });

  test('a finished level always earns at least one star', () => {
    expect(applyResult(DEFAULT_SAVE, result('level01', 0)).save.records.level01?.stars).toBe(1);
  });

  test('a damaged or partial save loads with defaults filled in', () => {
    expect(normalizeSave(null)).toEqual(DEFAULT_SAVE);
    const partial = normalizeSave({ onboarded: true, profile: { names: { wife: 'سلمى' } }, records: { level01: { stars: 2 }, bogus: {} } });
    expect(partial.profile.names).toEqual({ wife: 'سلمى', husband: 'كريم' });
    expect(partial.profile.lead).toBe('wife');
    expect(Object.keys(partial.records)).toEqual(['level01']);
    expect(partial.settings.sound).toBe(true);
    expect(partial.savedResults).toEqual([]);
    expect(normalizeSave({ savedResults: ['a', 3, null, 'b'] }).savedResults).toEqual(['a', 'b']);
  });
});

describe('Progress (persistence)', () => {
  const progressOn = (store: MemoryStore) =>
    runInInjectionContext(Injector.create({ providers: [{ provide: KEY_VALUE_STORE, useValue: store }, { provide: Progress }] }), () => new Progress());

  test('progress written by one session is read back by the next', () => {
    const disk = new MemoryStore();
    const first = progressOn(disk);
    expect(first.recordResult(result('level01', 3))).toBe('level02');
    first.setName('husband', 'عمر');
    first.updateSettings({ sound: false });

    // A new app launch: a fresh service over the same stored text.
    const relaunched = progressOn(new MemoryStore({ 'bwbt.save.v1': disk.raw('bwbt.save.v1') }));
    expect(relaunched.isUnlocked('level02')).toBe(true);
    expect(relaunched.record('level01')?.stars).toBe(3);
    expect(relaunched.profile().names.husband).toBe('عمر');
    expect(relaunched.settings().sound).toBe(false);
  });

  test('a result that arrives twice (two-phone play) is saved once, and remembered across launches', () => {
    const disk = new MemoryStore();
    const p = progressOn(disk);
    const played = { ...result('level01', 2), id: 'room1:runA' };
    expect(p.recordResult(played)).toBe('level02');
    expect(p.recordResult(played)).toBeNull();
    expect(p.record('level01')?.plays).toBe(1);
    const relaunched = progressOn(new MemoryStore({ 'bwbt.save.v1': disk.raw('bwbt.save.v1') }));
    expect(relaunched.hasResult('room1:runA')).toBe(true);
    relaunched.recordResult(played);
    expect(relaunched.record('level01')?.plays).toBe(1);
    // A different play of the same level still counts.
    relaunched.recordResult({ ...played, id: 'room1:runB', stars: 3 });
    expect(relaunched.record('level01')).toMatchObject({ plays: 2, stars: 3 });
  });

  test("the partner's result never lowers a record made on this phone", () => {
    const p = progressOn(new MemoryStore());
    p.recordResult({ ...result('level02', 3, 100), id: 'a' });
    p.recordResult({ ...result('level02', 1, 300), id: 'b' });
    expect(p.record('level02')).toMatchObject({ stars: 3, bestTimeSec: 100 });
  });

  test('resetting forgets the levels but keeps who is playing', () => {
    const p = progressOn(new MemoryStore());
    p.setName('wife', 'هالة');
    p.recordResult(result('level01', 2));
    p.resetProgress();
    expect(p.isUnlocked('level02')).toBe(false);
    expect(p.profile().names.wife).toBe('هالة');
  });
});
