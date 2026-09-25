'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

test('Pi HTTP routes expose only public metadata and reflect upstream health', { timeout: 15000 }, async t => {
  const root = path.resolve(__dirname, '..');
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'wyze-server-test-'));
  let child;
  let upstream;
  t.after(async () => {
    if (child && child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    if (upstream) {
      upstream.closeAllConnections();
      await new Promise(resolve => upstream.close(resolve));
    }
    fs.rmSync(fixture, { recursive: true, force: true });
  });
  for (const dir of ['scripts', 'raspberry-pi', 'src', 'lib']) fs.mkdirSync(path.join(fixture, dir));
  for (const file of ['scripts/generate-go2rtc-config.js', 'raspberry-pi/server.js', 'raspberry-pi/recordings.js', 'lib/timelapse.js']) {
    fs.copyFileSync(path.join(root, file), path.join(fixture, file));
  }
  fs.writeFileSync(path.join(fixture, 'src/renderer.html'), '<!doctype html><title>Dummy test</title>');
  const dummyPassword = 'PRIVATE_TEST_VALUE_ONLY';
  fs.writeFileSync(path.join(fixture, 'cameras.yaml'), JSON.stringify({
    cameras: [{ id: 'test', name: 'Test', ip: '192.0.2.10', user: 'PRIVATE_TEST_USER', password: dummyPassword }],
  }));
  let upstreamStatus = 200;
  upstream = http.createServer((req, res) => {
    res.writeHead(upstreamStatus, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ test_main: { producer: dummyPassword }, test_sub: {} }));
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  child = spawn(process.execPath, ['raspberry-pi/server.js'], {
    cwd: fixture,
    env: { ...process.env, NODE_PATH: path.join(root, 'node_modules'), PORT: '0',
      GO2RTC_HOST: '127.0.0.1', GO2RTC_API_PORT: String(upstream.address().port), DEFAULT_QUALITY: 'main',
      TIMELAPSE_DIR: path.join(fixture, 'timelapses') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const port = await new Promise((resolve, reject) => {
    let output = '';
    child.on('error', reject);
    child.on('exit', code => reject(new Error('server exited before readiness: ' + code)));
    child.stdout.on('data', data => {
      output += data;
      const match = output.match(/listening on (\d+);/);
      if (match) resolve(Number(match[1]));
    });
  });
  const base = 'http://127.0.0.1:' + port;
  const configResponse = await fetch(base + '/api/config');
  const configText = await configResponse.text();
  assert.ok(!configText.includes(dummyPassword));
  assert.ok(!configText.includes('PRIVATE_TEST_USER'));
  const config = JSON.parse(configText);
  assert.equal(config.defaultQuality, 'main');
  assert.equal(config.recording.mp4, true);
  assert.equal(config.go2rtcWs, 'ws://127.0.0.1:' + port + '/api/ws');
  assert.deepEqual(Object.keys(config.cameras[0]).sort(), ['id', 'ip', 'name']);
  const healthResponse = await fetch(base + '/api/health');
  const healthText = await healthResponse.text();
  assert.equal(healthResponse.status, 200);
  assert.ok(!healthText.includes(dummyPassword));
  assert.deepEqual(JSON.parse(healthText).streams, ['test_main', 'test_sub']);
  upstreamStatus = 503;
  assert.equal((await fetch(base + '/api/health')).status, 503);
  for (const route of ['/cameras.yaml', '/.env', '/api/streams', '/runtime/go2rtc.yaml']) {
    assert.equal((await fetch(base + route)).status, 404);
  }
  let timelapse;
  for (let i = 0; i < 50 && timelapse?.status !== 200; i++) {
    timelapse = await fetch(base + '/api/timelapse');
    if (timelapse.status !== 200) await new Promise(resolve => setTimeout(resolve, 50));
  }
  const timelapseText = await timelapse.text();
  assert.equal(timelapse.status, 200);
  assert.ok(!timelapseText.includes(dummyPassword));
  assert.ok(!timelapseText.includes('PRIVATE_TEST_USER'));
  assert.equal(JSON.parse(timelapseText).platform, 'pi');
  assert.equal((await fetch(base + '/timelapse-ui.js')).status, 404, 'fixture has no UI file');
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
});
