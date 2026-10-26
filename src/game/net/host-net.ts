import type Phaser from 'phaser';
import type { CharacterId, LevelResult } from '../bridge/protocol.ts';
import type { HudScene } from '../phaser/scenes/hud-scene.ts';
import type { GameServices } from '../phaser/services.ts';
import type { JointCarry } from '../phaser/systems/cooperation.ts';
import type { InputHub } from '../phaser/systems/input-hub.ts';
import type { InteractionSystem } from '../phaser/systems/interaction.ts';
import type { Player } from '../phaser/systems/player.ts';
import { NetLink } from './link.ts';
import { SceneMirror } from './mirror.ts';
import { readInput, type EffectEvent, type GameNetMessage, type InputMessage, type NetConfig, type NetMessage, type PauseReason, type SnapshotMeta } from './protocol.ts';

/** Snapshots per second sent to the guest; the world eases between them on the guest's screen. */
export const SNAPSHOT_HZ = 15;
/** No word from the guest for this long and the partner counts as gone. */
const GUEST_TIMEOUT_MS = 3000;
/** A full picture at most this often, however often the guest asks. */
const FULL_SPACING_MS = 250;

export interface HostNetHooks {
  /** The partner's phone came or went: the shared game waits for them. */
  partner(present: boolean): void;
  /** The guest pressed pause or resume on their phone. */
  guestPause(paused: boolean): void;
  /** The guest asks to start the level again; the host's player decides. */
  restartRequest(): void;
}

export interface NetStats {
  readonly snapshots: number;
  readonly fullSnapshots: number;
  readonly lastFullBytes: number;
  readonly lastDeltaBytes: number;
  readonly maxDeltaBytes: number;
  readonly bytesSent: number;
  readonly inputs: number;
  readonly rejectedInputs: number;
  readonly since: number;
}

/**
 * The host phone's half of two-phone play. The level runs here, as on one phone, with the
 * partner's character driven by the controls the guest sends. Fifteen times a second, while the
 * partner is there, it sends the guest what changed on screen, and it forwards HUD moments,
 * sounds and feel as they happen. It runs on its own timer rather than the scene's, so that it
 * notices the partner leaving or coming back - and sends them the whole picture - even while the
 * shared game is paused waiting for them.
 */
export class HostNet {
  /** This level run: a restart is a new run, and the guest's presses count per run. */
  readonly run: string;
  private readonly link: NetLink;
  private readonly world: SceneMirror;
  private readonly hudMirror: SceneMirror;
  private readonly guest: CharacterId;
  private readonly timer: ReturnType<typeof setInterval>;
  private count = 0;
  private needFull = true;
  private lastSnapAt = 0;
  private lastFullAt = Number.NEGATIVE_INFINITY;
  private guestSeenAt = Number.NEGATIVE_INFINITY;
  /** Partner connections the relay reports; null until it has. */
  private guestConnections: number | null = null;
  private guestOnline = false;
  private pauseReasons: readonly PauseReason[] = [];
  private restartAsked = false;
  private stats: NetStats = { snapshots: 0, fullSnapshots: 0, lastFullBytes: 0, lastDeltaBytes: 0, maxDeltaBytes: 0, bytesSent: 0, inputs: 0, rejectedInputs: 0, since: Date.now() };

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly hud: HudScene,
    private readonly services: GameServices,
    config: NetConfig,
    run: string,
    private readonly hub: InputHub,
    private readonly players: Readonly<Record<CharacterId, Player>>,
    private readonly interaction: InteractionSystem,
    private readonly joint: JointCarry,
    private readonly hooks: HostNetHooks,
  ) {
    this.run = run;
    this.guest = config.me === 'wife' ? 'husband' : 'wife';
    this.world = new SceneMirror(scene);
    this.hudMirror = new SceneMirror(hud, () => (hud.levelWidget ? [hud.levelWidget] : []));
    this.link = new NetLink({
      url: config.url,
      auth: { role: 'host', key: config.key },
      channel: 'game',
      onMessage: (m) => this.onMessage(m),
      onStatus: (status) => {
        if (status !== 'open') hud.setNetStatus('📡 بنوصل للشبكة…');
        else hud.setNetStatus(this.guestOnline ? null : `📡 مستنيين ${players[this.guest].name}…`);
      },
      onRoom: (room) => {
        this.guestConnections = room.guests;
        this.check();
      },
    });
    services.relay = (effect) => this.send({ t: 'fx', fx: effect });
    hud.sharedListener = (event) => this.send({ t: 'hud', h: event });
    hud.setNetStatus(`📡 مستنيين ${players[this.guest].name}…`);
    this.timer = setInterval(() => this.tick(), 1000 / 60);
  }

  get partnerPresent(): boolean {
    return this.guestOnline;
  }

  get netStats(): NetStats {
    return this.stats;
  }

  complete(result: LevelResult): void {
    this.send({ t: 'complete', result });
  }

  /** The shared pause changed: the guest's phone shows it too. */
  paused(reasons: readonly PauseReason[]): void {
    this.pauseReasons = reasons;
    this.send({ t: 'paused', reasons });
  }

  /** The host's player answered the guest's restart request. */
  answerRestart(ok: boolean): void {
    if (!this.restartAsked) return;
    this.restartAsked = false;
    this.send({ t: 'answer', k: 'restart', ok });
  }

  effect(effect: EffectEvent): void {
    this.send({ t: 'fx', fx: effect });
  }

  /** `leaving`: the host closed the level (not a restart), so the guest is told. */
  destroy(leaving: boolean): void {
    clearInterval(this.timer);
    if (leaving) this.send({ t: 'bye' });
    this.services.relay = undefined;
    this.hud.sharedListener = undefined;
    this.hud.setNetStatus(null);
    this.link.close();
  }

  private tick(): void {
    this.check();
    const now = performance.now();
    if (!this.link.isOpen || !this.guestOnline) return;
    if (now - this.lastSnapAt < 1000 / SNAPSHOT_HZ - 2 && !(this.needFull && now - this.lastFullAt >= FULL_SPACING_MS)) return;
    this.sendSnapshot(now);
  }

  /** Whether the partner is there: recent controls, and the relay still counting their phone. */
  private check(): void {
    const online = performance.now() - this.guestSeenAt < GUEST_TIMEOUT_MS && this.guestConnections !== 0;
    if (online === this.guestOnline) return;
    this.guestOnline = online;
    const name = this.players[this.guest].name;
    if (!online) {
      this.hub.releaseRemote(this.guest);
      this.hud.setNetStatus(`📡 مستنيين ${name}…`);
    } else {
      // Whatever they saw before is stale: they get the whole picture again.
      this.needFull = true;
      this.hud.setNetStatus(null);
      this.hud.toast(`${name} معاكم! 👋`, 'good', 2000);
    }
    this.hooks.partner(online);
    this.services.emit({ type: 'net', status: online ? 'online' : 'partner-away' });
  }

  private sendSnapshot(now: number): void {
    const full = this.needFull;
    if (full) {
      this.needFull = false;
      this.lastFullAt = now;
      this.world.reset();
      this.hudMirror.reset();
    }
    this.lastSnapAt = now;
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
      paused: this.pauseReasons,
    };
    const bytes = this.send({ t: 'snap', s: { run: this.run, n: ++this.count, full, world: this.world.collect(full), hud: this.hudMirror.collect(full), meta } });
    if (bytes === 0) {
      // Not delivered: the guest's picture no longer matches what the mirror thinks it sent.
      this.needFull = true;
      return;
    }
    const s = this.stats;
    this.stats = {
      ...s,
      snapshots: s.snapshots + 1,
      fullSnapshots: s.fullSnapshots + (full ? 1 : 0),
      lastFullBytes: full ? bytes : s.lastFullBytes,
      lastDeltaBytes: full ? s.lastDeltaBytes : bytes,
      maxDeltaBytes: full ? s.maxDeltaBytes : Math.max(s.maxDeltaBytes, bytes),
    };
  }

  private onMessage(message: NetMessage): void {
    if (message.ch !== 'game' || message.from !== 'guest') return;
    const m = message as GameNetMessage;
    switch (m.t) {
      case 'join':
        this.guestSeenAt = performance.now();
        this.needFull = true;
        this.check();
        for (const event of this.hud.sharedState()) this.send({ t: 'hud', h: event });
        this.send({ t: 'paused', reasons: this.pauseReasons });
        break;
      case 'in': {
        const input = readInput(m as InputMessage);
        if (!input) {
          this.stats = { ...this.stats, rejectedInputs: this.stats.rejectedInputs + 1 };
          return;
        }
        this.guestSeenAt = performance.now();
        this.stats = { ...this.stats, inputs: this.stats.inputs + 1 };
        this.check();
        // Presses aimed at an earlier run of the level (before a restart) do not carry over.
        this.hub.setRemote(this.guest, input, input.run === this.run);
        break;
      }
      case 'req':
        this.guestSeenAt = performance.now();
        if (m.k === 'pause' || m.k === 'resume') this.hooks.guestPause(m.k === 'pause');
        else if (m.k === 'restart') {
          this.restartAsked = true;
          this.hooks.restartRequest();
        }
        break;
    }
  }

  /** Sends on the game channel; the number of characters sent, 0 when not delivered. */
  private send(message: Record<string, unknown>): number {
    const sent = this.link.send(message as never);
    if (sent) this.stats = { ...this.stats, bytesSent: this.stats.bytesSent + sent };
    return sent;
  }
}
