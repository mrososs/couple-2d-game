import { mount } from '@ng-native/web';
import { App } from './app/app.ts';
import { DEV_RELAY } from './app/services/coop.ts';
import { KEY_VALUE_STORE } from './app/services/kv-store.ts';
import { ONLINE_AUTH_STORAGE, ONLINE_CONFIG } from './app/services/online.ts';
import { onlineConfigFromEnv } from './online/client.ts';
import { LocalStorageStore } from './web-host/local-storage-store.ts';
import { onlineAuthStorage } from './web-host/online-auth-storage.ts';

// The browser host: the same native screens, rendered into the DOM by @ng-native/web, with
// progress kept in the page's localStorage instead of the phone's AsyncStorage, and two-phone
// play through the development relay (npm run relay), since a browser cannot host a room. The
// development relay's host key is a fixed, development-only one (scripts/lan-relay.ts); a tab
// served to another device on the network can still only join, with the PIN.
// `?profile=b` keeps a second tab's progress apart, as a second phone's would be.
const profile = new URLSearchParams(location.search).get('profile');
mount(document.getElementById('root')!, App, {
  providers: [
    { provide: KEY_VALUE_STORE, useValue: new LocalStorageStore(profile ? `${profile}:` : '') },
    { provide: DEV_RELAY, useValue: { url: `ws://${location.hostname}:7777/bwbt`, hostKey: 'bwbt-development-host-key' } },
    { provide: ONLINE_CONFIG, useValue: onlineConfigFromEnv() },
    { provide: ONLINE_AUTH_STORAGE, useValue: onlineAuthStorage(profile ? `${profile}:` : '') },
  ],
});
