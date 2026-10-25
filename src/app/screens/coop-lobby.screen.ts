import { Component, computed, effect, inject, signal } from '@angular/core';
import { Image, Text, TextInput, View } from '@ng-native/components';
import { Sharing, Vibration } from '@ng-native/device';
import { LEVELS } from '../../game/domain/levels/content.ts';
import { CoopSession } from '../services/coop.ts';
import { Progress } from '../services/progress.ts';
import { portrait } from '../ui/art.ts';
import { Button } from '../ui/button.ts';
import { ScreenFrame } from '../ui/screen-frame.ts';

/**
 * Two-phone play: one partner opens a room on their phone and reads out the short code, the other
 * types it in. Both phones need the same Wi-Fi - or one phone's hotspot with the other connected
 * to it; no internet is used. Once paired, the host picks the level and both phones open it.
 */
@Component({
  selector: 'bwbt-coop-lobby',
  imports: [Button, Image, ScreenFrame, Text, TextInput, View],
  host: { style: 'flex: 1' },
  template: `
    <bwbt-screen title="العبوا على موبايلين 📱📱">
      @switch (coop.phase()) {
        @case ('idle') {
          <view class="choices">
            <view class="card choice">
              <text class="big-emoji">🏠</text>
              <text class="h2">أنا هفتح الغرفة</text>
              <text class="body">هيظهر كود قصير تقوله لشريكك</text>
              <bwbt-button label="افتح غرفة" icon="📡" testID="coop-host" [disabled]="!coop.canHost" (tap)="coop.host()" />
              @if (!coop.canHost) {
                <text class="muted">فتح الغرفة محتاج نسخة أندرويد</text>
              }
            </view>
            <view class="card choice">
              <text class="big-emoji">🔑</text>
              <text class="h2">هدخل غرفة شريكي</text>
              <text-input
                class="code"
                placeholder="الكود، زي: 23-58"
                [value]="code()"
                (changeText)="code.set($event)"
                keyboardType="numbers-and-punctuation"
                accessibilityLabel="كود الغرفة"
                testID="coop-code"
              />
              <bwbt-button label="ادخل" icon="➡️" variant="secondary" testID="coop-join" [disabled]="code().trim().length < 2" (tap)="coop.join(code())" />
            </view>
          </view>
          <text class="muted hint">📶 لازم الموبايلين على نفس الواي فاي — أو شغّلوا هوت سبوت من موبايل ووصّلوا التاني عليه. مش محتاجين إنترنت.</text>
        }
        @case ('error') {
          <view class="card center">
            <text class="big-emoji">😕</text>
            <text class="h2">{{ coop.error() }}</text>
            <bwbt-button label="جرّبوا تاني" icon="🔁" (tap)="coop.leave()" />
          </view>
        }
        @default {
          <view class="room">
            <view class="card status">
              @if (coop.role() === 'host') {
                <text class="muted">كود الغرفة</text>
                <text class="room-code" testID="room-code">{{ coop.roomCode() }}</text>
                <bwbt-button label="ابعت الكود" icon="📤" variant="ghost" size="sm" (tap)="share()" />
              } @else {
                <text class="muted">داخلين غرفة</text>
                <text class="room-code small">{{ coop.roomCode() }}</text>
              }
              <view class="row pair">
                <view class="who">
                  <image class="face" [source]="face(coop.me() ?? 'wife')" />
                  <text class="h3">{{ myName() }}</text>
                  <text class="muted">ده إنت/إنتي</text>
                </view>
                <text class="link">{{ coop.paired() && coop.partnerOnline() ? '🤝' : '⏳' }}</text>
                <view class="who">
                  <image class="face" [class.away]="!coop.paired()" [source]="face(partnerId())" />
                  <text class="h3">{{ partnerLabel() }}</text>
                  <text class="muted">{{ coop.paired() ? (coop.partnerOnline() ? 'متصل' : 'بيحاول يرجع…') : 'مستنيين…' }}</text>
                </view>
              </view>
              <bwbt-button label="اقفل الغرفة" variant="ghost" size="sm" (tap)="coop.leave()" />
            </view>
            <view class="card levels">
              @if (coop.role() === 'host') {
                <text class="h3">اختاروا المرحلة</text>
                @for (level of levels; track level.id) {
                  <bwbt-button
                    [label]="level.number + '. ' + level.title"
                    [icon]="level.emoji"
                    [variant]="progress.isUnlocked(level.id) ? 'primary' : 'ghost'"
                    size="sm"
                    [disabled]="!coop.paired() || !progress.isUnlocked(level.id)"
                    [testID]="'coop-level-' + level.number"
                    (tap)="coop.startLevel(level.id)"
                  />
                }
                @if (!coop.paired()) {
                  <text class="muted">المراحل هتتفتح أول ما شريكك يدخل</text>
                }
              } @else {
                <text class="big-emoji">🎮</text>
                <text class="h3">{{ coop.paired() ? 'مستنيين ' + coop.partnerName() + ' يختار المرحلة…' : 'بنوصل…' }}</text>
                <text class="muted">كل واحد هيتحكم في شخصيته من موبايله</text>
              }
            </view>
          </view>
        }
      }
    </bwbt-screen>
  `,
  styleUrl: '../ui/kit.css',
  styles: `
    .choices {
      flex: 1;
      flex-direction: row;
      gap: 18px;
    }
    .choice {
      flex: 1;
      gap: 10px;
      align-items: center;
      justify-content: center;
    }
    .big-emoji {
      font-size: 40px;
    }
    .code {
      align-self: stretch;
      font-family: 'Baloo Bhaijaan 2';
      font-weight: 800;
      font-size: 26px;
      text-align: center;
      border-width: 2px;
      border-color: #d9c2a3;
      border-radius: 14px;
      padding: 4px 12px;
      background-color: #ffffff;
      color: #3b2416;
    }
    .hint {
      text-align: center;
      margin-top: 10px;
    }
    .center {
      flex: 1;
      align-items: center;
      justify-content: center;
      gap: 12px;
    }
    .room {
      flex: 1;
      flex-direction: row;
      gap: 18px;
    }
    .status {
      flex: 1.2;
      align-items: center;
      gap: 8px;
    }
    .room-code {
      font-family: 'Baloo Bhaijaan 2';
      font-weight: 800;
      font-size: 54px;
      line-height: 66px;
      color: #c4553f;
      letter-spacing: 4px;
    }
    .small {
      font-size: 30px;
      line-height: 40px;
    }
    .pair {
      gap: 14px;
      justify-content: center;
    }
    .who {
      align-items: center;
    }
    .face {
      width: 72px;
      height: 72px;
      border-radius: 36px;
      border-width: 3px;
      border-color: #3b2416;
      background-color: #ffe1c7;
    }
    .away {
      opacity: 0.35;
    }
    .link {
      font-size: 34px;
    }
    .levels {
      flex: 1;
      gap: 8px;
      justify-content: center;
    }
  `,
})
export class CoopLobbyScreen {
  protected readonly coop = inject(CoopSession);
  protected readonly progress = inject(Progress);
  private readonly sharing = inject(Sharing);
  protected readonly levels = LEVELS;
  protected readonly code = signal('');

  protected readonly partnerId = computed(() => (this.coop.me() === 'wife' ? 'husband' : 'wife'));
  protected readonly myName = computed(() => {
    const me = this.coop.me();
    return me && this.coop.names() ? this.coop.names()![me] : '';
  });
  protected readonly partnerLabel = computed(() => this.coop.partnerName() ?? 'شريكك');

  constructor() {
    // A buzz when the partner arrives, so nobody has to keep looking at the screen.
    const vibration = inject(Vibration);
    let wasPaired = false;
    effect(() => {
      const paired = this.coop.paired();
      if (paired && !wasPaired) vibration.pattern([0, 70, 60, 70]);
      wasPaired = paired;
    });
  }

  protected face(id: 'wife' | 'husband') {
    const outfits = this.coop.outfits() ?? this.progress.profile().outfits;
    return portrait(id, outfits[id]);
  }

  protected share(): void {
    void this.sharing.share({ message: `تعالى نلعب «قبل ما نبقى تلاتة» سوا 💛 كود الغرفة: ${this.coop.roomCode()}`, title: 'كود الغرفة' });
  }
}
