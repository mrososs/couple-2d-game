import { Component, inject } from '@angular/core';
import { Image, Pressable, Text, View } from '@ng-native/components';
import { LEVELS, type LevelContent } from '../../game/domain/levels/content.ts';
import { Navigator } from '../services/navigator.ts';
import { Progress } from '../services/progress.ts';
import { ART } from '../ui/art.ts';
import { ScreenFrame } from '../ui/screen-frame.ts';

/** The three levels side by side: what each teaches, the stars earned, and which are still locked. */
@Component({
  selector: 'bwbt-level-select',
  imports: [Image, Pressable, ScreenFrame, Text, View],
  host: { style: 'flex: 1' },
  template: `
    <bwbt-screen title="المراحل">
      <view class="layout">
        @for (level of levels; track level.id; let i = $index) {
          @let open = progress.isUnlocked(level.id);
          @let record = progress.record(level.id);
          <pressable
            #p="pressable"
            class="level"
            [attr.data-open]="open ? 'yes' : 'no'"
            [attr.data-down]="p.pressed() ? 'yes' : 'no'"
            [disabled]="!open"
            accessibilityRole="button"
            [accessibilityLabel]="'المرحلة ' + level.number + ': ' + level.title + (open ? '' : '، مقفولة')"
            [accessibilityState]="{ disabled: !open }"
            [testID]="'level-' + level.number"
            (press)="play(level)"
          >
            <view class="pic" [style.backgroundColor]="level.color">
              <image class="pic-img" [source]="art.levels[i]" resizeMode="contain" />
              <view class="badge"><text class="badge-text">{{ level.number }}</text></view>
            </view>
            <view class="copy">
              <text class="h3">{{ level.emoji }} {{ level.title }}</text>
              <text class="muted">{{ level.tagline }}</text>
              <view class="chip"><text class="chip-text">بنتعلم: {{ level.learning }}</text></view>
            </view>
            <view class="foot">
              @if (open) {
                <text class="stars">
                  @for (s of [1, 2, 3]; track s) {
                    <text [class.on]="(record?.stars ?? 0) >= s">★</text>
                  }
                </text>
                <text class="go">{{ record ? 'العبوا تاني' : 'العبوا ▶' }}</text>
              } @else {
                <text class="locked">🔒 خلّصوا المرحلة اللي قبلها</text>
              }
            </view>
          </pressable>
        }
      </view>
      @if (progress.settings().devMode) {
        <pressable class="dev" accessibilityRole="button" (press)="nav.push({ name: 'game', sceneId: 'sandbox' })">
          <text class="muted">🧪 مرحلة التجربة (Phase 0 sandbox)</text>
        </pressable>
      }
    </bwbt-screen>
  `,
  styleUrl: '../ui/kit.css',
  styles: `
    .layout {
      flex: 1;
      flex-direction: row;
      gap: 18px;
    }
    .level {
      flex: 1;
      border-radius: 26px;
      border-width: 3px;
      border-color: #3b2416;
      background-color: #fffbf5;
      box-shadow: 0 5px 0 #3b2416;
      overflow: hidden;
    }
    .level[data-down='yes'] {
      box-shadow: 0 1px 0 #3b2416;
      margin-top: 4px;
    }
    .level[data-open='no'] {
      opacity: 0.6;
    }
    .pic {
      height: 128px;
      align-items: center;
      justify-content: center;
      border-bottom-width: 3px;
      border-color: #3b2416;
    }
    .pic-img {
      width: 200px;
      height: 122px;
    }
    .badge {
      position: absolute;
      top: 10px;
      right: 10px;
      width: 40px;
      height: 40px;
      border-radius: 20px;
      background-color: #fffbf5;
      border-width: 3px;
      border-color: #3b2416;
      align-items: center;
      justify-content: center;
    }
    .badge-text {
      font-family: 'Baloo Bhaijaan 2';
      font-weight: 800;
      font-size: 20px;
    }
    .copy {
      flex: 1;
      padding: 10px 14px 4px 14px;
      gap: 4px;
    }
    .foot {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      padding: 6px 14px 12px 14px;
    }
    .stars {
      font-size: 26px;
      color: #e8dcc8;
    }
    .on {
      color: #f2a93b;
    }
    .go {
      font-family: 'Baloo Bhaijaan 2';
      font-weight: 800;
      font-size: 17px;
      color: #c4553f;
    }
    .locked {
      font-family: 'Baloo Bhaijaan 2';
      font-size: 15px;
      color: #7a5644;
    }
    .dev {
      align-self: center;
      margin-top: 10px;
      padding: 4px 12px;
    }
  `,
})
export class LevelSelectScreen {
  protected readonly nav = inject(Navigator);
  protected readonly progress = inject(Progress);
  protected readonly levels = LEVELS;
  protected readonly art = ART;

  protected play(level: LevelContent): void {
    if (this.progress.isUnlocked(level.id)) this.nav.push({ name: 'game', sceneId: level.id });
  }
}
