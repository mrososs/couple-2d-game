import { Component, inject, signal } from '@angular/core';
import { Pressable, Switch, Text, View } from '@ng-native/components';
import { Navigator } from '../services/navigator.ts';
import { Progress } from '../services/progress.ts';
import type { AppSettings } from '../services/progress-rules.ts';
import { Button } from '../ui/button.ts';
import { ScreenFrame } from '../ui/screen-frame.ts';

type Toggle = 'sound' | 'hints' | 'reducedMotion' | 'devMode';

/** Sound and volume, hints, motion, developer tools, and resetting progress (asked twice). */
@Component({
  selector: 'bwbt-settings',
  imports: [Button, Pressable, ScreenFrame, Switch, Text, View],
  host: { style: 'flex: 1' },
  template: `
    <bwbt-screen title="الإعدادات">
      <view class="layout">
        <view class="card col">
          @for (t of toggles; track t.key) {
            <view class="row line">
              <view class="copy">
                <text class="h3">{{ t.emoji }} {{ t.title }}</text>
                <text class="muted">{{ t.sub }}</text>
              </view>
              <switch [checked]="settings()[t.key]" (checkedChange)="set(t.key, $event)" [accessibilityLabel]="t.title" />
            </view>
          }
        </view>
        <view class="card col">
          <text class="h3">🔊 علو الصوت</text>
          <view class="row steps">
            @for (v of volumes; track v) {
              <pressable
                class="step"
                [attr.data-on]="isVolume(v) ? 'yes' : 'no'"
                accessibilityRole="button"
                [accessibilityLabel]="'الصوت ' + v * 100 + '%'"
                [accessibilityState]="{ selected: isVolume(v) }"
                (press)="progress.updateSettings({ volume: v })"
              >
                <text class="step-text">{{ v * 100 }}%</text>
              </pressable>
            }
          </view>
          <view class="spacer"></view>
          @if (settings().devMode) {
            <bwbt-button label="اختبار الربط (Phase 0)" icon="🧪" variant="ghost" size="sm" (tap)="nav.push({ name: 'bridge' })" />
          }
          @if (confirmReset()) {
            <text class="body warn">متأكدين؟ النجوم والمراحل المفتوحة هتتمسح.</text>
            <view class="row gap">
              <bwbt-button label="أيوه، امسح" variant="danger" size="sm" (tap)="reset()" />
              <bwbt-button label="لأ" variant="ghost" size="sm" (tap)="confirmReset.set(false)" />
            </view>
          } @else {
            <bwbt-button label="ابدأوا من الأول" icon="🗑️" variant="ghost" size="sm" (tap)="confirmReset.set(true)" />
          }
          @if (didReset()) {
            <text class="muted">اتمسح التقدّم ✔</text>
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
      gap: 18px;
    }
    .col {
      flex: 1;
      gap: 8px;
    }
    .line {
      justify-content: space-between;
      gap: 12px;
      padding: 4px 0;
    }
    .copy {
      flex: 1;
    }
    .steps {
      gap: 8px;
    }
    .step {
      flex: 1;
      align-items: center;
      padding: 8px 0;
      border-radius: 14px;
      border-width: 3px;
      border-color: #3b2416;
      background-color: #fffbf5;
    }
    .step[data-on='yes'] {
      background-color: #ffd98e;
    }
    .step-text {
      font-family: 'Baloo Bhaijaan 2';
      font-weight: 800;
      font-size: 15px;
    }
    .spacer {
      flex: 1;
    }
    .gap {
      gap: 10px;
    }
    .warn {
      color: #b23a2e;
    }
  `,
})
export class SettingsScreen {
  protected readonly progress = inject(Progress);
  protected readonly nav = inject(Navigator);
  protected readonly settings = this.progress.settings;
  protected readonly confirmReset = signal(false);
  protected readonly didReset = signal(false);
  protected readonly volumes = [0.25, 0.5, 0.75, 1];
  protected readonly toggles: readonly { key: Toggle; emoji: string; title: string; sub: string }[] = [
    { key: 'sound', emoji: '🎵', title: 'الصوت', sub: 'مؤثرات صوتية خفيفة' },
    { key: 'hints', emoji: '💡', title: 'المساعدة', sub: 'تلميحات قصيرة وقت اللعب' },
    { key: 'reducedMotion', emoji: '🌿', title: 'حركة أقل', sub: 'بدون اهتزاز وتأثيرات أقل' },
    { key: 'devMode', emoji: '🧪', title: 'وضع المطوّر', sub: 'حدود الفيزياء وعدّاد الأداء ومرحلة التجربة' },
  ];

  protected set(key: Toggle, value: boolean): void {
    this.progress.updateSettings({ [key]: value } as Partial<AppSettings>);
  }

  protected isVolume(v: number): boolean {
    return Math.abs(this.settings().volume - v) < 0.01;
  }

  protected reset(): void {
    this.progress.resetProgress();
    this.confirmReset.set(false);
    this.didReset.set(true);
  }
}
