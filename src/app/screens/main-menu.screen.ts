import { Component, computed, inject } from '@angular/core';
import { Image, Pressable, Text, View } from '@ng-native/components';
import { LEVEL_IDS } from '../../game/bridge/protocol.ts';
import { LEVELS } from '../../game/domain/levels/content.ts';
import { Navigator, type Screen } from '../services/navigator.ts';
import { Progress } from '../services/progress.ts';
import { portrait } from '../ui/art.ts';
import { Button } from '../ui/button.ts';
import { ScreenFrame } from '../ui/screen-frame.ts';

interface Tile {
  readonly emoji: string;
  readonly title: string;
  readonly sub: string;
  readonly color: string;
  readonly to: Screen;
}

/** The hub: who is playing, how far they are, and where to go next. */
@Component({
  selector: 'bwbt-main-menu',
  imports: [Button, Image, Pressable, ScreenFrame, Text, View],
  host: { style: 'flex: 1' },
  template: `
    <bwbt-screen title="القايمة الرئيسية">
      <view class="layout">
        <view class="hello card">
          <view class="who">
            <view class="faces">
              <image class="face" [source]="wifeFace()" [alt]="profile().names.wife" />
              <image class="face" [source]="husbandFace()" [alt]="profile().names.husband" />
            </view>
            <view class="who-copy">
              <text class="h2" [numberOfLines]="2">أهلًا {{ profile().names.wife }} و{{ profile().names.husband }} 👋</text>
              <text class="body">⭐ {{ progress.stars() }} من {{ maxStars }} · {{ finished() }} من {{ levels.length }} مراحل</text>
            </view>
          </view>
          <bwbt-button label="العبوا سوا على الواي فاي" icon="📱📱" size="lg" testID="play-two-phones" (tap)="nav.push({ name: 'coop' })" />
          <bwbt-button [label]="continueLabel() + ' (موبايل واحد)'" icon="▶️" variant="ghost" size="sm" testID="continue" (tap)="continue()" />
        </view>
        <view class="tiles">
          @for (tile of tiles; track tile.title) {
            <pressable
              #p="pressable"
              class="tile"
              [attr.data-down]="p.pressed() ? 'yes' : 'no'"
              accessibilityRole="button"
              [accessibilityLabel]="tile.title"
              (press)="nav.push(tile.to)"
            >
              <view class="tile-icon" [style.backgroundColor]="tile.color">
                <text class="tile-emoji">{{ tile.emoji }}</text>
              </view>
              <view class="tile-copy">
                <text class="h3">{{ tile.title }}</text>
                <text class="muted">{{ tile.sub }}</text>
              </view>
            </pressable>
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
      gap: 22px;
    }
    .hello {
      flex: 1;
      gap: 10px;
      justify-content: center;
      align-items: flex-start;
    }
    .who {
      flex-direction: row;
      align-items: center;
      gap: 12px;
      align-self: stretch;
    }
    .who-copy {
      flex: 1;
      min-width: 0;
      gap: 2px;
    }
    .faces {
      flex-direction: row;
      gap: 6px;
    }
    .face {
      width: 72px;
      height: 72px;
      border-radius: 36px;
      background-color: #ffe1c7;
      border-width: 3px;
      border-color: #3b2416;
    }
    .tiles {
      flex: 1;
      gap: 10px;
      justify-content: center;
    }
    .tile {
      flex-direction: row;
      align-items: center;
      gap: 12px;
      border-radius: 20px;
      border-width: 3px;
      border-color: #3b2416;
      background-color: #fffbf5;
      padding: 8px 12px;
      box-shadow: 0 4px 0 #3b2416;
    }
    .tile[data-down='yes'] {
      box-shadow: 0 1px 0 #3b2416;
      margin-top: 3px;
    }
    .tile-icon {
      width: 44px;
      height: 44px;
      border-radius: 14px;
      border-width: 3px;
      border-color: #3b2416;
      align-items: center;
      justify-content: center;
    }
    .tile-emoji {
      font-size: 21px;
    }
    .tile-copy {
      flex: 1;
    }
  `,
})
export class MainMenuScreen {
  protected readonly nav = inject(Navigator);
  protected readonly progress = inject(Progress);
  protected readonly profile = this.progress.profile;
  protected readonly levels = LEVELS;
  protected readonly maxStars = LEVELS.length * 3;
  protected readonly wifeFace = computed(() => portrait('wife', this.profile().outfits.wife));
  protected readonly husbandFace = computed(() => portrait('husband', this.profile().outfits.husband));
  protected readonly finished = computed(() => LEVEL_IDS.filter((id) => this.progress.record(id)).length);

  /** The first unfinished level that is open, or the last one to replay. */
  private readonly nextLevel = computed(() => {
    this.progress.save();
    return LEVEL_IDS.find((id) => this.progress.isUnlocked(id) && !this.progress.record(id)) ?? LEVEL_IDS.at(-1)!;
  });

  protected readonly continueLabel = computed(() => {
    const level = LEVELS.find((l) => l.id === this.nextLevel())!;
    return this.finished() === 0 ? `ابدأوا: المرحلة ${level.number}` : `كمّلوا: المرحلة ${level.number}`;
  });

  protected readonly tiles: readonly Tile[] = [
    { emoji: '🗺️', title: 'المراحل', sub: 'اختاروا مرحلة والعبوا', color: '#ffd98e', to: { name: 'levels' } },
    { emoji: '👫', title: 'الشخصيات', sub: 'الأسامي والألوان ومين بيلعب بمين', color: '#ffc4b5', to: { name: 'characters' } },
    { emoji: '⚙️', title: 'الإعدادات', sub: 'الصوت والمساعدة والحركة', color: '#cde8da', to: { name: 'settings' } },
    { emoji: '📚', title: 'عن اللعبة', sub: 'فكرتها ومصادر المعلومات', color: '#d9d1f2', to: { name: 'about' } },
  ];

  protected continue(): void {
    this.nav.push({ name: 'game', sceneId: this.nextLevel() });
  }
}
