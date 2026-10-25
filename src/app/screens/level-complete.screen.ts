import { Component, computed, inject, input } from '@angular/core';
import { Image, ScrollView, Text, View } from '@ng-native/components';
import type { LevelId, LevelResult } from '../../game/bridge/protocol.ts';
import { levelContent } from '../../game/domain/levels/content.ts';
import { CoopSession } from '../services/coop.ts';
import { nextLevel } from '../services/progress-rules.ts';
import { Navigator } from '../services/navigator.ts';
import { ART } from '../ui/art.ts';
import { Button } from '../ui/button.ts';
import { ScreenFrame } from '../ui/screen-frame.ts';

/**
 * Level completion and its educational feedback: stars that reward the approach, the insights
 * this particular playthrough earned, the one takeaway of the level, and - for the health and
 * safety content - where it comes from and that it is not medical advice.
 */
@Component({
  selector: 'bwbt-level-complete',
  imports: [Button, Image, ScreenFrame, ScrollView, Text, View],
  host: { style: 'flex: 1' },
  template: `
    <bwbt-screen [back]="false">
      <view class="layout">
        <scroll-view class="scroll" contentContainerClass="scroll-body">
          <text class="muted">المرحلة {{ level().number }} · {{ level().title }}</text>
          <text class="h1" accessibilityRole="header">برافو عليكم! 🎉</text>
          <text class="stars" [accessibilityLabel]="result().stars + ' نجوم من 3'">
            @for (s of [1, 2, 3]; track s) {
              <text [class.on]="result().stars >= s">★</text>
            }
          </text>
          <text class="body">⏱️ {{ time() }} · 🏅 {{ level().badge.emoji }} {{ level().badge.name }}</text>

          <view class="takeaway card">
            <text class="h2">💡 {{ level().takeaway.title }}</text>
            <text class="body">{{ level().takeaway.body }}</text>
          </view>

          <text class="h3 section">اللي عملتوه حلو</text>
          @for (insight of insights(); track insight.title) {
            <view class="insight">
              <text class="insight-emoji">{{ insight.emoji }}</text>
              <view class="insight-copy">
                <text class="h3">{{ insight.title }}</text>
                <text class="body">{{ insight.body }}</text>
              </view>
            </view>
          }

          @if (level().disclaimer) {
            <text class="muted disclaimer">ℹ️ {{ level().disclaimer }}</text>
          }
          @if (level().sources.length) {
            <text class="h3 section">المصادر</text>
            @for (s of level().sources; track s.url) {
              <text class="muted">• {{ s.publisher }} — {{ s.title }}</text>
            }
          }
        </scroll-view>
        <view class="side">
          <image class="hero" [source]="art.coupleCheer" alt="منى وكريم فرحانين" resizeMode="contain" />
          @if (unlocked()) {
            <text class="unlocked">🔓 اتفتحت المرحلة الجاية!</text>
          }
          @if (coop() && coopSession.role() === 'guest') {
            <text class="waiting">🎮 مستنيين {{ coopSession.partnerName() }} يختار المرحلة الجاية…</text>
            <bwbt-button label="الغرفة" variant="ghost" (tap)="toMenu()" />
          } @else {
            @if (next()) {
              <bwbt-button label="المرحلة الجاية" icon="▶️" testID="next-level" (tap)="playNext()" />
            }
            <bwbt-button label="العبوا تاني" icon="🔁" variant="sun" (tap)="replay()" />
            <bwbt-button [label]="coop() ? 'الغرفة' : 'القايمة'" variant="ghost" (tap)="toMenu()" />
          }
        </view>
      </view>
    </bwbt-screen>
  `,
  styleUrl: '../ui/kit.css',
  styles: `
    .layout {
      flex: 1;
      flex-direction: row;
      gap: 20px;
    }
    .scroll {
      flex: 1.6;
    }
    .scroll-body {
      gap: 8px;
      padding-bottom: 24px;
    }
    .stars {
      font-size: 54px;
      color: #e8dcc8;
      line-height: 64px;
    }
    .on {
      color: #f2a93b;
    }
    .takeaway {
      gap: 4px;
      background-color: #fff1c9;
      margin-top: 6px;
    }
    .section {
      margin-top: 10px;
    }
    .insight {
      flex-direction: row;
      gap: 12px;
      align-items: flex-start;
      padding: 10px 12px;
      border-radius: 18px;
      border-width: 2px;
      border-color: #e2cdb0;
      background-color: #fffbf5;
    }
    .insight-emoji {
      font-size: 28px;
    }
    .insight-copy {
      flex: 1;
    }
    .disclaimer {
      margin-top: 8px;
    }
    .side {
      flex: 1;
      gap: 8px;
      justify-content: center;
    }
    .hero {
      width: 180px;
      height: 120px;
      align-self: center;
    }
    .waiting {
      font-family: 'Baloo Bhaijaan 2';
      font-weight: 600;
      font-size: 17px;
      text-align: center;
      color: #5b3a29;
    }
    .unlocked {
      font-family: 'Baloo Bhaijaan 2';
      font-weight: 800;
      font-size: 18px;
      color: #2a9d8f;
      text-align: center;
    }
  `,
})
export class LevelCompleteScreen {
  readonly result = input.required<LevelResult>();
  readonly unlocked = input<string | null>(null);
  /** Two-phone play: the host chooses what comes next, for both phones. */
  readonly coop = input(false);
  protected readonly coopSession = inject(CoopSession);

  private readonly nav = inject(Navigator);
  protected readonly art = ART;
  protected readonly level = computed(() => levelContent(this.result().levelId));
  protected readonly next = computed<LevelId | null>(() => nextLevel(this.result().levelId));
  protected readonly insights = computed(() => {
    const table = this.level().insights;
    return this.result()
      .insights.map((key) => table[key])
      .filter((i) => !!i);
  });
  protected readonly time = computed(() => {
    const s = this.result().durationSec;
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  });

  protected playNext(): void {
    const next = this.next();
    if (!next) return;
    if (this.coop()) this.coopSession.startLevel(next);
    else this.nav.replace({ name: 'game', sceneId: next });
  }

  protected replay(): void {
    if (this.coop()) this.coopSession.startLevel(this.result().levelId);
    else this.nav.replace({ name: 'game', sceneId: this.result().levelId });
  }

  protected toMenu(): void {
    this.nav.back();
  }
}
