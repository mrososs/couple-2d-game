import Phaser from 'phaser';
import type { CharacterId } from '../../bridge/protocol.ts';
import { APARTMENT_DECOR, LIVING_WALL, SITTING_CORNER } from '../../domain/levels/apartment-decor.ts';
import { L1_CARDS, L1_SCHEDULE, levelContent } from '../../domain/levels/content.ts';
import { DAYS, LOPSIDED_SHARE, PlanningBoard, SchedulePuzzle, type Lane, type PlanIssue, type ScheduleVerdict } from '../../domain/planning.ts';
import { APARTMENT } from '../../domain/tile-map.ts';
import { BOARD_LANE_W, CALENDAR_CELL_W } from '../art/stations.ts';
import { ensureTexture } from '../art/texture-factory.ts';
import { arabic, COLORS, hex, PLAYER_COLOR } from '../services.ts';
import type { Carryable } from '../systems/carry.ts';
import { JointConfirm } from '../systems/cooperation.ts';
import type { Player } from '../systems/player.ts';
import type { LevelContext, LevelController, LevelSetup } from './level-controller.ts';

/**
 * Level 1 - Our First Big Decision. Responsibility cards are scattered around the flat; the couple
 * carries them to the planning board and decides, card by card, whose lane each goes in. Half way
 * through, the clinic calls: they have to agree on a check-up day, and each of them can only read
 * their own schedule. The level ends when they review the plan together and it holds up.
 */

const BOARD_X = 1272;
const CAL_X = 624;
const STAND_Y = 572;
const LANE_ORDER: Lane[] = ['husband', 'shared', 'wife'];
const LANE_NAME: Record<Lane, string> = { wife: '', shared: 'مع بعض', husband: '' };
const CALL_AFTER = 4;

export class Level01Controller implements LevelController {
  readonly content = levelContent('level01');
  readonly setup: LevelSetup = {
    map: APARTMENT,
    mapKey: 'apartment',
    decor: [...APARTMENT_DECOR, ...SITTING_CORNER, { kind: 'boxes', x: 1150, y: 300 }],
    spawns: { wife: { x: 700, y: 700 }, husband: { x: 820, y: 700 } },
  };
  readonly jointHooks = { onPutDown: () => 'ground' as const };

  private ctx!: LevelContext;
  private readonly board = new PlanningBoard(L1_CARDS);
  private readonly schedule = new SchedulePuzzle(L1_SCHEDULE);
  private readonly slots = new Map<string, Carryable>();
  private review!: JointConfirm;
  private pins = new Map<CharacterId, Phaser.GameObjects.Image>();
  private calendarGlow?: Phaser.GameObjects.Image;
  private called = false;
  private failedReviews = 0;
  /** The plan as it was when the couple were asked about a lopsided split. */
  private agreedPlan: string | null = null;
  private widget?: { wifeBar: Phaser.GameObjects.Rectangle; husbandBar: Phaser.GameObjects.Rectangle; count: Phaser.GameObjects.Text; share: Phaser.GameObjects.Text; day: Phaser.GameObjects.Text };

  start(ctx: LevelContext): void {
    this.ctx = ctx;
    const { scene, players } = ctx;
    const names = { wife: players.wife.name, husband: players.husband.name };
    LANE_NAME.wife = names.wife;
    LANE_NAME.husband = names.husband;

    // Stations on the living-room wall. The board carries the names, so it is drawn afresh.
    const session = ctx.services.session;
    if (scene.textures.exists('l1-board')) scene.textures.remove('l1-board');
    ensureTexture(scene, 'l1-board', session);
    scene.add.image(BOARD_X, LIVING_WALL, 'l1-board').setOrigin(0.5, 1).setDepth(-3000);
    ensureTexture(scene, 'l1-calendar', session);
    scene.add.image(CAL_X, LIVING_WALL, 'l1-calendar').setOrigin(0.5, 1).setDepth(-3000);
    for (const id of ['wife', 'husband'] as const) {
      ensureTexture(scene, `pin-${id}`, session);
      this.pins.set(id, scene.add.image(0, 0, `pin-${id}`).setVisible(false).setDepth(-2900));
    }

    // The cards, where each responsibility naturally turns up.
    for (const card of L1_CARDS) {
      ctx.carry.spawn({ id: card.id, texture: `card-${card.id}`, x: card.x, y: card.y, verb: `خد: ${card.title}`, scale: 0.85 });
    }

    // The three lanes of the board.
    LANE_ORDER.forEach((lane, i) => {
      const x = BOARD_X - BOARD_LANE_W + i * BOARD_LANE_W;
      ctx.interaction.add({
        id: `lane:${lane}`,
        x,
        y: STAND_Y,
        radius: 76,
        indicatorHeight: 150,
        prompt: (actor) => {
          const held = ctx.carry.heldBy(actor.id);
          if (held && this.isCard(held)) return lane === 'shared' ? 'حطّوه مع بعض' : `حطّه عند ${LANE_NAME[lane]}`;
          if (!held && this.board.lastIn(lane)) return 'رجّع كارت';
          return null;
        },
        interact: (actor) => this.onLane(actor, lane),
      });
    });

    // The calendar's days.
    DAYS.forEach((day, i) => {
      ctx.interaction.add({
        id: `day:${i}`,
        x: this.dayX(i),
        y: STAND_Y,
        radius: 30,
        indicatorHeight: 120,
        prompt: () => (this.called && !ctx.objectives.isDone('schedule') ? `دبّوس: ${day}` : null),
        interact: (actor) => this.pinDay(actor, i),
      });
    });

    // Each partner's own schedule: readable by its owner only.
    const phone = ctx.decor.get('sideTable')![0];
    const laptop = ctx.decor.get('desk')![0];
    this.addPrivateInfo('wife', phone.x, phone.y + 6, 'موبايل', L1_SCHEDULE.wifeFree, '📱');
    this.addPrivateInfo('husband', laptop.x, laptop.y + 30, 'لابتوب', L1_SCHEDULE.husbandFree, '💻');

    // Reviewing the plan is a joint decision at the board.
    this.review = new JointConfirm(scene, ctx.interaction, {
      id: 'review',
      x: BOARD_X,
      y: STAND_Y + 96,
      radius: 96,
      verb: 'نراجع الخطة سوا؟',
      indicatorHeight: 60,
      canConfirm: () => this.board.placedCount === L1_CARDS.length && ctx.objectives.isDone('schedule'),
      onWaiting: (actor) => ctx.feedback.say(actor, `مستني${actor.id === 'wife' ? 'ة' : ''} ${this.partnerOf(actor).name} 👀`, 1800),
      onConfirm: () => this.reviewPlan(),
    });

    this.buildWidget();
    this.refreshWidget();
  }

  readonly carryHooks = {
    onPickUp: (actor: Player, item: Carryable) => {
      if (this.isCard(item)) this.ctx.feedback.say(actor, this.board.card(item.id).title, 1600, PLAYER_COLOR[actor.id]);
    },
  };

  update(): void {
    this.review.update();
    if (this.calendarGlow) this.calendarGlow.setAlpha(0.35 + Math.sin(this.ctx.scene.time.now / 300) * 0.15);
  }

  // -------------------------------------------------------------------------------------------

  private isCard(item: Carryable): boolean {
    return L1_CARDS.some((c) => c.id === item.id);
  }

  private partnerOf(actor: Player): Player {
    return this.ctx.players[actor.id === 'wife' ? 'husband' : 'wife'];
  }

  private dayX(i: number): number {
    return CAL_X + (CALENDAR_CELL_W * DAYS.length) / 2 - (i + 0.5) * CALENDAR_CELL_W;
  }

  private onLane(actor: Player, lane: Lane): void {
    const { carry, feedback, objectives } = this.ctx;
    const held = carry.heldBy(actor.id);
    if (held && this.isCard(held)) {
      carry.take(actor);
      const notes = this.board.place(held.id, lane);
      this.slots.set(held.id, held);
      this.layoutLane(lane);
      feedback.play('place');
      feedback.burst(held.sprite.x, held.sprite.y, 8);
      if (notes.length) feedback.say(actor, noteText(notes[0], this.board, this.ctx), 2600, COLORS.warn);
      if (this.board.placedCount === L1_CARDS.length) {
        objectives.complete('cards');
        objectives.reveal('review');
        this.ctx.hud.toast('كل الكروت على اللوحة! 📌', 'good');
      }
      if (!this.called && this.board.placedCount >= CALL_AFTER) this.phoneCall();
      this.refreshWidget();
      return;
    }
    const last = this.board.lastIn(lane);
    if (!held && last) {
      this.board.remove(last.id);
      const item = this.slots.get(last.id)!;
      this.slots.delete(last.id);
      carry.give(actor, item);
      this.layoutLane(lane);
      objectives.reopen('cards');
      this.refreshWidget();
    }
  }

  /** Lays the lane's cards out as small notes pinned in rows. */
  private layoutLane(lane: Lane): void {
    const cards = this.board.cardsIn(lane);
    const centre = BOARD_X - BOARD_LANE_W + LANE_ORDER.indexOf(lane) * BOARD_LANE_W;
    cards.forEach((card, i) => {
      const item = this.slots.get(card.id)!;
      const col = i % 4;
      const row = Math.floor(i / 4);
      item.setStored(centre + (col - 1.5) * 28, LIVING_WALL - 32 + row * 24, -2950 + i);
      item.sprite.setScale(0.42);
    });
  }

  private phoneCall(): void {
    const { feedback, hud, objectives, scene, players } = this.ctx;
    this.called = true;
    feedback.play('chime');
    scene.time.delayedCall(350, () => feedback.play('chime'));
    hud.toast('📞 العيادة: محتاجين نحدد ميعاد المتابعة الأسبوع ده!', 'info', 4200);
    objectives.reveal('schedule');
    feedback.say(players.wife, 'يوم يناسبنا احنا الاتنين… 🤔', 2600);
    scene.time.delayedCall(900, () => feedback.say(players.husband, 'كل واحد يشوف جدوله ونتكلم', 2600));
    this.calendarGlow = scene.add.image(CAL_X, LIVING_WALL - 44, 'glow').setScale(1.8, 0.7).setBlendMode('ADD').setDepth(-2990);
    this.refreshWidget();
  }

  private addPrivateInfo(owner: CharacterId, x: number, y: number, what: string, free: readonly number[], emoji: string): void {
    const { interaction, feedback, players } = this.ctx;
    interaction.add({
      id: `info:${owner}`,
      x,
      y,
      radius: 74,
      indicatorHeight: 90,
      prompt: (actor) => (actor.id === owner ? (owner === 'wife' ? 'شوفي جدولك' : 'شوف جدولك') : `${what} ${players[owner].name}`),
      interact: (actor) => {
        if (actor.id !== owner) {
          feedback.say(actor, `ده ${what} ${players[owner].name} 🙂 اسأل${actor.id === 'wife' ? 'يه' : 'ها'} عن جدول${owner === 'wife' ? 'ها' : 'ه'}`, 2400);
          return;
        }
        const days = free.map((d) => DAYS[d]).join('، ');
        // Only the owner sees it: on two phones, their partner has to ask.
        feedback.say(actor, `${emoji} أنا فاضي${owner === 'wife' ? 'ة' : ''}: ${days}`, 5200, PLAYER_COLOR[owner], owner);
        feedback.play('pop');
      },
    });
  }

  private pinDay(actor: Player, day: number): void {
    const { feedback, objectives, players, scene } = this.ctx;
    this.schedule.pin(actor.id, day);
    const pin = this.pins.get(actor.id)!;
    const offset = actor.id === 'wife' ? 8 : -8;
    pin.setVisible(true).setPosition(this.dayX(day) + offset, LIVING_WALL - 30);
    feedback.play('click');
    const verdict = this.schedule.check();
    if (!verdict) {
      feedback.say(actor, `أنا اخترت ${DAYS[day]}… وانت${actor.id === 'wife' ? '' : 'ي'}؟`, 2000);
      return;
    }
    if (verdict === 'agreed') {
      objectives.complete('schedule');
      feedback.play('success');
      feedback.celebrate(this.dayX(day), LIVING_WALL - 40);
      players.wife.react('happy');
      players.husband.react('happy');
      this.ctx.hud.toast(`اتفقنا: ${DAYS[day]} الساعة 5 عند الدكتورة 💛`, 'good', 3600);
      this.calendarGlow?.destroy();
      this.calendarGlow = undefined;
      this.refreshWidget();
      return;
    }
    feedback.play(verdict === 'notSameDay' ? 'soft' : 'error');
    this.ctx.hud.toast(verdictText(verdict, DAYS[day], players), 'warn', 3400);
    if (verdict !== 'notSameDay') {
      // A gentle reset of the pins, so the next try starts clean.
      scene.time.delayedCall(900, () => {
        for (const p of this.pins.values()) p.setVisible(false);
      });
    }
  }

  private reviewPlan(): void {
    const { feedback, hud, objectives, players } = this.ctx;
    const result = this.board.evaluate();
    if (result.ok && result.notes.length && this.agreedPlan !== this.board.key()) {
      // Most of the load on one of them: not wrong, but worth saying out loud. Confirming the
      // review together once more, with the plan unchanged, is the couple agreeing to it.
      this.agreedPlan = this.board.key();
      const note = result.notes[0];
      const who = players[note.heavier];
      feedback.play('soft');
      hud.toast(`${who.name} عليه${note.heavier === 'wife' ? 'ا' : ''} ${Math.round(note.share * 100)}٪ من الشغل. لو ده مناسب لظروفكم، أكّدوا المراجعة سوا تاني ✅ — أو غيّروا التوزيع`, 'info', 5600);
      feedback.say(who, 'ده مناسب لينا؟ 🤔', 2400);
      return;
    }
    if (result.ok) {
      objectives.complete('review');
      const agreedSplit = result.notes.length > 0;
      const insights = ['shared', 'care', agreedSplit ? 'agreedSplit' : 'balance', 'talk', ...(this.failedReviews > 0 ? ['revised'] : [])];
      const stars = 1 + (this.failedReviews === 0 ? 1 : 0) + (this.schedule.wrongAttempts <= 1 ? 1 : 0);
      this.ctx.complete({
        stars,
        insights,
        metrics: {
          wifeShare: Math.round(result.wifeShare * 100),
          reviews: this.failedReviews + 1,
          scheduleAttempts: this.schedule.wrongAttempts + 1,
          shared: this.board.cardsIn('shared').length,
        },
      });
      return;
    }
    this.failedReviews++;
    feedback.play('soft');
    feedback.shake();
    const issues = result.issues.filter((i) => i.kind !== 'unplaced');
    hud.toast(noteText(issues[0], this.board, this.ctx), 'warn', 4200);
    if (issues[1]) feedback.say(players.husband, noteText(issues[1], this.board, this.ctx), 3800);
    feedback.say(players.wife, 'نرجّع الكارت ونحطه في مكان تاني 🔁', 3000);
    for (const issue of issues) {
      if ('cardId' in issue) {
        const item = this.slots.get(issue.cardId);
        if (item) this.ctx.scene.tweens.add({ targets: item.sprite, angle: { from: -12, to: 12 }, duration: 90, yoyo: true, repeat: 5, onComplete: () => item.sprite.setAngle(0) });
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // HUD widget: who carries how much, and the check-up day.

  private buildWidget(): void {
    const { hud } = this.ctx;
    const bg = hud.add.graphics();
    bg.fillStyle(0x3b2416, 0.2).fillRoundedRect(3, 5, 270, 112, 18);
    bg.fillStyle(0xfff8ec, 0.96).fillRoundedRect(0, 0, 270, 112, 18);
    bg.lineStyle(3, 0x3b2416, 0.8).strokeRoundedRect(0, 0, 270, 112, 18);
    const title = arabic(hud, 135, 18, 'توزيع المسؤوليات ⚖️', 16, COLORS.ink);
    const track = hud.add.rectangle(20, 48, 230, 16, 0xe8dcc8).setOrigin(0, 0.5).setStrokeStyle(2, 0x3b2416);
    // The middle of the track, where neither carries most of it; the same width either side.
    const zone = hud.add.rectangle(20 + 230 * (1 - LOPSIDED_SHARE), 48, 230 * (2 * LOPSIDED_SHARE - 1), 16, hex(COLORS.good), 0.3).setOrigin(0, 0.5);
    // Full-width bars scaled to their share: a Shape's origin does not follow a changed width.
    const wifeBar = hud.add.rectangle(250, 48, 230, 12, hex(COLORS.wife)).setOrigin(1, 0.5).setScale(0, 1);
    const husbandBar = hud.add.rectangle(20, 48, 230, 12, hex(COLORS.husband)).setOrigin(0, 0.5).setScale(0, 1);
    const share = arabic(hud, 135, 70, '', 14, '#5B3A29');
    const count = arabic(hud, 70, 94, '', 15, COLORS.ink);
    const day = arabic(hud, 200, 94, '', 15, COLORS.ink);
    hud.setWidget(hud.add.container(0, 0, [bg, title, track, zone, wifeBar, husbandBar, share, count, day]));
    this.widget = { wifeBar, husbandBar, count, share, day };
  }

  private refreshWidget(): void {
    if (!this.widget) return;
    const { wife, husband } = this.board.loads();
    const total = wife + husband || 1;
    this.widget.wifeBar.setScale(wife / total, 1);
    this.widget.husbandBar.setScale(husband / total, 1);
    this.widget.share.setText(wife + husband > 0 ? `${this.ctx.players.wife.name} ${Math.round((wife / total) * 100)}% · ${this.ctx.players.husband.name} ${Math.round((husband / total) * 100)}%` : 'لسه مفيش كروت');
    this.widget.count.setText(`📌 ${this.board.placedCount}/${L1_CARDS.length}`);
    const agreed = this.schedule.pinOf('wife');
    this.widget.day.setText(this.ctx.objectives.isDone('schedule') && agreed !== null ? `📅 ${DAYS[agreed]} ✓` : this.called ? '📅 ؟' : '');
  }
}

function noteText(issue: PlanIssue | undefined, board: PlanningBoard, ctx: LevelContext): string {
  if (!issue) return 'راجعوا الخطة تاني';
  const { wife } = ctx.players;
  switch (issue.kind) {
    case 'decisionAlone':
      return `«${board.card(issue.cardId).title}» قرار مشترك: مكانه «مع بعض» 💬`;
    case 'heavyOnPregnant':
      return `«${board.card(issue.cardId).title}» تقيل على ${wife.name} لوحدها وقت الحمل 💪`;
    case 'unplaced':
      return `فاضل ${issue.count} كروت`;
  }
}

function verdictText(verdict: ScheduleVerdict, day: string, players: LevelContext['players']): string {
  switch (verdict) {
    case 'notSameDay':
      return 'كل واحد اختار يوم مختلف — اتفقوا على يوم واحد 💬';
    case 'doctorUnavailable':
      return `الدكتورة مش موجودة يوم ${day} — شوفوا القلوب على النتيجة`;
    case 'wifeBusy':
      return `${players.wife.name} عندها شغل يوم ${day}`;
    case 'husbandBusy':
      return `${players.husband.name} عنده شغل يوم ${day}`;
    case 'bothBusy':
      return `الاتنين مشغولين يوم ${day}`;
    default:
      return '';
  }
}
