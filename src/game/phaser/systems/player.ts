import Phaser from 'phaser';
import type { CharacterId } from '../../bridge/protocol.ts';
import { FOOT_Y, FRAME_H, FRAME_W } from '../art/characters.ts';
import type { Intent } from './input-hub.ts';

/**
 * PlayerController: one character's body, animation and facing. It moves from an intent, collides
 * through Arcade Physics, and picks its animation from what it is doing - walking, carrying,
 * reaching for something, or reacting with joy or tiredness.
 */

export type Facing = 'down' | 'up' | 'left' | 'right';

export const WALK_SPEED = 220;

export class Player {
  readonly sprite: Phaser.Physics.Arcade.Sprite;
  readonly shadow: Phaser.GameObjects.Image;
  readonly ring: Phaser.GameObjects.Image;
  facing: Facing = 'down';
  /** Something is held overhead (set by the carry system). */
  carrying = false;
  /** Movement is driven from outside, as when two carry one heavy thing. */
  locked = false;
  /** The interactable a character is holding on to; while set, it is the only one they can use. */
  holding: string | null = null;
  speedFactor = 1;
  private emoteUntil = 0;
  private emote: 'happy' | 'tired' | 'cheer' | null = null;
  private interactUntil = 0;
  private stepClock = 0;
  private moving = false;

  constructor(
    readonly scene: Phaser.Scene,
    readonly id: CharacterId,
    readonly name: string,
    private readonly animKey: string,
    x: number,
    y: number,
    private readonly onStep?: () => void,
  ) {
    this.ring = scene.add.image(x, y, `ring-${id}`).setAlpha(0.8).setScale(0.6);
    this.shadow = scene.add.image(x, y, 'shadow').setAlpha(0.9);
    this.sprite = scene.physics.add.sprite(x, y, `char-${animKey}`, 'idle-down-0');
    this.sprite.setOrigin(0.5, FOOT_Y / FRAME_H);
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.setSize(30, 16);
    body.setOffset((FRAME_W - 30) / 2, FOOT_Y - 14);
    body.setCollideWorldBounds(true);
    this.sprite.play(`${animKey}-idle-down`);
  }

  get x(): number {
    return this.sprite.x;
  }

  get y(): number {
    return this.sprite.y;
  }

  get body(): Phaser.Physics.Arcade.Body {
    return this.sprite.body as Phaser.Physics.Arcade.Body;
  }

  /** A point a little in front of the character, where a held thing would be put down. */
  front(distance = 40): { x: number; y: number } {
    const d = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] }[this.facing];
    return { x: this.x + d[0] * distance, y: this.y + d[1] * distance };
  }

  move(intent: Intent): void {
    if (this.locked) return;
    const speed = WALK_SPEED * this.speedFactor * (this.carrying ? 0.85 : 1);
    this.body.setVelocity(intent.x * speed, intent.y * speed);
    this.moving = Math.abs(intent.x) + Math.abs(intent.y) > 0.05;
    if (this.moving) this.face(intent.x, intent.y);
  }

  /** Sets the facing from a direction, preferring the dominant axis. */
  face(dx: number, dy: number): void {
    if (Math.abs(dx) > Math.abs(dy) * 1.1) this.facing = dx < 0 ? 'left' : 'right';
    else if (Math.abs(dy) > 0.01) this.facing = dy < 0 ? 'up' : 'down';
  }

  /** Used while locked: the joint-carry system moves the sprite and reports whether it moved. */
  setDriven(x: number, y: number, moving: boolean, dx: number, dy: number): void {
    this.sprite.setPosition(x, y);
    this.body.reset(x, y);
    this.moving = moving;
    if (moving) this.face(dx, dy);
  }

  stop(): void {
    this.body.setVelocity(0, 0);
    this.moving = false;
  }

  playInteract(): void {
    this.interactUntil = this.scene.time.now + 280;
  }

  react(kind: 'happy' | 'tired' | 'cheer', ms = 1400): void {
    this.emote = kind;
    this.emoteUntil = this.scene.time.now + ms;
  }

  setActive(active: boolean): void {
    this.ring.setAlpha(active ? 0.95 : 0.35);
  }

  update(delta: number): void {
    const now = this.scene.time.now;
    const dir = this.facing === 'left' || this.facing === 'right' ? 'side' : this.facing;
    this.sprite.setFlipX(this.facing === 'right');
    let anim: string;
    if (this.emote && now < this.emoteUntil && !this.moving && !this.carrying) {
      anim = this.emote;
    } else if (now < this.interactUntil && !this.carrying) {
      anim = `interact-${dir}`;
    } else if (this.carrying) {
      anim = this.moving ? `carry-walk-${dir}` : `carry-idle-${dir}`;
    } else {
      anim = this.moving ? `walk-${dir}` : `idle-${dir}`;
    }
    if (now >= this.emoteUntil) this.emote = null;
    const key = `${this.animKey}-${anim}`;
    if (this.sprite.anims.currentAnim?.key !== key) this.sprite.play(key, true);

    this.sprite.setDepth(this.y);
    this.shadow.setPosition(this.x, this.y - 2).setDepth(this.y - 0.6);
    this.ring.setPosition(this.x, this.y - 2).setDepth(this.y - 0.7);

    if (this.moving) {
      this.stepClock += delta;
      if (this.stepClock > 300) {
        this.stepClock = 0;
        this.onStep?.();
      }
    }
  }

  destroy(): void {
    this.sprite.destroy();
    this.shadow.destroy();
    this.ring.destroy();
  }
}
