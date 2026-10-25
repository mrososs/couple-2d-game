import { describe, expect, test } from 'vitest';
import { formatRoomCode, parseNet, parseRoomCode, randomPin, relayUrl, toLatinDigits } from './protocol.ts';

describe('room codes', () => {
  test('a room code is the last number of the host address and a two-digit PIN', () => {
    expect(formatRoomCode('192.168.1.23', '58')).toBe('23-58');
    expect(formatRoomCode('192.168.43.1', '07')).toBe('1-07');
  });

  test('codes parse in the forms people type them', () => {
    expect(parseRoomCode('23-58')).toEqual({ host: '23', pin: '58' });
    expect(parseRoomCode(' 23 58 ')).toEqual({ host: '23', pin: '58' });
    expect(parseRoomCode('٢٣-٥٨')).toEqual({ host: '23', pin: '58' });
    expect(parseRoomCode('192.168.1.23-58')).toEqual({ host: '192.168.1.23', pin: '58' });
    expect(parseRoomCode('10.0.2.2-42')).toEqual({ host: '10.0.2.2', pin: '42' });
  });

  test('nonsense is rejected rather than guessed at', () => {
    for (const bad of ['', '23', '23-5', '300-58', '0-58', '255-58', 'abc-12', '1.2.3-45', '1.2.3.999-45']) expect(parseRoomCode(bad), bad).toBeNull();
  });

  test('a short code completes the guest’s own network address', () => {
    expect(relayUrl({ host: '23', pin: '58' }, '192.168.1.40')).toBe('ws://192.168.1.23:7777');
    expect(relayUrl({ host: '1', pin: '58' }, '192.168.43.117')).toBe('ws://192.168.43.1:7777');
    expect(relayUrl({ host: '10.0.2.2', pin: '42' }, null)).toBe('ws://10.0.2.2:7777');
    expect(relayUrl({ host: '23', pin: '58' }, null)).toBeNull();
  });

  test('PINs are always two digits', () => {
    expect(randomPin(() => 0)).toBe('10');
    expect(randomPin(() => 0.9999)).toBe('99');
  });

  test('Eastern Arabic and Persian digits read as digits', () => {
    expect(toLatinDigits('٠١٢٣٤٥٦٧٨٩ ۴۵')).toBe('0123456789 45');
  });
});

describe('parseNet', () => {
  test('accepts well-formed messages from either side', () => {
    expect(parseNet(JSON.stringify({ ch: 'game', from: 'guest', t: 'in', x: 1, y: 0, ia: 2, ro: 0 }))).toMatchObject({ t: 'in', ia: 2 });
    expect(parseNet(JSON.stringify({ ch: 'lobby', from: 'host', t: 'start', sceneId: 'level01', sessionId: 2 }))).toMatchObject({ t: 'start' });
  });

  test('drops anything else', () => {
    for (const bad of [42, '{', 'null', JSON.stringify({ ch: 'chat', from: 'host', t: 'x' }), JSON.stringify({ ch: 'game', from: 'admin', t: 'x' }), JSON.stringify({ ch: 'game', from: 'host' })]) {
      expect(parseNet(bad)).toBeNull();
    }
  });
});
