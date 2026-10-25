/**
 * The browser build's entry for the game page (game.html). In the app, Expo's web view gives the
 * page `window.ReactNativeWebView`; in a browser the page sits in an iframe instead, so this gives
 * it the same two functions over `postMessage` to the parent, then loads the real DOM component.
 * Opened on its own (no parent), it starts the integration sandbox so the game can be tried alone.
 */

interface Bridge {
  postMessage(data: string): void;
  injectedObjectJson(): string;
}

const embedded = window.parent !== window;
const standalone = JSON.stringify({
  inputs: {
    session: {
      sceneId: new URLSearchParams(location.search).get('scene') ?? 'sandbox',
      sessionId: 1,
      lead: 'wife',
      names: { wife: 'منى', husband: 'كريم' },
      outfits: { wife: 0, husband: 0 },
      devMode: new URLSearchParams(location.search).has('dev'),
    },
  },
});

(window as unknown as { ReactNativeWebView: Bridge }).ReactNativeWebView = {
  postMessage: (data) => {
    if (embedded) window.parent.postMessage({ __bwbtDom: true, data }, '*');
    else console.info('[game → app]', data);
  },
  injectedObjectJson: () => (embedded ? window.name || '{}' : standalone),
};

await import('./game-view.ts');

export {};
