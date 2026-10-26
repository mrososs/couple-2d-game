import Phaser from 'phaser';
import type { CharacterId, GameCommand } from '../../bridge/protocol.ts';
import { levelContent } from '../../domain/levels/content.ts';
import { NetLink, type LinkEnd, type LinkStatus } from '../../net/link.ts';
import { SceneReplica } from '../../net/mirror.ts';
import { randomId, type GameNetMessage, type HudEvent, type NetConfig, type NetMessage, type PauseReason, type SnapshotMeta } from '../../net/protocol.ts';
import { SnapshotOrder } from '../../net/snapshot-order.ts';
import { isLevelId } from '../../bridge/protocol.ts';
import type { SfxName } from '../audio/sfx.ts';
import { ensureTexture } from '../art/texture-factory.ts';
import { COLORS, routeFeel, servicesOf } from '../services.ts';
import { Feedback } from '../systems/feedback.ts';
import { InputHub } from '../systems/input-hub.ts';
import { ensureCharacter } from './boot-scene.ts';
import type { HudScene } from './hud-scene.ts';

/** The guest stops showing the world as live after this long without a snapshot. */
const HOST_TIMEOUT_MS = 3000;
/** The controls are re-sent at least this often, which doubles as the guest's heartbeat. */
const HEARTBEAT_MS = 200;
/** How often to ask again for the whole picture while waiting for it. */
const JOIN_RETRY_MS = 700;

/**
 * The guest phone's view in two-phone play. It runs no rules: it draws what the host's game
 * sends, follows its own character with the camera, plays the host's sounds and effects, and
 * sends its player's joystick and button presses back. Its HUD is its own (controls, its own
 * prompt), with the host's objectives, toasts and level widget copied in.
 *
 * Snapshots apply in order only (SnapshotOrder): after a gap it asks for the whole picture again
 * rather than drawing changes over a stale one. Button presses are counted per host run, so a
 * press aimed at the level before a restart never lands in the new one.
 */
export class MirrorScene extends Phaser.Scene {
  private net!: NetConfig;
  private link!: NetLink;
  private hub!: InputHub;
  private hud!: HudScene;
  private world!: SceneReplica;
  private hudReplica?: SceneReplica;
  private feedback!: Feedback;
  private order!: SnapshotOrder;
  private meta: SnapshotMeta | null = null;
  private lastSnapshotAt = Number.NEGATIVE_INFINITY;
  private joinSentAt = Number.NEGATIVE_INFINITY;
  private sentAt = 0;
  /** The input epoch: one per host run seen. Presses and the sequence count within it. */
  private epoch = { run: '', ep: '', seq: 0, ia: 0, ro: 0 };
  private sent = { x: 0, y: 0, ia: 0, ro: 0 };
  private camTarget!: Phaser.GameObjects.Zone;
  private live = false;
  private announcedReady = false;
  private pausedKey = '';
  private hostLeft = false;
  private completed = false;
  /**
   * The HUD scene starts after this one: the host's title, objectives and toasts can arrive
   * first, and are kept until it is there (they are not sent again until they change).
   */
  private hudReady = false;
  private readonly hudBacklog: HudEvent[] = [];

  constructor() {
    super('mirror');
  }

  create(): void {
    const services = servicesOf(this);
    const { session } = services;
    this.net = session.net!;
    this.meta = null;
    this.announcedReady = false;
    this.lastSnapshotAt = Number.NEGATIVE_INFINITY;
    this.joinSentAt = Number.NEGATIVE_INFINITY;
    this.order = new SnapshotOrder();
    this.epoch = { run: '', ep: randomId(), seq: 0, ia: 0, ro: 0 };
    this.sent = { x: 0, y: 0, ia: 0, ro: 0 };
    this.pausedKey = '';
    this.hostLeft = false;
    this.completed = false;
    this.hudReady = false;
    this.hudBacklog.length = 0;
    const me = this.net.me;

    const ensure = (key: string) => ensureTexture(this, key, servicesOf(this).session);
    this.world = new SceneReplica(this, ensure);
    this.feedback = new Feedback(this, services.sfx, () => servicesOf(this).settings.reducedMotion);
    this.hub = new InputHub(this, me, { single: true });
    this.camTarget = this.add.zone(0, 0, 1, 1);
    this.cameras.main.setBackgroundColor(COLORS.ink).startFollow(this.camTarget, false, 0.12, 0.12);
    this.live = false;

    this.hud = this.scene.get('hud') as HudScene;
    this.hud.whenReady(() => {
      const keyOf = (id: CharacterId) => ensureCharacter(this, id, session.outfits[id]);
      this.hud.attach(this.hub, { wife: `portrait-${keyOf('wife')}`, husband: `portrait-${keyOf('husband')}` }, session.names, true);
      this.hudReplica = new SceneReplica(this.hud, (key) => ensureTexture(this.hud, key, servicesOf(this).session), this.hud.replicaLayer);
      const content = isLevelId(session.sceneId) ? levelContent(session.sceneId) : null;
      this.hud.setLevelTitle(content ? `${content.number}. ${content.title}` : 'تجربة التكامل');
      this.hud.setNetStatus(this.order.isSynced ? null : '📡 بنوصل لموبايل شريكك…');
      this.hudReady = true;
      for (const event of this.hudBacklog.splice(0)) this.showHud(event);
      if (this.meta) this.applyMeta(this.meta);
    });

    this.link = new NetLink({
      url: this.net.url,
      auth: { role: 'guest', key: this.net.key },
      channel: 'game',
      onMessage: (m) => this.onMessage(m),
      onStatus: (status, end) => this.onLinkStatus(status, end),
    });
    this.events.once('shutdown', () => {
      this.link.close();
      this.world.clear();
      this.hudReplica?.clear();
      this.feedback.destroy();
    });
  }

  update(time: number): void {
    // Controls: this phone's joystick and buttons, sent to the host as they change.
    this.hub.enabled = !this.hud.introOpen && this.order.isSynced;
    this.hub.beginFrame();
    const intent = this.hub.intent(this.net.me);
    if (intent.interact) this.epoch.ia++;
    if (intent.rotate) this.epoch.ro++;
    const changed =
      Math.abs(intent.x - this.sent.x) > 0.05 || Math.abs(intent.y - this.sent.y) > 0.05 || this.epoch.ia !== this.sent.ia || this.epoch.ro !== this.sent.ro;
    if (this.order.isSynced && (changed || time - this.sentAt > HEARTBEAT_MS)) {
      const x = Math.round(intent.x * 100) / 100;
      const y = Math.round(intent.y * 100) / 100;
      const { run, ep, ia, ro } = this.epoch;
      if (this.link.send({ t: 'in', run, ep, seq: ++this.epoch.seq, x, y, ia, ro })) {
        this.sent = { x, y, ia, ro };
        this.sentAt = time;
      }
    }
    if (this.link.isOpen && !this.order.isSynced && time - this.joinSentAt > JOIN_RETRY_MS) this.askForPicture(time);

    this.world.step();
    this.hudReplica?.step();
    this.followCamera();
    const live = time - this.lastSnapshotAt < HOST_TIMEOUT_MS;
    if (live !== this.live && this.hudReady) {
      this.live = live;
      if (!this.hostLeft) this.hud.setNetStatus(live ? null : '📡 مستنيين موبايل شريكك…');
    }
  }

  /** Pause, resume and restart from this phone's app are requests the host's game decides on. */
  command(command: GameCommand): void {
    if (command.kind === 'decline') return;
    this.link.send({ t: 'req', k: command.kind });
  }

  /** Closes the network at once (the page is going), without waiting for Phaser's next frame. */
  shutdownNet(): void {
    this.link?.close();
  }

  private askForPicture(time: number): void {
    this.joinSentAt = time;
    this.link.send({ t: 'join' });
  }

  private onLinkStatus(status: LinkStatus, end: LinkEnd | null): void {
    const services = servicesOf(this);
    if (status === 'open') {
      // A new connection may have missed snapshots: the next picture must be a whole one.
      this.order.invalidate();
      this.askForPicture(this.time.now);
    }
    if (status === 'closed' && end && end !== 'closed') {
      if (this.hudReady) this.hud.setNetStatus('📡 الغرفة اتقفلت');
      services.emit({ type: 'net', status: 'closed', end });
      return;
    }
    services.emit({ type: 'net', status: status === 'open' ? 'online' : status === 'closed' ? 'offline' : 'connecting' });
  }

  private onMessage(message: NetMessage): void {
    if (message.ch !== 'game') return;
    const m = message as GameNetMessage;
    const services = servicesOf(this);
    switch (m.t) {
      case 'snap': {
        const s = m.s;
        const verdict = this.order.accept(s.run, s.n, s.full);
        if (verdict === 'resync') {
          if (this.time.now - this.joinSentAt > JOIN_RETRY_MS / 2) this.askForPicture(this.time.now);
          return;
        }
        if (verdict === 'drop') return;
        this.lastSnapshotAt = this.time.now;
        this.hostLeft = false;
        if (s.run !== this.epoch.run) {
          // A new run of the level: presses start counting afresh, in a new epoch.
          this.epoch = { run: s.run, ep: randomId(), seq: 0, ia: 0, ro: 0 };
          this.sent = { x: 0, y: 0, ia: 0, ro: 0 };
        }
        this.meta = s.meta;
        this.world.apply(s.world, s.full);
        this.hudReplica?.apply(s.hud, s.full);
        this.cameras.main.setBounds(0, 0, s.meta.world.w, s.meta.world.h);
        if (this.hudReady) this.applyMeta(s.meta);
        if (!this.announcedReady) {
          this.announcedReady = true;
          const session = services.session;
          services.emit({
            type: 'ready',
            sceneId: session.sceneId,
            sessionId: session.sessionId,
            renderer: this.game.renderer.type === Phaser.WEBGL ? 'webgl' : 'canvas',
            width: Math.round(this.scale.width),
            height: Math.round(this.scale.height),
          });
        }
        break;
      }
      case 'hud':
        if (this.hudReady) this.showHud(m.h);
        else this.hudBacklog.push(m.h);
        break;
      case 'fx': {
        const fx = m.fx;
        if (fx.k === 'sfx') services.sfx.play(fx.name as SfxName);
        else if (fx.k === 'burst') {
          if (fx.celebrate) this.feedback.celebrate(fx.x, fx.y, false);
          else this.feedback.burst(fx.x, fx.y, fx.n, false);
        } else routeFeel(services, fx);
        break;
      }
      case 'paused':
        if (this.hudReady) this.showPaused(m.reasons);
        break;
      case 'answer':
        services.emit({ type: 'answer', kind: m.k, ok: m.ok });
        break;
      case 'complete':
        this.completed = true;
        services.emit({ type: 'complete', result: m.result });
        break;
      case 'bye':
        // After the result, the host's page closing is the way to the result screen, not leaving.
        if (this.completed) break;
        this.hostLeft = true;
        if (this.hudReady) this.hud.setNetStatus('🚪 شريكك خرج من المرحلة');
        services.emit({ type: 'net', status: 'host-left' });
        break;
    }
  }

  private showHud(h: HudEvent): void {
    if (h.k === 'title') this.hud.setLevelTitle(h.text);
    else if (h.k === 'objectives') this.hud.setObjectives(h.list);
    else if (h.k === 'toast') this.hud.toast(h.text, h.kind, h.ms);
    else if (h.k === 'intro') this.hud.showIntro(h.title, h.lines, h.number);
  }

  private applyMeta(meta: SnapshotMeta): void {
    this.hud.setPrompt(meta.prompts[this.net.me]);
    this.hud.setRotateVisible(meta.rotate[this.net.me]);
    this.showPaused(meta.paused);
  }

  private showPaused(reasons: readonly PauseReason[]): void {
    const key = [...reasons].sort().join(',');
    if (key === this.pausedKey) return;
    this.pausedKey = key;
    this.hud.setPaused(reasons.length > 0);
    servicesOf(this).emit(reasons.length ? { type: 'paused', reasons } : { type: 'resumed' });
  }

  private followCamera(): void {
    if (!this.meta) return;
    const me = this.world.get(this.meta.players[this.net.me]) as Phaser.GameObjects.Sprite | undefined;
    const partner = this.world.get(this.meta.players[this.net.me === 'wife' ? 'husband' : 'wife']) as Phaser.GameObjects.Sprite | undefined;
    if (!me) return;
    const px = partner?.x ?? me.x;
    const py = partner?.y ?? me.y;
    this.camTarget.setPosition(((me.x + px) / 2) * 0.6 + me.x * 0.4, ((me.y + py) / 2) * 0.6 + me.y * 0.4 - 30);
    const cam = this.cameras.main;
    const spanX = Math.abs(me.x - px) + 520;
    const spanY = Math.abs(me.y - py) + 380;
    const minZoom = Math.max(cam.width / this.meta.world.w, cam.height / this.meta.world.h);
    const zoom = Phaser.Math.Clamp(Math.min(cam.width / spanX, cam.height / spanY), Math.max(minZoom, 0.55), 1.05);
    cam.setZoom(cam.zoom + (zoom - cam.zoom) * 0.05);
  }
}
