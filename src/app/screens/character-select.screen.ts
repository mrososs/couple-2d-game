import { Component, inject } from '@angular/core';
import { Image, Pressable, Text, TextInput, View } from '@ng-native/components';
import type { CharacterId } from '../../game/bridge/protocol.ts';
import { OUTFITS } from '../../game/phaser/art/characters.ts';
import { Navigator } from '../services/navigator.ts';
import { Progress } from '../services/progress.ts';
import { portrait } from '../ui/art.ts';
import { Button } from '../ui/button.ts';
import { ScreenFrame } from '../ui/screen-frame.ts';

/**
 * Character selection: name each partner, pick their outfit, and say who holds the phone first -
 * that character starts on the touch controls and on the first keyboard set. Both always play;
 * this only decides where the controls begin.
 */
@Component({
  selector: 'bwbt-character-select',
  imports: [Button, Image, Pressable, ScreenFrame, Text, TextInput, View],
  host: { style: 'flex: 1' },
  template: `
    <bwbt-screen title="الشخصيات">
      <view class="layout">
        @for (c of characters; track c.id) {
          <view class="card char" [attr.data-lead]="profile().lead === c.id ? 'yes' : 'no'">
            <view class="portrait-wrap" [style.backgroundColor]="c.tint">
              <image class="portrait" [source]="face(c.id)" [alt]="profile().names[c.id]" />
            </view>
            <view class="info">
              <text class="muted">{{ c.role }}</text>
              <text-input
                class="name"
                [value]="profile().names[c.id]"
                (changeText)="rename(c.id, $event)"
                [maxLength]="12"
                [accessibilityLabel]="'اسم ' + c.role"
              />
              <view class="outfits">
                @for (o of outfits[c.id]; track o.label; let i = $index) {
                  <pressable
                    class="swatch"
                    [style.backgroundColor]="o.top"
                    [attr.data-on]="profile().outfits[c.id] === i ? 'yes' : 'no'"
                    accessibilityRole="button"
                    [accessibilityLabel]="'لبس ' + o.label"
                    [accessibilityState]="{ selected: profile().outfits[c.id] === i }"
                    (press)="progress.setOutfit(c.id, i)"
                  >
                    <view class="swatch-accent" [style.backgroundColor]="o.accent"></view>
                  </pressable>
                }
              </view>
              <pressable
                class="lead"
                [attr.data-on]="profile().lead === c.id ? 'yes' : 'no'"
                accessibilityRole="radio"
                [accessibilityState]="{ checked: profile().lead === c.id }"
                (press)="progress.updateProfile({ lead: c.id })"
              >
                <text class="lead-text">{{ profile().lead === c.id ? '🎮 بيبدأ بالتحكم' : 'ابدأ بيه/بيها' }}</text>
              </pressable>
            </view>
          </view>
        }
      </view>
      <view class="footer">
        <text class="muted hint">الاتنين بيلعبوا مع بعض: على الموبايل بزرار التبديل، وعلى الكمبيوتر كل واحد بأزراره.</text>
        <bwbt-button label="تمام، يلا" icon="✅" testID="characters-done" (tap)="done()" />
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
    .char {
      flex: 1;
      flex-direction: row;
      gap: 16px;
      align-items: center;
    }
    .char[data-lead='yes'] {
      border-color: #e8735a;
      border-width: 4px;
    }
    .portrait-wrap {
      width: 150px;
      height: 150px;
      border-radius: 75px;
      border-width: 3px;
      border-color: #3b2416;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .portrait {
      width: 150px;
      height: 150px;
    }
    .info {
      flex: 1;
      gap: 8px;
    }
    .name {
      font-family: 'Baloo Bhaijaan 2';
      font-weight: 800;
      font-size: 24px;
      color: #3b2416;
      border-width: 2px;
      border-color: #d9c2a3;
      border-radius: 14px;
      padding: 4px 12px;
      background-color: #ffffff;
      text-align: right;
    }
    .outfits {
      flex-direction: row;
      gap: 10px;
    }
    .swatch {
      width: 40px;
      height: 40px;
      border-radius: 20px;
      border-width: 3px;
      border-color: #3b2416;
      align-items: center;
      justify-content: center;
    }
    .swatch[data-on='yes'] {
      border-width: 5px;
      transform: scale(1.12);
    }
    .swatch-accent {
      width: 14px;
      height: 14px;
      border-radius: 7px;
    }
    .lead {
      align-self: flex-start;
      border-radius: 999px;
      border-width: 2px;
      border-color: #3b2416;
      padding: 4px 14px;
      background-color: #fffbf5;
    }
    .lead[data-on='yes'] {
      background-color: #ffd98e;
    }
    .lead-text {
      font-family: 'Baloo Bhaijaan 2';
      font-weight: 600;
      font-size: 15px;
    }
    .footer {
      flex-direction: row;
      align-items: center;
      gap: 16px;
      margin-top: 14px;
    }
    .hint {
      flex: 1;
    }
  `,
})
export class CharacterSelectScreen {
  protected readonly progress = inject(Progress);
  private readonly nav = inject(Navigator);
  protected readonly profile = this.progress.profile;
  protected readonly outfits = OUTFITS;
  protected readonly characters = [
    { id: 'wife' as CharacterId, role: 'الزوجة', tint: '#ffd6c9' },
    { id: 'husband' as CharacterId, role: 'الزوج', tint: '#cfe3f3' },
  ];

  protected face(id: CharacterId) {
    return portrait(id, this.profile().outfits[id]);
  }

  protected rename(id: CharacterId, name: string): void {
    this.progress.setName(id, name.trim().length ? name : id === 'wife' ? 'منى' : 'كريم');
  }

  protected done(): void {
    this.progress.markOnboarded();
    if (this.nav.below()?.name === 'menu') this.nav.back();
    else this.nav.replace({ name: 'menu' });
  }
}
