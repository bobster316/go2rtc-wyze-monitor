'use strict';

/**
 * Server-side timelapse capture and rendering, shared by the Windows Electron
 * main process and the Raspberry Pi web container.
 *
 * Capture: one FFmpeg per camera reads the full-resolution main stream from
 * go2rtc and decodes keyframes only (-skip_frame nokey), so a 2560x1440 camera
 * costs one intra-frame decode every ~2 s instead of 20 full decodes a second.
 * A select filter emits one visually lossless JPEG per interval. Frames are
 * filed by wall-clock slot, so every camera's frame N shows the same moment.
 *
 * Virtual shutter: the cameras' exposure cannot be controlled, so each saved
 * frame is the average of the keyframes from the last half-interval (the
 * 180-degree shutter rule). Moving clouds, water and leaves get natural motion
 * blur, and sensor noise, compression blocking and exposure flicker average
 * out. Intervals are whole multiples of the keyframe spacing so frames arrive
 * evenly.
 *
 * Render: frames are fed through the concat demuxer with their real capture
 * spacing as durations, so overlays show true clock time even across gaps.
 * The graph evens out auto white balance drift (per-frame channel gains sent
 * with sendcmd), deflickers auto-exposure pumping, optionally blends
 * neighbouring frames for smoother motion, composes a 4K grid with xstack and
 * encodes H.264 High with CRF 18.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const LIMITS = Object.freeze({
  maxDurationSec: 24 * 3600,
  minIntervalSec: 2,
  maxIntervalSec: 600,
  maxScheduleAheadSec: 7 * 24 * 3600,
  fps: [24, 25, 30, 60],
});
// Recommended settings: 25 fps, auto exposure and white balance evened out,
// daylight only, native resolution.
const DEFAULT_RENDER = Object.freeze({
  fps: 25, layout: 'grid', deflicker: true, colour: true, smooth: true, timestamp: false, labels: true,
  skipNight: true, uhd: false, auto: true, tidy: true,
});
const LAYOUTS = ['grid', 'individual', 'both'];
const JOB_ID = /^tl-\d{8}-\d{6}-[a-f0-9]{4}$/;
const OUTPUT_NAME = /^[a-z0-9_-]{1,80}\.mp4$/;
const FRAME_NAME = /^(\d{6})\.jpg$/;
const EOI = Buffer.from([0xff, 0xd9]);
const MAX_FRAME_BYTES = 24 * 1024 * 1024;
const NIGHT_SATURATION = 4;
// Wyze Cam v4 RTSP streams carry a keyframe every 2 s.
const KEYFRAME_SEC = 2;
// At most 8 keyframes (16 s) are averaged, which bounds memory per camera.
const MAX_STACK = 8;
// Colour balance: frames either side used to find the steady colour, and the
// largest correction applied to a channel.
const COLOUR_WINDOW = 7;
const COLOUR_LIMIT = [0.85, 1.18];
const BG = '0x020304';

// FFmpeg filter values pass through two parsers: the filter's option parser,
// then the filtergraph parser. Escape for each so paths and text are literal.
const escapeOption = value => String(value).replace(/[\\':]/g, c => `\\${c}`);
const escapeGraph = value => String(value).replace(/[\\'[\],;]/g, c => `\\${c}`);
const filterValue = value => escapeGraph(escapeOption(value));
const pad6 = n => String(n).padStart(6, '0');
const even = n => Math.max(2, Math.round(n / 2) * 2);
const safeLabel = name => String(name).replace(/[^\p{L}\p{N} _.-]/gu, '').slice(0, 40) || 'Camera';
const slug = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'camera';

/** Snap an interval to whole keyframes so captured frames are evenly spaced. */
function snapInterval(intervalSec, keyframeSec = KEYFRAME_SEC) {
  if (!keyframeSec || intervalSec < keyframeSec) return intervalSec;
  return Number((Math.round(intervalSec / keyframeSec) * keyframeSec).toFixed(3));
}

/** Keyframes averaged per saved frame: half the interval, like a 180-degree shutter. */
function shutterFrames(intervalSec, keyframeSec = KEYFRAME_SEC) {
  if (!keyframeSec) return 1;
  return Math.max(1, Math.min(MAX_STACK, Math.round(intervalSec / 2 / keyframeSec)));
}

/**
 * Per-frame red/green/blue gains that hold the colour balance steady.
 * means: [[r, g, b] | null] per frame in time order; ignore: indexes of frames
 * to leave alone (infrared night frames). Each frame's red:green and
 * blue:green ratios are pulled to their average over nearby frames, so slow
 * changes such as a sunset stay while frame-to-frame white balance jumps go.
 * Gains keep the frame's brightness; deflicker handles brightness.
 */
function colourGains(means, ignore = new Set()) {
  const usable = means.map((m, i) => Boolean(m) && !ignore.has(i) && Math.min(...m) >= 16);
  const ratios = means.map((m, i) => usable[i] ? [m[0] / m[1], m[2] / m[1]] : null);
  const clamp = v => Math.min(COLOUR_LIMIT[1], Math.max(COLOUR_LIMIT[0], v));
  return means.map((m, i) => {
    if (!usable[i]) return [1, 1, 1];
    // Median, so one odd frame does not tint its neighbours.
    const near = ratios.slice(Math.max(0, i - COLOUR_WINDOW), i + COLOUR_WINDOW + 1).filter(Boolean);
    const median = k => near.map(ratio => ratio[k]).sort((a, b) => a - b)[Math.floor(near.length / 2)];
    const kr = clamp(median(0) / ratios[i][0]);
    const kb = clamp(median(1) / ratios[i][1]);
    const [r, g, b] = m;
    const keep = (0.2126 * r + 0.7152 * g + 0.0722 * b) / (0.2126 * kr * r + 0.7152 * g + 0.0722 * kb * b);
    return [kr * keep, keep, kb * keep].map(v => Number(v.toFixed(4)));
  });
}

/** sendcmd script that sets a colorchannelmixer's gains as each frame starts. */
function colourCommands(target, entries) {
  // entries: [{ duration, gains: [r, g, b] }] in concat order. Each command
  // fires half a frame early so rounded timestamps cannot miss it.
  let t = 0;
  let last = '';
  const lines = [];
  entries.forEach(({ duration, gains }, i) => {
    const key = gains.join(' ');
    const at = i ? t - entries[i - 1].duration / 2 : 0;
    if (key !== last) {
      lines.push(`${at.toFixed(3)} [enter] ${target} rr ${gains[0]}, [enter] ${target} gg ${gains[1]}, [enter] ${target} bb ${gains[2]};`);
      last = key;
    }
    t += duration;
  });
  return lines.join('\n') + '\n';
}

/**
 * Tile positions for a grid video. Every tile is 16:9. Three cameras use one
 * large tile and two stacked small ones, so the video has no empty space and
 * the large tile keeps the cameras' native 2560x1440.
 */
function gridGeometry(count, canvasWidth = 3840) {
  if (count === 3) {
    const bigW = even(canvasWidth * 2 / 3);
    const bigH = even(bigW * 9 / 16);
    const smallW = canvasWidth - bigW;
    const smallH = bigH / 2;
    return {
      width: canvasWidth, height: bigH,
      tiles: [
        { x: 0, y: 0, w: bigW, h: bigH },
        { x: bigW, y: 0, w: smallW, h: smallH },
        { x: bigW, y: smallH, w: smallW, h: smallH },
      ],
    };
  }
  const cols = count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4;
  const rows = Math.ceil(count / cols);
  const w = even(canvasWidth / cols);
  const h = even(w * 9 / 16);
  const tiles = Array.from({ length: count }, (_, i) => ({ x: (i % cols) * w, y: Math.floor(i / cols) * h, w, h }));
  return { width: w * cols, height: h * rows, tiles };
}

/**
 * Build the render filtergraph. Exported for tests.
 * inputs: [{ label }], one per FFmpeg input in order.
 */
function buildFilterGraph({ inputs, grid, fps, deflicker, smooth, timestamp, labels, epochOffset, fontFile, canvasWidth, upscale }) {
  const chains = [];
  const drawStyle = size => `fontcolor=white:fontsize=${size}:box=1:boxcolor=black@0.5:boxborderw=${Math.round(size / 2.4)}`;
  const font = fontFile ? `fontfile=${filterValue(fontFile.replace(/\\/g, '/'))}:` : '';
  const perInput = [];
  let geometry = null;
  if (grid) geometry = gridGeometry(inputs.length, canvasWidth);
  inputs.forEach((input, i) => {
    const steps = [];
    if (input.colourScript) {
      // Gains are set per frame by the script. Deflicker must then see YUV:
      // it only corrects the first plane, which in RGB is green.
      steps.push(`sendcmd=f=${filterValue(input.colourScript.replace(/\\/g, '/'))}`,
        `colorchannelmixer@c${i}=rr=1:gg=1:bb=1`, 'format=yuv420p');
    }
    if (deflicker) steps.push('deflicker=size=7:mode=pm');
    if (!grid && upscale) {
      steps.push(`scale=${upscale.width}:${upscale.height}:flags=lanczos:force_original_aspect_ratio=decrease`,
        `pad=${upscale.width}:${upscale.height}:(ow-iw)/2:(oh-ih)/2:color=${BG}`, 'setsar=1');
    }
    if (grid) {
      const { w, h } = geometry.tiles[i];
      steps.push(`scale=${w}:${h}:flags=lanczos:force_original_aspect_ratio=decrease`,
        `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=${BG}`, 'setsar=1');
      if (labels && fontFile) {
        const size = Math.max(12, Math.round(h / 22));
        steps.push(`drawtext=${font}text=${filterValue(safeLabel(input.label))}:x=${Math.round(size * 0.9)}:y=${Math.round(size * 0.9)}:${drawStyle(size)}`);
      }
    }
    perInput.push(`[${i}:v]${steps.length ? steps.join(',') : 'null'}[v${i}]`);
  });
  chains.push(...perInput);

  const tail = [];
  let head;
  if (grid) {
    const layout = geometry.tiles.map(tile => `${tile.x}_${tile.y}`).join('|');
    head = `${inputs.map((_, i) => `[v${i}]`).join('')}xstack=inputs=${inputs.length}:layout=${layout}:fill=black`;
  } else {
    head = '[v0]null';
  }
  if (smooth) tail.push("tmix=frames=3:weights='1 2 1'");
  if (timestamp && fontFile) {
    const size = grid ? Math.max(16, Math.round(geometry.height / 36)) : 'h/30';
    const text = `%{pts:gmtime:${Math.round(epochOffset)}:%a %d %b %Y  %H\\:%M}`;
    // Top right: Wyze burns its own clock bottom right; tile labels sit top left.
    const margin = grid ? 36 : 'h/40';
    tail.push(`drawtext=${font}text=${filterValue(text)}:x=w-tw-${margin}:y=${margin}:${drawStyle(size)}`);
  }
  tail.push(`settb=AVTB,setpts=N/${fps}/TB`, 'format=yuv420p');
  chains.push(`${head},${tail.join(',')}[out]`);
  return { graph: chains.join(';'), width: geometry?.width, height: geometry?.height };
}

function concatList(entries) {
  // entries: [{ file, duration }]. Absolute paths, forward slashes, quoted.
  return 'ffconcat version 1.0\n' + entries.map(({ file, duration }) =>
    `file '${file.replace(/\\/g, '/').replace(/'/g, "'\\''")}'\nduration ${duration.toFixed(3)}\n`).join('');
}

/** Rename, or copy then delete when the target is on another drive. */
async function moveFile(from, to) {
  try {
    await fsp.rename(from, to);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    await fsp.copyFile(from, to);
    await fsp.rm(from, { force: true });
  }
}

/** Width and height from a JPEG's start-of-frame segment. */
function jpegSize(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(65536);
    const n = fs.readSync(fd, b, 0, b.length, 0);
    for (let i = 2; i + 9 < n;) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      }
      i += 2 + b.readUInt16BE(i + 2);
    }
    return null;
  } catch { return null; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

function spawnFfmpeg(bin, args, { lowPriority = false } = {}) {
  const child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.on('spawn', () => {
    if (lowPriority && process.platform !== 'win32') {
      try { os.setPriority(child.pid, os.constants.priority.PRIORITY_LOW); } catch {}
    }
  });
  return child;
}

function runFfmpeg(bin, args, { lowPriority, onStdout, onData, onChild } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnFfmpeg(bin, args, { lowPriority });
    onChild?.(child);
    let stderr = '';
    child.stdout.on('data', data => { onData?.(data); onStdout?.(data.toString()); });
    child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-64 * 1024); });
    child.on('error', reject);
    child.on('close', (code, signal) => code === 0 ? resolve(stderr)
      : reject(new Error(signal ? `FFmpeg stopped (${signal})` : (stderr.trim().split('\n').slice(-3).join(' ') || `FFmpeg exited with ${code}`))));
  });
}

class TimelapseManager {
  constructor({
    root, outputRoot = null, cameras, ffmpeg = 'ffmpeg', sourceUrl, inputArgs, streamSuffix = '_main',
    fontFile = null, renderPreset = 'slow', renderThreads = 0, lowPriority = false,
    canvasWidth = 3840, minFreeBytes = 2 * 1024 ** 3, limits = {}, now = () => Date.now(), keyframeSec = KEYFRAME_SEC,
    log = (...args) => console.log('[timelapse]', ...args), onActivity = () => {}, onRendered = () => {},
  }) {
    if (!root) throw new Error('Timelapse root directory is required.');
    this.root = path.resolve(root);
    // Finished videos can go to a shared folder (Windows: Downloads) while
    // frames stay under root. Otherwise each job keeps its own output folder.
    this.outputRoot = outputRoot ? path.resolve(outputRoot) : null;
    this.cameras = cameras.map(({ id, name }) => ({ id, name }));
    this.ffmpeg = ffmpeg;
    this.inputArgs = inputArgs || (camera => [
      '-rtsp_transport', 'tcp', '-timeout', '15000000',
      '-i', sourceUrl(`${camera.id}${streamSuffix}`),
    ]);
    this.fontFile = fontFile && fs.existsSync(fontFile) ? fontFile : null;
    this.renderPreset = renderPreset;
    this.renderThreads = renderThreads;
    this.lowPriority = lowPriority;
    this.canvasWidth = canvasWidth;
    this.minFreeBytes = minFreeBytes;
    this.limits = { ...LIMITS, ...limits };
    this.keyframeSec = keyframeSec;
    this.now = now;
    this.log = log;
    this.onActivity = onActivity;
    this.onRendered = onRendered;
    this.jobs = new Map();
    this.captures = new Map();   // jobId -> Map(cameraId -> runtime)
    this.renderQueue = [];
    this.rendering = null;       // { id, child }
    this.timer = null;
    this.diskTimer = null;
    this.closed = false;
    this.ticking = false;
    this.finishing = new Set();  // job ids whose capture is being finished
    this.saving = new Map();     // job id -> pending job.json write
    this.saveCount = 0;
  }

  async init() {
    await fsp.mkdir(this.root, { recursive: true });
    for (const entry of await fsp.readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !JOB_ID.test(entry.name)) continue;
      try {
        const job = JSON.parse(await fsp.readFile(path.join(this.root, entry.name, 'job.json'), 'utf8'));
        if (job.id !== entry.name) continue;
        this.jobs.set(job.id, job);
      } catch (err) { this.log(`ignoring unreadable job ${entry.name}: ${err.message}`); }
    }
    for (const job of this.jobs.values()) {
      // Interrupted renders go back into the queue; captures resume below.
      if (job.state === 'rendering' || job.state === 'queued') {
        job.state = 'captured';
        job.progress = 0;
        this.enqueueRender(job.id);
      }
      if (job.state === 'capturing') await this.recount(job);
    }
    this.timer = setInterval(() => this.tick(), 1000);
    this.timer.unref?.();
    this.diskTimer = setInterval(() => this.checkDisk().catch(() => {}), 30000);
    this.diskTimer.unref?.();
    await this.tick();
    return this;
  }

  // ---- public API -------------------------------------------------------

  capabilities() {
    return {
      limits: { ...this.limits, fps: [...this.limits.fps] },
      keyframeSec: this.keyframeSec,
      maxShutterFrames: MAX_STACK,
      defaults: { ...DEFAULT_RENDER, shutter: true },
      overlays: Boolean(this.fontFile),
      cameras: this.cameras,
    };
  }

  async disk() {
    try {
      const s = await fsp.statfs(this.root);
      return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
    } catch { return null; }
  }

  list() {
    return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt).map(job => this.publicJob(job));
  }

  get(id) {
    const job = JOB_ID.test(id) ? this.jobs.get(id) : null;
    return job ? this.publicJob(job) : null;
  }

  hasActiveCapture() {
    return [...this.jobs.values()].some(job => job.state === 'capturing' || job.state === 'scheduled');
  }

  async create(spec = {}) {
    const now = this.now();
    const cameraIds = [...new Set(Array.isArray(spec.cameras) ? spec.cameras : [])];
    if (!cameraIds.length) throw new UserError('Choose at least one camera.');
    for (const id of cameraIds) {
      if (!this.cameras.some(camera => camera.id === id)) throw new UserError(`Unknown camera "${String(id).slice(0, 40)}".`);
    }
    const requested = Number(spec.intervalSec);
    if (!Number.isFinite(requested) || requested < this.limits.minIntervalSec || requested > this.limits.maxIntervalSec) {
      throw new UserError(`Capture interval must be ${this.limits.minIntervalSec}–${this.limits.maxIntervalSec} seconds.`);
    }
    // Frames only exist at keyframes, so an odd interval would capture unevenly.
    const interval = Math.min(this.limits.maxIntervalSec, snapInterval(requested, this.keyframeSec));
    const stack = spec.shutter === false ? 1 : shutterFrames(interval, this.keyframeSec);
    let startAt = spec.startAt == null ? now : Number(spec.startAt);
    if (!Number.isFinite(startAt)) throw new UserError('Invalid start time.');
    if (startAt < now) startAt = now;
    if (startAt - now > this.limits.maxScheduleAheadSec * 1000) throw new UserError('Schedule the start within the next 7 days.');
    const manual = spec.durationSec == null;
    const duration = manual ? this.limits.maxDurationSec : Number(spec.durationSec);
    if (!Number.isFinite(duration) || duration < interval || duration > this.limits.maxDurationSec) {
      throw new UserError('Capture duration must be at least one interval and no more than 24 hours.');
    }
    const render = this.renderOptions(spec.render, cameraIds.length);
    const tz = Number(spec.tzOffsetMinutes);
    const stamp = new Date(now + (Number.isFinite(tz) ? tz : 0) * 60000).toISOString();
    const id = `tl-${stamp.slice(0, 10).replace(/-/g, '')}-${stamp.slice(11, 19).replace(/:/g, '')}-${crypto.randomBytes(2).toString('hex')}`;
    const job = {
      id,
      name: String(spec.name || '').trim().slice(0, 60) || `Timelapse ${stamp.slice(0, 16).replace('T', ' ')}`,
      cameras: cameraIds,
      createdAt: now,
      startAt,
      endAt: startAt + duration * 1000,
      manual,
      intervalSec: interval,
      shutter: { frames: stack, windowSec: stack > 1 ? Number((stack * this.keyframeSec).toFixed(3)) : 0 },
      tzOffsetMinutes: Number.isFinite(tz) ? Math.max(-840, Math.min(840, tz)) : 0,
      state: startAt > now ? 'scheduled' : 'capturing',
      capture: { startedAt: null, stoppedAt: null, frames: {}, bytes: 0, lastFrameAt: {}, reason: null },
      render,
      progress: 0,
      outputs: [],
      error: null,
    };
    this.jobs.set(id, job);
    await fsp.mkdir(this.jobDir(id), { recursive: true });
    await this.save(job);
    if (job.state === 'capturing') await this.startCapture(job);
    this.log(`created ${id}: ${cameraIds.join(', ')} every ${interval}s, ${stack} keyframe${stack === 1 ? '' : 's'} per frame`);
    this.onActivity(this.hasActiveCapture());
    return this.publicJob(job);
  }

  async stop(id) {
    const job = this.require(id);
    if (job.state === 'scheduled') {
      job.state = 'cancelled';
      job.capture.reason = 'Cancelled before start';
      await this.save(job);
    } else if (job.state === 'capturing') {
      await this.finishCapture(job, 'Stopped manually');
    } else if (job.state === 'rendering' || job.state === 'queued') {
      this.renderQueue = this.renderQueue.filter(item => item !== id);
      if (this.rendering?.id === id) this.rendering.child?.kill();
      job.state = 'captured';
      job.progress = 0;
      await this.save(job);
    }
    this.onActivity(this.hasActiveCapture());
    return this.publicJob(job);
  }

  async render(id, options) {
    const job = this.require(id);
    if (!['captured', 'ready', 'failed'].includes(job.state)) throw new UserError('This timelapse is not ready to render.');
    if (!this.totalFrames(job)) throw new UserError('This timelapse has no captured frames.');
    if (job.framesPruned) throw new UserError('The frames for this timelapse were deleted.');
    job.render = this.renderOptions({ ...job.render, ...(options || {}) }, job.cameras.length);
    this.enqueueRender(id);
    await this.save(job);
    return this.publicJob(job);
  }

  async remove(id) {
    const job = this.require(id);
    await this.stopCameras(job.id);
    this.renderQueue = this.renderQueue.filter(item => item !== id);
    this.jobs.delete(id);
    await this.saving.get(id)?.catch(() => {});
    const child = this.rendering?.id === id ? this.rendering.child : null;
    if (child && child.exitCode === null) {
      // Windows keeps open files locked; let FFmpeg exit before deleting.
      const exited = new Promise(resolve => child.once('close', resolve));
      child.kill();
      await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000))]);
    }
    // Delete means everything: frames, work files and the finished videos,
    // including any in a shared folder such as Downloads.
    if (this.outputRoot) {
      await Promise.all((job.outputs || []).filter(output => OUTPUT_NAME.test(output.name))
        .map(output => fsp.rm(path.join(this.outputRoot, output.name), { force: true }).catch(() => {})));
    }
    await fsp.rm(this.jobDir(id), { recursive: true, force: true });
    this.onActivity(this.hasActiveCapture());
  }

  /** Delete the source frames but keep the finished videos. */
  async prune(id) {
    const job = this.require(id);
    if (job.state !== 'ready') throw new UserError('Render the timelapse before deleting its frames.');
    await fsp.rm(path.join(this.jobDir(id), 'frames'), { recursive: true, force: true });
    job.framesPruned = true;
    await this.save(job);
    return this.publicJob(job);
  }

  async latestFrame(id, cameraId) {
    const job = this.require(id);
    if (!job.cameras.includes(cameraId)) return null;
    const runtime = this.captures.get(id)?.get(cameraId);
    if (runtime?.lastFile) return runtime.lastFile;
    const slots = await this.slots(job, cameraId);
    return slots.length ? this.framePath(job.id, cameraId, slots[slots.length - 1]) : null;
  }

  outputPath(id, name) {
    const job = this.require(id);
    if (!OUTPUT_NAME.test(name) || !job.outputs.some(output => output.name === name)) return null;
    return path.join(this.outputDir(job), name);
  }

  outputDir(job) {
    return this.outputRoot || path.join(this.jobDir(job.id), 'output');
  }

  jobDirectory(id) {
    this.require(id);
    return this.jobDir(id);
  }

  async close() {
    this.closed = true;
    clearInterval(this.timer);
    clearInterval(this.diskTimer);
    // Leave job state as-is so capture resumes on the next start.
    await Promise.all([...this.captures.keys()].map(id => this.stopCameras(id)));
    this.rendering?.child?.kill();
    await Promise.all([...this.jobs.values()].map(job => this.save(job).catch(() => {})));
  }

  // ---- scheduling -------------------------------------------------------

  async tick() {
    // setInterval does not wait for an async tick; a slow finishCapture()
    // must not overlap the next one.
    if (this.closed || this.ticking) return;
    this.ticking = true;
    try { await this.runTick(); } finally { this.ticking = false; }
  }

  async runTick() {
    const now = this.now();
    for (const job of this.jobs.values()) {
      try {
        if (job.state === 'scheduled' && now >= job.startAt) {
          if (now >= job.endAt) {
            job.state = 'failed';
            job.error = 'The scheduled window passed while the monitor was not running.';
            await this.save(job);
          } else {
            job.state = 'capturing';
            await this.startCapture(job);
          }
          this.onActivity(this.hasActiveCapture());
        } else if (job.state === 'capturing') {
          if (now >= job.endAt) await this.finishCapture(job, job.manual ? 'Reached the 24-hour limit' : 'Completed');
          else if (!this.captures.has(job.id)) await this.startCapture(job);
        }
      } catch (err) {
        this.log(`scheduler error for ${job.id}: ${err.message}`);
      }
    }
    this.pumpRenderQueue();
  }

  async checkDisk() {
    if (!this.captures.size) return;
    const disk = await this.disk();
    if (!disk || disk.free >= this.minFreeBytes) return;
    for (const id of this.captures.keys()) {
      const job = this.jobs.get(id);
      if (job) await this.finishCapture(job, 'Stopped: storage almost full');
    }
  }

  // ---- capture ----------------------------------------------------------

  async startCapture(job) {
    if (this.captures.has(job.id)) return;
    if (!job.capture.startedAt) job.capture.startedAt = this.now();
    const runtimes = new Map();
    this.captures.set(job.id, runtimes);
    for (const cameraId of job.cameras) {
      const dir = path.join(this.jobDir(job.id), 'frames', cameraId);
      await fsp.mkdir(dir, { recursive: true });
      const slots = await this.slots(job, cameraId);
      const runtime = {
        cameraId, dir, child: null, chunks: [], size: 0, restarts: 0, restartTimer: null,
        lastSlot: slots.length ? slots[slots.length - 1] : -1, lastFile: null,
        lastFrameAt: this.now(), writing: Promise.resolve(), watchdog: null,
      };
      if (slots.length) runtime.lastFile = this.framePath(job.id, cameraId, runtime.lastSlot);
      runtimes.set(cameraId, runtime);
      this.spawnCamera(job, runtime);
    }
    await this.save(job);
  }

  spawnCamera(job, runtime) {
    if (this.closed || this.captures.get(job.id)?.get(runtime.cameraId) !== runtime) return;
    const camera = this.cameras.find(item => item.id === runtime.cameraId);
    // Select the first keyframe at least (interval - half a keyframe) after
    // the last one, so timestamp jitter never pushes a frame to the next one.
    const gap = Math.max(0.1, job.intervalSec - (this.keyframeSec || 0.5) / 2);
    // Virtual shutter: average the last N keyframes into each saved frame.
    const stack = job.shutter?.frames || 1;
    const filters = [stack > 1 ? `tmix=frames=${stack}` : null, `select='isnan(prev_selected_t)+gte(t-prev_selected_t,${gap})'`];
    const args = [
      '-nostdin', '-hide_banner', '-loglevel', 'error',
      '-skip_frame', 'nokey', ...this.inputArgs(camera),
      '-map', '0:v:0', '-an', '-sn', '-dn',
      '-vf', filters.filter(Boolean).join(','),
      '-fps_mode', 'vfr', '-c:v', 'mjpeg', '-q:v', '2', '-f', 'image2pipe', 'pipe:1',
    ];
    const child = spawnFfmpeg(this.ffmpeg, args);
    runtime.child = child;
    runtime.chunks = [];
    runtime.size = 0;
    runtime.lastFrameAt = this.now();
    let stderr = '';
    child.stdout.on('data', chunk => this.onCaptureData(job, runtime, chunk));
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-2000); });
    child.on('error', err => { stderr = err.message; });
    child.on('close', code => {
      clearInterval(runtime.watchdog);
      if (runtime.child !== child) return;
      runtime.child = null;
      if (this.closed || this.captures.get(job.id)?.get(runtime.cameraId) !== runtime) return;
      runtime.restarts += 1;
      const delay = Math.min(60000, 2000 * 2 ** Math.min(runtime.restarts - 1, 5));
      job.capture.errors = { ...(job.capture.errors || {}), [runtime.cameraId]: (stderr.trim().split('\n').pop() || `FFmpeg exited with ${code}`).slice(0, 200) };
      this.log(`${job.id}/${runtime.cameraId} capture exited (${code}); retry in ${delay / 1000}s`);
      runtime.restartTimer = setTimeout(() => this.spawnCamera(job, runtime), delay);
    });
    // A silent stream is restarted even if FFmpeg itself has not noticed.
    const stallMs = Math.max(45000, job.intervalSec * 2000 + 20000);
    runtime.watchdog = setInterval(() => {
      if (runtime.child === child && this.now() - runtime.lastFrameAt > stallMs) {
        this.log(`${job.id}/${runtime.cameraId} stalled; restarting capture`);
        child.kill();
      }
    }, 5000);
    runtime.watchdog.unref?.();
  }

  onCaptureData(job, runtime, chunk) {
    runtime.chunks.push(chunk);
    runtime.size += chunk.length;
    if (runtime.size > MAX_FRAME_BYTES) { runtime.chunks = []; runtime.size = 0; return; }
    // JPEG entropy data stuffs 0xFF bytes, so FFD9 only occurs at end-of-image.
    let buffer = runtime.chunks.length === 1 ? runtime.chunks[0] : Buffer.concat(runtime.chunks);
    let end;
    let from = 0;
    while ((end = buffer.indexOf(EOI, from)) !== -1) {
      const frame = buffer.subarray(from, end + 2);
      from = end + 2;
      if (frame[0] === 0xff && frame[1] === 0xd8) this.queueFrame(job, runtime, Buffer.from(frame));
    }
    buffer = buffer.subarray(from);
    runtime.chunks = buffer.length ? [buffer] : [];
    runtime.size = buffer.length;
  }

  queueFrame(job, runtime, jpeg) {
    const now = this.now();
    runtime.lastFrameAt = now;
    runtime.restarts = 0;
    if (job.capture.errors?.[runtime.cameraId]) delete job.capture.errors[runtime.cameraId];
    const slot = Math.max(0, Math.round((now - job.capture.startedAt) / (job.intervalSec * 1000)));
    if (slot <= runtime.lastSlot) return;
    runtime.lastSlot = slot;
    runtime.writing = runtime.writing.then(async () => {
      const file = this.framePath(job.id, runtime.cameraId, slot);
      await fsp.writeFile(`${file}.part`, jpeg);
      await fsp.rename(`${file}.part`, file);
      runtime.lastFile = file;
      job.capture.frames[runtime.cameraId] = (job.capture.frames[runtime.cameraId] || 0) + 1;
      job.capture.bytes += jpeg.length;
      job.capture.lastFrameAt[runtime.cameraId] = now;
    }).catch(err => this.log(`${job.id}/${runtime.cameraId} frame write failed: ${err.message}`));
  }

  async stopCameras(id) {
    const runtimes = this.captures.get(id);
    if (!runtimes) return;
    this.captures.delete(id);
    await Promise.all([...runtimes.values()].map(async runtime => {
      clearTimeout(runtime.restartTimer);
      clearInterval(runtime.watchdog);
      const child = runtime.child;
      runtime.child = null;
      if (child && child.exitCode === null) {
        const exited = new Promise(resolve => child.once('close', resolve));
        child.kill();
        await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))]);
      }
      await runtime.writing;
    }));
  }

  async finishCapture(job, reason) {
    if (this.finishing.has(job.id) || job.state !== 'capturing') return;
    this.finishing.add(job.id);
    try { await this.completeCapture(job, reason); } finally { this.finishing.delete(job.id); }
  }

  async completeCapture(job, reason) {
    await this.stopCameras(job.id);
    await this.recount(job);
    job.capture.stoppedAt = this.now();
    job.capture.reason = reason;
    if (this.totalFrames(job)) {
      job.state = 'captured';
      if (job.render.auto) this.enqueueRender(job.id);
    } else {
      job.state = 'failed';
      job.error = 'No frames were captured. Check that the cameras are online.';
    }
    await this.save(job);
    this.log(`${job.id} capture finished: ${reason}, ${this.totalFrames(job)} frames`);
    this.onActivity(this.hasActiveCapture());
  }

  async recount(job) {
    let bytes = 0;
    for (const cameraId of job.cameras) {
      const slots = await this.slots(job, cameraId);
      job.capture.frames[cameraId] = slots.length;
      for (const slot of slots) {
        try { bytes += (await fsp.stat(this.framePath(job.id, cameraId, slot))).size; } catch {}
      }
    }
    job.capture.bytes = bytes;
  }

  // ---- render -----------------------------------------------------------

  enqueueRender(id) {
    const job = this.jobs.get(id);
    if (!job || this.renderQueue.includes(id) || this.rendering?.id === id) return;
    job.state = 'queued';
    job.progress = 0;
    job.error = null;
    this.renderQueue.push(id);
    this.pumpRenderQueue();
  }

  pumpRenderQueue() {
    if (this.rendering || this.closed || !this.renderQueue.length) return;
    const id = this.renderQueue.shift();
    const job = this.jobs.get(id);
    if (!job) return this.pumpRenderQueue();
    this.rendering = { id, child: null };
    this.runRender(job)
      .then(async outputs => {
        job.outputs = outputs;
        job.state = 'ready';
        job.progress = 1;
        this.log(`${id} rendered ${outputs.map(o => o.name).join(', ')}`);
        if (job.render.tidy) {
          await fsp.rm(path.join(this.jobDir(id), 'frames'), { recursive: true, force: true });
          job.framesPruned = true;
        }
        try { this.onRendered(this.publicJob(job), outputs.map(o => path.join(this.outputDir(job), o.name))); } catch {}
      })
      .catch(err => {
        if (this.closed) return;
        if (job.state === 'captured') return; // cancelled by the user
        job.state = 'failed';
        job.error = `Render failed: ${String(err.message).slice(0, 300)}`;
        this.log(`${id} ${job.error}`);
      })
      .finally(async () => {
        this.rendering = null;
        if (this.jobs.has(id)) await this.save(job).catch(() => {});
        this.pumpRenderQueue();
      });
  }

  async runRender(job) {
    job.state = 'rendering';
    job.progress = 0;
    await this.save(job);
    const options = job.render;
    const workDir = path.join(this.jobDir(job.id), 'work');
    const outputDir = this.outputDir(job);
    await fsp.rm(workDir, { recursive: true, force: true });
    await fsp.mkdir(workDir, { recursive: true });
    await fsp.mkdir(outputDir, { recursive: true });

    const cameraSlots = new Map();
    for (const cameraId of job.cameras) cameraSlots.set(cameraId, await this.slots(job, cameraId));
    const available = job.cameras.filter(cameraId => cameraSlots.get(cameraId).length);
    // Night frames are needed to skip them, and to keep infrared frames out
    // of the colour balance.
    let night = new Map();
    if (options.skipNight || options.colour) night = await this.detectNight(job, cameraSlots, workDir);
    const gains = options.colour ? await this.measureColour(job, cameraSlots, night, workDir) : new Map();

    const plans = [];
    const grid = available.length > 1 && options.layout !== 'individual';
    const individual = available.length === 1 || options.layout !== 'grid';
    const date = new Date(job.capture.startedAt + job.tzOffsetMinutes * 60000).toISOString();
    const suffix = `${date.slice(0, 10)}-${date.slice(11, 16).replace(':', '')}`;
    // In a shared folder, never overwrite another timelapse's video.
    const owned = new Set((job.outputs || []).map(output => output.name));
    const name = base => {
      const plain = `${base}-${suffix}.mp4`;
      return !this.outputRoot || owned.has(plain) || !fs.existsSync(path.join(outputDir, plain))
        ? plain : `${base}-${suffix}-${job.id.slice(-4)}.mp4`;
    };
    if (grid) plans.push({ name: name('timelapse-grid'), camera: 'grid', cameras: available, grid: true });
    if (individual) {
      for (const cameraId of available) {
        const camera = this.cameras.find(item => item.id === cameraId);
        plans.push({ name: name(`timelapse-${slug(camera?.name || cameraId)}`), camera: cameraId, cameras: [cameraId], grid: false });
      }
    }

    for (const plan of plans) {
      plan.sequence = this.sequence(plan.cameras, cameraSlots, options.skipNight ? night : new Map());
    }
    const totalFrames = plans.reduce((sum, plan) => sum + plan.sequence.length, 0);
    if (!totalFrames) throw new Error(options.skipNight ? 'Every frame was a night frame. Render again without "Skip night".' : 'No frames to render.');

    const outputs = [];
    let done = 0;
    for (const plan of plans) {
      if (!plan.sequence.length) continue;
      const colourScripts = [];
      const lists = plan.cameras.map((cameraId, index) => {
        const file = path.join(workDir, `${plan.camera}-${index}.ffconcat`);
        const entries = plan.sequence.map((step, i) => ({
          file: this.framePath(job.id, cameraId, step.files[cameraId]),
          duration: ((plan.sequence[i + 1]?.slot ?? step.slot + 1) - step.slot) * job.intervalSec,
          gains: gains.get(cameraId)?.get(step.files[cameraId]),
        }));
        fs.writeFileSync(file, concatList(entries));
        if (entries.some(entry => entry.gains)) {
          const script = path.join(workDir, `${plan.camera}-${index}.cmd`);
          fs.writeFileSync(script, colourCommands(`colorchannelmixer@c${index}`,
            entries.map(entry => ({ duration: entry.duration, gains: entry.gains || [1, 1, 1] }))));
          colourScripts[index] = script;
        }
        return file;
      });
      const firstSlot = plan.sequence[0].slot;
      const epochOffset = (job.capture.startedAt + firstSlot * job.intervalSec * 1000) / 1000 + job.tzOffsetMinutes * 60;
      const upscale = !plan.grid && options.uhd ? { width: 3840, height: 2160 } : null;
      const { graph } = buildFilterGraph({
        inputs: plan.cameras.map((cameraId, index) => ({
          label: this.cameras.find(c => c.id === cameraId)?.name || cameraId,
          colourScript: colourScripts[index] || null,
        })),
        grid: plan.grid,
        fps: options.fps,
        deflicker: options.deflicker,
        // Blending neighbouring frames on top of the virtual shutter would
        // ghost moving people and cars; it is only for short-exposure frames.
        smooth: options.smooth && !(job.shutter?.frames > 1),
        upscale,
        timestamp: options.timestamp,
        labels: options.labels,
        epochOffset,
        fontFile: this.fontFile,
        canvasWidth: this.canvasWidth,
      });
      const temp = path.join(workDir, `${plan.camera}.part.mp4`);
      const args = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y'];
      for (const list of lists) args.push('-f', 'concat', '-safe', '0', '-i', list);
      // CRF 18 is visually transparent; the VBV ceiling stops noisy scenes
      // (foliage, night grain) from producing 200 Mbit/s files.
      const [maxrate, bufsize] = plan.grid || upscale ? ['80M', '160M'] : ['50M', '100M'];
      args.push('-filter_complex', graph, '-map', '[out]', '-an',
        '-c:v', 'libx264', '-preset', this.renderPreset, '-crf', '18', '-maxrate', maxrate, '-bufsize', bufsize,
        '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(options.fps));
      if (this.renderThreads) args.push('-threads', String(this.renderThreads));
      args.push('-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', temp);
      await runFfmpeg(this.ffmpeg, args, {
        lowPriority: this.lowPriority,
        onChild: child => { if (this.rendering) this.rendering.child = child; },
        onStdout: text => {
          const frames = [...text.matchAll(/^frame=(\d+)/gm)];
          if (frames.length) job.progress = Math.min(0.99, (done + Number(frames.at(-1)[1])) / totalFrames);
        },
      });
      if (this.jobs.get(job.id) !== job || job.state !== 'rendering') throw new Error('Render cancelled');
      const target = path.join(outputDir, plan.name);
      await moveFile(temp, target);
      const stat = await fsp.stat(target);
      const size = plan.grid ? gridGeometry(plan.cameras.length, this.canvasWidth)
        : upscale || jpegSize(this.framePath(job.id, plan.camera, plan.sequence[0].files[plan.camera]));
      outputs.push({
        name: plan.name,
        camera: plan.camera,
        frames: plan.sequence.length,
        durationSec: plan.sequence.length / options.fps,
        bytes: stat.size,
        width: size?.width ?? null,
        height: size?.height ?? null,
      });
      done += plan.sequence.length;
    }
    // Remove videos from an earlier render that this render did not replace.
    for (const old of job.outputs || []) {
      if (!outputs.some(output => output.name === old.name)) {
        await fsp.rm(path.join(outputDir, old.name), { force: true }).catch(() => {});
      }
    }
    await fsp.rm(workDir, { recursive: true, force: true });
    return outputs;
  }

  /**
   * One step per wall-clock slot that any listed camera captured. A camera
   * that missed a slot holds its most recent frame, so grid tiles stay in step.
   */
  sequence(cameraIds, cameraSlots, night) {
    const union = [...new Set(cameraIds.flatMap(id => cameraSlots.get(id)))].sort((a, b) => a - b);
    const cursors = new Map(cameraIds.map(id => [id, 0]));
    const steps = [];
    for (const slot of union) {
      const files = {};
      for (const id of cameraIds) {
        const slots = cameraSlots.get(id);
        let cursor = cursors.get(id);
        while (cursor + 1 < slots.length && slots[cursor + 1] <= slot) cursor += 1;
        cursors.set(id, cursor);
        files[id] = slots[cursor];
      }
      const nightVotes = cameraIds.filter(id => night.get(id)?.has(files[id])).length;
      if (nightVotes * 2 > cameraIds.length) continue;
      steps.push({ slot, files });
    }
    return steps;
  }

  /** Wyze cameras switch to monochrome IR at night; flag frames with no colour. */
  async detectNight(job, cameraSlots, workDir) {
    const result = new Map();
    for (const [cameraId, slots] of cameraSlots) {
      const flagged = new Set();
      result.set(cameraId, flagged);
      if (!slots.length) continue;
      const list = path.join(workDir, `night-${cameraId}.ffconcat`);
      fs.writeFileSync(list, concatList(slots.map(slot => ({ file: this.framePath(job.id, cameraId, slot), duration: 1 }))));
      const stderr = await runFfmpeg(this.ffmpeg, [
        '-nostdin', '-hide_banner', '-loglevel', 'info', '-lowres', '3',
        '-f', 'concat', '-safe', '0', '-i', list,
        '-vf', 'signalstats,metadata=mode=print:key=lavfi.signalstats.SATAVG', '-f', 'null', '-',
      ], { lowPriority: this.lowPriority });
      const values = [...stderr.matchAll(/lavfi\.signalstats\.SATAVG=([\d.]+)/g)].map(m => Number(m[1]));
      // Median of five neighbours: a headlight or the spotlight briefly adds
      // colour to an infrared frame, and one grey daytime frame is not night.
      const median = i => {
        const near = values.slice(Math.max(0, i - 2), i + 3).sort((a, b) => a - b);
        return near[Math.floor(near.length / 2)];
      };
      values.forEach((_, i) => { if (median(i) < NIGHT_SATURATION && i < slots.length) flagged.add(slots[i]); });
    }
    return result;
  }

  /**
   * Average colour of every frame (decoded at 1/8 size, averaged to one
   * pixel), turned into per-slot channel gains. Returns cameraId -> Map(slot -> gains).
   */
  async measureColour(job, cameraSlots, night, workDir) {
    const result = new Map();
    for (const [cameraId, slots] of cameraSlots) {
      if (!slots.length) continue;
      const list = path.join(workDir, `colour-${cameraId}.ffconcat`);
      fs.writeFileSync(list, concatList(slots.map(slot => ({ file: this.framePath(job.id, cameraId, slot), duration: 1 }))));
      const chunks = [];
      await runFfmpeg(this.ffmpeg, [
        '-nostdin', '-hide_banner', '-loglevel', 'error', '-lowres', '3',
        '-f', 'concat', '-safe', '0', '-i', list,
        '-vf', 'scale=1:1:flags=area,format=rgb24', '-f', 'rawvideo', 'pipe:1',
      ], { lowPriority: this.lowPriority, onData: data => chunks.push(data) });
      const bytes = Buffer.concat(chunks);
      const means = slots.map((_, i) => i * 3 + 2 < bytes.length ? [bytes[i * 3], bytes[i * 3 + 1], bytes[i * 3 + 2]] : null);
      const flagged = night.get(cameraId) || new Set();
      const ignore = new Set(slots.map((slot, i) => flagged.has(slot) ? i : -1).filter(i => i >= 0));
      const perSlot = new Map();
      colourGains(means, ignore).forEach((gains, i) => perSlot.set(slots[i], gains));
      result.set(cameraId, perSlot);
    }
    return result;
  }

  // ---- helpers ----------------------------------------------------------

  renderOptions(options = {}, cameraCount = 1) {
    const merged = { ...DEFAULT_RENDER, ...(options && typeof options === 'object' ? options : {}) };
    const fps = Number(merged.fps);
    return {
      fps: this.limits.fps.includes(fps) ? fps : DEFAULT_RENDER.fps,
      layout: cameraCount > 1 && LAYOUTS.includes(merged.layout) ? merged.layout : cameraCount > 1 ? 'grid' : 'individual',
      deflicker: merged.deflicker !== false,
      colour: merged.colour !== false,
      smooth: merged.smooth !== false,
      timestamp: merged.timestamp === true,
      labels: merged.labels !== false,
      skipNight: merged.skipNight !== false,
      uhd: merged.uhd === true,
      auto: merged.auto !== false,
      tidy: merged.tidy !== false,
    };
  }

  totalFrames(job) {
    return Object.values(job.capture.frames || {}).reduce((sum, n) => sum + n, 0);
  }

  async slots(job, cameraId) {
    try {
      const names = await fsp.readdir(path.join(this.jobDir(job.id), 'frames', cameraId));
      return names.map(name => FRAME_NAME.exec(name)).filter(Boolean).map(m => Number(m[1])).sort((a, b) => a - b);
    } catch { return []; }
  }

  framePath(id, cameraId, slot) {
    return path.join(this.jobDir(id), 'frames', cameraId, `${pad6(slot)}.jpg`);
  }

  jobDir(id) { return path.join(this.root, id); }

  require(id) {
    const job = typeof id === 'string' && JOB_ID.test(id) ? this.jobs.get(id) : null;
    if (!job) throw new UserError('Timelapse not found.', 404);
    return job;
  }

  /** Writes of one job are chained, each through its own temp file. */
  save(job) {
    const next = (this.saving.get(job.id) || Promise.resolve()).catch(() => {}).then(() => this.writeJob(job));
    this.saving.set(job.id, next);
    const clear = () => { if (this.saving.get(job.id) === next) this.saving.delete(job.id); };
    next.then(clear, clear);
    return next;
  }

  async writeJob(job) {
    if (this.jobs.get(job.id) !== job) return; // removed meanwhile
    const file = path.join(this.jobDir(job.id), 'job.json');
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.${++this.saveCount}.tmp`;
    await fsp.writeFile(temp, JSON.stringify(job, null, 2));
    await fsp.rename(temp, file);
  }

  publicJob(job) {
    const now = this.now();
    const frames = this.totalFrames(job);
    const perCamera = job.cameras.length ? frames / job.cameras.length : 0;
    const startedAt = job.capture.startedAt;
    const elapsed = startedAt ? Math.min(job.endAt, job.capture.stoppedAt || now) - startedAt : 0;
    return {
      id: job.id,
      name: job.name,
      cameras: job.cameras,
      state: job.state,
      manual: job.manual,
      intervalSec: job.intervalSec,
      shutter: job.shutter || { frames: 1, windowSec: 0 },
      startAt: job.startAt,
      endAt: job.endAt,
      startedAt,
      stoppedAt: job.capture.stoppedAt,
      elapsedSec: Math.max(0, Math.round(elapsed / 1000)),
      nextFrameInSec: job.state === 'capturing' && startedAt
        ? Math.max(0, Math.ceil(job.intervalSec - ((now - startedAt) / 1000) % job.intervalSec)) : null,
      frames: job.capture.frames,
      bytes: job.capture.bytes,
      estimatedVideoSec: perCamera / (job.render.fps || 30),
      reason: job.capture.reason,
      cameraErrors: job.capture.errors || {},
      render: job.render,
      progress: job.progress,
      outputs: job.outputs,
      framesPruned: Boolean(job.framesPruned),
      outputsShared: Boolean(this.outputRoot),
      error: job.error,
    };
  }
}

class UserError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// ---- HTTP -----------------------------------------------------------------

function readJson(req, limit = 16384) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > limit) { reject(new UserError('Request too large.', 413)); req.destroy(); }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch { reject(new UserError('Invalid JSON.')); }
    });
    req.on('error', reject);
  });
}

function sendFile(req, res, file, type, { download } = {}) {
  let stat;
  try { stat = fs.statSync(file); } catch { res.writeHead(404); res.end('Not found'); return; }
  const headers = {
    'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes',
  };
  if (download) headers['Content-Disposition'] = `attachment; filename="${path.basename(file)}"`;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
    let end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    if (start > end || start >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      res.end();
      return;
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

/**
 * Returns an async (req, res, url) => boolean handler for /api/timelapse routes.
 * Mutations must be same-origin JSON requests.
 */
function createTimelapseHandler(manager, { platform = process.platform === 'win32' ? 'windows' : 'linux' } = {}) {
  const json = (res, status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(value));
  };
  return async (req, res, url) => {
    if (url.pathname !== '/api/timelapse' && !url.pathname.startsWith('/api/timelapse/')) return false;
    try {
      const parts = url.pathname.split('/').slice(3).map(decodeURIComponent);
      const method = req.method;
      if (method !== 'GET' && method !== 'HEAD') {
        if (req.headers.origin) {
          let sameOrigin = false;
          try { sameOrigin = new URL(req.headers.origin).host === req.headers.host; } catch {}
          if (!sameOrigin) throw new UserError('Cross-origin request refused.', 403);
        }
        if (method === 'POST' && !/^application\/json(;|$)/i.test(req.headers['content-type'] || '')) {
          throw new UserError('Send JSON.', 415);
        }
      }
      const [id, action, arg] = parts;
      if (!id) {
        if (method === 'GET') return json(res, 200, { platform, ...manager.capabilities(), disk: await manager.disk(), jobs: manager.list() }), true;
        if (method === 'POST') return json(res, 201, await manager.create(await readJson(req))), true;
      } else if (!action) {
        if (method === 'GET') {
          const job = manager.get(id);
          return job ? json(res, 200, job) : json(res, 404, { error: 'Timelapse not found.' }), true;
        }
        if (method === 'DELETE') return await manager.remove(id), json(res, 200, { ok: true }), true;
      } else if (method === 'POST' && action === 'stop') {
        return json(res, 200, await manager.stop(id)), true;
      } else if (method === 'POST' && action === 'render') {
        return json(res, 202, await manager.render(id, (await readJson(req)).render)), true;
      } else if (method === 'POST' && action === 'prune') {
        return json(res, 200, await manager.prune(id)), true;
      } else if ((method === 'GET' || method === 'HEAD') && action === 'preview' && arg) {
        const file = await manager.latestFrame(id, arg);
        if (!file) return json(res, 404, { error: 'No frame yet.' }), true;
        return sendFile(req, res, file, 'image/jpeg'), true;
      } else if ((method === 'GET' || method === 'HEAD') && action === 'files' && arg) {
        const file = manager.outputPath(id, arg);
        if (!file) return json(res, 404, { error: 'File not found.' }), true;
        return sendFile(req, res, file, 'video/mp4', { download: url.searchParams.has('download') }), true;
      }
      json(res, 405, { error: 'Unsupported timelapse request.' });
    } catch (err) {
      if (!res.headersSent) json(res, err.status || 500, { error: err.status ? err.message : 'Timelapse request failed.' });
      if (!err.status) manager.log(`request failed: ${err.stack || err.message}`);
    }
    return true;
  };
}

/** First existing font from a list, for overlays. */
function findFont(candidates) {
  return candidates.find(file => { try { return fs.statSync(file).isFile(); } catch { return false; } }) || null;
}

module.exports = {
  TimelapseManager, createTimelapseHandler, buildFilterGraph, gridGeometry, concatList, findFont,
  snapInterval, shutterFrames, colourGains, colourCommands,
  LIMITS, DEFAULT_RENDER, UserError,
};
