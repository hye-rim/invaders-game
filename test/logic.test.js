'use strict';
// 스페이스 인베이더 규칙 시험. 실행: node --test
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

const fresh = (seed = 4, wave = 1) => L.newGame(L.rng(seed), wave);
const run = (st, secs, input = {}) => { for (let i = 0; i < Math.round(secs / 0.01); i++) L.step(st, 0.01, input); };
const allEv = (st, secs, input = {}) => { const o = []; for (let i = 0; i < Math.round(secs / 0.01); i++) { L.step(st, 0.01, input); o.push(...st.events); } return o; };
const evs = (st, t) => st.events.filter((e) => e.t === t);
// 외계인이 하나만 남은 판 (한 마리는 멀리 있어 판이 끝나지 않음)
function few(st, keep = []) {
  for (const i of st.inv) i.alive = keep.includes(i);
  st.fireT = 1e9; st.ufoT = 1e9;
  return st;
}
const bare = (seed) => { const st = fresh(seed); const keep = [st.inv[0], st.inv[1]]; keep.forEach((k) => { k.x = 20; k.y = 60; }); return few(st, keep); };

test('55 invaders in 5 rows of 11, the cannon in the middle with 3 lives and 4 bunkers', () => {
  const st = fresh();
  assert.strictEqual(st.inv.length, 55); assert.strictEqual(L.aliveCount(st), 55);
  assert.strictEqual(L.START_LIVES, 3); assert.strictEqual(st.lives, 3);
  assert.strictEqual(st.bunkers.length, 4);
  assert.strictEqual(st.player.x, L.W / 2);
  const rows = new Set(st.inv.map((i) => i.row)); assert.strictEqual(rows.size, 5);
});

test('points: top row 30, middle two rows 20, bottom two rows 10', () => {
  assert.deepStrictEqual([0, 1, 2, 3, 4].map((r) => L.POINTS[r]), [30, 20, 20, 10, 10]);
  for (const [row, pts] of [[0, 30], [2, 20], [4, 10]]) {
    const st = bare(); const inv = st.inv.find((i) => i.row === row); inv.alive = true; inv.x = 100; inv.y = 100;
    st.bullet = { x: 100, y: 108 };
    const ev = allEv(st, 0.1, {});
    assert.ok(ev.some((e) => e.t === 'kill' && e.pts === pts), 'row ' + row);
  }
});

test('the cannon moves at a steady speed and stays on screen', () => {
  const st = bare();
  run(st, 1, { right: true });
  assert.ok(Math.abs(st.player.x - (112 + 60)) < 1);
  run(st, 10, { right: true });
  assert.ok(st.player.x <= L.W - 10 + 1e-9);
  run(st, 10, { left: true });
  assert.ok(st.player.x >= 10 - 1e-9);
});

test('only one cannon shot at a time, and it flies up and disappears at the top', () => {
  const st = bare();
  L.step(st, 0.01, { fire: true });
  assert.ok(st.bullet);
  let shots = 0; const first = st.bullet;
  for (let i = 0; i < 50; i++) { L.step(st, 0.01, { fire: true }); shots += evs(st, 'fire').length; }
  assert.strictEqual(shots, 0, 'no second shot while one is flying');
  assert.ok(st.bullet === first || st.bullet === null);
  run(st, 1);
  assert.strictEqual(st.bullet, null);
  L.step(st, 0.01, { fire: true });
  assert.ok(st.bullet, 'a new shot after the old one is gone');
});

test('the formation marches one invader at a time: slow at first, one step per second', () => {
  const st = fresh(); st.fireT = 1e9; st.ufoT = 1e9;
  const x0 = st.inv.map((i) => i.x);
  run(st, L.TICK * 55 * 1.001 + 0.001);
  const moved = st.inv.filter((i, k) => i.x !== x0[k]);
  assert.strictEqual(moved.length, 55);
  assert.ok(st.inv.every((i, k) => Math.abs(i.x - x0[k] - L.STEP) < 1e-9), 'everyone moved 2 pixels');
  const s2 = fresh(); s2.fireT = 1e9; s2.ufoT = 1e9; run(s2, 0.1);
  const first = s2.inv.filter((i) => i.x !== L.FORM_LEFT + i.col * L.COL_GAP).length;
  assert.ok(first > 0 && first < 55, 'staggered movement');
});

test('fewer invaders means a faster march (each sweep is shorter)', () => {
  const sweepTime = (keepN) => {
    const st = fresh(); const keep = st.inv.slice(0, keepN); few(st, keep);
    keep.forEach((k, i) => { k.x = 100 + i; k.y = 100; });
    const x0 = keep[0].x; let t = 0;
    while (keep[0].x === x0 && t < 5) { L.step(st, 0.005, {}); t += 0.005; }
    const x1 = keep[0].x; while (keep[0].x === x1 && t < 10) { L.step(st, 0.005, {}); t += 0.005; }
    return t;
  };
  assert.ok(sweepTime(40) > sweepTime(10) * 1.5);
  assert.ok(sweepTime(10) > sweepTime(2));
});

test('reaching the edge makes the whole formation drop 8 pixels and turn around', () => {
  const st = fresh(); st.fireT = 1e9; st.ufoT = 1e9;
  const y0 = st.inv[0].y; let turned = false, i = 0;
  while (!turned && i < 4000) { run(st, 0.1); i++; if (st.dir === -1) turned = true; }
  assert.ok(turned, 'turned around');
  assert.ok(st.inv.every((x) => Math.abs(x.y - (x.row * 16 + L.FORM_TOP + 8)) < 1e-9 || Math.abs(x.y - (x.row * 16 + L.FORM_TOP)) < 1e-9));
  assert.ok(st.inv[0].y - y0 === 8 || st.inv[0].y - y0 === 0);
  run(st, 3);
  assert.ok(st.inv.every((x) => x.y >= x.row * 16 + L.FORM_TOP + 8 - 1e-9), 'dropped by 8');
});

test('later waves start lower', () => {
  const a = fresh(1, 1), b = fresh(1, 4), c = fresh(1, 10);
  assert.ok(b.inv[0].y > a.inv[0].y);
  assert.strictEqual(b.inv[0].y - a.inv[0].y, 3 * L.DROP);
  assert.strictEqual(c.inv[0].y, a.inv[0].y, 'the cycle starts over');
});

test('invaders reaching the bottom is game over at once, whatever the lives', () => {
  const st = fresh(); st.fireT = 1e9; st.ufoT = 1e9;
  for (const i of st.inv) { i.y += 140; }
  run(st, 2);
  const ev = [];
  for (let k = 0; k < 400 && st.phase !== 'over'; k++) { L.step(st, 0.01, {}); ev.push(...st.events); }
  assert.strictEqual(st.phase, 'over');
  assert.strictEqual(st.lives, 0);
});

test('an invader bullet kills the cannon and costs a life; the new cannon gets a short shield', () => {
  const st = bare();
  st.ebullets.push({ kind: 'plunger', x: st.player.x, y: L.PLAYER_Y - 2, frame: 0 });
  L.step(st, 0.01, {});
  assert.strictEqual(st.phase, 'dying'); assert.strictEqual(st.lives, 2);
  run(st, L.DYING + 0.1);
  assert.strictEqual(st.phase, 'play'); assert.ok(st.player.invuln > 0);
  st.ebullets.push({ kind: 'plunger', x: st.player.x, y: L.PLAYER_Y - 2, frame: 0 });
  L.step(st, 0.01, {});
  assert.strictEqual(st.phase, 'play', 'shielded');
});

test('the game ends after the third death', () => {
  const st = bare(); st.lives = 1;
  st.ebullets.push({ kind: 'plunger', x: st.player.x, y: L.PLAYER_Y - 2, frame: 0 });
  L.step(st, 0.01, {});
  run(st, L.DYING + 0.1);
  assert.strictEqual(st.phase, 'over');
});

test('at most 3 invader bullets, at most one of each kind, rolling one aims at the cannon', () => {
  const st = fresh(); st.ufoT = 1e9;
  for (let i = 0; i < 60; i++) L.fireInvader(st);
  assert.ok(st.ebullets.length <= 3);
  assert.strictEqual(new Set(st.ebullets.map((b) => b.kind)).size, st.ebullets.length);
  let near = 0, n = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const s = fresh(seed); s.player.x = 150;
    for (let k = 0; k < 20 && !s.ebullets.some((b) => b.kind === 'rolling'); k++) { s.ebullets = []; L.fireInvader(s); }
    const b = s.ebullets.find((x) => x.kind === 'rolling'); if (!b) continue;
    n++; if (Math.abs(b.x - 150) < 10) near++;
  }
  assert.ok(n >= 10 && near === n, `rolling aimed ${near}/${n}`);
});

test('invader bullets fall to the ground and vanish; shooting them down with your own shot works', () => {
  const st = bare(); st.player.x = 20;
  st.ebullets.push({ kind: 'squiggly', x: 200, y: 100, frame: 0 });
  run(st, 2);
  assert.strictEqual(st.ebullets.length, 0);
  const s2 = bare(); s2.ebullets.push({ kind: 'squiggly', x: 112, y: 160, frame: 0 }); s2.bullet = { x: 112, y: 166 };
  const ev = allEv(s2, 0.05);
  assert.ok(ev.some((e) => e.t === 'bulletclash')); assert.strictEqual(s2.ebullets.length, 0);
});

test('bunkers: a bullet from either side takes a bite out, and they do not heal', () => {
  const st = bare(); const b = st.bunkers[0];
  const count = () => b.cells.reduce((s, c) => s + c, 0);
  const c0 = count();
  st.bullet = { x: b.x + 5, y: b.y + 20 }; L.step(st, 0.02, {});
  assert.ok(count() < c0, 'eroded by a cannon shot');
  const c1 = count();
  st.ebullets.push({ kind: 'plunger', x: b.x + 5, y: b.y - 4, frame: 0 }); st.player.x = 200;
  run(st, 0.2);
  assert.ok(count() < c1, 'eroded by an invader bullet');
  const c2 = count(); run(st, 3); assert.strictEqual(count(), c2);
});

test('bunkers have a notch at the bottom middle so a shot can pass under them', () => {
  const b = L.makeBunker(L.BUNKERS[0]);
  assert.strictEqual(b.cells[15 * L.BW + 11], 0);
  assert.strictEqual(b.cells[15 * L.BW + 1], 1);
  assert.strictEqual(b.cells[0], 0, 'rounded top corners');
});

test('invaders walking through a bunker eat it away', () => {
  const st = fresh(); st.fireT = 1e9; st.ufoT = 1e9; const b = st.bunkers[1];
  const c0 = b.cells.reduce((s, c) => s + c, 0);
  const inv = st.inv[0]; few(st, [inv, st.inv[1]]); st.inv[1].x = 5; st.inv[1].y = 40;
  inv.x = b.x + 8; inv.y = b.y + 6;
  run(st, 0.1);
  assert.ok(b.cells.reduce((s, c) => s + c, 0) < c0);
});

test('the mystery ship: appears every 25.6 seconds while 8 or more invaders remain, flies across and leaves', () => {
  const st = fresh(); st.fireT = 1e9;
  run(st, L.UFO_EVERY - 1); assert.strictEqual(st.ufo, null);
  const ev = allEv(st, 2); assert.ok(ev.some((e) => e.t === 'ufo')); assert.ok(st.ufo);
  const dir = Math.sign(st.ufo.vx); run(st, 1.5); assert.ok(st.ufo && Math.sign(st.ufo.vx) === dir);
  run(st, 8); assert.strictEqual(st.ufo, null);
  const s2 = fresh(); s2.fireT = 1e9; few(s2, s2.inv.slice(0, 5)); s2.inv.slice(0, 5).forEach((k, i) => { k.x = 20 + i * 4; k.y = 60; });
  s2.ufoT = 0.1; run(s2, 1); assert.strictEqual(s2.ufo, null, 'not with fewer than 8 invaders');
});

test('the mystery ship score depends on how many shots you fired: 300 on the 23rd', () => {
  assert.strictEqual(L.ufoPoints(23), 300);
  assert.strictEqual(L.ufoPoints(38), 300);
  for (let n = 1; n <= 60; n++) assert.ok([50, 100, 150, 300].includes(L.ufoPoints(n)));
  const st = bare(); st.shots = 23; st.ufo = { x: 100, y: 52, vx: 0 }; st.bullet = { x: 100, y: 60 };
  const ev = allEv(st, 0.05); const hit = ev.find((e) => e.t === 'ufohit');
  assert.ok(hit && hit.pts === 300); assert.strictEqual(st.ufo, null);
});

test('an extra cannon at 1500 points, once', () => {
  const st = bare(); st.score = 1490;
  const inv = st.inv[0]; inv.x = 100; inv.y = 100; st.bullet = { x: 100, y: 108 };
  run(st, 0.1);
  assert.strictEqual(st.lives, 4);
  st.score = 3000; st.inv[1].x = 100; st.inv[1].y = 100; st.bullet = { x: 100, y: 108 }; run(st, 0.1);
  assert.strictEqual(st.lives, 4);
});

test('clearing all 55 starts the next wave with new bunkers and the score kept', () => {
  const st = bare(); st.score = 500;
  for (const i of st.inv) i.alive = false;
  L.step(st, 0.01, {});
  assert.strictEqual(st.phase, 'clear');
  run(st, L.CLEAR_DELAY + 0.1);
  assert.strictEqual(st.wave, 2); assert.strictEqual(L.aliveCount(st), 55); assert.strictEqual(st.score, 500);
  assert.strictEqual(st.phase, 'play');
});

test('firing gets more frequent as the score rises and invaders thin out', () => {
  const a = fresh(); const b = fresh(); b.score = 3000; few(b, b.inv.slice(0, 5));
  assert.ok(L.reloadTime(b) < L.reloadTime(a));
  assert.ok(L.reloadTime(b) >= 0.35);
});

test('random play never breaks the rules (fuzz)', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const r = L.rng(seed), st = L.newGame(L.rng(seed * 5), 1 + (seed % 4));
    for (let i = 0; i < 8000 && st.phase !== 'over'; i++) {
      L.step(st, 0.02, { left: r() < 0.3, right: r() < 0.3, fire: r() < 0.5 });
      assert.ok(st.player.x >= 10 - 1e-9 && st.player.x <= L.W - 10 + 1e-9);
      assert.ok(st.ebullets.length <= 3 && st.lives >= 0 && st.score >= 0);
      assert.ok(L.aliveCount(st) <= 55);
    }
  }
});
