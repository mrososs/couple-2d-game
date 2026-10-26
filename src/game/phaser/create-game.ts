import Phaser from 'phaser';
import type { GameCommand, GameEvent, GameSession, GameSettings } from '../bridge/protocol.ts';
import type { SfxName } from './audio/sfx.ts';
import { Sfx } from './audio/sfx.ts';
import { BootScene } from './scenes/boot-scene.ts';
import { HudScene } from './scenes/hud-scene.ts';
import { LevelScene } from './scenes/level-scene.ts';
import { MirrorScene } from './scenes/mirror-scene.ts';
import { provideServices, routeFeel, type GameServices } from './services.ts';

/**
 * The game page's whole surface: create a Phaser game in an element, feed it settings and
 * commands, change its session, and destroy it. The DOM component owns one of these and nothing
 * else, so the same game runs inside the app's web view, in the browser host, and on its own.
 *
 * In two-phone play the host's page runs the level (LevelScene) and the guest's page runs a
 * MirrorScene that draws what the host sends and sends back the guest's controls.
 */
export interface GameRuntime {
  applySettings(settings: GameSettings): void;
  command(command: GameCommand): void;
  setSession(session: GameSession): void;
  destroy(): void;
}

/** The reference resolution: 16:9, widened or deepened by EXPAND to fill the device. */
export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

export function createGame(parent: HTMLElement, session: GameSession, settings: GameSettings, emit: (event: GameEvent) => void): GameRuntime {
  const sfx = new Sfx();
  sfx.apply(settings);
  const services: GameServices = {
    session,
    settings,
    sfx,
    emit,
    haptic: (kind, who = 'both') => routeFeel(services, { k: 'haptic', kind, who }),
    vibrate: (who) => routeFeel(services, { k: 'vibrate', who }),
  };
  // The host plays every sound for the guest too.
  const play = sfx.play.bind(sfx);
  sfx.play = (name: SfxName) => {
    play(name);
    services.relay?.({ k: 'sfx', name });
  };
  let destroyed = false;
  const guest = session.net?.role === 'guest';

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#2E2420',
    banner: false,
    scale: {
      mode: Phaser.Scale.EXPAND,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
    },
    render: { antialias: true, roundPixels: false, powerPreference: 'high-performance' },
    physics: { default: 'arcade', arcade: { debug: session.devMode && !guest, gravity: { x: 0, y: 0 } } },
    input: { activePointers: 4, keyboard: true, touch: true, mouse: true },
    audio: { noAudio: true },
    fps: { target: 60, smoothStep: true },
    callbacks: {
      preBoot: (g) => provideServices(g, services),
    },
    // Render order is list order: the HUD is drawn over the world.
    scene: guest ? [BootScene, MirrorScene, HudScene] : [BootScene, LevelScene, HudScene],
  });

  const world = () => game.scene.getScene(guest ? 'mirror' : 'level') as LevelScene | MirrorScene | null;
  // A handle for automated tests and the web view inspector; it holds nothing the page does not.
  // `advance()` steps the loop by hand, so a test can play the game deterministically even where
  // the page is in the background and requestAnimationFrame is paused.
  let clock = 0;
  const handle = {
    game,
    services,
    advance(ms: number, frameMs = 1000 / 60) {
      // Before boot finishes there is no renderer to step.
      if (!game.isRunning) return;
      clock = Math.max(clock, game.loop.now);
      for (let t = 0; t < ms; t += frameMs) {
        clock += frameMs;
        game.step(clock, frameMs);
      }
    },
  };
  const global = window as unknown as { __bwbt?: unknown };
  global.__bwbt = handle;

  // The phone's app went to the background (a call, the home button). The native app's own
  // reaction cannot be relied on there - on Android its JavaScript waits until the app is back -
  // but this page is told at once, and pauses: the host's game for both phones, the guest's by
  // asking the host. Coming back, the players resume from the pause sheet.
  const onVisibility = () => {
    if (document.visibilityState !== 'hidden') return;
    const scene = world();
    if (scene && (scene.sys.isActive() || scene.sys.isPaused())) scene.command({ seq: 0, kind: 'pause' });
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    applySettings(next) {
      services.settings = next;
      sfx.apply(next);
    },
    command(command) {
      const scene = world();
      if (scene && (scene.sys.isActive() || scene.sys.isPaused())) scene.command(command);
    },
    setSession(next) {
      // A changed outfit is drawn on demand when the scene restarts.
      services.session = next;
      const scene = world();
      if (scene) {
        if (scene.sys.isPaused()) scene.scene.resume();
        scene.scene.restart();
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      // Phaser tears scenes down on its next frame, which a page being hidden may never run:
      // the room connections close now, so the partner hears at once and no socket is orphaned.
      world()?.shutdownNet();
      sfx.dispose();
      game.destroy(true, false);
      if (global.__bwbt === handle) delete global.__bwbt;
      emit({ type: 'disposed', sceneId: services.session.sceneId });
    },
  };
}
