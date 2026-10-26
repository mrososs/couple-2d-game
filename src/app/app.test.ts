import type { Provider } from '@angular/core';
import { DomComponent } from '@ng-native/expo/dom-component';
import { fireEvent, render, screen, userEvent } from '@ng-native/testing';
import { afterEach, describe, expect, test } from 'vitest';
import { startRelay, type RunningRelay } from '../../scripts/lan-relay.ts';
import type { GameEvent, LevelResult } from '../game/bridge/protocol.ts';
import { NetLink } from '../game/net/link.ts';
import { NET_VERSION, type NetMessage } from '../game/net/protocol.ts';
import type { RoomAuth } from '../game/net/room.ts';
import { App } from './app.ts';
import { CoopSession, DEV_RELAY } from './services/coop.ts';
import { KEY_VALUE_STORE, MemoryStore } from './services/kv-store.ts';
import { Navigator } from './services/navigator.ts';
import { Progress } from './services/progress.ts';
import { applyResult, DEFAULT_SAVE } from './services/progress-rules.ts';

const PAGE_BASE = 'http://dev-server.test';

/**
 * Renders the app with an in-memory store and a fake web view: `DomComponent.SOURCE` says where
 * pages live and records what the app injects into the page, which is how inputs reach the game.
 */
async function renderApp(seed: Record<string, unknown> = {}, extra: Provider[] = []) {
  const injected: string[] = [];
  const result = await render(App, {
    providers: [
      ...extra,
      { provide: KEY_VALUE_STORE, useValue: new MemoryStore(seed) },
      {
        provide: DomComponent.SOURCE,
        useValue: {
          baseUrl: PAGE_BASE,
          functions: {
            injectJavaScript: async (script: string) => {
              injected.push(script);
            },
          },
        },
      },
    ],
  });
  const get = <T,>(token: abstract new (...args: never[]) => T) => result.componentRef.injector.get(token);
  return { ...result, injected, nav: get(Navigator), progress: get(Progress), coop: get(CoopSession) };
}

/** What the game page posts through the web view, as Expo's web view delivers it. */
async function fromPage(message: object): Promise<void> {
  const view = screen.getByTestId('game-view');
  const source = view.props.source as { uri: string };
  await fireEvent(view, 'message', { data: JSON.stringify(message), url: source.uri });
}

const onboarded = { 'bwbt.save.v1': { ...DEFAULT_SAVE, onboarded: true } };

describe('native screens', () => {
  test('the welcome screen leads a first-time couple to character selection, then the menu', async () => {
    const { progress } = await renderApp();
    expect(screen.getByText('قبل ما نبقى تلاتة')).toBeTruthy();
    const user = userEvent.setup();
    await user.press(screen.getByRole('button', { name: 'يلا نبدأ' }));
    expect(screen.getByText('الزوجة')).toBeTruthy();
    expect(screen.getByText('الزوج')).toBeTruthy();
    await user.press(screen.getByRole('button', { name: 'تمام، يلا' }));
    expect(screen.getByText('القايمة الرئيسية')).toBeTruthy();
    expect(progress.save().onboarded).toBe(true);
  });

  test('levels after the first are locked until the one before is finished', async () => {
    const { nav, detectChanges } = await renderApp(onboarded);
    nav.push({ name: 'levels' });
    await detectChanges();
    expect(screen.getByRole('button', { name: /المرحلة 1: قرارنا الكبير الأول$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /المرحلة 2.*مقفولة/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /المرحلة 3.*مقفولة/ })).toBeTruthy();
  });

  test('saved progress unlocks the next level on a fresh launch', async () => {
    const saved = applyResult({ ...DEFAULT_SAVE, onboarded: true }, { levelId: 'level01', stars: 3, durationSec: 60, insights: [], metrics: {} }).save;
    const { nav, detectChanges } = await renderApp({ 'bwbt.save.v1': saved });
    nav.push({ name: 'levels' });
    await detectChanges();
    expect(screen.queryByRole('button', { name: /المرحلة 2.*مقفولة/ })).toBeNull();
    expect(screen.getByRole('button', { name: /المرحلة 2: تحدي ميزانية البيبي$/ })).toBeTruthy();
  });
});

describe('two-phone lobby', () => {
  test('without the relay module a phone can still join, and a bad code explains itself', async () => {
    const { nav, detectChanges } = await renderApp(onboarded);
    nav.push({ name: 'coop' });
    await detectChanges();
    expect(screen.getByText('فتح الغرفة محتاج نسخة أندرويد')).toBeTruthy();
    const user = userEvent.setup();
    await user.type(screen.getByTestId('coop-code'), '999-482916');
    await user.press(screen.getByRole('button', { name: 'ادخل بالكود' }));
    expect(screen.getByText('الكود مش مظبوط')).toBeTruthy();
    expect(screen.getByText('الكود رقم وبعده الرقم السري، زي كده: 23-482916')).toBeTruthy();
  });

  /**
   * The app against the development relay, which plays by the same room rules as the phone's
   * native one; the test is the other phone, with a link of its own.
   */
  async function withRelay() {
    const relay = await startRelay({ port: 0, host: '127.0.0.1', limits: { pinSpacingMs: 0 } });
    rooms.push(relay);
    const url = `ws://127.0.0.1:${relay.port}/bwbt`;
    return { relay, url, providers: [{ provide: DEV_RELAY, useValue: { url, hostKey: relay.hostKey } }] };
  }
  const rooms: RunningRelay[] = [];
  const otherPhones: NetLink[] = [];
  afterEach(async () => {
    for (const l of otherPhones.splice(0)) l.close();
    for (const r of rooms.splice(0)) await r.close();
  });
  function otherPhone(url: string, auth: RoomAuth) {
    const messages: NetMessage[] = [];
    const link = new NetLink({ url, auth, channel: 'lobby', onMessage: (m) => messages.push(m) });
    otherPhones.push(link);
    return { link, messages };
  }
  async function until(check: () => boolean, detectChanges: () => Promise<void>, ms = 4000) {
    const end = Date.now() + ms;
    for (;;) {
      await detectChanges();
      if (check()) {
        // What changed from a network message is drawn on the next pass.
        await detectChanges();
        return;
      }
      if (Date.now() > end) throw new Error('timed out waiting');
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  test('the host opens a room, shows the PIN, and the partner pairs with it once', async () => {
    const { relay, url, providers } = await withRelay();
    const { nav, coop, progress, detectChanges } = await renderApp(onboarded, providers);
    nav.push({ name: 'coop' });
    await detectChanges();
    const user = userEvent.setup();
    await user.press(screen.getByRole('button', { name: 'افتح غرفة' }));
    await until(() => !!screen.queryByTestId('room-pin'), detectChanges);
    const pin = relay.pin()!;
    // Shown left to right inside the right-to-left screen, as people read and type it.
    expect(screen.getByText(`⁦${pin.slice(0, 3)} ${pin.slice(3)}⁩`)).toBeTruthy();
    expect(screen.getByText('مستنيين شريكك…')).toBeTruthy();
    expect(screen.getByRole('button', { name: /قرارنا الكبير الأول/ }).props.accessibilityState).toMatchObject({ disabled: true });

    // The partner's phone pairs with the PIN and says hello.
    const partner = otherPhone(url, { role: 'guest', pin });
    await until(() => partner.link.isOpen, detectChanges);
    partner.link.send({ t: 'hello', v: NET_VERSION, name: 'كريم' });
    await until(() => !!screen.queryByTestId('coop-paired'), detectChanges);
    expect(partner.messages.find((m) => m.t === 'welcome')).toMatchObject({ guestPlays: 'husband', level: null, results: [] });
    expect(screen.getByText('متصل وجاهز ✓')).toBeTruthy();

    // A third phone with the same PIN gets nowhere.
    const third = otherPhone(url, { role: 'guest', pin });
    await until(() => third.link.status === 'closed', detectChanges);
    expect(third.link.end).toBe('full');

    // The host starts level 1: both phones open it; the page gets the host's room credentials.
    await user.press(screen.getByRole('button', { name: /قرارنا الكبير الأول/ }));
    await until(() => partner.messages.some((m) => m.t === 'start'), detectChanges);
    expect(partner.messages.find((m) => m.t === 'start')).toMatchObject({ sceneId: 'level01', session: 1 });
    expect(nav.current()).toMatchObject({ name: 'game', sceneId: 'level01', coop: true });
    const page = JSON.parse(screen.getByTestId('game-view').props.injectedJavaScriptObject as string);
    expect(page.inputs.session.net).toMatchObject({ role: 'host', url, key: relay.hostKey, room: relay.room, me: 'wife' });

    // Leaving the level unfinished takes the partner back to the room; starting again brings both in.
    nav.back();
    await until(() => partner.messages.some((m) => m.t === 'ended'), detectChanges);
    expect(coop.activeLevel()).toBeNull();
    await user.press(screen.getByRole('button', { name: /قرارنا الكبير الأول/ }));
    await until(() => partner.messages.filter((m) => m.t === 'start').length === 2, detectChanges);
    const endedBefore = partner.messages.filter((m) => m.t === 'ended').length;

    // The level is finished on the host: saved here once, and sent to the partner to save too.
    const result: LevelResult = { id: `${relay.room}:run1`, levelId: 'level01', stars: 2, durationSec: 80, insights: ['shared'], metrics: {} };
    await fromPage({ type: 'ready', outputs: ['gameEvent'] });
    await fromPage({ type: 'output', name: 'gameEvent', value: { type: 'complete', result } });
    await until(() => partner.messages.some((m) => m.t === 'result'), detectChanges);
    expect(progress.record('level01')?.plays).toBe(1);
    expect(coop.results()).toEqual([result]);
    expect(nav.current()).toMatchObject({ name: 'result', coop: true });
    // Finishing is not leaving: the partner is not sent back to the room.
    await new Promise((r) => setTimeout(r, 150));
    expect(partner.messages.filter((m) => m.t === 'ended').length).toBe(endedBefore);
    expect(coop.activeLevel()).toBeNull();
  });

  test('the partner joins with the code, catches up on finished levels, follows the host, and hears the room close', async () => {
    const { relay, url, providers } = await withRelay();
    const host = otherPhone(url, { role: 'host', key: relay.hostKey });
    const { nav, progress, detectChanges } = await renderApp(onboarded, providers);
    nav.push({ name: 'coop' });
    await detectChanges();
    const user = userEvent.setup();
    await user.type(screen.getByTestId('coop-code'), `1-${relay.pin()}`);
    await user.press(screen.getByRole('button', { name: 'ادخل بالكود' }));
    await until(() => host.messages.some((m) => m.t === 'hello'), detectChanges);
    expect(host.messages.find((m) => m.t === 'hello')).toMatchObject({ from: 'guest', v: NET_VERSION });

    // The host's welcome carries a level finished while this phone was away.
    const missed: LevelResult = { id: `${relay.room}:runA`, levelId: 'level01', stars: 3, durationSec: 70, insights: [], metrics: {} };
    host.link.send({ t: 'welcome', v: NET_VERSION, guestPlays: 'husband', names: { wife: 'منى', husband: 'كريم' }, outfits: { wife: 0, husband: 1 }, level: null, results: [missed] });
    await until(() => !!screen.queryByTestId('coop-paired'), detectChanges);
    expect(progress.isUnlocked('level02')).toBe(true);
    // The same result again (it also comes through the game page) is not counted twice.
    host.link.send({ t: 'result', result: missed });
    await until(() => true, detectChanges);
    await new Promise((r) => setTimeout(r, 100));
    expect(progress.record('level01')?.plays).toBe(1);

    host.link.send({ t: 'start', sceneId: 'level02', session: 4 });
    await until(() => nav.current().name === 'game', detectChanges);
    const page = JSON.parse(screen.getByTestId('game-view').props.injectedJavaScriptObject as string);
    expect(page.inputs.session.net).toMatchObject({ role: 'guest', url, room: relay.room, me: 'husband' });
    expect(page.inputs.session.net.key).toMatch(/^[A-Za-z0-9_-]{32}$/);

    // The host leaves the level: this phone goes back to the room.
    host.link.send({ t: 'ended' });
    await until(() => nav.current().name === 'coop', detectChanges);

    // The host closes the room.
    await relay.close();
    rooms.splice(0);
    await until(() => !!screen.queryByTestId('coop-error'), detectChanges);
    expect(screen.getByText('شريككم قفل الغرفة')).toBeTruthy();
  });

  test('a wrong PIN says so, and is not retried', async () => {
    const { relay, providers } = await withRelay();
    const { nav, detectChanges } = await renderApp(onboarded, providers);
    nav.push({ name: 'coop' });
    await detectChanges();
    const user = userEvent.setup();
    const wrong = relay.pin() === '111111' ? '222222' : '111111';
    await user.type(screen.getByTestId('coop-code'), `1-${wrong}`);
    await user.press(screen.getByRole('button', { name: 'ادخل بالكود' }));
    await until(() => !!screen.queryByTestId('coop-error'), detectChanges);
    expect(screen.getByText('الرقم السري غلط')).toBeTruthy();
    expect(relay.pin()).not.toBeNull();
  });
});

describe('the pause sheet with two phones', () => {
  test("the guest sees the host's pause and cannot lift it; its own buttons are requests", async () => {
    const { nav, coop, injected, detectChanges } = await renderApp(onboarded);
    coop.role.set('guest');
    coop.partnerName.set('منى');
    nav.push({ name: 'game', sceneId: 'level01', coop: true });
    await detectChanges();
    await fromPage({ type: 'ready', outputs: ['gameEvent'] });
    await fromPage({ type: 'output', name: 'gameEvent', value: { type: 'paused', reasons: ['host'] } });
    await detectChanges();
    expect(screen.getByText('منى وقّف اللعب ☕')).toBeTruthy();
    expect(screen.queryByTestId('resume')).toBeNull();
    const user = userEvent.setup();
    await user.press(screen.getByTestId('ask-restart'));
    expect(injected.at(-1)).toContain('"kind":"restart"');
    expect(screen.getByText('طلبنا من منى… ⏳')).toBeTruthy();
    await fromPage({ type: 'output', name: 'gameEvent', value: { type: 'answer', kind: 'restart', ok: false } });
    await detectChanges();
    expect(screen.getByText('منى فضّل تكمّلوا 🙂')).toBeTruthy();
  });

  test("the host is asked about the partner's restart, and waits for a partner who dropped out", async () => {
    const { nav, coop, injected, detectChanges } = await renderApp(onboarded);
    coop.role.set('host');
    coop.partnerName.set('كريم');
    nav.push({ name: 'game', sceneId: 'level02', coop: true });
    await detectChanges();
    await fromPage({ type: 'ready', outputs: ['gameEvent'] });
    await fromPage({ type: 'output', name: 'gameEvent', value: { type: 'paused', reasons: ['guest'] } });
    await fromPage({ type: 'output', name: 'gameEvent', value: { type: 'request', kind: 'restart' } });
    await detectChanges();
    expect(screen.getByText('كريم وقّف اللعب ☕')).toBeTruthy();
    expect(screen.getByText('كريم عايز يبدأ المرحلة من الأول 🔁')).toBeTruthy();
    const user = userEvent.setup();
    await user.press(screen.getByTestId('decline-restart'));
    expect(injected.at(-1)).toContain('"kind":"decline"');
    expect(screen.queryByTestId('restart-request')).toBeNull();

    await fromPage({ type: 'output', name: 'gameEvent', value: { type: 'paused', reasons: ['partner'] } });
    await detectChanges();
    expect(screen.getByTestId('waiting-partner')).toBeTruthy();
    expect(screen.getByText('📡 مستنيين كريم…')).toBeTruthy();
    await fromPage({ type: 'output', name: 'gameEvent', value: { type: 'resumed' } });
    await detectChanges();
    expect(screen.queryByTestId('waiting-partner')).toBeNull();
  });

  test('a guest whose host left the level can only go back to the room', async () => {
    const { nav, coop, detectChanges } = await renderApp(onboarded);
    coop.role.set('guest');
    coop.partnerName.set('منى');
    nav.push({ name: 'coop' });
    nav.push({ name: 'game', sceneId: 'level03', coop: true });
    await detectChanges();
    await fromPage({ type: 'ready', outputs: ['gameEvent'] });
    await fromPage({ type: 'output', name: 'gameEvent', value: { type: 'net', status: 'host-left' } });
    await detectChanges();
    expect(screen.getByText('🚪 منى خرج من المرحلة')).toBeTruthy();
    const user = userEvent.setup();
    await user.press(screen.getByTestId('back-to-room'));
    expect(nav.current().name).toBe('coop');
  });
});

describe('the gameplay container and the bridge', () => {
  test('the game page gets its session as JSON before it loads', async () => {
    const { nav, detectChanges } = await renderApp(onboarded);
    nav.push({ name: 'game', sceneId: 'level02' });
    await detectChanges();
    const view = screen.getByTestId('game-view');
    expect((view.props.source as { uri: string }).uri.startsWith(PAGE_BASE)).toBe(true);
    const page = JSON.parse(view.props.injectedJavaScriptObject as string);
    expect(page.inputs.session).toMatchObject({ sceneId: 'level02', lead: 'wife', names: { wife: 'منى', husband: 'كريم' } });
    expect(page.inputs.settings).toMatchObject({ sound: true });
  });

  test('ready hides the loading screen; a completion event is saved by the app and opens the result screen', async () => {
    const { nav, progress, detectChanges } = await renderApp(onboarded);
    nav.push({ name: 'game', sceneId: 'level01' });
    await detectChanges();
    expect(screen.getByText('بنجهّز البيت… 🏠')).toBeTruthy();

    await fromPage({ type: 'ready', outputs: ['gameEvent'] });
    const ready: GameEvent = { type: 'ready', sceneId: 'level01', sessionId: 1, renderer: 'webgl', width: 1600, height: 720 };
    await fromPage({ type: 'output', name: 'gameEvent', value: ready });
    await detectChanges();
    expect(screen.queryByText('بنجهّز البيت… 🏠')).toBeNull();

    const result: LevelResult = { levelId: 'level01', stars: 3, durationSec: 95, insights: ['shared', 'talk'], metrics: { wifeShare: 44 } };
    await fromPage({ type: 'output', name: 'gameEvent', value: { type: 'complete', result } });
    await detectChanges();

    expect(nav.current()).toMatchObject({ name: 'result', unlocked: 'level02' });
    expect(progress.isUnlocked('level02')).toBe(true);
    expect(screen.getByText('برافو عليكم! 🎉')).toBeTruthy();
    expect(screen.getByText('قرارات بتتاخد سوا')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'المرحلة الجاية' })).toBeTruthy();
  });

  test('pause shows the native sheet and sends the command into the page; resume sends another', async () => {
    const { nav, injected, detectChanges } = await renderApp(onboarded);
    nav.push({ name: 'game', sceneId: 'level02' });
    await detectChanges();
    await fromPage({ type: 'ready', outputs: ['gameEvent'] });
    const user = userEvent.setup();
    await user.press(screen.getByRole('button', { name: 'إيقاف مؤقت' }));
    expect(screen.getByText('استراحة ☕')).toBeTruthy();
    expect(injected.at(-1)).toContain('"command":{"seq":1,"kind":"pause"}');
    await user.press(screen.getByRole('button', { name: 'كمّل' }));
    expect(injected.at(-1)).toContain('"command":{"seq":2,"kind":"resume"}');
    expect(screen.queryByText('استراحة ☕')).toBeNull();
  });

  test('messages from a page the web view navigated to are ignored', async () => {
    const { nav, progress, detectChanges } = await renderApp(onboarded);
    nav.push({ name: 'game', sceneId: 'level01' });
    await detectChanges();
    const result: LevelResult = { levelId: 'level01', stars: 3, durationSec: 1, insights: [], metrics: {} };
    await fireEvent(screen.getByTestId('game-view'), 'message', {
      data: JSON.stringify({ type: 'output', name: 'gameEvent', value: { type: 'complete', result } }),
      url: 'https://elsewhere.example/page',
    });
    await detectChanges();
    expect(progress.isUnlocked('level02')).toBe(false);
    expect(nav.current().name).toBe('game');
  });

  test('leaving the gameplay screen removes the web view', async () => {
    const { nav, detectChanges } = await renderApp(onboarded);
    nav.push({ name: 'game', sceneId: 'level03' });
    await detectChanges();
    expect(screen.queryByTestId('game-view')).not.toBeNull();
    nav.back();
    await detectChanges();
    expect(screen.queryByTestId('game-view')).toBeNull();
  });
});
