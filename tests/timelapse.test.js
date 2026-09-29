'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { spawnSync } = require('node:child_process');
const {
  TimelapseManager, createTimelapseHandler, buildFilterGraph, gridGeometry, concatList, findFont,
  snapInterval, shutterFrames, colourGains, colourCommands,
} = require('../lib/timelapse');

const ffmpegAvailable = spawnSync('ffmpeg', ['-version'], { windowsHide: true }).status === 0;
const font = findFont([
  'C:/Windows/Fonts/arialbd.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
]);
const cameras = [{ id: 'colour', name: 'Front Garden' }, { id: 'mono', name: "Bob's Office" }];

function probe(file) {
  const result = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries',
    'stream=codec_name,profile,width,height,r_frame_rate,nb_read_frames', '-of', 'json', file], { windowsHide: true });
  assert.equal(result.status, 0, String(result.stderr));
  return JSON.parse(result.stdout).streams[0];
}

function manager(root, extra = {}) {
  return new TimelapseManager({
    root, cameras, fontFile: font, canvasWidth: 640, renderPreset: 'veryfast', minFreeBytes: 0,
    // lavfi test sources make every frame a keyframe, at 10 fps.
    limits: { minIntervalSec: 0.2 }, keyframeSec: 0.1, log: () => {},
    // Synthetic cameras: a colour test pattern and a monochrome "night IR" one.
    inputArgs: camera => ['-re', '-f', 'lavfi', '-i',
      `testsrc2=size=320x180:rate=10${camera.id === 'mono' ? ',hue=s=0' : ''}`],
    ...extra,
  });
}

async function waitFor(fn, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Timed out waiting for condition');
}

test('grid geometry keeps 16:9 tiles with no empty space for 2-4 cameras', () => {
  const size = g => [g.width, g.height];
  const four = gridGeometry(4);
  assert.deepEqual(size(four), [3840, 2160]);
  assert.deepEqual(four.tiles.map(t => `${t.x}_${t.y}_${t.w}x${t.h}`), ['0_0_1920x1080', '1920_0_1920x1080', '0_1080_1920x1080', '1920_1080_1920x1080']);
  assert.deepEqual(size(gridGeometry(2)), [3840, 1080]);
  const three = gridGeometry(3);
  assert.deepEqual(size(three), [3840, 1440]);
  assert.deepEqual(three.tiles.map(t => `${t.x}_${t.y}_${t.w}x${t.h}`), ['0_0_2560x1440', '2560_0_1280x720', '2560_720_1280x720']);
  const area = three.tiles.reduce((sum, t) => sum + t.w * t.h, 0);
  assert.equal(area, three.width * three.height, 'three tiles cover the whole frame');
  assert.equal(gridGeometry(6).width, 3840);
});

test('filter graph escapes labels and fonts and composes the grid', () => {
  const { graph } = buildFilterGraph({
    inputs: [{ label: "Bob's: [Office]" }, { label: 'B' }, { label: 'C' }, { label: 'D' }],
    grid: true, fps: 30, deflicker: true, smooth: true, timestamp: true, labels: true,
    epochOffset: 1790000000, fontFile: 'C:\\Windows\\Fonts\\arial.ttf', canvasWidth: 3840,
  });
  assert.match(graph, /xstack=inputs=4:layout=0_0\|1920_0\|0_1080\|1920_1080/);
  assert.match(graph, /fontfile=C\\\\:\/Windows\/Fonts\/arial.ttf/);
  assert.doesNotMatch(graph, /Bob's/);
  assert.match(graph, /deflicker/);
  assert.match(graph, /tmix=frames=3/);
  assert.match(graph, /setpts=N\/30\/TB/);
  const single = buildFilterGraph({ inputs: [{ label: 'A' }], grid: false, fps: 24, fontFile: null, timestamp: true });
  assert.doesNotMatch(single.graph, /drawtext|xstack|scale/);
});

test('intervals snap to whole keyframes and the virtual shutter covers half the interval', () => {
  assert.deepEqual([2, 3, 5, 7, 16, 57.6].map(s => snapInterval(s)), [2, 4, 6, 8, 16, 58]);
  assert.equal(snapInterval(0.5, 0.1), 0.5);
  assert.equal(snapInterval(1.5, 2), 1.5, 'below one keyframe the interval is kept');
  // 2-4 s: one keyframe; 16 s: 4 keyframes = 8 s; long intervals cap at 8.
  assert.deepEqual([2, 4, 6, 10, 16, 30, 300].map(s => shutterFrames(s)), [1, 1, 2, 3, 4, 8, 8]);
  assert.equal(shutterFrames(16, 0), 1);
});

test('colour gains steady the white balance but keep brightness, slow drifts and night frames', () => {
  const steady = [[120, 100, 80], [120, 100, 80], [150, 100, 60], [120, 100, 80], [120, 100, 80]];
  const gains = colourGains(steady);
  assert.deepEqual(gains[0], [1, 1, 1], 'neighbours of the jump are untouched');
  const [r, g, b] = gains[2];
  assert.ok(r < 1 && b > 1, `warm jump is cooled: ${gains[2]}`);
  const luma = ([mr, mg, mb], [kr, kg, kb] = [1, 1, 1]) => 0.2126 * mr * kr + 0.7152 * mg * kg + 0.0722 * mb * kb;
  assert.ok(Math.abs(luma(steady[2], gains[2]) - luma(steady[2])) < 0.01, 'brightness is unchanged');
  // A steady colour needs no correction, and dark or ignored frames are left alone.
  assert.deepEqual(colourGains([[90, 100, 110], [90, 100, 110]]), [[1, 1, 1], [1, 1, 1]]);
  assert.deepEqual(colourGains([[5, 5, 5], [90, 100, 110], null], new Set([1])), [[1, 1, 1], [1, 1, 1], [1, 1, 1]]);
  // Corrections are capped.
  const capped = colourGains([[100, 100, 100], [100, 100, 100], [250, 100, 20], [100, 100, 100], [100, 100, 100]])[2];
  assert.ok(Math.abs(capped[0] / capped[1] - 0.85) < 1e-3 && Math.abs(capped[2] / capped[1] - 1.18) < 1e-3, String(capped));
});

test('colour commands fire once per change, half a frame early', () => {
  const script = colourCommands('colorchannelmixer@c0', [
    { duration: 2, gains: [1, 1, 1] }, { duration: 2, gains: [1, 1, 1] }, { duration: 4, gains: [0.9, 1, 1.1] },
  ]);
  assert.equal(script,
    '0.000 [enter] colorchannelmixer@c0 rr 1, [enter] colorchannelmixer@c0 gg 1, [enter] colorchannelmixer@c0 bb 1;\n' +
    '3.000 [enter] colorchannelmixer@c0 rr 0.9, [enter] colorchannelmixer@c0 gg 1, [enter] colorchannelmixer@c0 bb 1.1;\n');
});

test('filter graph applies colour scripts before deflicker and upscales single videos', () => {
  const { graph } = buildFilterGraph({
    inputs: [{ label: 'A', colourScript: "C:\\tl\\it's.cmd" }], grid: false, fps: 25, deflicker: true, upscale: { width: 3840, height: 2160 },
  });
  assert.ok(graph.startsWith(String.raw`[0:v]sendcmd=f=C\\:/tl/it\\\'s.cmd,colorchannelmixer@c0=rr=1:gg=1:bb=1,format=yuv420p,deflicker`), graph);
  assert.match(graph, /scale=3840:2160:flags=lanczos/);
});

test('concat lists quote paths safely', () => {
  assert.equal(concatList([{ file: "C:\\it's\\1.jpg", duration: 10 }]),
    "ffconcat version 1.0\nfile 'C:/it'\\''s/1.jpg'\nduration 10.000\n");
});

test('job validation enforces the 24-hour maximum and camera list', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wyze-tl-validate-'));
  const tl = manager(root, { limits: {} });
  await tl.init();
  t.after(async () => { await tl.close(); fs.rmSync(root, { recursive: true, force: true }); });
  await assert.rejects(tl.create({ cameras: [], intervalSec: 10, durationSec: 60 }), /at least one camera/);
  await assert.rejects(tl.create({ cameras: ['nope'], intervalSec: 10, durationSec: 60 }), /Unknown camera/);
  await assert.rejects(tl.create({ cameras: ['colour'], intervalSec: 1, durationSec: 60 }), /interval/);
  await assert.rejects(tl.create({ cameras: ['colour'], intervalSec: 10, durationSec: 24 * 3600 + 1 }), /24 hours/);
  const scheduled = await tl.create({ cameras: ['colour', 'mono'], intervalSec: 10, durationSec: 3600,
    startAt: Date.now() + 3600e3, render: { layout: 'both', fps: 60 } });
  assert.equal(scheduled.state, 'scheduled');
  assert.equal(scheduled.render.layout, 'both');
  const manual = await tl.create({ cameras: ['colour'], intervalSec: 10, startAt: Date.now() + 60e3 });
  assert.equal(manual.manual, true);
  assert.equal(manual.endAt - manual.startAt, 24 * 3600 * 1000);
  assert.equal(manual.render.layout, 'individual');
  assert.equal((await tl.stop(scheduled.id)).state, 'cancelled');
  // Recommended defaults.
  assert.deepEqual(
    (({ fps, deflicker, colour, smooth, skipNight, uhd, timestamp }) => ({ fps, deflicker, colour, smooth, skipNight, uhd, timestamp }))(manual.render),
    { fps: 25, deflicker: true, colour: true, smooth: true, skipNight: true, uhd: false, timestamp: false });
});

test('jobs on 2-second keyframe cameras use even intervals and a half-interval shutter', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wyze-tl-shutter-'));
  const tl = manager(root, { limits: {}, keyframeSec: 2 });
  await tl.init();
  t.after(async () => { await tl.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const later = Date.now() + 3600e3;
  const odd = await tl.create({ cameras: ['colour'], intervalSec: 5, durationSec: 600, startAt: later });
  assert.equal(odd.intervalSec, 6);
  assert.deepEqual(odd.shutter, { frames: 2, windowSec: 4 });
  const long = await tl.create({ cameras: ['colour'], intervalSec: 16, durationSec: 600, startAt: later });
  assert.deepEqual(long.shutter, { frames: 4, windowSec: 8 });
  const off = await tl.create({ cameras: ['colour'], intervalSec: 16, durationSec: 600, startAt: later, shutter: false });
  assert.deepEqual(off.shutter, { frames: 1, windowSec: 0 });
  assert.equal(tl.capabilities().defaults.shutter, true);
});

test('overlapping ticks and saves do not race', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wyze-tl-race-'));
  const tl = manager(root, { limits: {} });
  await tl.init();
  t.after(async () => { await tl.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const job = await tl.create({ cameras: ['colour'], intervalSec: 10, durationSec: 600, startAt: Date.now() + 3600e3 });
  const internal = tl.jobs.get(job.id);
  await Promise.all(Array.from({ length: 20 }, (_, i) => { internal.name = `n${i}`; return tl.save(internal); }));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, job.id, 'job.json'), 'utf8')).name, 'n19');
  assert.deepEqual(fs.readdirSync(path.join(root, job.id)).filter(f => f.endsWith('.tmp')), []);
  await Promise.all([tl.tick(), tl.tick(), tl.tick()]);
});

test('captures aligned frames, renders grid and per-camera H.264, and skips night frames', { skip: !ffmpegAvailable, timeout: 120000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wyze-tl-e2e-'));
  const tl = manager(root);
  await tl.init();
  t.after(async () => { await tl.close(); fs.rmSync(root, { recursive: true, force: true }); });

  const job = await tl.create({
    cameras: ['colour', 'mono'], intervalSec: 0.5, durationSec: 3, tzOffsetMinutes: 60,
    render: { layout: 'both', fps: 24, timestamp: true, labels: true, tidy: false, skipNight: false },
  });
  assert.equal(job.state, 'capturing');
  const ready = await waitFor(() => ['ready', 'failed'].includes(tl.get(job.id).state) && tl.get(job.id));
  assert.equal(ready.state, 'ready', ready.error);
  assert.ok(ready.frames.colour >= 3, `colour frames ${ready.frames.colour}`);
  assert.ok(ready.frames.mono >= 3, `mono frames ${ready.frames.mono}`);
  assert.equal(ready.outputs.length, 3);

  const preview = await tl.latestFrame(job.id, 'colour');
  assert.equal(fs.readFileSync(preview).subarray(0, 2).toString('hex'), 'ffd8');

  const gridOut = ready.outputs.find(o => o.camera === 'grid');
  const grid = probe(tl.outputPath(job.id, gridOut.name));
  assert.equal(grid.codec_name, 'h264');
  assert.equal(grid.profile, 'High');
  assert.deepEqual([grid.width, grid.height], [640, 180]);
  assert.equal(grid.r_frame_rate, '24/1');
  assert.equal(Number(grid.nb_read_frames), gridOut.frames);
  const single = probe(tl.outputPath(job.id, ready.outputs.find(o => o.camera === 'colour').name));
  assert.deepEqual([single.width, single.height], [320, 180]);
  const singleOut = ready.outputs.find(o => o.camera === 'colour');
  assert.deepEqual([singleOut.width, singleOut.height], [320, 180]);

  // Re-render: the monochrome camera is all "night", so only colour remains.
  await tl.render(job.id, { layout: 'individual', skipNight: true, timestamp: false });
  const rerendered = await waitFor(() => ['ready', 'failed'].includes(tl.get(job.id).state) && tl.get(job.id));
  assert.equal(rerendered.state, 'ready', rerendered.error);
  assert.deepEqual(rerendered.outputs.map(o => o.camera), ['colour']);
  const files = fs.readdirSync(path.join(root, job.id, 'output'));
  assert.deepEqual(files, [rerendered.outputs[0].name], 'stale outputs removed');

  await tl.prune(job.id);
  assert.equal(fs.existsSync(path.join(root, job.id, 'frames')), false);
  await assert.rejects(tl.render(job.id), /deleted/);
});

test('three cameras render the large-plus-two layout; videos go to a shared folder and frames are tidied', { skip: !ffmpegAvailable, timeout: 90000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wyze-tl-shared-'));
  const downloads = path.join(root, 'Downloads');
  const rendered = [];
  const tl = manager(root + '/frames', {
    outputRoot: downloads,
    cameras: [...cameras, { id: 'third', name: 'Third' }],
    onRendered: (job, files) => rendered.push({ job, files }),
  });
  await tl.init();
  t.after(async () => { await tl.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const job = await tl.create({ cameras: ['colour', 'mono', 'third'], intervalSec: 0.5, durationSec: 2, render: { fps: 24 } });
  const ready = await waitFor(() => ['ready', 'failed'].includes(tl.get(job.id).state) && tl.get(job.id));
  assert.equal(ready.state, 'ready', ready.error);
  assert.equal(ready.render.tidy, true);
  assert.equal(ready.framesPruned, true);
  assert.equal(fs.existsSync(path.join(root, 'frames', job.id, 'frames')), false);
  const [output] = ready.outputs;
  assert.equal(output.camera, 'grid');
  const video = path.join(downloads, output.name);
  assert.equal(tl.outputPath(job.id, output.name), video);
  const stream = probe(video);
  // canvasWidth 640: one 426x240 tile and two 214x120 tiles.
  assert.deepEqual([stream.width, stream.height], [640, 240]);
  assert.equal(rendered.length, 1);
  assert.deepEqual(rendered[0].files, [video]);
  await tl.remove(job.id);
  assert.ok(fs.existsSync(video), 'videos in the shared folder are kept');
});

test('capture resumes after a restart and keeps wall-clock slots', { skip: !ffmpegAvailable, timeout: 60000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wyze-tl-resume-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const first = manager(root);
  await first.init();
  const job = await first.create({ cameras: ['colour'], intervalSec: 0.5, durationSec: 6, render: { auto: false } });
  await waitFor(() => first.get(job.id).frames.colour >= 2);
  await first.close();
  const before = fs.readdirSync(path.join(root, job.id, 'frames', 'colour')).length;

  const second = manager(root);
  await second.init();
  t.after(() => second.close());
  const done = await waitFor(() => second.get(job.id).state === 'captured' && second.get(job.id));
  const after = fs.readdirSync(path.join(root, job.id, 'frames', 'colour')).filter(f => f.endsWith('.jpg'));
  assert.ok(after.length > before, `${after.length} > ${before}`);
  assert.equal(done.frames.colour, after.length);
  assert.equal(new Set(after).size, after.length);
});

test('HTTP API validates requests, blocks cross-origin writes and serves ranges', { timeout: 30000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wyze-tl-http-'));
  const tl = manager(root, { limits: {} });
  await tl.init();
  const handle = createTimelapseHandler(tl, { platform: 'linux' });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (!(await handle(req, res, url))) { res.writeHead(404); res.end(); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
    await tl.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}/api/timelapse`;
  const post = (url, body, headers = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

  const listing = await (await fetch(base)).json();
  assert.equal(listing.platform, 'linux');
  assert.equal(listing.limits.maxDurationSec, 86400);
  assert.deepEqual(listing.cameras.map(c => c.id), ['colour', 'mono']);

  assert.equal((await post(base, {}, { Origin: 'http://evil.invalid' })).status, 403);
  assert.equal((await fetch(base, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal((await post(base, { cameras: ['colour'], intervalSec: 1 })).status, 400);
  const created = await post(base, { cameras: ['colour'], intervalSec: 10, durationSec: 60, startAt: Date.now() + 60e3 });
  assert.equal(created.status, 201);
  const job = await created.json();
  assert.equal((await fetch(`${base}/${job.id}`)).status, 200);
  assert.equal((await fetch(`${base}/..%2F..%2Fetc`)).status, 404);
  assert.equal((await fetch(`${base}/${job.id}/files/..%2Fjob.json`)).status, 404);
  assert.equal((await fetch(`${base}/${job.id}/preview/colour`)).status, 404);

  // Serve a fake finished output with byte ranges.
  const internal = tl.jobs.get(job.id);
  fs.mkdirSync(path.join(root, job.id, 'output'));
  fs.writeFileSync(path.join(root, job.id, 'output', 'timelapse-x.mp4'), Buffer.from('0123456789'));
  internal.outputs = [{ name: 'timelapse-x.mp4', camera: 'colour' }];
  const ranged = await fetch(`${base}/${job.id}/files/timelapse-x.mp4`, { headers: { Range: 'bytes=2-5' } });
  assert.equal(ranged.status, 206);
  assert.equal(await ranged.text(), '2345');
  const download = await fetch(`${base}/${job.id}/files/timelapse-x.mp4?download=1`);
  assert.match(download.headers.get('content-disposition'), /attachment/);
  await download.arrayBuffer();

  assert.equal((await fetch(`${base}/${job.id}`, { method: 'DELETE' })).status, 200);
  assert.equal(fs.existsSync(path.join(root, job.id)), false);
});
