import { loadGif } from './gif.js';
import * as tauriCore from '@tauri-apps/api/core';

// ── Tauri API (guarded: invoke is a no-op when not running under Tauri) ──
const invoke = (typeof tauriCore?.invoke === 'function') ? tauriCore.invoke : null;

const invokeSafe = async (cmd, args) => {
  if (!invoke) return undefined;
  try { return await invoke(cmd, args); } catch { return undefined; }
};

// ── DSH state source ──
// Base URL comes from the Rust side (WHALE_DSH_URL env, set by the plugin host
// when it spawns us); falls back to the default DSH port for manual launches.
let DSH_URL = 'http://127.0.0.1:3080';
const STATE_ENDPOINT = '/dsh-desk-pet/state';

// ── State → GIF mapping (mirrors whale-on-desk manifest) ──
const STATE_MAP = {
  idle: 'idle',
  'swim-fast': 'swim-fast',
  think: 'think',
  'tool-run': 'tool-run',
  'glass-tap': 'glass-tap',
  celebrate: 'celebrate',
  sink: 'sink',
  sleep: 'sleep',
  nightcap: 'nightcap',
  startled: 'startled',
  'poked-flail': 'poked-flail',
  greet: 'greet',
  proud: 'proud',
  shy: 'shy',
  suspicious: 'suspicious',
  excited: 'excited',
  'sad-puppy': 'sad-puppy',
  review: 'review',
  push: 'push',
  'error-spiral': 'error-spiral',
  'success-streak': 'success-streak',
  'token-fountain': 'token-fountain',
  'chase-fish': 'chase-fish',
  'hide-and-seek': 'hide-and-seek',
  'bubble-ring': 'bubble-ring',
  birthday: 'birthday',
  shrimp: 'shrimp',
  eat: 'eat',
  compact: 'compact',
};

const FALLBACK = 'idle';
// Resolve the asset base robustly: in Tauri the page may be served from
// tauri://localhost or http://tauri.localhost, where a bare './assets/' fetch
// can mis-resolve. Anchor to the document base instead.
const ASSET_BASE = new URL('assets/', document.baseURI || window.location.href).href;

const canvas = document.getElementById('pet-canvas');
const ctx = canvas.getContext('2d');
const bubble = document.getElementById('speech-bubble');
const menu = document.getElementById('context-menu');
const root = document.getElementById('pet-root');

// Surface any uncaught error onto the canvas + debug pre so it's visible.
function showDebug(text) {
  console.debug('[desk-pet]', text);
}
window.addEventListener('error', (e) => {
  const msg = String(e.message || e.error || 'unknown error');
  showDebug('ERR: ' + msg);
  try {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ff6b6b';
    ctx.font = '12px monospace';
    ctx.fillText('ERR: ' + msg.slice(0, 80), 8, 30);
  } catch { /* ignore */ }
});
window.addEventListener('unhandledrejection', (e) => {
  const msg = String(e.reason?.message || e.reason || 'unhandled rejection');
  showDebug('REJECT: ' + msg);
  try {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ff9f43';
    ctx.font = '12px monospace';
    ctx.fillText('REJECT: ' + msg.slice(0, 80), 8, 30);
  } catch { /* ignore */ }
});

// ── Sprite cache ──
const sprites = new Map(); // stateName -> { gif, frames: [ImageData], delays }
let currentState = FALLBACK;
let currentFrame = 0;
let frameAccum = 0;
let lastTs = 0;
let playingState = FALLBACK;

async function getSprite(state) {
  const key = STATE_MAP[state] || FALLBACK;
  if (sprites.has(key)) return sprites.get(key);
  const gif = await loadGif(`${ASSET_BASE}${key}.gif`);
  const frames = gif.frames.map((f) => ({
    img: new ImageData(new Uint8ClampedArray(f.data), f.width, f.height),
    delay: f.delay,
  }));
  const sprite = { key, frames, total: gif.total };
  sprites.set(key, sprite);
  return sprite;
}

// ── Render loop ──
function drawFrame(sprite, idx) {
  const f = sprite.frames[idx];
  canvas.width = f.img.width;
  canvas.height = f.img.height;
  ctx.putImageData(f.img, 0, 0);
}

function animate(ts) {
  const dt = ts - lastTs;
  lastTs = ts;
  const sprite = sprites.get(STATE_MAP[currentState] || FALLBACK);
  if (sprite && sprite.frames.length) {
    frameAccum += dt;
    const delay = sprite.frames[currentFrame]?.delay || 100;
    while (frameAccum >= delay) {
      frameAccum -= delay;
      currentFrame = (currentFrame + 1) % sprite.frames.length;
    }
    drawFrame(sprite, currentFrame);
  }
  requestAnimationFrame(animate);
}

// ── Switch state ──
let sayTimeout = null;
async function setState(state, opts = {}) {
  const key = STATE_MAP[state] || FALLBACK;
  if (key === (STATE_MAP[currentState] || FALLBACK) && !opts.force) return;
  currentState = state;
  currentFrame = 0;
  frameAccum = 0;
  try {
    await getSprite(state);
  } catch {
    // keep last sprite on failure
  }
  if (opts.say) say(opts.say, opts.sayMs || 3000);
}

function say(text, ms = 3000) {
  bubble.textContent = text;
  bubble.classList.remove('hidden');
  clearTimeout(sayTimeout);
  sayTimeout = setTimeout(() => bubble.classList.add('hidden'), ms);
}

// ── DSH polling ──
let lastHint = null;
// Consecutive poll failures. Once DSH has been unreachable for a grace period
// the pet exits on its own, so stopping DSH also stops the pet.
let pollFailures = 0;
const MAX_POLL_FAILURES = 30; // 30 × 500ms = 15s grace before giving up

async function pollDsh() {
  try {
    const resp = await fetch(`${DSH_URL}${STATE_ENDPOINT}`, { cache: 'no-store' });
    if (!resp.ok) throw new Error('http ' + resp.status);
    const s = await resp.json();
    pollFailures = 0; // DSH is alive — reset the failure counter
    setState(s.state);

    const hint = s.hint;
    if (!hint) {
      lastHint = null;
      return;
    }

    switch (hint.kind) {
      case 'tool':
        // Tool hints dedupe on name so repeated calls don't spam the bubble.
        if (hint.name !== lastHint) {
          lastHint = hint.name;
          say('🔧 ' + toolLabel(hint.name));
        }
        break;

      case 'approval':
        // Needs your confirmation — announce it (and keep announcing on every
        // poll so the nudge repeats until it is decided).
        lastHint = hint.kind;
        say('⚠️ 需要你确认～', 4000);
        break;

      case 'done':
        // Turn finished — speak the report exactly once (keyed on secs+tools,
        // which reset per turn in the host).
        if (hint.secs || hint.tools) {
          const key = hint.secs + ':' + hint.tools;
          if (key !== lastHint) {
            lastHint = key;
            const bits = [];
            if (hint.secs) bits.push(hint.secs + ' 秒');
            if (hint.tools) bits.push(hint.tools + ' 个工具');
            if (hint.edits) bits.push('改了 ' + hint.edits + ' 个文件');
            say(bits.length ? '搞定！' + bits.join('，') + ' 🎉' : '搞定！🎉', 5000);
          }
        }
        break;

      default:
        // Other hint kinds (none/bored/context/...) don't speak here.
        lastHint = null;
    }
  } catch {
    // DSH not running. After the grace period the pet quits so it doesn't
    // linger once DSH is stopped. A fresh launch exits quickly (no grace).
    pollFailures++;
    if (pollFailures >= MAX_POLL_FAILURES) {
      await invokeSafe('quit');
      return;
    }
    setState('idle');
  }
}

const TOOL_LABELS = {
  bash: '敲命令', read: '读文件', grep: '搜代码', glob: '找文件',
  edit: '改文件', write: '写文件', web_search: '上网查', todo_write: '列计划',
  whale_say: '说话', skill: '装技能', subagent: '派小弟', create_goal: '定目标',
};
function toolLabel(name) {
  return TOOL_LABELS[name] || name || '调用工具';
}

// ── Interaction ──
// Manual drag: gtk_window_begin_move_drag (what Tauri's drag region calls on
// Linux) silently fails on some compositors (observed on KWin + XWayland),
// so the pet moves itself: pointer events drive nudge_window() in Rust.
// Position is persisted by the Rust Moved-event handler — no extra work here.

let clickTimer = null;
let dragState = null; // { lastX, lastY, moved }

function onPointerDown(e) {
  if (e.button === 2) return; // right-click handled separately
  dragState = { lastX: e.screenX, lastY: e.screenY, moved: 0 };
  try { root.setPointerCapture(e.pointerId); } catch { /* ignore */ }
}

function onPointerMove(e) {
  if (!dragState) return;
  const dx = e.screenX - dragState.lastX;
  const dy = e.screenY - dragState.lastY;
  dragState.moved += Math.abs(dx) + Math.abs(dy);
  if (dragState.moved > 4) {
    dragState.lastX = e.screenX;
    dragState.lastY = e.screenY;
    invokeSafe('nudge_window', { dx, dy });
  }
}

function onPointerUp(e) {
  const wasDrag = dragState && dragState.moved > 4;
  dragState = null;
  if (wasDrag) {
    clearTimeout(clickTimer);
    clickTimer = null;
    return;
  }
  // Click vs double-click (pointerdown/up on the canvas, not the drag region)
  if (clickTimer) {
    clearTimeout(clickTimer);
    clickTimer = null;
    onDoubleClick();
  } else {
    clickTimer = setTimeout(() => {
      clickTimer = null;
      onClick();
    }, 260);
  }
}

function onClick() {
  setState('poked-flail', { force: true });
  say(randomPick(['别戳啦！', '痒～', '咕噜咕噜', '干嘛呀～']), 1500);
  setTimeout(() => setState('idle', { force: true }), 1200);
}

function onDoubleClick() {
  setState('startled', { force: true, say: '哇！', sayMs: 1200 });
  setTimeout(() => setState('idle', { force: true }), 1500);
}

function randomPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Context menu ──
function onContextMenu(e) {
  e.preventDefault();
  menu.classList.remove('hidden');
  // Clamp to the menu's real size so it never clips at any window edge. The
  // window is small and transparent, and html/body overflow:hidden silently
  // crops anything past its bounds (previously a hardcoded 160/120 guess).
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  const x = Math.max(0, Math.min(e.clientX, window.innerWidth - w));
  const y = Math.max(0, Math.min(e.clientY, window.innerHeight - h));
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
}

menu.addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const action = btn.dataset.action;
  menu.classList.add('hidden');
  if (action === 'quit') {
    await invokeSafe('quit');
  } else if (action === 'toggle-top') {
    const w = await invokeSafe('is_always_on_top');
    await invokeSafe('set_always_on_top', { on: !w });
  } else if (action === 'home') {
    await invokeSafe('reset_position');
  }
});

document.addEventListener('click', (e) => {
  if (!menu.classList.contains('hidden') && !menu.contains(e.target)) {
    menu.classList.add('hidden');
  }
});

// ── Boot ──
async function boot() {
  // Resolve the DSH base URL from the Rust host (best-effort).
  const injectedUrl = await invokeSafe('get_dsh_url');
  if (injectedUrl) DSH_URL = injectedUrl;

  // Restore saved position (best-effort; native move handled in Rust on startup)
  await invokeSafe('load_position');

  // Load idle sprite first so something shows immediately
  try {
    await getSprite('idle');
    drawFrame(sprites.get('idle'), 0);
  } catch (err) {
    showDebug('LOAD ERR: ' + String(err?.message || err));
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ff6b6b';
    ctx.font = '14px monospace';
    ctx.fillText('load error: ' + String(err?.message || err), 10, 40);
    console.error('desk-whale boot error:', err);
  }

  // Start render loop
  requestAnimationFrame((ts) => {
    lastTs = ts;
    requestAnimationFrame(animate);
  });

  // Start DSH polling
  pollDsh();
  setInterval(pollDsh, 500);

  // Idle nudge: after 5 min of no DSH, the pet gets bored
  setInterval(() => {
    if (currentState === 'idle') say(randomPick(['我闲着呢～', '有活吗？']), 3000);
  }, 5 * 60 * 1000);
}

// Wire events
root.addEventListener('pointerdown', onPointerDown);
window.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerup', onPointerUp);
root.addEventListener('contextmenu', onContextMenu);

boot();
