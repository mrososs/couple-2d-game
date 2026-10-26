import { describe, expect, test } from 'vitest';
import { formatRoomCode, parseNet, parseRoomCode, randomId, readInput, relayUrl, toLatinDigits } from './protocol.ts';
import { isLocalNetworkAddress, isLoopbackAddress, parseAuth, sameSecret } from './room.ts';
import { isLocalUrl } from './link.ts';

describe('room codes', () => {
  test('a room code is the last number of the host address and the six-digit PIN', () => {
    expect(formatRoomCode('192.168.1.23', '482916')).toBe('23-482916');
  });

  test('codes parse in the forms people type them', () => {
    expect(parseRoomCode('23-482916')).toEqual({ host: '23', pin: '482916' });
    expect(parseRoomCode(' 23 482916 ')).toEqual({ host: '23', pin: '482916' });
    expect(parseRoomCode('192.168.1.23-482916')).toEqual({ host: '192.168.1.23', pin: '482916' });
    expect(parseRoomCode('10.0.2.2-000123')).toEqual({ host: '10.0.2.2', pin: '000123' });
  });

  test('nonsense, short PINs and impossible addresses are rejected rather than guessed at', () => {
    for (const bad of ['', '23', '23-58', '23-4829167', '0-482916', '255-482916', '300-482916', '1.2.3-482916', 'abc-482916']) {
      expect(parseRoomCode(bad), bad).toBeNull();
    }
  });

  test("a short code completes the guest's own network address; a full one stands alone", () => {
    expect(relayUrl({ host: '23' }, '192.168.1.40')).toBe('ws://192.168.1.23:7777/bwbt');
    expect(relayUrl({ host: '23' }, null)).toBeNull();
    expect(relayUrl({ host: '10.0.2.2' }, null)).toBe('ws://10.0.2.2:7777/bwbt');
  });

  test('Eastern Arabic and Persian digits read as digits', () => {
    expect(toLatinDigits('٢٣-٤٨٢٩١٦')).toBe('23-482916');
    expect(parseRoomCode('۲۳-۴۸۲۹۱۶')).toEqual({ host: '23', pin: '482916' });
  });
});

describe('the room protocol', () => {
  test('auth frames are read strictly', () => {
    expect(parseAuth('{"t":"auth","v":2,"role":"guest","pin":"482916"}')).toMatchObject({ role: 'guest', pin: '482916' });
    expect(parseAuth('{"t":"auth","v":2,"role":"host","key":"abcdefghijklmnop1234"}')).toMatchObject({ role: 'host' });
    // A host needs a key; a PIN is six digits; junk is junk.
    expect(parseAuth('{"t":"auth","v":2,"role":"host","pin":"482916"}')).toBeNull();
    expect(parseAuth('{"t":"auth","v":2,"role":"guest","pin":"4829"}')).toBeNull();
    expect(parseAuth('{"t":"auth","v":2,"role":"admin","key":"abcdefghijklmnop1234"}')).toBeNull();
    expect(parseAuth('not json')).toBeNull();
    expect(parseAuth(`{"t":"auth","v":2,"role":"guest","pin":"482916","x":"${'y'.repeat(600)}"}`)).toBeNull();
  });

  test('only addresses on a local network may reach a room', () => {
    for (const ok of ['127.0.0.1', '::1', '::ffff:192.168.1.5', '10.0.2.2', '172.20.1.1', '192.168.43.1', '169.254.3.3', '100.80.1.1', 'fe80::1']) {
      expect(isLocalNetworkAddress(ok), ok).toBe(true);
    }
    for (const bad of ['8.8.8.8', '172.32.0.1', '2001:4860::8888', '', 'example.com']) expect(isLocalNetworkAddress(bad), bad).toBe(false);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('192.168.1.5')).toBe(false);
  });

  test('plain ws:// links only ever go to the local network', () => {
    expect(isLocalUrl('ws://192.168.1.23:7777/bwbt')).toBe(true);
    expect(isLocalUrl('ws://localhost:7777/bwbt')).toBe(true);
    expect(isLocalUrl('ws://93.184.216.34:7777/bwbt')).toBe(false);
    expect(isLocalUrl('wss://192.168.1.23/bwbt')).toBe(false);
  });

  test('secrets compare without short-cuts', () => {
    expect(sameSecret('482916', '482916')).toBe(true);
    expect(sameSecret('482916', '482917')).toBe(false);
    expect(sameSecret('482916', '48291')).toBe(false);
  });
});

describe('messages', () => {
  test('parseNet accepts well-formed messages from either side and drops the rest', () => {
    expect(parseNet('{"ch":"game","from":"guest","t":"join"}')).toMatchObject({ t: 'join' });
    expect(parseNet('{"ch":"lobby","from":"host","t":"ping"}')).toMatchObject({ t: 'ping' });
    expect(parseNet('{"ch":"ctl","from":"host","t":"room"}')).toBeNull();
    expect(parseNet('{"ch":"game","from":"admin","t":"snap"}')).toBeNull();
    expect(parseNet('{"ch":"game","from":"guest"}')).toBeNull();
    expect(parseNet('not json')).toBeNull();
    expect(parseNet(42)).toBeNull();
  });

  test("the guest's controls are checked: a long stick is clamped, anything malformed is refused", () => {
    const ok = { run: 'r1', ep: 'e1', seq: 3, x: 3, y: 4, ia: 2, ro: 0 };
    expect(readInput(ok)).toEqual({ ...ok, x: 0.6, y: 0.8 });
    expect(readInput({ ...ok, x: Number.NaN })).toBeNull();
    expect(readInput({ ...ok, y: Number.POSITIVE_INFINITY })).toBeNull();
    expect(readInput({ ...ok, ia: -1 })).toBeNull();
    expect(readInput({ ...ok, ia: 1.5 })).toBeNull();
    expect(readInput({ ...ok, seq: '3' as unknown as number })).toBeNull();
    expect(readInput({ ...ok, ep: '' })).toBeNull();
    expect(readInput({ ...ok, run: 'x'.repeat(40) })).toBeNull();
  });

  test('ids are short, varied and from an unambiguous alphabet', () => {
    const ids = new Set(Array.from({ length: 200 }, () => randomId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[a-km-np-z2-9]{10}$/);
  });
});
