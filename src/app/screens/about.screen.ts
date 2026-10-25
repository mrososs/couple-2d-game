import { Component } from '@angular/core';
import { ScrollView, Text, View } from '@ng-native/components';
import { LEVELS } from '../../game/domain/levels/content.ts';
import { ScreenFrame } from '../ui/screen-frame.ts';

/** What the game is for, how it teaches, where its health content comes from, and credits. */
@Component({
  selector: 'bwbt-about',
  imports: [ScreenFrame, ScrollView, Text, View],
  host: { style: 'flex: 1' },
  template: `
    <bwbt-screen title="عن اللعبة">
      <scroll-view class="scroll" contentContainerClass="body-wrap">
        <view class="card">
          <text class="h2">لعبة، مش امتحان</text>
          <text class="body">
            «قبل ما نبقى تلاتة» لعبة تعاونية للمتجوزين الجداد اللي مستنيين أول بيبي. بتتعلموا من المواقف: تتحركوا في البيت،
            تشيلوا وترتبوا وتحسبوا وتتفقوا. مفيش حد «أب وحش» أو «أم وحشة» هنا — الغلط جزء من التعلّم، وتقدروا تعدّلوا في أي وقت.
          </text>
        </view>
        @for (level of levels; track level.id) {
          <view class="card">
            <text class="h3">{{ level.emoji }} {{ level.number }}. {{ level.title }}</text>
            <text class="body">بنتعلم: {{ level.learning }}</text>
            @for (s of level.sources; track s.url) {
              <text class="muted">• {{ s.publisher }}: {{ s.title }} — {{ s.url }}</text>
            }
            @if (level.disclaimer) {
              <text class="muted">ℹ️ {{ level.disclaimer }}</text>
            }
          </view>
        }
        <view class="card">
          <text class="h3">⚕️ تنبيه</text>
          <text class="body">
            المعلومات الصحية في اللعبة عامة وتوعوية، مأخوذة من مصادر زي اليونيسف والأكاديمية الأمريكية لطب الأطفال، ومحتاجة
            مراجعة متخصص قبل النشر. مش بديل عن استشارة الطبيب.
          </text>
        </view>
        <view class="card">
          <text class="h3">🙏 شكر</text>
          <text class="muted">الرسومات والأصوات معمولة بالكود خصيصًا للعبة. الخط: Baloo Bhaijaan 2 (رخصة SIL OFL). المحرك: Phaser (رخصة MIT). الواجهة: Angular و NG Native و Expo.</text>
        </view>
      </scroll-view>
    </bwbt-screen>
  `,
  styleUrl: '../ui/kit.css',
  styles: `
    .scroll {
      flex: 1;
    }
    .body-wrap {
      gap: 12px;
      padding-bottom: 24px;
    }
    .card {
      gap: 4px;
    }
  `,
})
export class AboutScreen {
  protected readonly levels = LEVELS;
}
