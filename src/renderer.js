import { VideoRTC } from '/vendor/video-rtc.js';
import { FullResolutionCadence30 } from '/smooth30.js';

// Playback buffer requested from WebRTC. 1000 ms stopped the 20 Sep stutter
// but added a second of delay; raise it again if stutter returns.
const PLAYBACK_BUFFER_MS = 300;
// Reconnect a camera that stays frozen (0 FPS), or whose buffer stays above
// this, for this many 1 s ticks.
const MAX_PLAYBACK_DELAY_S = 3;
const SLOW_TICKS_BEFORE_RECONNECT = 10;
const AUTO_RECONNECT_COOLDOWN_MS = 60000;

class VideoStream extends VideoRTC {
  async createOffer(pc) {
    const offer = await super.createOffer(pc);
    for (const { receiver } of pc.getTransceivers()) {
      if (receiver.track?.kind !== 'video') continue;
      if ('jitterBufferTarget' in receiver) {
        receiver.jitterBufferTarget = PLAYBACK_BUFFER_MS;
      } else {
        console.warn('This browser cannot request the Wyze playback buffer.');
      }
    }
    return offer;
  }


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
let hiddenCameraIds = new Set();
try {
  const saved = JSON.parse(localStorage.getItem('hiddenCameraIds') || '[]');
  if (Array.isArray(saved)) hiddenCameraIds = new Set(saved.filter(id => typeof id === 'string'));
} catch { /* Ignore malformed saved preferences. */ }

function visibleCameras() {
  return config.cameras.filter(camera => !hiddenCameraIds.has(camera.id));
}

function setCameraVisible(id, visible) {
  if (!config.cameras.some(camera => camera.id === id)) return;
  if (visible) hiddenCameraIds.delete(id); else hiddenCameraIds.add(id);
  localStorage.setItem('hiddenCameraIds', JSON.stringify([...hiddenCameraIds]));
  render(true);
}

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
let smooth30Enabled = localStorage.getItem('smooth30') === 'on';
let renderGeneration = 0;
let recorder = null;
let recordingCanvas = null;
let recordingTimer = 0;
let recordingTrack = null;
let recordingChunks = [];
let recordingStartedAt = 0;
let recordingBytes = 0;

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
  return {
    lastFrames: 0, lastBytes: 0, lastTime: performance.now(), fps: 0, kbps: 0, engine: '--', ready: false,
    delay: null, lastJbDelay: null, lastJbEmitted: null, slowTicks: 0,
  };
}

async function sampleMeter(el, meter) {
  const video = el.video;
  if (!video) return;

  const q = video.getVideoPlaybackQuality ? video.getVideoPlaybackQuality() : null;
  const frames = q ? Math.max(0, q.totalVideoFrames - q.droppedVideoFrames) : 0;
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
      stats.forEach(r => {
        if (r.type !== 'inbound-rtp' || r.kind !== 'video') return;
        bytes += r.bytesReceived || 0;
        meter.playback = Object.fromEntries([
          'framesDecoded', 'framesDropped', 'freezeCount', 'totalFreezesDuration',
          'packetsLost', 'jitter', 'jitterBufferDelay', 'jitterBufferTargetDelay',
          'jitterBufferEmittedCount', 'frameWidth', 'frameHeight', 'framesPerSecond',
        ].filter(key => typeof r[key] === 'number').map(key => [key, r[key]]));
        meter.playback.decoder = r.decoderImplementation || 'unknown';
        // Average buffer time of frames released since the last sample.
        const jbDelay = r.jitterBufferDelay;
        const jbEmitted = r.jitterBufferEmittedCount;
        if (typeof jbDelay === 'number' && typeof jbEmitted === 'number') {
          if (meter.lastJbEmitted !== null && jbEmitted > meter.lastJbEmitted) {
            meter.delay = (jbDelay - meter.lastJbDelay) / (jbEmitted - meter.lastJbEmitted);
          }
          meter.lastJbDelay = jbDelay;
          meter.lastJbEmitted = jbEmitted;
        }
        meter.playback.bufferTargetMs = el.pc.getReceivers()
          .find(receiver => receiver.track?.kind === 'video')?.jitterBufferTarget ?? null;
      });
      if (bytes && meter.lastBytes && dt > 0.2) meter.kbps = ((bytes - meter.lastBytes) * 8) / dt / 1000;
      meter.lastBytes = bytes;
    } catch (err) { /* stats unavailable this tick */ }
  } else if (el.mseCodecs) {
    meter.engine = 'MSE';
    const buffered = video.buffered;
    if (buffered && buffered.length) meter.delay = Math.max(0, buffered.end(buffered.length - 1) - video.currentTime);
  }
}

function delayText(meter) {
  return typeof meter.delay === 'number' ? ` · ${meter.delay.toFixed(1)}s` : '';
}

/** Reconnect a camera whose picture has frozen or fallen behind. */
function checkPlaybackDelay(entry) {
  const m = entry.meter;
  const frozen = m.ready && m.fps < 0.5;
  m.slowTicks = frozen || (m.ready && m.delay > MAX_PLAYBACK_DELAY_S) ? m.slowTicks + 1 : 0;
  if (m.slowTicks < SLOW_TICKS_BEFORE_RECONNECT || recorder) return;
  if (Date.now() - (entry.lastAutoReconnect || 0) < AUTO_RECONNECT_COOLDOWN_MS) return;
  console.warn(`${entry.camera.name}: ${frozen ? 'picture frozen' : `playback ${m.delay.toFixed(1)}s behind`}, reconnecting`);
  if (entry === focusEntry) {
    openFocus(entry.camera);
    focusEntry.lastAutoReconnect = Date.now();
  } else {
    entry.lastAutoReconnect = Date.now();
    reconnectCamera(entry.camera.id);
  }
}

function setStatus(card, text) {
  const s = card.querySelector('.status');
  if (s) s.textContent = text;
  const state = card.querySelector('.camera-state');
  if (state) state.textContent = text === 'Connecting' ? 'Connecting' : 'Live';
}

async function tick() {
  const clock = formatTimestamp();
  document.querySelectorAll('.timestamp').forEach(e => { e.textContent = clock; });
  document.getElementById('clockText').textContent = clock.slice(-8);

  let live = 0;
  let outputFpsSum = 0;
  let kbpsSum = 0;
  let engine = '--';
  const gridResolutions = new Set();

  const activeEntries = focusEntry ? [focusEntry] : [...players.values()];
  for (const entry of activeEntries) {
    await sampleMeter(entry.el, entry.meter);
    checkPlaybackDelay(entry);
    const m = entry.meter;
    const fpsEl = entry.card?.querySelector('[data-fps]');
    if (m.ready) {
      live += 1;
      const outputFps = entry.smoother?.running && entry.smoothStats
        ? entry.smoothStats.outputFps
        : m.fps;
      outputFpsSum += outputFps;
      kbpsSum += m.kbps;
      if (m.engine !== '--') engine = m.engine;
      if (fpsEl) fpsEl.textContent = (entry.smoother?.running && entry.smoothStats
        ? `OUT ${outputFps.toFixed(1)} / SRC ${m.fps.toFixed(1)}`
        : `SRC ${m.fps.toFixed(1)} FPS`) + delayText(m);
      if (fpsEl) fpsEl.title = 'Frame rate · playback buffer delay (time spent waiting in the app before display)';
      const vw = entry.el.video ? entry.el.video.videoWidth : 0;
      const vh = entry.el.video ? entry.el.video.videoHeight : 0;
      if (entry.card) setStatus(entry.card, vw ? `${vw}x${vh}` : config.qualities[quality].label);
      if (vw) gridResolutions.add(`${vw}x${vh}`);
      entry.card?.classList.remove('offline');
    } else {
      if (fpsEl) fpsEl.textContent = 'FPS --';
      if (entry.card) setStatus(entry.card, 'Connecting');
      entry.card?.classList.add('offline');
    }
  }

  if (focusEntry) {
    if (!focusEntry.smoother || !focusEntry.smoother.running) {
      focusFps.textContent = focusEntry.meter.ready ? `SRC ${focusEntry.meter.fps.toFixed(1)} FPS${delayText(focusEntry.meter)}` : 'FPS --';
    }
  }

  const total = activeEntries.length;
  document.getElementById('liveText').textContent = `${live}/${total}`;
  document.getElementById('fpsText').textContent = live ? (outputFpsSum / live).toFixed(1) : '--';
  document.getElementById('mbpsText').textContent = kbpsSum ? (kbpsSum / 1000).toFixed(2) : '--';
  document.getElementById('engineText').textContent = engine;
  const resText = document.getElementById('resText');
  resText.textContent = gridResolutions.size > 1 ? 'Mixed' : [...gridResolutions][0] || '--';
  resText.title = [...gridResolutions].join(', ');

  const dot = document.getElementById('liveDot');
  dot.className = 'dot ' + (!total ? 'warn' : live === total ? 'ok' : live === 0 ? 'bad' : 'warn');
  fetch('/api/playback', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(activeEntries.map(entry => ({
      camera: entry.camera.id, ...entry.meter.playback,
      displayedFps: entry.meter.fps, ready: entry.meter.ready, delay: entry.meter.delay,
    }))),
  }).catch(() => {});
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
      : 'Grid tiles pull the substream where available; single-stream cameras keep their original resolution';
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
  disposePlayer(entry.el);
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
    const size = Math.min((w / cols) / TILE_ASPECT, Math.max(0, h / rows - 90));
    if (size > best.size) best = { cols, size };
  }
  return best.cols;
}

function applyGridLayout() {
  const count = Math.max(1, visibleCameras().length);
  const cols = bestColumns(count, grid.clientWidth || window.innerWidth, grid.clientHeight || window.innerHeight);
  grid.style.setProperty('--cols', cols);
  grid.style.setProperty('--rows', Math.ceil(count / cols));
  grid.style.setProperty('--count', count);
}

function disposePlayer(el) {
  if (!el) return;
  el.remove();
  if (el.disconnectTID) clearTimeout(el.disconnectTID);
  if (el.reconnectTID) clearTimeout(el.reconnectTID);
  el.disconnectTID = 0;
  el.reconnectTID = 0;
  el.ondisconnect();
}

function render(preservePlayers = false) {
  if (!preservePlayers) renderGeneration += 1;
  const cameras = visibleCameras();
  for (const [id, entry] of players) {
    if (!preservePlayers || hiddenCameraIds.has(id)) {
      stopSmoother(entry); disposePlayer(entry.el); entry.card?.remove(); players.delete(id);
    }
  }
  grid.querySelector('.camera-empty')?.remove();
  if (!preservePlayers) grid.innerHTML = '';
  cameras.forEach(camera => {
    if (players.has(camera.id)) return;
    const card = template.content.firstElementChild.cloneNode(true);
    card.dataset.cameraId = camera.id;
    card.querySelector('.camera-label').textContent = camera.name;
    card.querySelector('.camera-label').title = camera.ip;
    card.querySelector('.enlarge').addEventListener('click', () => openFocus(camera));
    card.querySelector('.refresh').addEventListener('click', () => reconnectCamera(camera.id));
    card.querySelector('.camera-frame').addEventListener('dblclick', () => openFocus(camera));
    const nextCamera = cameras.slice(cameras.indexOf(camera) + 1).find(item => players.has(item.id));
    grid.insertBefore(card, nextCamera ? players.get(nextCamera.id).card : null);

    const el = makePlayer(card.querySelector('[data-player]'), camera.id, quality);
    const entry = { camera, el, card, meter: newMeter(), smoother: null, smoothStats: null };
    players.set(camera.id, entry);
  });
  if (!cameras.length) {
    const empty = document.createElement('div');
    empty.className = 'camera-empty';
    empty.textContent = 'No cameras selected. Open Cameras to choose what to display.';
    grid.appendChild(empty);
  }
  renderCameraMenu();
  applyGridLayout();
  startGridSmoothingAll();
}

function renderCameraMenu() {
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  cameraMenu.innerHTML = `<div class="camera-menu-heading"><span>Show cameras · ${visibleCameras().length}/${config.cameras.length}</span><button type="button" data-camera-action="show-all">Show all</button></div>` +
    config.cameras.map(camera => `<div class="camera-menu-item"><label><input type="checkbox" data-camera-visible="${camera.id}" ${hiddenCameraIds.has(camera.id) ? '' : 'checked'}><span><b>${escape(camera.name)}</b><small>${escape(camera.ip)}</small></span></label><button type="button" data-camera-action="enlarge" data-camera-id="${camera.id}">Enlarge</button><button type="button" data-camera-action="reconnect" data-camera-id="${camera.id}" ${hiddenCameraIds.has(camera.id) ? 'disabled' : ''}>Reconnect</button></div>`).join('');
}

function recordingSource(entry) {
  // Capture the decoded video element directly. Electron can display the
  // Smooth30 WebGL canvas correctly but may return black pixels when that
  // canvas is read back for recording.
  return entry?.el?.video || entry?.card?.querySelector('.smooth30-canvas');
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
    const source = focusEntry ? (focusEntry.el?.video || focusPlayer.querySelector('.smooth30-canvas')) : recordingSource(item.entry);
    if (!source || source.readyState < 2 || !source.videoWidth) continue;
    const x = Math.round(item.rect.left * width);
    const y = Math.round(item.rect.top * height);
    const w = Math.round(item.rect.width * width);
    const h = Math.round(item.rect.height * height);
    const scale = Math.min(w / source.videoWidth, h / source.videoHeight);
    const drawW = source.videoWidth * scale;
    const drawH = source.videoHeight * scale;
    context.drawImage(source, x + (w - drawW) / 2, y + (h - drawH) / 2, drawW, drawH);
  }
  if (recordingTrack?.requestFrame) recordingTrack.requestFrame();
  recordingTimer = setTimeout(drawRecordingFrame, 33);
}

function recordingMimeType() {
  const types = ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm'];
  if (!window.electronAPI?.saveRecording) types.unshift('video/mp4;codecs=avc1.42001E');
  return types
    .find(type => MediaRecorder.isTypeSupported(type)) || '';
}

function offerRecordingDownload(blob, filename) {
  if (recordingDownload.href?.startsWith('blob:')) URL.revokeObjectURL(recordingDownload.href);
  recordingDownload.href = URL.createObjectURL(blob);
  recordingDownload.download = filename;
  recordingDownload.classList.remove('hidden');
  recordingDownload.click();
  // Keep the link available if the browser blocks the automatic download.
}

async function saveBrowserRecording(blob, filename) {
  if (blob.type.startsWith('video/mp4')) {
    offerRecordingDownload(blob, filename);
    return;
  }
  if (!config.recording?.mp4) {
    offerRecordingDownload(blob, filename.replace(/\.mp4$/, '.webm'));
    return;
  }
  try {
    if (blob.size > config.recording.maxBytes) throw new Error('Recording exceeds the MP4 conversion limit.');
    const response = await fetch('/api/recordings', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob });
    if (!response.ok) throw new Error((await response.json()).error || 'MP4 conversion failed.');
    offerRecordingDownload(await response.blob(), filename);
  } catch (error) {
    // Preserve a downloadable copy even if the Pi is busy or conversion fails.
    offerRecordingDownload(blob, filename.replace(/\.mp4$/, '.webm'));
    throw error;
  }
}

function stopRecording() {
  if (!recorder || recorder.state !== 'recording') return;
  recorder.stop();
  clearTimeout(recordingTimer);
  recordToggle.classList.remove('recording');
  recordToggle.setAttribute('aria-pressed', 'false');
  recordToggle.disabled = true;
  recordToggle.textContent = 'Saving recording…';
}

function startRecording() {
  if (recorder || recordToggle.disabled) return;
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
  recordingBytes = 0;
  recordingStartedAt = new Date();
  const stream = recordingCanvas.captureStream(0);
  recordingTrack = stream.getVideoTracks()[0] || null;
  recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
  recorder.ondataavailable = event => {
    if (!event.data.size) return;
    recordingChunks.push(event.data);
    recordingBytes += event.data.size;
    if (!window.electronAPI?.saveRecording && !mimeType.startsWith('video/mp4') &&
        config.recording?.maxBytes && recordingBytes > config.recording.maxBytes - 8 * 1024 * 1024) stopRecording();
  };
  recorder.onerror = () => { recordingChunks = []; recorder = null; recordToggle.textContent = 'Record'; };
  recorder.onstop = async () => {
    const blob = new Blob(recordingChunks, { type: mimeType });
    const stamp = recordingStartedAt.toISOString().replace(/[:.]/g, '-');
    const scope = focusedCamera ? `-${focusedCamera.id}` : '-grid';
    const filename = `wyze-monitor${scope}-${stamp}.mp4`;
    try {
      recordToggle.textContent = 'Saving MP4…';
      if (window.electronAPI?.saveRecording) {
        recordToggle.textContent = 'Saving MP4…';
        await window.electronAPI.saveRecording(await blob.arrayBuffer(), filename);
        recordToggle.textContent = 'Saved MP4';
      } else {
        await saveBrowserRecording(blob, filename);
        recordToggle.textContent = 'Recording ready';
      }
    } catch (error) {
      recordToggle.textContent = window.electronAPI?.saveRecording ? 'Save failed' : 'WebM backup ready';
      recordToggle.title = error.message;
      console.error('Recording save failed:', error);
    } finally {
      stream.getTracks().forEach(track => track.stop());
      recorder = null;
      recordingTrack = null;
      recordingCanvas = null;
      recordingChunks = [];
      recordToggle.disabled = false;
      setTimeout(() => { if (!recorder) recordToggle.textContent = 'Record'; }, 3000);
    }
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
  if (button.dataset.cameraAction === 'show-all') {
    hiddenCameraIds.clear();
    localStorage.setItem('hiddenCameraIds', '[]');
    render(true);
    return;
  }
  const camera = config.cameras.find(item => item.id === button.dataset.cameraId);
  if (!camera) return;
  if (button.dataset.cameraAction === 'enlarge') openFocus(camera);
  else reconnectCamera(camera.id);
});
cameraMenu.addEventListener('change', event => {
  const checkbox = event.target.closest('input[data-camera-visible]');
  if (!checkbox) return;
  const id = checkbox.dataset.cameraVisible;
  setCameraVisible(id, checkbox.checked);
  cameraMenu.querySelector(`input[data-camera-visible="${id}"]`)?.focus();
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
  renderGeneration += 1;
  stopGridSmoothingAll();
  for (const entry of players.values()) disposePlayer(entry.el);
  players.clear();
  if (focusEntry) { stopSmoother(focusEntry); disposePlayer(focusEntry.el); }
  focusedCamera = camera;
  focusName.textContent = camera.name;
  focusDetails.textContent = `${camera.ip} / full resolution`;
  focusTimestamp.textContent = formatTimestamp();
  focusFps.textContent = 'FPS --';
  focusView.classList.remove('hidden');
  focusView.setAttribute('aria-hidden', 'false');
  const el = makePlayer(focusPlayer, camera.id, 'main');
  focusEntry = { camera, el, meter: newMeter(), smoother: null };
  updateSmooth30Controls();
  if (smooth30Enabled) startFocusSmoothing();
}

function closeFocus() {
  focusedCamera = null;
  if (focusEntry?.smoother) stopSmoother(focusEntry);
  if (focusEntry) disposePlayer(focusEntry.el);
  focusEntry = null;
  focusPlayer.innerHTML = '';
  focusView.classList.add('hidden');
  focusView.setAttribute('aria-hidden', 'true');
  render();
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
