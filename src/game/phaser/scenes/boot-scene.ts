import Phaser from 'phaser';
import type { CharacterId } from '../../bridge/protocol.ts';
import { L1_CARDS, L3_PIECES } from '../../domain/levels/content.ts';
import { footprint } from '../../domain/nursery.ts';
import { drawCharacterSheet, drawPortrait, drawShadowTexture, FRAME_H, FRAME_W, OUTFITS, SHEET_COLUMNS } from '../art/characters.ts';
import {
  drawCard,
  drawChevron,
  drawConfetti,
  drawGlow,
  drawItem,
  drawJoystickBase,
  drawJoystickKnob,
  drawRing,
  drawRoundButton,
  drawSparkle,
  drawStarTexture,
  ITEM_ART_KEYS,
  type IconName,
} from '../art/items.ts';
import { drawPiece, pieceTextureKey } from '../art/pieces.ts';
import { drawProp, PROPS } from '../art/props.ts';
import { COLORS, servicesOf } from '../services.ts';

/**
 * Draws every texture the game uses - characters, furniture, items, HUD - and registers the
 * character animations, then hands over to the level. Nothing is downloaded: this is the game's
 * whole asset pipeline, and it takes a few hundred milliseconds on a phone.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  create(): void {
    const { session } = servicesOf(this);
    for (const id of ['wife', 'husband'] as const) ensureCharacter(this, id, session.outfits[id]);

    for (const key of Object.keys(PROPS)) this.addCanvas(`prop-${key}`, drawProp(key));
    for (const key of ITEM_ART_KEYS) this.addCanvas(`item-${key}`, drawItem(key));
    for (const card of L1_CARDS) this.addCanvas(`card-${card.id}`, drawCard(card.icon as IconName, '#F2C14E'));
    for (const piece of L3_PIECES) {
      for (const rotation of [0, 90] as const) {
        const { w, h } = footprint(piece, rotation);
        const key = pieceTextureKey(piece.art, w, h);
        if (!this.textures.exists(key)) this.addCanvas(key, drawPiece(piece.art, w, h));
      }
    }

    this.addCanvas('shadow', drawShadowTexture());
    this.addCanvas('joy-base', drawJoystickBase());
    this.addCanvas('joy-knob', drawJoystickKnob());
    this.addCanvas('btn-interact', drawRoundButton('hand', '#F2C14E', 132));
    this.addCanvas('btn-rotate', drawRoundButton('rotate', '#9ED2C6', 96));
    this.addCanvas('btn-swap', drawRoundButton('swap', '#FFF1DE', 96));
    this.addCanvas('chevron-wife', drawChevron(COLORS.wife));
    this.addCanvas('chevron-husband', drawChevron(COLORS.husband));
    this.addCanvas('ring-wife', drawRing(COLORS.wife));
    this.addCanvas('ring-husband', drawRing(COLORS.husband));
    this.addCanvas('star', drawStarTexture(48));
    this.addCanvas('star-empty', drawStarTexture(48, '#E8DCC8'));
    this.addCanvas('sparkle', drawSparkle());
    this.addCanvas('confetti', drawConfetti());
    this.addCanvas('glow', drawGlow(256));
    this.addCanvas('glow-cool', drawGlow(256, '190, 230, 255'));

    // The HUD runs beside every level, above it. A guest phone draws the host's level instead.
    this.scene.launch('hud');
    this.scene.start(session.net?.role === 'guest' ? 'mirror' : 'level');
  }

  private addCanvas(key: string, canvas: HTMLCanvasElement): void {
    if (this.textures.exists(key)) this.textures.remove(key);
    this.textures.addCanvas(key, canvas);
  }
}

export function characterKey(id: CharacterId, outfit: number): string {
  return `${id}${outfit}`;
}

/** The sheet, portraits and animations for one character in one outfit, made once per outfit. */
export function ensureCharacter(scene: Phaser.Scene, id: CharacterId, outfit: number): string {
  const key = characterKey(id, outfit);
  if (scene.textures.exists(`char-${key}`)) return key;
  const look = OUTFITS[id][outfit] ?? OUTFITS[id][0];
  const { canvas, frames } = drawCharacterSheet(id, look);
  const texture = scene.textures.addCanvas(`char-${key}`, canvas)!;
  frames.forEach((name, i) => texture.add(name, 0, (i % SHEET_COLUMNS) * FRAME_W, Math.floor(i / SHEET_COLUMNS) * FRAME_H, FRAME_W, FRAME_H));
  scene.textures.addCanvas(`portrait-${key}`, drawPortrait(id, look, 112));

  const anim = (name: string, frameNames: string[], frameRate: number, repeat = -1) =>
    scene.anims.create({
      key: `${key}-${name}`,
      frames: frameNames.map((frame) => ({ key: `char-${key}`, frame })),
      frameRate,
      repeat,
    });
  for (const dir of ['down', 'up', 'side']) {
    anim(`idle-${dir}`, [0, 1, 0, 1, 0, 1, 2, 0].map((i) => `idle-${dir}-${i}`), 3);
    anim(`walk-${dir}`, [0, 1, 2, 3].map((i) => `walk-${dir}-${i}`), 9);
    anim(`carry-idle-${dir}`, [0, 1].map((i) => `carry-idle-${dir}-${i}`), 3);
    anim(`carry-walk-${dir}`, [0, 1, 2, 3].map((i) => `carry-walk-${dir}-${i}`), 8);
    anim(`interact-${dir}`, ['interact-' + dir + '-0', 'interact-' + dir + '-1', 'interact-' + dir + '-0'], 10, 0);
  }
  anim('happy', ['happy-0', 'happy-1', 'happy-0', 'happy-1'], 6, 1);
  anim('tired', ['tired-0', 'tired-1'], 2, 2);
  anim('cheer', ['cheer-0', 'cheer-1'], 5, -1);
  return key;
}
