'use strict';

const { app, BrowserWindow, shell, ipcMain } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { generate, GO2RTC_DIR, ROOT } = require('../scripts/generate-go2rtc-config');

let PORT = 8765;
const PORT_CANDIDATES = [8765, 8766, 8767, 8768];
const GO2RTC_BIN = path.join(GO2RTC_DIR, process.platform === 'win32' ? 'go2rtc.exe' : 'go2rtc');
const GO2RTC_CONFIG = path.join(GO2RTC_DIR, 'go2rtc.yaml');
const GO2RTC_API = 'http://127.0.0.1:1984';
const GO2RTC_WS = 'ws://127.0.0.1:1984/api/ws';

// Wyze Cam v4: stream0 is 2560x1440@20, stream1 is 640x360@20, both H.264 High.
// Nothing is transcoded, so these are the camera's own numbers.
const qualities = {
  main: { suffix: '_main', label: 'HD' },
  sub: { suffix: '_sub', label: 'Eco' },
};

let mainWindow;
let server;
let go2rtc = null;
let go2rtcRestarts = 0;
let shuttingDown = false;
let appConfig = null;
let playbackReport = { updatedAt: null, cameras: [] };

function log(...args) { console.log('[monitor]', ...args); }

function get(url, timeout = 2500) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.setTimeout(timeout, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function go2rtcAlive() {
  try {
    return (await get(`${GO2RTC_API}/api/streams`)).status === 200;
  } catch { return false; }
}

async function waitForGo2rtc(attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    if (await go2rtcAlive()) return true;
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

async function startGo2rtc() {
  if (await go2rtcAlive()) {
    log('go2rtc already running - reusing existing instance');
    return true;
  }
  if (!fs.existsSync(GO2RTC_BIN)) {
    log(`go2rtc binary not found at ${GO2RTC_BIN}`);
    log('Run scripts/setup.ps1 (or download go2rtc into the go2rtc/ folder).');
    return false;
  }

  log('starting go2rtc');
  go2rtc = spawn(GO2RTC_BIN, ['-config', GO2RTC_CONFIG], {
    cwd: GO2RTC_DIR,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  go2rtc.stdout.on('data', d => process.stdout.write(`[go2rtc] ${d}`));
  go2rtc.stderr.on('data', d => process.stderr.write(`[go2rtc] ${d}`));
  go2rtc.on('error', err => { log(`go2rtc failed to start: ${err.message}`); go2rtc = null; });
  go2rtc.on('exit', code => {
    go2rtc = null;
    if (shuttingDown) return;
    // Restart with backoff so a crash does not black out every tile.
    go2rtcRestarts += 1;
    const delay = Math.min(30000, 1000 * 2 ** Math.min(go2rtcRestarts - 1, 5));
    log(`go2rtc exited (code ${code}); restarting in ${delay / 1000}s`);
    setTimeout(() => { if (!shuttingDown) startGo2rtc(); }, delay);
  });

  const ok = await waitForGo2rtc();
  if (ok) go2rtcRestarts = 0;
  log(ok ? 'go2rtc ready' : 'go2rtc did not become ready in time');
  return ok;
}

function stopGo2rtc() {
  if (!go2rtc || go2rtc.killed) return;
  const pid = go2rtc.pid;
  try { go2rtc.kill(); } catch {}
  // go2rtc spawns child FFmpeg processes - make sure none are orphaned.
  if (process.platform === 'win32') {
    try { spawn('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true }); } catch {}
  }
  go2rtc = null;
}

function serveFile(res, filePath, type) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

function createServer() {
  const files = {
    '/': ['renderer.html', 'text/html'],
    '/styles.css': ['styles.css', 'text/css'],
    '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
    '/renderer.js': ['renderer.js', 'application/javascript'],
    '/smooth30.js': ['smooth30.js', 'application/javascript'],
    '/vendor/video-rtc.js': ['vendor/video-rtc.js', 'application/javascript'],
  };

  const next = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    // Local numeric diagnostics only: no camera images, URLs or credentials.
    if (url.pathname === '/api/playback' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(playbackReport));
      return;
    }
    if (url.pathname === '/api/playback' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 16384) req.destroy();
      });
      req.on('end', () => {
        try {
          const report = JSON.parse(body);
          if (!Array.isArray(report) || report.length > appConfig.cameras.length) throw new Error('Invalid report');
          const safe = report.map(row => {
            if (!appConfig.cameras.some(camera => camera.id === row.camera)) throw new Error('Unknown camera');
            const fields = Object.fromEntries(Object.entries(row).filter(([key, value]) =>
              key !== '__proto__' && (typeof value === 'number' && Number.isFinite(value) || typeof value === 'boolean')));
            return { ...fields, camera: row.camera,
              decoder: typeof row.decoder === 'string' ? row.decoder.slice(0, 100) : 'unknown' };
          });
          playbackReport = { updatedAt: new Date().toISOString(), cameras: safe };
          res.writeHead(204);
          res.end();
        } catch {
          res.writeHead(400);
          res.end('Invalid playback report');
        }
      });
      return;
    }

    if (files[url.pathname]) {
      const [name, type] = files[url.pathname];
      return serveFile(res, path.join(__dirname, name), type);
    }

    if (url.pathname === '/api/config') {
      // Only what the UI needs - never credentials.
      const cameras = appConfig.cameras.map(c => ({ id: c.id, name: c.name, ip: c.ip }));
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({
        cameras,
        qualities,
        defaultQuality: appConfig.defaultQuality,
        go2rtcWs: GO2RTC_WS,
      }));
      return;
    }

    if (url.pathname === '/api/health') {
      const alive = await go2rtcAlive();
      let streams = {};
      if (alive) {
        try { streams = JSON.parse((await get(`${GO2RTC_API}/api/streams`)).body); } catch {}
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ go2rtc: alive, streams: Object.keys(streams) }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  return new Promise((resolve, reject) => {
    const tryListen = i => {
      if (i >= PORT_CANDIDATES.length) {
        reject(new Error(
          `Could not start the local dashboard server: every candidate port is already in use ` +
          `(${PORT_CANDIDATES.join(', ')}). Another application on this PC has taken them. ` +
          `Close it, or free one of these ports, then restart Wyze Monitor.`
        ));
        return;
      }
      const port = PORT_CANDIDATES[i];
      const onError = err => {
        next.removeListener('error', onError);
        if (err.code === 'EADDRINUSE') {
          log(`port ${port} is already in use, trying the next candidate`);
          tryListen(i + 1);
        } else {
          reject(err);
        }
      };
      next.once('error', onError);
      next.listen(port, '127.0.0.1', () => {
        next.removeListener('error', onError);
        PORT = port;
        resolve(next);
      });
    };
    tryListen(0);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1800,
    height: 1050,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: '#070a0e',
    title: 'Wyze Monitor',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  mainWindow.maximize();
  mainWindow.loadURL(`http://127.0.0.1:${PORT}/`);
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(appConfig?.ffmpeg || 'ffmpeg', args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    ffmpeg.stderr.on('data', data => { stderr += data.toString(); });
    ffmpeg.on('error', reject);
    ffmpeg.on('close', code => code === 0 ? resolve() : reject(new Error(stderr.slice(-1200) || `FFmpeg exited with ${code}`)));
  });
}

function fatal(message) {
  console.error(`\n${message}\n`);
  const { dialog } = require('electron');
  dialog.showErrorBox('Wyze Monitor - configuration error', message);
  app.exit(1);
}

ipcMain.handle('open-external', async (_e, url) => shell.openExternal(url));
ipcMain.handle('save-recording', async (_e, payload) => {
  if (!payload || !payload.buffer) throw new Error('Recording data was empty.');
  const downloads = path.join(app.getPath('downloads'), 'Wyze Monitor');
  fs.mkdirSync(downloads, { recursive: true });
  const safeName = String(payload.filename || 'wyze-monitor-recording.mp4').replace(/[^a-zA-Z0-9._-]/g, '_');
  const output = path.join(downloads, safeName.endsWith('.mp4') ? safeName : `${safeName}.mp4`);
  const temp = path.join(app.getPath('temp'), `wyze-monitor-${Date.now()}.webm`);
  const bytes = Buffer.from(payload.buffer);
  fs.writeFileSync(temp, bytes);
  try {
    await runFfmpeg(['-y', '-i', temp, '-an', '-vf', 'format=yuv420p', '-r', '30', '-fps_mode', 'cfr', '-c:v', 'libx264', '-preset', 'veryfast', '-movflags', '+faststart', output]);
  } finally {
    try { fs.unlinkSync(temp); } catch {}
  }
  log(`saved recording ${output}`);
  return { path: output };
});

app.whenReady().then(async () => {
  try {
    // Regenerate go2rtc.yaml from cameras.yaml so the two never drift.
    const { config } = generate();
    appConfig = config;
    log(`loaded ${config.cameras.length} cameras from cameras.yaml`);
  } catch (err) {
    return fatal(err.message);
  }

  await startGo2rtc();
  try {
    server = await createServer();
  } catch (err) {
    return fatal(err.message);
  }
  createWindow();
});

function shutdown() {
  shuttingDown = true;
  stopGo2rtc();
  if (server) server.close();
}

app.on('before-quit', shutdown);
app.on('window-all-closed', () => {
  shutdown();
  if (process.platform !== 'darwin') app.quit();
});
