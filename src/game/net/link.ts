import { asNetMessage, type NetMessage } from './protocol.ts';
import {
  authFrame,
  isLocalNetworkAddress,
  TERMINAL_CLOSE_CODES,
  TERMINAL_DENIALS,
  type ControlFrame,
  type DenyReason,
  type RoomAuth,
} from './room.ts';

export type LinkStatus = 'connecting' | 'open' | 'closed';

/** Why a link closed for good: refused by the room, the room closed, or closed on purpose. */
export type LinkEnd = DenyReason | 'roomClosed' | 'closed';

export type RoomState = Extract<ControlFrame, { t: 'room' }>;

export interface NetLinkOptions {
  /** ws://address:port/bwbt of the host phone's relay. */
  readonly url: string;
  readonly auth: RoomAuth;
  readonly channel: 'lobby' | 'game';
  readonly onMessage: (message: NetMessage) => void;
  readonly onStatus?: (status: LinkStatus, end: LinkEnd | null) => void;
  /** The partner paired with the PIN: their key, for every later connection. */
  readonly onPaired?: (key: string, room: string) => void;
  /** Host only: the room's PIN, pairing and partner connections, whenever they change. */
  readonly onRoom?: (state: RoomState) => void;
  readonly WebSocketImpl?: typeof WebSocket;
}

/**
 * A WebSocket to the room's relay that keeps itself in the room. It authenticates first (the room
 * protocol, room.ts), reconnects with a short backoff while the network comes and goes, and stops
 * for good when the room refuses it or closes - retrying a wrong PIN or a revoked key cannot help.
 * Messages from a socket it has already replaced are ignored, so a late frame never jumps a newer one.
 */
export class NetLink {
  private socket: WebSocket | null = null;
  private auth: RoomAuth;
  private finished = false;
  private authed = false;
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private denied: DenyReason | null = null;
  status: LinkStatus = 'connecting';
  end: LinkEnd | null = null;
  room: string | null = null;
  /** When the link was last open, for "trying to reconnect for how long" messages. */
  lostAt: number | null = null;

  constructor(private readonly options: NetLinkOptions) {
    this.auth = options.auth;
    if (!isLocalUrl(options.url)) {
      this.stop('forbidden');
      return;
    }
    this.open();
  }

  get isOpen(): boolean {
    return this.status === 'open';
  }

  /** Sends on this link's channel: the characters sent, or 0 while not in the room. */
  send(message: Omit<NetMessage, 'ch' | 'from'> & Record<string, unknown>): number {
    if (!this.socket || this.socket.readyState !== 1 || !this.authed) return 0;
    const text = JSON.stringify({ ...message, ch: this.options.channel, from: this.auth.role });
    this.socket.send(text);
    return text.length;
  }

  /** Host only: a control frame for the relay itself (`reset`). */
  control(frame: Record<string, unknown>): boolean {
    if (!this.socket || this.socket.readyState !== 1 || !this.authed) return false;
    this.socket.send(JSON.stringify({ ...frame, ch: 'ctl' }));
    return true;
  }

  close(): void {
    this.stop('closed');
  }

  private stop(end: LinkEnd): void {
    if (this.finished) return;
    this.finished = true;
    this.end = end;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.setStatus('closed');
  }

  private open(): void {
    if (this.finished) return;
    this.setStatus('connecting');
    this.authed = false;
    this.denied = null;
    let socket: WebSocket;
    try {
      socket = new (this.options.WebSocketImpl ?? WebSocket)(this.options.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      socket.send(JSON.stringify(authFrame(this.auth)));
    };
    socket.onmessage = (event: MessageEvent) => {
      if (this.socket !== socket || typeof event.data !== 'string') return;
      let value: unknown;
      try {
        value = JSON.parse(event.data);
      } catch {
        return;
      }
      if ((value as { ch?: unknown } | null)?.ch === 'ctl') {
        this.onControl(value as ControlFrame);
        return;
      }
      if (!this.authed) return;
      const message = asNetMessage(value);
      if (!message || message.ch !== this.options.channel || message.from === this.auth.role) return;
      this.options.onMessage(message);
    };
    socket.onclose = (event: CloseEvent) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.authed = false;
      if (this.status === 'open') this.lostAt = Date.now();
      if (event.code === 4000) return this.stop('roomClosed');
      if (this.denied && TERMINAL_DENIALS.has(this.denied)) return this.stop(this.denied);
      if (TERMINAL_CLOSE_CODES.has(event.code)) return this.stop(endForCode(event.code));
      this.scheduleRetry();
    };
    socket.onerror = () => socket.close();
  }

  private onControl(frame: ControlFrame): void {
    switch (frame.t) {
      case 'authed':
        this.authed = true;
        this.retry = 0;
        this.room = frame.room;
        if (frame.key) {
          // Paired with the PIN, which is now spent: from here on this link uses the key.
          this.auth = { role: 'guest', key: frame.key };
          this.options.onPaired?.(frame.key, frame.room);
        }
        this.lostAt = null;
        this.setStatus('open');
        break;
      case 'denied':
        this.denied = frame.reason;
        break;
      case 'room':
        this.options.onRoom?.(frame);
        break;
    }
  }

  private scheduleRetry(): void {
    if (this.finished) return;
    this.setStatus('connecting');
    const delay = this.denied === 'slow' ? 1200 : Math.min(3000, 300 * 2 ** this.retry++);
    this.timer = setTimeout(() => this.open(), delay);
  }

  private setStatus(status: LinkStatus): void {
    if (this.status === status && status !== 'closed') return;
    this.status = status;
    this.options.onStatus?.(status, status === 'closed' ? this.end : null);
  }
}

function endForCode(code: number): LinkEnd {
  switch (code) {
    case 4401:
      return 'pin';
    case 4409:
      return 'full';
    case 4410:
      return 'key';
    case 4426:
      return 'version';
    default:
      return 'forbidden';
  }
}

/** Plain ws:// is only ever used inside the local network: never to an address beyond it. */
export function isLocalUrl(url: string): boolean {
  const match = /^ws:\/\/(\[[^\]]+\]|[^/:]+)(?::\d+)?\//.exec(url);
  if (!match) return false;
  return isLocalNetworkAddress(match[1].replace(/^\[|\]$/g, ''));
}
