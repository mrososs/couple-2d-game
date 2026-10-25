// Expo's runtime: its fetch, whose response streams a body, and URL, TextDecoderStream and
// structuredClone. Metro runs it before this file only when something imports it, and nothing
// else does in a release build, which would then get React Native's fetch, with no body.
import 'expo';
import { AppRegistry, Image, Platform, processColor } from 'react-native';
import { mount } from '@ng-native/platform';
import { currentConditions, deviceTokens, watchConditions } from '@ng-native/device';
import { Storage } from '@ng-native/expo/async-storage';
import { loadFonts } from '@ng-native/expo/fonts';
import { getFabricUIManager, registerPlatformComponents, styleSheetOf } from '@ng-native/fabric';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { App } from './app/app.ts';
import { GlobalStyles } from './app/global-styles.ts';
import { KEY_VALUE_STORE } from './app/services/kv-store.ts';
import { ONLINE_AUTH_STORAGE, ONLINE_CONFIG } from './app/services/online.ts';
import { onlineConfigFromEnv } from './online/client.ts';

registerPlatformComponents(Platform.OS);

AppRegistry.registerRunnable('main', ({ rootTag }) => {
  const globalStyles = styleSheetOf(GlobalStyles);
  // Text laid out before the Arabic face registers is laid out again once it does.
  void loadFonts(globalStyles).catch((error: unknown) => console.error(error));

  const app = mount(Number(rootTag), App, getFabricUIManager(), {
    processColor,
    conditions: currentConditions(),
    tokens: deviceTokens(),
    resolveAssetSource: (value) => Image.resolveAssetSource(value as never),
    globalStyles,
    // Progress is the native app's to keep: AsyncStorage on disk, not the game page's storage,
    // which on Android lasts only as long as the page.
    providers: [
      { provide: KEY_VALUE_STORE, useExisting: Storage },
      // Online play (Supabase): the project from EXPO_PUBLIC_SUPABASE_*, and the player's session
      // kept on disk so the same anonymous player comes back after a restart.
      { provide: ONLINE_CONFIG, useValue: onlineConfigFromEnv() },
      { provide: ONLINE_AUTH_STORAGE, useValue: AsyncStorage },
    ],
  });

  // Re-resolves the conditions when the device rotates or the theme changes.
  const stopWatching = watchConditions(app.engine);
  app.applicationRef.onDestroy(stopWatching);
});
