import { DestroyRef, Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import type { CharacterId, SceneId } from '../../game/bridge/protocol.ts';
import { NetLink, type LinkStatus } from '../../game/net/link.ts';
import {
  formatRoomCode,
  NET_VERSION,
  parseRoomCode,
  randomPin,
  RELAY_PORT,
  relayUrl,
  type LobbyMessage,
  type NetConfig,
  type NetMessage,
  type NetRole,
} from '../../game/net/protocol.ts';
import { LanRelay } from './lan-relay.ts';
import { Navigator } from './navigator.ts';
import { Progress } from './progress.ts';

/**
 * A relay to use instead of starting one on this device: the browser build points this at the
 * development relay (scripts/dev-relay.mjs), since a browser cannot listen for connections.
 */
export const DEV_RELAY_URL = new InjectionToken<string | null>('bwbt.devRelayUrl', { factory: () => null });

export type CoopPhase = 'idle' | 'starting' | 'waiting' | 'joining' | 'paired' | 'error';

const PARTNER_TIMEOUT_MS = 6000;

/**
 * Two-phone play, from the native app's side: opening a room (host) or joining one (guest),
 * agreeing who plays whom, and starting levels together. The host chooses the level; both phones
 * open it at once. The real-time game traffic does not pass through here - each phone's game page
 * talks to the relay itself - only these few lobby messages do.
 */
@Injectable({ providedIn: 'root' })
export class CoopSession {
  private readonly relay = inject(LanRelay);
  private readonly progress = inject(Progress);
  private readonly nav = inject(Navigator);
  private readonly devRelay = inject(DEV_RELAY_URL);
  private link: NetLink | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private lastHeard = 0;

  readonly phase = signal<CoopPhase>('idle');
  readonly role = signal<NetRole | null>(null);
  readonly roomCode = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly partnerName = signal<string | null>(null);
  readonly partnerOnline = signal(false);
  readonly linkStatus = signal<LinkStatus>('closed');
  /** Names and outfits both phones use: the host's. */
  readonly names = signal<Readonly<Record<CharacterId, string>> | null>(null);
  readonly outfits = signal<Readonly<Record<CharacterId, number>> | null>(null);
  /** The character this phone plays. */
  readonly me = signal<CharacterId | null>(null);
  readonly active = computed(() => this.phase() !== 'idle');
  readonly paired = computed(() => this.phase() === 'paired');
  private url: string | null = null;
  private pin = '';
  private sessionCounter = 1;

  constructor() {
    inject(DestroyRef).onDestroy(() => void this.leave());
  }

  /** Whether this build can host (Android with the relay module, or a development relay). */
  get canHost(): boolean {
    return this.relay.available || !!this.devRelay;
  }

  async host(): Promise<void> {
    await this.leave();
    this.phase.set('starting');
    this.role.set('host');
    this.pin = randomPin();
    const profile = this.progress.profile();
    this.names.set(profile.names);
    this.outfits.set(profile.outfits);
    this.me.set(profile.lead);
    try {
      let address: string | null;
      if (this.devRelay) {
        address = '127.0.0.1';
        this.url = this.devRelay;
      } else {
        address = await this.relay.start(RELAY_PORT);
        this.url = `ws://127.0.0.1:${RELAY_PORT}`;
      }
      if (!address) {
        this.fail('مفيش واي فاي: وصّلوا الموبايل بالواي فاي أو شغّلوا هوت سبوت');
        return;
      }
      this.roomCode.set(formatRoomCode(address, this.pin));
      this.phase.set('waiting');
      this.connect('host');
    } catch (e) {
      this.fail(`مقدرناش نفتح الغرفة: ${(e as Error).message ?? e}`);
    }
  }

  async join(code: string): Promise<void> {
    await this.leave();
    const parsed = this.devRelay ? { host: '0', pin: code.trim().slice(-2) } : parseRoomCode(code);
    if (!parsed || !/^\d{2}$/.test(parsed.pin)) {
      this.fail('الكود مش صحيح — زي كده: 23-58');
      return;
    }
    const url = this.devRelay ?? relayUrl(parsed, this.relay.localAddress());
    if (!url) {
      this.fail('الموبايل مش متوصل بواي فاي');
      return;
    }
    this.role.set('guest');
    this.pin = parsed.pin;
    this.url = url;
    this.roomCode.set(code.trim());
    this.phase.set('joining');
    this.connect('guest');
  }

  /** The host opens a level on both phones. */
  startLevel(sceneId: SceneId): void {
    if (this.role() !== 'host') return;
    const sessionId = ++this.sessionCounter;
    this.send({ t: 'start', sceneId, sessionId });
    this.openLevel(sceneId);
  }

  async leave(): Promise<void> {
    if (this.link) {
      this.send({ t: 'bye' });
      this.link.close();
      this.link = null;
    }
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    if (this.role() === 'host' && !this.devRelay) await this.relay.stop().catch(() => undefined);
    this.phase.set('idle');
    this.role.set(null);
    this.roomCode.set(null);
    this.partnerName.set(null);
    this.partnerOnline.set(false);
    this.linkStatus.set('closed');
    this.error.set(null);
  }

  /** What this phone's game page needs to join in, for the level that is starting. */
  netConfig(): NetConfig | null {
    const role = this.role();
    const me = this.me();
    if (!role || !me || !this.url) return null;
    return { role, url: this.url, pin: this.pin, me };
  }

  private connect(role: NetRole): void {
    this.link = new NetLink(this.url!, role, 'lobby', (m) => this.onMessage(m), (status) => {
      this.linkStatus.set(status);
      if (status === 'open') this.send({ t: 'hello', pin: this.pin, v: NET_VERSION, name: this.progress.profile().names[this.progress.profile().lead] });
    });
    this.lastHeard = 0;
    this.heartbeat = setInterval(() => {
      this.send({ t: 'ping' });
      const online = Date.now() - this.lastHeard < PARTNER_TIMEOUT_MS;
      if (online !== this.partnerOnline()) this.partnerOnline.set(online);
    }, 2000);
  }

  private onMessage(message: NetMessage): void {
    if (message.ch !== 'lobby') return;
    const m = message as LobbyMessage;
    this.lastHeard = Date.now();
    this.partnerOnline.set(true);
    if (this.role() === 'host') {
      if (m.t === 'hello') {
        if (m.pin !== this.pin) {
          this.send({ t: 'reject', reason: 'pin' });
          return;
        }
        if (m.v !== NET_VERSION) {
          this.send({ t: 'reject', reason: 'version' });
          return;
        }
        const me = this.me()!;
        this.partnerName.set(this.names()![me === 'wife' ? 'husband' : 'wife']);
        this.send({ t: 'welcome', guestPlays: me === 'wife' ? 'husband' : 'wife', names: this.names()!, outfits: this.outfits()! });
        this.phase.set('paired');
      } else if (m.t === 'bye') {
        this.partnerOnline.set(false);
        this.phase.set('waiting');
      }
      return;
    }
    // Guest.
    switch (m.t) {
      case 'welcome':
        this.me.set(m.guestPlays);
        this.names.set(m.names);
        this.outfits.set(m.outfits);
        this.partnerName.set(m.names[m.guestPlays === 'wife' ? 'husband' : 'wife']);
        this.phase.set('paired');
        break;
      case 'reject':
        this.fail(m.reason === 'pin' ? 'الكود غلط — اتأكدوا من الرقمين الأخيرين' : 'نسخة اللعبة مختلفة على الموبايلين');
        this.link?.close();
        break;
      case 'start':
        this.sessionCounter = m.sessionId;
        this.openLevel(m.sceneId);
        break;
      case 'bye':
        this.partnerOnline.set(false);
        break;
    }
  }

  private openLevel(sceneId: SceneId): void {
    const screen = { name: 'game' as const, sceneId, coop: true };
    const current = this.nav.current();
    if (current.name === 'game' || current.name === 'result') this.nav.replace(screen);
    else this.nav.push(screen);
  }

  private send(message: Record<string, unknown>): void {
    this.link?.send(message as never);
  }

  private fail(message: string): void {
    this.error.set(message);
    this.phase.set('error');
  }
}
