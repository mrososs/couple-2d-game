import { Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Pressable, Switch, Text, View } from '@ng-native/components';
import { AppState, HardwareBack, Vibration } from '@ng-native/device';
import { DomComponent } from '@ng-native/expo/dom-component';
import { Haptics } from '@ng-native/expo/haptics';
import { KeepAwake } from '@ng-native/expo/keep-awake';
import { DeviceOrientation } from '@ng-native/expo/orientation';
import { isLevelId, type GameCommand, type GameCommandKind, type GameEvent, type GameSession, type SceneId } from '../../game/bridge/protocol.ts';
import { levelContent } from '../../game/domain/levels/content.ts';
import type { HapticKind } from '../../game/net/protocol.ts';
import gameView from '../../web/game-view.ts';
import { CoopSession } from '../services/coop.ts';
import { Navigator } from '../services/navigator.ts';
import { Progress } from '../services/progress.ts';
import { Button } from '../ui/button.ts';

/**
 * The gameplay container: the Phaser game in a DOM component filling the screen, with the native
 * pause button and pause sheet over it. It locks the screen to landscape while it is up, and when
 * it goes - back, exit, or finishing the level - the web view and the game in it go with it.
 *
 * The bridge carries little: the session and settings in, a command now and then, and milestone
 * events out. Results are saved here, by the app, not by the page.
 */
@Component({
  selector: 'bwbt-gameplay',
  imports: [Button, DomComponent, Pressable, Switch, Text, View],
  host: { style: 'flex: 1' },
  template: `
    <view class="root">
      <dom-component
        class="game"
        testID="game-view"
        [src]="gameView"
        [inputs]="{ session: session(), settings: settings(), command: command() }"
        [outputs]="{ gameEvent: onGameEvent }"
      />

      @if (!ready()) {
        <view class="loading">
          <text class="loading-title">{{ title() }}</text>
          <text class="loading-sub">بنجهّز البيت… 🏠</text>
        </view>
      }

      <pressable
        #p="pressable"
        class="pause"
        [attr.data-down]="p.pressed() ? 'yes' : 'no'"
        accessibilityRole="button"
        accessibilityLabel="إيقاف مؤقت"
        testID="pause-button"
        (press)="pause()"
      >
        <text class="pause-icon">❚❚</text>
      </pressable>

      @if (paused()) {
        <view class="shade">
          <view class="sheet">
            <text class="sheet-title">استراحة ☕</text>
            @if (objective()) {
              <text class="sheet-objective">المطلوب دلوقتي: {{ objective() }}</text>
            }
            <view class="row">
              <text class="row-label">الصوت</text>
              <switch [checked]="progress.settings().sound" (checkedChange)="progress.updateSettings({ sound: $event })" />
            </view>
            <view class="buttons">
              <bwbt-button label="كمّل" icon="▶️" (tap)="resume()" />
              <bwbt-button label="من الأول" icon="🔁" variant="sun" (tap)="restart()" />
              <bwbt-button label="خروج" variant="ghost" (tap)="exit()" />
            </view>
          </view>
        </view>
      }
    </view>
  `,
  styles: `
    .root {
      flex: 1;
      background-color: #2e2420;
    }
    .game {
      flex: 1;
    }
    .loading {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      align-items: center;
      justify-content: center;
      gap: 8px;
      background-color: #2e2420;
    }
    .loading-title {
      font-family: 'Baloo Bhaijaan 2';
      font-weight: 800;
      font-size: 32px;
      color: #fff4e6;
    }
    .loading-sub {
      font-family: 'Baloo Bhaijaan 2';
      font-size: 18px;
      color: #f6e3c6;
    }
    .pause {
      position: absolute;
      top: 12px;
      left: 14px;
      width: 52px;
      height: 52px;
      border-radius: 18px;
      border-width: 3px;
      border-color: #3b2416;
      background-color: #fffbf5;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 0 #3b2416;
    }
    .pause[data-down='yes'] {
      top: 15px;
      box-shadow: 0 1px 0 #3b2416;
    }
    .pause-icon {
      font-size: 18px;
      font-weight: 800;
      color: #3b2416;
    }
    .shade {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: rgba(46, 36, 32, 0.55);
      align-items: center;
      justify-content: center;
    }
    .sheet {
      width: 440px;
      padding: 24px;
      gap: 14px;
      border-radius: 28px;
      border-width: 3px;
      border-color: #3b2416;
      background-color: #fffbf5;
      align-items: stretch;
    }
    .sheet-title {
      font-family: 'Baloo Bhaijaan 2';
      font-weight: 800;
      font-size: 30px;
      text-align: center;
    }
    .sheet-objective {
      font-family: 'Baloo Bhaijaan 2';
      font-size: 17px;
      color: #7a5644;
      text-align: center;
    }
    .row {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      padding: 4px 8px;
    }
    .row-label {
      font-family: 'Baloo Bhaijaan 2';
      font-weight: 600;
      font-size: 18px;
    }
    .buttons {
      gap: 10px;
    }
  `,
})
export class GameplayScreen {
  readonly sceneId = input.required<SceneId>();
  /** Two-phone play: the session carries the room, and results follow the host. */
  readonly coop = input(false);
  private readonly coopSession = inject(CoopSession);

  protected readonly gameView = gameView;
  protected readonly progress = inject(Progress);
  private readonly nav = inject(Navigator);
  private readonly sessionCounter = signal(1);

  protected readonly ready = signal(false);
  protected readonly paused = signal(false);
  protected readonly objective = signal('');
  protected readonly command = signal<GameCommand | null>(null);

  protected readonly title = computed(() => {
    const id = this.sceneId();
    return isLevelId(id) ? levelContent(id).title : 'تجربة التكامل';
  });

  protected readonly session = computed<GameSession>(() => {
    const profile = this.progress.profile();
    const net = this.coop() ? this.coopSession.netConfig() : null;
    // Two phones play with the host's names and outfits, each as its own character.
    return {
      sceneId: this.sceneId(),
      sessionId: this.sessionCounter(),
      lead: net?.me ?? profile.lead,
      names: (net && this.coopSession.names()) || profile.names,
      outfits: (net && this.coopSession.outfits()) || profile.outfits,
      devMode: this.progress.settings().devMode,
      ...(net ? { net } : {}),
    };
  });

  protected readonly settings = computed(() => {
    const { sound, volume, hints, reducedMotion } = this.progress.settings();
    return { sound, volume, hints, reducedMotion };
  });

  private seq = 0;
  private readonly haptics = inject(Haptics);
  private readonly vibration = inject(Vibration);

  constructor() {
    const unlock = inject(DeviceOrientation).lock('landscape');
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(unlock);
    // Nobody touches the screen while thinking out loud together: keep it on during play.
    destroyRef.onDestroy(inject(KeepAwake).hold('gameplay'));
    const stopBack = inject(HardwareBack).handle(() => {
      if (this.paused()) this.resume();
      else this.pause();
      return true;
    });
    destroyRef.onDestroy(stopBack);
    // A call or a switch to another app pauses the game rather than playing on unseen.
    const appState = inject(AppState);
    effect(() => {
      if (!appState.active() && this.ready() && !untracked(this.paused)) untracked(() => this.pause());
    });
  }

  protected readonly onGameEvent = (event: GameEvent) => {
    switch (event.type) {
      case 'ready':
        this.ready.set(true);
        break;
      case 'objective':
        this.objective.set(event.text);
        break;
      case 'paused':
        this.paused.set(true);
        break;
      case 'resumed':
        this.paused.set(false);
        break;
      case 'complete': {
        const unlocked = this.progress.recordResult(event.result);
        this.vibration.pattern([0, 60, 80, 60, 80, 120]);
        this.nav.replace({ name: 'result', result: event.result, unlocked, coop: this.coop() });
        break;
      }
      case 'haptic':
        this.feel(event.kind);
        break;
      case 'vibrate':
        // The partner needs a hand: two short pulses.
        this.vibration.pattern([0, 90, 70, 90]);
        break;
      case 'net':
        this.netStatus.set(event.status);
        break;
      default:
        break;
    }
  };

  protected readonly netStatus = signal<string>('');

  private feel(kind: HapticKind): void {
    if (kind === 'success' || kind === 'warning' || kind === 'error') this.haptics.notify(kind);
    else this.haptics.impact(kind);
  }

  protected pause(): void {
    this.paused.set(true);
    this.send('pause');
  }

  protected resume(): void {
    this.paused.set(false);
    this.send('resume');
  }

  protected restart(): void {
    this.paused.set(false);
    this.send('restart');
  }

  protected exit(): void {
    this.nav.back();
  }

  private send(kind: GameCommandKind): void {
    this.command.set({ seq: ++this.seq, kind });
  }
}
