import { Component, inject, input } from '@angular/core';
import { Pressable, SafeAreaView, Text, View } from '@ng-native/components';
import { Navigator } from '../services/navigator.ts';

/**
 * The backdrop every menu screen sits on: warm paper with soft shapes, an optional top bar with a
 * back button and a title, and the screen's content below. The back button sits at the start edge,
 * which in this right-to-left app is the right.
 */
@Component({
  selector: 'bwbt-screen',
  imports: [Pressable, SafeAreaView, Text, View],
  host: { style: 'flex: 1' },
  template: `
    <view class="bg">
      <view class="blob a"></view>
      <view class="blob b"></view>
      <view class="blob c"></view>
    </view>
    <safe-area-view class="safe">
      @if (title()) {
        <view class="bar">
          @if (back()) {
            <pressable
              #p="pressable"
              class="back"
              [attr.data-down]="p.pressed() ? 'yes' : 'no'"
              accessibilityRole="button"
              accessibilityLabel="رجوع"
              (press)="nav.back()"
            >
              <text class="back-icon">→</text>
            </pressable>
          }
          <text class="title" accessibilityRole="header">{{ title() }}</text>
          <view class="spacer"></view>
        </view>
      }
      <view class="content">
        <ng-content />
      </view>
    </safe-area-view>
  `,
  styles: `
    .bg {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: #fff4e6;
      overflow: hidden;
    }
    .blob {
      position: absolute;
      border-radius: 999px;
    }
    .a {
      width: 420px;
      height: 420px;
      top: -180px;
      left: -120px;
      background-color: #ffe1c7;
    }
    .b {
      width: 320px;
      height: 320px;
      bottom: -160px;
      right: -60px;
      background-color: #d9efe6;
    }
    .c {
      width: 140px;
      height: 140px;
      top: 60px;
      right: 18%;
      background-color: #fde9b8;
      opacity: 0.7;
    }
    .safe {
      flex: 1;
    }
    .bar {
      flex-direction: row;
      align-items: center;
      gap: 14px;
      padding: 10px 20px 4px 20px;
    }
    .back {
      width: 48px;
      height: 48px;
      border-radius: 16px;
      border-width: 3px;
      border-color: #3b2416;
      background-color: #fffbf5;
      align-items: center;
      justify-content: center;
    }
    .back[data-down='yes'] {
      background-color: #f6e3c6;
    }
    .back-icon {
      font-size: 24px;
      font-weight: 800;
      color: #3b2416;
    }
    .title {
      font-family: 'Baloo Bhaijaan 2';
      font-weight: 800;
      font-size: 28px;
      color: #3b2416;
    }
    .spacer {
      flex: 1;
    }
    .content {
      flex: 1;
      padding: 8px 24px 16px 24px;
    }
  `,
})
export class ScreenFrame {
  readonly title = input('');
  readonly back = input(true);
  protected readonly nav = inject(Navigator);
}
