export function createSensor() { return { t: 0, hr: 74, spo2: 97.3, phase: 0, effort: 1, userEff: 1, ax: 0, ay: 0, az: 1, moving: false,
  ev: { spo2: 0, hr: 0, overdo: 0, still: false }, lastRep: -10, intervals: [], armed: true, trace: [], lastMove: 0, cad: 0, tempo: 0, coachPhase: 0, recovering: false }; }

// Simulation has a bounded timestep and repairs invalid numerical state before use.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = () => Math.random() - .5;
const WORKOUTS = {walk:{target:112},cycle:{target:65},lift:{target:3}};
export function frameDelta(now, previous) {
  return Number.isFinite(now) && Number.isFinite(previous) ? clamp((now-previous)/1000, 0, .1) : 0;
}
export function repairReadings(sim, restingHeart = 72) {
  const defaults = {t:0, hr:restingHeart, spo2:97.3, phase:0, effort:1, userEff:1, coachPhase:0, cad:0, tempo:0, lastMove:0, lastRep:-10};
  for (const [key, fallback] of Object.entries(defaults)) if (!Number.isFinite(sim[key])) sim[key] = fallback;
}
export function advanceSensor(sim, dt, {workout, plan, profile, hasSession, onDetect}) {
  if (!Number.isFinite(dt) || dt <= 0) return;
  dt = Math.min(dt, .1);
  repairReadings(sim, profile.rest);
  sim.t += dt;
  const w = workout, Wk = WORKOUTS[w], d = plan;
  const still = sim.ev.still || !sim.moving;
  // effort eases toward the user's effort (or an "overdoing it" surge)
  let effT = sim.userEff;
  if (sim.ev.overdo > 0) { effT = w === "lift" ? 2.3 : 1.3; sim.ev.overdo -= dt; }
  sim.effort += (effT - sim.effort) * Math.min(1, dt / 2.5);
  const freq = w === "lift" ? sim.effort / Wk.target : (Wk.target * sim.effort) / 60;
  const wob = 1 + 0.045 * Math.sin(sim.t * 0.13) + 0.03 * Math.sin(sim.t * 0.47 + 1);
  if (!still) sim.phase += 2 * Math.PI * freq * wob * dt;
  const p = sim.phase;
  let det;
  if (still) { sim.ax = 0.02 + rnd() * 0.012; sim.ay = 0.03 + rnd() * 0.012; sim.az = 0.99 + rnd() * 0.012; det = null; }
  else if (w === "walk") {
    const s = Math.max(0, Math.sin(p));
    sim.ax = 0.22 * Math.sin(p / 2) + rnd() * 0.07; sim.ay = 0.12 * Math.cos(p) + rnd() * 0.05; sim.az = 0.8 + 0.72 * s * s + rnd() * 0.06;
    det = [sim.az, 1.28, 0.95];
  } else if (w === "cycle") {
    sim.ax = 0.55 * Math.sin(p) + rnd() * 0.05; sim.ay = 0.55 * Math.cos(p) + rnd() * 0.05; sim.az = 1 + 0.08 * Math.sin(2 * p) + rnd() * 0.04;
    det = [sim.ax, 0.42, -0.2];
  } else {
    const a = (1 - Math.cos(p)) / 2;
    sim.ay = 0.1 + 0.9 * a + rnd() * 0.04; sim.az = 1 - 0.55 * a + rnd() * 0.04; sim.ax = 0.08 * Math.sin(2 * p) + rnd() * 0.04;
    det = [sim.ay, 0.86, 0.35];
  }
  // peak detection with hysteresis, straight from the signal
  if (det) {
    const [v, up, down] = det;
    if (sim.armed && v > up) { sim.armed = false; onDetect(); }
    else if (!sim.armed && v < down) sim.armed = true;
  }
  const mag = Math.hypot(sim.ax, sim.ay, sim.az);
  if (Math.abs(mag - 1) > 0.06 || !sim.moving) sim.lastMove = sim.t;
  sim.trace.push([sim.ax, sim.ay, sim.az]); if (sim.trace.length > 170) sim.trace.shift();
  // heart rate: first-order response to effort
  const mid = (d.zone[0] + d.zone[1]) / 2;
  let tHR, tau = 22;
  if (still || !hasSession) tHR = profile.rest + 4;
  else if (w === "lift") tHR = mid - 2 + (sim.effort - 1) * 14;
  else tHR = mid + (sim.effort - 1) * 62;
  if (sim.ev.hr > 0) { tHR = d.zone[1] + 36; tau = 3; sim.ev.hr -= dt; }
  if (sim.recovering) tau = 5;
  sim.hr += (tHR - sim.hr) * Math.min(1, dt / tau) + rnd() * 1.1 * Math.sqrt(dt);
  let tS = 97.3, tauS = 5;
  if (sim.ev.spo2 > 0) { tS = 87.5; tauS = 2.2; sim.ev.spo2 -= dt; }
  sim.spo2 += (tS - sim.spo2) * Math.min(1, dt / tauS) + rnd() * 0.12 * Math.sqrt(dt);
  sim.hr = clamp(sim.hr, 40, 200);
  sim.spo2 = clamp(sim.spo2, 80, 99.4);
  // cadence decays if no detections
  if (w !== "lift" && sim.t - sim.lastRep > 3) sim.cad = Math.max(0, sim.cad - dt * 30);
}
