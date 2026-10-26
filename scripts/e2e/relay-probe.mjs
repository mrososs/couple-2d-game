/**
 * Probes a running room relay - in particular the native one on an Android host, reached through
 * `adb forward tcp:7777 tcp:7777` - with the room protocol's rules (src/game/net/room.ts), from the
 * point of view of other phones on the network. tests/lan/relay.test.ts runs the same rules
 * against the development relay; this checks the Kotlin implementation on a device.
 *
 *   node scripts/e2e/relay-probe.mjs before ws://127.0.0.1:7777/bwbt <pin>
 *     (before the partner pairs: refusals, two wrong PINs)
 *   node scripts/e2e/relay-probe.mjs after ws://127.0.0.1:7777/bwbt <pin> <guest key>
 *     (after the partner paired with <pin>: the spent PIN, keys, abuse limits)
 */
import { WebSocket } from 'ws';

const [phase, url, pin, key] = process.argv.slice(2);
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

/** Opens a connection, sends `frames`, collects what comes back until it closes or `ms` pass. */
function session(target, frames, ms = 2500, onOpen) {
  return new Promise((resolve) => {
    const socket = new WebSocket(target);
    const got = [];
    let code = null;
    const timer = setTimeout(() => {
      socket.terminate();
      resolve({ got, code });
    }, ms);
    socket.on('open', () => {
      for (const f of frames) socket.send(typeof f === 'string' ? f : JSON.stringify(f));
      onOpen?.(socket, got);
    });
    socket.on('message', (d) => got.push(JSON.parse(d.toString())));
    socket.on('close', (c) => {
      code = c;
      clearTimeout(timer);
      resolve({ got, code });
    });
    socket.on('error', () => {});
  });
}
const auth = (fields) => ({ t: 'auth', v: 2, ...fields });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wrongPin = pin === '111111' ? '222222' : '111111';

if (phase === 'before') {
  let r = await session(url.replace(/\/bwbt$/, '/other'), []);
  check('a wrong path is refused', r.code === 4403, `close ${r.code}`);
  r = await session(url, ['hello?']);
  check('a first frame that is not an auth frame is refused', r.code === 4002, `close ${r.code}`);
  r = await session(url, [{ t: 'auth', v: 1, role: 'guest', pin }]);
  check('an older protocol version is refused', r.code === 4426, `close ${r.code}`);
  r = await session(url, [auth({ role: 'host', key: 'x'.repeat(32) })]);
  check('a wrong host key is refused', r.code === 4403 && r.got[0]?.reason === 'forbidden', `close ${r.code}`);
  r = await session(url, [], 7000);
  check('a connection that never authenticates is closed after 5 s', r.code === 4001, `close ${r.code}`);
  for (let i = 0; i < 2; i++) {
    await sleep(500);
    r = await session(url, [auth({ role: 'guest', pin: wrongPin })]);
    check(`wrong PIN #${i + 1} is refused`, r.code === 4401 && r.got[0]?.reason === 'pin', `close ${r.code}`);
  }
} else if (phase === 'after') {
  let r = await session(url, [auth({ role: 'guest', pin })]);
  check('the spent PIN gets nobody else in: the room is full', r.code === 4409 && r.got[0]?.reason === 'full', `close ${r.code}`);
  r = await session(url, [auth({ role: 'guest', key: 'k'.repeat(32) })]);
  check('a made-up key is refused', r.code === 4410, `close ${r.code}`);
  r = await session(url, [auth({ role: 'guest', key })], 1500);
  check("the partner's key gets back in (a reconnection)", r.got[0]?.t === 'authed' && r.got[0]?.role === 'guest', JSON.stringify(r.got[0]));
  r = await session(url, [auth({ role: 'host', key })]);
  check("the partner's key is no host key", r.code === 4403, `close ${r.code}`);
  // Control frames from the partner do nothing: the key still works afterwards.
  await session(url, [auth({ role: 'guest', key }), { ch: 'ctl', t: 'reset' }], 1200);
  r = await session(url, [auth({ role: 'guest', key })], 1200);
  check("the partner cannot reset the room", r.got[0]?.t === 'authed');
  // Flooding: well past the burst allowance, then malformed and oversized frames.
  r = await session(url, [auth({ role: 'guest', key })], 6000, (socket) => {
    for (let i = 0; i < 400; i++) socket.send(JSON.stringify({ ch: 'lobby', t: 'ping', i }));
    for (let i = 0; i < 20; i++) socket.send('{broken');
    socket.send(JSON.stringify({ ch: 'game', t: 'in', pad: 'x'.repeat(6000) }));
  });
  check('a flood from the partner closes its connection', r.code === 4008, `close ${r.code}`);
  r = await session(url, [auth({ role: 'guest', key })], 1500);
  check('the partner can come back after that', r.got[0]?.t === 'authed');
} else {
  console.error('usage: relay-probe.mjs before|after <url> <pin> [guest key]');
  process.exit(2);
}
const failed = results.filter((x) => !x.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
