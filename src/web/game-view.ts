'use dom';
import { Component, ElementRef, afterNextRender, effect, inject, input, output, signal, untracked, type OnDestroy } from '@angular/core';
import { mountInWebView } from '@ng-native/web/web-view';
import { DEFAULT_SETTINGS, type GameCommand, type GameEvent, type GameSession, type GameSettings } from '../game/bridge/protocol.ts';
import { createGame, type GameRuntime } from '../game/phaser/create-game.ts';

/**
 * The game page: an Angular component for the browser, mounted in the web view that a native
 * `<dom-component>` shows. It owns one Phaser game and talks to the app only through JSON inputs
 * (session, settings, command) and one output (gameEvent).
 *
 * Phaser is created after the first render, once the host element has a size, and destroyed when
 * the component is - and also on `pagehide`, because a native web view that is torn down unloads
 * the page without running Angular's teardown.
 */
@Component({
  selector: 'bwbt-game',
  styleUrl: './game-view.css',
  template: `
    <div class="stage" #stage></div>
    @if (!started()) {
      <div class="loading">⏳</div>
    }
  `,
  host: { class: 'game-host' },
})
export class GameView implements OnDestroy {
  readonly session = input.required<GameSession>();
  readonly settings = input<GameSettings>(DEFAULT_SETTINGS);
  readonly command = input<GameCommand | null>(null);
  readonly gameEvent = output<GameEvent>();

  protected readonly started = signal(false);
  private runtime: GameRuntime | null = null;
  private sessionId = -1;
  private lastCommand = -1;
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly onPageHide = () => this.dispose();

  constructor() {
    afterNextRender(() => void this.boot());

    effect(() => {
      const settings = this.settings();
      untracked(() => this.runtime?.applySettings(settings));
    });
    effect(() => {
      const session = this.session();
      untracked(() => {
        if (!this.runtime || session.sessionId === this.sessionId) return;
        this.sessionId = session.sessionId;
        this.runtime.setSession(session);
      });
    });
    effect(() => {
      const command = this.command();
      untracked(() => {
        if (!this.runtime || !command || command.seq <= this.lastCommand) return;
        this.lastCommand = command.seq;
        this.runtime.command(command);
      });
    });
  }

  private async boot(): Promise<void> {
    await loadFonts();
    const stage = (this.host.nativeElement as HTMLElement).querySelector('.stage') as HTMLElement;
    if (this.runtime) return;
    const session = this.session();
    this.sessionId = session.sessionId;
    this.lastCommand = this.command()?.seq ?? -1;
    this.runtime = createGame(stage, session, this.settings(), (event) => this.gameEvent.emit(event));
    this.started.set(true);
    window.addEventListener('pagehide', this.onPageHide);
  }

  ngOnDestroy(): void {
    this.dispose();
  }

  private dispose(): void {
    window.removeEventListener('pagehide', this.onPageHide);
    this.runtime?.destroy();
    this.runtime = null;
  }
}

/** Waits for the Arabic face, but never more than a moment: text falls back to system fonts. */
async function loadFonts(): Promise<void> {
  if (!('fonts' in document)) return;
  const faces = ['400 20px "Baloo Bhaijaan 2"', '600 20px "Baloo Bhaijaan 2"', '800 20px "Baloo Bhaijaan 2"'];
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 2500));
  await Promise.race([Promise.all(faces.map((f) => document.fonts.load(f, 'أب'))).then(() => undefined), timeout]).catch(() => undefined);
}

export default mountInWebView(GameView);
