import type Phaser from 'phaser';
import type { CharacterId, GameSession } from '../../bridge/protocol.ts';
import { L1_SCHEDULE } from '../../domain/levels/content.ts';
import { APARTMENT, APARTMENT_AND_SHOP, buildMap } from '../../domain/tile-map.ts';
import { ensureCharacter } from '../scenes/boot-scene.ts';
import { COLORS } from '../services.ts';
import { drawBackground } from './background.ts';
import { drawCalendar, drawNeedsList, drawPin, drawPlanBoard } from './stations.ts';

/**
 * Every texture the game draws after boot, by key. Levels ask for theirs here, and the guest phone
 * in two-phone play asks for whatever key the host's world uses, so both phones draw the same
 * picture from the same code instead of sending images over the network.
 */
export function ensureTexture(scene: Phaser.Scene, key: string, session: GameSession): boolean {
  if (scene.textures.exists(key)) return true;
  const add = (canvas: HTMLCanvasElement) => {
    scene.textures.addCanvas(key, canvas);
    return true;
  };
  switch (key) {
    case 'bg-apartment':
      return add(drawBackground(buildMap(APARTMENT)));
    case 'bg-apartment-shop':
      return add(drawBackground(buildMap(APARTMENT_AND_SHOP)));
    case 'l1-board':
      return add(drawPlanBoard(session.names));
    case 'l1-calendar':
      return add(drawCalendar(L1_SCHEDULE.doctorDays));
    case 'l2-list':
      return add(drawNeedsList());
    case 'pin-wife':
      return add(drawPin(COLORS.wife));
    case 'pin-husband':
      return add(drawPin(COLORS.husband));
  }
  const character = /^(?:char|portrait)-(wife|husband)(\d+)$/.exec(key);
  if (character) {
    ensureCharacter(scene, character[1] as CharacterId, Number(character[2]));
    return scene.textures.exists(key);
  }
  return false;
}
