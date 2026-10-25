import { Component, inject } from '@angular/core';
import { SafeAreaProvider, View } from '@ng-native/components';
import { HardwareBack, StatusBar } from '@ng-native/device';
import { DeviceOrientation } from '@ng-native/expo/orientation';
import { AboutScreen } from './screens/about.screen.ts';
import { BridgeLabScreen } from './screens/bridge-lab.screen.ts';
import { CharacterSelectScreen } from './screens/character-select.screen.ts';
import { CoopLobbyScreen } from './screens/coop-lobby.screen.ts';
import { GameplayScreen } from './screens/gameplay.screen.ts';
import { LevelCompleteScreen } from './screens/level-complete.screen.ts';
import { LevelSelectScreen } from './screens/level-select.screen.ts';
import { MainMenuScreen } from './screens/main-menu.screen.ts';
import { SettingsScreen } from './screens/settings.screen.ts';
import { WelcomeScreen } from './screens/welcome.screen.ts';
import { Navigator } from './services/navigator.ts';

/**
 * The app shell: right-to-left for the Arabic interface, one screen at a time from the navigator.
 * Gameplay controls live inside the game page and keep their physical positions; only these
 * native screens are mirrored.
 */
@Component({
  imports: [
    AboutScreen,
    BridgeLabScreen,
    CharacterSelectScreen,
    CoopLobbyScreen,
    GameplayScreen,
    LevelCompleteScreen,
    LevelSelectScreen,
    MainMenuScreen,
    SafeAreaProvider,
    SettingsScreen,
    View,
    WelcomeScreen,
  ],
  selector: 'app-root',
  template: `
    <safe-area-provider class="fill">
      <view class="app">
        @let screen = nav.current();
        @switch (screen.name) {
          @case ('welcome') {
            <bwbt-welcome />
          }
          @case ('menu') {
            <bwbt-main-menu />
          }
          @case ('characters') {
            <bwbt-character-select />
          }
          @case ('levels') {
            <bwbt-level-select />
          }
          @case ('game') {
            @if (screen.name === 'game') {
              <bwbt-gameplay [sceneId]="screen.sceneId" [coop]="!!screen.coop" />
            }
          }
          @case ('result') {
            @if (screen.name === 'result') {
              <bwbt-level-complete [result]="screen.result" [unlocked]="screen.unlocked" [coop]="!!screen.coop" />
            }
          }
          @case ('coop') {
            <bwbt-coop-lobby />
          }
          @case ('settings') {
            <bwbt-settings />
          }
          @case ('about') {
            <bwbt-about />
          }
          @case ('bridge') {
            <bwbt-bridge-lab />
          }
        }
      </view>
    </safe-area-provider>
  `,
  styles: `
    :host {
      flex: 1;
    }
    .fill {
      flex: 1;
    }
    .app {
      flex: 1;
      direction: rtl;
      background-color: #fff4e6;
    }
  `,
})
export class App {
  protected readonly nav = inject(Navigator);

  constructor() {
    // The whole app is landscape. Held here for the app's lifetime: releasing the gameplay
    // screen's own lock would otherwise unlock rotation altogether, overriding app.json.
    inject(DeviceOrientation).lock('landscape');
    inject(StatusBar).set({ style: 'dark', hidden: true });
    // Android's back button walks back through the screens, and leaves the app from the first.
    inject(HardwareBack).handle(() => this.nav.back());
  }
}
