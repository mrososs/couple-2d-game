import { DomComponent } from '@ng-native/expo/dom-component';
import { fireEvent, render, screen, userEvent } from '@ng-native/testing';
import { describe, expect, test } from 'vitest';
import type { GameEvent, LevelResult } from '../game/bridge/protocol.ts';
import { App } from './app.ts';
import { KEY_VALUE_STORE, MemoryStore } from './services/kv-store.ts';
import { Navigator } from './services/navigator.ts';
import { Progress } from './services/progress.ts';
import { applyResult, DEFAULT_SAVE } from './services/progress-rules.ts';

const PAGE_BASE = 'http://dev-server.test';

/**
 * Renders the app with an in-memory store and a fake web view: `DomComponent.SOURCE` says where
 * pages live and records what the app injects into the page, which is how inputs reach the game.
 */
async function renderApp(seed: Record<string, unknown> = {}) {
  const injected: string[] = [];
  const result = await render(App, {
    providers: [
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
  return { ...result, injected, nav: get(Navigator), progress: get(Progress) };
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
    await user.type(screen.getByTestId('coop-code'), '999');
    await user.press(screen.getByRole('button', { name: 'ادخل' }));
    expect(screen.getByText('الكود مش صحيح — زي كده: 23-58')).toBeTruthy();
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
