import Phaser from 'phaser';
import type { CharacterId, GameCommand } from '../../bridge/protocol.ts';
import { levelContent } from '../../domain/levels/content.ts';
import { NetLink, type LinkStatus } from '../../net/link.ts';
import { SceneReplica } from '../../net/mirror.ts';
import type { GameNetMessage, NetConfig, NetMessage, SnapshotMeta } from '../../net/protocol.ts';
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

/**
 * The guest phone's view in two-phone play. It runs no rules: it draws what the host's game
 * sends, follows its own character with the camera, plays the host's sounds and effects, and
 * sends its player's joystick and button presses back. Its HUD is its own (controls, its own
 * prompt), with the host's objectives, toasts and level widget copied in.
 */
export class MirrorScene extends Phaser.Scene {
  private net!: NetConfig;
  private link!: NetLink;
  private hub!: InputHub;
  private hud!: HudScene;
  private world!: SceneReplica;
  private hudReplica?: SceneReplica;
  private feedback!: Feedback;
  private meta: SnapshotMeta | null = null;
  private lastSnapshotAt = Number.NEGATIVE_INFINITY;
  private sentAt = 0;
  private sent = { x: 0, y: 0, ia: 0, ro: 0 };
  private presses = { ia: 0, ro: 0 };
  private camTarget!: Phaser.GameObjects.Zone;
  private live = false;
  private announcedReady = false;

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
    this.sent = { x: 0, y: 0, ia: 0, ro: 0 };
    this.presses = { ia: 0, ro: 0 };
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
    });

    this.link = new NetLink(this.net.url, 'guest', 'game', (m) => this.onMessage(m), (status) => this.onLinkStatus(status), this.net.pin);
    this.events.once('shutdown', () => {
      this.link.close();
      this.world.clear();
      this.hudReplica?.clear();
      this.feedback.destroy();
    });
  }

  update(time: number, delta: number): void {
    // Controls: this phone's joystick and buttons, sent to the host as they change.
    this.hub.enabled = !this.hud.introOpen;
    this.hub.beginFrame();
    const intent = this.hub.intent(this.net.me);
    if (intent.interact) this.presses.ia++;
    if (intent.rotate) this.presses.ro++;
    const changed =
      Math.abs(intent.x - this.sent.x) > 0.05 || Math.abs(intent.y - this.sent.y) > 0.05 || this.presses.ia !== this.sent.ia || this.presses.ro !== this.sent.ro;
    if (changed || time - this.sentAt > HEARTBEAT_MS) {
      const x = Math.round(intent.x * 100) / 100;
      const y = Math.round(intent.y * 100) / 100;
      if (this.link.send({ t: 'in', x, y, ia: this.presses.ia, ro: this.presses.ro })) {
        this.sent = { x, y, ia: this.presses.ia, ro: this.presses.ro };
        this.sentAt = time;
      }
    }

    this.world.step();
    this.hudReplica?.step();
    this.followCamera();
    const live = time - this.lastSnapshotAt < HOST_TIMEOUT_MS;
    if (live !== this.live) {
      this.live = live;
      this.hud.setNetStatus(live ? null : '📡 مستنيين موبايل المضيف…');
    }
    void delta;
  }

  /** Pause, resume and restart from this phone's app are the host's to carry out. */
  command(command: GameCommand): void {
    this.link.send({ t: command.kind });
  }

  private onLinkStatus(status: LinkStatus): void {
    const services = servicesOf(this);
    if (status === 'open') {
      // Ask for the whole picture; repeated until the first snapshot arrives.
      this.link.send({ t: 'join', pin: this.net.pin });
      this.time.delayedCall(800, () => {
        if (!this.meta && this.link.isOpen) this.link.send({ t: 'join', pin: this.net.pin });
      });
    }
    services.emit({ type: 'net', status: status === 'open' ? 'online' : status === 'closed' ? 'offline' : 'connecting' });
  }

  private onMessage(message: NetMessage): void {
    if (message.ch !== 'game') return;
    const m = message as GameNetMessage;
    const services = servicesOf(this);
    switch (m.t) {
      case 'snap': {
        this.lastSnapshotAt = this.time.now;
        this.meta = m.s.meta;
        this.world.apply(m.s.world, m.s.full);
        this.hudReplica?.apply(m.s.hud, m.s.full);
        this.cameras.main.setBounds(0, 0, m.s.meta.world.w, m.s.meta.world.h);
        this.hud.setPrompt(m.s.meta.prompts[this.net.me]);
        this.hud.setRotateVisible(m.s.meta.rotate[this.net.me]);
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
      case 'hud': {
        const h = m.h;
        if (h.k === 'title') this.hud.setLevelTitle(h.text);
        else if (h.k === 'objectives') this.hud.setObjectives(h.list);
        else if (h.k === 'toast') this.hud.toast(h.text, h.kind, h.ms);
        else if (h.k === 'intro') this.hud.showIntro(h.title, h.lines, h.number);
        break;
      }
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
        this.hud.setPaused(m.paused);
        services.emit({ type: m.paused ? 'paused' : 'resumed' });
        break;
      case 'complete':
        services.emit({ type: 'complete', result: m.result });
        break;
    }
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
