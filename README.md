# قبل ما نبقى تلاتة — Before We Become Three

A cooperative 2D game for Egyptian couples expecting their first child. Two players — a wife and a
husband — move through a cozy cartoon Cairo apartment (and the baby shop across the street), solving
practical puzzles together: sharing responsibilities, budgeting, and preparing a safe nursery.
Egyptian Arabic throughout. **Each player plays on their own phone**, connected over Wi‑Fi (or one
phone's hotspot); a one-phone mode remains for practice.

Built with **NG Native** (Angular 22 rendering real native Android/iOS views on React Native's
Fabric, inside Expo 58) for every menu and screen, and **Phaser 4** for the game itself, running
inside an NG Native **DOM component** (a web view embedded in the native gameplay screen).

---

## What is in the prototype

| Area | What works |
| --- | --- |
| Native screens (NG Native) | Welcome, main menu, character selection (names, outfits, who starts), level select (locks + stars), gameplay container (pause sheet), level result with educational feedback and sources, settings (sound, volume, hints, reduced motion, developer mode, reset), about, two-phone lobby, Phase 0 bridge lab. Right-to-left Arabic UI, Baloo Bhaijaan 2 font, landscape. |
| Game (Phaser 4.2.1) | Procedurally drawn cartoon characters (idle/walk in 4 directions, carry, interact, happy, tired, cheer), Egyptian apartment (bedroom, living room, kitchen, entrance hall with cement tiles, empty nursery), street and baby shop. Arcade physics, 8-direction movement, wall/furniture collisions, camera following the pair, interaction prompts, carrying, joint two-person carrying, joint confirmations, pressure-plate switch, pushable trolley, speech bubbles, particles, synthesized sound. |
| Level 1 — قرارنا الكبير الأول | Collect 9 responsibility cards from around the flat and pin them to a three-lane planning board (wife / together / husband). Live balance meter. Halfway, the clinic calls: each partner can read **only their own** schedule (on two phones it shows only on the owner's phone), and both pin the same day on the wall calendar. Review the plan together; decisions left to one person, heavy lifting left to the pregnant partner, or a lopsided load are explained gently and can be fixed. Several valid plans. |
| Level 2 — تحدي ميزانية البيبي | 3,500 EGP illustrative budget with a 10% emergency reserve. Read the needs list at home, walk to the shop, push the trolley, compare price per nappy (the best value pack is in the storeroom — one partner holds the floor switch while the other goes in), agree on big purchases together (the cot box needs both to carry), then work out the change at the till. Several valid baskets. |
| Level 3 — تجهيز أوضة البيبي | Carry delivered furniture into the nursery (cot and wardrobe need two; the rest one), snap to a grid, rotate, keep the door swing clear. Clear the cot of pillow, padded bumper, plush toy and loose quilt (the fitted sheet stays) — each explains why. Inspect together: cot away from the window, tall furniture against a wall (anchoring), clear path from the door. Sources in level metadata. |
| Two phones (Wi‑Fi LAN) | One phone opens a room (native Kotlin WebSocket relay, `modules/lan-relay`) and shows a short code (e.g. `23-58`); the other joins. The host phone runs the game; the guest sends its controls and draws the host's world (display mirroring at 15 Hz, deltas only). Each phone controls its own character, shows its own prompts and controls, keeps its own progress. Pause/resume from either phone, reconnection after drops, private hints per phone. |
| Native features | Haptics (`expo-haptics`) on pick-up, put-down, lifting together, successes and mistakes — on the phone of whoever it concerns; vibration on the partner's phone when someone asks for a hand, on pairing, and on level completion; screen kept awake during play; auto-pause when the app goes to the background; share sheet for the room code; Android back button; landscape lock; AsyncStorage persistence. |
| Persistence | Progress (stars, unlocked levels, best times), profile and settings are saved by the native app through `@ng-native/expo/async-storage` (the web view's localStorage is in-memory on Android). |

### Educational stance
Every level teaches one thing through play, rewards the approach rather than "right answers",
allows correction, and avoids fear. Health and safety lines cite UNICEF, the AAP 2022 safe-sleep
policy and CPSC's Anchor It!, carry a "not medical advice" note, and anything not stated by a source
is listed in `reviewNotes` in `src/game/domain/levels/content.ts` for expert review. Shop prices are
labelled illustrative.

---

## Architecture

```
src/
  main.ts                 native entry (NG Native on Fabric): fonts, AsyncStorage store
  main.web.ts             browser host entry (@ng-native/web): localStorage store, dev relay
  app/                    NATIVE app (Angular on Fabric, no DOM)
    screens/              welcome, menu, characters, levels, gameplay, result, settings, about,
                          coop-lobby, bridge-lab
    services/             navigator (screen stack), progress (+ pure progress-rules), kv-store,
                          coop (two-phone lobby), lan-relay (native module wrapper)
    ui/                   button, screen frame, shared CSS, art (exported PNGs)
  web/game-view.ts        the 'use dom' DOM component: owns one Phaser game; JSON inputs/outputs
  game/
    bridge/protocol.ts    native ⇄ game page contract (session, settings, command → events)
    domain/               pure, unit-tested rules: planning board + schedule, basket/budget,
                          nursery layout + safe sleep, objectives, tile map, level content
    net/                  two-phone protocol, NetLink (WebSocket), display mirror, HostNet
    phaser/               create-game, scenes (boot, level, mirror, hud), systems (input hub,
                          player, interaction, carry, cooperation, feedback), art (procedural),
                          levels (one controller per level + sandbox)
modules/lan-relay/        local Expo module (Kotlin): WebSocket relay for two-phone play
scripts/                  android build helpers, dev relay, e2e device driver
```

**Bridge.** The native gameplay screen renders `<dom-component [src]="gameView" [inputs]=… [outputs]=…>`.
Inputs (session, settings, command) and outputs (ready, objective, paused, complete, haptic,
vibrate, net…) are JSON only and low-frequency; movement never crosses the bridge. Results are
saved by the native app. Leaving the screen destroys the web view (and the game with it); the page
also destroys Phaser on `pagehide`.

**Levels are data + a controller.** `LevelScene` builds whatever a level declares (map, decor,
spawns); the level's controller wires interactables to the pure domain logic in `game/domain`.

**Two phones.** `NetLink` connects each game page directly to the relay on the host phone, so the
real-time traffic stays inside the game layer (no per-frame native messaging). The host is
authoritative: the guest sends controls (with press counters, so presses are never lost or doubled)
and receives snapshots of what changed on screen plus HUD events, sounds and effects. Messages are
scoped by the room PIN.

### Versions (installed and verified)
Angular 22.2.3 · NG Native 0.18.2 (alpha) · Expo 58.0.19 · React Native 0.88.0 · Phaser 4.2.1 ·
TypeScript 6.0.3 · Vite 8.3.5 · Vitest 5.0.5 · ESLint 9.39.5 (+ @ng-native/eslint-plugin) ·
expo-haptics 58.0.7 · expo-keep-awake 58.0.3 · expo-screen-orientation 58.0.3 ·
@react-native-async-storage/async-storage 2.2.0 · expo-font 58.0.10 · Java-WebSocket 1.6.0.

---

## Running it

```bash
npm install
```

Browser (native screens through @ng-native/web, game page in an iframe):

```bash
npm run web
```

Then open http://localhost:5173. The game page alone: http://localhost:5173/game.html?scene=level01

Two players in one browser (two tabs as two phones):

```bash
npm run relay
```

Open http://localhost:5173/?profile=a and http://localhost:5173/?profile=b, open a room in one and
join with its code in the other. Or both phones side by side: http://localhost:5173/coop-test.html?scene=level01

Android (development build — DOM components do not run in Expo Go on Android). The `android/`
folder is generated, not committed; create it once after cloning (and again after changing
`app.json` or a native module):

```bash
npx expo prebuild --platform android
```

```bash
npm run android:debug
```

```bash
adb install -r D:\b3\android\app\build\outputs\apk\debug\app-debug.apk
```

```bash
npm start
```

`android:debug` mirrors the project to `D:\b3` and builds there (see *Windows notes*). For a
release build with the game page embedded in the APK: `npm run android:release`.

Two phones: both on the same Wi‑Fi (or one phone's hotspot), *Main menu → العبوا على موبايلين*,
one taps *افتح غرفة*, the other types the code.

Two emulators instead: `scripts/emulators.ps1` creates a host and a guest emulator (API 35, 1.5 GB
each) with their data on `D:\DevCache\android\avd` (not C:), boots them one after the other,
installs an APK on both and forwards the host's relay port. Emulators cannot see each other
directly, so when the host shows a code like `16-62`, the guest types `10.0.2.2-62` (10.0.2.2 is
this PC as an emulator sees it). Not API 36.1: with emulator 37.2.12 an idle 36.1 phone grew by
about 1 GB of host memory a minute, and two of them exhausted a 16 GB laptop.

```bash
powershell -File scripts/emulators.ps1 -Apk D:\b3\android\app\build\outputs\apk\release\app-release.apk
```

Checks:

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run lint
```

### Windows notes
- **260-character paths.** React Native's C++ build (ninja under CMake 3.22) fails on long object
  paths from this deep folder name. `scripts/android-mirror.ps1` mirrors the project to `D:\b3` and
  builds there. (`subst` does not work: Expo autolinking cannot find package.json at a drive root.)
  Release builds add `RelWithDebInfo` to the path, which went over the limit even from `D:\b3`, so
  `scripts/short-cxx.gradle` (passed by `scripts/gradle.ps1`) moves the app's CMake tree to `D:\b3\cx`.
- **A build that sits at `configureCMakeRelWithDebInfo`** is waiting on a dependency download, not
  on CMake: the first release build fetches `react-android-<version>-release.aar`, and once that
  download stalled with no timeout. Stop the daemon (`scripts/gradle.ps1 --stop`) and build again.
- **JDK.** Gradle runs on Android Studio's JDK 21 (`scripts/gradle.ps1`); the system JDK 25 is newer
  than the Android Gradle Plugin supports.
- **Loopback error.** Gradle failed with "Unable to establish loopback connection" until the JDK's
  temp directory moved to a short path (`D:\DevCache\tmp`, set by `scripts/gradle.ps1`).

---

## Known limitations
- NG Native is alpha; its docs say DOM components are verified on iOS and run on Android in
  development builds — here they were run on Android emulators in a debug build and in the release
  APK (game page, fonts and JS bundle embedded; no Metro).
- Two-phone play is Android-only for hosting (the relay is a Kotlin module); iOS would need the
  same module in Swift. Joining works from any build that can open a WebSocket.
- Two-phone play on the release APK (commit 3b98e50 with the relay fix below), two API 35
  emulators (screenshots `docs/screenshots/android-16` to `-26`): opening a room, joining with the code, both lobbies showing the pair, the host
  starting Level 1 on both phones, the guest's joystick moving the husband on both screens, the
  guest picking up a task card with both screens showing it carried, and pausing on one phone
  pausing the other (and resuming from the other). Not yet verified: finishing a level in
  two-phone mode on the release APK, Levels 2 and 3 in two-phone mode, two physical phones on a
  real Wi‑Fi network or hotspot.
- Release minification broke the relay once: R8 rewrote Java-WebSocket's server loop into code
  Android's verifier rejects, so no room could be opened. `modules/lan-relay/android/proguard-rules.pro`
  keeps that library as written; test two-phone play on a release build after upgrading it.
- The release APK is signed with the debug key (Expo's template default); a Play Store upload
  needs a release keystore.
- Host's room screen in landscape on a Pixel 7–sized phone: the status card overflows, so
  "متصل" and "ده إنت/إنتي" spill under it and *اقفل الغرفة* is cut off at the bottom (the guest's
  card fits). The guest's objective panel shows only the level title, without the task line.
- The guest's view follows snapshots at 15 Hz with easing; on a busy network movement can look
  slightly delayed. There is no client-side prediction for the guest's own character.
- Art and sound are procedural (generated at runtime); no external assets.
- Health content needs review by a pediatric / obstetric professional before release (see `reviewNotes`).
- Phaser 4.2.1 renders nothing for a Text with both `rtl` and `resolution > 1`, so Arabic HUD text
  uses the default resolution.
