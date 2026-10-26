import { Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Pressable, Switch, Text, View } from '@ng-native/components';
import { AppState, HardwareBack, Vibration } from '@ng-native/device';
import { DomComponent } from '@ng-native/expo/dom-component';
import { Haptics } from '@ng-native/expo/haptics';
import { KeepAwake } from '@ng-native/expo/keep-awake';
import { DeviceOrientation } from '@ng-native/expo/orientation';
import { isLevelId, type GameCommand, type GameCommandKind, type GameEvent, type GameSession, type SceneId } from '../../game/bridge/protocol.ts';
import { levelContent } from '../../game/domain/levels/content.ts';
import type { HapticKind, PauseReason } from '../../game/net/protocol.ts';
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

      @if (roomGone(); as gone) {
        <view class="shade">
          <view class="sheet" testID="room-gone">
            <text class="sheet-title">{{ gone === 'host-left' ? '🚪 ' + partner() + ' خرج من المرحلة' : '📡 الغرفة اتقفلت' }}</text>
            <text class="sheet-objective">
              {{ gone === 'host-left' ? 'ارجعوا للغرفة وابدأوا المرحلة تاني لما تجهزوا.' : 'افتحوا غرفة جديدة على موبايل واحد منكم.' }}
            </text>
            <view class="buttons">
              <bwbt-button label="ارجع للغرفة" icon="🏠" testID="back-to-room" (tap)="exit()" />
            </view>
          </view>
        </view>
      } @else if (paused()) {
        <view class="shade">
          @if (onlyPartnerAway()) {
            <view class="sheet" testID="waiting-partner">
              <text class="sheet-title">📡 مستنيين {{ partner() }}…</text>
              <text class="sheet-objective">{{ role() === 'host' ? 'الاتصال اتقطع — بنحاول نرجع الاتصال. اللعب واقف لحد ما يرجع.' : 'بنحاول نرجع الاتصال…' }}</text>
              <text class="sheet-hint">اتأكدوا إن الموبايلين على نفس الشبكة</text>
              <view class="buttons">
                <bwbt-button label="خروج" variant="ghost" (tap)="exit()" />
              </view>
            </view>
          } @else {
            <view class="sheet" testID="pause-sheet">
              <text class="sheet-title">{{ pausedByPartnerOnly() ? partner() + ' وقّف اللعب ☕' : 'استراحة ☕' }}</text>
              @if (pausedByPartnerOnly() && role() === 'guest') {
                <text class="sheet-objective">مستنيين {{ partner() }} يكمّل</text>
              } @else if (objective()) {
                <text class="sheet-objective">المطلوب دلوقتي: {{ objective() }}</text>
              }
              @if (restartAsked()) {
                <view class="ask" testID="restart-request">
                  <text class="ask-text">{{ partner() }} عايز يبدأ المرحلة من الأول 🔁</text>
                  <view class="ask-buttons">
                    <bwbt-button label="ابدأوا من الأول" size="sm" testID="accept-restart" (tap)="restart()" />
                    <bwbt-button label="لا، نكمّل" size="sm" variant="ghost" testID="decline-restart" (tap)="decline()" />
                  </view>
                </view>
              }
              @if (notice()) {
                <text class="sheet-hint">{{ notice() }}</text>
              }
              <view class="row">
                <text class="row-label">الصوت</text>
                <switch [checked]="progress.settings().sound" (checkedChange)="progress.updateSettings({ sound: $event })" />
              </view>
              <view class="buttons">
                @if (!(pausedByPartnerOnly() && role() === 'guest')) {
                  <bwbt-button label="كمّل" icon="▶️" testID="resume" (tap)="resume()" />
                }
                @if (role() === 'guest') {
                  <bwbt-button label="نبدأ من الأول؟" icon="🔁" variant="sun" testID="ask-restart" [disabled]="restartPending()" (tap)="restart()" />
                } @else {
                  <bwbt-button label="من الأول" icon="🔁" variant="sun" testID="restart" (tap)="restart()" />
                }
                <bwbt-button label="خروج" variant="ghost" (tap)="exit()" />
              </view>
            </view>
          }
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
    .sheet-hint {
      font-family: 'Baloo Bhaijaan 2';
      font-size: 15px;
      color: #9a7660;
      text-align: center;
    }
    .ask {
      gap: 8px;
      padding: 12px;
      border-radius: 18px;
      border-width: 2px;
      border-color: #f2a93b;
      background-color: #fff1d6;
    }
    .ask-text {
      font-family: 'Baloo Bhaijaan 2';
      font-weight: 800;
      font-size: 17px;
      text-align: center;
      color: #3b2416;
    }
    .ask-buttons {
      flex-direction: row;
      gap: 8px;
      justify-content: center;
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
  /** Why the shared game is paused (two phones); empty with one. */
  protected readonly pauseReasons = signal<readonly PauseReason[]>([]);
  protected readonly objective = signal('');
  protected readonly command = signal<GameCommand | null>(null);
  /** Host: the partner asked to start the level again. */
  protected readonly restartAsked = signal(false);
  /** Guest: a restart request is waiting for the host's answer. */
  protected readonly restartPending = signal(false);
  protected readonly notice = signal<string | null>(null);
  /** Two phones: the room or the level is gone, and this phone can only go back. */
  protected readonly roomGone = signal<'host-left' | 'closed' | null>(null);

  protected readonly role = computed(() => (this.coop() ? this.coopSession.role() : null));
  protected readonly partner = computed(() => this.coopSession.partnerName() ?? 'شريكك');
  protected readonly onlyPartnerAway = computed(() => {
    const r = this.pauseReasons();
    return r.length > 0 && r.every((x) => x === 'partner');
  });
  /** Paused by the other phone's player and not by this one. */
  protected readonly pausedByPartnerOnly = computed(() => {
    const r = this.pauseReasons();
    const mine = this.role() === 'guest' ? 'guest' : 'host';
    const theirs = this.role() === 'guest' ? 'host' : 'guest';
    return r.includes(theirs) && !r.includes(mine);
  });

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
  /** The level was completed (rather than left). */
  private finished = false;
  private readonly haptics = inject(Haptics);
  private readonly vibration = inject(Vibration);

  constructor() {
    const unlock = inject(DeviceOrientation).lock('landscape');
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(unlock);
    // Nobody touches the screen while thinking out loud together: keep it on during play.
    destroyRef.onDestroy(inject(KeepAwake).hold('gameplay'));
    // The host leaving the level takes the partner's phone back to the room too - but not when
    // the level was finished, which takes both phones to the result screen instead.
    destroyRef.onDestroy(() => {
      if (this.coop() && !this.finished) this.coopSession.levelEnded();
    });
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
        this.pauseReasons.set(event.reasons ?? []);
        break;
      case 'resumed':
        this.paused.set(false);
        this.pauseReasons.set([]);
        this.restartAsked.set(false);
        this.notice.set(null);
        break;
      case 'request':
        this.restartAsked.set(true);
        this.vibration.pattern([0, 70, 60, 70]);
        break;
      case 'answer':
        this.restartPending.set(false);
        this.notice.set(event.ok ? null : `${this.partner()} فضّل تكمّلوا 🙂`);
        break;
      case 'complete': {
        // Saved once, however it arrives: the partner's phone also hears it through the lobby.
        this.finished = true;
        const unlocked = this.progress.recordResult(event.result);
        if (this.coop()) {
          this.coopSession.shareResult(event.result);
          this.coopSession.levelFinished();
        }
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
        if (event.status === 'host-left' || event.status === 'closed') this.roomGone.set(event.status);
        else if (event.status === 'online') this.roomGone.set(null);
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

  /** The host's resume lifts both players' pause; the guest's lifts its own (a request). */
  protected resume(): void {
    if (this.role() !== 'guest' || this.pauseReasons().every((r) => r === 'guest')) this.paused.set(false);
    this.send('resume');
  }

  /** The host restarts for both; the guest asks the host. */
  protected restart(): void {
    if (this.role() === 'guest') {
      this.restartPending.set(true);
      this.notice.set(`طلبنا من ${this.partner()}… ⏳`);
      this.send('restart');
      return;
    }
    this.restartAsked.set(false);
    this.paused.set(false);
    this.send('restart');
  }

  protected decline(): void {
    this.restartAsked.set(false);
    this.send('decline');
  }

  protected exit(): void {
    this.nav.back();
  }

  private send(kind: GameCommandKind): void {
    this.command.set({ seq: ++this.seq, kind });
  }
}
