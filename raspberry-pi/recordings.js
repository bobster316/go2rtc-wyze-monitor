'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const MAX_BYTES = 512 * 1024 * 1024;

function createRecordingHandler({ directory = process.env.RECORDING_TMP_DIR || path.join(os.tmpdir(), 'wyze-recordings'), maxBytes = MAX_BYTES, timeoutMs = 20 * 60 * 1000 } = {}) {
  let busy = false;
  return async (req, res) => {
    const fail = (status, message) => {
      if (!res.destroyed && !res.headersSent) {
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: message }));
      }
    };
    if (req.method !== 'POST') return fail(405, 'Use POST to save a recording.');
    // Disallow cross-origin browser uploads to this trusted-LAN service.
    if (req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== req.headers.host) return fail(403, 'Cross-origin recording upload refused.'); }
      catch { return fail(403, 'Invalid origin.'); }
    }
    if (!/^video\/(webm|mp4)(;|$)/i.test(req.headers['content-type'] || '')) return fail(415, 'Upload a WebM or MP4 recording.');
    const length = Number(req.headers['content-length']);
    if (Number.isFinite(length) && length > maxBytes) return fail(413, 'Recording exceeds the 512 MB conversion limit.');
    if (busy) return fail(409, 'Another recording is being saved. Try again after it finishes.');
    busy = true;
    let folder, child, aborted = false;
    const abort = () => { aborted = true; child?.kill(); };
    res.on('close', abort);
    const timer = setTimeout(abort, timeoutMs);
    try {
      await fsp.mkdir(directory, { recursive: true });
      folder = await fsp.mkdtemp(path.join(directory, 'clip-'));
      const input = path.join(folder, 'capture');
      const output = path.join(folder, 'recording.mp4');
      let bytes = 0;
      const limit = new Transform({ transform(chunk, encoding, callback) {
        bytes += chunk.length;
        callback(bytes > maxBytes ? new Error('Recording too large') : null, chunk);
      } });
      await pipeline(req, limit, fs.createWriteStream(input, { mode: 0o600 }));
      if (!bytes || aborted) throw new Error('Empty or interrupted recording');
      await new Promise((resolve, reject) => {
        child = spawn('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
          '-max_alloc', '67108864', '-protocol_whitelist', 'file,pipe',
          '-format_whitelist', 'matroska,webm,mov,mp4,m4a,3gp,3g2,mj2',
          '-threads', '1', '-i', input, '-map', '0:v:0', '-an',
          '-filter_threads', '1', '-vf', 'format=yuv420p', '-r', '30', '-fps_mode', 'cfr',
          '-c:v', 'libx264', '-threads', '1', '-preset', 'veryfast',
          '-movflags', '+faststart', '-fs', String(maxBytes), output],
        { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
        child.stderr.resume();
        child.on('spawn', () => {
          if (aborted) return child.kill();
          if (process.platform !== 'win32') {
            try { os.setPriority(child.pid, os.constants.priority.PRIORITY_LOW); } catch {}
          }
        });
        child.on('error', reject);
        child.on('close', code => code === 0 && !aborted ? resolve() : reject(new Error('Conversion failed')));
      });
      const stat = await fsp.stat(output);
      if (stat.size >= maxBytes || aborted) throw new Error('Output limit exceeded');
      res.writeHead(200, {
        'Content-Type': 'video/mp4', 'Content-Length': stat.size,
        'Content-Disposition': 'attachment; filename="wyze-monitor-recording.mp4"',
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      });
      await pipeline(fs.createReadStream(output), res);
    } catch {
      fail(422, 'Could not create MP4. The original recording is available in your browser.');
    } finally {
      clearTimeout(timer);
      res.removeListener('close', abort);
      if (folder) await fsp.rm(folder, { recursive: true, force: true }).catch(() => {});
      busy = false;
    }
  };
}

module.exports = { createRecordingHandler, MAX_BYTES };
