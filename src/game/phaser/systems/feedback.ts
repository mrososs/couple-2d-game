import Phaser from 'phaser';
import type { Sfx, SfxName } from '../audio/sfx.ts';
import { arabic, COLORS, servicesOf } from '../services.ts';
import type { Player } from './player.ts';

/**
 * Feedback in the world: speech bubbles over a character's head, numbers that float up from where
 * something happened, and small particle bursts. Short, warm and out of the way - the game teaches
 * by what happens, not by panels of text.
 */

interface Bubble {
  readonly box: Phaser.GameObjects.Container;
  readonly until: number;
  readonly follow: Player | null;
  readonly x: number;
  readonly y: number;
}

export class Feedback {
  private readonly bubbles = new Map<string, Bubble>();
  private readonly sparkles: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly hearts: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly sfx: Sfx,
    private readonly reducedMotion: () => boolean,
  ) {
    this.sparkles = scene.add
      .particles(0, 0, 'sparkle', {
        speed: { min: 60, max: 220 },
        lifespan: 700,
        scale: { start: 1.4, end: 0 },
        alpha: { start: 1, end: 0 },
        blendMode: 'ADD',
        emitting: false,
      })
      .setDepth(100003);
    this.hearts = scene.add
      .particles(0, 0, 'star', {
        speed: { min: 40, max: 140 },
        angle: { min: 220, max: 320 },
        lifespan: 1100,
        scale: { start: 0.45, end: 0.1 },
        alpha: { start: 1, end: 0 },
        gravityY: 120,
        emitting: false,
      })
      .setDepth(100003);
  }

  play(name: SfxName): void {
    this.sfx.play(name);
    // Shared moments are felt as well as heard, on both phones.
    const services = servicesOf(this.scene);
    if (name === 'success' || name === 'chime') services.haptic('success', 'both');
    else if (name === 'error') services.haptic('warning', 'both');
    else if (name === 'coin') services.haptic('light', 'both');
  }

  /**
   * A speech bubble over a character (or a spot), replacing any bubble already there. A private
   * bubble is for one player's eyes: with two phones it shows on that player's phone only.
   */
  say(target: Player | { x: number; y: number; key: string }, text: string, ms = 2600, accent: string = COLORS.ink, privateTo?: Player['id']): void {
    const key = 'id' in target ? target.id : target.key;
    this.bubbles.get(key)?.box.destroy();
    const label = arabic(this.scene, 0, 0, text, 18, COLORS.ink, { wordWrap: { width: 280, useAdvancedWrap: true } });
    const w = Math.max(80, label.width + 24);
    const h = label.height + 14;
    const bg = this.scene.add.graphics();
    bg.fillStyle(0x3b2416, 0.18).fillRoundedRect(-w / 2 + 2, -h / 2 + 4, w, h, 14);
    bg.fillStyle(0xfff8ec, 1).fillRoundedRect(-w / 2, -h / 2, w, h, 14);
    bg.lineStyle(3, Phaser.Display.Color.HexStringToColor(accent).color, 1).strokeRoundedRect(-w / 2, -h / 2, w, h, 14);
    bg.fillStyle(0xfff8ec, 1).fillTriangle(-8, h / 2 - 2, 8, h / 2 - 2, 0, h / 2 + 10);
    const box = this.scene.add.container(0, 0, [bg, label]).setDepth(100004);
    const net = servicesOf(this.scene).session.net;
    if (privateTo && net) {
      // The host keeps its own player's secrets off the network, and draws the guest's secrets
      // only on the guest's phone.
      if (privateTo === net.me) box.setData('local', true);
      else box.setData('guestOnly', true).setVisible(false);
    }
    const follow = 'id' in target ? target : null;
    this.bubbles.set(key, { box, until: this.scene.time.now + ms, follow, x: target.x, y: target.y });
    box.setScale(0.6);
    this.scene.tweens.add({ targets: box, scale: 1, duration: 180, ease: 'Back.easeOut' });
    this.position(this.bubbles.get(key)!);
  }

  /** A number or word that drifts up and fades: "+1", "−300 ج". */
  float(x: number, y: number, text: string, color: string = COLORS.ink): void {
    const t = arabic(this.scene, x, y, text, 22, color, { stroke: '#FFF8EC', strokeThickness: 5 }).setDepth(100005);
    this.scene.tweens.add({ targets: t, y: y - 60, alpha: 0, duration: 1200, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  burst(x: number, y: number, count = 16, relay = true): void {
    this.sparkles.explode(this.reducedMotion() ? Math.ceil(count / 3) : count, x, y);
    if (relay) servicesOf(this.scene).relay?.({ k: 'burst', x, y, n: count });
  }

  celebrate(x: number, y: number, relay = true): void {
    this.burst(x, y, 24, false);
    this.hearts.explode(this.reducedMotion() ? 4 : 12, x, y - 30);
    if (relay) servicesOf(this.scene).relay?.({ k: 'burst', x, y, n: 24, celebrate: true });
  }

  shake(): void {
    if (!this.reducedMotion()) this.scene.cameras.main.shake(140, 0.004);
  }

  update(): void {
    const now = this.scene.time.now;
    for (const [key, bubble] of this.bubbles) {
      if (now > bubble.until) {
        bubble.box.destroy();
        this.bubbles.delete(key);
      } else {
        this.position(bubble);
      }
    }
  }

  private position(bubble: Bubble): void {
    const x = bubble.follow ? bubble.follow.x : bubble.x;
    const y = bubble.follow ? bubble.follow.y - 118 - (bubble.follow.carrying ? 46 : 0) : bubble.y;
    const h = (bubble.box.list[1] as Phaser.GameObjects.Text).height;
    bubble.box.setPosition(x, y - h / 2);
  }

  destroy(): void {
    for (const bubble of this.bubbles.values()) bubble.box.destroy();
    this.bubbles.clear();
    this.sparkles.destroy();
    this.hearts.destroy();
  }
}
