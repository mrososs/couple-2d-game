import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { Image, ScrollView, Text, TextInput, View } from '@ng-native/components';
import { Sharing, Vibration } from '@ng-native/device';
import { LEVELS } from '../../game/domain/levels/content.ts';
import { COOP_ERRORS, CoopSession } from '../services/coop.ts';
import { LanRelay, type LanRoomAd } from '../services/lan-relay.ts';
import { Progress } from '../services/progress.ts';
import { portrait } from '../ui/art.ts';
import { Button } from '../ui/button.ts';
import { ScreenFrame } from '../ui/screen-frame.ts';

/**
 * Two-phone play on the local network: one partner opens a room on their phone, the other finds
 * it on the same Wi-Fi (or the host's hotspot) and types the six-digit PIN shown on the host's
 * screen - or, where the network hides rooms, types the whole room code. No internet is used.
 * Once paired, the host picks the level and both phones open it.
 */
@Component({
  selector: 'bwbt-coop-lobby',
  imports: [Button, Image, ScreenFrame, ScrollView, Text, TextInput, View],
  host: { style: 'flex: 1' },
  template: `
    <bwbt-screen title="العبوا سوا — على نفس الواي فاي 📶">
      @switch (coop.phase()) {
        @case ('idle') {
          <view class="choices">
            <view class="card choice">
              <text class="big-emoji">🏠</text>
              <text class="h2">افتح غرفة</text>
              <text class="body">هيظهر رقم سري تقوله لشريكك</text>
              <bwbt-button label="افتح غرفة" icon="📡" testID="coop-host" [disabled]="!coop.canHost" (tap)="coop.host()" />
              @if (!coop.canHost) {
                <text class="muted">فتح الغرفة محتاج نسخة أندرويد</text>
              }
            </view>
            <view class="card join-card">
              <scroll-view class="fill" contentContainerClass="join">
              <text class="h2">🔑 ادخل غرفة</text>
              @if (picked(); as room) {
                <text class="body">غرفة {{ room.name }}</text>
                <text-input
                  class="code"
                  placeholder="الرقم السري (٦ أرقام)"
                  [value]="pin()"
                  (changeText)="pin.set($event)"
                  keyboardType="number-pad"
                  [maxLength]="7"
                  accessibilityLabel="الرقم السري"
                  testID="coop-pin"
                />
                <view class="row-buttons">
                  <bwbt-button label="ادخل" icon="➡️" variant="secondary" testID="coop-join-found" [disabled]="pinDigits().length !== 6" (tap)="joinPicked(room)" />
                  <bwbt-button label="رجوع" variant="ghost" size="sm" (tap)="picked.set(null)" />
                </view>
              } @else {
                @if (relay.available) {
                  @for (room of relay.rooms(); track room.id) {
                    <bwbt-button [label]="'غرفة ' + room.name" icon="🏠" variant="secondary" size="sm" [testID]="'coop-room-' + $index" (tap)="pick(room)" />
                  } @empty {
                    <text class="muted searching">🔎 بندوّر على غرف على الشبكة…</text>
                  }
                }
                <text-input
                  class="code"
                  placeholder="أو الكود كله، زي: 23-482916"
                  [value]="code()"
                  (changeText)="code.set($event)"
                  keyboardType="numbers-and-punctuation"
                  accessibilityLabel="كود الغرفة"
                  testID="coop-code"
                />
                <bwbt-button label="ادخل بالكود" icon="➡️" variant="secondary" size="sm" testID="coop-join" [disabled]="code().trim().length < 8" (tap)="coop.join(code())" />
                @if (coop.savedRoom()) {
                  <bwbt-button label="ارجع للغرفة اللي كنتوا فيها" icon="↩️" variant="ghost" size="sm" testID="coop-rejoin" (tap)="coop.rejoin()" />
                }
              }
              </scroll-view>
            </view>
          </view>
          <text class="muted hint">📶 الموبايلين لازم يكونوا على نفس الواي فاي — أو شغّلوا هوت سبوت من موبايل ووصّلوا التاني عليه. مش محتاجين إنترنت.</text>
        }
        @case ('error') {
          <view class="card center">
            <text class="big-emoji">😕</text>
            <text class="h2" testID="coop-error">{{ errorText().title }}</text>
            <text class="body center-text">{{ errorText().hint }}</text>
            <bwbt-button label="جرّبوا تاني" icon="🔁" testID="coop-retry" (tap)="coop.leave()" />
          </view>
        }
        @default {
          <view class="room">
            <view class="card status-card">
              <!-- Scrolls inside the card: on a short landscape screen nothing is cut off. -->
              <scroll-view class="fill" contentContainerClass="status">
              @if (coop.role() === 'host' && !coop.paired()) {
                @if (coop.pin(); as pin) {
                  <text class="muted">🏠 الرقم السري لغرفتك</text>
                  <text class="room-code" testID="room-pin">{{ ltr(spaced(pin)) }}</text>
                  @if (coop.roomCode(); as code) {
                    <text class="small-print" testID="room-code">لو الغرفة مش ظاهرة عند شريكك، الكود كله: {{ ltr(code) }}</text>
                  }
                } @else {
                  <text class="h3">بنفتح الغرفة… ⏳</text>
                }
                @if (coop.failedAttempts() > 0) {
                  <text class="warn" testID="room-failures">⚠️ حد جرّب رقم غلط {{ coop.failedAttempts() }} مرة — لو مش شريكك، اقفلوا الغرفة</text>
                }
              } @else if (coop.phase() === 'joining') {
                <text class="h3">بندخل الغرفة… ⏳</text>
                <text class="muted">{{ ltr(coop.roomCode() ?? '') }}</text>
              } @else {
                <text class="h2 good" testID="coop-paired">اتصلنا! 🤝</text>
              }
              @if (coop.reconnecting()) {
                <view class="banner" testID="coop-reconnecting">
                  <text class="banner-text">الاتصال اتقطع — بنحاول نرجع الاتصال</text>
                  <text class="muted">اتأكدوا إن الموبايلين على نفس الشبكة</text>
                </view>
              }
              <view class="row pair">
                <view class="who">
                  <image class="face" [source]="face(coop.me() ?? 'wife')" />
                  <text class="h3">{{ myName() }}</text>
                  <text class="muted">{{ coop.role() === 'host' ? 'المضيف · إنت' : 'الضيف · إنت' }}</text>
                </view>
                <text class="link">{{ coop.paired() && coop.partnerOnline() ? '🤝' : '⏳' }}</text>
                <view class="who">
                  <image class="face" [class.away]="!(coop.paired() && coop.partnerOnline())" [source]="face(partnerId())" />
                  <text class="h3">{{ partnerLabel() }}</text>
                  <text class="muted" testID="partner-state">{{ partnerState() }}</text>
                </view>
              </view>
              <view class="row-buttons">
                @if (coop.role() === 'host' && !coop.paired() && coop.pin()) {
                  <bwbt-button label="ابعت الكود" icon="📤" variant="ghost" size="sm" (tap)="share()" />
                }
                @if (coop.role() === 'host' && coop.paired() && !coop.partnerOnline()) {
                  <bwbt-button label="رقم سري جديد" variant="ghost" size="sm" (tap)="coop.reopen()" />
                }
                <bwbt-button [label]="coop.role() === 'host' ? 'اقفل الغرفة' : 'اخرج من الغرفة'" variant="ghost" size="sm" testID="coop-leave" (tap)="coop.leave()" />
              </view>
              </scroll-view>
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
                    [disabled]="!canStart() || !progress.isUnlocked(level.id)"
                    [testID]="'coop-level-' + level.number"
                    (tap)="coop.startLevel(level.id)"
                  />
                }
                @if (!canStart()) {
                  <text class="muted">{{ coop.paired() ? 'مستنيين ' + partnerLabel() + ' يرجع…' : 'المراحل هتتفتح أول ما شريكك يدخل' }}</text>
                }
              } @else if (coop.activeLevel(); as level) {
                <text class="big-emoji">🎮</text>
                <text class="h3">{{ partnerLabel() }} في المرحلة دلوقتي</text>
                <bwbt-button label="ادخل المرحلة" icon="▶️" testID="coop-enter-level" (tap)="enterLevel(level.sceneId)" />
              } @else {
                <text class="big-emoji">🎮</text>
                <text class="h3">{{ coop.paired() ? 'مستنيين ' + partnerLabel() + ' يختار المرحلة…' : 'بنوصل…' }}</text>
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
      gap: 8px;
      align-items: center;
      justify-content: center;
    }
    .join-card {
      flex: 1;
      padding: 0;
    }
    .join {
      flex-grow: 1;
      gap: 8px;
      align-items: center;
      justify-content: center;
      padding: 14px;
    }
    .big-emoji {
      font-size: 40px;
    }
    .code {
      align-self: stretch;
      font-family: 'Baloo Bhaijaan 2';
      font-weight: 800;
      font-size: 22px;
      text-align: center;
      border-width: 2px;
      border-color: #d9c2a3;
      border-radius: 14px;
      padding: 2px 12px;
      background-color: #ffffff;
      color: #3b2416;
    }
    .searching {
      padding: 4px;
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
    .center-text {
      text-align: center;
      max-width: 520px;
    }
    .room {
      flex: 1;
      flex-direction: row;
      gap: 18px;
    }
    .status-card {
      flex: 1.2;
      padding: 0;
    }
    .fill {
      flex: 1;
    }
    .status {
      flex-grow: 1;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 10px 14px;
    }
    .small-print {
      font-family: 'Baloo Bhaijaan 2';
      font-size: 13px;
      color: #9a7660;
      text-align: center;
    }
    .room-code {
      font-family: 'Baloo Bhaijaan 2';
      font-weight: 800;
      font-size: 40px;
      line-height: 48px;
      color: #c4553f;
      letter-spacing: 3px;
    }
    .good {
      color: #3f8f63;
    }
    .warn {
      font-family: 'Baloo Bhaijaan 2';
      font-size: 14px;
      color: #b4632a;
      text-align: center;
    }
    .banner {
      align-self: stretch;
      align-items: center;
      padding: 6px;
      border-radius: 14px;
      background-color: #fff1d6;
      border-width: 2px;
      border-color: #f2a93b;
    }
    .banner-text {
      font-family: 'Baloo Bhaijaan 2';
      font-weight: 800;
      font-size: 16px;
      color: #3b2416;
    }
    .pair {
      gap: 14px;
      justify-content: center;
    }
    .row-buttons {
      flex-direction: row;
      gap: 8px;
      justify-content: center;
    }
    .who {
      align-items: center;
    }
    .face {
      width: 50px;
      height: 50px;
      border-radius: 25px;
      border-width: 3px;
      border-color: #3b2416;
      background-color: #ffe1c7;
    }
    .away {
      opacity: 0.35;
    }
    .link {
      font-size: 28px;
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
  protected readonly relay = inject(LanRelay);
  protected readonly progress = inject(Progress);
  private readonly sharing = inject(Sharing);
  protected readonly levels = LEVELS;
  protected readonly code = signal('');
  protected readonly pin = signal('');
  protected readonly picked = signal<LanRoomAd | null>(null);
  protected readonly pinDigits = computed(() => this.pin().replace(/\D/g, ''));

  protected readonly partnerId = computed(() => (this.coop.me() === 'wife' ? 'husband' : 'wife'));
  protected readonly myName = computed(() => {
    const me = this.coop.me();
    return me && this.coop.names() ? this.coop.names()![me] : '';
  });
  protected readonly partnerLabel = computed(() => this.coop.partnerName() ?? 'شريكك');
  protected readonly partnerState = computed(() => {
    if (!this.coop.paired()) return 'مستنيين شريكك…';
    if (this.coop.reconnecting() || !this.coop.partnerOnline()) return 'بنحاول نرجع الاتصال…';
    return 'متصل وجاهز ✓';
  });
  protected readonly canStart = computed(() => this.coop.paired() && this.coop.partnerOnline());
  protected readonly errorText = computed(() => COOP_ERRORS[this.coop.error() ?? 'lost']);

  constructor() {
    // A buzz when the partner arrives, so nobody has to keep looking at the screen.
    const vibration = inject(Vibration);
    let wasPaired = false;
    effect(() => {
      const paired = this.coop.paired();
      if (paired && !wasPaired) vibration.pattern([0, 70, 60, 70]);
      wasPaired = paired;
    });
    // Rooms on the network are looked for while this phone is choosing what to do.
    let stopDiscovery: (() => void) | null = null;
    effect(() => {
      const choosing = this.coop.phase() === 'idle';
      untracked(() => {
        if (choosing && !stopDiscovery) stopDiscovery = this.relay.discover();
        else if (!choosing && stopDiscovery) {
          stopDiscovery();
          stopDiscovery = null;
        }
      });
    });
    // The host's address can change with the network (Wi-Fi to hotspot): the code follows it.
    const addressTimer = setInterval(() => this.coop.refreshAddress(), 3000);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(addressTimer);
      stopDiscovery?.();
    });
  }

  protected face(id: 'wife' | 'husband') {
    const outfits = this.coop.outfits() ?? this.progress.profile().outfits;
    return portrait(id, outfits[id]);
  }

  protected spaced(pin: string): string {
    return `${pin.slice(0, 3)} ${pin.slice(3)}`;
  }

  /**
   * Digits and dashes shown in this right-to-left screen keep their left-to-right order: without
   * the isolate, "192 526" is drawn as "526 192" and "16-192526" as "192526-16".
   */
  protected ltr(text: string): string {
    return text ? `⁦${text}⁩` : '';
  }

  protected pick(room: LanRoomAd): void {
    this.pin.set('');
    this.picked.set(room);
  }

  protected joinPicked(room: LanRoomAd): void {
    void this.coop.joinFound(room, this.pinDigits());
  }

  protected enterLevel(sceneId: Parameters<CoopSession['startLevel']>[0]): void {
    this.coop.enterActiveLevel(sceneId);
  }

  protected share(): void {
    void this.sharing.share({
      message: `تعالى نلعب «قبل ما نبقى تلاتة» سوا 💛 الرقم السري: ${this.ltr(this.coop.pin() ?? '')} — ولو الغرفة مش ظاهرة، الكود: ${this.ltr(this.coop.roomCode() ?? '')}`,
      title: 'كود الغرفة',
    });
  }
}
