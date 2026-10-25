/**
 * Drives the game inside the Android app's web view over the Chrome DevTools protocol: finds the
 * web view's DevTools socket through adb, injects playthroughs.js, and plays a level. The level's
 * `complete` event then travels the real bridge into the NG Native app, which saves it.
 *
 *   node scripts/e2e/device.mjs level01
 *   node scripts/e2e/device.mjs eval "document.fonts.size"
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [mode, arg] = process.argv.slice(2);
const PORT = 9333;

const sockets = execSync('adb shell cat /proc/net/unix').toString().match(/@webview_devtools_remote_\d+/g) ?? [];
if (!sockets.length) throw new Error('No web view DevTools socket: is the game screen open in a debug build?');
const socket = sockets.at(-1).slice(1);
execSync(`adb forward tcp:${PORT} localabstract:${socket}`);

const pages = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = pages.find((p) => p.type === 'page') ?? pages[0];
if (!page) throw new Error('The web view has no page');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((ok, fail) => {
  ws.onopen = ok;
  ws.onerror = fail;
});
let id = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
const evaluate = (expression) =>
  new Promise((ok) => {
    const n = ++id;
    pending.set(n, ok);
    ws.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });

const show = (msg) => {
  if (msg.result?.exceptionDetails) console.error('page error:', msg.result.exceptionDetails.exception?.description ?? msg.result.exceptionDetails.text);
  else console.log(JSON.stringify(msg.result?.result?.value, null, 1));
};

console.log(`web view page: ${page.url}`);
if (mode === 'eval') {
  show(await evaluate(arg));
} else {
  await evaluate(readFileSync(resolve(here, 'playthroughs.js'), 'utf8'));
  show(await evaluate(`window.__bwbtPlay(${JSON.stringify(mode)})`));
}
ws.close();
execSync(`adb forward --remove tcp:${PORT}`);
