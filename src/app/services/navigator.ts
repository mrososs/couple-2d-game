import { Injectable, computed, signal } from '@angular/core';
import type { LevelResult, SceneId } from '../../game/bridge/protocol.ts';

/**
 * A small screen stack. `@ng-native/router` drives real native stacks but has no browser build,
 * and this app must also run in the browser host, so the screens switch on this signal instead.
 * Each screen is created when it comes to the top and destroyed when it leaves it - which is also
 * what tears the game's web view down when the player leaves the gameplay screen.
 */

export type Screen =
  | { readonly name: 'welcome' }
  | { readonly name: 'menu' }
  | { readonly name: 'characters' }
  | { readonly name: 'levels' }
  | { readonly name: 'game'; readonly sceneId: SceneId; readonly coop?: boolean }
  | { readonly name: 'result'; readonly result: LevelResult; readonly unlocked: string | null; readonly coop?: boolean }
  | { readonly name: 'coop' }
  | { readonly name: 'settings' }
  | { readonly name: 'about' }
  | { readonly name: 'bridge' };

@Injectable({ providedIn: 'root' })
export class Navigator {
  private readonly stack = signal<readonly Screen[]>([{ name: 'welcome' }]);
  readonly current = computed(() => this.stack().at(-1)!);
  readonly depth = computed(() => this.stack().length);
  /** The screen under the current one, which back() returns to. */
  readonly below = computed(() => this.stack().at(-2));

  push(screen: Screen): void {
    this.stack.update((s) => [...s, screen]);
  }

  /** Swaps the top screen, as the result screen replaces the game it came from. */
  replace(screen: Screen): void {
    this.stack.update((s) => [...s.slice(0, -1), screen]);
  }

  /** Clears back to one screen. */
  reset(screen: Screen): void {
    this.stack.set([screen]);
  }

  /** Pops screens until `name` is on top; false (and nothing popped) when it is not in the stack. */
  popTo(name: Screen['name']): boolean {
    const stack = this.stack();
    const i = stack.findLastIndex((s) => s.name === name);
    if (i < 0) return false;
    if (i < stack.length - 1) this.stack.set(stack.slice(0, i + 1));
    return true;
  }

  /** Pops a screen; false at the bottom, so the platform can background the app. */
  back(): boolean {
    if (this.stack().length <= 1) return false;
    this.stack.update((s) => s.slice(0, -1));
    return true;
  }
}
