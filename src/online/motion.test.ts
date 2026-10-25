import { describe, expect, test } from 'vitest';
import { MotionBuffer, MotionThrottle, type MotionState } from './motion.ts';
import type { MoveSnapshot } from './protocol.ts';

const still: MotionState = { slot: 1, x: 100, y: 200, vx: 0, vy: 0, facing: 'down', carrying: null };

function snap(seq: number, t: number, x: number, y = 0, vx = 0, vy = 0): MoveSnapshot {
  return { slot: 2, seq, t, x, y, vx, vy, facing: 'right', carrying: null };
}

describe('MotionThrottle', () => {
  test('sends at most 15 snapshots a second however often it is called', () => {
    const sent: MoveSnapshot[] = [];
    const throttle = new MotionThrottle((s) => sent.push(s));
    for (let frame = 0; frame <= 60; frame++) {
      throttle.update({ ...still, x: 100 + frame * 3, vx: 180 }, frame * (1000 / 60));
    }
    const gaps = sent.slice(1).map((s, i) => s.t - sent[i].t);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(1000 / 15 - 1e-6);
    expect(sent.length).toBeGreaterThanOrEqual(12);
    expect(sent.length).toBeLessThanOrEqual(16);
    expect(sent.map((s) => s.seq)).toEqual(sent.map((_, i) => i + 1));
  });

  test('a player standing still is sent once, then only as a heartbeat', () => {
    const sent: MoveSnapshot[] = [];
    const throttle = new MotionThrottle((s) => sent.push(s), { heartbeatMs: 1000 });
    for (let t = 0; t <= 2500; t += 16) throttle.update(still, t);
    expect(sent.map((s) => s.t)).toEqual([0, 1008, 2016]);
  });

  test('stopping, turning or picking something up goes out at the next slot', () => {
    const sent: MoveSnapshot[] = [];
    const throttle = new MotionThrottle((s) => sent.push(s));
    throttle.update(still, 0);
    throttle.update({ ...still, facing: 'up' }, 70);
    throttle.update({ ...still, facing: 'up', carrying: 'card:budget' }, 140);
    expect(sent.map((s) => [s.facing, s.carrying])).toEqual([['down', null], ['up', null], ['up', 'card:budget']]);
  });
});

describe('MotionBuffer', () => {
  test('draws the partner between the two snapshots around (now - delay)', () => {
    const buffer = new MotionBuffer({ delayMs: 100 });
    buffer.push(snap(1, 0, 0), 1000);
    buffer.push(snap(2, 100, 100), 1100);
    // Sender time 50 is local 1050; drawn 100 ms late, that is local 1150.
    expect(buffer.sample(1150)).toMatchObject({ x: 50, facing: 'right' });
  });

  test('late or repeated snapshots are dropped', () => {
    const buffer = new MotionBuffer();
    expect(buffer.push(snap(2, 100, 100), 1100)).toBe(true);
    expect(buffer.push(snap(1, 0, 0), 1120)).toBe(false);
    expect(buffer.push(snap(2, 100, 100), 1130)).toBe(false);
  });

  test('jitter does not move the timeline: the fastest packet sets the clock offset', () => {
    const buffer = new MotionBuffer({ delayMs: 100 });
    buffer.push(snap(1, 0, 0), 1080); // slow packet
    buffer.push(snap(2, 100, 100), 1100); // fast packet: offset 1000
    expect(buffer.sample(1150)!.x).toBeCloseTo(50);
  });

  test('when snapshots stop, the partner coasts briefly on their velocity, then holds', () => {
    const buffer = new MotionBuffer({ delayMs: 100, maxExtrapolateMs: 150 });
    buffer.push(snap(1, 0, 0, 0, 200), 1000);
    buffer.push(snap(2, 100, 20, 0, 200), 1100);
    expect(buffer.sample(1250)!.x).toBeCloseTo(30); // 50 ms past the last snapshot at 200 px/s
    expect(buffer.sample(5000)!.x).toBeCloseTo(50); // capped at 150 ms
  });

  test('a long jump (a respawn) is shown at once rather than slid across the room', () => {
    const buffer = new MotionBuffer({ delayMs: 100, snapDistance: 220 });
    buffer.push(snap(1, 0, 0), 1000);
    buffer.push(snap(2, 100, 900), 1100);
    expect(buffer.sample(1150)!.x).toBe(900);
  });

  test('nothing to draw before the first snapshot or after clear()', () => {
    const buffer = new MotionBuffer();
    expect(buffer.sample(0)).toBeNull();
    buffer.push(snap(1, 0, 10), 1000);
    expect(buffer.sample(2000)).not.toBeNull();
    buffer.clear();
    expect(buffer.sample(2000)).toBeNull();
  });
});
