import Phaser from 'phaser';
import type { CharacterId } from '../../bridge/protocol.ts';
import type { InteractionSystem } from './interaction.ts';
import type { Player } from './player.ts';

/**
 * CarrySystem (with the inventory it implies: one thing per pair of hands). Small things - a task
 * card, a pack of nappies, a pillow - are lifted overhead, carried, and either put down on the
 * floor or handed to a receiver (the planning board, the trolley, a cot). A receiver takes the
 * item with `take()` and decides where its sprite goes.
 */

export type CarryState = 'ground' | 'held' | 'stored';

export interface CarryableSpec {
  readonly id: string;
  readonly texture: string;
  readonly x: number;
  readonly y: number;
  /** What the pick-up prompt says ("شيل" by default). */
  readonly verb?: string;
  readonly scale?: number;
  /** A small tag under the item on the floor, such as a price. */
  readonly tag?: string;
  /** Wins focus over other things in reach (bedding in a cot over the cot itself). */
  readonly priority?: number;
  /** Free-form data the level keeps on the item. */
  readonly data?: Readonly<Record<string, unknown>>;
}

export class Carryable {
  state: CarryState = 'ground';
  holder: CharacterId | null = null;
  readonly shadow: Phaser.GameObjects.Image;
  tagText?: Phaser.GameObjects.Text;
  /** When false the item cannot be picked up (a level locks it). */
  pickable = true;
  private bobOffset = Math.random() * Math.PI * 2;

  constructor(
    readonly scene: Phaser.Scene,
    readonly spec: CarryableSpec,
    readonly sprite: Phaser.GameObjects.Image,
  ) {
    this.shadow = scene.add.image(spec.x, spec.y, 'shadow').setScale(0.7).setAlpha(0.7);
    this.setGround(spec.x, spec.y);
  }

  get id(): string {
    return this.spec.id;
  }

  setGround(x: number, y: number): void {
    this.state = 'ground';
    this.holder = null;
    this.sprite.setVisible(true).setPosition(x, y).setDepth(y);
    this.shadow.setVisible(true).setPosition(x, y + 2).setDepth(y - 1);
    this.tagText?.setVisible(true).setPosition(x, y + 14).setDepth(y + 0.5);
  }

  setStored(x: number, y: number, depth: number, visible = true): void {
    this.state = 'stored';
    this.holder = null;
    this.sprite.setVisible(visible).setPosition(x, y).setDepth(depth);
    this.shadow.setVisible(false);
    this.tagText?.setVisible(false);
  }

  /** A gentle idle bob for things on the floor, so they read as things to pick up. */
  bob(time: number): void {
    if (this.state !== 'ground') return;
    const base = this.shadow.y - 2;
    this.sprite.y = base - 4 - Math.abs(Math.sin(time / 380 + this.bobOffset)) * 4;
  }

  destroy(): void {
    this.sprite.destroy();
    this.shadow.destroy();
    this.tagText?.destroy();
  }
}

export interface CarryHooks {
  onPickUp?(actor: Player, item: Carryable): void;
  /** Return false to refuse putting the item down here (a message is the level's to give). */
  canDrop?(actor: Player, item: Carryable, at: { x: number; y: number }): boolean;
  onDrop?(actor: Player, item: Carryable): void;
}

export class CarrySystem {
  private readonly items = new Map<string, Carryable>();
  private readonly hands = new Map<CharacterId, Carryable>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly interaction: InteractionSystem,
    private readonly players: () => readonly Player[],
    private readonly hooks: CarryHooks = {},
  ) {}

  spawn(spec: CarryableSpec): Carryable {
    const sprite = this.scene.add.image(spec.x, spec.y, spec.texture).setOrigin(0.5, 1).setScale(spec.scale ?? 1);
    const item = new Carryable(this.scene, spec, sprite);
    if (spec.tag) {
      item.tagText = this.scene.add
        .text(spec.x, spec.y + 14, spec.tag, {
          fontFamily: 'sans-serif',
          fontSize: '13px',
          fontStyle: 'bold',
          color: '#3B2416',
          backgroundColor: '#FFF8EC',
          padding: { left: 4, right: 4, top: 1, bottom: 1 },
          resolution: 2,
        })
        .setOrigin(0.5, 0);
    }
    this.items.set(spec.id, item);
    this.interaction.add({
      id: `pick:${spec.id}`,
      get x() {
        return item.sprite.x;
      },
      get y() {
        return item.state === 'ground' ? item.shadow.y : item.sprite.y;
      },
      radius: 62,
      indicatorHeight: 64,
      priority: spec.priority,
      prompt: (actor) => (item.state === 'ground' && item.pickable && !actor.carrying ? (spec.verb ?? 'شيل') : null),
      interact: (actor) => this.pickUp(actor, item),
    });
    return item;
  }

  item(id: string): Carryable | undefined {
    return this.items.get(id);
  }

  all(): Carryable[] {
    return [...this.items.values()];
  }

  heldBy(id: CharacterId): Carryable | undefined {
    return this.hands.get(id);
  }

  pickUp(actor: Player, item: Carryable): void {
    if (this.hands.has(actor.id) || item.state === 'held') return;
    item.state = 'held';
    item.holder = actor.id;
    item.shadow.setVisible(false);
    item.tagText?.setVisible(false);
    this.hands.set(actor.id, item);
    actor.carrying = true;
    this.hooks.onPickUp?.(actor, item);
  }

  /** Hands an item straight to a character, as when one is taken back out of the trolley. */
  give(actor: Player, item: Carryable): void {
    item.state = 'ground';
    this.pickUp(actor, item);
  }

  /** Removes the held item from the hands without putting it anywhere: the caller places it. */
  take(actor: Player): Carryable | undefined {
    const item = this.hands.get(actor.id);
    if (!item) return undefined;
    this.hands.delete(actor.id);
    actor.carrying = false;
    item.holder = null;
    return item;
  }

  drop(actor: Player): boolean {
    const item = this.hands.get(actor.id);
    if (!item) return false;
    const at = actor.front(34);
    if (this.hooks.canDrop && !this.hooks.canDrop(actor, item, at)) return false;
    this.take(actor);
    item.setGround(at.x, at.y);
    this.hooks.onDrop?.(actor, item);
    return true;
  }

  update(time: number): void {
    for (const player of this.players()) {
      const item = this.hands.get(player.id);
      if (!item) continue;
      const step = player.body.velocity.length() > 5 ? Math.sin(time / 70) * 1.5 : 0;
      item.sprite.setPosition(player.x, player.y - 84 + step).setDepth(player.y + 1);
    }
    for (const item of this.items.values()) item.bob(time);
  }

  destroy(): void {
    for (const item of this.items.values()) item.destroy();
    this.items.clear();
    this.hands.clear();
  }
}
