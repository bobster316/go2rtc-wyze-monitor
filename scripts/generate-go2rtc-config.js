'use strict';

/**
 * Builds go2rtc/go2rtc.yaml from cameras.yaml.
 *
 * go2rtc's own RTSP client cannot complete the TLS handshake with Wyze cameras,
 * so every stream is defined as an `exec:` source that runs FFmpeg directly.
 * RTSP cameras use stream copy. HTTP MJPEG webcams are encoded to H.264 on
 * the monitoring host, keeping their source resolution and arrival timing.
 * See docs/TROUBLESHOOTING.md for why the v4 needs the FFmpeg source.
 *
 * Run standalone:  node scripts/generate-go2rtc-config.js
 * The Electron app also calls this on startup, so config stays in sync.
 */

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'cameras.yaml');
const EXAMPLE_PATH = path.join(ROOT, 'cameras.example.yaml');
const GO2RTC_DIR = path.join(ROOT, 'go2rtc');
const OUTPUT_PATH = path.join(GO2RTC_DIR, 'go2rtc.yaml');

// FFmpeg flags that make RTSPS work. -protocol_whitelist must include `tls`
// or the connection dies with a read timeout.
const FFMPEG_ARGS = [
  '-hide_banner',
  '-loglevel error',
  '-fflags nobuffer',
  '-flags low_delay',
  '-rtsp_transport tcp',
  '-protocol_whitelist tcp,tls,rtsp',
].join(' ');

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(
      `cameras.yaml not found.\n\n` +
      `  Copy the example and fill in your camera details:\n` +
      `      copy "${path.relative(process.cwd(), EXAMPLE_PATH)}" "${path.relative(process.cwd(), CONFIG_PATH)}"\n`
    );
  }

  const config = YAML.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

  if (!config || !Array.isArray(config.cameras) || config.cameras.length === 0) {
    throw new Error('cameras.yaml has no `cameras:` entries.');
  }

  const ids = new Set();
  config.cameras.forEach((cam, i) => {
    for (const field of (cam.url ? ['id', 'name', 'ip'] : ['id', 'name', 'ip', 'user', 'password'])) {
      if (!cam[field]) throw new Error(`cameras.yaml: camera #${i + 1} is missing "${field}".`);
    }
    if (!/^[a-z0-9_]+$/.test(cam.id)) {
      throw new Error(`cameras.yaml: id "${cam.id}" must be lowercase letters, numbers, underscores only.`);
    }
    if (ids.has(cam.id)) throw new Error(`cameras.yaml: duplicate id "${cam.id}".`);
    ids.add(cam.id);
    if (cam.password === 'CHANGE_ME') {
      throw new Error(`cameras.yaml: camera "${cam.id}" still has the placeholder password.`);
    }
    validateCamera(cam);
  });

  return {
    ffmpeg: config.ffmpeg || 'ffmpeg',
    defaultQuality: config.defaultQuality === 'sub' ? 'sub' : 'main',
    port: config.port || 322,
    tls: config.tls !== false,
    streams: { main: 'stream0', sub: 'stream1', ...(config.streams || {}) },
    cameras: config.cameras,
  };
}

function cameraUrl(config, cam, streamPath) {
  const scheme = (cam.tls ?? config.tls) ? 'rtsps' : 'rtsp';
  // The password goes into a URL, so percent-encode it. Wyze passwords
  // commonly contain "=" and other characters that must be escaped.
  const user = encodeURIComponent(cam.user);
  const pass = encodeURIComponent(cam.password);
  return `${scheme}://${user}:${pass}@${cam.ip}:${cam.port ?? config.port}/${streamPath}${cam.streams ? '' : '/'}`;
}

function validateCamera(cam) {
  if (cam.port !== undefined && (!Number.isInteger(cam.port) || cam.port < 1 || cam.port > 65535)) {
    throw new Error(`Camera "${cam.id}" has an invalid port.`);
  }
  if (cam.tls !== undefined && typeof cam.tls !== 'boolean') throw new Error(`Camera "${cam.id}" has invalid tls.`);
  if (cam.url) {
    let url;
    try { url = new URL(cam.url); } catch { throw new Error(`Camera "${cam.id}" has an invalid URL.`); }
    if (!['http:', 'https:'].includes(url.protocol) || cam.type !== 'mjpeg' || /[\s"'\\<>`|$;&()]/.test(cam.url)) {
      throw new Error(`Camera "${cam.id}" requires a safe HTTP(S) MJPEG URL and type: mjpeg.`);
    }
  } else if (cam.type && cam.type !== 'rtsp') {
    throw new Error(`Camera "${cam.id}" requires a URL for MJPEG.`);
  }
  if (cam.streams && (typeof cam.streams.main !== 'string' || !cam.streams.main ||
      Object.values(cam.streams).some(value => typeof value !== 'string' || !/^[a-zA-Z0-9_./-]+$/.test(value)))) {
    throw new Error(`Camera "${cam.id}" has invalid stream paths.`);
  }
}

function buildYaml(config, overrides = {}) {
  const ffmpeg = config.ffmpeg.replace(/\\/g, '/');
  const streams = {};

  for (const cam of config.cameras) {
    validateCamera(cam);
    if (cam.url) {
      // Preserve the webcam's source size and cadence; encode only on demand.
      streams[`${cam.id}_main`] = `exec:${ffmpeg} -hide_banner -loglevel error -fflags nobuffer -use_wallclock_as_timestamps 1 -i ${cam.url} -an -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p -crf 18 -g 30 -fps_mode vfr -f rtsp {output}`;
      streams[`${cam.id}_sub`] = `rtsp://127.0.0.1:8554/${cam.id}_main`;
      continue;
    }
    const paths = cam.streams ? { main: cam.streams.main, sub: cam.streams.sub ?? cam.streams.main } : config.streams;
    for (const [quality, streamPath] of Object.entries(paths)) {
      if (quality === 'sub' && streamPath === paths.main) {
        streams[`${cam.id}_sub`] = `rtsp://127.0.0.1:8554/${cam.id}_main`;
        continue;
      }
      const url = cameraUrl(config, cam, streamPath);
      streams[`${cam.id}_${quality}`] =
        `exec:${ffmpeg} ${FFMPEG_ARGS} -i ${url} -an -c:v copy -f rtsp {output}`;
    }
  }

  const doc = {
    api: { listen: overrides.apiListen || '127.0.0.1:1984', origin: '*' },
    rtsp: { listen: overrides.rtspListen || '127.0.0.1:8554' },
    webrtc: {
      listen: overrides.webrtcListen || ':8555',
      candidates: overrides.candidates || ['127.0.0.1:8555'],
    },
    log: { level: 'info' },
    streams,
  };

  const header =
    '# GENERATED FILE - do not edit.\n' +
    '# Built from cameras.yaml by scripts/generate-go2rtc-config.js\n' +
    '# This file contains your camera passwords and is gitignored.\n\n';

  return header + YAML.stringify(doc, { lineWidth: 0, singleQuote: true });
}

function generate() {
  const config = loadConfig();
  fs.mkdirSync(GO2RTC_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, buildYaml(config), 'utf8');
  return { config, outputPath: OUTPUT_PATH };
}

module.exports = { generate, loadConfig, buildYaml, OUTPUT_PATH, GO2RTC_DIR, ROOT };

if (require.main === module) {
  try {
    const { config, outputPath } = generate();
    const n = config.cameras.length;
    console.log(`Wrote ${outputPath}`);
    console.log(`  ${n} camera${n === 1 ? '' : 's'}, ${n * Object.keys(config.streams).length} streams`);
  } catch (err) {
    console.error(`\n${err.message}\n`);
    process.exit(1);
  }
}
