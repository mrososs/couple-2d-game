import Phaser from 'phaser';
import type { CharacterId } from '../../bridge/protocol.ts';
import { Basket, changeChoices, formatEgp, NEEDS, unitCost, type Need, type Product } from '../../domain/budget.ts';
import { APARTMENT_DECOR, LIVING_WALL, SITTING_CORNER, STREET_AND_SHOP_DECOR } from '../../domain/levels/apartment-decor.ts';
import { L2_PRODUCTS, L2_RULES, levelContent } from '../../domain/levels/content.ts';
import { APARTMENT_AND_SHOP, TILE } from '../../domain/tile-map.ts';
import { ensureTexture } from '../art/texture-factory.ts';
import { arabic, COLORS, hex, PLAYER_COLOR } from '../services.ts';
import type { Carryable } from '../systems/carry.ts';
import { JointConfirm, PressurePlate, type HeavyThing, type PutDownResult } from '../systems/cooperation.ts';
import type { Player } from '../systems/player.ts';
import type { LevelContext, LevelController, LevelSetup } from './level-controller.ts';

/**
 * Level 2 - Baby Budget Challenge. From the flat's front door, across the street, into the baby
 * shop: the couple pushes a trolley between shelves of illustratively priced products, covers five
 * needs, buys enough nappies at a sensible price per piece, keeps an emergency reserve, and agrees
 * on the big purchases together. The best-value nappies are in the storeroom, whose shutter stays
 * up only while one of them stands on the switch. At the till they work out their change.
 */

const NEED_ICON: Record<Need, string> = { diapers: '🍼', clothes: '👕', sleep: '🛏️', hygiene: '🛁', health: '🩺' };
const NEED_NAME: Record<Need, string> = { diapers: 'حفاضات', clothes: 'هدوم', sleep: 'مكان نوم', hygiene: 'استحمام', health: 'ترمومتر وإسعافات' };
const SHUTTER = { x: 59.5 * TILE, y: 4 * TILE + TILE / 2, w: 3 * TILE, h: TILE };
const PLATE = { x: 2664, y: 300 };
const CASHIER = { x: 2990, y: 920 };

export class Level02Controller implements LevelController {
  readonly content = levelContent('level02');
  readonly setup: LevelSetup = {
    map: APARTMENT_AND_SHOP,
    mapKey: 'apartment-shop',
    decor: [...APARTMENT_DECOR, ...SITTING_CORNER, ...STREET_AND_SHOP_DECOR],
    spawns: { wife: { x: 1690, y: 820 }, husband: { x: 1790, y: 820 } },
  };

  private ctx!: LevelContext;
  private readonly basket = new Basket(L2_PRODUCTS, L2_RULES);
  private readonly inTrolley: Carryable[] = [];
  private trolley!: Phaser.Physics.Arcade.Image;
  private shutterImage!: Phaser.GameObjects.Image;
  private shutterZone!: Phaser.GameObjects.Zone;
  private shutterOpen = false;
  private plate!: PressurePlate;
  private checkout!: JointConfirm;
  private pending: { item: Carryable; by: CharacterId } | null = null;
  private pendingMark?: Phaser.GameObjects.Text;
  private crib?: HeavyThing;
  private cribTag?: Phaser.GameObjects.Text;
  private coins: { box: Phaser.GameObjects.Container; value: number; zoneId: string }[] = [];
  private paying = false;
  private correctChange = 0;
  private mathMisses = 0;
  private jointBuys = 0;
  private widget?: {
    fill: Phaser.GameObjects.Rectangle;
    spent: Phaser.GameObjects.Text;
    diapers: Phaser.GameObjects.Text;
    needs: Phaser.GameObjects.Text;
  };

  readonly jointHooks = {
    onPutDown: (thing: HeavyThing): PutDownResult => {
      if (thing.state === 'placed') return 'ground';
      const near = Phaser.Math.Distance.Between(thing.x, thing.y, this.trolley.x, this.trolley.y) < 150;
      if (!near) {
        this.cribTag?.setPosition(thing.x, thing.y + 6).setDepth(thing.y + 1).setVisible(true);
        return 'ground';
      }
      // Carried there together: both of them have agreed to the big purchase.
      this.addToBasket(this.productOf(thing.id), null);
      thing.image.setVisible(false);
      thing.body.enable = false;
      thing.movable = false;
      this.jointBuys++;
      return 'placed';
    },
    onLift: () => {
      this.cribTag?.setVisible(false);
      this.ctx.feedback.play('pickup');
    },
    onAskHelp: (thing: HeavyThing, asker: Player) => {
      this.ctx.feedback.say(asker, `${thing.spec.name} تقيل! تعالى${asker.id === 'wife' ? '' : 'ي'} شيل معايا`, 2400, PLAYER_COLOR[asker.id]);
    },
  };

  readonly carryHooks = {
    onPickUp: (actor: Player, item: Carryable) => {
      const p = this.productOf(item.id);
      const per = unitCost(p);
      this.ctx.feedback.say(actor, `${p.name} · ${formatEgp(p.price)}${per ? ` (${per.toFixed(1)} ج للحتة)` : ''}`, 2600, PLAYER_COLOR[actor.id]);
    },
  };

  start(ctx: LevelContext): void {
    this.ctx = ctx;
    const { scene, interaction, carry, joint, objectives, hud } = ctx;

    // The list of needs by the front door.
    ensureTexture(scene, 'l2-list', ctx.services.session);
    const list = scene.add.image(1700, LIVING_WALL, 'l2-list').setOrigin(0.5, 1).setDepth(-3000);
    interaction.add({
      id: 'needs-list',
      x: 1700,
      y: 572,
      radius: 80,
      indicatorHeight: 120,
      target: list,
      prompt: () => 'اقروا القايمة',
      interact: (actor) => this.readList(actor),
    });

    // Products on the shelves, with their illustrative prices.
    for (const p of L2_PRODUCTS) {
      if (p.heavy) continue;
      carry.spawn({ id: p.id, texture: `item-${p.art}`, x: p.x, y: p.y, verb: `خد: ${p.name}`, tag: formatEgp(p.price), scale: p.id === 'bassinet' ? 0.8 : 1 });
    }
    const crib = L2_PRODUCTS.find((p) => p.heavy)!;
    this.crib = joint.add({ id: crib.id, texture: `item-${crib.art}`, x: crib.x, y: crib.y, footW: 100, footH: 46, name: crib.name });
    this.cribTag = scene.add
      .text(crib.x, crib.y + 6, formatEgp(crib.price), { fontFamily: 'sans-serif', fontSize: '13px', fontStyle: 'bold', color: '#3B2416', backgroundColor: '#FFF8EC', padding: { left: 4, right: 4, top: 1, bottom: 1 } })
      .setOrigin(0.5, 0)
      .setDepth(crib.y + 1);

    // The trolley: pushed by walking into it.
    this.trolley = scene.physics.add.image(2330, 900, 'prop-trolley').setOrigin(0.5, 1);
    const tb = this.trolley.body as Phaser.Physics.Arcade.Body;
    tb.setSize(66, 24).setOffset(9, this.trolley.height - 28);
    tb.setDrag(900, 900).setMaxVelocity(260, 260).setCollideWorldBounds(true);
    scene.physics.add.collider(this.trolley, ctx.solids);
    for (const p of Object.values(ctx.players)) scene.physics.add.collider(p.sprite, this.trolley);
    if (this.crib) scene.physics.add.collider(this.crib.image, this.trolley);
    const trolley = this.trolley;
    interaction.add({
      id: 'trolley',
      get x() {
        return trolley.x;
      },
      get y() {
        return trolley.y - 6;
      },
      radius: 84,
      indicatorHeight: 96,
      priority: 1,
      target: trolley,
      prompt: (actor) => this.trolleyPrompt(actor),
      interact: (actor) => this.onTrolley(actor),
    });
    this.pendingMark = arabic(scene, 0, 0, '🤝؟', 22, COLORS.ink).setVisible(false).setDepth(100000);

    // The storeroom shutter and the floor switch that holds it open.
    this.shutterImage = scene.add.image(SHUTTER.x, SHUTTER.y + TILE / 2, 'prop-shutter').setOrigin(0.5, 1).setDepth(SHUTTER.y + TILE / 2 - 1);
    this.shutterZone = ctx.addSolid(SHUTTER.x, SHUTTER.y, SHUTTER.w, SHUTTER.h);
    this.plate = new PressurePlate(scene, PLATE.x, PLATE.y, 34, 24, (pressed, by) => this.onPlate(pressed, by));

    // Paying is a joint decision at the till.
    this.checkout = new JointConfirm(scene, interaction, {
      id: 'checkout',
      x: CASHIER.x,
      y: CASHIER.y + 30,
      radius: 120,
      verb: 'ندفع؟',
      indicatorHeight: 150,
      canConfirm: () => !this.paying && this.basket.contents.length > 0,
      onWaiting: (actor) => ctx.feedback.say(actor, `تعالى${actor.id === 'wife' ? '' : 'ي'} ندفع سوا 💳`, 1800),
      onConfirm: () => this.pay(),
    });

    hud.toast('ℹ️ الأسعار في اللعبة توضيحية للتعلّم بس', 'info', 3600);
    this.buildWidget();
    this.refresh();
    void objectives;
  }

  update(): void {
    this.plate.update(Object.values(this.ctx.players));
    this.checkout.update();
    this.trolley.setDepth(this.trolley.y);
    this.inTrolley.forEach((item, i) => {
      item.sprite.setPosition(this.trolley.x - 22 + (i % 3) * 22, this.trolley.y - 34 - Math.floor(i / 3) * 12).setDepth(this.trolley.y + 1 + i * 0.01);
    });
    if (this.pending) {
      this.pending.item.sprite.setPosition(this.trolley.x, this.trolley.y - 70).setDepth(this.trolley.y + 2);
      this.pendingMark!.setVisible(true).setPosition(this.trolley.x, this.trolley.y - 118);
    } else {
      this.pendingMark?.setVisible(false);
    }
    // The shutter will not come down on someone standing under it.
    if (!this.plate.isPressed && this.shutterOpen && !this.someoneUnderShutter()) this.setShutter(false);
    if (this.paying) this.checkCoins();
  }

  // -------------------------------------------------------------------------------------------

  private productOf(id: string): Product {
    return this.basket.product(id);
  }

  private partner(id: CharacterId): Player {
    return this.ctx.players[id === 'wife' ? 'husband' : 'wife'];
  }

  private readList(actor: Player): void {
    const { objectives, hud, feedback, players } = this.ctx;
    const first = objectives.complete('list');
    hud.toast(`الأساسيات: ${NEEDS.map((n) => `${NEED_ICON[n]} ${NEED_NAME[n]}`).join(' · ')}`, 'info', 5200);
    if (first) {
      objectives.reveal('needs');
      objectives.reveal('diapers');
      objectives.reveal('reserve');
      feedback.say(players.wife, 'نسيب 350 جنيه احتياطي، متفقين؟', 2800);
      this.ctx.scene.time.delayedCall(1200, () => feedback.say(players.husband, 'ونقارن سعر الحتة في الحفاضات 🧮', 2800));
    }
    feedback.play('pop');
    void actor;
  }

  private trolleyPrompt(actor: Player): string | null {
    if (this.ctx.joint.carriedBy(actor.id)) return null;
    const held = this.ctx.carry.heldBy(actor.id);
    if (this.pending) {
      if (this.pending.by === actor.id) return 'رجّعها';
      return actor.id === 'wife' ? 'موافقة؟ 🤝' : 'موافق؟ 🤝';
    }
    if (held) return 'حطّها في العربية';
    if (this.inTrolley.length) return 'طلّع آخر حاجة';
    return null;
  }

  private onTrolley(actor: Player): void {
    const { carry, feedback } = this.ctx;
    if (this.pending) {
      const { item, by } = this.pending;
      this.pending = null;
      if (by === actor.id) {
        carry.give(actor, item);
        return;
      }
      this.jointBuys++;
      feedback.say(actor, 'موافقين 🤝', 1400, PLAYER_COLOR[actor.id]);
      this.addToBasket(this.productOf(item.id), item);
      return;
    }
    const held = carry.heldBy(actor.id);
    if (held) {
      carry.take(actor);
      const product = this.productOf(held.id);
      if (product.joint) {
        this.pending = { item: held, by: actor.id };
        held.setStored(this.trolley.x, this.trolley.y - 70, this.trolley.y + 2);
        feedback.say(actor, `${product.name} بـ${formatEgp(product.price)}… قرار كبير. ${this.partner(actor.id).name} موافق${actor.id === 'wife' ? '' : 'ة'}؟`, 3200, PLAYER_COLOR[actor.id]);
        feedback.play('soft');
        return;
      }
      this.addToBasket(product, held);
      return;
    }
    const last = this.basket.takeLast();
    if (!last) return;
    const item = this.inTrolley.pop();
    if (item && item.id === last.id) {
      item.sprite.setScale(1);
      carry.give(actor, item);
    } else if (last.heavy && this.crib) {
      // The cot comes back out beside the trolley, for two to carry again.
      this.crib.image.setVisible(true);
      this.crib.body.enable = true;
      this.crib.movable = true;
      this.crib.state = 'ground';
      this.crib.moveTo(this.trolley.x + 90, this.trolley.y);
      this.cribTag?.setPosition(this.crib.x, this.crib.y + 6).setDepth(this.crib.y + 1).setVisible(true);
      if (item) this.inTrolley.push(item);
    }
    feedback.float(this.trolley.x, this.trolley.y - 90, `+${formatEgp(last.price)}`, COLORS.good);
    this.refresh();
  }

  private addToBasket(product: Product, item: Carryable | null): void {
    const { feedback, hud } = this.ctx;
    const overBefore = this.basket.total() > this.basket.limit;
    this.basket.add(product.id);
    if (item) {
      item.setStored(this.trolley.x, this.trolley.y - 34, this.trolley.y + 1);
      item.sprite.setScale(0.45);
      this.inTrolley.push(item);
    }
    feedback.play('coin');
    feedback.float(this.trolley.x, this.trolley.y - 90, `−${formatEgp(product.price)}`, COLORS.bad);
    if (product.note) hud.toast(`🎀 ${product.name}: ${product.note}`, 'info', 3200);
    if (!overBefore && this.basket.total() > this.basket.limit) {
      hud.toast(`كده دخلنا في احتياطي الطوارئ (${formatEgp(this.basket.rules.budget - this.basket.limit)}) — نشيل حاجة؟`, 'warn', 4000);
      feedback.shake();
    }
    this.refresh();
  }

  private onPlate(pressed: boolean, by: CharacterId | null): void {
    const { feedback, players } = this.ctx;
    if (pressed) {
      this.setShutter(true);
      if (by) feedback.say(players[by], 'ماسك/ة الباب! ادخل/ي بسرعة 🚪', 2000, PLAYER_COLOR[by]);
    } else if (this.someoneUnderShutter()) {
      // Held open until the doorway is clear; see update().
    }
  }

  private someoneUnderShutter(): boolean {
    return Object.values(this.ctx.players).some((p) => Math.abs(p.x - SHUTTER.x) < SHUTTER.w / 2 + 10 && Math.abs(p.y - SHUTTER.y) < SHUTTER.h);
  }

  private setShutter(open: boolean): void {
    if (open === this.shutterOpen) return;
    this.shutterOpen = open;
    (this.shutterZone.body as Phaser.Physics.Arcade.StaticBody).enable = !open;
    this.ctx.scene.tweens.add({ targets: this.shutterImage, scaleY: open ? 0.15 : 1, duration: 260, ease: 'Cubic.easeOut' });
    this.ctx.feedback.play(open ? 'pop' : 'place');
    const inside = Object.values(this.ctx.players).find((p) => p.y < SHUTTER.y - TILE / 2);
    if (!open && inside) this.ctx.feedback.say(inside, `${this.partner(inside.id).name}، افتح${inside.id === 'wife' ? '' : 'ي'}لي الباب! 🙋`, 2400, PLAYER_COLOR[inside.id]);
  }

  // -------------------------------------------------------------------------------------------
  // Paying and the change puzzle

  private pay(): void {
    const { hud, feedback, players, objectives } = this.ctx;
    const e = this.basket.evaluate();
    if (!e.valid) {
      feedback.play('soft');
      const lines: string[] = [];
      if (e.missing.length) lines.push(`ناقص: ${e.missing.map((n) => NEED_NAME[n]).join('، ')}`);
      if (!e.enoughDiapers) lines.push(`الحفاضات ${e.diapers}/${L2_RULES.minDiapers}`);
      if (!e.withinLimit) lines.push(`عدّينا الحد بـ${formatEgp(e.spent - e.limit)} — نشيل كماليات؟`);
      hud.toast(lines.join(' · '), 'warn', 4800);
      feedback.say(players.wife, 'لسه السلة مش كاملة 🛒', 2200);
      return;
    }
    objectives.complete('reserve');
    objectives.reveal('checkout');
    this.paying = true;
    const { correct, choices } = changeChoices(L2_RULES.budget, e.spent, Math.round(e.spent / 10));
    this.correctChange = correct;
    feedback.say({ x: CASHIER.x, y: CASHIER.y - 150, key: 'cashier' }, `الحساب ${formatEgp(e.spent)}. دفعتوا ${formatEgp(L2_RULES.budget)}… الباقي كام؟ امشوا للرقم الصح`, 6500);
    feedback.play('chime');
    const spots = [
      { x: CASHIER.x - 260, y: CASHIER.y + 20 },
      { x: CASHIER.x - 170, y: CASHIER.y + 60 },
      { x: CASHIER.x - 80, y: CASHIER.y + 20 },
    ];
    choices.forEach((value, i) => {
      const { x, y } = spots[i];
      const disc = this.ctx.scene.add.circle(0, 0, 34, hex('#F2C14E')).setStrokeStyle(4, 0x3b2416);
      const label = arabic(this.ctx.scene, 0, 0, formatEgp(value), 17, COLORS.ink);
      const box = this.ctx.scene.add.container(x, y - 50, [disc, label]).setDepth(y + 200);
      this.ctx.scene.tweens.add({ targets: box, y: y - 58, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.coins.push({ box, value, zoneId: `coin:${i}` });
    });
  }

  private checkCoins(): void {
    for (const coin of [...this.coins]) {
      const hit = Object.values(this.ctx.players).find((p) => Phaser.Math.Distance.Between(p.x, p.y - 40, coin.box.x, coin.box.y) < 44);
      if (!hit) continue;
      if (coin.value === this.correctChange) {
        this.finish();
        return;
      }
      this.mathMisses++;
      this.coins.splice(this.coins.indexOf(coin), 1);
      this.ctx.feedback.burst(coin.box.x, coin.box.y, 8);
      coin.box.destroy();
      this.ctx.feedback.play('error');
      this.ctx.hud.toast(`قربتوا! احسبوها: ${formatEgp(L2_RULES.budget)} − ${formatEgp(this.basket.total())}`, 'warn', 3600);
    }
  }

  private finish(): void {
    const { objectives, feedback } = this.ctx;
    this.paying = false;
    for (const coin of this.coins) coin.box.destroy();
    this.coins = [];
    feedback.play('coin');
    objectives.complete('checkout');
    const e = this.basket.evaluate();
    const insights = ['valid', e.bestValueDiapers ? 'unit' : 'unitMissed', 'reserve', ...(e.extras ? ['extras'] : []), 'math', ...(this.jointBuys ? ['teamwork'] : [])];
    this.ctx.complete({
      stars: 1 + (e.bestValueDiapers ? 1 : 0) + (this.mathMisses === 0 ? 1 : 0),
      insights,
      metrics: { spent: e.spent, remaining: e.remaining, diapers: e.diapers, unitCost: Math.round((e.diaperUnitCost ?? 0) * 10) / 10, extras: e.extras, mathMisses: this.mathMisses },
    });
  }

  // -------------------------------------------------------------------------------------------
  // HUD widget: the budget bar with its reserve line, nappies, and the five needs.

  private buildWidget(): void {
    const { hud } = this.ctx;
    const w = 300;
    const bg = hud.add.graphics();
    bg.fillStyle(0x3b2416, 0.2).fillRoundedRect(3, 5, w, 124, 18);
    bg.fillStyle(0xfff8ec, 0.96).fillRoundedRect(0, 0, w, 124, 18);
    bg.lineStyle(3, 0x3b2416, 0.8).strokeRoundedRect(0, 0, w, 124, 18);
    const title = arabic(hud, w / 2, 16, `💰 الميزانية ${formatEgp(L2_RULES.budget)}`, 16, COLORS.ink);
    const track = hud.add.rectangle(w - 16, 44, w - 32, 18, 0xe8dcc8).setOrigin(1, 0.5).setStrokeStyle(2, 0x3b2416);
    const fill = hud.add.rectangle(w - 16, 44, w - 32, 14, hex(COLORS.good)).setOrigin(1, 0.5).setScale(0, 1);
    // The reserve: the last tenth of the bar, which spending should not reach.
    const reserveX = w - 16 - (w - 32) * (1 - L2_RULES.reserveRate);
    const reserve = hud.add.rectangle(reserveX, 44, (w - 32) * L2_RULES.reserveRate, 18, hex(COLORS.warn), 0.35).setOrigin(1, 0.5);
    const reserveLabel = arabic(hud, reserveX - 18, 62, 'احتياطي', 11, '#8A5A3C');
    const spent = arabic(hud, w / 2 + 30, 66, '', 14, '#5B3A29');
    const diapers = arabic(hud, w / 2, 88, '', 14, COLORS.ink);
    const needs = arabic(hud, w / 2, 108, '', 15, COLORS.ink);
    hud.setWidget(hud.add.container(0, 0, [bg, title, track, reserve, fill, reserveLabel, spent, diapers, needs]));
    this.widget = { fill, spent, diapers, needs };
  }

  private refresh(): void {
    const { objectives } = this.ctx;
    const e = this.basket.evaluate();
    if (this.widget) {
      this.widget.fill.setScale(Math.min(1, e.spent / L2_RULES.budget), 1);
      this.widget.fill.setFillStyle(hex(e.withinLimit ? COLORS.good : COLORS.bad));
      this.widget.spent.setText(`المصروف ${formatEgp(e.spent)} · الباقي ${formatEgp(e.remaining)}`);
      const per = e.diaperUnitCost ? ` · ${e.diaperUnitCost.toFixed(1)} ج/حتة` : '';
      this.widget.diapers.setText(`🍼 ${e.diapers}/${L2_RULES.minDiapers}${per}`);
      this.widget.needs.setText(NEEDS.map((n) => `${NEED_ICON[n]}${e.covered.includes(n) ? '✓' : '·'}`).join('  '));
    }
    if (objectives.isDone('list')) {
      if (e.missing.length === 0) objectives.complete('needs');
      else objectives.reopen('needs');
      if (e.enoughDiapers) objectives.complete('diapers');
      else objectives.reopen('diapers');
    }
  }
}
