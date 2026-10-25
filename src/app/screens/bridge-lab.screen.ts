import { Component, computed, inject, signal } from '@angular/core';
import { ScrollView, Text, View } from '@ng-native/components';
import { DomComponent } from '@ng-native/expo/dom-component';
import type { GameCommand, GameCommandKind, GameEvent, GameSession, GameSettings } from '../../game/bridge/protocol.ts';
import gameView from '../../web/game-view.ts';
import { Progress } from '../services/progress.ts';
import { Button } from '../ui/button.ts';
import { ScreenFrame } from '../ui/screen-frame.ts';

/**
 * The Phase 0 integration spike, kept as a diagnostics screen: the Phaser sandbox in a DOM
 * component beside a live log of every JSON message it sends, and buttons that exercise each
 * direction of the bridge and the web view's lifecycle (unmount and remount the game).
 */
@Component({
  selector: 'bwbt-bridge-lab',
  imports: [Button, DomComponent, ScreenFrame, ScrollView, Text, View],
  host: { style: 'flex: 1' },
  template: `
    <bwbt-screen title="اختبار الربط · NG Native ⇄ Phaser">
      <view class="layout">
        <view class="stage">
          @if (mounted()) {
            <dom-component
              class="game"
              [src]="gameView"
              [inputs]="{ session: session(), settings: settings(), command: command() }"
              [outputs]="{ gameEvent: onEvent }"
            />
          } @else {
            <view class="unmounted"><text class="body light">اللعبة مقفولة (web view اتشال) — دوسوا «ركّب تاني»</text></view>
          }
        </view>
        <view class="panel">
          <view class="row wrap">
            <bwbt-button label="إيقاف" size="sm" variant="ghost" (tap)="send('pause')" />
            <bwbt-button label="كمّل" size="sm" variant="ghost" (tap)="send('resume')" />
            <bwbt-button label="إعادة" size="sm" variant="ghost" (tap)="send('restart')" />
            <bwbt-button [label]="sound() ? 'صوت: شغال' : 'صوت: مقفول'" size="sm" variant="ghost" (tap)="sound.set(!sound())" />
            <bwbt-button label="جلسة جديدة" size="sm" variant="ghost" (tap)="sessionId.set(sessionId() + 1)" />
            <bwbt-button [label]="mounted() ? 'شيل اللعبة' : 'ركّب تاني'" size="sm" variant="sun" (tap)="toggleMount()" />
          </view>
          <text class="muted">رسايل وصلت: {{ received() }} · آخر fps: {{ fps() }} · تفاعلات: {{ interactions() }}</text>
          <scroll-view class="log" contentContainerClass="log-body">
            @for (line of log(); track $index) {
              <text class="line">{{ line }}</text>
            }
          </scroll-view>
        </view>
      </view>
    </bwbt-screen>
  `,
  styleUrl: '../ui/kit.css',
  styles: `
    .layout {
      flex: 1;
      flex-direction: row;
      gap: 14px;
    }
    .stage {
      flex: 1.5;
      border-radius: 20px;
      border-width: 3px;
      border-color: #3b2416;
      overflow: hidden;
      background-color: #2e2420;
    }
    .game {
      flex: 1;
    }
    .unmounted {
      flex: 1;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .light {
      color: #fff4e6;
    }
    .panel {
      flex: 1;
      gap: 8px;
    }
    .wrap {
      flex-wrap: wrap;
      gap: 6px;
    }
    .log {
      flex: 1;
      border-radius: 14px;
      background-color: #2e2420;
    }
    .log-body {
      padding: 8px;
      gap: 2px;
    }
    .line {
      font-family: monospace;
      font-size: 11px;
      color: #cde8da;
      text-align: left;
    }
  `,
})
export class BridgeLabScreen {
  protected readonly gameView = gameView;
  private readonly progress = inject(Progress);
  protected readonly mounted = signal(true);
  protected readonly sound = signal(true);
  protected readonly sessionId = signal(1);
  protected readonly command = signal<GameCommand | null>(null);
  protected readonly log = signal<string[]>([]);
  protected readonly received = signal(0);
  protected readonly fps = signal('-');
  protected readonly interactions = signal(0);
  private seq = 0;

  protected readonly session = computed<GameSession>(() => ({
    sceneId: 'sandbox',
    sessionId: this.sessionId(),
    lead: this.progress.profile().lead,
    names: this.progress.profile().names,
    outfits: this.progress.profile().outfits,
    devMode: true,
  }));

  protected readonly settings = computed<GameSettings>(() => ({ ...this.progress.settings(), sound: this.sound() }));

  protected readonly onEvent = (event: GameEvent) => {
    this.received.update((n) => n + 1);
    if (event.type === 'perf') this.fps.set(String(event.fps));
    if (event.type === 'interaction') this.interactions.update((n) => n + 1);
    this.write(`← ${JSON.stringify(event)}`);
  };

  protected send(kind: GameCommandKind): void {
    this.command.set({ seq: ++this.seq, kind });
    this.write(`→ command ${kind} #${this.seq}`);
  }

  protected toggleMount(): void {
    this.mounted.set(!this.mounted());
    this.write(this.mounted() ? '↺ web view mounted' : '✕ web view unmounted (page torn down)');
  }

  private write(line: string): void {
    const time = new Date().toISOString().slice(11, 19);
    this.log.update((lines) => [`${time} ${line}`, ...lines].slice(0, 80));
  }
}
