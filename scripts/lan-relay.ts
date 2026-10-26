/**
 * The room relay for development and tests: the same rules as the host phone's native relay
 * (modules/lan-relay, Kotlin), on Node, so two browser tabs - or a test - can play the room
 * protocol in src/game/net/room.ts without a phone. The Android app does not use this.
 *
 *   npm run relay                      listens on ws://0.0.0.0:7777/bwbt, prints the room PIN
 *   PORT=7788 HOST_KEY=... npm run relay
 *
 * The host key below is for development only: the browser host knows it (src/main.web.ts). On a
 * phone the native relay makes a random one each time a room opens.
 */
import { randomBytes, randomInt } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { pathToFileURL } from 'node:url';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import {
  CLOSE,
  DENY_CLOSE,
  isLocalNetworkAddress,
  isLoopbackAddress,
  parseAuth,
  PIN_DIGITS,
  ROOM_LIMITS,
  ROOM_PATH,
  ROOM_VERSION,
  sameSecret,
  type DenyReason,
  type RoomRole,
} from '../src/game/net/room.ts';

export const DEV_HOST_KEY = 'bwbt-development-host-key';

export interface RelayOptions {
  readonly port?: number;
  readonly host?: string;
  readonly hostKey?: string;
  /** Overrides the limits, for tests that need them small. */
  readonly limits?: Partial<Record<keyof typeof ROOM_LIMITS, number>>;
  /** Treats every peer as this address (tests: a "phone on the network" from localhost). */
  readonly peerAddress?: (socket: WebSocket, request: IncomingMessage) => string;
  readonly log?: (line: string) => void;
}

export interface RunningRelay {
  readonly port: number;
  readonly hostKey: string;
  readonly room: string;
  pin(): string | null;
  stats(): { readonly hosts: number; readonly guests: number; readonly pending: number; readonly relayed: number; readonly bytes: number };
  /** Cuts one role's connections without a word, as a Wi-Fi blink would (tests, development). */
  drop(role: RoomRole): void;
  close(): Promise<void>;
}

interface Connection {
  readonly socket: WebSocket;
  readonly address: string;
  role: RoomRole | null;
  tokens: number;
  refilledAt: number;
  violations: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const newPin = () => String(randomInt(0, 10 ** PIN_DIGITS)).padStart(PIN_DIGITS, '0');
const newKey = () => randomBytes(24).toString('base64url');

export function startRelay(options: RelayOptions = {}): Promise<RunningRelay> {
  const limits: Record<keyof typeof ROOM_LIMITS, number> = { ...ROOM_LIMITS, ...options.limits };
  const hostKey = options.hostKey ?? newKey();
  const room = randomBytes(8).toString('hex');
  const log = options.log ?? (() => {});
  const connections = new Set<Connection>();
  let pin: string | null = newPin();
  let guestKey: string | null = null;
  let pinFailures = 0;
  let failedAttempts = 0;
  let lastPinCheck = Number.NEGATIVE_INFINITY;
  let relayed = 0;
  let bytes = 0;

  const server = new WebSocketServer({ port: options.port ?? 0, host: options.host ?? '0.0.0.0', maxPayload: limits.hostMaxBytes });
  const byRole = (role: RoomRole) => [...connections].filter((c) => c.role === role && c.socket.readyState === 1);

  const sendCtl = (c: Connection, frame: Record<string, unknown>) => c.socket.send(JSON.stringify({ ch: 'ctl', ...frame }));
  const roomState = () => ({ t: 'room', room, pin, paired: guestKey !== null, guests: byRole('guest').length, failures: failedAttempts });
  const notifyHosts = () => {
    for (const h of byRole('host')) sendCtl(h, roomState());
  };

  const deny = (c: Connection, reason: DenyReason) => {
    log(`denied ${c.address}: ${reason}`);
    if (c.socket.readyState === 1) sendCtl(c, { t: 'denied', reason });
    c.socket.close(DENY_CLOSE[reason], reason);
  };

  /** At most `maxPerRole` connections per role: a new one replaces the oldest (a stale page). */
  const admit = (c: Connection, role: RoomRole, extra: Record<string, unknown> = {}) => {
    const existing = byRole(role);
    if (existing.length >= limits.maxPerRole) existing[0].socket.close(CLOSE.busy, 'replaced');
    c.role = role;
    if (c.timer) clearTimeout(c.timer);
    c.timer = null;
    sendCtl(c, { t: 'authed', role, room, ...extra });
    log(`+ ${role} ${c.address}`);
    notifyHosts();
  };

  const authenticate = (c: Connection, text: string) => {
    const auth = parseAuth(text);
    if (!auth) return deny(c, 'malformed');
    if (auth.v !== ROOM_VERSION) return deny(c, 'version');
    if (auth.role === 'host') {
      if (!isLoopbackAddress(c.address) || !auth.key || !sameSecret(auth.key, hostKey)) return deny(c, 'forbidden');
      return admit(c, 'host');
    }
    if (auth.key) {
      if (!guestKey || !sameSecret(auth.key, guestKey)) return deny(c, 'key');
      return admit(c, 'guest');
    }
    if (guestKey) return deny(c, 'full');
    const now = Date.now();
    if (now - lastPinCheck < limits.pinSpacingMs) return deny(c, 'slow');
    lastPinCheck = now;
    if (!pin || !auth.pin || !sameSecret(auth.pin, pin)) {
      failedAttempts++;
      if (++pinFailures >= limits.maxPinFailures) {
        pin = newPin();
        pinFailures = 0;
        log(`PIN replaced after repeated failures: ${pin}`);
      }
      notifyHosts();
      return deny(c, 'pin');
    }
    guestKey = newKey();
    pin = null;
    pinFailures = 0;
    admit(c, 'guest', { key: guestKey });
  };

  const violation = (c: Connection) => {
    if (++c.violations >= limits.maxViolations) c.socket.close(CLOSE.abuse, 'abuse');
  };

  /** Control frames from the host are short; anything else is for the partner. */
  const hostControl = (text: string): { t?: unknown } | null => {
    if (text.length > 128 || !text.includes('"ctl"')) return null;
    try {
      const frame = JSON.parse(text);
      return frame?.ch === 'ctl' ? frame : null;
    } catch {
      return null;
    }
  };

  const fromHost = (text: string) => {
    const control = hostControl(text);
    if (control) {
      if (control.t === 'reset') {
        guestKey = null;
        pin = newPin();
        pinFailures = 0;
        failedAttempts = 0;
        for (const g of byRole('guest')) g.socket.close(CLOSE.badKey, 'reset');
        log(`room reset, new PIN ${pin}`);
        setTimeout(notifyHosts, 0);
      }
      return;
    }
    for (const g of byRole('guest')) {
      g.socket.send(text);
      relayed++;
      bytes += text.length;
    }
  };

  const fromGuest = (c: Connection, text: string) => {
    const now = Date.now();
    c.tokens = Math.min(limits.guestBurst, c.tokens + ((now - c.refilledAt) / 1000) * limits.guestRatePerSec);
    c.refilledAt = now;
    if (c.tokens < 1 || text.length > limits.guestMaxBytes) return violation(c);
    c.tokens -= 1;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(text);
    } catch {
      return violation(c);
    }
    if (!message || typeof message !== 'object' || Array.isArray(message) || (message.ch !== 'lobby' && message.ch !== 'game')) return violation(c);
    const stamped = JSON.stringify({ ...message, from: 'guest' });
    for (const h of byRole('host')) {
      h.socket.send(stamped);
      relayed++;
      bytes += stamped.length;
    }
  };

  server.on('connection', (socket, request) => {
    const address = options.peerAddress?.(socket, request) ?? request.socket.remoteAddress ?? '';
    const c: Connection = { socket, address, role: null, tokens: limits.guestBurst, refilledAt: Date.now(), violations: 0, timer: null };
    if (!(request.url ?? '').startsWith(ROOM_PATH) || !isLocalNetworkAddress(address)) {
      socket.close(CLOSE.forbidden, 'forbidden');
      return;
    }
    if ([...connections].filter((x) => x.role === null).length >= limits.maxPending) {
      socket.close(CLOSE.busy, 'busy');
      return;
    }
    connections.add(c);
    c.timer = setTimeout(() => socket.close(CLOSE.authTimeout, 'auth timeout'), limits.authTimeoutMs);
    socket.on('message', (data: RawData, isBinary: boolean) => {
      if (isBinary) return violation(c);
      const text = data.toString();
      if (c.role === null) authenticate(c, text);
      else if (c.role === 'host') fromHost(text);
      else fromGuest(c, text);
    });
    socket.on('close', () => {
      if (c.timer) clearTimeout(c.timer);
      connections.delete(c);
      if (c.role) {
        log(`- ${c.role} ${c.address}`);
        notifyHosts();
      }
    });
    socket.on('error', () => socket.close());
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('listening', () => {
      const address = server.address();
      resolve({
        port: typeof address === 'object' && address ? address.port : 0,
        hostKey,
        room,
        pin: () => pin,
        stats: () => ({ hosts: byRole('host').length, guests: byRole('guest').length, pending: [...connections].filter((c) => c.role === null).length, relayed, bytes }),
        drop: (role) => {
          for (const c of byRole(role)) c.socket.terminate();
        },
        close: () =>
          new Promise<void>((done) => {
            for (const c of connections) c.socket.close(CLOSE.roomClosed, 'room closed');
            server.close(() => done());
          }),
      });
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const relay = await startRelay({
    port: Number(process.env.PORT ?? 7777),
    hostKey: process.env.HOST_KEY ?? DEV_HOST_KEY,
    log: (line) => console.log(line),
  });
  console.log(`room relay on ws://0.0.0.0:${relay.port}${ROOM_PATH} - PIN ${relay.pin()}`);
  setInterval(() => {
    const s = relay.stats();
    if (s.hosts || s.guests) console.log(`hosts ${s.hosts} guests ${s.guests} relayed ${s.relayed} (${Math.round(s.bytes / 1024)} KB) PIN ${relay.pin() ?? 'used'}`);
  }, 10000);
}
