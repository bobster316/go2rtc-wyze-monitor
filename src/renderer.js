import { VideoRTC } from '/vendor/video-rtc.js';
import { FullResolutionCadence30 } from '/smooth30.js';

class VideoStream extends VideoRTC {
  oninit() {
    super.oninit();
    this.video.controls = false;
    this.video.muted = true;
    this.video.autoplay = true;
    this.video.style.objectFit = 'cover';
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
const smooth30Toggle = document.getElementById('smooth30Toggle');
const cameraMenuButton = document.getElementById('cameraMenuButton');
const cameraMenu = document.getElementById('cameraMenu');
const diagnosticsButton = document.getElementById('diagnosticsButton');
const diagnosticsView = document.getElementById('diagnosticsView');
const diagnosticsRows = document.getElementById('diagnosticsRows');
const smooth30Badge = document.getElementById('smooth30Badge');
const recordToggle = document.getElementById('recordToggle');
const recordingDownload = document.getElementById('recordingDownload');

const players = new Map();
let focusEntry = null;
let smooth30Enabled = localStorage.getItem('smooth30') !== 'off';
let renderGeneration = 0;
let recorder = null;
let recordingCanvas = null;
let recordingTimer = 0;
let recordingChunks = [];
let recordingStartedAt = 0;

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
  let outputFpsSum = 0;
  let kbpsSum = 0;
  let engine = '--';
  let gridRes = '--';

  for (const entry of players.values()) {
    await sampleMeter(entry.el, entry.meter);
    const m = entry.meter;
    const fpsEl = entry.card.querySelector('[data-fps]');
    if (m.ready) {
      live += 1;
      const outputFps = entry.smoother?.running && entry.smoothStats
        ? entry.smoothStats.outputFps
        : m.fps;
      outputFpsSum += outputFps;
      kbpsSum += m.kbps;
      if (m.engine !== '--') engine = m.engine;
      if (fpsEl) fpsEl.textContent = entry.smoother?.running && entry.smoothStats
        ? `OUT ${outputFps.toFixed(1)} / SRC ${m.fps.toFixed(1)}`
        : `SRC ${m.fps.toFixed(1)} FPS`;
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
    if (!focusEntry.smoother || !focusEntry.smoother.running) {
      focusFps.textContent = focusEntry.meter.ready ? `SRC ${focusEntry.meter.fps.toFixed(1)} FPS` : 'FPS --';
    }
  }

  const total = players.size;
  document.getElementById('liveText').textContent = `${live}/${total}`;
  document.getElementById('fpsText').textContent = live ? (outputFpsSum / live).toFixed(1) : '--';
  document.getElementById('mbpsText').textContent = kbpsSum ? (kbpsSum / 1000).toFixed(2) : '--';
  document.getElementById('engineText').textContent = engine;
  document.getElementById('resText').textContent = gridRes;

  const dot = document.getElementById('liveDot');
  dot.className = 'dot ' + (live === total ? 'ok' : live === 0 ? 'bad' : 'warn');
  if (!diagnosticsView.classList.contains('hidden')) updateDiagnostics();
}

function updateDiagnostics() {
  diagnosticsRows.innerHTML = [...players.values()].map(entry => {
    const m = entry.meter;
    const video = entry.el.video;
    const resolution = video?.videoWidth ? `${video.videoWidth}x${video.videoHeight}` : '--';
    const output = entry.smoother?.running && entry.smoothStats ? entry.smoothStats.outputFps.toFixed(1) : '--';
    const source = m.ready ? m.fps.toFixed(1) : '--';
    const state = m.ready ? 'Live' : 'Connecting';
    return `<tr><td>${entry.camera.name}</td><td class="state-${state.toLowerCase()}">${state}</td><td>${resolution}</td><td>${source} fps</td><td>${output} fps</td><td>${m.kbps ? `${(m.kbps / 1000).toFixed(2)} Mbps` : '--'}</td><td>${m.engine}</td></tr>`;
  }).join('');
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
  stopSmoother(entry);
  setStatus(entry.card, 'Connecting');
  entry.meter = newMeter();
  entry.el = makePlayer(entry.card.querySelector('[data-player]'), cameraId, quality);
  if (smooth30Enabled && !focusEntry) startGridSmoothing(entry);
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
  renderGeneration += 1;
  for (const entry of players.values()) stopSmoother(entry);
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
    const entry = { camera, el, card, meter: newMeter(), smoother: null, smoothStats: null };
    players.set(camera.id, entry);
  });
  cameraMenu.innerHTML = config.cameras.map(camera => `<div class="camera-menu-item" role="menuitem"><span><b>${camera.name}</b><small>${camera.ip}</small></span><button type="button" data-camera-action="enlarge" data-camera-id="${camera.id}">Enlarge</button><button type="button" data-camera-action="reconnect" data-camera-id="${camera.id}">Reconnect</button></div>`).join('');
  applyGridLayout();
  startGridSmoothingAll();
}

function recordingSource(entry) {
  return entry?.card?.querySelector('.smooth30-canvas') || entry?.el?.video;
}

function drawRecordingFrame() {
  if (!recorder || !recordingCanvas) return;
  const context = recordingCanvas.getContext('2d', { alpha: false });
  const width = recordingCanvas.width;
  const height = recordingCanvas.height;
  context.fillStyle = '#020304';
  context.fillRect(0, 0, width, height);
  const entries = focusEntry
    ? [{ entry: focusEntry, rect: { left: 0, top: 0, width: 1, height: 1 } }]
    : [...players.values()].map(entry => {
        const rect = entry.card.getBoundingClientRect();
        const gridRect = grid.getBoundingClientRect();
        return { entry, rect: {
          left: (rect.left - gridRect.left) / Math.max(1, gridRect.width),
          top: (rect.top - gridRect.top) / Math.max(1, gridRect.height),
          width: rect.width / Math.max(1, gridRect.width),
          height: rect.height / Math.max(1, gridRect.height),
        } };
      });
  for (const item of entries) {
    const source = focusEntry ? (focusPlayer.querySelector('.smooth30-canvas') || focusEntry.el?.video) : recordingSource(item.entry);
    if (!source || source.readyState < 2 || !source.videoWidth) continue;
    const x = Math.round(item.rect.left * width);
    const y = Math.round(item.rect.top * height);
    const w = Math.round(item.rect.width * width);
    const h = Math.round(item.rect.height * height);
    context.drawImage(source, x, y, w, h);
  }
  recordingTimer = setTimeout(drawRecordingFrame, 33);
}

function recordingMimeType() {
  return ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm']
    .find(type => MediaRecorder.isTypeSupported(type)) || '';
}

function stopRecording() {
  if (!recorder) return;
  recorder.stop();
  clearTimeout(recordingTimer);
  recordToggle.classList.remove('recording');
  recordToggle.setAttribute('aria-pressed', 'false');
  recordToggle.textContent = 'Record';
}

function startRecording() {
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
    recordToggle.textContent = 'Recording unavailable';
    setTimeout(() => { recordToggle.textContent = 'Record'; }, 2500);
    return;
  }
  const mimeType = recordingMimeType();
  if (!mimeType) {
    recordToggle.textContent = 'Codec unavailable';
    setTimeout(() => { recordToggle.textContent = 'Record'; }, 2500);
    return;
  }
  recordingCanvas = document.createElement('canvas');
  recordingCanvas.width = 1920;
  recordingCanvas.height = 1080;
  recordingDownload.classList.add('hidden');
  recordingChunks = [];
  recordingStartedAt = new Date();
  const stream = recordingCanvas.captureStream(30);
  recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
  recorder.ondataavailable = event => { if (event.data.size) recordingChunks.push(event.data); };
  recorder.onerror = () => { recordingChunks = []; recorder = null; recordToggle.textContent = 'Record'; };
  recorder.onstop = () => {
    const blob = new Blob(recordingChunks, { type: mimeType });
    const stamp = recordingStartedAt.toISOString().replace(/[:.]/g, '-');
    const scope = focusedCamera ? `-${focusedCamera.id}` : '-grid';
    if (recordingDownload.href && recordingDownload.href.startsWith('blob:')) URL.revokeObjectURL(recordingDownload.href);
    recordingDownload.href = URL.createObjectURL(blob);
    recordingDownload.download = `wyze-monitor${scope}-${stamp}.webm`;
    recordingDownload.classList.remove('hidden');
    // Start the download immediately. Chrome may reject an asynchronous
    // download in some policies; the visible link remains as a fallback.
    setTimeout(() => recordingDownload.click(), 0);
    recorder = null;
    recordingCanvas = null;
    recordingChunks = [];
  };
  recorder.start(1000);
  recordToggle.classList.add('recording');
  recordToggle.setAttribute('aria-pressed', 'true');
  recordToggle.textContent = focusedCamera ? 'Stop camera recording' : 'Stop grid recording';
  drawRecordingFrame();
}

cameraMenu.addEventListener('click', event => {
  const button = event.target.closest('button[data-camera-action]');
  if (!button) return;
  const camera = config.cameras.find(item => item.id === button.dataset.cameraId);
  if (!camera) return;
  if (button.dataset.cameraAction === 'enlarge') openFocus(camera);
  else reconnectCamera(camera.id);
});
cameraMenuButton.addEventListener('click', () => {
  const hidden = cameraMenu.classList.toggle('hidden');
  cameraMenuButton.setAttribute('aria-expanded', String(!hidden));
});
document.addEventListener('click', event => {
  if (!event.target.closest('.camera-menu-wrap')) {
    cameraMenu.classList.add('hidden');
    cameraMenuButton.setAttribute('aria-expanded', 'false');
  }
});

function updateSmooth30Controls() {
  smooth30Toggle.classList.toggle('active', smooth30Enabled);
  smooth30Toggle.textContent = smooth30Enabled ? 'Smooth 30 On' : 'Smooth 30 Off';
  smooth30Badge.classList.toggle('hidden', !smooth30Enabled || !focusEntry?.smoother?.running);
}

function stopSmoother(entry) {
  if (entry?.smoother) entry.smoother.stop();
  if (entry) {
    entry.smoother = null;
    entry.smoothStats = null;
    const badge = entry.card?.querySelector('[data-smooth30-badge]');
    if (badge) badge.classList.add('hidden');
  }
}

async function startGridSmoothing(entry, generation = renderGeneration) {
  if (!entry || entry.smoother || !smooth30Enabled || focusEntry) return;
  const player = entry.card.querySelector('[data-player]');
  const badge = entry.card.querySelector('[data-smooth30-badge]');
  const smoother = new FullResolutionCadence30(entry.el.video, player, stats => {
    if (players.get(entry.camera.id) !== entry || entry.smoother !== smoother) return;
    entry.smoothStats = stats;
    const fpsEl = entry.card.querySelector('[data-fps]');
    if (fpsEl) fpsEl.textContent = `OUT ${stats.outputFps.toFixed(1)} / SRC ${stats.sourceFps.toFixed(1)}`;
    if (badge) {
      badge.textContent = stats.missedDeadlines
        ? `SYNTHETIC 30 - ${stats.missedDeadlines} LATE`
        : 'SYNTHETIC 30';
    }
  });
  entry.smoother = smoother;
  try {
    await smoother.start();
    if (generation !== renderGeneration || players.get(entry.camera.id) !== entry || !smooth30Enabled || focusEntry) {
      stopSmoother(entry);
      return;
    }
    if (badge) badge.classList.remove('hidden');
  } catch (err) {
    if (entry.smoother === smoother) {
      stopSmoother(entry);
      setStatus(entry.card, 'Smooth 30 unavailable');
      console.warn(`Smooth 30 unavailable for ${entry.camera.name}:`, err);
    }
  }
}

function startGridSmoothingAll() {
  if (!smooth30Enabled || focusEntry) return;
  const generation = renderGeneration;
  // Stagger GPU allocation and first uploads to avoid a four-stream burst.
  [...players.values()].forEach((entry, index) => {
    setTimeout(() => {
      if (generation === renderGeneration) startGridSmoothing(entry, generation);
    }, index * 120);
  });
}

function stopGridSmoothingAll() {
  for (const entry of players.values()) stopSmoother(entry);
}
async function startFocusSmoothing() {
  const entry = focusEntry;
  if (!entry || !smooth30Enabled || entry.smoother) return;
  smooth30Toggle.disabled = true;
  smooth30Toggle.textContent = 'Starting Smooth 30';
  const smoother = new FullResolutionCadence30(entry.el.video, focusPlayer, stats => {
    if (focusEntry !== entry) return;
    focusFps.textContent = `OUT ${stats.outputFps.toFixed(1)} / SRC ${stats.sourceFps.toFixed(1)} FPS`;
    focusDetails.textContent = `${focusedCamera.ip} / ${stats.width}x${stats.height} / full resolution`;
    smooth30Badge.textContent = stats.missedDeadlines
      ? `SYNTHETIC 30 - ${stats.missedDeadlines} LATE`
      : 'SYNTHETIC 30';
  });
  entry.smoother = smoother;
  try {
    await smoother.start();
    if (focusEntry !== entry || !smooth30Enabled) {
      stopSmoother(entry);
      return;
    }
  } catch (err) {
    entry.smoother = null;
    smooth30Enabled = false;
    localStorage.setItem('smooth30', 'off');
    focusDetails.textContent = `Smooth 30 unavailable: ${err.message}`;
  } finally {
    smooth30Toggle.disabled = false;
    updateSmooth30Controls();
  }
}

function setSmooth30(enabled) {
  smooth30Enabled = enabled;
  localStorage.setItem('smooth30', enabled ? 'on' : 'off');
  if (focusEntry?.smoother) {
    stopSmoother(focusEntry);
  }
  stopGridSmoothingAll();
  updateSmooth30Controls();
  if (enabled && focusEntry) startFocusSmoothing();
  else if (enabled) startGridSmoothingAll();
}

function openFocus(camera) {
  stopGridSmoothingAll();
  focusedCamera = camera;
  focusName.textContent = camera.name;
  focusDetails.textContent = `${camera.ip} / full resolution`;
  focusTimestamp.textContent = formatTimestamp();
  focusFps.textContent = 'FPS --';
  focusView.classList.remove('hidden');
  focusView.setAttribute('aria-hidden', 'false');
  const el = makePlayer(focusPlayer, camera.id, 'main');
  focusEntry = { el, meter: newMeter(), smoother: null };
  updateSmooth30Controls();
  if (smooth30Enabled) startFocusSmoothing();
}

function closeFocus() {
  focusedCamera = null;
  if (focusEntry?.smoother) stopSmoother(focusEntry);
  focusEntry = null;
  focusPlayer.innerHTML = '';
  focusView.classList.add('hidden');
  focusView.setAttribute('aria-hidden', 'true');
  startGridSmoothingAll();
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
smooth30Toggle.addEventListener('click', () => setSmooth30(!smooth30Enabled));
focusView.addEventListener('click', e => { if (e.target === focusView) closeFocus(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && focusedCamera) closeFocus(); });
diagnosticsButton.addEventListener('click', () => {
  diagnosticsView.classList.remove('hidden');
  diagnosticsView.setAttribute('aria-hidden', 'false');
  updateDiagnostics();
});
document.getElementById('diagnosticsClose').addEventListener('click', () => {
  diagnosticsView.classList.add('hidden');
  diagnosticsView.setAttribute('aria-hidden', 'true');
});
recordToggle.addEventListener('click', () => {
  if (recorder) stopRecording();
  else startRecording();
});
window.addEventListener('beforeunload', () => { if (recorder) recorder.stop(); });

init().catch(err => {
  grid.innerHTML = `<pre class="error">${String(err.stack || err)}</pre>`;
});
