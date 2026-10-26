# WLAN co-op multiplayer: review, fixes and test results

*Before We Become Three* is a **local WLAN cooperative game**: two phones on the same Wi‑Fi, or one
phone's hotspot with the other connected to it. **No internet is needed or used.** One phone hosts:
it runs the room relay (a native Android module) and the authoritative game. The other joins and
plays its own character. Supabase (`src/online/`, `supabase/`) is not part of this: it is left in
the repository, unused by gameplay, and was not changed or deployed for this work.

Baseline reviewed: `42fc4b5`; the release-APK fixes in `a974e54` (R8 keep rule, Windows build
paths, emulator script) were already on `main` and are kept.

## 1. Verified problems and root causes

| # | Severity | Problem (verified in the code or in a run) | Root cause | Fixed in |
|---|---|---|---|---|
| 1 | P0 | Any device on the network could join a room, read all traffic and inject frames. | The Kotlin relay passed every text frame from every client to every other client, with no authentication and no limit on clients. | Room protocol (§3), `LanRelayModule.kt`, `scripts/lan-relay.ts` |
| 2 | P0 | A stranger could drive the partner's character or speak as the host. | The host checked the PIN only on `join`; `in` (controls) was accepted from anyone who knew the 2‑digit PIN, which every frame carried in clear. Clients chose their own `from`. | Relay authenticates every connection and stamps `from`; guests receive only host frames. |
| 3 | P0 | The PIN was the only credential and had 90 values. | A two-digit PIN, reused as the room id, with unlimited attempts. | One-time 6-digit PIN, spaced attempts, rotation after 5 failures, then a 192-bit guest key. |
| 4 | P1 | Oversized or flooding frames were relayed without limit. | No frame-size, rate or connection limits. | Frame size enforced while reading (1 MiB host, 4 KiB guest), token bucket (120/s, burst 240), close after 40 violations, ≤4 pending and ≤3 per role. |
| 5 | P1 | The partner's **first** button press was lost. | `InputHub.setRemote` used the first message's counter as the baseline. | Counters per input epoch starting at zero (`input-hub.ts`). |
| 6 | P1 | Two presses arriving between frames became one. | `interact = counter > seen` collapsed any number of new presses into one flag. | Pending press queue, one press per frame. |
| 7 | P1 | After the guest's page restarted, its presses were ignored until they passed the old count; a stale message could replay presses. | Counters were not scoped to a session. | Epoch per guest page start and per host run; counters kept per epoch (last 4); presses aimed at an earlier run are ignored. |
| 8 | P1 | Malformed stick values could break physics. | No validation (`NaN`, `Infinity`, strings). | `readInput` rejects malformed controls; stick clamped to length 1. |
| 9 | P1 | The guest could miss a change silently and keep drawing a stale world. | Deltas were computed before a send that could fail; no snapshot ordering or gap detection. | Snapshots carry `run` and `n`; `SnapshotOrder` applies deltas only in sequence and asks for a full snapshot after a gap; a failed send forces the next snapshot to be full. |
| 10 | P1 | On the guest, objectives often showed only the level title (found by the release-APK run). | The host's HUD state arrived before the guest's HUD scene was created; the calls threw and were never repeated. | Guest queues HUD events until its HUD is ready. |
| 11 | P1 | The level kept running while the partner was gone. | The host only released the partner's stick. | Shared pause with reasons; `partner` pauses until they are back. |
| 12 | P1 | The guest could restart (or resume) the host's game on its own. | Guest `pause/resume/restart` were executed as commands. | Requests: pausing always works, resume lifts only the guest's own pause, restart needs the host's yes. |
| 13 | P1 | A guest whose host left the level, or closed the room, was left waiting forever. | No `bye` handling in the game, link retried forever on any close. | `bye` → "partner left the level" with a way back; terminal close codes stop retries and say why. |
| 14 | P1 | A game could start after its screen had closed, leaving a Phaser instance and an open socket. | `GameView.boot()` awaited fonts, then created the game without checking it was destroyed. Sockets closed only on Phaser's next frame. | `disposed` guard; `shutdownNet()` closes room links at once on destroy; the test handle is dropped. |
| 15 | P1 | A completed level could be counted twice, or missed by the guest. | Results had no identity; the guest only heard completion on the game channel. | Results carry `id = room:run`; saved once per id; the host also sends results over the lobby and again in `welcome` after a reconnection. |
| 16 | P2 | Level 1 failed any plan unless her share of the load was 30–55%. | A fixed, one-sided ratio used as a pass/fail rule. | Contextual rule (§6); a lopsided split is a prompt the couple confirm together. |
| 17 | P2 | The host address list could include mobile data or VPN interfaces. | All non-loopback IPv4 addresses were listed. | Only Wi‑Fi/hotspot/ethernet interfaces with private addresses; the relay refuses public peers. |
| 18 | P2 | The host's room card overflowed on a landscape phone (release-APK run). | Fixed layout with no scrolling. | Compact layout, scrolling inside the card as a fallback. |
| 19 | P1 | *Found while testing on Android:* with the host's app in the background, the shared game kept running. | The native app's background pause runs in its JavaScript, which Android holds while the app is in the background. | The game page pauses itself on `visibilitychange` (host: its own pause; guest: a pause request). |
| 20 | P1 | *Found while testing on Android:* the PIN and room code were drawn reversed ("526 192" for 192526). | Groups of digits in a right-to-left paragraph. | Codes wrapped in left-to-right isolates. |
| 21 | P2 | *Found in review:* finishing a level could send the partner back to the room instead of the result screen. | The host's game screen closing on completion was treated as the host leaving, on a different connection than the result. | Completion is not leaving: no `ended`/`bye` after a result. |

What stays as it was: the Kotlin module hosting the relay, `NetLink`'s reconnect loop, display
mirroring (`SceneMirror`/`SceneReplica`), the host-authoritative design (the guest only sends
controls), the levels and their art and educational content (except the Level 1 rule in §6).

## 2. Architecture

```
Host phone                                            Guest phone
┌─────────────────────────────────────┐               ┌───────────────────────────────┐
│ NG Native app (lobby, pause sheet)  │◄─ lobby ─┐ ┌─►│ NG Native app                 │
│ Game page (Phaser, LevelScene)      │◄─ game ──┤ ├─►│ Game page (Phaser, MirrorScene)│
│ HostNet: rules, snapshots 15 Hz     │          │ │  │ sends controls, draws snapshots│
│ LanRelay (Kotlin): room relay :7777 │◄─────────┴─┴──┤ over Wi-Fi / hotspot, ws://    │
└─────────────────────────────────────┘   loopback    └───────────────────────────────┘
```

- **Host**: the relay (`modules/lan-relay`), the authoritative `LevelScene` with `HostNet`.
- **Guest**: `MirrorScene` draws what the host sends and sends its stick, counted presses and requests.
- Two channels inside the room: `lobby` (pairing, level start, results) and `game` (controls,
  snapshots, HUD, effects, pause). Each phone's app and game page connect separately.

## 3. The room protocol (pairing, identity, isolation)

Defined once in `src/game/net/room.ts`, implemented by the native relay (`LanRelayModule.kt`) and
the development relay (`scripts/lan-relay.ts`).

**Finding the host** (address) is separate from **getting in** (credentials):

1. *Discovery*: the host advertises the room with Android NSD/mDNS (`_bwbt._tcp`, with the hosts'
   names); the guest's lobby lists rooms found on the network.
2. *Fallback*: the full room code, `<last part of the host's address>-<PIN>` (`23-482916`) or a full
   address (`192.168.1.23-482916`, `10.0.2.2-482916` for emulators). Shown on the host's screen and
   shareable. Never a hard-coded address.
3. *Coming back*: a guest stores `{url, key, room}` and can rejoin within 6 hours (after the app was
   closed), until the host closes the room.

**Getting in** - every connection's first frame is `{"t":"auth","v":2,...}`:

| Who | Credential | Accepted when |
|---|---|---|
| The host app's lobby and game page | host key (192-bit, random per room, generated natively) | from this phone (loopback) only |
| The partner, first time | room PIN (6 digits, single use) | no partner paired yet; at most one PIN check per 400 ms; 5 wrong → new PIN |
| The partner again (game page, reconnection) | guest key (192-bit, issued by the relay at pairing) | key matches the room's current partner |

Then the relay routes: host frames → partner's connections; partner frames → host's connections,
with `from:"guest"` set by the relay. Nobody else receives anything. The host can `reset` (forget
the partner, new PIN). Close codes say whether retrying can help (`4000` room closed, `4401` wrong
PIN, `4409` full, `4410` key revoked, `4426` version, `4403` forbidden).

**Session identity**: `room` (relay's random id), `run` (one per level start, host-generated),
input `epoch` (per guest page start and per run), snapshot `n` (per run), result `id = room:run`.
Replays and duplicates are dropped by sequence numbers; a result id is saved once.

**Threat assumptions.** The protection is against other devices on the same network or hotspot:
a curious phone, a port scan, someone guessing the PIN. Frames are plain `ws://`, not encrypted:
someone able to read the Wi‑Fi traffic itself (a malicious router or hotspot owner, or anyone with
the Wi‑Fi password capturing the WPA2 handshake) could read game traffic and, with the guest key, act
as the partner. No internet dependency was added to defend against that. The relay refuses peers
outside private address ranges and listens only while a room is open.

**Cleartext on Android.** The app keeps `usesCleartextTraffic: true` (`app.json`): Android's network
security config can allow cleartext only per host name or exact IP, not per address range, and the
host's LAN address is not known in advance. Narrowing it would break the partner's connection. The
code compensates: `NetLink` refuses any `ws://` URL that is not on a private network.

## 4. Host-authoritative gameplay

The guest sends only: stick position, counted interact/rotate presses, `join` (send me everything),
and requests (`pause`, `resume`, `restart`). The host's level decides everything else - movement and
collisions, pickups, placements, carrying, puzzle verdicts, stars, completion - from its own state.

- **Level 1**: cards placed on the host's `PlanningBoard`; the clinic day is checked against the real
  schedules (`SchedulePuzzle.check`); the review evaluates the board on the host.
- **Level 2**: the basket is the host's `Basket`; the change puzzle's answer is computed by the host
  from the basket total (`3500 − total`); a wrong amount is a miss whatever both players think.
- **Level 3**: placements go through `NurseryLayout.place/check`; the inspection evaluates the real
  layout (window, anchoring, reachability from the door) and the real cot contents
  (`SafeSleepCheck`). Nothing a client sends can mark it done.

Pause and restart: either player can pause (a phone call should stop the game); the host's resume
lifts both players' pauses but never the wait for an absent partner; a guest's restart is a request
shown on the host's pause sheet, with "ابدأوا من الأول" / "لا، نكمّل".

## 5. Connection, reconnection and the session's end

| Situation | What happens |
|---|---|
| Level starts | The host's level waits (`partner`) until the guest's page has the picture. |
| Guest's Wi‑Fi drops / app backgrounded | No controls for 3 s, or the relay reports no partner connection → host pauses with "📡 مستنيين …"; guest shows "بنحاول نرجع الاتصال". |
| Guest comes back | Same key; the host sends a full snapshot and the HUD state; the game resumes by itself. Carried items, the basket, placements are unchanged (they live on the host). |
| Duplicate reconnects | At most 3 connections per role; a newer one replaces the oldest. |
| Host leaves the level | Guest: "🚪 … خرج من المرحلة" with "ارجع للغرفة"; the lobby takes it back to the room. |
| Host closes the room / host app killed | Guest's links end (`4000`, or connection refused): "شريككم قفل الغرفة" / "الاتصال اتقطع". No host migration: the host opens a new room. |
| Guest app killed | It can come back to the room with its saved key ("ارجع للغرفة اللي كنتوا فيها"); a level in progress opens straight away. |

## 6. Level 1: from a ratio to a conversation

Before: a plan failed unless the wife's share of the load was between 30% and 55%. Now
(`src/game/domain/planning.ts`): two requirements that follow from the situation - decisions that
belong to both go in the shared lane, and heavy lifting is not on the pregnant partner alone - and
no required ratio. When either partner would carry more than 70% of the load (the same rule both
ways), the review does not fail: it says so, and the couple confirm the review together a second
time if that split suits them (insight "تقسيم اتفقتوا عليه"). Moving any card invalidates that
agreement. The 70% is an illustrative prompt, noted for professional review in the level's
`reviewNotes`.

## 7. Offline progress

Progress lives only on each phone (AsyncStorage through the existing `Progress` service). In a
two-phone level the host's game produces the result; both phones save it under the same id. Saving
is idempotent (`savedResults`, the last 64 ids) and records only improve (best stars, best time),
so a result arriving twice, or a partner's result, never inflates or lowers anything. If the guest
was away at the moment of completion, the host's `welcome` on rejoin carries the room's results. If
the host's phone or its save is lost, the guest's own records remain; the host starts again from
its own save (there is no cloud copy). No internet is used at any point.

## 8. Files

Room protocol and relays: `src/game/net/room.ts`, `modules/lan-relay/android/.../LanRelayModule.kt`,
`scripts/lan-relay.ts` (replaces `scripts/dev-relay.mjs`).
Game networking: `src/game/net/link.ts`, `protocol.ts`, `host-net.ts`, `snapshot-order.ts`,
`src/game/phaser/systems/input-hub.ts`, `scenes/level-scene.ts`, `scenes/mirror-scene.ts`,
`create-game.ts`, `src/web/game-view.ts`, `src/game/bridge/protocol.ts`.
App: `src/app/services/coop.ts`, `lan-relay.ts`, `navigator.ts`, `progress.ts`, `progress-rules.ts`,
`src/app/screens/coop-lobby.screen.ts`, `gameplay.screen.ts`, `main-menu.screen.ts`, `src/main.web.ts`.
Level 1: `src/game/domain/planning.ts`, `levels/content.ts`, `src/game/phaser/levels/level01.ts`.
Tests and tools: `tests/lan/relay.test.ts`, `src/game/net/*.test.ts`,
`src/game/phaser/systems/input-hub.test.ts`, `src/app/app.test.ts`, `src/app/services/progress.test.ts`,
`src/game/domain/planning.test.ts`, `coop-test.html`, `scripts/e2e/coop-playthrough.js`,
`scripts/e2e/relay-probe.mjs`.

## 9. Test results

Run on 2026-10-26 on Windows 11, Node 24.11. Everything below was executed; nothing is inferred.

### Automated (Node, `npm test`)

`npm run typecheck`, `npm run lint`, `npm test` (**136 tests in 12 files, all passing**) and
`npm run web:build` all pass. Added or rewritten for this work:

| File | Tests | Covers |
|---|---|---|
| `tests/lan/relay.test.ts` | 18 | The room protocol against the development relay: host key only from this phone; pairing once with the PIN; the spent PIN refuses a third phone (`full`); wrong PIN refused, counted, rotated after 5; PIN checks spaced; stale key, old version, wrong path, junk refused; auth timeout and pending cap; public addresses refused; `from` stamped by the relay (a guest claiming to be the host is heard as the guest); guests cannot send control frames or hear anyone but the host; oversized, malformed and flooding frames dropped then the connection closed; host reset revokes the key; room close ends everyone with "do not retry"; 30 join/leave cycles leave nothing behind; `NetLink` pairs, reconnects with its key after a drop, stops for good on a wrong PIN or a closed room, refuses non-local URLs. |
| `src/game/phaser/systems/input-hub.test.ts` | 11 | First press kept; presses between frames each counted; duplicates and late messages ignored; new epoch counts from zero; stale-run controls move but never press; a stale message in between does not replay presses; presses during the intro dropped; bursts capped; rotation counted; stick clamped, `NaN` stops; quiet partner stops. |
| `src/game/net/snapshot-order.test.ts` | 5 | Deltas only after a full snapshot and in sequence; duplicates dropped; gaps and restarts wait for a full snapshot. |
| `src/game/net/protocol.test.ts` | 12 | Six-digit room codes (Arabic digits too), relay URLs, auth frame parsing, local-address rules, `ws://` only on private networks, input validation, ids. |
| `src/app/app.test.ts` | 15 (6 new) | Against a real relay: the host lobby shows the PIN, pairs, refuses a third phone, starts a level with the right credentials, shares a result; the guest joins with the code, saves missed results once, follows the host into and out of a level, hears the room close; a wrong PIN says so. Pause sheets: the guest cannot lift the host's pause and asks to restart; the host is asked and can decline; waiting for a dropped partner; "host left" leads back to the room. |
| `src/app/services/progress.test.ts` | 9 (2 new) | A result arriving twice saved once (also across launches); a partner's result never lowers a record. |
| `src/game/domain/planning.test.ts` | 15 (3 changed) | Lopsided plans are notes, not failures; the rule is identical for both partners; any card move needs a new agreement. |

### Browser LAN (two game pages through the development relay)

`coop-test.html` + `scripts/e2e/coop-playthrough.js`: the wife is played on the host page, the
husband on the guest page; every one of his presses and stick movements crosses the relay. Final run
on the finished code: **Level 1 17/17, Level 2 22/22, Level 3 19/19 checks passed**; the host
closing its page mid-level reached the guest as "partner left the level", and closing it after a
completed level did not (0 such events: finishing is not leaving). Checked in every level: both pages on the same run; the level waits for
the partner and resumes by itself; real walking from each phone with collisions, the other character
untouched, the guest drawing the husband 0 px from where the host has him; five presses on five
consecutive guest frames → five interactions on the host; a duplicated input message presses once;
a stale-run press is ignored; malformed controls rejected. Per level:

- **Level 1**: nine cards placed by both phones; a wrong day agreed by both rejected (attempt
  counted); Tuesday accepted; joint review; result ★3 on both phones with the same id.
- **Level 2**: storeroom, trolley and the joint purchase (his agreement from his phone); host basket
  2,430 spent / 1,070 left, also shown on the guest's widget; **guest Wi‑Fi dropped for ~3 s at the
  till**: the host paused with `partner`, the guest came back with its key, got a full snapshot,
  the game resumed by itself, the basket unchanged; both confirmed at the till; a wrong change amount
  rejected (miss counted); the right answer is the host's own sum (1,070 = 3,500 − 2,430); result ★2
  (one miss) on both.
- **Level 3**: wardrobe and cot held by both phones; the wardrobe turned 0° → 90° by the guest's
  rotate button; the cot carried 182 px across the room by both sticks at once; bedding cleared; the
  host's real layout check returned no issues; result ★3 on both.

Two whole apps in two tabs (`?profile=a` / `?profile=b`, phone size 915×412): wrong PIN → "الرقم
السري غلط" on the guest and "حد جرّب رقم غلط 1 مرة" on the host; right PIN → "اتصلنا! 🤝" on both,
"متصل وجاهز ✓"; the host's level choice opened the level on both; the guest's pause → "كريم وقّف اللعب
☕" on the host; the guest's restart request → the host's yes/no banner → accepted → both on the same
new run; the host's exit → the guest back in the room, still paired. The host's room card fits a
915×412 screen (close button ends at 405 px).

### Android emulator (debug APK with the new native relay)

One API 35 emulator (1.5 GB, software GPU) as the **host**, running the real app with the Kotlin
relay; the **partner** was the browser app joining through `adb forward tcp:7777 tcp:7777` (two
emulators did not fit beside everything else in 16 GB). Screenshots `docs/screenshots/android-27` to
`-29`.

- `relay-probe.mjs before`: **7/7** — wrong path 4403, junk first frame 4002, old version 4426,
  wrong host key 4403, no auth within 5 s 4001, two wrong PINs 4401; the host's lobby then showed
  "حد جرّب رقم غلط 2 مرة".
- The browser partner paired with the PIN; the relay issued a 32-character key; the host showed
  "متصل وجاهز ✓".
- `relay-probe.mjs after`: **7/7** — the spent PIN refused (`full`, 4409), a made-up key refused
  (4410), the real key reconnects, the partner's key is no host key (4403), the partner cannot reset
  the room, a flood of 400 frames closes the partner's connection (4008), and it can come back.
- Level 1 started from the host's lobby; the guest followed; the host waited ("📡 مستنيين كريم…")
  and resumed by itself when the partner's page joined.
- The guest's stick walked the husband from x 820 to x 233; read inside the host's web view over
  DevTools: (233, 700) — identical; 34 inputs received, 0 rejected.
- One press on the guest → the host's husband holds the "groceries" card.
- The guest's connection cut for ~5 s while carrying: it reconnected with its key, the host sent a
  full snapshot, the husband still held the card.
- **Bug found and fixed here**: with the host app in the background (HOME), the game kept running —
  the native app's pause did not run while Android had the app in the background, though the page
  reported `visibilityState: hidden`. The game page now pauses itself on `visibilitychange`.
  Retested: after HOME the guest saw the host's pause (`host`); back in the app the host's pause
  sheet showed; the host's "كمّل" lifted both pauses on both phones.
- The guest's app restarted (page reload) → "ارجع للغرفة اللي كنتوا فيها" → paired again with the
  saved key, no PIN.
- The host left the level → the guest went back to the room; the host closed the room → the guest
  showed "شريككم قفل الغرفة" and forgot the saved key.
- NSD: `dumpsys mdns` showed the room advertised (`bwbt-…._bwbt._tcp`, port 7777, `n` = "منى
  وكريم", `onRegisterServiceSucceeded`).
- **Bug found and fixed here**: the PIN and room code were drawn reversed in the right-to-left
  screen ("526 192" for 192526); they are now isolated left to right (`android-29`).

### Android emulator (release APK, final code)

`assembleRelease` (R8, game page and JS bundle embedded, no Metro) built from the final code
(`BUILD SUCCESSFUL`). On the same emulator, with the browser as the partner (`android-30`, `-31`):

- The room opened, so the native relay starts in release builds (R8 broke this once, see README).
  PIN and code drawn left to right.
- `relay-probe.mjs before`: **7/7**. The browser partner paired with the PIN (key issued).
  `relay-probe.mjs after`: **7/7**.
- A locked level (Level 2 on this install) could not be started from the host's lobby; Level 1
  started on both; the guest synced to the host's run; after both intros were dismissed, the
  guest's stick walked the husband from x 820 to x 233 on the host.

Not run on the release APK: a full level to completion, the background pause and reconnection
(those were run on the debug APK above, with the same game and relay code).

### Physical phones

**Not run**: no physical Android devices were available. Discovery between two real devices,
real Wi‑Fi/hotspot behaviour (client isolation, multicast filtering, address changes), battery and
thermal behaviour remain to be tested on hardware.

## 10. Performance

Measured by `HostNet`'s counters (bytes are JSON characters sent host → guest):

| | Level 1 | Level 2 | Level 3 |
|---|---|---|---|
| Full snapshot (join, rejoin, gap) | 14.8 KB | 26–28 KB | 13.2 KB |
| Largest delta | 2.4 KB | 4.3 KB | 4.8 KB |
| Typical delta (idle to walking) | 0.5 KB | 0.5 KB | 0.5 KB |
| Host → guest during the scripted run | 107 KB / 10 s | 150 KB / 15 s | 100 KB / 11 s |

At 15 snapshots a second this is roughly 8–11 KB/s while both play, far within any home Wi‑Fi or
hotspot. Guest → host: one small message (~120 bytes) on every stick or button change and a
heartbeat every 200 ms. Snapshots are sent only while the partner is present. On the emulator the
host's game ran at 10–13 fps (software GPU) — not representative of a phone. Latency was not
measured meaningfully: both test setups ran over localhost or an adb tunnel, where it is near zero;
it remains to be measured on real Wi‑Fi.

## 11. Known limitations

- **Not tested on physical phones**, nor NSD discovery between two devices (emulators each sit
  behind their own virtual network), nor the hardened build on two Android devices at once.
- **Plaintext `ws://`** (see §3): protected against other devices joining or speaking in the room,
  not against someone who can read the Wi‑Fi traffic. Android's cleartext permission stays global
  because it cannot be limited to address ranges.
- **The host's app must stay alive.** The relay lives in the app's process: if Android kills the
  host's app in the background, the room ends (no foreground service, no host migration). The guest
  is told and can rejoin a new room.
- **Android 16+ local network permission**: newer Android versions are introducing a permission for
  local network access; if it becomes enforced for this app's target SDK, the relay and discovery
  will need it declared and requested.
- **Hosting is Android-only** (Kotlin module); iOS would need the same module in Swift.
- The guest's own character is drawn from the host's snapshots, with easing and no prediction.
- Level 2's change puzzle offers three amounts; a wrong one is rejected by the host and removed, so a
  couple can still arrive at the right one by elimination (at the cost of a star).
- The 70% prompt (Level 1) and the safety content (Level 3) are illustrative and listed for
  professional review.
- Development only: Metro's fast refresh does not reload the game page inside the web view; leave
  and reopen the level after changing game code.

## 12. Commands

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm run relay
```

```bash
npm run web
```

Then open `http://localhost:5173/coop-test.html?scene=level01` (two game pages), or two tabs of
`http://localhost:5173/?profile=a` and `?profile=b` (two whole apps). In the harness page's console:
`const m = await import('/scripts/e2e/coop-playthrough.js'); await m.run('level02')`.

Android (Windows, from `D:\b3` because of path length; see README):

```bash
powershell -File scripts/android-mirror.ps1 app:assembleDebug -PreactNativeArchitectures=x86_64
```

```bash
powershell -File scripts/android-mirror.ps1 app:assembleRelease -PreactNativeArchitectures=x86_64
```

```bash
powershell -File scripts/emulators.ps1 -Apk D:\b3\android\app\build\outputs\apk\release\app-release.apk
```

```bash
node scripts/e2e/relay-probe.mjs before ws://127.0.0.1:7777/bwbt <PIN>
```
