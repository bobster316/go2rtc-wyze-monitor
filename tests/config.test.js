'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const YAML = require('yaml');
const { buildYaml } = require('../scripts/generate-go2rtc-config');

function fixture() {
  return {
    ffmpeg: 'ffmpeg', port: 322, tls: true,
    streams: { main: 'stream0', sub: 'stream1' },
    cameras: [
      { id: 'entrance', name: 'Entrance', ip: '192.0.2.10', user: 'demo@user', password: 'dummy:p@ss/word?=+' },
      { id: 'garden', name: 'Garden', ip: '192.0.2.11', user: 'demo', password: 'dummy-only' },
    ],
  };
}

test('all cameras get independent main/sub stream-copy sources with encoded credentials', () => {
  const config = fixture();
  const result = YAML.parse(buildYaml(config));
  assert.deepEqual(Object.keys(result.streams), ['entrance_main', 'entrance_sub', 'garden_main', 'garden_sub']);
  const source = result.streams.entrance_main;
  assert.ok(source.includes(encodeURIComponent(config.cameras[0].password)));
  assert.ok(source.includes('rtsps://demo%40user:'));
  assert.ok(source.includes('@192.0.2.10:322/stream0/'));
  assert.ok(!source.includes(config.cameras[0].password));
  assert.match(source, /-an -c:v copy -f rtsp \{output\}$/);
  assert.match(source, /-protocol_whitelist tcp,tls,rtsp/);
  assert.ok(!source.includes('-vf'));
  assert.match(result.streams.garden_sub, /\/stream1\//);
});

test('Windows management sockets stay on loopback', () => {
  const result = YAML.parse(buildYaml(fixture()));
  assert.equal(result.api.listen, '127.0.0.1:1984');
  assert.equal(result.rtsp.listen, '127.0.0.1:8554');
  assert.deepEqual(result.webrtc.candidates, ['127.0.0.1:8555']);
});

test('Pi overrides advertise its selected media port without transcoding', () => {
  const result = YAML.parse(buildYaml(fixture(), {
    apiListen: ':1984', rtspListen: '127.0.0.1:8554',
    webrtcListen: ':8555', candidates: ['192.0.2.100:18555'],
  }));
  assert.equal(result.api.listen, ':1984');
  assert.equal(result.rtsp.listen, '127.0.0.1:8554');
  assert.deepEqual(result.webrtc.candidates, ['192.0.2.100:18555']);
  for (const source of Object.values(result.streams)) assert.match(source, /-c:v copy/);
});
