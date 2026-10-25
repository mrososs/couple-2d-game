/**
 * Scripted playthroughs of the three levels, evaluated inside the game page (in the browser, or in
 * the Android web view over the DevTools protocol). They press the real interact keys and let the
 * real systems run; between stations they move characters directly, since walking and collisions
 * are covered by their own checks. Each returns a log and the objectives at the end.
 *
 * Usage inside the page:  await window.__bwbtPlay('level01')
 */
window.__bwbtPlay = async function play(level) {
  const B = window.__bwbt;
  if (!B) throw new Error('game page has no __bwbt handle yet');
  const L = () => B.game.scene.getScene('level');
  const key = (type, k, c) => window.dispatchEvent(new KeyboardEvent(type, { key: k, code: k, keyCode: c, which: c, bubbles: true }));
  const tap = (k, c) => {
    key('keydown', k, c);
    B.advance(40);
    key('keyup', k, c);
    B.advance(40);
  };
  const W = () => tap('e', 69);
  const H = () => tap('Enter', 13);
  const tp = (who, x, y, facing) => {
    const p = L().players[who];
    p.body.reset(x, y);
    if (facing) p.facing = facing;
    B.advance(60);
  };
  const log = [];
  B.advance(300);
  tap('x', 88);
  B.advance(300);
  const ctl = L().controller;
  const objectives = () => ctl.ctx.objectives.list().map((o) => o.id + (o.done ? '✓' : '·')).join(' ');

  if (level === 'level01') {
    const LANE = { husband: 1140, shared: 1272, wife: 1404 };
    const plan = { prenatal: 'shared', groceries: 'husband', cleaning: 'husband', cooking: 'wife', hospital: 'shared', budget: 'shared', family: 'wife', nights: 'shared', boxes: 'husband' };
    for (const [id, lane] of Object.entries(plan)) {
      const item = L().carry.item(id);
      tp('wife', item.sprite.x, item.shadow.y + 26, 'up');
      W();
      tp('wife', LANE[lane], 590, 'up');
      W();
    }
    log.push('cards placed: ' + ctl.board.placedCount);
    tp('wife', 760, 905, 'up');
    W();
    tp('husband', 432, 175, 'up');
    H();
    tp('wife', ctl.dayX(3), 590, 'up');
    W();
    tp('husband', ctl.dayX(3), 592, 'up');
    H();
    log.push('schedule: ' + ctl.ctx.objectives.isDone('schedule'));
    tp('wife', 1250, 668);
    tp('husband', 1295, 668);
    W();
    H();
  } else if (level === 'level02') {
    const T = ctl.trolley;
    tp('wife', 1700, 590, 'up');
    W();
    tp('husband', 2664, 300);
    tp('wife', 2840, 178, 'up');
    W();
    tp('wife', 2840, 420);
    tp('husband', 2560, 420);
    log.push('from the storeroom: ' + L().carry.heldBy('wife')?.id);
    tp('wife', T.x, T.y + 40, 'up');
    W();
    for (const id of ['clothes', 'bath', 'firstAid']) {
      const it = L().carry.item(id);
      tp('wife', it.sprite.x, it.shadow.y + 26, 'up');
      W();
      tp('wife', T.x, T.y + 40, 'up');
      W();
    }
    // The bassinet is a big purchase: she proposes it at the trolley, he agrees.
    const bassinet = L().carry.item('bassinet');
    tp('wife', bassinet.sprite.x, bassinet.shadow.y + 26, 'up');
    W();
    tp('wife', T.x, T.y + 40, 'up');
    W();
    tp('husband', T.x + 30, T.y + 44, 'up');
    H();
    log.push('basket: ' + ctl.basket.contents.map((p) => p.id).join(','));
    tp('wife', 2960, 950, 'up');
    tp('husband', 3020, 950, 'up');
    W();
    H();
    B.advance(200);
    const right = ctl.coins.find((c) => c.value === ctl.correctChange);
    if (right) tp('wife', right.box.x, right.box.y + 40);
  } else if (level === 'level03') {
    const J = L().joint;
    const C = L().carry;
    const at = (c, r, t) => ({ x: 14 * 48 + c * 48 + t.footW / 2, y: 2 * 48 + r * 48 + t.footH });
    const solo = (id, c, r) => {
      const t = J.get(id);
      tp('wife', t.x - (t.footW / 2 + 20), t.y - 10, 'right');
      W();
      const p = at(c, r, t);
      t.body.reset(p.x, p.y);
      B.advance(60);
      W();
    };
    const duo = (id, c, r, rotate) => {
      const t = J.get(id);
      tp('wife', t.x - (t.footW / 2 + 24), t.y - 10, 'right');
      W();
      tp('husband', t.x + (t.footW / 2 + 24), t.y - 10, 'left');
      H();
      if (rotate) tap('r', 82);
      const p = at(c, r, t);
      t.body.reset(p.x, p.y);
      B.advance(60);
      W();
    };
    solo('dresser', 1, 0);
    solo('changing', 7, 0);
    solo('shelf', 9, 0);
    solo('rocker', 10, 5);
    duo('wardrobe', 12, 0, true);
    duo('crib', 0, 3);
    for (const id of ['pillow', 'bumper', 'plush', 'quilt']) {
      const it = C.item(id);
      tp('wife', it.sprite.x, it.shadow.y + 24, 'up');
      W();
      tp('wife', 1180, 330, 'down');
      W();
    }
    log.push('safe: ' + ctl.sleep.isSafe() + ' issues: ' + JSON.stringify(ctl.layout.evaluate()));
    tp('wife', 940, 370);
    tp('husband', 985, 370);
    W();
    H();
  }
  B.advance(2600);
  log.push('objectives: ' + objectives());
  return log;
};
