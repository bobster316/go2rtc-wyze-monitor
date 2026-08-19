import { VideoRTC } from '/vendor/video-rtc.js';

class VideoStream extends VideoRTC {
  oninit() {
    super.oninit();
    this.video.controls = false;
    this.video.muted = true;
    this.video.autoplay = true;
    this.video.style.objectFit = 'contain';
    this.video.style.background = '#020304';
  }
}
customElements.define('video-stream', VideoStream);

let config;
let quality = localStorage.getItem('quality') || 'main';  // overridden by config.defaultQuality on first run
let focusedCamera = null;

const grid = document.getElementById('grid');
const template = document.getElementById('camera-card-template');
const qualityControls = document.getElementById('qualityControls');
const focusView = document.getElementById('focusView');
const focusPlayer = document.getElementById('focusPlayer');
const focusName = document.getElementById('focusName');
const focusDetails = document.getElementById('focusDetails');
const focusTimestamp = document.getElementById('focusTimestamp');
const focusFps = document.getElementById('focusFps');

const players = new Map();
let focusEntry = null;

function formatTimestamp(date = new Date()) {
  const d = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
  const t = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date);
  return `${d} ${t}`;
}

function streamName(cameraId, q = quality) {
  return `${cameraId}${config.qualities[q].suffix}`;
}

function wsUrl(cameraId, q = quality) {
  return `${config.go2rtcWs}?src=${streamName(cameraId, q)}`;
}

function makePlayer(container, cameraId, q) {
  container.innerHTML = '';
  const el = document.createElement('video-stream');
  el.mode = 'webrtc,mse';
  el.media = 'video';
  el.background = false;
  el.visibilityCheck = false;
  container.appendChild(el);
  el.src = wsUrl(cameraId, q);
  return el;
}

function newMeter() {
  return { lastFrames: 0, lastBytes: 0, lastTime: performance.now(), fps: 0, kbps: 0, engine: '--', ready: false };
}

async function sampleMeter(el, meter) {
  const video = el.video;
  if (!video) return;

  const q = video.getVideoPlaybackQuality ? video.getVideoPlaybackQuality() : null;
  const frames = q ? q.totalVideoFrames : 0;
  const now = performance.now();
  const dt = (now - meter.lastTime) / 1000;
  if (dt > 0.2 && frames >= meter.lastFrames) {
    meter.fps = (frames - meter.lastFrames) / dt;
  }
  meter.lastFrames = frames;
  meter.lastTime = now;
  meter.ready = video.readyState >= 2 && video.videoWidth > 0;

  if (el.pc && el.pc.connectionState === 'connected') {
    meter.engine = 'WebRTC';
    try {
      const stats = await el.pc.getStats();
      let bytes = 0;
      stats.forEach(r => { if (r.type === 'inbound-rtp' && r.kind === 'video') bytes += r.bytesReceived || 0; });
      if (bytes && meter.lastBytes && dt > 0.2) meter.kbps = ((bytes - meter.lastBytes) * 8) / dt / 1000;
      meter.lastBytes = bytes;
    } catch (err) { /* stats unavailable this tick */ }
  } else if (el.mseCodecs) {
    meter.engine = 'MSE';
  }
}

function setStatus(card, text) {
  const s = card.querySelector('.status');
  if (s) s.textContent = text;
}

async function tick() {
  const clock = formatTimestamp();
  document.querySelectorAll('.timestamp').forEach(e => { e.textContent = clock; });
  document.getElementById('clockText').textContent = clock.slice(-8);

  let live = 0;
  let fpsSum = 0;
  let kbpsSum = 0;
  let engine = '--';
  let gridRes = '--';

  for (const entry of players.values()) {
    await sampleMeter(entry.el, entry.meter);
    const m = entry.meter;
    const fpsEl = entry.card.querySelector('[data-fps]');
    if (m.ready) {
      live += 1;
      fpsSum += m.fps;
      kbpsSum += m.kbps;
      if (m.engine !== '--') engine = m.engine;
      if (fpsEl) fpsEl.textContent = `FPS ${m.fps.toFixed(1)}`;
      const vw = entry.el.video ? entry.el.video.videoWidth : 0;
      const vh = entry.el.video ? entry.el.video.videoHeight : 0;
      setStatus(entry.card, vw ? `${vw}x${vh}` : config.qualities[quality].label);
      if (vw) gridRes = `${vw}x${vh}`;
      entry.card.classList.remove('offline');
    } else {
      if (fpsEl) fpsEl.textContent = 'FPS --';
      setStatus(entry.card, 'Connecting');
      entry.card.classList.add('offline');
    }
  }

  if (focusEntry) {
    await sampleMeter(focusEntry.el, focusEntry.meter);
    focusFps.textContent = focusEntry.meter.ready ? `FPS ${focusEntry.meter.fps.toFixed(1)}` : 'FPS --';
  }

  const total = players.size;
  document.getElementById('liveText').textContent = `${live}/${total}`;
  document.getElementById('fpsText').textContent = live ? (fpsSum / live).toFixed(1) : '--';
  document.getElementById('mbpsText').textContent = kbpsSum ? (kbpsSum / 1000).toFixed(2) : '--';
  document.getElementById('engineText').textContent = engine;
  document.getElementById('resText').textContent = gridRes;

  const dot = document.getElementById('liveDot');
  dot.className = 'dot ' + (live === total ? 'ok' : live === 0 ? 'bad' : 'warn');
}

function setActiveQualityButtons() {
  document.querySelectorAll('[data-quality]').forEach(b => {
    b.classList.toggle('active', b.dataset.quality === quality);
  });
}

function renderQualityControls() {
  qualityControls.innerHTML = '';
  const order = [['main', 'HD'], ['sub', 'Eco']];
  order.forEach(([key, label]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.quality = key;
    b.textContent = label;
    b.title = key === 'main'
      ? 'Grid tiles pull the full-resolution stream'
      : 'Grid tiles pull the low-resolution substream';
    b.addEventListener('click', () => {
      quality = key;
      localStorage.setItem('quality', key);
      setActiveQualityButtons();
      render();
    });
    qualityControls.appendChild(b);
  });
  setActiveQualityButtons();
}

function reconnectCamera(cameraId) {
  const entry = players.get(cameraId);
  if (!entry) return;
  setStatus(entry.card, 'Connecting');
  entry.meter = newMeter();
  entry.el = makePlayer(entry.card.querySelector('[data-player]'), cameraId, quality);
}

const TILE_ASPECT = 16 / 9;

/**
 * Choose a column count for `count` tiles in a `w` x `h` area.
 *
 * Tries every arrangement and keeps the one that renders the largest picture
 * per tile. Because the video is letterboxed inside its tile, the useful size
 * is min(tileWidth / aspect, tileHeight) - so the best layout is not simply
 * the squarest one. On a 16:9 window this gives 1x1, 2x1, 2x2, 3x2, 3x3,
 * 4x3 ... which is what you would lay out by hand.
 */
function bestColumns(count, w, h) {
  if (count <= 1) return 1;
  let best = { cols: 1, size: 0 };
  for (let cols = 1; cols <= count; cols += 1) {
    const rows = Math.ceil(count / cols);
    const size = Math.min((w / cols) / TILE_ASPECT, h / rows);
    if (size > best.size) best = { cols, size };
  }
  return best.cols;
}

function applyGridLayout() {
  const count = config.cameras.length;
  if (!count) return;
  const cols = bestColumns(count, grid.clientWidth || window.innerWidth, grid.clientHeight || window.innerHeight);
  grid.style.setProperty('--cols', cols);
  grid.style.setProperty('--rows', Math.ceil(count / cols));
  grid.style.setProperty('--count', count);
}

function render() {
  players.clear();
  grid.innerHTML = '';
  config.cameras.forEach(camera => {
    const card = template.content.firstElementChild.cloneNode(true);
    card.dataset.cameraId = camera.id;
    card.querySelector('.camera-label').textContent = camera.name;
    card.querySelector('strong').textContent = camera.name;
    card.querySelector('span').textContent = camera.ip;
    card.querySelector('.enlarge').addEventListener('click', () => openFocus(camera));
    card.querySelector('.refresh').addEventListener('click', () => reconnectCamera(camera.id));
    card.querySelector('.camera-frame').addEventListener('dblclick', () => openFocus(camera));
    grid.appendChild(card);

    const el = makePlayer(card.querySelector('[data-player]'), camera.id, quality);
    players.set(camera.id, { el, card, meter: newMeter() });
  });
  applyGridLayout();
}

function openFocus(camera) {
  focusedCamera = camera;
  focusName.textContent = camera.name;
  focusDetails.textContent = `${camera.ip} / full resolution`;
  focusTimestamp.textContent = formatTimestamp();
  focusFps.textContent = 'FPS --';
  focusView.classList.remove('hidden');
  focusView.setAttribute('aria-hidden', 'false');
  const el = makePlayer(focusPlayer, camera.id, 'main');
  focusEntry = { el, meter: newMeter() };
}

function closeFocus() {
  focusedCamera = null;
  focusEntry = null;
  focusPlayer.innerHTML = '';
  focusView.classList.add('hidden');
  focusView.setAttribute('aria-hidden', 'true');
}

async function init() {
  const response = await fetch('/api/config', { cache: 'no-store' });
  config = await response.json();
  if (!localStorage.getItem('quality') && config.defaultQuality) quality = config.defaultQuality;
  if (!config.qualities[quality]) quality = 'main';
  renderQualityControls();
  render();
  tick();
  setInterval(tick, 1000);
}

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  // Relayout only - tiles are not rebuilt, so streams keep running.
  resizeTimer = setTimeout(() => { if (config) applyGridLayout(); }, 150);
});

document.getElementById('refreshAll').addEventListener('click', () => render());
document.getElementById('fullscreen').addEventListener('click', () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen();
  else document.exitFullscreen();
});
document.getElementById('focusClose').addEventListener('click', closeFocus);
focusView.addEventListener('click', e => { if (e.target === focusView) closeFocus(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && focusedCamera) closeFocus(); });

init().catch(err => {
  grid.innerHTML = `<pre class="error">${String(err.stack || err)}</pre>`;
});
