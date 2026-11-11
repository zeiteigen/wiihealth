import test from 'node:test';
import assert from 'node:assert/strict';
import {createSensor, advanceSensor, frameDelta} from '../sensor.js';

test('frame timing rejects invalid and backward timestamps and caps a tab-resume gap', () => {
  assert.equal(frameDelta(NaN, 100), 0);
  assert.equal(frameDelta(100, undefined), 0);
  assert.equal(frameDelta(90, 100), 0);
  assert.equal(frameDelta(100000, 100), .1);
  assert.equal(frameDelta(116, 100), .016);
});

for (const workout of ['walk', 'cycle', 'lift']) {
  test(`${workout}: readings stay finite through activity, a safety dip, rest, and recovery`, () => {
    const sensor = createSensor();
    const context = {workout, plan:{zone:[95,115]}, profile:{rest:72}, hasSession:true, onDetect:() => {}};
    sensor.moving = true;
    for (let i=0;i<6000;i++) advanceSensor(sensor, .02, context);
    assert.ok(sensor.hr >= 95 && sensor.hr <= 115);
    sensor.ev.spo2 = 14;
    for (let i=0;i<400;i++) advanceSensor(sensor, .02, context);
    assert.ok(sensor.spo2 < 92);
    sensor.ev.spo2 = 0; sensor.moving = false; sensor.recovering = true;
    for (let i=0;i<800;i++) advanceSensor(sensor, .02, context);
    assert.ok(sensor.spo2 >= 94);
    for (const key of ['hr','spo2','ax','ay','az','phase','t']) assert.ok(Number.isFinite(sensor[key]), key);
  });
}

test('invalid state recovers to real numerical readings rather than displaying NaN', () => {
  const sensor = createSensor();
  for (const key of ['hr','spo2','t','phase','effort','userEff','cad']) sensor[key] = NaN;
  const context = {workout:'walk',plan:{zone:[95,115]},profile:{rest:72},hasSession:true,onDetect:() => {}};
  advanceSensor(sensor, .02, context);
  assert.ok(Number.isFinite(sensor.hr));
  assert.ok(Number.isFinite(sensor.spo2));
  assert.ok(Number.isFinite(sensor.ax));
  for (const dt of [-1, NaN, Infinity, 0]) advanceSensor(sensor, dt, context);
  assert.ok(Number.isFinite(sensor.hr));
  assert.ok(sensor.spo2 >= 94 && sensor.spo2 <= 99.4);
});
