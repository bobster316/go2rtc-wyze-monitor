'use strict';

const fs = require('fs');
const path = require('path');
const { loadConfig, buildYaml } = require('../scripts/generate-go2rtc-config');

const host = process.env.PI_HOST_IP;
const publicPort = Number(process.env.WEBRTC_PUBLIC_PORT || 18555);
const output = path.join(__dirname, 'runtime', 'go2rtc.yaml');

if (!host) throw new Error('PI_HOST_IP is required.');
if (!Number.isInteger(publicPort) || publicPort < 1024 || publicPort > 65535) {
  throw new Error('WEBRTC_PUBLIC_PORT must be from 1024 to 65535.');
}

const config = loadConfig();
config.ffmpeg = 'ffmpeg';
const yaml = buildYaml(config, {
  apiListen: ':1984',
  rtspListen: '127.0.0.1:8554',
  webrtcListen: ':8555',
  candidates: [`${host}:${publicPort}`],
});

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, yaml, { encoding: 'utf8', mode: 0o600 });
console.log(`Generated Pi config for ${config.cameras.length} camera(s).`);
