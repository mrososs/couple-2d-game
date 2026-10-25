import { parseNet, type NetMessage, type NetRole } from './protocol.ts';

export type LinkStatus = 'connecting' | 'open' | 'closed';

/**
 * A WebSocket to the room's relay that keeps itself connected: it retries with a short backoff
 * until closed on purpose, and drops anything that is not a well-formed message from the other
 * side. Used by the game page (channel `game`) and by the native lobby (channel `lobby`).
 */
export class NetLink {
  private socket: WebSocket | null = null;
  private closed = false;
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  status: LinkStatus = 'connecting';

  constructor(
    private readonly url: string,
    private readonly role: NetRole,
    private readonly channel: NetMessage['ch'],
    private readonly onMessage: (message: NetMessage) => void,
    private readonly onStatus: (status: LinkStatus) => void = () => {},
    /** When set, every message carries it and messages for another room are ignored. */
    private readonly room = '',
    private readonly WebSocketImpl: typeof WebSocket = WebSocket,
  ) {
    this.open();
  }

  get isOpen(): boolean {
    return this.status === 'open';
  }

  send(message: Omit<NetMessage, 'ch' | 'from'> & Record<string, unknown>): boolean {
    if (!this.socket || this.socket.readyState !== 1) return false;
    this.socket.send(JSON.stringify({ ...message, ch: this.channel, from: this.role, ...(this.room ? { room: this.room } : {}) }));
    return true;
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.socket?.close();
    this.socket = null;
    this.setStatus('closed');
  }

  private open(): void {
    if (this.closed) return;
    this.setStatus('connecting');
    let socket: WebSocket;
    try {
      socket = new this.WebSocketImpl(this.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      this.retry = 0;
      this.setStatus('open');
    };
    socket.onmessage = (event: MessageEvent) => {
      const message = parseNet(event.data);
      if (!message || message.ch !== this.channel || message.from === this.role) return;
      if (this.room && (message as { room?: string }).room !== this.room) return;
      this.onMessage(message);
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.scheduleRetry();
    };
    socket.onerror = () => socket.close();
  }

  private scheduleRetry(): void {
    if (this.closed) return;
    this.setStatus('connecting');
    const delay = Math.min(3000, 400 * 2 ** this.retry++);
    this.timer = setTimeout(() => this.open(), delay);
  }

  private setStatus(status: LinkStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.onStatus(status);
  }
}
