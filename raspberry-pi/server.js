'use strict';

const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { loadConfig } = require('../scripts/generate-go2rtc-config');
const { createRecordingHandler, MAX_BYTES } = require('./recordings');
const { TimelapseManager, createTimelapseHandler, findFont } = require('../lib/timelapse');
const handleRecording = createRecordingHandler();

const PORT = Number(process.env.PORT || 8765);
const UPSTREAM_HOST = process.env.GO2RTC_HOST || 'go2rtc';
const UPSTREAM_PORT = Number(process.env.GO2RTC_API_PORT || 1984);
const SRC = path.resolve(__dirname, '..', 'src');
const config = loadConfig();
const RTSP_PORT = Number(process.env.GO2RTC_RTSP_PORT || 8554);
// Captures run in this container, so they continue with no browser open.
const timelapse = new TimelapseManager({
  root: process.env.TIMELAPSE_DIR || path.join(require('os').tmpdir(), 'wyze-timelapses'),
  cameras: config.cameras,
  sourceUrl: stream => `rtsp://${UPSTREAM_HOST}:${RTSP_PORT}/${stream}`,
  fontFile: findFont([process.env.TIMELAPSE_FONT, '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'].filter(Boolean)),
  // No hardware H.264 encoder on a Pi 5: leave a core for go2rtc and the web server.
  renderPreset: process.env.TIMELAPSE_PRESET || 'medium',
  renderThreads: Number(process.env.TIMELAPSE_THREADS || Math.max(1, require('os').cpus().length - 1)),
  lowPriority: true,
});
const handleTimelapse = createTimelapseHandler(timelapse, { platform: 'pi' });
let timelapseReady = false;
const qualities = {
  main: { suffix: '_main', label: 'HD' },
  sub: { suffix: '_sub', label: 'Eco' },
};
const requestedQuality = process.env.DEFAULT_QUALITY || config.defaultQuality;
const defaultQuality = requestedQuality === 'main' ? 'main' : 'sub';
const files = {
  '/': ['renderer.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/renderer.js': ['renderer.js', 'application/javascript; charset=utf-8'],
  '/smooth30.js': ['smooth30.js', 'application/javascript; charset=utf-8'],
  '/timelapse-ui.js': ['timelapse-ui.js', 'application/javascript; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
  '/vendor/video-rtc.js': ['vendor/video-rtc.js', 'application/javascript; charset=utf-8'],
};

function responseHeaders(type) {
  return {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  };
}

function sendJson(res, status, value) {
  res.writeHead(status, responseHeaders('application/json; charset=utf-8'));
  res.end(JSON.stringify(value));
}

function getStreams() {
  return new Promise((resolve, reject) => {
    const request = http.get({
      host: UPSTREAM_HOST, port: UPSTREAM_PORT, path: '/api/streams',
    }, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    request.setTimeout(2500, () => request.destroy(new Error('timeout')));
    request.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/recordings') return handleRecording(req, res);
  if (timelapseReady && await handleTimelapse(req, res, url)) return;
  // Shared viewer diagnostics remain local to the browser on the Pi deployment.
  if (url.pathname === '/api/playback' && req.method === 'POST') {
    req.resume();
    res.writeHead(204);
    res.end();
    return;
  }
  if (files[url.pathname]) {
    const [relative, type] = files[url.pathname];
    fs.readFile(path.join(SRC, relative), (err, content) => {
      if (err) {
        res.writeHead(404, responseHeaders('text/plain'));
        res.end('Not found');
      } else {
        res.writeHead(200, responseHeaders(type));
        res.end(content);
      }
    });
    return;
  }

  if (url.pathname === '/api/config') {
    const wsProtocol = req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';
    sendJson(res, 200, {
      cameras: config.cameras.map(({ id, name, ip }) => ({ id, name, ip })),
      qualities,
      defaultQuality,
      go2rtcWs: `${wsProtocol}://${req.headers.host}/api/ws`,
      platform: process.arch,
      recording: { mp4: true, maxBytes: MAX_BYTES },
    });
    return;
  }

  if (url.pathname === '/api/health') {
    try {
      const result = await getStreams();
      const streams = result.status === 200 ? Object.keys(JSON.parse(result.body)) : [];
      sendJson(res, result.status === 200 ? 200 : 503, {
        go2rtc: result.status === 200,
        streams,
        cameras: config.cameras.length,
        defaultQuality,
        architecture: process.arch,
      });
    } catch (err) {
      sendJson(res, 503, { go2rtc: false, error: err.message });
    }
    return;
  }

  res.writeHead(404, responseHeaders('text/plain'));
  res.end('Not found');
});

// Proxy only the player WebSocket. The go2rtc management API stays off the LAN.
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/api/ws') {
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    return;
  }
  const upstream = net.connect(UPSTREAM_PORT, UPSTREAM_HOST, () => {
    upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`);
    for (const [name, value] of Object.entries(req.headers)) {
      const forwarded = name === 'host' ? `${UPSTREAM_HOST}:${UPSTREAM_PORT}` : value;
      if (name !== 'proxy-connection') upstream.write(`${name}: ${forwarded}\r\n`);
    }
    upstream.write('\r\n');
    if (head.length) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Wyze Monitor listening on ${server.address().port}; ${process.arch}; default ${defaultQuality}.`);
});
timelapse.init()
  .then(() => { timelapseReady = true; })
  .catch(err => console.error(`Timelapse unavailable: ${err.message}`));

function shutdown() {
  // Leave captures marked active so they resume when the container restarts.
  timelapse.close().catch(() => {}).finally(() => server.close(() => process.exit(0)));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
