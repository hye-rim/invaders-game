'use strict';
// 스페이스 인베이더 규칙 (DOM 없음). 화면은 game.js, 시험은 test/logic.test.js
const LOGIC_INVADERS = (() => {
  const W = 224, H = 256;
  const COLS = 11, ROWS = 5, COL_GAP = 16, ROW_GAP = 16;
  const FORM_LEFT = 24, FORM_TOP = 76;                    // 첫 줄(맨 위)의 y, 첫 열의 중심 x 기준 왼쪽
  const STEP = 2, DROP = 8, TICK = 1 / 60;                // 한 번 움직일 때 2픽셀, 줄이 벽에 닿으면 8픽셀 내려옴. 1/60초마다 한 마리씩 움직임
  const EDGE_L = 8, EDGE_R = W - 8;
  const PLAYER_Y = 222, PLAYER_W = 13, PLAYER_SPEED = 60, PLAYER_MIN = 10, PLAYER_MAX = W - 10;
  const BULLET_SPEED = 240;                                // 내 총알(픽셀/초). 한 번에 한 발
  const EBULLET_SPEED = 96, MAX_EBULLETS = 3;
  const GROUND = 238;
  const START_LIVES = 3, EXTRA_LIFE_AT = 1500;
  const UFO_Y = 52, UFO_SPEED = 50, UFO_EVERY = 25.6, UFO_MIN_INVADERS = 8;
  const DYING = 1.6, CLEAR_DELAY = 1.6;
  const POINTS = { 0: 30, 1: 20, 2: 20, 3: 10, 4: 10 };    // 줄(0 = 맨 위)별 점수
  const WIDTH = { 0: 8, 1: 11, 2: 11, 3: 12, 4: 12 };
  // 첫 판은 가장 높은 줄에서 시작하고, 판이 지날수록 낮은 줄에서 시작한다 (한 번에 8픽셀씩, 아홉 번째부터 처음으로 돌아감)
  const START_DROPS = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const UFO_SCORES_BY_SHOT = [100, 50, 50, 100, 150, 100, 100, 50, 300, 100, 100, 100, 50, 150, 100];   // 내가 쏜 횟수로 정해지는 UFO 점수표 (23번째 발에 300)
  const BUNKERS = [0, 1, 2, 3].map((i) => ({ x: 33 + i * 48, y: 184 }));          // 방어벽 왼쪽 위
  const BW = 22, BH = 16;

  const rng = (seed) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const emit = (st, e) => { st.events.push(e); };

  function makeBunker(b) {
    // 22×16 칸. 윗부분은 둥글고, 아래 가운데는 비어 있다
    const cells = new Uint8Array(BW * BH);
    for (let y = 0; y < BH; y++) for (let x = 0; x < BW; x++) {
      let on = 1;
      if (y < 4 && (x < 4 - y || x >= BW - (4 - y))) on = 0;                // 윗모서리 깎기
      if (y >= BH - 6 && x >= 7 && x < BW - 7 && y >= BH - 6 + Math.max(0, 3 - Math.abs(x - 10.5) * 0.7)) on = 0;      // 아래 가운데 홈
      cells[y * BW + x] = on;
    }
    return { x: b.x, y: b.y, cells };
  }

  function newGame(rand = Math.random, wave = 1) {
    const st = { rand, score: 0, lives: START_LIVES, wave, t: 0, events: [], extra: false, shots: 0, phase: 'play', ufoT: UFO_EVERY, ufo: null, ebullets: [], bullet: null };
    st.bunkers = BUNKERS.map(makeBunker);
    startWave(st, wave);
    return st;
  }
  function startWave(st, wave) {
    st.wave = wave; st.inv = [];
    const drop = START_DROPS[(wave - 1) % START_DROPS.length] * DROP;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) st.inv.push({ row: r, col: c, x: FORM_LEFT + c * COL_GAP, y: FORM_TOP + drop + r * ROW_GAP, alive: true, w: WIDTH[r], frame: 0 });
    st.dir = 1; st.cursor = 0; st.sweepEdge = false; st.dropping = false; st.tickT = 0; st.beat = 0;
    st.ebullets = []; st.bullet = null; st.ufo = null; st.ufoT = UFO_EVERY; st.fireT = 1.2; st.kinds = { rolling: 0, plunger: 0, squiggly: 0 };
    st.player = { x: W / 2, alive: true, invuln: 0 }; st.clearT = 0;
    st.phase = 'play';
    if (wave > 1) st.bunkers = BUNKERS.map(makeBunker);                      // 판이 바뀌면 방어벽이 새로 생김
    emit(st, { t: 'wave', wave });
  }
  const aliveCount = (st) => st.inv.reduce((n, i) => n + (i.alive ? 1 : 0), 0);
  function addScore(st, n) {
    st.score += n;
    if (!st.extra && st.score >= EXTRA_LIFE_AT) { st.extra = true; st.lives++; emit(st, { t: 'extra' }); }
  }

  function killPlayer(st, why) {
    const p = st.player;
    if (!p.alive || st.phase !== 'play') return;
    p.alive = false; st.lives--; st.phase = 'dying'; st.dyingT = DYING; st.bullet = null; st.ebullets = [];
    emit(st, { t: 'dead', why, x: p.x });
  }

  // ---- 방어벽 ----
  function bunkerAt(st, x, y) {
    for (const b of st.bunkers) if (x >= b.x && x < b.x + BW && y >= b.y && y < b.y + BH) return b;
    return null;
  }
  const cellOn = (b, x, y) => b.cells[Math.floor(y - b.y) * BW + Math.floor(x - b.x)] === 1;
  function erode(st, b, x, y, radius) {
    let n = 0;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius + 1) continue;
      const cx = Math.floor(x - b.x) + dx, cy = Math.floor(y - b.y) + dy;
      if (cx < 0 || cy < 0 || cx >= BW || cy >= BH) continue;
      if (st.rand() < 0.15 && dx * dx + dy * dy > 2) continue;                // 가장자리는 들쭉날쭉하게
      if (b.cells[cy * BW + cx]) { b.cells[cy * BW + cx] = 0; n++; }
    }
    return n;
  }

  // ---- 외계인 ----
  function moveInvader(st, inv) {
    if (st.dropping) { inv.y += DROP; }
    else inv.x += STEP * st.dir;
    inv.frame ^= 1;
    if (!st.dropping && (inv.x - inv.w / 2 <= EDGE_L || inv.x + inv.w / 2 >= EDGE_R)) st.sweepEdge = true;
    // 방어벽을 깎으며 지나감
    for (const b of st.bunkers) if (inv.y + 4 >= b.y && inv.y - 4 <= b.y + BH && inv.x + inv.w / 2 >= b.x && inv.x - inv.w / 2 < b.x + BW) {
      for (let yy = Math.max(b.y, inv.y - 4); yy < Math.min(b.y + BH, inv.y + 5); yy++) for (let xx = Math.max(b.x, inv.x - inv.w / 2); xx < Math.min(b.x + BW, inv.x + inv.w / 2); xx++) b.cells[Math.floor(yy - b.y) * BW + Math.floor(xx - b.x)] = 0;
    }
    if (inv.y + 4 >= PLAYER_Y - 4 && inv.alive) st.invaded = true;
  }
  function tickInvaders(st) {
    const n = st.inv.length;
    let guard = 0;
    while (guard++ < n && !st.inv[st.cursor].alive) { st.cursor = (st.cursor + 1) % n; if (st.cursor === 0) endSweep(st); }
    const inv = st.inv[st.cursor];
    if (!inv.alive) return;
    moveInvader(st, inv);
    st.cursor = (st.cursor + 1) % n;
    if (st.cursor === 0) endSweep(st);
  }
  function endSweep(st) {
    st.beat = (st.beat + 1) % 4; emit(st, { t: 'march', beat: st.beat });
    if (st.dropping) { st.dropping = false; st.dir = -st.dir; }          // 내려오는 판이 끝났으면 방향을 바꿈
    else if (st.sweepEdge) { st.dropping = true; }
    st.sweepEdge = false;
  }

  // ---- 외계인 총알 ----
  function reloadTime(st) { return Math.max(0.35, 1.3 - st.score / 4000 - (55 - aliveCount(st)) * 0.006); }
  function fireInvader(st) {
    if (st.ebullets.length >= MAX_EBULLETS) return;
    const kinds = ['rolling', 'plunger', 'squiggly'].filter((k) => !st.ebullets.some((b) => b.kind === k));
    if (!kinds.length) return;
    const kind = kinds[Math.floor(st.rand() * kinds.length)];
    // 굴러가는 총알은 내가 있는 줄을 노리고, 나머지는 무작위 줄
    const lowest = (c) => st.inv.filter((x) => x.alive && x.col === c).sort((a, b) => b.y - a.y)[0];
    const cols = [];
    for (let c = 0; c < COLS; c++) if (lowest(c)) cols.push(c);
    if (!cols.length) return;
    let col;
    if (kind === 'rolling') col = cols.reduce((best, c) => (Math.abs(lowest(c).x - st.player.x) < Math.abs(lowest(best).x - st.player.x) ? c : best), cols[0]);
    else col = cols[Math.floor(st.rand() * cols.length)];
    const shooter = lowest(col);
    st.ebullets.push({ kind, x: shooter.x, y: shooter.y + 5, frame: 0 });
    emit(st, { t: 'ifire' });
  }

  function step(st, dt, input = {}) {
    const h = Math.min(dt, 0.05);
    st.events = [];
    if (st.phase === 'over') return;
    st.t += h;
    const p = st.player;
    if (st.phase === 'dying') {
      st.dyingT -= h;
      if (st.dyingT <= 0) {
        if (st.invaded || st.lives <= 0) { st.phase = 'over'; emit(st, { t: 'over' }); return; }
        p.alive = true; p.x = W / 2; p.invuln = 1.5; st.phase = 'play'; emit(st, { t: 'respawn' });
      }
      return;
    }
    if (st.phase === 'clear') {
      st.clearT -= h;
      if (st.clearT <= 0) startWave(st, st.wave + 1);
      return;
    }
    // 내 대포
    p.invuln = Math.max(0, p.invuln - h);
    const mv = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    p.x = Math.max(PLAYER_MIN, Math.min(PLAYER_MAX, p.x + mv * PLAYER_SPEED * h));
    if (input.fire && !st.bullet) { st.bullet = { x: p.x, y: PLAYER_Y - 6 }; st.shots++; emit(st, { t: 'fire' }); }
    // 내 총알
    if (st.bullet) {
      st.bullet.y -= BULLET_SPEED * h;
      if (st.bullet.y < 28) { st.bullet = null; emit(st, { t: 'miss' }); }
    }
    // UFO
    updateUfo(st, h);
    // 외계인 이동 (1/60초마다 한 마리)
    st.tickT += h;
    while (st.tickT >= TICK && st.phase === 'play') {
      st.tickT -= TICK;
      tickInvaders(st);
      if (st.invaded) { killPlayer(st, 'invaded'); st.lives = 0; return; }
    }
    // 외계인 사격
    st.fireT -= h;
    if (st.fireT <= 0) { fireInvader(st); st.fireT = reloadTime(st) * (0.7 + st.rand() * 0.6); }
    for (const b of st.ebullets) { b.y += EBULLET_SPEED * h; b.frame = (Math.floor(st.t * 10)) % 4; }
    collisions(st);
    // 판 끝
    if (st.phase === 'play' && aliveCount(st) === 0) {
      st.phase = 'clear'; st.clearT = CLEAR_DELAY; st.bullet = null; st.ebullets = [];
      emit(st, { t: 'clear', wave: st.wave });
    }
  }

  function updateUfo(st, h) {
    if (st.ufo) {
      st.ufo.x += st.ufo.vx * h;
      if (st.ufo.x < -16 || st.ufo.x > W + 16) st.ufo = null;
      return;
    }
    st.ufoT -= h;
    if (st.ufoT <= 0) {
      if (aliveCount(st) >= UFO_MIN_INVADERS) {
        const dir = st.wave % 2 === (st.ufoDir ? 0 : 1) ? 1 : -1; st.ufoDir = !st.ufoDir;
        st.ufo = { x: dir > 0 ? -14 : W + 14, y: UFO_Y, vx: dir * UFO_SPEED };
        emit(st, { t: 'ufo' });
      }
      st.ufoT = UFO_EVERY;
    }
  }
  const ufoPoints = (shots) => (shots % 15 === 8 ? 300 : UFO_SCORES_BY_SHOT[shots % 15]);

  function collisions(st) {
    const p = st.player;
    const b = st.bullet;
    if (b) {
      let used = false;
      // 방어벽
      const bk = bunkerAt(st, b.x, b.y) || bunkerAt(st, b.x, b.y - 2);
      if (bk && (cellOn(bk, b.x, Math.min(b.y, bk.y + BH - 1)) || cellOn(bk, b.x, Math.min(b.y - 2, bk.y + BH - 1)))) { erode(st, bk, b.x, b.y, 2); used = true; emit(st, { t: 'bunker' }); }
      if (!used && st.ufo && Math.abs(b.x - st.ufo.x) < 9 && Math.abs(b.y - st.ufo.y) < 6) {
        const pts = ufoPoints(st.shots); addScore(st, pts); emit(st, { t: 'ufohit', pts, x: st.ufo.x, y: st.ufo.y }); st.ufo = null; used = true;
      }
      if (!used) for (const inv of st.inv) {
        if (inv.alive && Math.abs(b.x - inv.x) < inv.w / 2 + 1 && Math.abs(b.y - inv.y) < 5) {
          inv.alive = false; const pts = POINTS[inv.row]; addScore(st, pts);
          emit(st, { t: 'kill', row: inv.row, pts, x: inv.x, y: inv.y }); used = true; break;
        }
      }
      if (!used) for (const eb of st.ebullets) if (Math.abs(b.x - eb.x) < 3 && Math.abs(b.y - eb.y) < 5) { st.ebullets.splice(st.ebullets.indexOf(eb), 1); emit(st, { t: 'bulletclash', x: b.x, y: b.y }); used = true; break; }
      if (used) st.bullet = null;
    }
    for (const eb of st.ebullets.slice()) {
      const bk = bunkerAt(st, eb.x, eb.y + 3);
      if (bk && cellOn(bk, eb.x, eb.y + 3)) { erode(st, bk, eb.x, eb.y + 3, 3); st.ebullets.splice(st.ebullets.indexOf(eb), 1); emit(st, { t: 'bunker' }); continue; }
      if (p.alive && p.invuln <= 0 && Math.abs(eb.x - p.x) < PLAYER_W / 2 && eb.y + 3 >= PLAYER_Y - 4 && eb.y <= PLAYER_Y + 4) { killPlayer(st, 'bullet'); return; }
      if (eb.y >= GROUND) { st.ebullets.splice(st.ebullets.indexOf(eb), 1); emit(st, { t: 'groundhit', x: eb.x }); }
    }
  }

  return {
    W, H, COLS, ROWS, COL_GAP, ROW_GAP, FORM_LEFT, FORM_TOP, STEP, DROP, TICK, PLAYER_Y, PLAYER_W, PLAYER_SPEED, BULLET_SPEED, EBULLET_SPEED, MAX_EBULLETS, GROUND, START_LIVES, EXTRA_LIFE_AT,
    UFO_Y, UFO_SPEED, UFO_EVERY, UFO_MIN_INVADERS, DYING, CLEAR_DELAY, POINTS, START_DROPS, BUNKERS, BW, BH,
    rng, newGame, startWave, step, aliveCount, ufoPoints, killPlayer, fireInvader, reloadTime, makeBunker,
  };
})();
if (typeof module !== 'undefined') module.exports = LOGIC_INVADERS;
