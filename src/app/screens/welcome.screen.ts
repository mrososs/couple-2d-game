import { Component, inject } from '@angular/core';
import { Image, Text, View } from '@ng-native/components';
import { Navigator } from '../services/navigator.ts';
import { Progress } from '../services/progress.ts';
import { ART } from '../ui/art.ts';
import { Button } from '../ui/button.ts';
import { ScreenFrame } from '../ui/screen-frame.ts';

/** The first screen: the title, the couple, and one big button in. */
@Component({
  selector: 'bwbt-welcome',
  imports: [Button, Image, ScreenFrame, Text, View],
  host: { style: 'flex: 1' },
  template: `
    <bwbt-screen>
      <view class="layout">
        <view class="copy">
          <view class="chip"><text class="chip-text">لعبة تعاونية لاتنين 💛</text></view>
          <text class="h1 title" accessibilityRole="header">قبل ما نبقى تلاتة</text>
          <text class="body lead">
            بيت واحد، شخصيتين، وأول بيبي في الطريق. اتكلموا، خطّطوا، وشيلوا مع بعض — حرفيًا.
          </text>
          <view class="actions">
            <bwbt-button label="يلا نبدأ" icon="▶️" size="lg" testID="start" (tap)="start()" />
            <bwbt-button label="الشخصيات" variant="ghost" (tap)="nav.push({ name: 'characters' })" />
          </view>
          @if (!progress.ready()) {
            <text class="muted">بنفتكر آخر حاجة وصلتولها…</text>
          }
        </view>
        <view class="art">
          <view class="sun"></view>
          <image class="couple" [source]="art.couple" alt="منى وكريم مستنيين أول بيبي" resizeMode="contain" />
        </view>
      </view>
    </bwbt-screen>
  `,
  styleUrl: '../ui/kit.css',
  styles: `
    .layout {
      flex: 1;
      flex-direction: row;
      align-items: center;
      gap: 24px;
    }
    .copy {
      flex: 1.1;
      flex-shrink: 1;
      min-width: 0;
      gap: 12px;
    }
    .title {
      font-size: 56px;
      line-height: 76px;
    }
    .lead {
      font-size: 20px;
      line-height: 32px;
      max-width: 520px;
    }
    .actions {
      flex-direction: row;
      flex-wrap: wrap;
      align-items: center;
      gap: 14px;
      margin-top: 8px;
    }
    .art {
      flex: 1;
      min-width: 0;
      align-items: center;
      justify-content: center;
    }
    .sun {
      position: absolute;
      width: 300px;
      height: 300px;
      border-radius: 150px;
      background-color: #ffd98e;
      border-width: 3px;
      border-color: #3b2416;
    }
    .couple {
      width: 360px;
      height: 264px;
    }
    /* Narrow or portrait windows: the couple above, the words and buttons below, all smaller. */
    @media (max-width: 760px) {
      .layout {
        flex-direction: column-reverse;
        justify-content: center;
        gap: 12px;
      }
      .copy {
        flex-grow: 0;
        flex-shrink: 0;
        flex-basis: auto;
        align-self: stretch;
      }
      .art {
        flex-grow: 0;
        flex-shrink: 0;
        flex-basis: auto;
        height: 190px;
        align-self: stretch;
      }
      .sun {
        width: 180px;
        height: 180px;
        border-radius: 90px;
      }
      .couple {
        width: 220px;
        height: 160px;
      }
      .title {
        font-size: 40px;
        line-height: 56px;
      }
      .lead {
        font-size: 17px;
        line-height: 26px;
      }
    }
  `,
})
export class WelcomeScreen {
  protected readonly nav = inject(Navigator);
  protected readonly progress = inject(Progress);
  protected readonly art = ART;

  protected start(): void {
    if (this.progress.save().onboarded) this.nav.push({ name: 'menu' });
    else this.nav.push({ name: 'characters' });
  }
}
