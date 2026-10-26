/**
 * Two-phone playthroughs, run in the two-page harness (coop-test.html): the host page runs the
 * level, the guest page only draws it and sends its controls through the room relay. The wife is
 * played on the host's page, the husband on the guest's - every one of his presses and stick
 * movements crosses the network, and the host decides what they do.
 *
 * Between stations characters are placed directly (as in playthroughs.js), but movement itself is
 * checked with real walking from both phones, and every interaction of the husband is a press on
 * the guest's phone.
 *
 * In the harness page:  const m = await import('/scripts/e2e/coop-playthrough.js'); await m.run('level01')
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function run(level, options = {}) {
  const HB = window.host.__bwbt;
  const GB = window.guest.__bwbt;
  if (!HB || !GB) throw new Error('both pages need their __bwbt handle');
  const L = () => HB.game.scene.getScene('level');
  const M = () => GB.game.scene.getScene('mirror');
  const log = [];
  const checks = [];
  const check = (name, ok, detail = '') => {
    checks.push({ name, ok: !!ok, detail });
    log.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  };

  /** Steps both pages, letting the network carry messages in between. */
  const step = async (ms, frame = 1000 / 60) => {
    for (let t = 0; t < ms; t += frame) {
      HB.advance(frame, frame);
      GB.advance(frame, frame);
      if (Math.round(t / frame) % 3 === 0) await sleep(4);
    }
    await sleep(20);
  };
  const settle = async () => {
    for (let i = 0; i < 6; i++) await step(50);
  };
  const key = (win, type, k, c) => win.dispatchEvent(new win.KeyboardEvent(type, { key: k, code: k, keyCode: c, which: c, bubbles: true }));
  /** The wife's interact button, on the host's own phone. */
  const W = async () => {
    key(window.host, 'keydown', 'e', 69);
    await step(40);
    key(window.host, 'keyup', 'e', 69);
    await step(60);
  };
  /** The husband's interact button, on the guest's phone: it reaches the host through the relay. */
  const H = async () => {
    M().hub.pressInteract();
    await step(34);
    await settle();
  };
  const Hrotate = async () => {
    M().hub.pressRotate();
    await step(34);
    await settle();
  };
  const tp = async (who, x, y, facing) => {
    const p = L().players[who];
    p.body.reset(x, y);
    if (facing) p.facing = facing;
    await step(60);
  };
  /** Walks with the stick of the phone that controls the character, towards a point. */
  const walk = async (who, x, y, maxMs = 6000) => {
    const hub = who === 'wife' ? L().hub : M().hub;
    const p = () => L().players[who];
    for (let t = 0; t < maxMs; t += 50) {
      const dx = x - p().x;
      const dy = y - p().y;
      const d = Math.hypot(dx, dy);
      if (d < 14) break;
      hub.setStick(dx / d, dy / d);
      await step(50);
    }
    hub.setStick(0, 0);
    await settle();
    return Math.hypot(x - p().x, y - p().y);
  };
  const guestSees = (who) => {
    const meta = M().meta;
    const sprite = meta && M().world.get(meta.players[who]);
    return sprite ? { x: sprite.x, y: sprite.y } : null;
  };
  const completions = () => (window.events ?? []).filter((e) => e.data?.value?.type === 'complete').map((e) => ({ from: e.from, result: e.data.value.result }));

  // A hidden page runs no frames by itself: step both until the level runs and the guest has it.
  for (let i = 0; i < 120 && !(L()?.started && M()?.order?.isSynced && !L().sys.isPaused()); i++) await step(50);
  await settle();
  /** Counts the interactions the host's game runs for each character. */
  const counter = { wife: 0, husband: 0 };
  const interaction = L().interaction;
  const update = interaction.update.bind(interaction);
  interaction.update = (players, intents) => {
    for (const id of ['wife', 'husband']) if (intents.get(id)?.interact) counter[id]++;
    return update(players, intents);
  };
  check('both pages are on the same run of the level', L().run && L().run === M().order.currentRun, L().run);
  check('the host is not waiting for the partner', !L().sys.isPaused() && L().hostNet.partnerPresent);
  // Close the level intro on both phones: each player dismisses their own.
  for (const win of [window.host, window.guest]) {
    key(win, 'keydown', 'x', 88);
    await step(40);
    key(win, 'keyup', 'x', 88);
  }
  await settle();
  check('the intro is closed on both phones', !L().hud.introOpen && !M().hud.introOpen);
  const ctl = L().controller;
  const objectives = () => ctl.ctx.objectives.list().map((o) => o.id + (o.done ? '✓' : '·')).join(' ');

  // -------------------------------------------------------------------------------------------
  // Movement: each phone drives its own character, with real walking and collisions.
  if (options.movement !== false) {
    const wife0 = { x: L().players.wife.x, y: L().players.wife.y };
    const husband0 = { x: L().players.husband.x, y: L().players.husband.y };
    const left = await walk('husband', husband0.x - 160, husband0.y);
    const husband1 = { x: L().players.husband.x, y: L().players.husband.y };
    check('the guest walks the husband with its stick', Math.abs(husband1.x - husband0.x) > 100, `moved ${Math.round(husband0.x - husband1.x)} px, ${Math.round(left)} px short`);
    check('the wife stayed where she was meanwhile', Math.hypot(L().players.wife.x - wife0.x, L().players.wife.y - wife0.y) < 2);
    const seen = guestSees('husband');
    check('the guest sees the husband where the host has him', seen && Math.hypot(seen.x - husband1.x, seen.y - husband1.y) < 12, seen ? `off by ${Math.round(Math.hypot(seen.x - husband1.x, seen.y - husband1.y))} px` : 'not drawn');
    await walk('wife', wife0.x + 120, wife0.y);
    const wifeSeen = guestSees('wife');
    check('the host walks the wife and the guest sees it', wifeSeen && Math.abs(wifeSeen.x - L().players.wife.x) < 12 && Math.abs(L().players.wife.x - wife0.x) > 80);
    check('the husband stood still while the wife walked', Math.hypot(L().players.husband.x - husband1.x, L().players.husband.y - husband1.y) < 2);
    const facing = L().players.husband.facing;
    const anim = M().world.get(M().meta.players.husband)?.frame?.name;
    log.push(`husband facing ${facing}, guest draws frame ${anim}`);
  }

  // Rapid presses: five presses on five consecutive guest frames are five interactions on the host.
  if (options.presses !== false) {
    const before = counter.husband;
    for (let i = 0; i < 5; i++) {
      M().hub.pressInteract();
      GB.advance(1000 / 60, 1000 / 60);
    }
    await settle();
    await settle();
    check('five quick presses on the guest are five interactions on the host', counter.husband - before === 5, `${counter.husband - before} of 5`);
    // A duplicated packet: the same input message twice changes nothing.
    const e = M().epoch;
    e.seq += 1;
    e.ia += 1;
    const dup = { t: 'in', run: e.run, ep: e.ep, seq: e.seq, x: 0, y: 0, ia: e.ia, ro: e.ro };
    const before2 = counter.husband;
    M().link.send(dup);
    M().link.send(dup);
    await settle();
    check('a duplicated input message presses once', counter.husband - before2 === 1, `${counter.husband - before2}`);
    // A press aimed at an earlier run of the level is not carried into this one.
    const before3 = counter.husband;
    M().link.send({ t: 'in', run: 'old-run', ep: 'old-ep', seq: 1, x: 0, y: 0, ia: 3, ro: 0 });
    await settle();
    check('a press from a stale run is ignored', counter.husband === before3);
    // Malformed controls are rejected.
    const rejected = L().hostNet.netStats.rejectedInputs;
    M().link.send({ t: 'in', run: e.run, ep: e.ep, seq: e.seq + 100, x: 'left', y: null, ia: -4, ro: 0 });
    await settle();
    check('malformed controls are rejected by the host', L().hostNet.netStats.rejectedInputs === rejected + 1);
    // Whatever the husband may have picked up while pressing, put it down again.
    if (L().carry.heldBy('husband')) await H();
  }

  // -------------------------------------------------------------------------------------------
  if (level === 'level01') {
    const LANE = { husband: 1140, shared: 1272, wife: 1404 };
    // Each places the cards nearest to them; his go through the network.
    const plan = [
      ['prenatal', 'shared', 'wife'],
      ['groceries', 'husband', 'husband'],
      ['cleaning', 'husband', 'husband'],
      ['cooking', 'wife', 'wife'],
      ['hospital', 'shared', 'husband'],
      ['budget', 'shared', 'wife'],
      ['family', 'wife', 'husband'],
      ['nights', 'shared', 'wife'],
      ['boxes', 'husband', 'husband'],
    ];
    for (const [id, lane, who] of plan) {
      const item = L().carry.item(id);
      await tp(who, item.sprite.x, item.shadow.y + 26, 'up');
      who === 'wife' ? await W() : await H();
      if (L().carry.heldBy(who)?.id !== id) log.push(`! ${who} did not pick up ${id}`);
      await tp(who, LANE[lane], 590, 'up');
      who === 'wife' ? await W() : await H();
    }
    check('all nine cards on the board, placed by both phones', ctl.board.placedCount === 9, `${ctl.board.placedCount}`);
    const carriedSeen = L().carry.item('cooking');
    log.push(`card on the board at ${Math.round(carriedSeen.sprite.x)},${Math.round(carriedSeen.sprite.y)}`);
    // Each reads their own schedule; he presses on his own phone.
    await tp('wife', 760, 905, 'up');
    await W();
    await tp('husband', 432, 175, 'up');
    await H();
    // A wrong day first: she pins Monday, he pins Monday - the doctor is not in.
    await tp('wife', ctl.dayX(2), 590, 'up');
    await W();
    await tp('husband', ctl.dayX(2), 592, 'up');
    await H();
    check('a wrong day agreed by both is rejected by the host', !ctl.ctx.objectives.isDone('schedule') && ctl.schedule.wrongAttempts === 1, `wrong attempts ${ctl.schedule.wrongAttempts}`);
    await step(1000);
    await tp('wife', ctl.dayX(3), 590, 'up');
    await W();
    await tp('husband', ctl.dayX(3), 592, 'up');
    await H();
    check('Tuesday, the day that works for all three, is accepted', ctl.ctx.objectives.isDone('schedule'));
    // The review is a joint confirmation: both press, one on each phone.
    await tp('wife', 1250, 668);
    await tp('husband', 1295, 668);
    await W();
    await H();
  } else if (level === 'level02') {
    const T = ctl.trolley;
    // He holds the storeroom shutter on the plate (from his phone, by standing on it).
    await tp('wife', 1700, 590, 'up');
    await W();
    await tp('husband', 2664, 300);
    await tp('wife', 2840, 178, 'up');
    await W();
    await tp('wife', 2840, 420);
    await tp('husband', 2560, 420);
    log.push('from the storeroom: ' + L().carry.heldBy('wife')?.id);
    await tp('wife', T.x, T.y + 40, 'up');
    await W();
    // He fetches things too, through the network.
    for (const [id, who] of [['clothes', 'husband'], ['bath', 'wife'], ['firstAid', 'husband']]) {
      const it = L().carry.item(id);
      await tp(who, it.sprite.x, it.shadow.y + 26, 'up');
      who === 'wife' ? await W() : await H();
      await tp(who, T.x + (who === 'wife' ? 0 : 30), T.y + 40, 'up');
      who === 'wife' ? await W() : await H();
    }
    // The bassinet is a big purchase: she proposes it at the trolley, he agrees from his phone.
    const bassinet = L().carry.item('bassinet');
    await tp('wife', bassinet.sprite.x, bassinet.shadow.y + 26, 'up');
    await W();
    await tp('wife', T.x, T.y + 40, 'up');
    await W();
    await tp('husband', T.x + 30, T.y + 44, 'up');
    await H();
    log.push('basket: ' + ctl.basket.contents.map((p) => p.id).join(','));
    const e = ctl.basket.evaluate();
    check('the host keeps the basket total and what is left', e.spent > 0 && e.remaining === 3500 - e.spent, `spent ${e.spent}, left ${e.remaining}`);
    const widgetText = M()
      .hud.replicaLayer.list.flatMap((c) => (c.list ?? [c]))
      .map((o) => o.text)
      .filter(Boolean)
      .join(' | ');
    log.push(`guest's budget widget: ${widgetText.slice(0, 160)}`);

    if (options.reconnect !== false) {
      // The guest's Wi-Fi drops for a few seconds while both are at the till.
      const link = M().link;
      const url = link.options.url;
      const fullBefore = L().hostNet.netStats.fullSnapshots;
      link.options = { ...link.options, url: 'ws://127.0.0.1:1/bwbt' };
      link.socket?.close();
      for (let i = 0; i < 50 && !L().sys.isPaused(); i++) await step(100);
      await sleep(3200);
      await step(100);
      check('the host pauses the shared game while the partner is away', L().sys.isPaused() && L().pauseReasons.has('partner'));
      const heldBefore = ctl.basket.contents.length;
      link.options = { ...link.options, url };
      for (let i = 0; i < 80 && (L().sys.isPaused() || !M().order.isSynced); i++) await step(100);
      check('the partner comes back with the same key, and the game resumes by itself', !L().sys.isPaused() && M().order.isSynced);
      check('the returning guest got the whole picture again', L().hostNet.netStats.fullSnapshots > fullBefore, `${L().hostNet.netStats.fullSnapshots - fullBefore} full snapshot(s)`);
      check('nothing in the basket changed across the drop', ctl.basket.contents.length === heldBefore);
    }

    await tp('wife', 2960, 950, 'up');
    await tp('husband', 3020, 950, 'up');
    await W();
    await H();
    await step(400);
    check('both confirmed at the till: the change puzzle opens', ctl.paying, `paying ${ctl.paying}`);
    const wrong = ctl.coins.find((c) => c.value !== ctl.correctChange);
    if (wrong) await tp('husband', wrong.box.x, wrong.box.y + 40);
    await settle();
    check('a wrong change amount is rejected by the host', ctl.mathMisses === 1 && ctl.paying, `misses ${ctl.mathMisses}`);
    const right = ctl.coins.find((c) => c.value === ctl.correctChange);
    check("the right answer is the host's own sum", right && right.value === 3500 - ctl.basket.total(), `${right?.value} = 3500 - ${ctl.basket.total()}`);
    if (right) await tp('wife', right.box.x, right.box.y + 40);
  } else if (level === 'level03') {
    const J = L().joint;
    const at = (c, r, t) => ({ x: 14 * 48 + c * 48 + t.footW / 2, y: 2 * 48 + r * 48 + t.footH });
    const solo = async (id, c, r, who = 'wife') => {
      const t = J.get(id);
      await tp(who, t.x - (t.footW / 2 + 20), t.y - 10, 'right');
      who === 'wife' ? await W() : await H();
      const p = at(c, r, t);
      t.body.reset(p.x, p.y);
      await step(60);
      who === 'wife' ? await W() : await H();
    };
    const duo = async (id, c, r, rotate, walkTogether = false) => {
      const t = J.get(id);
      await tp('wife', t.x - (t.footW / 2 + 24), t.y - 10, 'right');
      await W();
      await tp('husband', t.x + (t.footW / 2 + 24), t.y - 10, 'left');
      await H();
      check(`${id}: both phones hold it together`, t.holders.length === 2, `holders ${t.holders.join(',')}`);
      if (walkTogether) {
        // Carried for real: both sticks push the same way, from two phones.
        const x0 = t.x;
        for (let i = 0; i < 24; i++) {
          L().hub.setStick(1, 0);
          M().hub.setStick(1, 0);
          await step(50);
        }
        L().hub.setStick(0, 0);
        M().hub.setStick(0, 0);
        await settle();
        check(`${id}: carried across the room by both`, t.x - x0 > 40, `moved ${Math.round(t.x - x0)} px`);
      }
      if (rotate) {
        const before = ctl.rotation.get(id) ?? 0;
        await Hrotate();
        const after = ctl.rotation.get(id) ?? 0;
        check(`${id}: turned with the rotate button on the guest's phone`, after !== before, `${before}° -> ${after}°`);
      }
      const p = at(c, r, t);
      t.body.reset(p.x, p.y);
      await step(60);
      await W();
    };
    await solo('dresser', 1, 0);
    await solo('changing', 7, 0, 'husband');
    await solo('shelf', 9, 0);
    await solo('rocker', 10, 5, 'husband');
    await duo('wardrobe', 12, 0, true);
    await duo('crib', 0, 3, false, true);
    for (const [id, who] of [['pillow', 'wife'], ['bumper', 'husband'], ['plush', 'wife'], ['quilt', 'husband']]) {
      const it = L().carry.item(id);
      await tp(who, it.sprite.x, it.shadow.y + 24, 'up');
      who === 'wife' ? await W() : await H();
      await tp(who, 1180, 330, 'down');
      who === 'wife' ? await W() : await H();
    }
    check('the host checks the real layout and the cot', ctl.sleep.isSafe() && ctl.layout.evaluate().length === 0, JSON.stringify(ctl.layout.evaluate()));
    await tp('wife', 940, 370);
    await tp('husband', 985, 370);
    await W();
    await H();
  }

  for (let i = 0; i < 40 && completions().length < 2; i++) await step(150);
  const done = completions();
  log.push('objectives: ' + objectives());
  const host = done.find((c) => c.from === 'host')?.result;
  const guest = done.find((c) => c.from === 'guest')?.result;
  check('the level result reaches both phones', host && guest, `${done.length} completion event(s)`);
  check('both phones have the same result, with the same id', host && guest && host.id === guest.id && host.stars === guest.stars, host ? `${host.id} ★${host.stars}` : '');
  interaction.update = update;
  const stats = L().hostNet?.netStats;
  if (stats) {
    const seconds = (Date.now() - stats.since) / 1000;
    log.push(`network: ${stats.snapshots} snapshots (${stats.fullSnapshots} full, last ${stats.lastFullBytes} B), deltas up to ${stats.maxDeltaBytes} B, ${Math.round(stats.bytesSent / 1024)} KB in ${Math.round(seconds)} s, ${stats.inputs} inputs, ${stats.rejectedInputs} rejected`);
  }
  return { checks, log, passed: checks.every((c) => c.ok) };
}

/** The host leaves the level: the guest's page hears it and says so. */
export async function hostLeaves() {
  const HB = window.host.__bwbt;
  const before = (window.events ?? []).length;
  window.hostFrame.remove();
  for (let i = 0; i < 40; i++) {
    await sleep(50);
    if ((window.events ?? []).slice(before).some((e) => e.from === 'guest' && e.data?.value?.status === 'host-left')) return { ok: true };
  }
  void HB;
  return { ok: false, events: (window.events ?? []).slice(before).map((e) => `${e.from}:${e.data?.value?.type}/${e.data?.value?.status}`) };
}
