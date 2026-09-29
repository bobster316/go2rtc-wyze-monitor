// Timelapse panel. Capture and rendering run on the server (Electron main
// process on Windows, the web container on a Pi), so this page only
// configures jobs and shows their progress. Closing the page does not stop a
// capture.

const $ = id => document.getElementById(id);
const button = $('timelapseButton');
const menu = $('tlMenu');
const toast = $('tlToast');
const panel = $('timelapsePanel');
const els = {
  cameras: $('tlCameras'), layout: $('tlLayout'), layoutField: $('tlLayoutField'),
  startMode: $('tlStartMode'), startAt: $('tlStartAt'), stopMode: $('tlStopMode'),
  durations: $('tlDurations'), lengths: $('tlLengths'), lengthLabel: $('tlLengthLabel'),
  fps: $('tlFps'), deflicker: $('tlDeflicker'), smooth: $('tlSmooth'), labels: $('tlLabels'),
  labelsToggle: $('tlLabelsToggle'), timestamp: $('tlTimestamp'), skipNight: $('tlSkipNight'), tidy: $('tlTidy'),
  shutter: $('tlShutter'), colour: $('tlColour'), uhd: $('tlUhd'), recommended: $('tlRecommended'),
  name: $('tlName'), summary: $('tlSummary'), start: $('tlStart'), error: $('tlError'),
  activeSection: $('tlActiveSection'), active: $('tlActive'), library: $('tlLibrary'),
  player: $('tlPlayer'), playerVideo: $('tlPlayerVideo'), playerTitle: $('tlPlayerTitle'),
  playerDownload: $('tlPlayerDownload'),
};

const DURATIONS = [[1800, '30 min'], [3600, '1 h'], [7200, '2 h'], [14400, '4 h'], [28800, '8 h'], [43200, '12 h'], [86400, '24 h']];
const LENGTHS = [[15, '15 s'], [30, '30 s'], [60, '1 min'], [120, '2 min'], [180, '3 min']];
// Whole numbers of the cameras' 2-second keyframes, so frames are evenly spaced.
const INTERVALS = [[2, '2 s'], [4, '4 s'], [6, '6 s'], [10, '10 s'], [16, '16 s'], [30, '30 s'], [60, '1 min'], [120, '2 min'], [300, '5 min']];
const TOGGLES = ['shutter', 'deflicker', 'colour', 'smooth', 'labels', 'timestamp', 'skipNight', 'uhd', 'tidy'];
// Measured daylight average for a Wyze Cam v4 2560x1440 frame at JPEG quality 2.
const BYTES_PER_FRAME = 900 * 1024;
const ELECTRON = Boolean(window.electronAPI?.revealTimelapse);

let info = null;
let lastJobsJson = '';
let pollTimer = 0;
let pendingDelete = null;
const selected = new Set();
const prefs = loadPrefs();

// Recommended look: 25 fps, natural motion blur, steady exposure and colour,
// daylight only. Bump PREFS_VERSION when these change so saved choices from
// an older version do not hide the new recommendations.
const PREFS_VERSION = 2;
const RECOMMENDED = { fps: 25, shutter: true, deflicker: true, colour: true, smooth: true, labels: true,
  timestamp: false, skipNight: true, uhd: false, tidy: true };
function loadPrefs() {
  const defaults = { version: PREFS_VERSION, layout: 'grid', stopMode: 'after', duration: 86400, length: 60, interval: 10, ...RECOMMENDED };
  try {
    const saved = JSON.parse(localStorage.getItem('timelapsePrefs') || '{}');
    if (saved.version !== PREFS_VERSION) {
      // Keep what to capture; reset the look to the recommendations.
      const { layout, stopMode, duration, length } = saved;
      return { ...defaults, ...Object.fromEntries(Object.entries({ layout, stopMode, duration, length }).filter(([, v]) => v !== undefined)) };
    }
    return { ...defaults, ...saved };
  } catch { return defaults; }
}
function savePrefs() {
  try { localStorage.setItem('timelapsePrefs', JSON.stringify(prefs)); } catch {}
}

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const cameraName = id => info?.cameras.find(camera => camera.id === id)?.name || id;

function formatBytes(bytes) {
  if (!bytes) return '0 MB';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(bytes >= 10 * 1024 ** 3 ? 0 : 1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}
function formatClock(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function formatSpan(sec) {
  sec = Math.round(sec);
  if (sec < 60) return `${sec} s`;
  if (sec < 3600) return `${Math.floor(sec / 60)} min${sec % 60 ? ` ${sec % 60} s` : ''}`;
  const h = Math.floor(sec / 3600), m = Math.round(sec % 3600 / 60);
  return `${h} h${m ? ` ${m} min` : ''}`;
}
function formatVideo(sec) {
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return m ? `${m}:${String(s).padStart(2, '0')}` : `${sec.toFixed(sec < 10 ? 1 : 0)} s`;
}
function formatWhen(ms) {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
}

async function api(path, options = {}) {
  const response = await fetch(`/api/timelapse${path}`, {
    cache: 'no-store', ...options,
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

// ---- form -------------------------------------------------------------

function setSeg(group, value) {
  group.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.value === String(value)));
}
function chips(container, items, value) {
  container.innerHTML = items.map(([v, label]) =>
    `<button type="button" class="${String(v) === String(value) ? 'active' : ''}" data-value="${v}">${label}</button>`).join('');
}

function durationSec() {
  return prefs.stopMode === 'manual' ? null : prefs.duration;
}

/** Choose the capture interval that turns the capture into the chosen video length. */
function plan() {
  const fps = prefs.fps;
  const limits = info.limits;
  const duration = durationSec();
  let interval;
  if (duration == null) {
    interval = prefs.interval;
  } else {
    const raw = duration / (prefs.length * fps);
    // Even seconds line up with the cameras' two-second keyframe cadence.
    interval = Math.min(limits.maxIntervalSec, Math.max(limits.minIntervalSec, Math.round(raw / 2) * 2));
  }
  const capture = duration ?? limits.maxDurationSec;
  const frames = Math.floor(capture / interval) + 1;
  return { interval, frames, videoSec: frames / fps, bytes: frames * selected.size * BYTES_PER_FRAME, manual: duration == null };
}

function renderForm() {
  els.cameras.innerHTML = `<button type="button" data-camera="*" class="${selected.size === info.cameras.length ? 'active' : ''}">All cameras</button>` +
    info.cameras.map(camera => `<button type="button" data-camera="${esc(camera.id)}" class="${selected.has(camera.id) ? 'active' : ''}">${esc(camera.name)}</button>`).join('');
  const multi = selected.size > 1;
  els.layoutField.classList.toggle('hidden', !multi);
  els.labelsToggle.classList.toggle('hidden', !multi || prefs.layout === 'individual');
  setSeg(els.layout, prefs.layout);
  setSeg(els.startMode, els.startAt.classList.contains('hidden') ? 'now' : 'later');
  setSeg(els.stopMode, prefs.stopMode);
  setSeg(els.fps, prefs.fps);
  els.durations.classList.toggle('hidden', prefs.stopMode === 'manual');
  chips(els.durations, DURATIONS, prefs.duration);
  if (prefs.stopMode === 'manual') {
    els.lengthLabel.textContent = 'Capture a frame every';
    chips(els.lengths, INTERVALS, prefs.interval);
  } else {
    els.lengthLabel.textContent = 'Finished video length';
    chips(els.lengths, LENGTHS, prefs.length);
  }
  for (const key of TOGGLES) els[key].checked = prefs[key];
  if (!info.overlays) {
    for (const key of ['labels', 'timestamp']) { els[key].disabled = true; els[key].closest('label').title = 'No overlay font was found on this system.'; }
  }
  renderSummary();
}

// Mirrors gridGeometry() in lib/timelapse.js: 16:9 tiles across 3840 pixels.
function gridSize(count) {
  if (count === 3) return '3840×1440 (one large, two small)';
  const cols = count <= 4 ? 2 : count <= 9 ? 3 : 4;
  const tileH = Math.round(3840 / cols * 9 / 16 / 2) * 2;
  return `3840×${tileH * Math.ceil(count / cols)}`;
}

function renderSummary() {
  if (!selected.size) {
    els.summary.innerHTML = '<span class="tl-warn">Choose at least one camera.</span>';
    els.start.disabled = true;
    return;
  }
  const p = plan();
  const later = !els.startAt.classList.contains('hidden');
  const free = info.disk?.free;
  const tight = free != null && p.bytes > free * 0.9;
  const grid = selected.size > 1 && prefs.layout !== 'individual';
  const size = grid ? gridSize(selected.size) : prefs.uhd ? '3840×2160' : '2560×1440';
  const blur = prefs.shutter ? shutterSec(p.interval) : 0;
  els.summary.innerHTML = [
    `<b>Every ${formatSpan(p.interval)}</b> from ${selected.size === 1 ? esc(cameraName([...selected][0])) : `${selected.size} cameras`} at full 2560×1440`,
    p.manual
      ? `Up to ${p.frames.toLocaleString()} frames · ${formatVideo(p.interval ? 3600 / p.interval / prefs.fps : 0)} of video per hour captured`
      : `${p.frames.toLocaleString()} frames · <b>${formatVideo(p.videoSec)}</b> ${size} video at ${prefs.fps} fps`,
    blur ? `Natural motion blur: each frame averages ${formatSpan(blur)} of camera footage` : null,
    `<span class="${tight ? 'tl-warn' : ''}">${p.manual ? 'Up to ' : 'About '}${formatBytes(p.bytes)} of frames${free != null ? ` · ${formatBytes(free)} free` : ''}</span>`,
  ].filter(Boolean).map(line => `<div>${line}</div>`).join('');
  els.start.disabled = false;
  els.start.textContent = later ? 'Schedule timelapse' : 'Start timelapse';
}

/** Mirrors shutterFrames() in lib/timelapse.js: half the interval, whole keyframes, at most 8. */
function shutterSec(interval) {
  const keyframe = info.keyframeSec || 2;
  const frames = Math.max(1, Math.min(info.maxShutterFrames || 8, Math.round(interval / 2 / keyframe)));
  return frames > 1 ? frames * keyframe : 0;
}

function renderOptions() {
  return {
    layout: prefs.layout, fps: prefs.fps, deflicker: prefs.deflicker, colour: prefs.colour, smooth: prefs.smooth,
    labels: prefs.labels, timestamp: prefs.timestamp, skipNight: prefs.skipNight, uhd: prefs.uhd, tidy: prefs.tidy,
  };
}

async function startJob() {
  els.error.classList.add('hidden');
  const p = plan();
  let startAt = null;
  if (!els.startAt.classList.contains('hidden')) {
    startAt = new Date(els.startAt.value).getTime();
    if (!Number.isFinite(startAt) || startAt < Date.now() - 60000) return showError('Choose a start time in the future.');
  }
  els.start.disabled = true;
  try {
    await api('', { method: 'POST', body: JSON.stringify({
      cameras: [...selected], intervalSec: p.interval, durationSec: durationSec(), startAt, shutter: prefs.shutter,
      name: els.name.value.trim(), tzOffsetMinutes: -new Date().getTimezoneOffset(), render: renderOptions(),
    }) });
    els.name.value = '';
    await refresh(true);
  } catch (err) {
    showError(err.message);
  } finally {
    els.start.disabled = false;
  }
}

function showError(message) {
  els.error.textContent = message;
  els.error.classList.remove('hidden');
}

// ---- jobs -------------------------------------------------------------

const STATE_LABEL = {
  scheduled: 'Scheduled', capturing: 'Capturing', captured: 'Captured', queued: 'Waiting to render',
  rendering: 'Rendering', ready: 'Ready', failed: 'Failed', cancelled: 'Cancelled',
};

function progressBar(value, live) {
  return `<div class="tl-progress${live ? ' live' : ''}"><i data-progress="${Math.max(0, Math.min(1, value))}"></i></div>`;
}

function activeCard(job) {
  if (job.state === 'scheduled') {
    return `<article class="tl-job" data-id="${job.id}">
      <header><b>${esc(job.name)}</b><span class="tl-pill scheduled">Scheduled</span></header>
      <div class="tl-meta">${esc(job.cameras.map(cameraName).join(', '))}</div>
      <div class="tl-meta">Starts ${formatWhen(job.startAt)} · ${job.manual ? 'runs until stopped (24 h max)' : `runs ${formatSpan((job.endAt - job.startAt) / 1000)}`} · every ${formatSpan(job.intervalSec)}</div>
      <div class="tl-actions"><button type="button" data-action="stop">Cancel</button></div>
    </article>`;
  }
  const total = (job.endAt - job.startedAt) / 1000;
  const frames = Object.values(job.frames).reduce((a, b) => a + b, 0);
  const errors = Object.entries(job.cameraErrors || {});
  return `<article class="tl-job live" data-id="${job.id}">
    <header><span class="tl-rec"></span><b>${esc(job.name)}</b><span class="tl-pill capturing">Capturing</span></header>
    <div class="tl-previews tl-n${Math.min(job.cameras.length, 4)}">${job.cameras.map(id => `
      <figure><img alt="Latest ${esc(cameraName(id))} frame" data-preview="${job.id}/${esc(id)}" data-frames="${job.frames[id] || 0}" /><figcaption>${esc(cameraName(id))} · ${job.frames[id] || 0}</figcaption></figure>`).join('')}
    </div>
    ${progressBar(job.manual ? 0 : job.elapsedSec / total, job.manual)}
    <div class="tl-stats">
      <span><b>${formatClock(job.elapsedSec)}</b>${job.manual ? ' elapsed' : ` / ${formatClock(total)}`}</span>
      <span>${frames.toLocaleString()} frames</span>
      <span>${formatBytes(job.bytes)}</span>
    </div>
    ${errors.map(([id, message]) => `<div class="tl-camera-error">${esc(cameraName(id))}: reconnecting (${esc(message)})</div>`).join('')}
    <div class="tl-actions"><button type="button" class="tl-stop" data-action="stop">Stop &amp; make video</button></div>
  </article>`;
}

function outputRow(job, output) {
  const label = output.camera === 'grid' ? 'Grid' : cameraName(output.camera);
  const size = output.width ? `${output.width}×${output.height}` : '2560×1440';
  const url = `/api/timelapse/${job.id}/files/${encodeURIComponent(output.name)}`;
  return `<div class="tl-output">
    <span><b>${esc(label)}</b><small>${size} · ${formatVideo(output.durationSec)} · ${formatBytes(output.bytes)}</small></span>
    <button type="button" data-action="play" data-url="${url}" data-title="${esc(`${job.name} – ${label}`)}">Play</button>
    ${ELECTRON
      ? `<button type="button" data-action="reveal" data-name="${esc(output.name)}">Show in folder</button>`
      : `<a class="tl-btn" href="${url}?download=1" download="${esc(output.name)}">Download</a>`}
  </div>`;
}

function libraryCard(job) {
  const frames = Object.values(job.frames).reduce((a, b) => a + b, 0);
  const busy = job.state === 'rendering' || job.state === 'queued';
  const canRender = ['captured', 'ready', 'failed'].includes(job.state) && frames && !job.framesPruned;
  const confirming = pendingDelete === job.id;
  return `<article class="tl-job" data-id="${job.id}">
    <header><b>${esc(job.name)}</b><span class="tl-pill ${job.state}">${STATE_LABEL[job.state] || esc(job.state)}${job.state === 'rendering' ? ` ${Math.round(job.progress * 100)}%` : ''}</span></header>
    <div class="tl-meta">${job.startedAt ? formatWhen(job.startedAt) : formatWhen(job.startAt)} · ${formatSpan(job.elapsedSec)} captured · ${frames.toLocaleString()} frames${job.framesPruned ? '' : ` · ${formatBytes(job.bytes)}`}</div>
    ${job.reason && job.reason !== 'Completed' ? `<div class="tl-meta">${esc(job.reason)}</div>` : ''}
    ${busy ? progressBar(job.progress, job.state === 'queued') : ''}
    ${job.error ? `<div class="tl-camera-error">${esc(job.error)}</div>` : ''}
    ${job.state === 'ready' ? job.outputs.map(output => outputRow(job, output)).join('') : ''}
    <div class="tl-actions">
      ${busy ? '<button type="button" data-action="stop">Cancel render</button>' : ''}
      ${canRender ? `<button type="button" data-action="render" title="Render again with the current Look &amp; quality settings">${job.state === 'ready' ? 'Re-render' : 'Render'}</button>` : ''}
      ${job.state === 'ready' && !job.framesPruned ? `<button type="button" data-action="prune" title="Keep the videos, delete the source frames">Free ${formatBytes(job.bytes)}</button>` : ''}
      <button type="button" class="tl-danger${confirming ? ' confirm' : ''}" data-action="delete" title="${job.outputsShared ? 'Removes it from this list. Videos in Downloads are kept.' : 'Deletes the frames and videos.'}">${confirming ? (job.outputsShared ? 'Confirm remove' : 'Confirm delete') : (job.outputsShared ? 'Remove' : 'Delete')}</button>
    </div>
  </article>`;
}

function renderJobs(jobs) {
  const active = jobs.filter(job => job.state === 'capturing' || job.state === 'scheduled');
  const library = jobs.filter(job => !active.includes(job));
  els.activeSection.classList.toggle('hidden', !active.length);
  els.active.innerHTML = active.map(activeCard).join('');
  els.library.innerHTML = library.length ? library.map(libraryCard).join('') : '<p class="tl-empty">Finished timelapses appear here.</p>';
  panel.querySelectorAll('[data-progress]').forEach(bar => { bar.style.width = `${Number(bar.dataset.progress) * 100}%`; });
  loadPreviews();
}

const previewFrames = new Map();
function loadPreviews() {
  panel.querySelectorAll('img[data-preview]').forEach(img => {
    const key = img.dataset.preview;
    const frames = Number(img.dataset.frames);
    const known = previewFrames.get(key);
    if (!frames) { img.removeAttribute('src'); return; }
    // Reuse the cached image until a new frame lands, so previews do not flicker.
    const [id, camera] = key.split('/');
    img.src = `/api/timelapse/${id}/preview/${encodeURIComponent(camera)}?f=${known && known >= frames ? known : frames}`;
    previewFrames.set(key, frames);
  });
}

function updateToolbar(jobs) {
  const capturing = jobs.filter(job => job.state === 'capturing');
  const rendering = jobs.find(job => job.state === 'rendering');
  const scheduled = jobs.some(job => job.state === 'scheduled');
  button.classList.toggle('capturing', capturing.length > 0);
  button.classList.toggle('scheduled', !capturing.length && scheduled);
  if (capturing.length) {
    const longest = Math.max(...capturing.map(job => job.elapsedSec));
    button.textContent = formatClock(longest);
    button.title = `Timelapse capturing: ${capturing.map(job => job.name).join(', ')}`;
  } else if (rendering) {
    button.textContent = `Rendering ${Math.round(rendering.progress * 100)}%`;
  } else {
    button.textContent = 'Timelapse';
  }
  // Mark tiles whose camera is being captured.
  const ids = new Set(capturing.flatMap(job => job.cameras));
  document.querySelectorAll('.camera-card[data-camera-id]').forEach(card => card.classList.toggle('tl-capturing', ids.has(card.dataset.cameraId)));
}

async function refresh(force = false) {
  try {
    info = await api('');
  } catch {
    return;
  }
  const jobs = info.jobs;
  updateToolbar(jobs);
  announceReady(jobs);
  if (!menu.classList.contains('hidden')) renderMenu(jobs);
  const json = JSON.stringify(jobs);
  if (!panel.classList.contains('hidden') && (force || json !== lastJobsJson)) {
    lastJobsJson = json;
    renderJobs(jobs);
    renderSummary();
  }
  schedulePoll(jobs);
}

function schedulePoll(jobs = info?.jobs || []) {
  clearTimeout(pollTimer);
  const busy = jobs.some(job => ['capturing', 'rendering', 'queued'].includes(job.state));
  const open = !panel.classList.contains('hidden') || !menu.classList.contains('hidden');
  pollTimer = setTimeout(refresh, open || busy ? 2000 : 15000);
}

// ---- panel ------------------------------------------------------------

function focusedCameraId() {
  const focus = $('focusView');
  if (!focus || focus.classList.contains('hidden')) return null;
  const name = $('focusName')?.textContent;
  return info.cameras.find(camera => camera.name === name)?.id || null;
}

// The grid narrows beside the panel; renderer.js relayouts tiles on resize.
function dock(open) {
  document.body.classList.toggle('tl-open', open);
  window.dispatchEvent(new Event('resize'));
}

function openPanel(section = 'new') {
  closeMenu();
  const focused = focusedCameraId();
  if (focused) { selected.clear(); selected.add(focused); }
  panel.classList.remove('hidden');
  panel.setAttribute('aria-hidden', 'false');
  dock(true);
  button.setAttribute('aria-expanded', 'true');
  renderForm();
  lastJobsJson = '';
  refresh(true).then(() => {
    const body = panel.querySelector('.tl-body');
    const target = section === 'library' ? $('tlLibraryTitle') : null;
    body.scrollTop = target ? target.offsetTop - body.offsetTop - 8 : 0;
  });
}
function closePanel() {
  panel.classList.add('hidden');
  panel.setAttribute('aria-hidden', 'true');
  dock(false);
  button.setAttribute('aria-expanded', 'false');
  schedulePoll();
}

function defaultStart() {
  const d = new Date(Date.now() + 3600e3);
  d.setMinutes(0, 0, 0);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function openPlayer(url, title) {
  els.playerTitle.textContent = title;
  els.playerDownload.href = `${url}?download=1`;
  els.playerDownload.classList.toggle('hidden', ELECTRON);
  els.playerVideo.src = url;
  els.player.classList.remove('hidden');
  els.player.setAttribute('aria-hidden', 'false');
  els.playerVideo.play().catch(() => {});
}
function closePlayer() {
  els.playerVideo.pause();
  els.playerVideo.removeAttribute('src');
  els.playerVideo.load();
  els.player.classList.add('hidden');
  els.player.setAttribute('aria-hidden', 'true');
}

async function jobAction(target) {
  const action = target.dataset.action;
  if (action === 'new') return openPanel('new');
  if (action === 'library') return openPanel('library');
  if (action === 'quick') return quickStart(target);
  const card = target.closest('[data-id]');
  const id = card?.dataset.id;
  if (!id || !action) return;
  try {
    if (action === 'play') { closeMenu(); return openPlayer(target.dataset.url, target.dataset.title); }
    if (action === 'reveal') return window.electronAPI.revealTimelapse(id, target.dataset.name || null);
    if (action === 'delete') {
      if (pendingDelete !== id) {
        pendingDelete = id;
        target.classList.add('confirm');
        target.textContent = target.textContent === 'Remove' ? 'Confirm remove' : 'Confirm delete';
        setTimeout(() => { if (pendingDelete === id) { pendingDelete = null; refresh(true); } }, 4000);
        return;
      }
      pendingDelete = null;
      await api(`/${id}`, { method: 'DELETE' });
    } else if (action === 'stop') {
      await api(`/${id}/stop`, { method: 'POST', body: '{}' });
    } else if (action === 'render') {
      await api(`/${id}/render`, { method: 'POST', body: JSON.stringify({ render: renderOptions() }) });
    } else if (action === 'prune') {
      await api(`/${id}/prune`, { method: 'POST', body: '{}' });
    }
    target.disabled = true;
    await refresh(true);
  } catch (err) {
    showError(err.message);
  }
}

function bind() {
  button.addEventListener('click', event => {
    event.stopPropagation();
    if (menu.classList.contains('hidden')) openMenu(); else closeMenu();
  });
  menu.addEventListener('click', event => {
    const target = event.target.closest('button[data-action]');
    if (target) jobAction(target);
  });
  toast.addEventListener('click', event => {
    const target = event.target.closest('button[data-action]');
    if (target) { hideToast(); jobAction(target); }
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('.tl-menu-wrap')) closeMenu();
  });
  $('tlClose').addEventListener('click', closePanel);
  els.cameras.addEventListener('click', event => {
    const chip = event.target.closest('button[data-camera]');
    if (!chip) return;
    const id = chip.dataset.camera;
    if (id === '*') {
      if (selected.size === info.cameras.length) selected.clear();
      else info.cameras.forEach(camera => selected.add(camera.id));
    } else if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    renderForm();
  });
  const seg = (el, fn) => el.addEventListener('click', event => {
    const b = event.target.closest('button[data-value]');
    if (b) { fn(b.dataset.value); savePrefs(); renderForm(); }
  });
  seg(els.layout, v => { prefs.layout = v; });
  seg(els.stopMode, v => { prefs.stopMode = v; });
  seg(els.durations, v => { prefs.duration = Number(v); });
  seg(els.fps, v => { prefs.fps = Number(v); });
  seg(els.lengths, v => { if (prefs.stopMode === 'manual') prefs.interval = Number(v); else prefs.length = Number(v); });
  seg(els.startMode, v => {
    els.startAt.classList.toggle('hidden', v !== 'later');
    if (v === 'later' && !els.startAt.value) els.startAt.value = defaultStart();
  });
  for (const key of TOGGLES) {
    els[key].addEventListener('change', () => { prefs[key] = els[key].checked; savePrefs(); renderSummary(); });
  }
  els.recommended.addEventListener('click', () => { Object.assign(prefs, RECOMMENDED); savePrefs(); renderForm(); });
  els.startAt.addEventListener('change', renderSummary);
  els.start.addEventListener('click', startJob);
  panel.addEventListener('click', event => {
    const target = event.target.closest('button[data-action]');
    if (target) jobAction(target);
  });
  $('tlPlayerClose').addEventListener('click', closePlayer);
  els.player.addEventListener('click', event => { if (event.target === els.player) closePlayer(); });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (!els.player.classList.contains('hidden')) closePlayer();
    else if (!menu.classList.contains('hidden')) closeMenu();
    else if (!panel.classList.contains('hidden')) closePanel();
  });
  // Grid tiles are rebuilt on quality changes; re-apply capture badges.
  const grid = $('grid');
  if (grid) new MutationObserver(() => info && updateToolbar(info.jobs)).observe(grid, { childList: true });
}

// ---- drop-down menu ---------------------------------------------------

function openMenu() {
  menu.classList.remove('hidden');
  button.setAttribute('aria-expanded', 'true');
  renderMenu(info.jobs);
  refresh();
}
function closeMenu() {
  if (menu.classList.contains('hidden')) return;
  menu.classList.add('hidden');
  button.setAttribute('aria-expanded', 'false');
  schedulePoll();
}

// One hour of every camera into a 30-second grid video.
function quickInterval() {
  return Math.max(info.limits.minIntervalSec, Math.round(3600 / (30 * prefs.fps) / 2) * 2);
}

async function quickStart(target) {
  target.disabled = true;
  try {
    await api('', { method: 'POST', body: JSON.stringify({
      cameras: info.cameras.map(camera => camera.id), intervalSec: quickInterval(), durationSec: 3600, name: '', shutter: prefs.shutter,
      tzOffsetMinutes: -new Date().getTimezoneOffset(), render: { ...renderOptions(), layout: 'grid' },
    }) });
    await refresh(true);
    renderMenu(info.jobs);
  } catch (err) {
    showToast(`<span>${esc(err.message)}</span>`);
  } finally {
    target.disabled = false;
  }
}

function outputButtons(job, output) {
  const url = `/api/timelapse/${job.id}/files/${encodeURIComponent(output.name)}`;
  const label = output.camera === 'grid' ? `${job.cameras.length} cameras` : cameraName(output.camera);
  return `<button type="button" data-action="play" data-url="${url}" data-title="${esc(`${job.name} – ${label}`)}">Play</button>` +
    (ELECTRON
      ? `<button type="button" data-action="reveal" data-name="${esc(output.name)}" title="Show in Downloads">Show</button>`
      : `<a class="tl-btn" href="${url}?download=1" download="${esc(output.name)}">Download</a>`);
}

function renderMenu(jobs) {
  const running = jobs.filter(job => ['capturing', 'scheduled', 'rendering', 'queued'].includes(job.state));
  const recent = jobs.filter(job => job.state === 'ready' && job.outputs.length).slice(0, 3);
  const status = job => {
    if (job.state === 'capturing') return `<b class="tl-live">● ${formatClock(job.elapsedSec)}</b>${job.manual ? '' : ` / ${formatClock((job.endAt - job.startedAt) / 1000)}`}`;
    if (job.state === 'scheduled') return `Starts ${formatWhen(job.startAt)}`;
    if (job.state === 'queued') return 'Waiting to render';
    return `Rendering ${Math.round(job.progress * 100)}%`;
  };
  const cams = job => job.cameras.length === 1 ? esc(cameraName(job.cameras[0])) : `${job.cameras.length} cameras`;
  menu.innerHTML = `
    ${running.length ? `<div class="tl-menu-group">${running.map(job => `
      <div class="tl-menu-row" data-id="${job.id}">
        <span><b>${esc(job.name)}</b><small>${cams(job)} · ${status(job)}</small></span>
        <button type="button" data-action="stop"${job.state === 'capturing' ? ' class="tl-stop"' : ''}>${job.state === 'capturing' ? 'Stop' : 'Cancel'}</button>
      </div>`).join('')}</div>` : ''}
    <div class="tl-menu-group">
      <button type="button" class="tl-menu-item" data-action="quick"><b>Quick start</b><small>All ${info.cameras.length} cameras · 1 hour → 30 s video</small></button>
      <button type="button" class="tl-menu-item" data-action="new"><b>New timelapse…</b><small>Choose cameras, schedule and length</small></button>
    </div>
    ${recent.length ? `<div class="tl-menu-group"><div class="tl-menu-heading">Recent</div>${recent.map(job => {
      const output = job.outputs.find(o => o.camera === 'grid') || job.outputs[0];
      return `<div class="tl-menu-row" data-id="${job.id}">
        <span><b>${esc(job.name)}</b><small>${cams(job)} · ${formatVideo(output.durationSec)}</small></span>
        ${outputButtons(job, output)}
      </div>`;
    }).join('')}</div>` : ''}
    <div class="tl-menu-group"><button type="button" class="tl-menu-item" data-action="library"><b>All timelapses…</b></button></div>`;
}

// ---- ready notice -------------------------------------------------------

const knownStates = new Map();
let toastTimer = 0;
function announceReady(jobs) {
  const first = knownStates.size === 0;
  for (const job of jobs) {
    const before = knownStates.get(job.id);
    knownStates.set(job.id, job.state);
    if (first || job.state !== 'ready' || !before || before === 'ready' || !job.outputs.length) continue;
    const output = job.outputs.find(o => o.camera === 'grid') || job.outputs[0];
    const where = ELECTRON ? 'Saved to Downloads › Wyze Monitor › Timelapses'
      : `${job.outputs.length === 1 ? '1 video' : `${job.outputs.length} videos`} ready to download`;
    showToast(`<span><b>Timelapse ready</b><small>${esc(job.name)} · ${where}</small></span>
      <span class="tl-toast-actions" data-id="${job.id}">${outputButtons(job, output)}</span>`);
  }
}
function showToast(html) {
  toast.innerHTML = `${html}<button type="button" class="tl-toast-close" aria-label="Dismiss">×</button>`;
  toast.classList.remove('hidden');
  toast.querySelector('.tl-toast-close').addEventListener('click', hideToast);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 15000);
}
function hideToast() { toast.classList.add('hidden'); }

async function init() {
  try {
    info = await api('');
  } catch {
    return; // Server without timelapse support: keep the button hidden.
  }
  info.cameras.forEach(camera => selected.add(camera.id));
  if (!info.limits.fps.includes(prefs.fps)) prefs.fps = RECOMMENDED.fps;
  button.classList.remove('hidden');
  bind();
  announceReady(info.jobs);
  updateToolbar(info.jobs);
  schedulePoll(info.jobs);
}

init();
