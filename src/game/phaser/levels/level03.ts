import Phaser from 'phaser';
import { APARTMENT_DECOR } from '../../domain/levels/apartment-decor.ts';
import { L3_BEDDING, L3_PIECES, L3_ROOM, levelContent, NURSERY_ORIGIN } from '../../domain/levels/content.ts';
import { footprint, NurseryLayout, SafeSleepCheck, type LayoutIssue, type PlaceError, type Rotation } from '../../domain/nursery.ts';
import { APARTMENT, TILE } from '../../domain/tile-map.ts';
import { pieceTextureKey } from '../art/pieces.ts';
import { arabic, COLORS, PLAYER_COLOR } from '../services.ts';
import type { Carryable } from '../systems/carry.ts';
import { JointConfirm, type HeavyThing, type PutDownResult } from '../systems/cooperation.ts';
import type { Player } from '../systems/player.ts';
import type { LevelContext, LevelController, LevelSetup } from './level-controller.ts';

/**
 * Level 3 - Preparing the Nursery. The furniture has been delivered to the living room. The cot
 * and the wardrobe take two people; the rest one. Pieces snap to the nursery's grid and can be
 * rotated; the door's swing must stay clear. Once the cot is in, it turns out to be full of soft
 * things - pillow, padded bumper, plush toy, heavy quilt - which have to come out, while the fitted
 * sheet stays. The couple inspects the room together to finish.
 */

const ROOM_X = NURSERY_ORIGIN.col * TILE;
const ROOM_Y = NURSERY_ORIGIN.row * TILE;
const DOOR = { x: 20 * TILE, y: 8 * TILE };

export class Level03Controller implements LevelController {
  readonly content = levelContent('level03');
  readonly setup: LevelSetup = {
    map: APARTMENT,
    mapKey: 'apartment',
    decor: [...APARTMENT_DECOR],
    spawns: { wife: { x: 860, y: 640 }, husband: { x: 1060, y: 640 } },
  };

  private ctx!: LevelContext;
  private readonly layout = new NurseryLayout(L3_ROOM, L3_PIECES);
  private readonly sleep = new SafeSleepCheck(L3_BEDDING);
  private readonly rotation = new Map<string, Rotation>();
  private readonly bedding = new Map<string, Carryable>();
  private ghost!: Phaser.GameObjects.Graphics;
  private gridLines!: Phaser.GameObjects.Graphics;
  private inspect!: JointConfirm;
  private beddingSpawned = false;
  private failedInspections = 0;
  private refusals = 0;
  private heavyMoves = 0;
  private widget?: Phaser.GameObjects.Text[];

  readonly jointHooks = {
    onLift: (thing: HeavyThing) => {
      this.layout.lift(thing.id);
      if (thing.minHolders === 2) this.heavyMoves++;
      if (thing.id === 'crib') this.hideBedding();
      this.ctx.feedback.play('pickup');
      this.refresh();
    },
    onAskHelp: (thing: HeavyThing, asker: Player) => {
      this.ctx.feedback.say(asker, `${thing.spec.name} تقيل! تعالى${asker.id === 'wife' ? '' : 'ي'} شيل الناحية التانية 💪`, 2600, PLAYER_COLOR[asker.id]);
    },
    onRotate: (thing: HeavyThing) => this.rotate(thing),
    onCarryMove: (thing: HeavyThing) => this.drawGhost(thing),
    onPutDown: (thing: HeavyThing): PutDownResult => this.putDown(thing),
  };

  readonly carryHooks = {
    onPickUp: (actor: Player, item: Carryable) => {
      const bedding = L3_BEDDING.find((b) => b.id === item.id);
      if (!bedding || !this.sleep.isInCrib(item.id)) return;
      this.sleep.takeOut(item.id);
      this.ctx.feedback.say(actor, `${bedding.unsafe ? '✅' : '⚠️'} ${bedding.why}`, 3600, bedding.unsafe ? COLORS.good : COLORS.warn);
      if (bedding.unsafe) this.ctx.feedback.play('success');
      this.refresh();
    },
  };

  start(ctx: LevelContext): void {
    this.ctx = ctx;
    const { scene, joint, interaction, hud } = ctx;

    // Floor hints: the door's swing and the strip under the window.
    const hints = scene.add.graphics().setDepth(-4500);
    hints.fillStyle(0x7fb3d5, 0.18);
    for (const c of L3_ROOM.windowZone) hints.fillRect(ROOM_X + c.col * TILE + 2, ROOM_Y + c.row * TILE + 2, TILE - 4, TILE - 4);
    hints.lineStyle(3, 0x8a5a3c, 0.45);
    hints.beginPath();
    hints.arc(DOOR.x - TILE, DOOR.y + TILE, TILE * 2 - 6, -Math.PI / 2, 0);
    hints.strokePath();
    hints.fillStyle(0xe8735a, 0.08);
    for (const c of L3_ROOM.doorZone) hints.fillRect(ROOM_X + c.col * TILE + 2, ROOM_Y + c.row * TILE + 2, TILE - 4, TILE - 4);
    scene.add.image(ROOM_X + 10.5 * TILE, ROOM_Y + 5 * TILE, 'prop-rugNursery').setDepth(-4800).setAlpha(0.9);
    this.gridLines = scene.add.graphics().setDepth(-4400).setVisible(false);
    this.gridLines.lineStyle(1, 0x3b2416, 0.18);
    for (let c = 0; c <= L3_ROOM.cols; c++) this.gridLines.lineBetween(ROOM_X + c * TILE, ROOM_Y, ROOM_X + c * TILE, ROOM_Y + L3_ROOM.rows * TILE);
    for (let r = 0; r <= L3_ROOM.rows; r++) this.gridLines.lineBetween(ROOM_X, ROOM_Y + r * TILE, ROOM_X + L3_ROOM.cols * TILE, ROOM_Y + r * TILE);
    this.ghost = scene.add.graphics().setDepth(-4300);

    // The delivered furniture.
    for (const piece of L3_PIECES) {
      this.rotation.set(piece.id, 0);
      joint.add({
        id: piece.id,
        texture: pieceTextureKey(piece.art, piece.w, piece.h),
        x: piece.x,
        y: piece.y,
        footW: piece.w * TILE,
        footH: piece.h * TILE,
        name: piece.name,
        minHolders: piece.heavy ? 2 : 1,
      });
    }

    // The cot takes bedding back, as a place to put things down.
    interaction.add({
      id: 'crib-bed',
      get x() {
        const crib = joint.get('crib')!;
        return crib.x;
      },
      get y() {
        const crib = joint.get('crib')!;
        return crib.y - crib.footH / 2;
      },
      radius: 110,
      indicatorHeight: 70,
      priority: 2,
      prompt: (actor) => {
        const held = ctx.carry.heldBy(actor.id);
        return held && this.layout.isPlaced('crib') && L3_BEDDING.some((b) => b.id === held.id) ? 'رجّعها السرير' : null;
      },
      interact: (actor) => this.putBackInCrib(actor),
    });

    // Inspecting the room is done together, at the door.
    this.inspect = new JointConfirm(scene, interaction, {
      id: 'inspect',
      x: DOOR.x,
      y: DOOR.y - TILE / 2,
      radius: 80,
      verb: 'نفحص الأوضة سوا؟',
      indicatorHeight: 80,
      canConfirm: () => this.beddingSpawned && L3_PIECES.every((p) => this.layout.isPlaced(p.id)),
      onWaiting: (actor) => ctx.feedback.say(actor, `مستني${actor.id === 'wife' ? 'ة' : ''} ${this.partnerOf(actor).name} عند الباب 👀`, 1800),
      onConfirm: () => this.runInspection(),
    });

    this.buildWidget();
    hud.toast('الحاجات التقيلة محتاجة اتنين · زرار 🔄 يلف العفش', 'info', 4200);
    this.refresh();
  }

  update(): void {
    this.inspect.update();
    const active = this.ctx.players[this.ctx.hub.active];
    const carriedByActive = this.ctx.joint.carriedBy(active.id);
    this.ctx.hud.setRotateVisible(!!carriedByActive);
    const anyCarried = this.ctx.joint.all().some((t) => t.state === 'carried');
    this.gridLines.setVisible(anyCarried);
    if (!anyCarried) this.ghost.clear();
  }

  // -------------------------------------------------------------------------------------------

  private partnerOf(actor: Player): Player {
    return this.ctx.players[actor.id === 'wife' ? 'husband' : 'wife'];
  }

  /** The cell a piece would land on: its footprint's top-left corner, snapped. */
  private cellFor(thing: HeavyThing): { col: number; row: number; inside: boolean } {
    const left = thing.x - thing.footW / 2;
    const top = thing.y - thing.footH;
    const col = Math.round((left - ROOM_X) / TILE);
    const row = Math.round((top - ROOM_Y) / TILE);
    const cx = thing.x;
    const cy = thing.y - thing.footH / 2;
    const inside = cx > ROOM_X && cx < ROOM_X + L3_ROOM.cols * TILE && cy > ROOM_Y && cy < ROOM_Y + L3_ROOM.rows * TILE + TILE;
    return { col, row, inside };
  }

  private drawGhost(thing: HeavyThing): void {
    const { col, row, inside } = this.cellFor(thing);
    this.ghost.clear();
    if (!inside) return;
    const error = this.layout.check(thing.id, { col, row, rotation: this.rotation.get(thing.id)! });
    const color = error ? 0xe05a5a : 0x4caf7a;
    this.ghost.fillStyle(color, 0.25).lineStyle(3, color, 0.9);
    const x = ROOM_X + col * TILE;
    const y = ROOM_Y + row * TILE;
    this.ghost.fillRect(x, y, thing.footW, thing.footH).strokeRect(x, y, thing.footW, thing.footH);
  }

  private rotate(thing: HeavyThing): void {
    const piece = L3_PIECES.find((p) => p.id === thing.id)!;
    if (piece.w === piece.h) return;
    const next: Rotation = this.rotation.get(thing.id) === 0 ? 90 : 0;
    this.rotation.set(thing.id, next);
    const { w, h } = footprint(piece, next);
    thing.setTexture(pieceTextureKey(piece.art, w, h), w * TILE, h * TILE);
    this.ctx.feedback.play('click');
    this.drawGhost(thing);
  }

  private putDown(thing: HeavyThing): PutDownResult {
    const { feedback, hud } = this.ctx;
    const { col, row, inside } = this.cellFor(thing);
    this.ghost.clear();
    if (!inside) {
      feedback.play('place');
      return 'ground';
    }
    const at = { col, row, rotation: this.rotation.get(thing.id)! };
    const error = this.layout.place(thing.id, at);
    if (error) {
      this.refusals++;
      feedback.play('error');
      hud.toast(placeErrorText(error), 'warn', 2600);
      return 'refuse';
    }
    // Snap to the grid.
    thing.moveTo(ROOM_X + col * TILE + thing.footW / 2, ROOM_Y + row * TILE + thing.footH);
    feedback.play('place');
    feedback.burst(thing.x, thing.y - thing.footH / 2, 10);
    if (thing.id === 'crib') this.onCribPlaced(thing);
    this.refresh();
    return 'placed';
  }

  // -------------------------------------------------------------------------------------------
  // Safe sleep

  private onCribPlaced(crib: HeavyThing): void {
    const { carry, objectives, feedback, players } = this.ctx;
    if (!this.beddingSpawned) {
      this.beddingSpawned = true;
      for (const b of L3_BEDDING) {
        // Loose things win focus over the cot they lie in; the fitted sheet, which stays, does not,
        // so the cot can still be picked up and moved with its sheet on.
        const item = carry.spawn({ id: b.id, texture: `item-${b.art}`, x: 0, y: 0, verb: b.unsafe ? `شيل: ${b.name}` : `${b.name}؟`, scale: 0.75, priority: b.unsafe ? 3 : -2 });
        this.bedding.set(b.id, item);
      }
      objectives.reveal('crib');
      feedback.say(players.wife, 'السرير اتملى حاجات طرية… كلها مناسبة؟ 🤔', 3000);
    }
    this.layoutBedding(crib);
  }

  /** Lays what is still in the cot out across its mattress. */
  private layoutBedding(crib: HeavyThing): void {
    const inCrib = this.sleep.contents();
    inCrib.forEach((b, i) => {
      const item = this.bedding.get(b.id)!;
      const n = inCrib.length;
      const x = crib.x - crib.footW / 2 + ((i + 0.5) * crib.footW) / n;
      const y = crib.y - crib.footH * (0.25 + 0.5 * ((i % 2) as number));
      item.setGround(x, y);
      item.sprite.setDepth(crib.y + 2 + i * 0.01);
      item.shadow.setVisible(false);
    });
  }

  private hideBedding(): void {
    for (const b of this.sleep.contents()) {
      const item = this.bedding.get(b.id);
      item?.setStored(0, 0, -1, false);
    }
  }

  private putBackInCrib(actor: Player): void {
    const { carry, feedback } = this.ctx;
    const item = carry.take(actor);
    if (!item) return;
    const bedding = L3_BEDDING.find((b) => b.id === item.id)!;
    this.sleep.putBack(item.id);
    feedback.say(actor, bedding.unsafe ? `⚠️ ${bedding.why}` : '✅ الملاية رجعت مكانها', 3000, bedding.unsafe ? COLORS.warn : COLORS.good);
    feedback.play(bedding.unsafe ? 'soft' : 'place');
    this.layoutBedding(this.ctx.joint.get('crib')!);
    this.refresh();
  }

  private runInspection(): void {
    const { feedback, hud, players, objectives, joint } = this.ctx;
    const issues = this.layout.evaluate();
    const { unsafeLeft, safeMissing } = this.sleep.findings();
    const messages = [
      ...issues.map((i) => layoutIssueText(i)),
      ...(unsafeLeft.length ? [`لسه في السرير: ${unsafeLeft.map((b) => b.name).join('، ')} — السرير لازم يبقى فاضي 🛏️`] : []),
      ...(safeMissing.length ? ['الملاية المشدودة لازم ترجع السرير'] : []),
    ];
    if (messages.length === 0) {
      objectives.complete('crib');
      objectives.complete('inspect');
      const insights = ['clearCrib', 'back', 'window', 'anchor', 'path', ...(this.heavyMoves > 0 ? ['teamwork'] : [])];
      this.ctx.complete({
        stars: 3 - Math.min(2, this.failedInspections),
        insights,
        metrics: { inspections: this.failedInspections + 1, refusals: this.refusals, heavyMoves: this.heavyMoves },
      });
      return;
    }
    this.failedInspections++;
    feedback.play('soft');
    hud.toast(messages[0], 'warn', 4600);
    if (messages[1]) feedback.say(players.husband, messages[1], 4200);
    if (messages[2]) feedback.say(players.wife, messages[2], 4200);
    for (const issue of issues) {
      const thing = joint.get(issue.pieceId);
      if (thing) this.ctx.scene.tweens.add({ targets: thing.image, x: thing.x + 4, duration: 60, yoyo: true, repeat: 5, onComplete: () => thing.moveTo(thing.x, thing.y) });
    }
  }

  // -------------------------------------------------------------------------------------------
  // HUD widget: a live safety checklist.

  private buildWidget(): void {
    const { hud } = this.ctx;
    const bg = hud.add.graphics();
    bg.fillStyle(0x3b2416, 0.2).fillRoundedRect(3, 5, 250, 156, 18);
    bg.fillStyle(0xfff8ec, 0.96).fillRoundedRect(0, 0, 250, 156, 18);
    bg.lineStyle(3, 0x3b2416, 0.8).strokeRoundedRect(0, 0, 250, 156, 18);
    const title = arabic(hud, 125, 16, 'قايمة الأمان 🛡️', 16, COLORS.ink);
    const lines = [0, 1, 2, 3, 4].map((i) => arabic(hud, 125, 42 + i * 25, '', 14, '#5B3A29'));
    hud.setWidget(hud.add.container(0, 0, [bg, title, ...lines]));
    this.widget = lines;
  }

  private refresh(): void {
    if (!this.widget) return;
    const issues = this.layout.evaluate();
    const has = (kind: LayoutIssue['kind']) => issues.some((i) => i.kind === kind);
    const placed = L3_PIECES.filter((p) => this.layout.isPlaced(p.id)).length;
    const mark = (ok: boolean) => (ok ? '✓' : '·');
    const lines = [
      `📦 العفش جوه الأوضة ${placed}/${L3_PIECES.length}`,
      `🪟 السرير بعيد عن الشباك ${mark(this.layout.isPlaced('crib') && !has('cribByWindow'))}`,
      `🔩 العالي لازق في الحيطة ${mark(placed > 0 && !has('notAnchored') && this.layout.isPlaced('wardrobe') && this.layout.isPlaced('dresser'))}`,
      `🚪 طريق من الباب ${mark(placed > 0 && !has('unreachable') && this.layout.isPlaced('crib'))}`,
      `🛏️ السرير فاضي وآمن ${mark(this.beddingSpawned && this.sleep.isSafe())}`,
    ];
    lines.forEach((text, i) => this.widget![i].setText(text).setColor(text.endsWith('✓') ? '#2E7D4F' : '#5B3A29'));
    if (placed === L3_PIECES.length) this.ctx.objectives.complete('furnish');
    else this.ctx.objectives.reopen('furnish');
    if (this.beddingSpawned && this.sleep.isSafe()) this.ctx.objectives.complete('crib');
    else if (this.beddingSpawned) this.ctx.objectives.reopen('crib');
    if (this.beddingSpawned) this.ctx.objectives.reveal('inspect');
  }
}

function placeErrorText(error: PlaceError): string {
  switch (error) {
    case 'blocksDoor':
      return 'كده الباب مش هيتفتح 🚪 — سيبوا مكانه فاضي';
    case 'overlap':
      return 'في حاجة تانية في المكان ده';
    case 'outOfRoom':
      return 'مش هتدخل هنا — جرّبوا تلفّوها 🔄 أو مكان تاني';
  }
}

function layoutIssueText(issue: LayoutIssue): string {
  const name = L3_PIECES.find((p) => p.id === issue.pieceId)?.name ?? '';
  switch (issue.kind) {
    case 'notPlaced':
      return `«${name}» لسه بره الأوضة`;
    case 'cribByWindow':
      return 'السرير جنب الشباك: بعّدوه عن حبال الستارة والتيارات 🪟';
    case 'notAnchored':
      return `«${name}» لازم يبقى لازق في الحيطة عشان يتثبّت ومايقعش 🔩`;
    case 'unreachable':
      return `مفيش طريق فاضي من الباب لـ«${name}» 🚪`;
  }
}
