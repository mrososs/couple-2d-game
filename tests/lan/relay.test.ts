import { afterEach, describe, expect, test } from 'vitest';
import { WebSocket as WsClient } from 'ws';
import { startRelay, type RelayOptions, type RunningRelay } from '../../scripts/lan-relay.ts';
import { NetLink, type LinkEnd, type LinkStatus } from '../../src/game/net/link.ts';
import type { NetMessage } from '../../src/game/net/protocol.ts';
import { CLOSE, ROOM_VERSION } from '../../src/game/net/room.ts';

/**
 * The room protocol (src/game/net/room.ts) against the development relay, which follows the same
 * rules as the phone's native relay. Every connection here comes from this machine; a query
 * parameter (?as=...) lets a test stand in for a phone elsewhere on the network.
 */

let relay: RunningRelay | null = null;
const sockets: WsClient[] = [];
const links: NetLink[] = [];

afterEach(async () => {
  for (const l of links.splice(0)) l.close();
  for (const s of sockets.splice(0)) s.terminate();
  await relay?.close();
  relay = null;
});

async function start(options: RelayOptions = {}): Promise<RunningRelay> {
  relay = await startRelay({
    port: 0,
    host: '127.0.0.1',
    peerAddress: (_socket, request) => new URL(request.url ?? '/', 'http://x').searchParams.get('as') ?? request.socket.remoteAddress ?? '',
    ...options,
    limits: { pinSpacingMs: 0, ...options.limits },
  });
  return relay;
}

interface Client {
  readonly socket: WsClient;
  readonly frames: Record<string, unknown>[];
  readonly closed: Promise<number>;
  send(frame: unknown): void;
  next(predicate?: (f: Record<string, unknown>) => boolean, ms?: number): Promise<Record<string, unknown>>;
}

function connect(path = '/bwbt', as?: string): Promise<Client> {
  const url = `ws://127.0.0.1:${relay!.port}${path}${as ? `?as=${as}` : ''}`;
  const socket = new WsClient(url);
  sockets.push(socket);
  const frames: Record<string, unknown>[] = [];
  const waiters: { predicate: (f: Record<string, unknown>) => boolean; resolve: (f: Record<string, unknown>) => void }[] = [];
  let seen = 0;
  socket.on('message', (data) => {
    const frame = JSON.parse(data.toString());
    frames.push(frame);
    for (const w of [...waiters]) {
      if (w.predicate(frame)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(frame);
      }
    }
  });
  const closed = new Promise<number>((resolve) => socket.on('close', (code) => resolve(code)));
  return new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.once('open', () =>
      resolve({
        socket,
        frames,
        closed,
        send: (frame) => socket.send(typeof frame === 'string' ? frame : JSON.stringify(frame)),
        next: (predicate = () => true, ms = 2000) => {
          const found = frames.slice(seen).find(predicate);
          if (found) {
            seen = frames.indexOf(found) + 1;
            return Promise.resolve(found);
          }
          return new Promise((ok, fail) => {
            const timer = setTimeout(() => fail(new Error('no matching frame')), ms);
            waiters.push({
              predicate,
              resolve: (f) => {
                clearTimeout(timer);
                seen = frames.length;
                ok(f);
              },
            });
          });
        },
      }),
    );
  });
}

const auth = (fields: Record<string, unknown>) => ({ t: 'auth', v: ROOM_VERSION, ...fields });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function hostOf(r: RunningRelay): Promise<Client> {
  const host = await connect();
  host.send(auth({ role: 'host', key: r.hostKey }));
  await host.next((f) => f.t === 'authed');
  return host;
}

async function pairGuest(r: RunningRelay, as = '192.168.1.40'): Promise<{ guest: Client; key: string }> {
  const guest = await connect('/bwbt', as);
  guest.send(auth({ role: 'guest', pin: r.pin() }));
  const authed = await guest.next((f) => f.t === 'authed');
  return { guest, key: authed.key as string };
}

describe('getting into a room', () => {
  test("the host's app gets in with the host key from this phone, and learns the PIN", async () => {
    const r = await start();
    const host = await connect();
    host.send(auth({ role: 'host', key: r.hostKey }));
    expect(await host.next((f) => f.t === 'authed')).toMatchObject({ ch: 'ctl', role: 'host', room: r.room });
    const room = await host.next((f) => f.t === 'room');
    expect(room).toMatchObject({ paired: false, guests: 0, failures: 0 });
    expect(room.pin).toMatch(/^\d{6}$/);
  });

  test('the host key is refused from another device, and a wrong key from anywhere', async () => {
    const r = await start();
    const remote = await connect('/bwbt', '192.168.1.40');
    remote.send(auth({ role: 'host', key: r.hostKey }));
    expect(await remote.next()).toMatchObject({ t: 'denied', reason: 'forbidden' });
    expect(await remote.closed).toBe(CLOSE.forbidden);
    const wrong = await connect();
    wrong.send(auth({ role: 'host', key: 'x'.repeat(32) }));
    expect(await wrong.closed).toBe(CLOSE.forbidden);
  });

  test('the partner pairs once with the PIN and gets a key; the PIN is then spent', async () => {
    const r = await start();
    const host = await hostOf(r);
    const { key } = await pairGuest(r);
    expect(key).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(await host.next((f) => f.t === 'room' && f.paired === true)).toMatchObject({ pin: null, guests: 1 });
    // The same PIN on a third phone: the room is taken.
    const third = await connect('/bwbt', '192.168.1.77');
    third.send(auth({ role: 'guest', pin: '000000' }));
    expect(await third.next()).toMatchObject({ t: 'denied', reason: 'full' });
    expect(await third.closed).toBe(CLOSE.full);
  });

  test('a wrong PIN is refused, counted for the host, and five of them replace the PIN', async () => {
    const r = await start();
    const host = await hostOf(r);
    const first = r.pin()!;
    const wrong = first === '111111' ? '222222' : '111111';
    for (let i = 1; i <= 5; i++) {
      const g = await connect('/bwbt', '192.168.1.66');
      g.send(auth({ role: 'guest', pin: wrong }));
      expect(await g.next()).toMatchObject({ t: 'denied', reason: 'pin' });
      expect(await g.closed).toBe(CLOSE.wrongPin);
    }
    const room = await host.next((f) => f.t === 'room' && f.failures === 5);
    expect(room.pin).not.toBe(first);
    expect(r.pin()).toBe(room.pin);
  });

  test('PIN attempts are spaced out, so guessing one is slow', async () => {
    const r = await start({ limits: { pinSpacingMs: 500 } });
    const a = await connect('/bwbt', '192.168.1.66');
    a.send(auth({ role: 'guest', pin: '000001' }));
    await a.next();
    const b = await connect('/bwbt', '192.168.1.66');
    b.send(auth({ role: 'guest', pin: r.pin() }));
    expect(await b.next()).toMatchObject({ t: 'denied', reason: 'slow' });
    expect(await b.closed).toBe(CLOSE.slowDown);
  });

  test('a stale key, a wrong version, a wrong path and junk are all refused', async () => {
    const r = await start();
    const g = await connect('/bwbt', '192.168.1.40');
    g.send(auth({ role: 'guest', key: 'k'.repeat(32) }));
    expect(await g.closed).toBe(CLOSE.badKey);
    const old = await connect();
    old.send({ t: 'auth', v: 1, role: 'guest', pin: r.pin() });
    expect(await old.closed).toBe(CLOSE.version);
    const elsewhere = await connect('/');
    expect(await elsewhere.closed).toBe(CLOSE.forbidden);
    const junk = await connect();
    junk.send('hello?');
    expect(await junk.closed).toBe(CLOSE.badAuth);
  });

  test('a connection that never authenticates is closed, and only a few may wait at once', async () => {
    await start({ limits: { authTimeoutMs: 150, maxPending: 2 } });
    const a = await connect();
    const b = await connect();
    const c = await connect();
    expect(await c.closed).toBe(CLOSE.busy);
    expect(await a.closed).toBe(CLOSE.authTimeout);
    expect(await b.closed).toBe(CLOSE.authTimeout);
  });

  test('addresses beyond the local network are refused outright', async () => {
    await start();
    const outsider = await connect('/bwbt', '8.8.8.8');
    expect(await outsider.closed).toBe(CLOSE.forbidden);
  });
});

describe('inside the room', () => {
  test('frames flow host to partner and back; the relay stamps the sender', async () => {
    const r = await start();
    const host = await hostOf(r);
    const { guest } = await pairGuest(r);
    host.send({ ch: 'game', from: 'host', t: 'snap', s: { n: 1 } });
    expect(await guest.next((f) => f.t === 'snap')).toMatchObject({ from: 'host' });
    // The partner claims to be the host: the relay says otherwise.
    guest.send({ ch: 'game', from: 'host', t: 'complete', result: { stars: 3 } });
    expect(await host.next((f) => f.t === 'complete')).toMatchObject({ from: 'guest' });
  });

  test("the partner cannot send control frames, and hears none of its own or anyone else's", async () => {
    const r = await start();
    const host = await hostOf(r);
    const { guest, key } = await pairGuest(r);
    const second = await connect('/bwbt', '192.168.1.40');
    second.send(auth({ role: 'guest', key }));
    await second.next((f) => f.t === 'authed');
    guest.send({ ch: 'ctl', t: 'reset' });
    guest.send({ ch: 'lobby', t: 'ping' });
    await host.next((f) => f.t === 'ping');
    await sleep(100);
    // No reset happened (the PIN is still spent), and the partner's other connection heard nothing.
    expect(r.pin()).toBeNull();
    expect(second.frames.filter((f) => f.ch !== 'ctl')).toEqual([]);
    expect(host.frames.some((f) => f.t === 'reset')).toBe(false);
  });

  test('oversized, malformed and flooding frames from the partner are dropped, then the connection closed', async () => {
    const r = await start({ limits: { guestBurst: 5, guestRatePerSec: 1, maxViolations: 8 } });
    const host = await hostOf(r);
    const { guest } = await pairGuest(r);
    guest.send({ ch: 'game', t: 'in', pad: 'x'.repeat(5000) });
    guest.send('{not json');
    guest.send([1, 2, 3]);
    for (let i = 0; i < 10; i++) guest.send({ ch: 'game', t: 'in', i });
    expect(await guest.closed).toBe(CLOSE.abuse);
    const delivered = host.frames.filter((f) => f.t === 'in');
    expect(delivered.length).toBeLessThanOrEqual(5);
    expect(delivered.every((f) => typeof f.i === 'number')).toBe(true);
  });

  test("the host's reset revokes the partner's key and shows a new PIN", async () => {
    const r = await start();
    const host = await hostOf(r);
    const { guest, key } = await pairGuest(r);
    host.send({ ch: 'ctl', t: 'reset' });
    expect(await guest.closed).toBe(CLOSE.badKey);
    const room = await host.next((f) => f.t === 'room' && f.paired === false);
    expect(room.pin).toMatch(/^\d{6}$/);
    const back = await connect('/bwbt', '192.168.1.40');
    back.send(auth({ role: 'guest', key }));
    expect(await back.closed).toBe(CLOSE.badKey);
  });

  test('closing the room tells everyone, with the code that means "do not retry"', async () => {
    const r = await start();
    await hostOf(r);
    const { guest } = await pairGuest(r);
    await r.close();
    relay = null;
    expect(await guest.closed).toBe(CLOSE.roomClosed);
  });

  test('joining and leaving many times leaves nothing behind', async () => {
    const r = await start();
    await hostOf(r);
    const { guest, key } = await pairGuest(r);
    guest.socket.close();
    for (let i = 0; i < 30; i++) {
      const g = await connect('/bwbt', '192.168.1.40');
      g.send(auth({ role: 'guest', key }));
      await g.next((f) => f.t === 'authed');
      g.socket.close();
      await g.closed;
    }
    await sleep(50);
    expect(r.stats()).toMatchObject({ hosts: 1, guests: 0, pending: 0 });
  });
});

describe('NetLink against the relay', () => {
  function link(r: RunningRelay, options: Partial<ConstructorParameters<typeof NetLink>[0]> & Pick<ConstructorParameters<typeof NetLink>[0], 'auth'>) {
    const events: { status: LinkStatus; end: LinkEnd | null }[] = [];
    const messages: NetMessage[] = [];
    const l = new NetLink({
      url: `ws://127.0.0.1:${r.port}/bwbt`,
      channel: 'game',
      onMessage: (m) => messages.push(m),
      onStatus: (status, end) => events.push({ status, end }),
      ...options,
    });
    links.push(l);
    return { l, events, messages };
  }
  const until = async (check: () => boolean, ms = 3000) => {
    const end = Date.now() + ms;
    while (!check()) {
      if (Date.now() > end) throw new Error('timed out');
      await sleep(20);
    }
  };

  test('pairs with the PIN, then keeps the key for reconnecting', async () => {
    const r = await start();
    const host = link(r, { auth: { role: 'host', key: r.hostKey } });
    let key = '';
    const guest = link(r, { auth: { role: 'guest', pin: r.pin()! }, onPaired: (k) => (key = k) });
    await until(() => guest.l.isOpen && host.l.isOpen);
    expect(key).toMatch(/^[A-Za-z0-9_-]{32}$/);
    guest.l.send({ t: 'join' });
    await until(() => host.messages.some((m) => m.t === 'join'));
    expect(host.messages[0]).toMatchObject({ ch: 'game', from: 'guest', t: 'join' });

    // The network blinks. The PIN is spent, so getting back in proves the key is used.
    r.drop('guest');
    await until(() => guest.events.some((e) => e.status === 'connecting'));
    await until(() => guest.l.isOpen);
    guest.l.send({ t: 'req', k: 'pause' });
    await until(() => host.messages.some((m) => m.t === 'req'));
    expect(r.pin()).toBeNull();
  });

  test('a wrong PIN ends the link for good instead of retrying', async () => {
    const r = await start();
    const wrong = r.pin() === '123456' ? '654321' : '123456';
    const guest = link(r, { auth: { role: 'guest', pin: wrong } });
    await until(() => guest.l.status === 'closed');
    expect(guest.l.end).toBe('pin');
    await sleep(800);
    expect(guest.events.filter((e) => e.status === 'connecting').length).toBe(0);
  });

  test('a second connection of the partner (the game page) uses the key; closing the room ends both', async () => {
    const r = await start();
    let key = '';
    const lobby = link(r, { auth: { role: 'guest', pin: r.pin()! }, channel: 'lobby', onPaired: (k) => (key = k) });
    await until(() => lobby.l.isOpen);
    const game = link(r, { auth: { role: 'guest', key } });
    await until(() => game.l.isOpen);
    expect(r.stats().guests).toBe(2);
    await r.close();
    relay = null;
    await until(() => game.l.status === 'closed' && lobby.l.status === 'closed');
    expect(game.l.end).toBe('roomClosed');
    expect(lobby.l.end).toBe('roomClosed');
  });

  test('never connects to an address beyond the local network', async () => {
    const outside = new NetLink({ url: 'ws://93.184.216.34:7777/bwbt', auth: { role: 'guest', pin: '123456' }, channel: 'game', onMessage: () => {} });
    expect(outside.status).toBe('closed');
    expect(outside.end).toBe('forbidden');
  });
});
