// Live link to the Sunroom Band (firmware/sunroom_band). The band sends one JSON
// reading per line, 25 times a second, over USB serial or Bluetooth LE (Nordic
// UART Service); the TV sends short text commands back. See firmware/README.md.
import {repairReadings} from './sensor.js?v=main9';

export const NUS = {
  service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  rx: '6e400002-b5a3-f393-e0a9-e50e24dcca9e',  // TV writes commands here
  tx: '6e400003-b5a3-f393-e0a9-e50e24dcca9e'   // band notifies readings here
};
export const BAUD = 115200;
export const STALE_MS = 2500;       // no reading for this long: fall back to the simulation
const BLE_CHUNK = 20;               // safe write size before MTU negotiation
const MOTION_G = 0.05;              // movement threshold for the stillness check
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function createLineSplitter(onLine, maxLength = 512) {
  let buffer = '';
  return chunk => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (line) onLine(line);
    }
    if (buffer.length > maxLength) buffer = '';  // runaway line: drop it
  };
}

const finite = v => typeof v === 'number' && Number.isFinite(v);
const MODE_CODES = {w: 'walk', c: 'cycle', l: 'lift'};

// Returns {kind:'frame', ...}, {kind:'event', ...}, or null for anything else
// (boot messages, partial lines).
export function parseBandLine(line) {
  if (typeof line !== 'string' || line[0] !== '{') return null;
  let m;
  try { m = JSON.parse(line); } catch { return null; }
  if (!m || typeof m !== 'object') return null;
  const mode = MODE_CODES[m.m] || null;
  if (typeof m.ev === 'string') {
    return {kind: 'event', ev: m.ev, msg: typeof m.msg === 'string' ? m.msg : '', name: typeof m.name === 'string' ? m.name : '',
      fw: typeof m.fw === 'string' ? m.fw : '', mpu: m.mpu !== 0, ppg: m.ppg !== 0, mode};
  }
  if (!finite(m.ax) || !finite(m.ay) || !finite(m.az)) return null;
  return {
    kind: 'frame', ax: m.ax, ay: m.ay, az: m.az,
    hr: finite(m.hr) && m.hr >= 30 && m.hr <= 230 ? m.hr : null,
    o2: finite(m.o2) && m.o2 >= 70 && m.o2 <= 100 ? m.o2 : null,
    finger: m.f === 1,
    n: finite(m.n) && m.n >= 0 ? Math.floor(m.n) : null,
    pace: finite(m.c) && m.c > 0 ? m.c : 0,
    fast: m.fast === 1,
    mode
  };
}

export function bandCommand(verb, arg = '') {
  const text = String(arg).replace(/[^\x20-\x7e]/g, '').trim().slice(0, 22);
  return text ? `${verb} ${text}` : verb;
}

/* ---------- live readings into the shared sensor state ---------- */
export function createLive() {
  return {at: -Infinity, frames: 0, count: null, reps: 0, samples: [], hr: null, o2: null, finger: false,
    pace: 0, fast: false, mode: null, gravity: null, centre: null};
}

export function ingestFrame(live, frame, now) {
  live.at = now; live.frames++;
  live.hr = frame.hr; live.o2 = frame.o2; live.finger = frame.finger;
  live.pace = frame.pace; live.fast = frame.fast; live.mode = frame.mode;
  live.samples.push([frame.ax, frame.ay, frame.az]);
  if (live.samples.length > 50) live.samples.shift();
  if (frame.n !== null) {
    // The count only grows; a smaller one means START, MODE or a reboot reset it.
    if (live.count !== null && frame.n > live.count) live.reps += Math.min(frame.n - live.count, 10);
    live.count = frame.n;
  }
}

// Advance the sensor state with the band's readings instead of the simulation.
// Demo safety events still work on top of real readings. Returns the number of
// new steps, pedal turns or lifts to count.
export function advanceLive(sim, live, dt, {workout, plan, profile}) {
  if (!Number.isFinite(dt) || dt <= 0) return 0;
  dt = Math.min(dt, .1);
  repairReadings(sim, profile.rest);
  sim.t += dt;

  for (const v of live.samples) {
    if (!live.gravity) { live.gravity = v.slice(); live.centre = v.slice(); }
    const g = live.gravity, c = live.centre;
    const moved = Math.hypot(v[0] - g[0], v[1] - g[1], v[2] - g[2]) > MOTION_G;
    for (let k = 0; k < 3; k++) { g[k] += (v[k] - g[k]) * .08; c[k] += (v[k] - c[k]) * .015; }
    [sim.ax, sim.ay, sim.az] = v;
    // The trace shows movement around the band's resting position, whichever way it is worn.
    sim.trace.push([v[0] - c[0], v[1] - c[1], v[2] - c[2] + 1]);
    if (sim.trace.length > 170) sim.trace.shift();
    if (moved && !sim.ev.still) sim.lastMove = sim.t;
  }
  live.samples.length = 0;
  if (!sim.moving) sim.lastMove = sim.t;

  let hrT = live.hr, hrTau = 1.2, o2T = live.o2, o2Tau = 1.5;
  if (sim.ev.hr > 0) { hrT = plan.zone[1] + 36; hrTau = 3; sim.ev.hr -= dt; }
  else if (sim.ev.overdo > 0) { hrT = Math.max(hrT ?? 0, plan.zone[1] + 8); hrTau = 4; sim.ev.overdo -= dt; }
  if (sim.ev.spo2 > 0) { o2T = 87.5; o2Tau = 2.2; sim.ev.spo2 -= dt; }
  sim.hrOk = hrT !== null; sim.o2Ok = o2T !== null;
  if (hrT === null) { hrT = profile.rest + 4; hrTau = 5; }   // unknown: shown as "--", drifts to resting
  if (o2T === null) { o2T = 97.3; o2Tau = 5; }
  sim.hr = clamp(sim.hr + (hrT - sim.hr) * Math.min(1, dt / hrTau), 40, 200);
  sim.spo2 = clamp(sim.spo2 + (o2T - sim.spo2) * Math.min(1, dt / o2Tau), 80, 99.4);

  if (workout === 'lift') { if (live.pace > 0) sim.tempo = live.pace; }
  else sim.cad = live.pace;
  sim.fast = live.fast;
  const lifting = workout === 'lift' && sim.tempo > 0 && sim.t - sim.lastRep < sim.tempo * 1.5;
  const freq = workout === 'lift' ? (lifting ? 1 / sim.tempo : 0) : sim.cad / 60;
  if (sim.moving && !sim.ev.still) sim.phase += 2 * Math.PI * freq * dt;

  const reps = live.reps; live.reps = 0;
  return reps;
}

/* ---------- transports ---------- */
export class BandLink {
  constructor({onMessage, onChange}) {
    this.onMessage = onMessage; this.onChange = onChange;
    this.state = 'off'; this.via = null;
    this.queue = Promise.resolve();
    this.encoder = new TextEncoder();
  }

  static support() {
    const nav = typeof navigator === 'undefined' ? {} : navigator;
    return {usb: 'serial' in nav, bluetooth: 'bluetooth' in nav};
  }

  async connect(via) {
    if (this.state !== 'off') await this.disconnect();
    this.closing = false;
    this.set('connecting', via);
    this.split = createLineSplitter(line => { const m = parseBandLine(line); if (m) this.onMessage(m); });
    try {
      if (via === 'usb') await this.openSerial(); else await this.openBluetooth();
    } catch (error) {
      await this.teardown();
      this.set('off', null, error);
      throw error;
    }
    this.set('on', via);
    this.send('HELLO');
  }

  async disconnect() {
    this.closing = true;
    await this.teardown();
    this.set('off', null);
  }

  send(verb, arg) {
    if (this.state !== 'on') return;
    const bytes = this.encoder.encode(bandCommand(verb, arg) + '\n');
    this.queue = this.queue.then(() => this.write(bytes)).catch(() => {});
  }

  set(state, via, reason) {
    this.state = state; this.via = via;
    this.onChange?.(state, via, reason);
  }

  async openSerial() {
    const port = await navigator.serial.requestPort();
    await port.open({baudRate: BAUD});
    // Both lines released: ESP32 boards use DTR/RTS for reset and boot mode.
    try { await port.setSignals({dataTerminalReady: false, requestToSend: false}); } catch {}
    this.port = port;
    this.openedAt = performance.now();
    this.writer = port.writable.getWriter();
    this.reading = this.readSerial(port);
  }

  async readSerial(port) {
    const decoder = new TextDecoder();
    while (this.port === port && port.readable) {
      const reader = port.readable.getReader();
      this.reader = reader;
      try {
        for (;;) {
          const {value, done} = await reader.read();
          if (done) break;
          this.split(decoder.decode(value, {stream: true}));
        }
      } catch {
        // A framing error leaves port.readable usable; an unplugged band clears it.
      } finally {
        reader.releaseLock();
      }
    }
    if (this.port === port && !this.closing) this.lost();
  }

  async openBluetooth() {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{services: [NUS.service]}, {namePrefix: 'Sunroom'}], optionalServices: [NUS.service]
    });
    this.device = device;
    device.addEventListener('gattserverdisconnected', () => { if (this.device === device && !this.closing) this.reconnect(device); });
    await this.attachGatt(device);
  }

  async attachGatt(device) {
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(NUS.service);
    const tx = await service.getCharacteristic(NUS.tx);
    this.rx = await service.getCharacteristic(NUS.rx);
    const decoder = new TextDecoder();
    tx.addEventListener('characteristicvaluechanged', e => this.split(decoder.decode(e.target.value, {stream: true})));
    await tx.startNotifications();
    this.tx = tx;
  }

  async reconnect(device) {
    this.set('connecting', 'bluetooth');
    for (const wait of [500, 1500, 4000]) {
      await new Promise(r => setTimeout(r, wait));
      if (this.device !== device || this.closing) return;
      try { await this.attachGatt(device); this.set('on', 'bluetooth'); this.send('HELLO'); return; } catch {}
    }
    this.lost();
  }

  async write(bytes) {
    if (this.writer) return this.writer.write(bytes);
    if (!this.rx) return;
    const props = this.rx.properties;
    for (let i = 0; i < bytes.length; i += BLE_CHUNK) {
      const chunk = bytes.slice(i, i + BLE_CHUNK);
      if (props.write) await this.rx.writeValueWithResponse(chunk);
      else await this.rx.writeValueWithoutResponse(chunk);
    }
  }

  async lost() {
    // Dropped within moments of opening: on Linux this is a port left in a bad
    // state by a flashing tool or serial monitor; replugging the band clears it.
    const early = this.via === 'usb' && performance.now() - (this.openedAt || 0) < 3000;
    await this.teardown();
    this.set('off', null, early ? 'lost-early' : 'lost');
  }

  async teardown() {
    const {port, reader, writer, reading, device} = this;
    this.port = this.reader = this.writer = this.reading = this.device = this.rx = this.tx = null;
    if (reader) { try { await reader.cancel(); } catch {} }
    if (reading) { try { await reading; } catch {} }
    if (writer) { try { writer.releaseLock(); } catch {} }
    if (port) { try { await port.close(); } catch {} }
    if (device?.gatt?.connected) device.gatt.disconnect();
    this.queue = Promise.resolve();
  }
}
