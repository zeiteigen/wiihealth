import test from 'node:test';
import assert from 'node:assert/strict';
import {createLineSplitter, parseBandLine, bandCommand, createLive, ingestFrame, advanceLive} from '../band.js';
import {createSensor} from '../sensor.js';

// Exactly what firmware/sunroom_band/sunroom_band.ino prints with snprintf.
const frameLine = ({ax = 0.02, ay = -0.98, az = 0.11, hr = 78, o2 = 97, f = 1, n = 0, c = 0, fast = 0, m = 'w'} = {}) =>
  `{"ax":${ax.toFixed(2)},"ay":${ay.toFixed(2)},"az":${az.toFixed(2)},"hr":${hr},"o2":${o2},"f":${f},"n":${n},"c":${c.toFixed(1)},"fast":${fast},"m":"${m}"}`;
const context = {workout: 'walk', plan: {zone: [95, 115]}, profile: {rest: 72}};

test('lines are reassembled across chunk boundaries and CRLF', () => {
  const lines = [];
  const split = createLineSplitter(line => lines.push(line));
  split('ets Jun  8 2016 boot\r\n{"ax":0.1,');
  split('"ay":0,"az":1}\r\n\n{"ev":"hel');
  split('lo"}\n');
  assert.deepEqual(lines, ['ets Jun  8 2016 boot', '{"ax":0.1,"ay":0,"az":1}', '{"ev":"hello"}']);
});

test('firmware readings parse, and zero means no reading yet', () => {
  const f = parseBandLine(frameLine({hr: 0, o2: 0, f: 0, n: 12, c: 112.4, m: 'c'}));
  assert.equal(f.kind, 'frame');
  assert.equal(f.hr, null);
  assert.equal(f.o2, null);
  assert.equal(f.finger, false);
  assert.equal(f.n, 12);
  assert.equal(f.pace, 112.4);
  assert.equal(f.mode, 'cycle');
  const g = parseBandLine(frameLine({hr: 81, o2: 96, fast: 1, m: 'l'}));
  assert.equal(g.hr, 81);
  assert.equal(g.o2, 96);
  assert.equal(g.fast, true);
  assert.equal(g.mode, 'lift');
});

test('events parse and junk is ignored', () => {
  const hello = parseBandLine('{"ev":"hello","fw":"sunroom-band 1.0","name":"Sunroom Band 3A7F","mpu":1,"ppg":0,"ble":1,"m":"w"}');
  assert.equal(hello.kind, 'event');
  assert.equal(hello.ev, 'hello');
  assert.equal(hello.name, 'Sunroom Band 3A7F');
  assert.equal(hello.mpu, true);
  assert.equal(hello.ppg, false);
  for (const junk of ['', 'rst:0x1 (POWERON_RESET)', '{"ax":', '{"ax":"x","ay":0,"az":1}', '[1,2]', '{"ax":null,"ay":0,"az":1}'])
    assert.equal(parseBandLine(junk), null, junk);
});

test('commands are plain ASCII, single-line and short', () => {
  assert.equal(bandCommand('MODE', 'walk'), 'MODE walk');
  assert.equal(bandCommand('MSG'), 'MSG');
  assert.equal(bandCommand('NAME', 'Zoë\nRM -rf'), 'NAME ZoRM -rf');
  assert.ok(bandCommand('MSG', 'x'.repeat(80)).length <= 26);
});

test('new steps are counted from the band total, and resets resync without counting', () => {
  const live = createLive();
  ingestFrame(live, parseBandLine(frameLine({n: 40})), 0);
  assert.equal(live.reps, 0, 'the first reading only sets the baseline');
  ingestFrame(live, parseBandLine(frameLine({n: 42})), 40);
  ingestFrame(live, parseBandLine(frameLine({n: 42})), 80);
  assert.equal(live.reps, 2);
  ingestFrame(live, parseBandLine(frameLine({n: 0})), 120);   // START on the band
  ingestFrame(live, parseBandLine(frameLine({n: 1})), 160);
  assert.equal(live.reps, 3);
  ingestFrame(live, parseBandLine(frameLine({n: 500})), 200); // after lost readings, at most 10 at once
  assert.equal(live.reps, 13);
});

test('live readings drive heart, oxygen and pace, and unknown readings are flagged', () => {
  const sim = createSensor(), live = createLive();
  sim.moving = true;
  for (let i = 0; i < 200; i++) {
    ingestFrame(live, parseBandLine(frameLine({hr: 104, o2: 96, n: 2 * Math.floor(i / 12), c: 110})), i * 40);
    advanceLive(sim, live, .04, context);
  }
  assert.ok(Math.abs(sim.hr - 104) < 1, sim.hr);
  assert.ok(Math.abs(sim.spo2 - 96) < 1, sim.spo2);
  assert.equal(sim.cad, 110);
  assert.equal(sim.hrOk, true);
  assert.ok(sim.phase > 0);
  ingestFrame(live, parseBandLine(frameLine({hr: 0, o2: 0, f: 0})), 9000);
  advanceLive(sim, live, .04, context);
  assert.equal(sim.hrOk, false);
  assert.equal(sim.o2Ok, false);
  for (const key of ['hr', 'spo2', 'ax', 'ay', 'az', 'phase', 't']) assert.ok(Number.isFinite(sim[key]), key);
});

test('demo safety events still work on top of real readings', () => {
  const sim = createSensor(), live = createLive();
  sim.moving = true;
  const run = (seconds, hr = 100, o2 = 98) => {
    for (let i = 0; i < seconds * 25; i++) { ingestFrame(live, parseBandLine(frameLine({hr, o2})), 0); advanceLive(sim, live, .04, context); }
  };
  run(3);
  sim.ev.spo2 = 14;
  run(8);
  assert.ok(sim.spo2 < 92, `oxygen dip reached ${sim.spo2}`);
  sim.ev.spo2 = 0;
  run(8);
  assert.ok(sim.spo2 > 97, 'returns to the band reading');
  sim.ev.hr = 18;
  run(10);
  assert.ok(sim.hr > 115 + 15, `heart spike reached ${sim.hr}`);
  sim.ev.hr = 0;
  run(8, 0, 0);   // band has no pulse: oxygen and heart unknown, but they still settle
  assert.equal(sim.hrOk, false);
  assert.ok(sim.hr < 100);
});

test('stillness comes from real motion, and pausing never counts as stillness', () => {
  const sim = createSensor(), live = createLive();
  sim.moving = true;
  const feed = (seconds, wobble) => {
    for (let i = 0; i < seconds * 25; i++) {
      const s = wobble ? Math.sin(i / 3) * wobble : 0;
      ingestFrame(live, parseBandLine(frameLine({ax: s, ay: -0.98 + s / 2, az: 0.1})), 0);
      advanceLive(sim, live, .04, context);
    }
  };
  feed(3, 0.4);
  assert.ok(sim.t - sim.lastMove < .1, 'moving');
  feed(6, 0);
  assert.ok(sim.t - sim.lastMove > 5, 'still for the last few seconds');
  sim.moving = false;   // paused or resting
  feed(1, 0);
  assert.ok(sim.t - sim.lastMove < .1);
  const values = sim.trace.flat();
  assert.ok(values.every(Number.isFinite));
  assert.ok(Math.abs(sim.trace.at(-1)[1]) < .2, 'trace is centred on the resting position');
});

test('lifts use the band timing for tempo', () => {
  const sim = createSensor(), live = createLive(), lift = {...context, workout: 'lift'};
  sim.moving = true;
  ingestFrame(live, parseBandLine(frameLine({n: 0, m: 'l'})), 0);
  ingestFrame(live, parseBandLine(frameLine({n: 1, c: 3.2, m: 'l'})), 40);
  assert.equal(advanceLive(sim, live, .04, lift), 1);
  assert.equal(sim.tempo, 3.2);
  ingestFrame(live, parseBandLine(frameLine({n: 1, c: 0, fast: 1, m: 'l'})), 80);
  assert.equal(advanceLive(sim, live, .04, lift), 0);
  assert.equal(sim.tempo, 3.2, 'tempo holds between lifts');
  assert.equal(sim.fast, true);
});
