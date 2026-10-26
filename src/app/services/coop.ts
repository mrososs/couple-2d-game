import { DestroyRef, Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import type { CharacterId, LevelResult, SceneId } from '../../game/bridge/protocol.ts';
import { NetLink, type LinkEnd, type LinkStatus, type RoomState } from '../../game/net/link.ts';
import {
  formatRoomCode,
  NET_VERSION,
  parseRoomCode,
  relayUrl,
  type ActiveLevel,
  type LobbyMessage,
  type NetConfig,
  type NetMessage,
  type NetRole,
} from '../../game/net/protocol.ts';
import { RELAY_PORT, ROOM_PATH, type RoomAuth } from '../../game/net/room.ts';
import { KEY_VALUE_STORE } from './kv-store.ts';
import { LanRelay, type LanRoomAd } from './lan-relay.ts';
import { Navigator } from './navigator.ts';
import { Progress } from './progress.ts';

/**
 * A relay to use instead of starting one on this device: the browser build points this at the
 * development relay (scripts/lan-relay.ts), since a browser cannot listen for connections.
 */
export const DEV_RELAY = new InjectionToken<{ readonly url: string; readonly hostKey: string } | null>('bwbt.devRelay', { factory: () => null });

export type CoopPhase = 'idle' | 'starting' | 'waiting' | 'joining' | 'paired' | 'error';

export type CoopErrorKind =
  | 'noWifi'
  | 'startFailed'
  | 'badCode'
  | 'unreachable'
  | 'pin'
  | 'full'
  | 'key'
  | 'version'
  | 'forbidden'
  | 'roomClosed'
  | 'lost';

/** What each failure tells the players, in their own words. */
export const COOP_ERRORS: Readonly<Record<CoopErrorKind, { readonly title: string; readonly hint: string }>> = {
  noWifi: { title: 'مفيش واي فاي', hint: 'وصّلوا الموبايل بالواي فاي، أو شغّلوا هوت سبوت من موبايل منكم ووصّلوا التاني عليه.' },
  startFailed: { title: 'مقدرناش نفتح الغرفة', hint: 'اقفلوا اللعبة وافتحوها تاني وجرّبوا.' },
  badCode: { title: 'الكود مش مظبوط', hint: 'الكود رقم وبعده الرقم السري، زي كده: 23-482916' },
  unreachable: {
    title: 'مش لاقيين الغرفة',
    hint: 'اتأكدوا إن الموبايلين على نفس الشبكة. بعض شبكات الضيوف والأماكن العامة بتمنع الموبايلات تشوف بعض — جرّبوا هوت سبوت من موبايل منكم.',
  },
  pin: { title: 'الرقم السري غلط', hint: 'بصّوا تاني على موبايل شريككم واكتبوا الرقم اللي ظاهر دلوقتي.' },
  full: { title: 'الغرفة فيها اتنين خلاص', hint: 'لو ده نفس الموبايل، اطلبوا من صاحب الغرفة يفتحها من جديد.' },
  key: { title: 'الغرفة دي اتقفلت', hint: 'صاحب الغرفة فتح غرفة جديدة — ادخلوا بالكود الجديد.' },
  version: { title: 'نسخة اللعبة مختلفة', hint: 'حدّثوا اللعبة على الموبايلين لنفس النسخة.' },
  forbidden: { title: 'الاتصال اترفض', hint: 'اتأكدوا إن الموبايلين على نفس الشبكة المحلية.' },
  roomClosed: { title: 'شريككم قفل الغرفة', hint: 'افتحوا غرفة جديدة لما تحبّوا تكمّلوا.' },
  lost: { title: 'الاتصال اتقطع', hint: 'اتأكدوا إن الموبايلين على نفس الشبكة، وإن موبايل صاحب الغرفة لسه فاتح اللعبة.' },
};

/** A partner the room has not heard from in this long counts as away. */
const PARTNER_TIMEOUT_MS = 6000;
/** How long a guest keeps trying to reach a room before saying it cannot find it. */
const JOIN_TIMEOUT_MS = 10000;
/** A saved room is offered for coming back to within this long. */
const REJOIN_WINDOW_MS = 6 * 60 * 60 * 1000;

/** What a guest keeps to come back to its room after the app was closed. */
export interface SavedRoom {
  readonly url: string;
  readonly key: string;
  readonly room: string;
  readonly at: number;
}

/**
 * Two-phone play, from the native app's side: opening a room (host) or joining one (guest),
 * agreeing who plays whom, starting levels together, and keeping both phones' records of the
 * levels they finished together. Everything runs on the local network - no internet.
 *
 * The real-time game traffic does not pass through here: each phone's game page has its own
 * connection to the room. Only the lobby messages do.
 */
@Injectable({ providedIn: 'root' })
export class CoopSession {
  private readonly relay = inject(LanRelay);
  private readonly progress = inject(Progress);
  private readonly nav = inject(Navigator);
  private readonly devRelay = inject(DEV_RELAY);
  private readonly saved = inject(KEY_VALUE_STORE).signal<SavedRoom | null>('bwbt.coop.v1', null);
  private link: NetLink | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private joinTimer: ReturnType<typeof setTimeout> | null = null;
  private lastHeard = 0;
  private url: string | null = null;
  private key: string | null = null;
  private hostAddress: string | null = null;
  private levelCounter = 0;

  readonly phase = signal<CoopPhase>('idle');
  readonly role = signal<NetRole | null>(null);
  /** The code to read out: the host's address and the PIN, while the room waits for a partner. */
  readonly roomCode = signal<string | null>(null);
  readonly pin = signal<string | null>(null);
  readonly roomId = signal<string | null>(null);
  readonly error = signal<CoopErrorKind | null>(null);
  readonly partnerName = signal<string | null>(null);
  readonly partnerOnline = signal(false);
  readonly linkStatus = signal<LinkStatus>('closed');
  /** Wrong PINs tried against this room (the host is told: someone is guessing). */
  readonly failedAttempts = signal(0);
  /** Names and outfits both phones use: the host's. */
  readonly names = signal<Readonly<Record<CharacterId, string>> | null>(null);
  readonly outfits = signal<Readonly<Record<CharacterId, number>> | null>(null);
  /** The character this phone plays. */
  readonly me = signal<CharacterId | null>(null);
  /** The level being played in the room, if any. */
  readonly activeLevel = signal<ActiveLevel | null>(null);
  /** Levels finished together in this room (host: to send a partner who missed them). */
  readonly results = signal<readonly LevelResult[]>([]);
  readonly active = computed(() => this.phase() !== 'idle');
  readonly paired = computed(() => this.phase() === 'paired');
  /** Paired, but the connection to the room is down and coming back. */
  readonly reconnecting = computed(() => this.phase() === 'paired' && this.linkStatus() !== 'open');
  /** A room this phone was in recently, to come back to. */
  readonly savedRoom = computed(() => {
    const s = this.saved();
    return s && Date.now() - s.at < REJOIN_WINDOW_MS ? s : null;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => void this.leave());
  }

  /** Whether this build can host (Android with the relay module, or a development relay). */
  get canHost(): boolean {
    return this.relay.available || !!this.devRelay;
  }

  // ---------------------------------------------------------------------------------------------
  // Host

  async host(): Promise<void> {
    await this.leave();
    this.phase.set('starting');
    this.role.set('host');
    const profile = this.progress.profile();
    this.names.set(profile.names);
    this.outfits.set(profile.outfits);
    this.me.set(profile.lead);
    this.partnerName.set(profile.names[profile.lead === 'wife' ? 'husband' : 'wife']);
    try {
      let hostKey: string;
      if (this.devRelay) {
        this.url = this.devRelay.url;
        hostKey = this.devRelay.hostKey;
        this.hostAddress = '127.0.0.1';
      } else {
        const started = await this.relay.start(RELAY_PORT);
        hostKey = started.hostKey;
        this.hostAddress = started.address;
        // The host's own app reaches its relay on this phone.
        this.url = `ws://127.0.0.1:${RELAY_PORT}${ROOM_PATH}`;
        if (!started.address) {
          await this.relay.stop();
          this.fail('noWifi');
          return;
        }
        this.relay.advertise(`${profile.names.wife} و${profile.names.husband}`, RELAY_PORT);
      }
      this.key = hostKey;
      this.phase.set('waiting');
      this.freshRoom = true;
      this.connect({ role: 'host', key: hostKey });
    } catch {
      this.fail('startFailed');
    }
  }

  /** The host opens a level on both phones. */
  startLevel(sceneId: SceneId): void {
    if (this.role() !== 'host') return;
    const level = { sceneId, session: ++this.levelCounter };
    this.activeLevel.set(level);
    this.send({ t: 'start', ...level });
    this.openLevel(sceneId);
  }

  /** The host left the level unfinished: the partner's phone goes back to the room too. */
  levelEnded(): void {
    if (this.role() !== 'host' || !this.activeLevel()) return;
    this.activeLevel.set(null);
    this.send({ t: 'ended' });
  }

  /**
   * The level was finished: on both phones it is over, without telling the partner anyone left -
   * they are on their way to the result screen too.
   */
  levelFinished(): void {
    this.activeLevel.set(null);
  }

  /** The host's app saved a finished level: the partner's phone saves the same record. */
  shareResult(result: LevelResult): void {
    if (this.role() !== 'host') return;
    if (!this.results().some((r) => r.id === result.id)) this.results.update((list) => [...list, result]);
    this.send({ t: 'result', result });
  }

  /** Guest: opens the level already running in the room (after coming back to it). */
  enterActiveLevel(sceneId: SceneId): void {
    if (this.role() === 'guest' && this.activeLevel()?.sceneId === sceneId) this.openLevel(sceneId);
  }

  /** Forgets the partner (their phone can no longer get in) and shows a new PIN. */
  reopen(): void {
    if (this.role() !== 'host') return;
    this.link?.control({ t: 'reset' });
    this.partnerOnline.set(false);
    this.phase.set('waiting');
  }

  // ---------------------------------------------------------------------------------------------
  // Guest

  /** Joins with a typed room code: the host's address (or its last number) and the PIN. */
  async join(code: string): Promise<void> {
    await this.leave();
    const parsed = parseRoomCode(code);
    if (!parsed) {
      this.fail('badCode');
      return;
    }
    const url = this.devRelay?.url ?? relayUrl(parsed, this.relay.localAddress());
    if (!url) {
      this.fail('noWifi');
      return;
    }
    this.startGuest(url, { role: 'guest', pin: parsed.pin }, code.trim());
  }

  /** Joins a room found on the network, with the PIN shown on the host's phone. */
  async joinFound(room: LanRoomAd, pin: string): Promise<void> {
    await this.leave();
    const digits = pin.replace(/\D/g, '');
    this.startGuest(`ws://${room.host}:${room.port}${ROOM_PATH}`, { role: 'guest', pin: digits }, room.name);
  }

  /** Comes back to the room this phone was in before the app closed. */
  async rejoin(): Promise<void> {
    const saved = this.savedRoom();
    if (!saved) return;
    await this.leave(false);
    this.startGuest(saved.url, { role: 'guest', key: saved.key }, null);
  }

  // ---------------------------------------------------------------------------------------------

  async leave(forget = true): Promise<void> {
    const wasHost = this.role() === 'host';
    if (this.link) {
      this.send({ t: 'bye' });
      this.link.close();
      this.link = null;
    }
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.joinTimer) clearTimeout(this.joinTimer);
    this.heartbeat = null;
    this.joinTimer = null;
    if (wasHost && !this.devRelay) await this.relay.stop().catch(() => undefined);
    if (forget && !wasHost) this.saved.set(null);
    this.phase.set('idle');
    this.role.set(null);
    this.roomCode.set(null);
    this.pin.set(null);
    this.roomId.set(null);
    this.partnerName.set(null);
    this.partnerOnline.set(false);
    this.linkStatus.set('closed');
    this.failedAttempts.set(0);
    this.activeLevel.set(null);
    this.results.set([]);
    this.error.set(null);
    this.url = null;
    this.key = null;
    this.hostAddress = null;
  }

  /** What this phone's game page needs to join in, for the level that is starting. */
  netConfig(): NetConfig | null {
    const role = this.role();
    const me = this.me();
    if (!role || !me || !this.url || !this.key) return null;
    return { role, url: this.url, key: this.key, room: this.roomId() ?? '', me };
  }

  /** Called every few seconds while hosting: the address can change with the network. */
  refreshAddress(): void {
    if (this.role() !== 'host' || this.devRelay) return;
    const address = this.relay.localAddress();
    if (address !== this.hostAddress) {
      this.hostAddress = address;
      this.updateCode();
    }
  }

  private startGuest(url: string, auth: RoomAuth, display: string | null): void {
    this.role.set('guest');
    this.url = url;
    this.roomCode.set(display);
    this.phase.set('joining');
    if ('key' in auth) this.key = auth.key;
    this.connect(auth);
    // A room that never answers is on another network, or the network keeps phones apart.
    this.joinTimer = setTimeout(() => {
      if (this.phase() === 'joining' && this.linkStatus() !== 'open') this.fail('unreachable');
    }, JOIN_TIMEOUT_MS);
  }

  private connect(auth: RoomAuth): void {
    this.link = new NetLink({
      url: this.url!,
      auth,
      channel: 'lobby',
      onMessage: (m) => this.onMessage(m),
      onStatus: (status, end) => this.onStatus(status, end),
      onPaired: (key, room) => {
        this.key = key;
        this.roomId.set(room);
        this.saved.set({ url: this.url!, key, room, at: Date.now() });
      },
      onRoom: (room) => this.onRoom(room),
    });
    this.lastHeard = 0;
    this.heartbeat = setInterval(() => {
      this.send({ t: 'ping' });
      this.updatePartnerOnline();
    }, 2000);
  }

  private onStatus(status: LinkStatus, end: LinkEnd | null): void {
    this.linkStatus.set(status);
    if (status === 'open') {
      if (this.link?.room) this.roomId.set(this.link.room);
      if (this.role() === 'guest') this.send({ t: 'hello', v: NET_VERSION, name: this.progress.profile().names[this.progress.profile().lead] });
      return;
    }
    if (status === 'closed' && end && end !== 'closed') {
      if (end === 'key' || end === 'roomClosed') this.saved.set(null);
      this.fail(end === 'slow' || end === 'busy' || end === 'malformed' ? 'lost' : end);
    }
  }

  private onRoom(room: RoomState): void {
    if (this.freshRoom) {
      this.freshRoom = false;
      // A relay that outlived an earlier room (the development one does) may still hold that
      // room's partner. Nobody can have paired with this room yet - its PIN was never shown - so
      // the old pairing goes, and the room opens with a fresh PIN.
      if (room.paired) {
        this.link?.control({ t: 'reset' });
        return;
      }
    }
    this.roomId.set(room.room);
    this.pin.set(room.pin);
    this.failedAttempts.set(room.failures);
    this.updateCode();
    this.updatePartnerOnline(room.guests);
    if (!room.paired && this.phase() === 'paired') this.phase.set('waiting');
  }

  private updateCode(): void {
    const pin = this.pin();
    const address = this.hostAddress;
    this.roomCode.set(pin && address ? formatRoomCode(address, pin) : null);
  }

  private guestConnections: number | null = null;
  /** Set when the host opens a room, until the relay's first word on it. */
  private freshRoom = false;

  private updatePartnerOnline(guests?: number): void {
    if (guests !== undefined) this.guestConnections = guests;
    const heard = Date.now() - this.lastHeard < PARTNER_TIMEOUT_MS;
    const online = this.role() === 'host' ? heard && this.guestConnections !== 0 : heard && this.linkStatus() === 'open';
    if (online !== this.partnerOnline()) this.partnerOnline.set(online);
  }

  private onMessage(message: NetMessage): void {
    if (message.ch !== 'lobby') return;
    const m = message as LobbyMessage;
    this.lastHeard = Date.now();
    this.updatePartnerOnline();
    if (this.role() === 'host') {
      if (m.from !== 'guest') return;
      if (m.t === 'hello') {
        if (m.v !== NET_VERSION) {
          this.send({ t: 'reject', reason: 'version' });
          return;
        }
        const me = this.me()!;
        this.send({
          t: 'welcome',
          v: NET_VERSION,
          guestPlays: me === 'wife' ? 'husband' : 'wife',
          names: this.names()!,
          outfits: this.outfits()!,
          level: this.activeLevel(),
          results: this.results(),
        });
        this.phase.set('paired');
        this.partnerOnline.set(true);
      } else if (m.t === 'bye') {
        // The partner left the room on purpose: it opens again for them (or someone else).
        this.reopen();
      }
      return;
    }
    // Guest: everything on this link came from the host (the relay delivers nothing else).
    switch (m.t) {
      case 'welcome': {
        if (this.joinTimer) clearTimeout(this.joinTimer);
        this.me.set(m.guestPlays);
        this.names.set(m.names);
        this.outfits.set(m.outfits);
        this.partnerName.set(m.names[m.guestPlays === 'wife' ? 'husband' : 'wife']);
        this.phase.set('paired');
        this.partnerOnline.set(true);
        // Levels finished while this phone was away are saved now (each once).
        for (const result of m.results) this.progress.recordResult(result);
        this.activeLevel.set(m.level);
        if (m.level && this.nav.current().name !== 'game') this.openLevel(m.level.sceneId);
        break;
      }
      case 'reject':
        this.fail('version');
        break;
      case 'start':
        this.activeLevel.set({ sceneId: m.sceneId, session: m.session });
        this.openLevel(m.sceneId);
        break;
      case 'result':
        this.progress.recordResult(m.result);
        break;
      case 'ended':
        this.activeLevel.set(null);
        if (this.nav.current().name === 'game') this.nav.popTo('coop');
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
    else {
      this.nav.popTo('coop');
      this.nav.push(screen);
    }
  }

  private send(message: Record<string, unknown>): void {
    this.link?.send(message as never);
  }

  private fail(kind: CoopErrorKind): void {
    if (this.joinTimer) clearTimeout(this.joinTimer);
    this.joinTimer = null;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.link?.close();
    this.link = null;
    if (this.role() === 'host' && !this.devRelay) void this.relay.stop().catch(() => undefined);
    this.error.set(kind);
    this.phase.set('error');
  }
}
