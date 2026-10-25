import Phaser from 'phaser';
import type { CharacterId } from '../../bridge/protocol.ts';
import { arabic, COLORS, hex, PLAYER_COLOR } from '../services.ts';
import type { Intent } from './input-hub.ts';
import type { InteractionSystem } from './interaction.ts';
import type { Player } from './player.ts';

/**
 * CooperationSystem: the mechanics that need both partners.
 *
 * - JointCarry: a heavy thing does not move for one person. One takes a side and asks for help;
 *   once the other takes the far side, it moves with both of their inputs averaged (pull in
 *   opposite directions and it stays put). With touch controls only one character is driven at a
 *   time, so a partner with no input simply follows.
 * - JointConfirm: a decision that only counts when both press within a few seconds of each other.
 * - PressurePlate: a switch that stays on only while someone stands on it.
 */

export interface HeavySpec {
  readonly id: string;
  readonly texture: string;
  /** Bottom-centre of the footprint. */
  readonly x: number;
  readonly y: number;
  /** Footprint on the floor, in pixels. */
  readonly footW: number;
  readonly footH: number;
  readonly name: string;
  /** How many people it takes to move (2 by default; light furniture takes 1). */
  readonly minHolders?: 1 | 2;
}

export type PutDownResult = 'placed' | 'ground' | 'refuse';

export interface JointCarryHooks {
  onLift?(thing: HeavyThing): void;
  /** Decides what putting the thing down here means. */
  onPutDown(thing: HeavyThing): PutDownResult;
  onRotate?(thing: HeavyThing): void;
  onCarryMove?(thing: HeavyThing): void;
  onAskHelp?(thing: HeavyThing, asker: Player): void;
}

export class HeavyThing {
  state: 'ground' | 'carried' | 'placed' = 'ground';
  readonly holders: CharacterId[] = [];
  readonly image: Phaser.Physics.Arcade.Image;
  movable = true;
  footW: number;
  footH: number;
  data: Record<string, unknown> = {};

  constructor(
    readonly scene: Phaser.Scene,
    readonly spec: HeavySpec,
  ) {
    this.footW = spec.footW;
    this.footH = spec.footH;
    this.image = scene.physics.add.image(spec.x, spec.y, spec.texture).setOrigin(0.5, 1);
    this.image.setImmovable(true);
    this.fitBody();
    this.image.setDepth(spec.y);
  }

  get id(): string {
    return this.spec.id;
  }

  get minHolders(): number {
    return this.spec.minHolders ?? 2;
  }

  get body(): Phaser.Physics.Arcade.Body {
    return this.image.body as Phaser.Physics.Arcade.Body;
  }

  /** Bottom-centre of the footprint. */
  get x(): number {
    return this.image.x;
  }

  get y(): number {
    return this.image.y;
  }

  setTexture(key: string, footW: number, footH: number): void {
    this.image.setTexture(key);
    this.footW = footW;
    this.footH = footH;
    this.fitBody();
  }

  moveTo(x: number, y: number): void {
    this.image.setPosition(x, y);
    this.body.reset(x, y);
    this.image.setDepth(y);
  }

  private fitBody(): void {
    const w = this.footW - 8;
    const h = this.footH - 8;
    this.body.setSize(w, h);
    this.body.setOffset((this.image.width - w) / 2, this.image.height - h - 4);
  }

  destroy(): void {
    this.image.destroy();
  }
}

export class JointCarry {
  private readonly things = new Map<string, HeavyThing>();
  private readonly speed = 150;
  private readonly helpBubble: Phaser.GameObjects.Text;
  /** Which end each holder stands at: -1 left, 1 right. */
  private readonly sides = new Map<CharacterId, number>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly interaction: InteractionSystem,
    private readonly playerOf: (id: CharacterId) => Player,
    private readonly hooks: JointCarryHooks,
    /** Whether a character's hands are free (nothing small held). */
    private readonly handsFree: (id: CharacterId) => boolean,
  ) {
    this.helpBubble = arabic(scene, 0, 0, 'محتاجين اتنين! 💪', 18, COLORS.ink, {
      backgroundColor: '#FFF8EC',
      padding: { left: 10, right: 10, top: 5, bottom: 3 },
    })
      .setVisible(false)
      .setDepth(100002);
  }

  add(spec: HeavySpec): HeavyThing {
    const thing = new HeavyThing(this.scene, spec);
    this.things.set(spec.id, thing);
    this.interaction.add({
      id: `heavy:${spec.id}`,
      get x() {
        return thing.x;
      },
      get y() {
        return thing.y - thing.footH / 2;
      },
      radius: Math.max(spec.footW, spec.footH) / 2 + 52,
      indicatorHeight: spec.footH / 2 + 90,
      priority: 1,
      target: thing.image,
      prompt: (actor) => this.promptFor(thing, actor),
      interact: (actor) => this.toggle(thing, actor),
    });
    return thing;
  }

  all(): HeavyThing[] {
    return [...this.things.values()];
  }

  get(id: string): HeavyThing | undefined {
    return this.things.get(id);
  }

  carriedBy(id: CharacterId): HeavyThing | undefined {
    return this.all().find((t) => t.holders.includes(id));
  }

  private promptFor(thing: HeavyThing, actor: Player): string | null {
    if (!thing.movable) return null;
    if (thing.holders.includes(actor.id)) return thing.holders.length >= thing.minHolders ? 'نزّل هنا' : 'سيب';
    if (this.carriedBy(actor.id) || !this.handsFree(actor.id)) return null;
    if (thing.holders.length === 0) return thing.minHolders === 1 ? `شيل: ${thing.spec.name}` : `امسك: ${thing.spec.name}`;
    if (thing.holders.length >= 2) return null;
    return actor.id === 'wife' ? 'شيلي معاه' : 'شيل معاها';
  }

  private toggle(thing: HeavyThing, actor: Player): void {
    if (thing.holders.includes(actor.id)) {
      this.letGo(thing, actor);
      return;
    }
    if (thing.holders.length >= 2) return;
    thing.holders.push(actor.id);
    actor.stop();
    actor.holding = `heavy:${thing.id}`;
    actor.locked = true;
    actor.carrying = true;
    if (thing.holders.length === thing.minHolders) {
      thing.state = 'carried';
      thing.image.setImmovable(false);
      this.helpBubble.setVisible(false);
      this.hooks.onLift?.(thing);
    } else {
      this.hooks.onAskHelp?.(thing, actor);
    }
    this.snapHolders(thing, 0, 0, false);
  }

  private letGo(thing: HeavyThing, actor: Player): void {
    if (thing.holders.length >= thing.minHolders) {
      const result = this.hooks.onPutDown(thing);
      if (result === 'refuse') return;
      thing.body.setVelocity(0, 0);
      thing.image.setImmovable(true);
      thing.state = result === 'placed' ? 'placed' : 'ground';
      for (const id of thing.holders.splice(0)) this.release(this.playerOf(id));
      return;
    }
    thing.holders.splice(thing.holders.indexOf(actor.id), 1);
    this.release(actor);
    this.helpBubble.setVisible(false);
  }

  private release(player: Player): void {
    this.sides.delete(player.id);
    player.holding = null;
    player.locked = false;
    player.carrying = false;
    player.body.enable = true;
  }

  /** Lets go of everything, as when a level resets. */
  dropAll(): void {
    for (const thing of this.things.values()) {
      thing.body.setVelocity(0, 0);
      thing.image.setImmovable(true);
      for (const id of thing.holders.splice(0)) this.release(this.playerOf(id));
      if (thing.state === 'carried') thing.state = 'ground';
    }
    this.helpBubble.setVisible(false);
  }

  update(intents: ReadonlyMap<CharacterId, Intent>): void {
    for (const thing of this.things.values()) {
      if (thing.holders.length === 0) continue;
      if (thing.holders.length < thing.minHolders) {
        this.helpBubble.setVisible(true).setPosition(thing.x, thing.y - thing.image.height - 18);
        this.snapHolders(thing, 0, 0, false);
        continue;
      }
      const idle = { x: 0, y: 0, interact: false, rotate: false };
      const [a, b = idle] = thing.holders.map((id) => intents.get(id) ?? idle);
      const aMoving = Math.abs(a.x) + Math.abs(a.y) > 0.05;
      const bMoving = Math.abs(b.x) + Math.abs(b.y) > 0.05;
      let vx = 0;
      let vy = 0;
      if (aMoving && bMoving) {
        vx = (a.x + b.x) / 2;
        vy = (a.y + b.y) / 2;
      } else if (aMoving || bMoving) {
        const m = aMoving ? a : b;
        vx = m.x * 0.85;
        vy = m.y * 0.85;
      }
      thing.body.setVelocity(vx * this.speed, vy * this.speed);
      thing.image.setDepth(thing.y);
      if (a.rotate || b.rotate) this.hooks.onRotate?.(thing);
      const moving = Math.abs(vx) + Math.abs(vy) > 0.05;
      this.snapHolders(thing, vx, vy, moving);
      this.hooks.onCarryMove?.(thing);
    }
  }

  /** Stands the holders at either end of the thing, facing the way it moves. */
  private snapHolders(thing: HeavyThing, vx: number, vy: number, moving: boolean): void {
    const half = thing.footW / 2 + 16;
    const y = thing.y - 4;
    thing.holders.forEach((id, i) => {
      const player = this.playerOf(id);
      if (i === 0 && !this.sides.has(id)) this.sides.set(id, player.x < thing.x ? -1 : 1);
      const side = i === 0 ? this.sides.get(id)! : -this.sides.get(thing.holders[0])!;
      this.sides.set(id, side);
      player.body.enable = false;
      if (moving) player.setDriven(thing.x + side * half, y, true, vx, vy);
      else {
        player.setDriven(thing.x + side * half, y, false, 0, 0);
        player.facing = side < 0 ? 'right' : 'left';
      }
    });
  }

  destroy(): void {
    for (const thing of this.things.values()) thing.destroy();
    this.things.clear();
    this.helpBubble.destroy();
  }
}

/** A decision both partners confirm at the same spot within a few seconds of each other. */
export class JointConfirm {
  private readonly ready = new Map<CharacterId, number>();
  private readonly dots: Phaser.GameObjects.Arc[];
  private readonly windowMs = 6000;
  enabled = true;

  constructor(
    private readonly scene: Phaser.Scene,
    interaction: InteractionSystem,
    private readonly opts: {
      readonly id: string;
      readonly x: number;
      readonly y: number;
      readonly radius: number;
      readonly verb: string;
      readonly indicatorHeight?: number;
      readonly canConfirm?: () => boolean;
      readonly onWaiting?: (actor: Player) => void;
      readonly onConfirm: () => void;
    },
  ) {
    this.dots = (['wife', 'husband'] as const).map((id, i) =>
      scene.add
        .circle(opts.x + (i ? 14 : -14), opts.y - (opts.indicatorHeight ?? 70) + 26, 9, hex(PLAYER_COLOR[id]), 0.25)
        .setStrokeStyle(3, hex(PLAYER_COLOR[id]))
        .setDepth(100000)
        .setVisible(false),
    );
    interaction.add({
      id: `confirm:${opts.id}`,
      x: opts.x,
      y: opts.y,
      radius: opts.radius,
      indicatorHeight: opts.indicatorHeight,
      priority: 2,
      prompt: (actor) => (this.enabled && (opts.canConfirm?.() ?? true) ? (this.ready.has(actor.id) ? 'مستنيين…' : opts.verb) : null),
      interact: (actor) => this.press(actor),
    });
  }

  press(actor: Player): void {
    this.ready.set(actor.id, this.scene.time.now);
    if (this.ready.size === 2) {
      this.ready.clear();
      this.opts.onConfirm();
    } else {
      this.opts.onWaiting?.(actor);
    }
    this.refresh();
  }

  update(): void {
    const now = this.scene.time.now;
    for (const [id, at] of this.ready) if (now - at > this.windowMs) this.ready.delete(id);
    this.refresh();
  }

  private refresh(): void {
    const show = this.enabled && (this.opts.canConfirm?.() ?? true);
    (['wife', 'husband'] as const).forEach((id, i) => {
      this.dots[i].setVisible(show).setFillStyle(hex(PLAYER_COLOR[id]), this.ready.has(id) ? 1 : 0.2);
    });
  }

  destroy(): void {
    for (const dot of this.dots) dot.destroy();
  }
}

/** A floor switch that is on only while a character stands on it. */
export class PressurePlate {
  private pressed = false;
  readonly image: Phaser.GameObjects.Image;

  constructor(
    scene: Phaser.Scene,
    readonly x: number,
    readonly y: number,
    private readonly halfW: number,
    private readonly halfH: number,
    private readonly onChange: (pressed: boolean, by: CharacterId | null) => void,
  ) {
    this.image = scene.add.image(x, y, 'prop-plate').setDepth(y - 30);
  }

  get isPressed(): boolean {
    return this.pressed;
  }

  update(players: readonly Player[]): void {
    const on = players.find((p) => Math.abs(p.x - this.x) < this.halfW && Math.abs(p.y - this.y) < this.halfH);
    const pressed = !!on;
    if (pressed !== this.pressed) {
      this.pressed = pressed;
      this.image.setScale(1, pressed ? 0.85 : 1).setTint(pressed ? 0xc8ffd0 : 0xffffff);
      this.onChange(pressed, on?.id ?? null);
    }
  }
}
