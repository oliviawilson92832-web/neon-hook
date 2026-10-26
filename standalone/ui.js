/**
 * NEON HOOK — vanilla DOM user interface.
 * No framework: plain querySelector + innerHTML + classList, mirroring the
 * React UI one-to-one (HUD, menu, pause, game over, score boards, revive).
 */
import { fmt } from '../src/game/math';
import { REVIVE_COOLDOWN_MS, REVIVE_MIN_METERS } from '../src/game/constants';
import { MAX_SCORES, sanitizeName } from '../src/game/storage';

const $ = (sel) => document.querySelector(sel);

export const el = {
  boot: $('#boot'),
  canvas: $('#game'),
  hud: $('#hud'),
  hudScore: $('#hud-score'),
  hudDist: $('#hud-dist'),
  hudBest: $('#hud-best'),
  hudMult: $('#hud-mult'),
  hudMultBar: $('#hud-multbar > i'),
  energy: $('#energy-wrap > i'),
  energyWrap: $('#energy-wrap'),
  btnSound: $('#btn-sound'),
  btnPause: $('#btn-pause'),
  icoSound: $('#ico-sound'),

  menu: $('#menu'),
  callsign: $('#callsign'),
  btnPlay: $('#btn-play'),
  menuToggles: $('#menu-toggles'),
  tabs: document.querySelectorAll('.tab'),
  paneHow: $('#pane-how'),
  paneScores: $('#pane-scores'),
  menuScores: $('#menu-scores'),
  resetRow: $('#reset-row'),

  pause: $('#pause'),
  btnResume: $('#btn-resume'),
  btnRestart: $('#btn-restart'),
  btnPMenu: $('#btn-pmenu'),
  pauseToggles: $('#pause-toggles'),

  over: $('#over'),
  goCause: $('#go-cause'),
  goTitle: $('.go-title'),
  goBadge: $('#go-badge'),
  goScore: $('#go-score'),
  goStats: $('#go-stats'),
  goActions1: $('#go-actions-1'),
  goActions2: $('#go-actions-2'),
  btnRevive: $('#btn-revive'),
  btnRetry: $('#btn-retry'),
  btnRetry2: $('#btn-retry2'),
  btnOMenu: $('#btn-omenu'),
  btnOMenu2: $('#btn-omenu2'),
  goAdNote: $('#go-ad-note'),
  goAdErr: $('#go-ad-err'),
  goHint: $('#go-hint'),
  overScores: $('#over-scores'),
  adOverlay: $('#ad-overlay'),
  adLbl: $('#ad-lbl'),
  adSub: $('#ad-sub'),
};

/** Elements the engine writes to directly every frame (no re-render). */
export const hudEls = {
  score: el.hudScore,
  dist: el.hudDist,
  best: el.hudBest,
  mult: el.hudMult,
  multBar: el.hudMultBar,
  energy: el.energy,
  energyWrap: el.energyWrap,
};

const TOGGLES = [
  ['sfx', 'SFX'],
  ['music', 'MUSIC'],
  ['shake', 'SHAKE'],
];

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ───────────── high score table ───────────── */
function scoreTableHTML(scores, highlight) {
  if (!scores.length) {
    return `<div class="empty">
      <div class="empty-t">NO RECORDS YET</div>
      <div class="empty-d">Your first run will light up this board.</div>
    </div>`;
  }
  const rows = scores
    .map((s, i) => {
      const cls = [
        'row',
        i === highlight ? 'hi' : '',
        'rank-' + (i < 2 ? i : 'n'),
      ]
        .filter(Boolean)
        .join(' ');
      const rankCls = i === 0 ? 'rank-0' : i === 1 ? 'rank-1' : i === 2 ? 'rank-2' : 'rank-n';
      return `<li class="${cls}">
      <span class="rank ${rankCls}">${i + 1}</span>
      <span style="display:flex;align-items:baseline;gap:.5rem;min-width:0">
        <span class="s-name ${i === highlight ? 'neon-cyan' : ''}" style="color:${i === highlight ? '' : 'rgba(255,255,255,.9)'}">${esc(s.name)}</span>
        <span class="s-meta">${fmt(s.meters)}m · ${s.gems}◆</span>
      </span>
      <span class="s-score" style="color:${i === highlight ? '#eaffff' : i < 3 ? '#fff' : 'rgba(255,255,255,.75)'}">${fmt(s.score)}</span>
    </li>`;
    })
    .join('');
  return `<ol class="scores">
    <li class="head"><span>#</span><span>PILOT</span><span style="text-align:right">SCORE</span></li>
    ${rows}
  </ol>`;
}

export function renderScores(scores, highlight = -1) {
  el.menuScores.innerHTML = scoreTableHTML(scores, highlight);
  el.overScores.innerHTML = scoreTableHTML(scores, highlight);
  el.resetRow.classList.toggle('hidden', !scores.length);
}

/* ───────────── toggles ───────────── */
let _toggleHandler = null;

/** Re-renders both toggle rows (used when settings change from anywhere). */
export function repaintToggles(settings) {
  renderToggles(el.menuToggles, settings, _toggleHandler);
  renderToggles(el.pauseToggles, settings, _toggleHandler);
}

function renderToggles(container, settings, onToggle) {
  container.innerHTML = '';
  container.className = 'chiprow short-tight';
  container.style.display = 'flex';
  container.style.flexWrap = 'wrap';
  container.style.gap = '0.5rem';
  container.style.justifyContent = 'center';
  container.style.marginTop = '1rem';
  for (const [key, label] of TOGGLES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.on = String(!!settings[key]);
    b.setAttribute('aria-pressed', String(!!settings[key]));
    b.textContent = (settings[key] ? '● ' : '○ ') + label;
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('click', () => onToggle(key));
    container.appendChild(b);
  }
}

/* ───────────── game over ───────────── */
const CAUSE = {
  laser: 'VAPORIZED BY A LASER',
  void: 'SWALLOWED BY THE VOID',
  wall: 'PURGED BY THE FIREWALL',
};

let countRaf = 0;
function countUp(target) {
  cancelAnimationFrame(countRaf);
  const t0 = performance.now();
  const ms = 700;
  const tick = (now) => {
    const p = Math.min(1, (now - t0) / ms);
    const e = 1 - Math.pow(1 - p, 3);
    el.goScore.textContent = fmt(Math.round(target * e));
    if (p < 1) countRaf = requestAnimationFrame(tick);
  };
  countRaf = requestAnimationFrame(tick);
}

let cooldownEnd = 0;
let cooldownTimer = 0;

export function showResult(result, scores, reviveOffered) {
  el.goCause.textContent = CAUSE[result.cause] || 'SIGNAL LOST';
  el.goTitle.dataset.text = 'SIGNAL LOST';
  countUp(result.score);

  el.goBadge.innerHTML = result.isBest
    ? '<div class="badge badge-gold neon-gold pop-in">★ NEW HIGH SCORE ★</div>'
    : result.rank >= 0
      ? `<div class="badge badge-cyan neon-cyan pop-in">RANK #${result.rank + 1} ON THE BOARD</div>`
      : `<div class="badge-dim">BEST ${fmt(Math.max(result.prevBest, result.score))}</div>`;

  const stats = [
    ['DISTANCE', `${fmt(result.meters)} m`],
    ['GEMS', fmt(result.gems)],
    ['NEAR MISSES', fmt(result.nearMisses)],
    ['PERFECT FLINGS', fmt(result.perfects)],
    ['BEST MULTI', `x${result.maxMult}`],
    ['TIME', `${result.time.toFixed(1)} s`],
  ];
  el.goStats.innerHTML = stats
    .map(([k, v]) => `<div class="stat"><div class="stat-k">${k}</div><div class="stat-v">${v}</div></div>`)
    .join('');

  renderScores(scores, result.rank);
  setReviveOffer(reviveOffered, reviveOffered ? Math.max(0, REVIVE_COOLDOWN_MS - (Date.now() - lastAdAt)) : 0);
}

let lastAdAt = 0;
export function markAdRequested() {
  lastAdAt = Date.now();
}

/** Shows or hides the two-button (revive + retry) vs one-button (retry + menu) layout. */
export function setReviveOffer(offered, cooldownMs) {
  window.clearInterval(cooldownTimer);
  el.goActions2.classList.toggle('hidden', !offered);
  el.goActions1.classList.toggle('hidden', offered);
  el.btnOMenu2.classList.toggle('hidden', !offered);
  el.goAdNote.classList.toggle('hidden', !offered);
  if (!offered) return;

  cooldownEnd = Date.now() + Math.max(0, cooldownMs);
  const paint = () => {
    const left = Math.max(0, cooldownEnd - Date.now());
    const cooling = left > 0;
    el.btnRevive.disabled = cooling;
    el.btnRevive.innerHTML =
      (cooling ? `REVIVE ${Math.ceil(left / 1000)}s` : '▶ REVIVE') + (cooling ? '' : ' <span class="ad-tag">AD</span>');
    el.goAdNote.textContent = cooling
      ? 'Revive is recharging — Retry starts a fresh run for free.'
      : 'Watch a short ad to continue this run with your score and a shield. Retry is always free.';
    if (!cooling) window.clearInterval(cooldownTimer);
  };
  paint();
  cooldownTimer = window.setInterval(paint, 250);
}

/** 'idle' | 'pending' | 'playing' | 'error' — blocks the UI while an ad is in flight. */
export function setAdState(state, message) {
  const busy = state === 'pending' || state === 'playing';
  el.adOverlay.classList.toggle('hidden', !busy);
  el.adLbl.textContent = state === 'playing' ? 'AD PLAYING' : 'LOADING AD';
  el.adSub.textContent = state === 'playing' ? 'Your revive is on the way…' : 'Hang tight…';
  el.btnRevive.disabled = busy;
  el.btnRetry2.disabled = busy;
  el.btnOMenu2.disabled = busy;
  if (state === 'error' && message) {
    el.goAdErr.textContent = message;
    el.goAdErr.classList.remove('hidden');
    el.goAdErr.classList.add('pop-in');
  } else {
    el.goAdErr.classList.add('hidden');
  }
}

export function showAdErrorOnly(message) {
  el.goAdErr.textContent = message;
  el.goAdErr.classList.remove('hidden');
}

/* ───────────── screens ───────────── */
const SCREENS = { menu: el.menu, paused: el.pause, gameover: el.over };

export function setScreen(state) {
  for (const key in SCREENS) SCREENS[key].classList.toggle('hidden', key !== state);
  const playing = state === 'playing' || state === 'countdown' || state === 'paused' || state === 'dying';
  el.hud.classList.toggle('dim', !playing);
  if (state === 'menu') renderScores(loadScoresCached(), -1);
}

let _cachedScores = [];
function loadScoresCached() {
  return _cachedScores;
}
export function cacheScores(s) {
  _cachedScores = s;
}

export function setSoundIcon(on) {
  el.btnSound.setAttribute('aria-label', on ? 'Mute sound' : 'Unmute sound');
  el.icoSound.innerHTML = on
    ? '<path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none"/><path d="M16 9a4 4 0 0 1 0 6"/><path d="M18.5 6.5a7.5 7.5 0 0 1 0 11"/>'
    : '<path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none"/><path d="M16 9l5 6M21 9l-5 6"/>';
}

export function setHint(text) {
  el.goHint.innerHTML = text;
}

export function hideBoot() {
  if (el.boot) el.boot.remove();
}

/**
 * Wires every control. `h` provides the game actions; `settings` is the
 * persisted settings object (mutated by reference, saved by the caller).
 */
export function initUI(h, settings) {
  // ── menu tabs ──
  const tabs = document.querySelectorAll('.tab');
  const selectTab = (name) => {
    tabs.forEach((t) => {
      t.dataset.on = String(t.dataset.tab === name);
    });
    el.paneHow.classList.toggle('hidden', name !== 'how');
    el.paneScores.classList.toggle('hidden', name !== 'scores');
  };
  tabs.forEach((t) => t.addEventListener('click', () => selectTab(t.dataset.tab)));

  // ── toggles ──
  _toggleHandler = h.onToggle;
  repaintToggles(settings);

  // ── callsign ──
  el.callsign.value = settings.name;
  const commitName = () => {
    const clean = sanitizeName(el.callsign.value);
    el.callsign.value = clean;
    h.onName(clean);
  };
  el.callsign.addEventListener('change', commitName);
  el.callsign.addEventListener('blur', commitName);
  el.callsign.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitName();
      el.callsign.blur();
      h.onStart();
    }
  });
  el.callsign.addEventListener('pointerdown', (e) => e.stopPropagation());

  // ── buttons (pointerdown → hold, so the player keeps the grapple) ──
  const hold = (node) =>
    node.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      h.onPress(e);
    });
  const click = (node, fn) =>
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      fn(e);
    });

  hold(el.btnPlay);
  hold(el.btnRetry);
  hold(el.btnRetry2);
  hold(el.btnRestart);

  click(el.btnPause, h.onPause);
  click(el.btnSound, h.onToggleSound);
  click(el.btnResume, h.onResume);
  click(el.btnPMenu, h.onMenu);
  click(el.btnOMenu, h.onMenu);
  click(el.btnOMenu2, h.onMenu);
  click(el.btnRevive, h.onRevive);

  // ── reset score board ──
  let confirmReset = false;
  const paintReset = () => {
    el.resetRow.innerHTML = confirmReset
      ? `<span style="display:flex;align-items:center;gap:.5rem;font-size:12px;color:rgba(255,255,255,.6)">
          Wipe all records?
          <button type="button" id="reset-yes" style="font-family:var(--font-display);font-size:10px;font-weight:700;letter-spacing:.1em;padding:4px 8px;border:1px solid rgba(251,113,133,.6);border-radius:4px;color:#fda4af">YES</button>
          <button type="button" id="reset-no" style="font-family:var(--font-display);font-size:10px;font-weight:700;letter-spacing:.1em;padding:4px 8px;border:1px solid rgba(255,255,255,.2);border-radius:4px;color:rgba(255,255,255,.6)">NO</button>
         </span>`
      : `<button type="button" class="link-btn" id="reset-btn">RESET BOARD</button>`;
    const yes = document.getElementById('reset-yes');
    const no = document.getElementById('reset-no');
    const btn = document.getElementById('reset-btn');
    if (yes) yes.addEventListener('click', () => { confirmReset = false; h.onClearScores(); paintReset(); });
    if (no) no.addEventListener('click', () => { confirmReset = false; paintReset(); });
    if (btn) btn.addEventListener('click', () => { confirmReset = true; paintReset(); });
  };
  paintReset();

  // ── tap anywhere to retry (never over the revive offer or an ad) ──
  el.over.addEventListener('pointerdown', (e) => {
    if (uiState.reviveOffered || uiState.adBusy) return;
    if (e.target.closest('button, a, input, [data-noretry]')) return;
    h.onPress(e);
  });

  selectTab(_cachedScores && _cachedScores.length ? 'scores' : 'how');
  return { selectTab };
}

/** Small mutable mirror of live UI state used by the tap-to-retry guard. */
export const uiState = { reviveOffered: false, adBusy: false };

export function eligibleForRevive(result, sdkReady) {
  return sdkReady && !!result && result.revivesUsed === 0 && result.meters >= REVIVE_MIN_METERS && result.score > 0;
}

export { MAX_SCORES };
