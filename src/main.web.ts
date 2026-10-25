import { mount } from '@ng-native/web';
import { App } from './app/app.ts';
import { DEV_RELAY_URL } from './app/services/coop.ts';
import { KEY_VALUE_STORE } from './app/services/kv-store.ts';
import { LocalStorageStore } from './web-host/local-storage-store.ts';

// The browser host: the same native screens, rendered into the DOM by @ng-native/web, with
// progress kept in the page's localStorage instead of the phone's AsyncStorage, and two-phone
// play through the development relay (npm run relay), since a browser cannot host a room.
// `?profile=b` keeps a second tab's progress apart, as a second phone's would be.
const profile = new URLSearchParams(location.search).get('profile');
mount(document.getElementById('root')!, App, {
  providers: [
    { provide: KEY_VALUE_STORE, useValue: new LocalStorageStore(profile ? `${profile}:` : '') },
    { provide: DEV_RELAY_URL, useValue: `ws://${location.hostname}:7777` },
  ],
});
