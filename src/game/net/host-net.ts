import type Phaser from 'phaser';
import type { CharacterId, GameCommandKind, LevelResult } from '../bridge/protocol.ts';
import type { HudScene } from '../phaser/scenes/hud-scene.ts';
import type { GameServices } from '../phaser/services.ts';
import type { JointCarry } from '../phaser/systems/cooperation.ts';
import type { InputHub } from '../phaser/systems/input-hub.ts';
import type { InteractionSystem } from '../phaser/systems/interaction.ts';
import type { Player } from '../phaser/systems/player.ts';
import { NetLink } from './link.ts';
import { SceneMirror } from './mirror.ts';
import type { EffectEvent, GameNetMessage, NetConfig, NetMessage, SnapshotMeta } from './protocol.ts';

/** Snapshots per second sent to the guest. */
const RATE_MS = 1000 / 15;
/** No word from the guest for this long and their character stops and the host is told. */
const GUEST_TIMEOUT_MS = 3000;

/**
 * The host phone's half of two-phone play. The level runs here, as on one phone, with the
 * partner's character driven by the controls the guest sends. Fifteen times a second it sends the
 * guest what changed on screen, and it forwards HUD moments, sounds and feel as they happen.
 */
export class HostNet {
  private readonly link: NetLink;
  private readonly world: SceneMirror;
  private readonly hudMirror: SceneMirror;
  private readonly guest: CharacterId;
  private clock = 0;
  private count = 0;
  private needFull = true;
  private guestSeenAt = Number.NEGATIVE_INFINITY;
  private guestOnline = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly hud: HudScene,
    private readonly services: GameServices,
    private readonly config: NetConfig,
    private readonly hub: InputHub,
    private readonly players: Readonly<Record<CharacterId, Player>>,
    private readonly interaction: InteractionSystem,
    private readonly joint: JointCarry,
    private readonly onCommand: (kind: GameCommandKind) => void,
  ) {
    this.guest = config.me === 'wife' ? 'husband' : 'wife';
    this.world = new SceneMirror(scene);
    this.hudMirror = new SceneMirror(hud, () => (hud.levelWidget ? [hud.levelWidget] : []));
    this.link = new NetLink(
      config.url,
      'host',
      'game',
      (m) => this.onMessage(m),
      (status) => {
        if (status !== 'open') hud.setNetStatus('📡 بنوصل للشبكة…');
        else hud.setNetStatus(this.guestOnline ? null : `📡 مستنيين ${players[this.guest].name}…`);
      },
      config.pin,
    );
    services.relay = (effect) => this.send({ t: 'fx', fx: effect });
    hud.sharedListener = (event) => this.send({ t: 'hud', h: event });
    hud.setNetStatus(`📡 مستنيين ${players[this.guest].name}…`);
  }

  update(delta: number): void {
    const now = this.scene.time.now;
    const online = now - this.guestSeenAt < GUEST_TIMEOUT_MS;
    if (online !== this.guestOnline) {
      this.guestOnline = online;
      const name = this.players[this.guest].name;
      if (!online) {
        this.hub.releaseRemote(this.guest);
        this.hud.setNetStatus(`📡 مستنيين ${name}…`);
      } else {
        this.hud.setNetStatus(null);
        this.hud.toast(`${name} معاكم! 👋`, 'good', 2000);
      }
      this.services.emit({ type: 'net', status: online ? 'online' : 'partner-away' });
    }
    this.clock += delta;
    if (this.clock < RATE_MS || !this.link.isOpen) return;
    this.clock = 0;
    this.sendSnapshot();
  }

  complete(result: LevelResult): void {
    this.send({ t: 'complete', result });
  }

  paused(paused: boolean): void {
    this.send({ t: 'paused', paused });
  }

  effect(effect: EffectEvent): void {
    this.send({ t: 'fx', fx: effect });
  }

  destroy(): void {
    this.services.relay = undefined;
    this.hud.sharedListener = undefined;
    this.hud.setNetStatus(null);
    this.link.close();
  }

  private sendSnapshot(): void {
    const full = this.needFull;
    this.needFull = false;
    const meta: SnapshotMeta = {
      world: { w: this.scene.physics.world.bounds.width, h: this.scene.physics.world.bounds.height },
      players: { wife: this.world.idOf(this.players.wife.sprite), husband: this.world.idOf(this.players.husband.sprite) },
      prompts: {
        wife: this.interaction.focusOf('wife')?.prompt(this.players.wife) ?? null,
        husband: this.interaction.focusOf('husband')?.prompt(this.players.husband) ?? null,
      },
      rotate: {
        wife: this.services.session.sceneId === 'level03' && !!this.joint.carriedBy('wife'),
        husband: this.services.session.sceneId === 'level03' && !!this.joint.carriedBy('husband'),
      },
      guestOnline: this.guestOnline,
    };
    this.send({ t: 'snap', s: { n: ++this.count, full, world: this.world.collect(full), hud: this.hudMirror.collect(full), meta } });
  }

  private onMessage(message: NetMessage): void {
    if (message.ch !== 'game') return;
    const m = message as GameNetMessage;
    switch (m.t) {
      case 'join':
        if (m.pin !== this.config.pin) return;
        this.guestSeenAt = this.scene.time.now;
        // A guest that joins or rejoins gets the whole picture and the HUD as it stands.
        this.needFull = true;
        this.world.reset();
        this.hudMirror.reset();
        for (const event of this.hud.sharedState()) this.send({ t: 'hud', h: event });
        break;
      case 'in':
        this.guestSeenAt = this.scene.time.now;
        this.hub.setRemote(this.guest, m.x, m.y, m.ia, m.ro);
        break;
      case 'pause':
      case 'resume':
      case 'restart':
        this.guestSeenAt = this.scene.time.now;
        this.onCommand(m.t);
        break;
    }
  }

  private send(message: Record<string, unknown>): void {
    this.link.send(message as never);
  }
}
