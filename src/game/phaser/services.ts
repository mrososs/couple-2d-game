import Phaser from 'phaser';
import type { CharacterId, GameEvent, GameSession, GameSettings } from '../bridge/protocol.ts';
import type { EffectEvent, HapticKind } from '../net/protocol.ts';
import type { Sfx } from './audio/sfx.ts';

/**
 * What every scene shares: the session it was started with, live settings, the sound synth and
 * the one way out to the native app. Kept in the game registry so scenes need no globals.
 */
export interface GameServices {
  session: GameSession;
  settings: GameSettings;
  readonly sfx: Sfx;
  emit(event: GameEvent): void;
  /** Feel on the phone of the character it concerns (both phones for shared moments). */
  haptic(kind: HapticKind, who?: CharacterId | 'both'): void;
  /** A longer buzz on one character's phone, as when their partner asks for a hand. */
  vibrate(who: CharacterId): void;
  /** Set by the host's network layer: effects the guest's phone should play as well. */
  relay?: (effect: EffectEvent) => void;
}

/**
 * Haptics and vibration go to the phone they concern. With one phone that is always this one;
 * with two, this page only reaches its own player's phone and passes the rest to the guest.
 */
export function routeFeel(services: GameServices, effect: Extract<EffectEvent, { k: 'haptic' | 'vibrate' }>): void {
  const me = services.session.net?.me;
  const who = effect.who;
  const mine = !me || who === 'both' || who === me;
  if (mine) services.emit(effect.k === 'haptic' ? { type: 'haptic', kind: effect.kind } : { type: 'vibrate' });
  if (services.session.net?.role === 'host' && (who === 'both' || who !== me)) services.relay?.(effect);
}

const KEY = 'services';

export function provideServices(game: Phaser.Game, services: GameServices): void {
  game.registry.set(KEY, services);
}

export function servicesOf(scene: Phaser.Scene): GameServices {
  const services = scene.registry.get(KEY) as GameServices | undefined;
  if (!services) throw new Error('Game services are missing from the registry');
  return services;
}

export const FONT = '"Baloo Bhaijaan 2", "Noto Naskh Arabic", "Segoe UI", Tahoma, sans-serif';

export const COLORS = {
  ink: '#3B2416',
  paper: '#FFF8EC',
  wife: '#E8735A',
  husband: '#3E7CB1',
  shared: '#8E6BBF',
  good: '#4CAF7A',
  warn: '#F2A93B',
  bad: '#E05A5A',
} as const;

export const PLAYER_COLOR: Record<CharacterId, string> = { wife: COLORS.wife, husband: COLORS.husband };

export function hex(color: string): number {
  return parseInt(color.slice(1), 16);
}

/**
 * Arabic text, laid out right to left so numbers and emoji land on the correct side. Phaser 4.2.1
 * draws nothing for a Text with both `rtl` and a `resolution` above 1 (checked in the browser), so
 * these stay at the default resolution.
 */
export function arabic(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  size: number,
  color: string = COLORS.ink,
  extra: Phaser.Types.GameObjects.Text.TextStyle = {},
): Phaser.GameObjects.Text {
  return scene.add
    .text(x, y, text, {
      fontFamily: FONT,
      fontSize: `${size}px`,
      color,
      rtl: true,
      align: 'center',
      padding: { top: Math.round(size * 0.25), bottom: Math.round(size * 0.15) },
      ...extra,
    })
    .setOrigin(0.5);
}
