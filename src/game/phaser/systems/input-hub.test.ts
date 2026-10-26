import { describe, expect, test, vi } from 'vitest';

// Only the key helpers are used, and there is no keyboard in these tests.
vi.mock('phaser', () => ({ default: { Input: { Keyboard: { KeyCodes: {}, JustDown: () => false } } } }));

const { InputHub } = await import('./input-hub.ts');
type Hub = InstanceType<typeof InputHub>;

/** A hub for the host's phone, driving the husband from the partner's phone. */
function hostHub(): Hub {
  return new InputHub({ input: { keyboard: null } } as never, 'wife', { single: true });
}

/** Runs frames and returns, per frame, whether the husband interacted / rotated. */
function frames(hub: Hub, n: number): { interact: boolean; rotate: boolean }[] {
  return Array.from({ length: n }, () => {
    hub.beginFrame();
    const { interact, rotate } = hub.intent('husband');
    return { interact, rotate };
  });
}
const presses = (list: { interact: boolean }[]) => list.filter((f) => f.interact).length;
const input = (seq: number, ia: number, extra: Partial<{ ep: string; x: number; y: number; ro: number }> = {}) => ({ ep: 'e1', seq, x: 0, y: 0, ia, ro: 0, ...extra });

describe("the partner's controls on the host", () => {
  test('the very first press of a session counts', () => {
    const hub = hostHub();
    hub.setRemote('husband', input(1, 1));
    expect(presses(frames(hub, 3))).toBe(1);
  });

  test('presses arriving between two frames are each their own interaction', () => {
    const hub = hostHub();
    hub.setRemote('husband', input(1, 0));
    hub.setRemote('husband', input(2, 1));
    hub.setRemote('husband', input(3, 3));
    const result = frames(hub, 5);
    expect(result.map((f) => f.interact)).toEqual([true, true, true, false, false]);
  });

  test('a repeated or late message never presses twice', () => {
    const hub = hostHub();
    hub.setRemote('husband', input(5, 2));
    hub.setRemote('husband', input(5, 2));
    hub.setRemote('husband', input(4, 1));
    hub.setRemote('husband', input(3, 2));
    expect(presses(frames(hub, 6))).toBe(2);
  });

  test('a new session (page restarted, level restarted) counts from zero again', () => {
    const hub = hostHub();
    hub.setRemote('husband', input(40, 7));
    frames(hub, 10);
    hub.setRemote('husband', input(1, 1, { ep: 'e2' }));
    expect(presses(frames(hub, 3))).toBe(1);
  });

  test('controls aimed at an earlier run of the level move the character but press nothing', () => {
    const hub = hostHub();
    hub.setRemote('husband', input(1, 3, { x: 1 }), false);
    const [first] = frames(hub, 1);
    expect(first.interact).toBe(false);
    expect(hub.intent('husband').x).toBe(1);
  });

  test('a stale message in between does not make the current session replay its presses', () => {
    const hub = hostHub();
    hub.setRemote('husband', input(1, 6, { ep: 'now' }));
    frames(hub, 10);
    hub.setRemote('husband', input(1, 3, { ep: 'stale' }), false);
    hub.setRemote('husband', input(9, 2, { ep: 'old' }));
    hub.setRemote('husband', input(2, 6, { ep: 'now' }));
    // 'old' is a session not seen before, so its two presses count once; 'now' adds nothing.
    expect(presses(frames(hub, 10))).toBe(2);
    hub.setRemote('husband', input(3, 7, { ep: 'now' }));
    expect(presses(frames(hub, 10))).toBe(1);
  });

  test('presses made while the controls are off do not fire afterwards', () => {
    const hub = hostHub();
    hub.setRemote('husband', input(1, 2));
    hub.enabled = false;
    frames(hub, 1);
    hub.enabled = true;
    expect(presses(frames(hub, 3))).toBe(0);
  });

  test('a burst no person could press is capped', () => {
    const hub = hostHub();
    hub.setRemote('husband', input(1, 500));
    expect(presses(frames(hub, 20))).toBe(4);
  });

  test('rotation is counted the same way, independently', () => {
    const hub = hostHub();
    hub.setRemote('husband', input(1, 1, { ro: 2 }));
    const result = frames(hub, 3);
    expect(result.map((f) => f.rotate)).toEqual([true, true, false]);
    expect(presses(result)).toBe(1);
  });

  test('a stick beyond its range is clamped, a broken one stops the character', () => {
    const hub = hostHub();
    hub.setRemote('husband', input(1, 0, { x: 3, y: 4 }));
    hub.beginFrame();
    expect(hub.intent('husband')).toMatchObject({ x: 0.6, y: 0.8 });
    hub.setRemote('husband', input(2, 0, { x: Number.NaN, y: 1 }));
    hub.beginFrame();
    expect(hub.intent('husband')).toMatchObject({ x: 0, y: 0 });
  });

  test('a partner who goes quiet stops walking', () => {
    const hub = hostHub();
    hub.setRemote('husband', input(1, 0, { x: 1 }));
    hub.releaseRemote('husband');
    hub.beginFrame();
    expect(hub.intent('husband')).toMatchObject({ x: 0, y: 0 });
  });
});
