/**
 * Drives the app's native screens on an Android device or emulator through adb: finds a view by
 * its testID (exposed as resource-id) or its text in a UI dump, and taps its centre.
 *
 *   node scripts/e2e/adb-ui.mjs emulator-5554 tap coop-host
 *   node scripts/e2e/adb-ui.mjs emulator-5554 tap "يلا نبدأ"
 *   node scripts/e2e/adb-ui.mjs emulator-5554 text room-pin       (prints the view's text)
 *   node scripts/e2e/adb-ui.mjs emulator-5554 wait coop-paired 30  (waits up to 30 s)
 *   node scripts/e2e/adb-ui.mjs emulator-5554 type "1-482916"
 *   node scripts/e2e/adb-ui.mjs emulator-5554 list                 (ids and texts on screen)
 *   node scripts/e2e/adb-ui.mjs emulator-5554 shot out.png
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const adbPath = join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk', 'platform-tools', 'adb.exe');
const [serial, command, target, extra] = process.argv.slice(2);
const adb = (...args) => execFileSync(adbPath, ['-s', serial, ...args], { maxBuffer: 64 << 20 });

function dump() {
  adb('shell', 'uiautomator', 'dump', '/sdcard/bwbt-ui.xml');
  const xml = adb('shell', 'cat', '/sdcard/bwbt-ui.xml').toString('utf8');
  const nodes = [];
  for (const m of xml.matchAll(/<node [^>]*>/g)) {
    const attr = (name) => (new RegExp(`${name}="([^"]*)"`).exec(m[0]) ?? [])[1] ?? '';
    const b = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(attr('bounds'));
    if (!b) continue;
    const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
    nodes.push({ id: attr('resource-id'), text: decode(attr('text')), desc: decode(attr('content-desc')), x1: +b[1], y1: +b[2], x2: +b[3], y2: +b[4] });
  }
  return nodes;
}

function find(nodes, what) {
  return (
    nodes.find((n) => n.id === what || n.id.endsWith(`/${what}`)) ??
    nodes.find((n) => n.text === what || n.desc === what) ??
    nodes.find((n) => n.text.includes(what) || n.desc.includes(what))
  );
}

/** The text a view shows: its own, or that of the text views inside its bounds. */
function textOf(nodes, node) {
  if (node.text) return node.text;
  return nodes
    .filter((n) => n.text && n.x1 >= node.x1 && n.x2 <= node.x2 && n.y1 >= node.y1 && n.y2 <= node.y2)
    .map((n) => n.text)
    .join(' ');
}

switch (command) {
  case 'tap': {
    const node = find(dump(), target);
    if (!node) throw new Error(`nothing on screen matches "${target}"`);
    adb('shell', 'input', 'tap', String(Math.round((node.x1 + node.x2) / 2)), String(Math.round((node.y1 + node.y2) / 2)));
    console.log(`tapped ${node.id || node.text || node.desc}`);
    break;
  }
  case 'text': {
    const nodes = dump();
    const node = find(nodes, target);
    console.log(node ? textOf(nodes, node) : '');
    break;
  }
  case 'wait': {
    const until = Date.now() + Number(extra ?? 20) * 1000;
    for (;;) {
      const nodes = dump();
      const node = find(nodes, target);
      if (node) {
        console.log(textOf(nodes, node) || 'found');
        break;
      }
      if (Date.now() > until) {
        console.error(`timed out waiting for "${target}"`);
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    break;
  }
  case 'type':
    adb('shell', 'input', 'text', target.replace(/ /g, '%s'));
    break;
  case 'list':
    for (const n of dump()) if (n.id || n.text || n.desc) console.log(`${n.id || '-'} | ${n.text || n.desc}`);
    break;
  case 'shot':
    writeFileSync(target, adb('exec-out', 'screencap', '-p'));
    break;
  default:
    console.error('usage: adb-ui.mjs <serial> tap|text|wait|type|list|shot <target>');
    process.exit(2);
}
