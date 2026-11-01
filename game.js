'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 스페이스 인베이더: 화면·입력·소리. 규칙은 logic.js (LOGIC_INVADERS). 여기서는 st.events 를 보고 소리·효과를 만든다.
const L = LOGIC_INVADERS;
const { W, H } = L;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

function fit() {
  const controls = $('controls');
  const ctrlH = getComputedStyle(controls).display === 'none' ? 0 : controls.offsetHeight + 10;
  const scale = Math.min((innerWidth - 16) / W, (innerHeight - 16 - ctrlH) / H);
  const cssW = Math.max(150, Math.floor(W * scale)), cssH = Math.floor(cssW * H / W);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  ctx.imageSmoothingEnabled = false;
}
addEventListener('resize', fit);

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};

// ---------- 소리 ----------
let audio = null;
let muted = store.get('invadersMuted') === '1';
function tone(freq, dur, type = 'square', vol = 0.045, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t); o.stop(t + dur);
  } catch (_) {}
}
function noise(dur, vol = 0.08, lowpass = 1500) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const n = Math.floor(audio.sampleRate * dur), buf = audio.createBuffer(1, n, audio.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = audio.createBufferSource(), g = audio.createGain(), f = audio.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = lowpass; g.gain.value = vol;
    s.buffer = buf; s.connect(f).connect(g).connect(audio.destination); s.start();
  } catch (_) {}
}
const melody = (notes, step, type = 'square', vol = 0.05) => notes.forEach((f, i) => { if (f) setTimeout(() => tone(f, step * 0.9 / 1000, type, vol), i * step); });
const MARCH = [110, 98, 87, 78];
const sfx = {
  march: (b) => tone(MARCH[b % 4], 0.09, 'square', 0.05),
  fire: () => tone(1200, 0.12, 'square', 0.035, -900),
  kill: () => { noise(0.12, 0.08, 2500); tone(300, 0.1, 'square', 0.04, -200); },
  dead: () => { noise(1.0, 0.12, 900); tone(200, 0.8, 'sawtooth', 0.05, -150); },
  ufo: () => tone(600, 0.1, 'sine', 0.04, 300),
  ufohit: () => { noise(0.3, 0.09, 2000); melody([1200, 900, 1500, 1800], 70, 'sine', 0.06); },
  ifire: () => tone(220, 0.1, 'sawtooth', 0.025, -100),
  bunker: () => noise(0.06, 0.05, 1200),
  extra: () => melody([659, 784, 1047, 1319], 90, 'sine', 0.07),
  start: () => melody([262, 330, 392, 523], 100),
  clear: () => melody([523, 659, 784, 1047], 90),
  over: () => melody([392, 330, 262, 196], 220, 'sawtooth', 0.06),
};

// ---------- 상태 ----------
let G = L.newGame();
let state = 'title';                           // title · play · paused · over
let best = Number(store.get('invadersBest')) || 0;
let fxs = [];
let banner = { text: '', t: 0 };
let clock = 0, moved = 0, lastX = 0, ufoSnd = 0;
const held = new Set();
let bLeft = false, bRight = false, bFire = false;

/* @test-hooks:start */
window.__si = { get G() { return G; }, get state() { return state; }, L, setG(g) { G = g; }, step: (dt) => update(dt) };
/* @test-hooks:end */

// ---------- 입력 ----------
addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(k)) e.preventDefault();
  if (k === ' ' || k === 'Enter') {
    if (state === 'title' || state === 'over') { if (!e.repeat) onOverlayButton(); return; }
    if (state === 'paused') { if (!e.repeat) resume(); return; }
  }
  held.add(k);
  if (k === 'p' || k === 'P') { if (state === 'paused') resume(); else pause(); }
  else if (k === 'm' || k === 'M') toggleMute();
});
addEventListener('keyup', (e) => { held.delete(e.key); });
addEventListener('blur', () => held.clear());
function hold(btn, on, off) {
  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); try { btn.setPointerCapture(e.pointerId); } catch (_) {} btn.classList.add('on'); on(); });
  const up = () => { btn.classList.remove('on'); off(); };
  btn.addEventListener('pointerup', up); btn.addEventListener('pointercancel', up); btn.addEventListener('lostpointercapture', up);
}
hold($('leftBtn'), () => { bLeft = true; }, () => { bLeft = false; });
hold($('rightBtn'), () => { bRight = true; }, () => { bRight = false; });
hold($('fireBtn'), () => { bFire = true; }, () => { bFire = false; });
const has = (...ks) => ks.some((k) => held.has(k));
const readInput = () => ({ left: has('ArrowLeft', 'a', 'A') || bLeft, right: has('ArrowRight', 'd', 'D') || bRight, fire: has(' ', 'z', 'Z', 'j', 'J', 'ArrowUp') || bFire });

// ---------- 흐름 ----------
function showOverlay(html) { const o = $('overlay'); o.innerHTML = html; o.classList.remove('hidden'); o.querySelector('button').onclick = onOverlayButton; }
function hideOverlay() { $('overlay').classList.add('hidden'); }
function setBanner(text, t = 2) { banner = { text, t }; }
function startGame() {
  G = L.newGame();
  if (/[?&]tutorial=1/.test(location.search)) G.lives = 9;          // 튜토리얼에서는 맞아도 계속 해 볼 수 있게
  fxs = []; held.clear(); moved = 0; lastX = G.player.x;
  state = 'play';
  setBanner('PLAY');
  hideOverlay();
  sfx.start();
}
function onOverlayButton() { if (state === 'paused') resume(); else startGame(); }
let pausedFrom = null;
function pause() {
  if (state !== 'play') return;
  pausedFrom = state; state = 'paused'; held.clear(); bLeft = bRight = bFire = false;
  showOverlay('<h2>일시정지</h2><p>P 키나 아래 버튼으로 계속해요</p><button id="startBtn">계속하기</button>');
}
function resume() { if (state !== 'paused') return; state = pausedFrom; hideOverlay(); }
function gameOver(invaded) {
  state = 'over';
  const rec = G.score > best;
  if (rec) { best = G.score; store.set('invadersBest', String(best)); }
  sfx.over();
  showOverlay(`<h2>GAME OVER</h2><p class="big">${G.score.toLocaleString()}점</p><p>${invaded ? '외계인이 땅에 닿았어요! ' : ''}웨이브 ${G.wave}${rec ? '<br>🏆 최고 기록!' : ''}</p><button id="startBtn">다시 하기</button>`);
}

function handleEvents() {
  for (const e of G.events) {
    if (e.t === 'march') sfx.march(e.beat);
    else if (e.t === 'fire') { sfx.fire(); tutorialSignal('fire'); }
    else if (e.t === 'kill') { sfx.kill(); tutorialSignal('kill'); fxs.push({ kind: 'boom', x: e.x, y: e.y, t: 0, life: 0.25 }); }
    else if (e.t === 'ufohit') { sfx.ufohit(); tutorialSignal('ufohit'); fxs.push({ kind: 'text', x: e.x, y: e.y, t: 0, life: 1.1, text: String(e.pts) }); }
    else if (e.t === 'ifire') sfx.ifire();
    else if (e.t === 'bunker') { sfx.bunker(); tutorialSignal('bunker'); }
    else if (e.t === 'bulletclash') fxs.push({ kind: 'boom', x: e.x, y: e.y, t: 0, life: 0.2, small: true });
    else if (e.t === 'groundhit') fxs.push({ kind: 'boom', x: e.x, y: L.GROUND - 2, t: 0, life: 0.2, small: true });
    else if (e.t === 'dead') sfx.dead();
    else if (e.t === 'extra') { sfx.extra(); setBanner('EXTRA CANNON', 1.6); }
    else if (e.t === 'clear') sfx.clear();
    else if (e.t === 'wave') { if (e.wave > 1) { setBanner(`WAVE ${e.wave}`, 1.6); sfx.start(); } }
    else if (e.t === 'over') gameOver(G.invaded);
  }
}

function update(dt) {
  clock += dt;
  if (state !== 'play') return;
  L.step(G, dt, readInput());
  if (G.player.alive) {
    const inp = readInput();
    if (inp.left !== inp.right) { moved += Math.abs(G.player.x - lastX); if (moved > 14) tutorialSignal('move'); } else moved = 0;
    lastX = G.player.x;
  }
  if (G.ufo) { ufoSnd -= dt; if (ufoSnd <= 0) { ufoSnd = 0.12; sfx.ufo(); } }
  handleEvents();
  banner.t = Math.max(0, banner.t - dt);
  for (const f of fxs) f.t += dt;
  fxs = fxs.filter((f) => f.t < f.life);
}

// ---------- 그림 (원작 같은 도트 그림) ----------
const SPR = {
  squid: [['00011000', '00111100', '01111110', '11011011', '11111111', '00100100', '01011010', '10100101'], ['00011000', '00111100', '01111110', '11011011', '11111111', '01011010', '10000001', '01000010']],
  crab: [['00100000100', '00010001000', '00111111100', '01101110110', '11111111111', '10111111101', '10100000101', '00011011000'], ['00100000100', '10010001001', '10111111101', '11101110111', '11111111111', '01111111110', '00100000100', '01000000010']],
  octo: [['000011110000', '011111111110', '111111111111', '111001100111', '111111111111', '000110011000', '001101101100', '110000000011'], ['000011110000', '011111111110', '111111111111', '111001100111', '111111111111', '001110011100', '011001100110', '001100001100']],
  cannon: [['0000001000000', '0000011100000', '0000011100000', '0111111111110', '1111111111111', '1111111111111', '1111111111111', '1111111111111']],
  ufo: [['0000011111100000', '0001111111111000', '0011111111111100', '0110110110110110', '1111111111111111', '0011100110011100', '0001000000001000']],
  boom: [['00010010001', '10001000100', '01000000010', '00100000100', '11000000011', '00100000100', '01001000010', '10010001001']],
};
function sprite(rows, cx, cy, color) {
  ctx.fillStyle = color;
  const w = rows[0].length, h = rows.length, x0 = Math.round(cx - w / 2), y0 = Math.round(cy - h / 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (rows[y][x] === '1') ctx.fillRect(x0 + x, y0 + y, 1, 1);
}
const kindOf = (row) => (row === 0 ? 'squid' : row <= 2 ? 'crab' : 'octo');
function drawEBullet(b) {
  ctx.fillStyle = '#fff'; const f = b.frame;
  if (b.kind === 'plunger') { ctx.fillRect(b.x - 0.5, b.y - 3, 1, 6); ctx.fillRect(b.x - 1.5, b.y + (f % 2 ? -3 : 2), 3, 1); }
  else if (b.kind === 'rolling') { for (let i = 0; i < 6; i++) ctx.fillRect(b.x - 1 + ((i + f) % 2), b.y - 3 + i, 1, 1); ctx.fillRect(b.x, b.y - 3, 1, 6); }
  else { for (let i = 0; i < 6; i++) ctx.fillRect(Math.round(b.x - 1 + Math.sin((i + f * 1.5) * 1.6) * 1.4), b.y - 3 + i, 1, 1); }
}
function draw() {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  // 위쪽 흰색, 아래쪽 초록 (원작 셀로판 색)
  const GREEN = '#3aff3a';
  for (const i of G.inv) if (i.alive) sprite(SPR[kindOf(i.row)][i.frame], i.x, i.y, i.y > 180 ? GREEN : '#fff');
  if (G.ufo) sprite(SPR.ufo[0], G.ufo.x, G.ufo.y, '#ff3a3a');
  for (const b of G.bunkers) { ctx.fillStyle = GREEN; for (let y = 0; y < L.BH; y++) for (let x = 0; x < L.BW; x++) if (b.cells[y * L.BW + x]) ctx.fillRect(b.x + x, b.y + y, 1, 1); }
  ctx.fillStyle = GREEN; ctx.fillRect(0, L.GROUND, W, 1);
  const p = G.player;
  if (p.alive) { if (!(p.invuln > 0 && Math.floor(clock * 12) % 2)) sprite(SPR.cannon[0], p.x, L.PLAYER_Y, GREEN); }
  else if (G.phase === 'dying') { const f = Math.floor(clock * 10) % 2; ctx.fillStyle = GREEN; for (let i = 0; i < 20; i++) { const a = i * 12.9898, rx = (Math.sin(a) * 43758.5453) % 1, ry = (Math.sin(a + 4.1) * 12345.678) % 1; if ((i + f) % 2) ctx.fillRect(p.x - 7 + Math.abs(rx) * 14, L.PLAYER_Y - 5 + Math.abs(ry) * 9, 1.5, 1.5); } }
  if (G.bullet) { ctx.fillStyle = '#fff'; ctx.fillRect(G.bullet.x - 0.5, G.bullet.y - 3, 1, 5); }
  for (const b of G.ebullets) drawEBullet(b);
  for (const f of fxs) {
    const k = f.t / f.life;
    if (f.kind === 'boom') { if (f.small) { ctx.fillStyle = '#fff'; ctx.fillRect(f.x - 3, f.y - 1, 6, 2); ctx.fillRect(f.x - 1, f.y - 3, 2, 6); } else sprite(SPR.boom[0], f.x, f.y, '#fff'); }
    else if (f.kind === 'text') { ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = `rgba(255,60,60,${1 - k * 0.6})`; ctx.fillText(f.text, f.x, f.y); }
  }
  // HUD
  ctx.font = 'bold 9px monospace'; ctx.textBaseline = 'top'; ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.fillText('SCORE', 8, 6); ctx.fillStyle = '#fff'; ctx.fillText(String(G.score).padStart(4, '0'), 8, 17);
  ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.fillText('HI-SCORE', 112, 6); ctx.fillText(String(Math.max(best, G.score)).padStart(4, '0'), 112, 17);
  ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.fillText(String(Math.max(0, G.lives - (p.alive ? 1 : 0))), 8, 244);
  for (let i = 0; i < Math.min(5, Math.max(0, G.lives - (p.alive ? 1 : 0))); i++) sprite(SPR.cannon[0], 28 + i * 16, 249, GREEN);
  ctx.textAlign = 'right'; ctx.fillStyle = '#fff'; ctx.fillText(`WAVE ${G.wave}`, W - 8, 244);
  if (banner.t > 0) { ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.fillText(banner.text, W / 2, 150); }
}

let last = 0;
function frame(ts) {
  const dt = Math.min(0.05, (ts - (last || ts)) / 1000);
  last = ts;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}

addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

function toggleMute() {
  muted = !muted;
  store.set('invadersMuted', muted ? '1' : '0');
  $('muteBtn').textContent = muted ? '🔇' : '🔊';
}
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('pauseBtn').onclick = (e) => { e.currentTarget.blur(); state === 'paused' ? resume() : pause(); };
$('startBtn').onclick = onOverlayButton;
$('muteBtn').textContent = muted ? '🔇' : '🔊';

fit();
requestAnimationFrame(frame);
