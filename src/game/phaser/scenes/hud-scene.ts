import Phaser from 'phaser';
import type { CharacterId } from '../../bridge/protocol.ts';
import type { ObjectiveState } from '../../domain/objectives.ts';
import type { HudEvent } from '../../net/protocol.ts';
import { arabic, COLORS, hex, PLAYER_COLOR, servicesOf } from '../services.ts';
import type { InputHub } from '../systems/input-hub.ts';

/**
 * The HUD, in its own scene so it never zooms or scrolls with the world: the current objective
 * (top right, where Arabic reading starts), a level widget (top left), short toasts, and the touch
 * controls - a joystick that appears under the thumb on the left half and buttons on the right.
 * The controls keep their physical places whatever the app's text direction is.
 */

type ToastKind = 'info' | 'good' | 'warn';

export class HudScene extends Phaser.Scene {
  private hub?: InputHub;
  private objectivePanel!: Phaser.GameObjects.Container;
  private objectiveText!: Phaser.GameObjects.Text;
  private titleText!: Phaser.GameObjects.Text;
  private dots: Phaser.GameObjects.Arc[] = [];
  private panelBg!: Phaser.GameObjects.Graphics;
  private widget: Phaser.GameObjects.Container | null = null;
  private toastBox!: Phaser.GameObjects.Container;
  private toastText!: Phaser.GameObjects.Text;
  private toastBg!: Phaser.GameObjects.Graphics;
  private toastTimer?: Phaser.Time.TimerEvent;
  private joyBase!: Phaser.GameObjects.Image;
  private joyKnob!: Phaser.GameObjects.Image;
  private joyPointer: number | null = null;
  private joyOrigin = { x: 0, y: 0 };
  private interactBtn!: Phaser.GameObjects.Image;
  private interactLabel!: Phaser.GameObjects.Text;
  private rotateBtn!: Phaser.GameObjects.Image;
  private swapBtn!: Phaser.GameObjects.Image;
  private swapPortrait!: Phaser.GameObjects.Image;
  private activeName!: Phaser.GameObjects.Text;
  private partnerArrow!: Phaser.GameObjects.Triangle;
  private pauseShade!: Phaser.GameObjects.Rectangle;
  private pauseText!: Phaser.GameObjects.Text;
  private fpsText?: Phaser.GameObjects.Text;
  private intro: Phaser.GameObjects.Container | null = null;
  private ready = false;
  private readonly waiting: (() => void)[] = [];
  private portraits: Record<CharacterId, string> = { wife: '', husband: '' };
  private names: Record<CharacterId, string> = { wife: '', husband: '' };
  private rotateWanted = false;
  private twoPhones = false;
  private netChip!: Phaser.GameObjects.Text;
  /** The guest phone's copy of the host's level widget lives in here. */
  replicaLayer!: Phaser.GameObjects.Container;
  /** Set by the host in two-phone play: HUD moments the guest's phone shows as well. */
  sharedListener?: (event: HudEvent) => void;

  /** The level's widget, for the host to mirror. */
  get levelWidget(): Phaser.GameObjects.Container | null {
    return this.widget;
  }

  constructor() {
    super('hud');
  }

  whenReady(fn: () => void): void {
    if (this.ready) fn();
    else this.waiting.push(fn);
  }

  create(): void {
    const { session } = servicesOf(this);
    this.input.addPointer(3);

    this.panelBg = this.add.graphics();
    this.titleText = arabic(this, 0, 0, '', 16, '#8A5A3C');
    this.objectiveText = arabic(this, 0, 0, '', 21, COLORS.ink, { wordWrap: { width: 380, useAdvancedWrap: true } });
    this.objectivePanel = this.add.container(0, 0, [this.panelBg, this.titleText, this.objectiveText]);

    this.toastBg = this.add.graphics();
    this.toastText = arabic(this, 0, 0, '', 20, COLORS.ink, { wordWrap: { width: 520, useAdvancedWrap: true } });
    this.toastBox = this.add.container(0, 0, [this.toastBg, this.toastText]).setAlpha(0).setDepth(10);

    this.joyBase = this.add.image(0, 0, 'joy-base').setAlpha(0.75);
    this.joyKnob = this.add.image(0, 0, 'joy-knob');
    this.interactBtn = this.add.image(0, 0, 'btn-interact').setInteractive({ useHandCursor: true });
    this.interactLabel = arabic(this, 0, 0, '', 18, COLORS.paper, {
      backgroundColor: '#3B2416',
      padding: { left: 10, right: 10, top: 4, bottom: 2 },
    });
    this.rotateBtn = this.add.image(0, 0, 'btn-rotate').setInteractive({ useHandCursor: true }).setVisible(false);
    this.swapBtn = this.add.image(0, 0, 'btn-swap').setInteractive({ useHandCursor: true });
    this.swapPortrait = this.add.image(0, 0, '').setScale(0.62);
    this.activeName = arabic(this, 0, 0, '', 16, COLORS.paper, { padding: { left: 8, right: 8, top: 3, bottom: 1 } });
    this.partnerArrow = this.add.triangle(0, 0, 0, -16, 14, 12, -14, 12, 0xffffff).setStrokeStyle(3, 0x3b2416).setVisible(false);

    this.replicaLayer = this.add.container(0, 0);
    this.netChip = arabic(this, 0, 0, '', 15, COLORS.paper, { backgroundColor: '#3B2416', padding: { left: 10, right: 10, top: 4, bottom: 2 } })
      .setVisible(false)
      .setDepth(12);
    this.pauseShade = this.add.rectangle(0, 0, 10, 10, 0x2e2420, 0.45).setOrigin(0).setVisible(false).setDepth(20);
    this.pauseText = arabic(this, 0, 0, 'استراحة ☕', 40, COLORS.paper).setVisible(false).setDepth(21);
    if (session.devMode) this.fpsText = this.add.text(8, 8, '', { fontFamily: 'monospace', fontSize: '14px', color: '#ffffff', backgroundColor: '#00000088' }).setDepth(30);

    this.interactBtn.on('pointerdown', () => {
      servicesOf(this).sfx.unlock();
      this.hub?.pressInteract();
      this.tweens.add({ targets: this.interactBtn, scale: 0.9, duration: 70, yoyo: true });
    });
    this.rotateBtn.on('pointerdown', () => {
      this.hub?.pressRotate();
      this.tweens.add({ targets: this.rotateBtn, angle: 90, duration: 180, onComplete: () => this.rotateBtn.setAngle(0) });
    });
    this.swapBtn.on('pointerdown', () => {
      servicesOf(this).sfx.unlock();
      this.hub?.swap();
    });

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      servicesOf(this).sfx.unlock();
      if (this.intro) {
        this.dismissIntro();
        return;
      }
      if (over.length > 0 || this.joyPointer !== null) return;
      if (pointer.x > this.scale.width * 0.5) return;
      this.joyPointer = pointer.id;
      this.joyOrigin = { x: pointer.x, y: pointer.y };
      this.joyBase.setPosition(pointer.x, pointer.y).setAlpha(0.9);
      this.joyKnob.setPosition(pointer.x, pointer.y);
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (pointer.id !== this.joyPointer) return;
      const max = 70;
      let dx = pointer.x - this.joyOrigin.x;
      let dy = pointer.y - this.joyOrigin.y;
      const len = Math.hypot(dx, dy);
      if (len > max) {
        dx = (dx / len) * max;
        dy = (dy / len) * max;
      }
      this.joyKnob.setPosition(this.joyOrigin.x + dx, this.joyOrigin.y + dy);
      // A small dead zone, then full speed from just past it.
      const mag = Math.min(1, Math.max(0, (Math.hypot(dx, dy) - 8) / (max - 8)));
      const ang = Math.atan2(dy, dx);
      this.hub?.setStick(mag ? Math.cos(ang) * mag : 0, mag ? Math.sin(ang) * mag : 0);
    });
    const release = (pointer: Phaser.Input.Pointer) => {
      if (pointer.id !== this.joyPointer) return;
      this.joyPointer = null;
      this.hub?.setStick(0, 0);
      this.layout();
    };
    this.input.on('pointerup', release);
    this.input.on('pointerupoutside', release);
    this.input.keyboard?.on('keydown', () => servicesOf(this).sfx.unlock());

    this.scale.on('resize', this.layout, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.layout, this));
    this.layout();
    this.ready = true;
    for (const fn of this.waiting.splice(0)) fn();
  }

  /** Called by the level each time it starts. With two phones there is no swapping characters. */
  attach(hub: InputHub, portraits: Record<CharacterId, string>, names: Record<CharacterId, string>, twoPhones = false): void {
    this.hub = hub;
    this.portraits = portraits;
    this.names = names;
    this.twoPhones = twoPhones;
    this.sharedListener = undefined;
    this.replicaLayer.removeAll(true);
    this.setNetStatus(null);
    this.swapBtn.setVisible(!twoPhones);
    this.swapPortrait.setVisible(!twoPhones);
    this.clearWidget();
    this.setRotateVisible(false);
    this.setPrompt(null);
    this.setPaused(false);
    this.toastBox.setAlpha(0);
    hub.onSwap((active) => this.setActive(active));
    this.setActive(hub.active);
  }

  setActive(active: CharacterId): void {
    const partner: CharacterId = active === 'wife' ? 'husband' : 'wife';
    if (this.portraits[partner] && this.textures.exists(this.portraits[partner])) this.swapPortrait.setTexture(this.portraits[partner]);
    this.activeName.setText(`🎮 ${this.names[active]}`).setBackgroundColor(PLAYER_COLOR[active]);
    this.layout();
  }

  setLevelTitle(title: string): void {
    this.titleText.setText(title);
    this.layoutPanel();
    this.sharedListener?.({ k: 'title', text: title });
  }

  /** A small chip at the top while the other phone cannot be reached; null hides it. */
  setNetStatus(text: string | null): void {
    this.netChip?.setText(text ?? '').setVisible(!!text);
  }

  /** The shared HUD state, for a guest phone that joins (or rejoins) part way through. */
  sharedState(): HudEvent[] {
    return [
      { k: 'title', text: this.titleText.text },
      { k: 'objectives', list: this.lastObjectives.map((o) => ({ ...o })) },
    ];
  }

  private lastObjectives: readonly ObjectiveState[] = [];

  setObjectives(objectives: readonly ObjectiveState[]): void {
    this.lastObjectives = objectives;
    this.sharedListener?.({ k: 'objectives', list: objectives.map((o) => ({ ...o })) });
    const visible = objectives.filter((o) => o.visible);
    const current = visible.find((o) => !o.done);
    this.objectiveText.setText(current ? `◀ ${current.text}` : 'تمام! ✨');
    for (const dot of this.dots) dot.destroy();
    this.dots = objectives.map((o) =>
      this.add.circle(0, 0, 6, o.done ? hex(COLORS.good) : 0xe8dcc8).setStrokeStyle(2, 0x3b2416),
    );
    this.objectivePanel.add(this.dots);
    this.layoutPanel();
    this.tweens.add({ targets: this.objectivePanel, scale: { from: 1.06, to: 1 }, duration: 260, ease: 'Back.easeOut' });
  }

  /** Replaces the level widget in the top-left corner. */
  setWidget(widget: Phaser.GameObjects.Container): void {
    this.clearWidget();
    this.widget = widget;
    this.layout();
  }

  clearWidget(): void {
    this.widget?.destroy();
    this.widget = null;
  }

  toast(text: string, kind: ToastKind = 'info', ms = 2800): void {
    this.sharedListener?.({ k: 'toast', text, kind, ms });
    const color = kind === 'good' ? COLORS.good : kind === 'warn' ? COLORS.warn : COLORS.husband;
    this.toastText.setText(text);
    const w = Math.max(220, this.toastText.width + 48);
    const h = this.toastText.height + 18;
    this.toastBg.clear();
    this.toastBg.fillStyle(0x3b2416, 0.2).fillRoundedRect(-w / 2 + 3, -h / 2 + 5, w, h, 18);
    this.toastBg.fillStyle(0xfff8ec, 0.98).fillRoundedRect(-w / 2, -h / 2, w, h, 18);
    this.toastBg.fillStyle(hex(color), 1).fillRoundedRect(w / 2 - 14, -h / 2, 14, h, { tl: 0, bl: 0, tr: 18, br: 18 });
    this.toastBg.lineStyle(3, hex(color), 1).strokeRoundedRect(-w / 2, -h / 2, w, h, 18);
    this.toastTimer?.remove();
    this.tweens.killTweensOf(this.toastBox);
    this.toastBox.setAlpha(0).setScale(0.9);
    this.tweens.add({ targets: this.toastBox, alpha: 1, scale: 1, duration: 200, ease: 'Back.easeOut' });
    this.toastTimer = this.time.delayedCall(ms, () => this.tweens.add({ targets: this.toastBox, alpha: 0, duration: 300 }));
  }

  /** A short card at the start of a level; any tap or the first few seconds dismiss it. */
  showIntro(title: string, lines: readonly string[], number: number): void {
    this.sharedListener?.({ k: 'intro', title, lines: [...lines], number });
    this.dismissIntro();
    const w = Math.min(640, this.scale.width - 80);
    const titleText = arabic(this, 0, -54, title, 34, COLORS.ink);
    const badge = arabic(this, 0, -100, number > 0 ? `المرحلة ${number}` : 'تجربة', 18, COLORS.paper, {
      backgroundColor: COLORS.wife,
      padding: { left: 14, right: 14, top: 4, bottom: 2 },
    });
    const body = arabic(this, 0, 14, lines.join('\n'), 22, '#5B3A29', { wordWrap: { width: w - 60, useAdvancedWrap: true }, lineSpacing: 6 });
    const hint = arabic(this, 0, 96, 'المس الشاشة أو اضغط أي زرار للبدء', 15, '#8A5A3C');
    const h = 250;
    const bg = this.add.graphics();
    bg.fillStyle(0x3b2416, 0.25).fillRoundedRect(-w / 2 + 4, -h / 2 + 8, w, h, 28);
    bg.fillStyle(0xfff8ec, 1).fillRoundedRect(-w / 2, -h / 2, w, h, 28);
    bg.lineStyle(4, 0xe8735a, 1).strokeRoundedRect(-w / 2, -h / 2, w, h, 28);
    this.intro = this.add.container(this.scale.width / 2, this.scale.height / 2, [bg, badge, titleText, body, hint]).setDepth(15).setScale(0.8).setAlpha(0);
    this.tweens.add({ targets: this.intro, scale: 1, alpha: 1, duration: 320, ease: 'Back.easeOut' });
    this.input.keyboard?.once('keydown', () => this.dismissIntro());
    this.time.delayedCall(5200, () => this.dismissIntro());
  }

  get introOpen(): boolean {
    return this.intro !== null;
  }

  private dismissIntro(): void {
    const intro = this.intro;
    if (!intro) return;
    this.intro = null;
    this.tweens.add({ targets: intro, alpha: 0, scale: 0.9, duration: 200, onComplete: () => intro.destroy() });
  }

  setPrompt(text: string | null): void {
    this.interactLabel.setText(text ?? '').setVisible(!!text);
    this.interactBtn.setAlpha(text ? 1 : 0.55);
  }

  setRotateVisible(visible: boolean): void {
    this.rotateWanted = visible;
    this.rotateBtn.setVisible(visible);
  }

  setPaused(paused: boolean): void {
    this.pauseShade.setVisible(paused);
    this.pauseText.setVisible(paused);
  }

  /** An arrow at the screen edge pointing at the partner when they are off camera. */
  showPartnerArrow(angle: number | null, color: string, x = 0, y = 0): void {
    if (angle === null) {
      this.partnerArrow.setVisible(false);
      return;
    }
    this.partnerArrow.setVisible(true).setFillStyle(hex(color)).setPosition(x, y).setRotation(angle + Math.PI / 2);
  }

  setFps(fps: number): void {
    this.fpsText?.setText(`${fps.toFixed(0)} fps`);
  }

  private layoutPanel(): void {
    const w = Math.max(this.objectiveText.width, this.titleText.width) + 40;
    const h = 92;
    this.panelBg.clear();
    this.panelBg.fillStyle(0x3b2416, 0.2).fillRoundedRect(-w + 3, 5, w, h, 18);
    this.panelBg.fillStyle(0xfff8ec, 0.96).fillRoundedRect(-w, 0, w, h, 18);
    this.panelBg.lineStyle(3, 0x3b2416, 0.8).strokeRoundedRect(-w, 0, w, h, 18);
    this.titleText.setPosition(-w / 2, 20);
    this.objectiveText.setPosition(-w / 2, 50);
    this.dots.forEach((dot, i) => dot.setPosition(-w / 2 + (i - (this.dots.length - 1) / 2) * 18, h - 10));
    this.objectivePanel.setPosition(this.scale.width - 16, 12);
  }

  private layout(): void {
    const { width, height } = this.scale;
    this.layoutPanel();
    this.toastBox.setPosition(width / 2, 150);
    if (this.joyPointer === null) {
      this.joyBase.setPosition(150, height - 150).setAlpha(0.55);
      this.joyKnob.setPosition(150, height - 150);
    }
    this.interactBtn.setPosition(width - 120, height - 130);
    this.interactLabel.setPosition(width - 120, height - 48);
    this.rotateBtn.setPosition(width - 260, height - 220).setVisible(this.rotateWanted);
    this.swapBtn.setPosition(width - 270, height - 82).setVisible(!this.twoPhones);
    this.swapPortrait.setPosition(width - 270, height - 86).setVisible(!this.twoPhones);
    this.activeName.setPosition(this.twoPhones ? width - 120 : width - 270, this.twoPhones ? height - 228 : height - 22);
    this.netChip?.setPosition(width / 2, 30);
    // Clear of the app's native pause button, which sits over the top-left corner.
    this.widget?.setPosition(84, 12);
    this.pauseShade.setSize(width, height);
    this.pauseText.setPosition(width / 2, height / 2);
    this.intro?.setPosition(width / 2, height / 2);
  }
}
