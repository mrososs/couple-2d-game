import { DEFAULT_SETTINGS, LEVEL_IDS, type CharacterId, type GameSettings, type LevelId, type LevelResult } from '../../game/bridge/protocol.ts';

/**
 * ProgressManager's rules, as pure functions over the saved data: what is unlocked, how a result
 * is recorded, and how an older or damaged save is brought back to a usable shape.
 */

export interface LevelRecord {
  readonly stars: number;
  readonly bestTimeSec: number;
  readonly plays: number;
  readonly lastPlayed: string;
}

export interface Profile {
  readonly lead: CharacterId;
  readonly names: Readonly<Record<CharacterId, string>>;
  readonly outfits: Readonly<Record<CharacterId, number>>;
}

export interface AppSettings extends GameSettings {
  readonly devMode: boolean;
}

export interface SaveData {
  readonly version: 1;
  readonly onboarded: boolean;
  readonly profile: Profile;
  readonly settings: AppSettings;
  readonly records: Readonly<Partial<Record<LevelId, LevelRecord>>>;
}

export const DEFAULT_PROFILE: Profile = {
  lead: 'wife',
  names: { wife: 'منى', husband: 'كريم' },
  outfits: { wife: 0, husband: 0 },
};

export const DEFAULT_SAVE: SaveData = {
  version: 1,
  onboarded: false,
  profile: DEFAULT_PROFILE,
  settings: { ...DEFAULT_SETTINGS, devMode: false },
  records: {},
};

/** The first level is always open; each later one opens when the one before it is finished. */
export function isUnlocked(save: SaveData, id: LevelId): boolean {
  const i = LEVEL_IDS.indexOf(id);
  return i === 0 || !!save.records[LEVEL_IDS[i - 1]];
}

export function nextLevel(id: LevelId): LevelId | null {
  return LEVEL_IDS[LEVEL_IDS.indexOf(id) + 1] ?? null;
}

export function totalStars(save: SaveData): number {
  return LEVEL_IDS.reduce((sum, id) => sum + (save.records[id]?.stars ?? 0), 0);
}

/** Records a finished level, keeping the best stars and time, and says what it unlocked. */
export function applyResult(save: SaveData, result: LevelResult, now = new Date()): { save: SaveData; unlocked: LevelId | null } {
  const before = save.records[result.levelId];
  const record: LevelRecord = {
    stars: Math.max(before?.stars ?? 0, clampStars(result.stars)),
    bestTimeSec: before ? Math.min(before.bestTimeSec, result.durationSec) : result.durationSec,
    plays: (before?.plays ?? 0) + 1,
    lastPlayed: now.toISOString(),
  };
  const next = nextLevel(result.levelId);
  const unlocked = next && !isUnlocked(save, next) ? next : null;
  return { save: { ...save, records: { ...save.records, [result.levelId]: record } }, unlocked };
}

/** Fills in anything missing from a stored save, so a partial or older one still loads. */
export function normalizeSave(value: unknown): SaveData {
  if (!value || typeof value !== 'object') return DEFAULT_SAVE;
  const v = value as Partial<SaveData>;
  const profile = v.profile ?? DEFAULT_PROFILE;
  return {
    version: 1,
    onboarded: !!v.onboarded,
    profile: {
      lead: profile.lead === 'husband' ? 'husband' : 'wife',
      names: { ...DEFAULT_PROFILE.names, ...profile.names },
      outfits: { ...DEFAULT_PROFILE.outfits, ...profile.outfits },
    },
    settings: { ...DEFAULT_SAVE.settings, ...v.settings },
    records: Object.fromEntries(Object.entries(v.records ?? {}).filter(([id]) => (LEVEL_IDS as readonly string[]).includes(id))),
  };
}

function clampStars(stars: number): number {
  return Math.max(1, Math.min(3, Math.round(stars)));
}
