
import {sunflowerSVG, avatarSVG, figSVG, placementSVG, drawScene, drawFig, drawFlowerHead, drawSunflower} from './graphics.js?v=main9';
import {advanceSensor, frameDelta, createSensor} from './sensor.js?v=main9';
import {setupPanels} from './panels.js?v=main9';
import {BandLink, createLive, ingestFrame, advanceLive, STALE_MS} from './band.js?v=main9';
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- people ---------- */
const PROFILES = [
  { id: "margaret", name: "Margaret", age: 72, program: "Strength after treatment", rest: 72,
    look: { skin: "#F2C9A5", hair: "#D9D9E0", style: "bob", shirt: "#4AA3E8", pants: "#2D4B70", glasses: true },
    dose: { walk: { min: 20, zone: [95, 115] }, cycle: { min: 15, zone: [92, 112] }, lift: { sets: 2, reps: 10, kg: 2, zone: [85, 108] } }, rec: "walk" },
  { id: "desmond", name: "Desmond", age: 68, program: "Stroke recovery", rest: 70,
    look: { skin: "#8D5A3B", hair: "#B8B8B8", style: "short", shirt: "#3FAE6A", pants: "#34445C", glasses: false },
    dose: { walk: { min: 15, zone: [88, 106] }, cycle: { min: 20, zone: [90, 108] }, lift: { sets: 2, reps: 8, kg: 1, zone: [82, 102] } }, rec: "cycle" },
  { id: "lin", name: "Lin", age: 75, program: "Sarcopenia: rebuilding muscle", rest: 68,
    look: { skin: "#EBC39B", hair: "#3A3A44", style: "bun", shirt: "#F08A5D", pants: "#3B3F66", glasses: true },
    dose: { walk: { min: 30, zone: [100, 122] }, cycle: { min: 25, zone: [100, 120] }, lift: { sets: 3, reps: 10, kg: 3, zone: [88, 112] } }, rec: "lift" }
];
const OTHERS = [
  { name: "Joyce", look: { skin: "#C68B62", hair: "#EDEDF2", style: "curly", shirt: "#A879D6" }, days: [1, 1, 1, 1, 0] },
  { name: "Ray", look: { skin: "#F5D0B5", hair: "#C9C9C9", style: "bald", shirt: "#E2574C", glasses: true }, days: [1, 0, 1, 1, 0] },
  { name: "Amara", look: { skin: "#6B4430", hair: "#24242A", style: "curly", shirt: "#FFB627" }, days: [1, 1, 0, 1, 1] }
];
const BASE_DAYS = { margaret: [1, 1, 0, 1, 0], desmond: [1, 0, 1, 0, 1], lin: [1, 1, 1, 0, 1] };
const PRIYA = { skin: "#B9825C", hair: "#1E1E24", style: "bun", shirt: "#1D6BB3" };
const ROSA = { skin: "#D9A07A", hair: "#7A3E2B", style: "short", shirt: "#FF8A3D", pants: "#2D4B70", headband: true };

const WK = {
  walk: { name: "Walk or jog", verb: "walking", target: 112, band: [100, 124], unit: "steps a minute", place: "ankle",
    placeText: "your lower leg, just above the ankle", game: "Steady Route", gameKind: "ride", start: "Start walking" },
  cycle: { name: "Cycle", verb: "cycling", target: 65, band: [56, 74], unit: "pedal turns a minute", place: "ankle",
    placeText: "your lower leg, just above the ankle", game: "Steady Route", gameKind: "ride", start: "Start cycling" },
  lift: { name: "Dumbbell lifts", verb: "lifting", target: 3, band: [2, 4], unit: "seconds per lift", place: "wrist",
    placeText: "the wrist of the arm that lifts", game: "Steady Lift", gameKind: "lantern", start: "Start lifting" }
};

const S = { view: "home", profile: PROFILES[0], workout: "walk", speed: 1, sound: true, session: null,
  overlay: null, from: {}, lastFocus: {}, waved: new Set() };

PROFILES.forEach(p => p.look.initial = p.name[0]);
OTHERS.forEach(p => p.look.initial = p.name[0]);
PRIYA.initial = 'P'; ROSA.initial = 'R';

/* ---------- audio ---------- */
let AC = null;
function unlockAudio() {
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { AC = null; } }
  if (AC && AC.state === "suspended") AC.resume().catch(() => {});
}
function tone(f, t0, dur, type = "sine", vol = 0.12) {
  if (!AC) return;
  const t = AC.currentTime + t0, o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.value = f;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(AC.destination); o.start(t); o.stop(t + dur + 0.05);
}
const SFX = {
  move: () => tone(1046, 0, 0.07, "sine", 0.04),
  ok: () => { tone(784, 0, 0.12, "triangle", 0.09); tone(1175, 0.07, 0.18, "triangle", 0.08); },
  back: () => tone(523, 0, 0.12, "triangle", 0.07),
  bump: () => tone(196, 0, 0.1, "sine", 0.06),
  pick: () => { [988, 1319, 1568].forEach((f, i) => tone(f, i * 0.06, 0.22, "sine", 0.07)); },
  lantern: () => { tone(587, 0, 0.5, "triangle", 0.06); tone(880, 0.12, 0.6, "sine", 0.05); },
  done: () => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.11, 0.5, "triangle", 0.08)); },
  calm: () => { tone(392, 0, 1.2, "sine", 0.09); tone(523, 0.5, 1.4, "sine", 0.08); },
  wave: () => { tone(880, 0, 0.12, "sine", 0.06); tone(1109, 0.1, 0.16, "sine", 0.06); }
};
function sfx(n) { if (S.sound && AC) try { SFX[n](); } catch (e) {} }

/* ---------- views & focus ---------- */
const screen = $("#screen"), ring = $("#ring");
let cur = null;
const panels = setupPanels(() => requestAnimationFrame(() => focusDefault()));
function scopeEl() { return S.overlay ? $("#overlay") : $("#v-" + S.view); }
function items() { return $$(".f", scopeEl()).filter((e) => !e.disabled && e.offsetParent !== null); }
function setFocus(el, silent) {
  if (!el) return;
  if (cur && cur !== el) cur.classList.remove("is-focus");
  const changed = cur !== el;
  cur = el; el.classList.add("is-focus");
  if (!S.overlay) S.lastFocus[S.view] = el.id || el.dataset.key || null;
  if (document.activeElement !== el && screen.contains(document.activeElement || null) ) el.focus({ preventScroll: true });
  el.scrollIntoView({block:"nearest", inline:"nearest", behavior:"instant"});
  placeRing();
  if (changed && !silent) sfx("move");
}
function placeRing() {
  if (!cur || !cur.isConnected || cur.offsetParent === null) { ring.style.opacity = 0; return; }
  const s = screen.getBoundingClientRect(), r = cur.getBoundingClientRect();
  const pad = Math.max(5, s.width * 0.007);
  ring.style.opacity = 1;
  ring.style.width = r.width + pad * 2 + "px";
  ring.style.height = r.height + pad * 2 + "px";
  ring.style.transform = `translate(${r.left - s.left - pad}px,${r.top - s.top - pad}px)`;
  const br = parseFloat(getComputedStyle(cur).borderTopLeftRadius) || 12;
  ring.style.borderRadius = Math.min(br + pad, (r.height + pad * 2) / 2) + "px";
}
function focusDefault(prefer) {
  const list = items();
  let el = prefer ? (typeof prefer === "string" ? $("#" + prefer, scopeEl()) : prefer) : null;
  if (!el || !list.includes(el)) {
    const key = !S.overlay && S.lastFocus[S.view];
    el = key ? list.find((e) => e.id === key || e.dataset.key === key) : null;
  }
  setFocus(el || list[0], true);
}
function move(dir) {
  const list = items();
  if (!list.length) return;
  if (!cur || !list.includes(cur)) { setFocus(list[0]); return; }
  const a = cur.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best = null, bs = Infinity;
  for (const el of list) {
    if (el === cur) continue;
    const b = el.getBoundingClientRect(), bx = b.left + b.width / 2, by = b.top + b.height / 2;
    let main, cross;
    if (dir === "right") { if (bx <= ax + 2) continue; main = Math.max(0, b.left - a.right); cross = Math.abs(by - ay); }
    else if (dir === "left") { if (bx >= ax - 2) continue; main = Math.max(0, a.left - b.right); cross = Math.abs(by - ay); }
    else if (dir === "down") { if (by <= ay + 2) continue; main = Math.max(0, b.top - a.bottom); cross = Math.abs(bx - ax); }
    else { if (by >= ay - 2) continue; main = Math.max(0, a.top - b.bottom); cross = Math.abs(bx - ax); }
    const sc = main + cross * 1.6;
    if (sc < bs) { bs = sc; best = el; }
  }
  if (best) setFocus(best);
  else { ring.classList.remove("bump"); void ring.offsetWidth; ring.classList.add("bump"); sfx("bump"); }
}
screen.addEventListener("scroll", placeRing, true);
ring.addEventListener("animationend", (e) => { if (e.animationName === "ringBump") ring.classList.remove("bump"); });

function show(view, prefer) {
  panels.close();
  const prev = S.view;
  if (prev !== view) S.from[view] = S.from[view] || prev;
  $$(".view", screen).forEach((v) => (v.hidden = v.id !== "v-" + view));
  S.view = view;
  screen.classList.toggle("is-immersive", view === "live" || view === "game");
  const r = RENDER[view]; if (r) r();
  requestAnimationFrame(() => { sizeCanvases(); focusDefault(prefer); });
}
function go(view, prefer) { S.from[view] = S.view; show(view, prefer); }
function back() {
  if (panels.isOpen()) { panels.close(); return; }
  if (S.overlay) {
    const b = $("#overlay [data-back]"); if (b) { b.click(); return; }
    toast("Please choose an option on the screen"); return;
  }
  sfx("back");
  switch (S.view) {
    case "plan": show("home"); break;
    case "band": show("plan"); break;
    case "live": openPause(); break;
    case "game": endGame(false); break;
    case "summary": show("home"); break;
    case "club": show(S.from.club && S.from.club !== "club" ? S.from.club : "home"); break;
    case "call": hangUp(); break;
  }
}

let toastT = 0;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2600); }

/* ---------- captions ---------- */
let lastSay = 0;
function say(text, who = "Rosa") {
  $$(".caption").forEach((c) => { $(".cap-who", c).textContent = who; $(".cap-text", c).textContent = text; });
  lastSay = performance.now();
}

/* ---------- renderers ---------- */
function greetText() { const h = new Date().getHours(); return h < 12 ? "Good morning." : h < 17 ? "Good afternoon." : "Good evening."; }
function doseText(p, w) { const d = p.dose[w]; return w === "lift" ? `${d.sets} sets of ${d.reps} lifts, ${d.kg} kg` : `${d.min} minutes`; }
const RENDER = {
  home() {
    $("#greet").innerHTML = `${greetText()}<br>Who is exercising today?`;
    $("#profileTiles").innerHTML = PROFILES.map((p) => `<button class="f tile ptile" data-key="p-${p.id}" data-pid="${p.id}">
      <span class="av">${avatarSVG(p.look)}</span><span style="display:flex;flex-direction:column;gap:.3em;align-items:inherit;min-width:0">
      <span class="t-name">${p.name}</span><span class="t-sub">${p.program}</span>
      <span class="chip">Today: ${WK[p.rec].name.toLowerCase()}, ${doseText(p, p.rec)}</span></span></button>`).join("");
  },
  plan() {
    const p = S.profile;
    $("#planAv").innerHTML = avatarSVG(p.look);
    $("#planTitle").textContent = `${p.name}, here is today's plan`;
    $("#workoutTiles").innerHTML = ["walk", "cycle", "lift"].map((w) => {
      const d = p.dose[w];
      return `<button class="f tile wtile" data-key="w-${w}" data-wk="${w}">
        ${p.rec === w ? `<span class="badge">${sunflowerSVG()}Priya suggests</span>` : ""}
        ${figSVG(w, p.look)}<span style="display:flex;flex-direction:column;gap:.3em;align-items:inherit;min-width:0">
        <span class="t-name">${WK[w].name}</span>
        <span class="dose-line">${doseText(p, w)} · heart ${d.zone[0]} to ${d.zone[1]}</span>
        <span class="chip sun">Band on your ${WK[w].place}</span></span></button>`;
    }).join("");
  },
  band() {
    const w = S.workout, W = WK[w];
    $("#bandFig").innerHTML = placementSVG(w);
    $("#bandTitle").textContent = w === "lift" ? "Put the band on your wrist" : "Put the band on your lower leg";
    const steps = w === "lift"
      ? ["Wrap the band around " + W.placeText + ".", "The little light faces up, toward your thumb.", "Snug, but not tight. Hold your " + S.profile.dose.lift.kg + " kg weight."]
      : ["Wrap the band around " + W.placeText + ".", "The little light faces outward.", w === "cycle" ? "Snug, but not tight. Sit on your bike." : "Snug, but not tight. Stand up tall."];
    $("#bandSteps").innerHTML = steps.map((s) => `<li>${s}</li>`).join("");
    $("#startBtn").textContent = W.start;
    sim.moving = false;
  },
  live() {
    const w = S.workout, W = WK[w], d = S.profile.dose[w];
    $("#gameBtn").textContent = "Play " + W.game;
    $("#zoneRange").textContent = `Your zone ${d.zone[0]} to ${d.zone[1]}`;
    $("#cntLbl").textContent = w === "lift" ? "Your lifts" : "Your pace";
    $("#cntUnit").textContent = w === "lift" ? "" : W.unit;
    const lo = S.profile.rest - 10, hi = d.zone[1] + 35, pct = (v) => ((v - lo) / (hi - lo)) * 100;
    const segs = [[lo, d.zone[0], "var(--z-low)"], [d.zone[0], d.zone[1], "var(--z-ok)"], [d.zone[1], d.zone[1] + 15, "var(--z-high)"], [d.zone[1] + 15, hi, "var(--z-danger)"]];
    $("#zoneBar").innerHTML = segs.map(([a, b, c]) => `<span style="width:${pct(b) - pct(a)}%;background:${c}"></span>`).join("") + `<div class="zb-mark" id="zbMark"></div>`;
    $("#banner").hidden = true;
    updateLive(true);
  },
  game() {},
  summary() { renderSummary(); },
  club() { renderClub(); },
  call() {}
};

/* ---------- sensor simulation ---------- */
const sim = createSensor();
function W() { return WK[S.workout]; }
function D() { return S.profile.dose[S.workout]; }
function rnd() { return Math.random() - 0.5; }
function simSub(dt) {
  advanceSensor(sim, dt, {workout:S.workout, plan:D(), profile:S.profile, hasSession:!!S.session, onDetect});
}

/* ---------- wristband link (firmware/sunroom_band) ---------- */
const live = createLive();
const band = new BandLink({ onMessage: onBandMessage, onChange: onBandChange });
let bandInfo = null, lastModeSync = 0, wasLive = false;
function bandLive() { return band.state === "on" && performance.now() - live.at < STALE_MS; }
function stillLimit() { return bandLive() ? 30 : 4; }   // real people pause; the simulation never does
function hrText() { return sim.hrOk ? String(Math.round(sim.hr)) : "--"; }
function o2Text() { return sim.o2Ok ? Math.round(sim.spo2) + "%" : "--"; }
function syncBand() {
  band.send("MODE", S.workout);
  if (S.profile) band.send("NAME", S.profile.name);
  if (S.session && !S.session.sample && (S.view === "live" || S.view === "game")) band.send("START");
}
function onBandMessage(m) {
  if (m.kind === "frame") {
    ingestFrame(live, m, performance.now());
    if (m.mode && m.mode !== S.workout && performance.now() - lastModeSync > 1500) { lastModeSync = performance.now(); band.send("MODE", S.workout); }
  } else if (m.ev === "hello") {
    bandInfo = m; syncBand(); renderBandStatus();
    if (!m.mpu || !m.ppg) toast(`The band's ${!m.mpu ? "motion" : "pulse"} sensor isn't responding. Check its wires.`);
  } else if (m.ev === "error") toast(`Band: ${m.msg}`);
}
function onBandChange(state, via, reason) {
  if (state === "on") { Object.assign(live, createLive()); toast(via === "usb" ? "Band connected by USB cable" : "Band connected by Bluetooth"); }
  else if (state === "off" && reason === "lost") toast("Band disconnected. Showing simulated readings.");
  else if (state === "off" && reason === "lost-early") toast("The band dropped as soon as it connected. Unplug its USB cable, plug it back in, then connect again.");
  renderBandStatus();
}
function renderBandStatus() {
  const sup = BandLink.support(), on = band.state === "on", busy = band.state === "connecting", isLive = bandLive();
  const via = band.via === "usb" ? "USB cable" : "Bluetooth";
  $("#bandStatus").textContent = busy ? `Connecting by ${via}...`
    : on ? (isLive ? `Live from ${bandInfo && bandInfo.name ? bandInfo.name : "the band"} by ${via}` : `Connected by ${via}, waiting for readings`)
    : sup.usb || sup.bluetooth ? "Simulated readings" : "Simulated readings. Open this page in Chrome or Edge to connect a band.";
  $$("[data-band]").forEach((b) => {
    const kind = b.dataset.band;
    b.hidden = kind === "off" ? !(on || busy) : on || busy;  // shown even when unsupported: clicking explains why
  });
  $("#connLabel").textContent = isLive ? `Band connected by ${via}` : on ? "Band connected, waiting" : "Simulated band";
  $("#connDot").classList.toggle("sim", !isLive);
  $("#traceSrc").textContent = isLive ? "live" : "simulated";
}
function onDetect(manual, fromBand) {
  const iv = sim.t - sim.lastRep; sim.lastRep = sim.t;
  if (!fromBand) {  // the band measures its own pace
    if (iv > 0 && iv < 8) { sim.intervals.push(iv); if (sim.intervals.length > 6) sim.intervals.shift(); }
    const avg = sim.intervals.length ? sim.intervals.reduce((a, b) => a + b, 0) / sim.intervals.length : 0;
    if (S.workout === "lift") sim.tempo = iv > 0 && iv < 8 ? iv : sim.tempo;
    else if (avg > 0) sim.cad = Math.min(240, 60 / avg);
  }
  const lift = fromBand ? sim.tempo : iv;  // seconds this lift took
  const ses = S.session;
  if (ses && running()) {
    ses.count++;
    if (S.workout === "lift") {
      ses.reps++;
      if (lift > 0 && lift < 8) { ses.tempoSum += lift; ses.tempoN++; }
      if (S.view === "game" && G && G.kind === "lantern") spawnLantern(lift > 0 && lift < 8 ? lift : 3);
      if (ses.reps % D().reps === 0 && ses.reps < D().reps * D().sets) say(`That's set ${ses.reps / D().reps} done. Shake out your arm and breathe.`);
    }
  }
  if (manual) { sim.trace.push([0.4, 0.9, 1.6]); }
}
function manualRep() {
  sim.armed = true; onDetect(true);
  if (!running()) toast(S.session ? "Rep counted" : "Start a workout to count reps");
}

/* ---------- session ---------- */
function running() { return S.session && (S.view === "live" || S.view === "game") && !S.overlay && !S.session.paused; }
function startSession() {
  S.session = { elapsed: 0, inZone: 0, hrSum: 0, hrT: 0, minSpo2: 99, count: 0, reps: 0, tempoSum: 0, tempoN: 0, inBand: 0, bandT: 0,
    flowers: 0, lanterns: 0, rests: 0, overT: 0, banner: false, doneSaid: false, paused: false, nextLine: performance.now() + 9000, started: Date.now() };
  sim.hr = S.profile.rest + 4; sim.spo2 = 97.3;
  sim.moving = true; sim.userEff = 1; sim.effort = 0.95; sim.intervals = []; sim.cad = 0; sim.tempo = 0;
  sim.ev = { spo2: 0, hr: 0, overdo: 0, still: false }; sim.lastMove = sim.t; sim.recovering = false;
  const p = S.profile, w = S.workout;
  say(w === "lift" ? `Hello ${p.name}. Lift with me: up for two, down for two. ${doseText(p, w)}.` :
    `Hello ${p.name}. Let's go ${WK[w].verb} together for ${p.dose[w].min} minutes. Follow my pace.`);
  band.send("START");
}
function doseFrac() {
  const s = S.session; if (!s) return 0;
  const d = D();
  return S.workout === "lift" ? s.reps / (d.reps * d.sets) : s.elapsed / (d.min * 60);
}
function zoneOf(hr) {
  const d = D();
  if (hr < d.zone[0]) return ["Warming up", "var(--z-low)"];
  if (hr <= d.zone[1]) return ["In your zone", "var(--z-ok)"];
  if (hr <= d.zone[1] + 15) return ["Above your zone", "var(--z-high)"];
  return ["Too hard, please rest", "var(--z-danger)"];
}
function tickSession(dt) {
  const s = S.session; if (!s || !running()) return;
  const d = D(), w = S.workout;
  s.elapsed += dt;
  if (sim.hrOk) { if (sim.hr >= d.zone[0] && sim.hr <= d.zone[1]) s.inZone += dt; s.hrSum += sim.hr * dt; s.hrT += dt; }
  if (sim.o2Ok) s.minSpo2 = Math.min(s.minSpo2, sim.spo2);
  const val = w === "lift" ? sim.tempo : sim.cad, B = W().band;
  if (val) { s.bandT += dt; if (val >= B[0] && val <= B[1]) s.inBand += dt; }
  // safety checks
  if (sim.o2Ok && sim.spo2 < 92) return openAlert("oxygen");
  if (sim.hrOk && sim.hr > d.zone[1] + 15) return openAlert("heart");
  if (sim.t - sim.lastMove > stillLimit()) return openAlert("still");
  const over = (w === "lift" ? (sim.tempo && sim.tempo < 1.7) : sim.cad > B[1] * 1.03) || (sim.hrOk && sim.hr > d.zone[1]) || sim.fast;
  s.overT = over ? s.overT + dt : Math.max(0, s.overT - dt * 2);
  if (!s.banner && s.overT > 5) {
    s.banner = true;
    showBanner(false, w === "lift" ? "Easy does it. Slower lifts protect your joints." : "Easy does it. Ease back to a gentle pace.");
    band.send("MSG", "Easy does it");
    say(w === "lift" ? "Slow down a little. Count two up, two down, like me." : "You're going faster than your plan. Let's ease back together.");
  } else if (s.banner && s.overT === 0) {
    s.banner = false; showBanner(true, "Lovely. That's your steady pace."); say("That's it. Nice and steady."); band.send("MSG");
    setTimeout(() => { if (!S.session || !S.session.banner) $("#banner").hidden = true; }, 3500);
  }
  if (!s.doneSaid && doseFrac() >= 1) {
    s.doneSaid = true; sfx("done"); say(`That's your full dose for today, ${S.profile.name}. Wonderful work.`);
    openGoal();
  }
}
/* the success screen when today's dose is reached */
function openGoal() {
  const s = S.session, d = D(), w = S.workout, p = S.profile;
  const what = w === "lift" ? `${d.sets} sets of ${d.reps} lifts with your ${d.kg} kg weight` : `${d.min} minutes of ${WK[w].verb}`;
  const stats = w === "lift" ? [[s.reps, "lifts done"]] : [[s.count, w === "walk" ? "steps taken" : "pedal turns"]];
  if (w === "lift" && s.tempoN) stats.push([`${(s.tempoSum / s.tempoN).toFixed(1)} s`, "per lift, nice and slow"]);
  if (s.inZone >= 60) stats.push([`${Math.round(s.inZone / 60)} min`, "in your heart zone"]);
  if (s.bandT >= 30) stats.push([`${Math.round((s.inBand / s.bandT) * 100)}%`, w === "lift" ? "steady, smooth lifts" : "at a steady pace"]);
  if (s.rests) stats.push([s.rests, `rest break${s.rests > 1 ? "s" : ""}, well taken`]);
  const colours = ["#FFC52E", "#1B8A4F", "#1D6BB3", "#E2574C", "#F08A5D", "#A879D6"];
  const confetti = Array.from({ length: 24 }, (_, i) => `<i style="--x:${(i * 41) % 100}%;--d:${((i * 7) % 12) * 0.12}s;--c:${colours[i % colours.length]}"></i>`).join("");
  band.send("MSG", "Dose done!");
  openOverlay("goal", "party goal", `<div class="confetti" aria-hidden="true">${confetti}</div>
    <div class="goal-badge">${sunflowerSVG()}</div>
    <p class="eyebrow">Today's dose is complete</p>
    <h1 class="h-xl">You did it, ${p.name}!</h1>
    <p class="sub">${what}. That's exactly what Priya planned.</p>
    <div class="goal-stats">${stats.map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join("")}</div>
    <div class="row-btns" style="justify-content:center"><button class="f btn primary" id="goalSummary">See my summary</button><button class="f btn" id="goalMore" data-back>Keep going</button></div>`, "goalSummary");
  $("#goalSummary").onclick = () => { sfx("ok"); closeOverlay(); finish(); };
  $("#goalMore").onclick = () => { sfx("ok"); band.send("MSG"); closeOverlay(); say("Lovely. Anything extra today is a bonus. Go gently."); };
}
function showBanner(good, text) {
  const b = $("#banner"); b.hidden = false; b.classList.toggle("good", good);
  b.innerHTML = (good ? `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#1B8A4F"/><path d="m7 12.5 3.2 3.2L17.5 8.4" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round"/></svg>`
    : `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#C77700"/><path d="M8 9h8M8 13h5" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/></svg>`) + `<span>${text}</span>`;
}
const LINES = {
  walk: { in: ["You're right in your zone. Keep this pace.", "Lovely rhythm. Swing your arms gently.", "Stand tall and look ahead at the hills.", "Remember to breathe. In through the nose."],
    low: ["You can go a little quicker if you feel good.", "Lift your knees a touch. Nice and easy."] },
  cycle: { in: ["Smooth circles. You're right in your zone.", "Keep your shoulders soft and relaxed.", "Lovely and steady. Enjoy the view."],
    low: ["Pedal a little quicker if you feel good.", "Push down gently through your heels."] },
  lift: { in: ["Keep your elbow close to your side.", "Up for two, down for two. Beautiful.", "Breathe out as you lift."],
    low: ["Squeeze gently at the top of each lift.", "Take your time. Steady beats speedy."] }
};
function coachTick(now) {
  const s = S.session; if (!s || !running() || now < s.nextLine) return;
  s.nextLine = now + 14000;
  if (s.banner || now - lastSay < 7000) return;
  const L = LINES[S.workout], zone = sim.hr < D().zone[0] ? "low" : "in";
  const arr = L[zone]; say(arr[Math.floor(Math.random() * arr.length)]);
}

function fmtTime(sec) { sec = Math.max(0, Math.round(sec)); return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); }
let uiT = 0;
function updateLive(force) {
  const now = performance.now(); if (!force && now - uiT < 200) return; uiT = now;
  const d = D(), w = S.workout, s = S.session;
  const hr = hrText(), [zl, zc] = sim.hrOk ? zoneOf(sim.hr) : ["Finding your pulse", "var(--z-low)"];
  if (S.view === "live") {
    $("#hrNum").textContent = hr; $("#zoneLabel").textContent = zl; $("#hrCard").style.setProperty("--zc", zc);
    const lo = S.profile.rest - 10, hi = d.zone[1] + 35, m = $("#zbMark");
    if (m) m.style.left = clamp(((sim.hr - lo) / (hi - lo)) * 100, 2, 98) + "%";
    const o2 = Math.round(sim.spo2); $("#o2Num").textContent = o2Text();
    const o2s = $("#o2State"); o2s.textContent = !sim.o2Ok ? "Checking" : o2 >= 94 ? "Good" : o2 >= 92 ? "A little low" : "Low";
    o2s.style.setProperty("--oc", !sim.o2Ok ? "var(--z-low)" : o2 >= 94 ? "var(--z-ok)" : o2 >= 92 ? "var(--z-high)" : "var(--z-danger)");
    const f = clamp(doseFrac(), 0, 1);
    $("#doseArc").style.strokeDashoffset = 314.16 * (1 - f);
    if (w === "lift") {
      const total = d.reps * d.sets, done = s ? s.reps : 0;
      $("#doseLbl").textContent = `Today: ${d.sets} sets of ${d.reps}`; $("#doseBig").textContent = Math.max(0, total - done); $("#doseSmall").textContent = "lifts to go";
      const set = Math.min(d.sets, Math.floor(done / d.reps) + 1), inSet = done >= total ? d.reps : done % d.reps;
      $("#cntNum").textContent = `${inSet} of ${d.reps}`;
      $("#cntGoal").textContent = `Set ${set} of ${d.sets} · ${sim.tempo ? sim.tempo.toFixed(1) + " s per lift" : "lift when ready"} · aim for 2 to 4 s`;
    } else {
      $("#doseLbl").textContent = `Today: ${d.min} minutes`; $("#doseBig").textContent = fmtTime(d.min * 60 - (s ? s.elapsed : 0)); $("#doseSmall").textContent = f >= 1 ? "dose complete" : "left to go";
      $("#cntNum").textContent = Math.round(sim.cad);
      $("#cntGoal").textContent = `Steady pace: ${W().band[0]} to ${W().band[1]}` + (s && w === "walk" ? ` · ${s.count} steps so far` : s ? ` · ${s.count} turns so far` : "");
    }
  } else if (S.view === "game") {
    $("#gHr").textContent = hr; $("#hudHr").style.setProperty("--zc", zc); $("#gO2").textContent = o2Text();
    const B = W().band, val = w === "lift" ? sim.tempo : sim.cad;
    let lo, hi;
    if (w === "lift") { lo = 0.5; hi = 5.5; } else { lo = W().target * 0.55; hi = W().target * 1.45; }
    const pc = (v) => clamp(((v - lo) / (hi - lo)) * 100, 0, 100);
    $("#paceBand").style.left = pc(B[0]) + "%"; $("#paceBand").style.width = pc(B[1]) - pc(B[0]) + "%";
    $("#paceMark").style.left = pc(val || lo) + "%";
    $("#paceTxt").textContent = w === "lift" ? `Your lift: ${sim.tempo ? sim.tempo.toFixed(1) + " s" : "waiting"} · sweet spot 2 to 4 s` : `Your pace: ${Math.round(sim.cad)} ${W().unit} · sweet spot ${B[0]} to ${B[1]}`;
  } else if (S.view === "band") {
    $("#bandHR").textContent = hr; $("#bandO2").textContent = o2Text();
  }
  if (S.overlay && S.overlay.startsWith("alert")) {
    const a = $("#ovHR"), b = $("#ovO2"); if (a) a.textContent = hr; if (b) b.textContent = o2Text();
    checkRecovery();
  }
}

/* ---------- overlays ---------- */
function openOverlay(kind, cls, html, prefer) {
  panels.close();
  const ov = $("#overlay"); S.overlay = kind;
  ov.className = "overlay " + cls; ov.innerHTML = html; ov.hidden = false;
  if (cur) cur.classList.remove("is-focus");
  requestAnimationFrame(() => focusDefault(prefer));
}
function closeOverlay() {
  const ov = $("#overlay"); ov.hidden = true; ov.innerHTML = ""; S.overlay = null;
  requestAnimationFrame(() => focusDefault());
}
function openPause() {
  if (!S.session) return;
  S.session.paused = true; sim.moving = false; band.send("MSG", "Paused");
  openOverlay("pause", "soft", `<p class="eyebrow">Paused</p><h1 class="h-xl">Take your time.</h1>
    <p class="sub">Your band keeps an eye on your heart while you rest.</p>
    <div class="row-btns" style="justify-content:center"><button class="f btn primary" id="resumeBtn" data-back>Keep going</button><button class="f btn" id="pFinish">Finish for today</button></div>`, "resumeBtn");
  $("#resumeBtn").onclick = () => { sfx("ok"); S.session.paused = false; sim.moving = true; sim.lastMove = sim.t; closeOverlay(); say("Welcome back. Let's carry on gently."); band.send("MSG"); };
  $("#pFinish").onclick = () => { sfx("ok"); closeOverlay(); finish(); };
}
const ALERTS = {
  oxygen: { title: "Let's take a rest", why: (o) => `Your oxygen reading is ${o}%. It is usually 95% or more.`, todo: "Sit down and breathe slowly with the circle.", line: "Let's stop and rest for a moment. Breathe slowly with me.", band: "Rest: low oxygen" },
  heart: { title: "Your heart is working hard", why: (o, h) => `Your heart is at ${h}. Your plan says ${D().zone[0]} to ${D().zone[1]}.`, todo: "Slow right down, or sit and rest.", line: "Your heart is working harder than your plan. Let's slow right down.", band: "Rest: heart high" },
  still: { title: "Are you okay?", why: () => "Your band hasn't felt any movement for a little while.", todo: "If you're fine, press I'm okay.", line: "Are you okay? Press I'm okay if you're fine.", band: "Are you OK?" }
};
let stillTimer = 0;
function openAlert(type) {
  if (S.overlay) return;
  const A = ALERTS[type], s = S.session;
  if (s) { s.rests++; s.alerts = (s.alerts || []).concat(type); }
  sim.moving = false; sfx("calm"); say(A.line); band.send("MSG", A.band);
  const hr = Math.round(sim.hr), o2 = Math.round(sim.spo2);
  const btns = type === "still"
    ? `<button class="f btn" id="okBtn" style="color:var(--ink)">I'm okay</button><button class="f btn sun" id="helpBtn">Get help</button>`
    : `<button class="f btn" id="restBtn" style="color:var(--ink)">I'm sitting and resting</button><button class="f btn sun" id="alCall">Call my instructor</button>`;
  openOverlay("alert-" + type, "calm", `<div class="ov-row"><div class="breath"><i></i><i></i><span id="breathTxt">Breathe in</span></div>
    <div><h1 class="h-xl">${A.title}</h1><p class="sub" style="font-size:var(--t-m)">${A.why(o2, hr)}<br>${A.todo}</p>
    <div class="reading"><div><b id="ovHR">${hrText()}</b><span>heart</span></div><div><b id="ovO2">${o2Text()}</b><span>oxygen</span></div></div>
    <div class="row-btns" id="alBtns">${btns}</div>
    <p class="ov-note" id="alNote">${type === "still" ? "If we don't hear from you in <b id='stillCount'>30</b> seconds, we'll tell Priya." : "Priya has been sent a gentle note about this reading."}</p></div></div>`,
    type === "still" ? "okBtn" : "restBtn");
  startBreath();
  if (type === "still") {
    let n = 30; clearInterval(stillTimer);
    stillTimer = setInterval(() => {
      n--; const c = $("#stillCount"); if (c) c.textContent = n;
      if (n <= 0 || !S.overlay) { clearInterval(stillTimer); if (S.overlay === "alert-still") notified(); }
    }, 1000);
    $("#okBtn").onclick = () => { clearInterval(stillTimer); sfx("ok"); sim.ev.still = false; resumeAfterAlert("Glad you're okay. Let's carry on when you're ready."); };
    $("#helpBtn").onclick = () => { clearInterval(stillTimer); sfx("ok"); notified(); };
  } else {
    $("#restBtn").onclick = () => {
      sfx("ok"); sim.ev.spo2 = 0; sim.ev.hr = 0; sim.ev.overdo = 0; sim.recovering = true;
      $("#alNote").textContent = "Resting. The Continue button appears when your readings settle.";
      $("#alBtns").innerHTML = `<button class="f btn" id="contBtn" style="color:var(--ink)" disabled>Waiting for your readings</button><button class="f btn sun" id="alCall">Call my instructor</button><button class="f btn ghost" id="alEnd" style="color:var(--ink)">End today's workout</button>`;
      wireAlertCommon(); $("#contBtn").onclick = () => { sfx("ok"); resumeAfterAlert("Lovely. Let's continue gently, a little slower than before."); sim.userEff = 0.92; };
      focusDefault("alCall");
    };
    wireAlertCommon();
  }
}
function wireAlertCommon() {
  const c = $("#alCall"); if (c) c.onclick = () => { sfx("ok"); startCall(); };
  const e = $("#alEnd"); if (e) e.onclick = () => { sfx("ok"); closeOverlay(); finish(); };
}
function notified() {
  $("#alNote").textContent = "We've let Priya know. Stay where you are; she will call you on this TV.";
  $("#alBtns").innerHTML = `<button class="f btn" id="okBtn2" style="color:var(--ink)">I'm okay now</button><button class="f btn sun" id="alCall">Call Priya now</button>`;
  $("#okBtn2").onclick = () => { sfx("ok"); sim.ev.still = false; resumeAfterAlert("Glad you're okay. Take it slowly."); };
  wireAlertCommon(); focusDefault("okBtn2");
}
function checkRecovery() {
  const b = $("#contBtn"); if (!b || !b.disabled) return;
  if ((!sim.o2Ok || sim.spo2 >= 94) && (!sim.hrOk || sim.hr <= D().zone[1])) {
    b.disabled = false; b.textContent = "Continue gently";
    $("#alNote").textContent = `Your readings are back to normal: heart ${hrText()}, oxygen ${o2Text()}.`;
    setFocus(b, true); sfx("wave");
  }
}
let breathT = 0;
function startBreath() {
  clearInterval(breathT); let inh = true;
  breathT = setInterval(() => { const t = $("#breathTxt"); if (!t) { clearInterval(breathT); return; } inh = !inh; t.textContent = inh ? "Breathe in" : "Breathe out"; }, 5000);
}
function resumeAfterAlert(line) {
  sim.recovering = false; sim.moving = true; sim.lastMove = sim.t; if (S.session) { S.session.overT = 0; S.session.paused = false; }
  closeOverlay(); say(line); band.send("MSG");
}

/* ---------- call ---------- */
let callT = 0, callReturn = null;
function startCall() {
  callReturn = { view: S.view, overlay: S.overlay };
  if (S.overlay) { $("#overlay").hidden = true; }
  const ovKind = S.overlay; S.overlay = null;
  if (S.session) S.session.paused = true;
  callReturn.ovKind = ovKind;
  $("#callAv").innerHTML = avatarSVG(PRIYA);
  $("#callTitle").textContent = "Calling Priya"; $("#callSub").textContent = "Kinesiologist at CCCARE · ringing";
  go("call", "hangBtn");
  clearTimeout(callT);
  callT = setTimeout(() => { if (S.view === "call") { $("#callTitle").textContent = "Priya would answer here"; $("#callSub").textContent = "Demo only: no real call is placed. In the real product this opens a video call."; } }, 3200);
}
function hangUp() {
  clearTimeout(callT); sfx("back");
  const r = callReturn || { view: "club" }; callReturn = null;
  show(r.view === "call" ? "club" : r.view);
  if (r.ovKind) { S.overlay = r.ovKind; $("#overlay").hidden = false; requestAnimationFrame(() => focusDefault()); }
  else if (S.session && (r.view === "live" || r.view === "game")) { S.session.paused = false; sim.moving = true; sim.lastMove = sim.t; }
}

/* ---------- canvases ---------- */
const canv = {};
["liveCanvas", "gameCanvas", "pipCanvas", "traceCanvas", "bandTrace"].forEach((id) => { const c = $("#" + id); canv[id] = { c, x: c.getContext("2d"), w: 0, h: 0 }; });
function sizeCanvases() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  for (const k in canv) {
    const o = canv[k], r = o.c.getBoundingClientRect();
    if (!r.width) continue;
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (o.c.width !== w || o.c.height !== h) { o.c.width = w; o.c.height = h; }
    o.w = w; o.h = h; o.dpr = dpr;
  }
}
new ResizeObserver(() => { sizeCanvases(); placeRing(); }).observe(screen);
addEventListener("resize", () => { sizeCanvases(); placeRing(); });

function hash(i) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
function drawTrace(o, data) {
  const c = o.x, w = o.w, h = o.h; if (!w) return;
  c.clearRect(0, 0, w, h);
  c.strokeStyle = "rgba(13,38,64,.08)"; c.lineWidth = 1; c.beginPath(); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.stroke();
  const cols = ["#D2473F", "#1B8A4F", "#1D6BB3"], n = data.length;
  for (let k = 0; k < 3; k++) {
    c.strokeStyle = cols[k]; c.lineWidth = Math.max(1.5, h / 26); c.beginPath();
    for (let i = 0; i < n; i++) { const v = data[i][k] - (k === 2 ? 1 : 0); const xx = (i / 169) * w, yy = h / 2 - v * h * 0.42; i ? c.lineTo(xx, yy) : c.moveTo(xx, yy); }
    c.stroke();
    if (n) { const v = data[n - 1][k] - (k === 2 ? 1 : 0); c.fillStyle = cols[k]; c.beginPath(); c.arc(((n - 1) / 169) * w, h / 2 - v * h * 0.42, Math.max(2.5, h / 14), 0, 7); c.fill(); }
  }
}
function drawPip(t) {
  const o = canv.pipCanvas; if (!o.w) return;
  o.x.fillStyle = '#f3f7fb'; o.x.fillRect(0, 0, o.w, o.h);
  drawFig(o.x, o.w*.5, o.h*.65, o.h*.8, ROSA, S.workout, sim.coachPhase, t);
}

/* ---------- minigames ---------- */
let G = null;
function startGame() {
  const kind = W().gameKind;
  G = { kind, scroll: 0, flowers: [], nextX: 0, picked: 0, missed: 0, streak: 0, best: 0, parts: [], lanterns: [], lit: 0, goal: kind === "ride" ? 12 : 10, lastHint: 0, over: false };
  $("#hudIco").innerHTML = sunflowerSVG();
  $("#hudNum").textContent = "0"; $("#hudGoal").textContent = kind === "ride" ? `of ${G.goal} markers` : `of ${G.goal} lights`;
  $("#gameTitle").textContent = W().game; $("#gameTitle").classList.remove("out");
  setTimeout(() => $("#gameTitle").classList.add("out"), 1800);
  $("#gameHint").innerHTML = bandLive() ? "Live from your band" : kind === "ride" ? "Demo: press &#9650; or &#9660; to change your pace" : "Demo: Space adds a lift · &#9650; &#9660; change your speed";
  say(kind === "ride" ? "Sunflowers bloom when you keep your steady pace. Not too fast, not too slow." : "Each slow, smooth lift sends a light into the sky. Up for two, down for two.");
  go("game", "gameBackBtn");
}
function endGame(celebrate) {
  if (!G) { show("live"); return; }
  const g = G; G = null;
  if (S.session) { S.session.flowers += g.picked; S.session.lanterns += g.lit; }
  show("live");
  if (celebrate) {
    sfx("done");
    openOverlay("party", "party", `${sunflowerSVG("big-flower")}<h1 class="h-xl">${g.kind === "ride" ? `You picked ${g.picked} markers!` : `You lit ${g.lit} lights!`}</h1>
      <p class="sub">${g.kind === "ride" ? `Your longest steady stretch was ${g.best} in a row.` : "Slow, smooth lifts all the way. Your arm thanks you."} Your workout keeps going.</p>
      <div class="row-btns" style="justify-content:center"><button class="f btn primary" id="partyOk" data-back>Back to my workout</button></div>`, "partyOk");
    $("#partyOk").onclick = () => { sfx("ok"); closeOverlay(); say("Lovely. Let's keep going at your steady pace."); };
  }
}
function gameStep(dt, t) {
  const o = canv.gameCanvas, c = o.x, w = o.w, h = o.h; if (!w || !G) return;
  const run = running();
  if (G.kind === "ride") {
    const ratio = clamp(sim.cad / W().target, 0, 1.8);
    if (run) G.scroll += w * 0.2 * ratio * dt * (reduceMotion ? 0.5 : 1);
    drawScene(c, w, h, G.scroll, "day", t);
    const rx = w * 0.27, gy = h * 0.885;
    while (G.nextX < G.scroll + w * 1.3) { if (G.nextX === 0) G.nextX = G.scroll + w * 0.8; G.flowers.push({ x: G.nextX, st: "bud", hgt: 0.16 + hash(G.nextX) * 0.07 }); G.nextX += w * (0.3 + hash(G.nextX + 1) * 0.18); }
    const B = W().band, inBand = sim.cad >= B[0] && sim.cad <= B[1];
    for (const f of G.flowers) {
      const fx = f.x - G.scroll;
      if (f.st === "bud" && fx <= rx + w * 0.02) {
        if (inBand && run) { f.st = "picked"; G.picked++; G.streak++; G.best = Math.max(G.best, G.streak); G.parts.push({ x: fx, y: gy - h * f.hgt, t: 0 }); sfx("pick"); }
        else { f.st = "missed"; G.missed++; G.streak = 0; if (t - G.lastHint > 5 && run) { G.lastHint = t; say(sim.cad > B[1] ? "A little slower and the markers will light up for you." : "A little quicker and you'll reach the next one."); } }
      }
      if (fx < -w * 0.1 || fx > w * 1.1 || f.st === "picked") continue;
      drawSunflower(c, fx, gy - h * 0.005, h * f.hgt, h * 0.045, f.st === "missed" ? 0.25 : inBand ? 1 : 0.7, t);
    }
    G.flowers = G.flowers.filter((f) => f.x - G.scroll > -w * 0.2);
    drawFig(c, rx, gy, h * 0.17, S.profile.look, S.workout === "cycle" ? "cycle" : "walk", sim.phase, t, true);
    const hb = $("#hudScore").getBoundingClientRect(), sb = o.c.getBoundingClientRect(), tx = (hb.left - sb.left + hb.height * 0.5) * o.dpr, ty = (hb.top - sb.top + hb.height / 2) * o.dpr;
    G.parts = G.parts.filter((p) => {
      p.t += dt * 1.4; const e = 1 - Math.pow(1 - Math.min(1, p.t), 3), px = lerp(p.x, tx, e), py = lerp(p.y, ty, e) - Math.sin(e * Math.PI) * h * 0.15;
      drawFlowerHead(c, px, py, h * 0.045 * (1 - e * 0.4), 1, t * 3);
      if (p.t >= 1) { $("#hudNum").textContent = G.picked; const hs = $("#hudScore"); hs.classList.remove("pop"); void hs.offsetWidth; hs.classList.add("pop"); return false; }
      return true;
    });
    if (G.picked >= G.goal && !G.parts.length && !G.over) { G.over = true; endGame(true); }
  } else {
    if (run) G.scroll += w * 0.01 * dt;
    drawScene(c, w, h, G.scroll, "night", t);
    const fx = w * 0.3, gy = h * 0.83;
    for (const L of G.lanterns) {
      L.age += dt; L.y = Math.max(L.top, L.y - L.vy * dt * (L.y > L.top ? 1 : 0)); L.x += Math.sin(L.age * 0.8 + L.seed) * dt * w * 0.006 + dt * w * 0.006;
      const r = h * .035;
      c.fillStyle = L.q >= .6 ? '#e2ac31' : '#b3c5d2';
      c.beginPath(); c.arc(L.x, L.y, r, 0, Math.PI*2); c.fill();
      c.strokeStyle = '#fff'; c.lineWidth = r*.12;
      c.beginPath(); c.moveTo(L.x-r*.3,L.y); c.lineTo(L.x,L.y+r*.25); c.lineTo(L.x+r*.35,L.y-r*.25); c.stroke();
    }
    G.lanterns = G.lanterns.filter((L) => L.x < w * 1.1);
    drawFig(c, fx, gy, h * 0.2, S.profile.look, "lift", sim.phase, t, true);
    if (G.lit >= G.goal && !G.over) { G.over = true; setTimeout(() => endGame(true), 1200); }
  }
}
function spawnLantern(tempo) {
  if (!G || G.kind !== "lantern") return;
  const o = canv.gameCanvas, w = o.w, h = o.h;
  const q = tempo >= 2 && tempo <= 4.2 ? 1 : tempo < 2 ? clamp((tempo - 0.7) / 1.3, 0.2, 0.55) : 0.8;
  G.lanterns.push({ x: w * 0.36, y: h * 0.62, vy: h * (0.12 + q * 0.12), top: h * (0.5 - q * 0.36 + hash(G.lanterns.length) * 0.08), q, age: 0, seed: Math.random() * 6 });
  if (q >= 0.6) { G.lit++; sfx("lantern"); $("#hudNum").textContent = G.lit; const hs = $("#hudScore"); hs.classList.remove("pop"); void hs.offsetWidth; hs.classList.add("pop"); }
  else if (performance.now() - lastSay > 4000) say("That one flickered. Slow, steady lifts light up the next marker.");
}
function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
/* ---------- summary & club ---------- */
function sampleSession() {
  const d = D();
  S.session = { elapsed: S.workout === "lift" ? 540 : d.min * 60, inZone: S.workout === "lift" ? 420 : d.min * 60 * 0.82, hrSum: 104 * 600, hrT: 600, minSpo2: 95.6, count: S.workout === "lift" ? d.reps * d.sets : d.min * 112,
    reps: S.workout === "lift" ? d.reps * d.sets : 0, tempoSum: 3.1 * 20, tempoN: 20, inBand: 540, bandT: 600, flowers: 12, lanterns: 10, rests: 0, paused: false, sample: true };
}
function todayIdx() { return clamp((new Date().getDay() + 6) % 7, 0, 4); }
function myDays() {
  const base = (BASE_DAYS[S.profile.id] || [0, 0, 0, 0, 0]).slice(), ti = todayIdx();
  base[ti] = S.session && doseFrac() >= 1 ? 1 : 0;
  return base.map((v, i) => (i > ti ? null : v));
}
function renderSummary() {
  if (!S.session) sampleSession();
  const s = S.session, d = D(), w = S.workout, f = clamp(doseFrac(), 0, 1), pct = Math.round(f * 100);
  $("#sumArc").style.strokeDashoffset = 314.16 * (1 - f); $("#sumPct").textContent = pct + "%";
  const mins = Math.floor(s.elapsed / 60);
  if (f >= 1) { $("#sumTitle").textContent = "You did your full dose today!"; $("#sumSub").textContent = w === "lift" ? `${d.sets} sets of ${d.reps} lifts with your ${d.kg} kg weight.` : `${d.min} minutes of ${WK[w].verb}. That's exactly what Priya planned.`; }
  else { $("#sumTitle").textContent = w === "lift" ? `You did ${s.reps} of ${d.reps * d.sets} lifts.` : `You did ${mins} of ${d.min} minutes.`; $("#sumSub").textContent = "Every minute counts. Priya will see how today went."; }
  $("#sumEyebrow").textContent = `${S.profile.name} · ${WK[w].name}` + (s.sample ? " · example session" : "");
  const zonePct = s.elapsed ? Math.round((s.inZone / s.elapsed) * 100) : 0, steady = s.bandT ? Math.round((s.inBand / s.bandT) * 100) : 0;
  const avgHr = s.hrT ? Math.round(s.hrSum / s.hrT) : hrText();
  const tiles = [
    ["Time in your heart zone", `${Math.round(s.inZone / 60)} min`, zonePct],
    ["Average heart", `${avgHr}`, null, `beats a minute · zone ${d.zone[0]} to ${d.zone[1]}`],
    ["Lowest oxygen", s.minSpo2 > 98.9 ? o2Text() : `${Math.round(s.minSpo2)}%`, null, s.rests ? `${s.rests} rest break${s.rests > 1 ? "s" : ""}. Well done for listening to your body.` : "No rest alerts today"],
    [w === "lift" ? "Steady lifts" : "Steady pace", `${steady}%`, steady, w === "lift" ? `${s.reps} lifts · ${s.lanterns} lights` : `${s.count} ${w === "walk" ? "steps" : "pedal turns"} · ${s.flowers} markers`]
  ];
  $("#sumGrid").innerHTML = tiles.map(([l, v, m, sub]) => `<div class="card stat"><span class="lbl">${l}</span><b>${v}</b>${m !== null ? `<div class="meter"><i style="width:${m}%"></i></div><span class="lbl">${m}% of the time</span>` : `<span class="lbl">${sub}</span>`}</div>`).join("");
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri"], days = myDays(), ti = todayIdx();
  $("#sumWeek").innerHTML = `<span class="lbl" style="font-size:var(--t-b)">This week</span>` + names.map((n, i) => `<div class="wday${i === ti ? " today" : ""}"><span class="d">${days[i] ? sunflowerSVG() : ""}</span>${i === ti ? "Today" : n}</div>`).join("");
}
function renderClub() {
  const ti = todayIdx();
  const members = PROFILES.map((p) => ({ name: p.name, look: p.look, me: p.id === S.profile.id, days: p.id === S.profile.id ? myDays() : BASE_DAYS[p.id].map((v, i) => (i > ti ? null : v)) }))
    .concat(OTHERS.map((o) => ({ name: o.name, look: o.look, me: false, days: o.days.map((v, i) => (i > ti ? null : v)) })));
  members.forEach((m) => (m.n = m.days.filter((v) => v === 1).length));
  members.sort((a, b) => b.n - a.n || (b.me ? 1 : 0) - (a.me ? 1 : 0) || a.name.localeCompare(b.name));
  let rank = 0, prev = -1;
  $("#clubGrid").innerHTML = members.map((m, i) => { if (m.n !== prev) { rank = i + 1; prev = m.n; }
    return `<button class="f tile mtile${m.me ? " me" : ""}" data-key="m-${m.name}" data-wave="${m.me ? "" : m.name}"><span class="rank">${rank}</span><span class="av">${avatarSVG(m.look)}</span>
    <span class="m-info"><span class="m-name">${m.me ? m.name + " (you)" : m.name}</span><span class="m-dots">${m.days.map((v) => `<i class="${v === 1 ? "on" : v === null ? "fut" : ""}"></i>`).join("")}</span>
    <span class="m-days">${m.n} of ${ti + 1} days${m.me ? "" : S.waved.has(m.name) ? " · waved" : " · press OK to wave"}</span></span></button>`; }).join("");
  $("#priyaAv").innerHTML = avatarSVG(PRIYA);
}

/* ---------- actions ---------- */
function finish() {
  band.send("STOP");
  G = null; sim.moving = false; $("#banner").hidden = true;
  if (S.session) S.session.paused = true;
  sfx("done"); go("summary", "sumClubBtn");
}
function ensureProfile() { if (!S.profile) S.profile = PROFILES[0]; }
function setWorkout(w) {
  S.workout = w; band.send("MODE", w);
  $$("#wkBtns button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.wk === w));
  if (S.view === "live" || S.view === "game") { G = null; if (S.overlay) closeOverlay(); startSession(); show("live", "gameBtn"); }
  else if (RENDER[S.view]) { RENDER[S.view](); requestAnimationFrame(() => focusDefault()); }
}
screen.addEventListener("click", (e) => {
  unlockAudio();
  const el = e.target.closest(".f"); if (!el || !screen.contains(el)) return;
  if (el !== cur) setFocus(el, true);
  if (el.dataset.pid) { S.profile = PROFILES.find((p) => p.id === el.dataset.pid); band.send("NAME", S.profile.name); sfx("ok"); go("plan", "w-" + S.profile.rec); return; }
  if (el.dataset.wk && el.classList.contains("wtile")) { sfx("ok"); setWorkout(el.dataset.wk); go("band", "startBtn"); return; }
  if (el.dataset.go === "back") { back(); return; }
  if (el.dataset.go === "club") { sfx("ok"); go("club"); return; }
  if (el.dataset.wave !== undefined && el.classList.contains("mtile")) {
    if (!el.dataset.wave) { toast("That's you. Keep it up!"); return; }
    S.waved.add(el.dataset.wave); sfx("wave"); toast(`You sent ${el.dataset.wave} a wave`);
    const key = el.dataset.key; renderClub(); requestAnimationFrame(() => focusDefault(key ? $$("#clubGrid .f").find((x) => x.dataset.key === key) : null)); return;
  }
});
screen.addEventListener("mouseover", (e) => { const el = e.target.closest(".f"); if (el && el !== cur && items().includes(el)) setFocus(el); });
screen.addEventListener("focusin", (e) => { const el = e.target.closest(".f"); if (el && el !== cur && items().includes(el)) setFocus(el, true); });
$("#startBtn").onclick = () => { sfx("ok"); startSession(); go("live", "gameBtn"); };
$("#pauseBtn").onclick = () => { sfx("ok"); openPause(); };
$("#gameBtn").onclick = () => { sfx("ok"); startGame(); };
$("#finishBtn").onclick = () => finish();
$("#gameBackBtn").onclick = () => { sfx("back"); endGame(false); requestAnimationFrame(() => focusDefault("gameBtn")); };
$("#sumClubBtn").onclick = () => { sfx("ok"); go("club", "callBtn"); };
$("#sumDoneBtn").onclick = () => { sfx("ok"); S.session = null; show("home"); };
$("#callBtn").onclick = () => { sfx("ok"); startCall(); };
$("#hangBtn").onclick = () => hangUp();
$("#waveAllBtn").onclick = () => { sfx("wave"); OTHERS.concat(PROFILES).forEach((m) => { if (m.name !== S.profile.name) S.waved.add(m.name); }); toast("You waved to everyone in your club"); $("#waveNote").textContent = "Your club will see your wave the next time they turn on their TV."; renderClub(); };

/* remote + keyboard */
function flashRemote(act) { const b = $(`.rk[data-act="${act}"]`); if (!b) return; b.classList.add("is-down"); setTimeout(() => b.classList.remove("is-down"), 140); }
function press(act) {
  unlockAudio(); flashRemote(act);
  if (act === "rep") { manualRep(); return; }
  if (S.view === "game" && !S.overlay && (act === "up" || act === "down")) {
    if (bandLive()) { toast("Your band sets the pace now"); return; }
    sim.userEff = clamp(sim.userEff + (act === "up" ? 0.08 : -0.08), 0.55, 1.5);
    toast(act === "up" ? (S.workout === "lift" ? "Lifting a little faster" : "Going a little faster") : (S.workout === "lift" ? "Lifting a little slower" : "Going a little slower")); return;
  }
  if (act === "ok") { if (cur && items().includes(cur)) cur.click(); else focusDefault(); return; }
  if (act === "back") { back(); return; }
  move(act);
}
$$(".rk").forEach((b) => { b.addEventListener("mousedown", (e) => e.preventDefault()); b.addEventListener("click", () => press(b.dataset.act)); });
addEventListener("keydown", (e) => {
  const inSide = e.target.closest && e.target.closest(".side, .topbar, .tools");
  if (panels.isOpen() && e.key !== "Escape") return;
  const map = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Enter: "ok", Backspace: "back", Escape: "back", " ": "rep" };
  const act = map[e.key]; if (!act) return;
  if (inSide && (e.key === "Enter" || e.key === " ")) return;
  e.preventDefault(); press(act);
});

/* demo panel */
$$("#speedBtns button").forEach((b) => b.addEventListener("click", () => { S.speed = +b.dataset.speed; $$("#speedBtns button").forEach((x) => x.setAttribute("aria-pressed", x === b)); toast(`Time runs ${S.speed}x faster`); }));
$$("#wkBtns button").forEach((b) => b.addEventListener("click", () => { unlockAudio(); setWorkout(b.dataset.wk); }));
function needLive() { if (!S.session || !(S.view === "live" || S.view === "game")) { ensureProfile(); startSession(); show("live", "gameBtn"); } if (S.session.paused && !S.overlay) { S.session.paused = false; sim.moving = true; } }
$$("[data-ev]").forEach((b) => b.addEventListener("click", () => {
  unlockAudio(); const ev = b.dataset.ev; panels.close();
  if (ev === "rep") { manualRep(); return; }
  if (S.overlay && ev !== "rep") { toast("Finish the message on screen first"); return; }
  needLive();
  if (ev === "spo2") { sim.ev.spo2 = 14; toast("Simulating an oxygen dip"); }
  if (ev === "hr") { sim.ev.hr = 18; toast("Simulating a heart-rate spike"); }
  if (ev === "overdo") { sim.ev.overdo = 22; toast("Simulating overdoing it"); }
  if (ev === "still") { sim.ev.still = true; sim.lastMove = sim.t - (stillLimit() - 0.8); toast("Simulating no movement"); }
  if (ev === "done") { const s = S.session, d = D(); if (S.workout === "lift") { s.reps = d.reps * d.sets; s.count = s.reps; } else { s.inZone += Math.max(0, d.min * 60 - s.elapsed) * 0.85; s.elapsed = d.min * 60; s.count = Math.round(s.elapsed / 60 * 112); } }
}));
$$("[data-jump]").forEach((b) => b.addEventListener("click", () => {
  unlockAudio(); const j = b.dataset.jump; ensureProfile(); panels.close();
  if (S.overlay) closeOverlay();
  G = null;
  if (j === "live") { startSession(); show("live", "gameBtn"); }
  else if (j === "game") { if (!S.session) startSession(); show("live"); startGame(); }
  else if (j === "summary") { if (!S.session) sampleSession(); show("summary", "sumClubBtn"); }
  else { if (j !== "club") { S.session = null; sim.moving = false; } show(j); }
}));
const BLUETOOTH_OFF_IN_BROWSER = "Bluetooth for web pages is switched off in this browser. Open chrome://flags/#enable-web-bluetooth (in Vivaldi: vivaldi://flags/#enable-web-bluetooth), set it to Enabled, and restart the browser. USB works without it.";
$$("[data-band]").forEach((b) => b.addEventListener("click", async () => {
  unlockAudio(); const kind = b.dataset.band;
  if (kind === "off") { await band.disconnect(); toast("Band disconnected. Showing simulated readings."); return; }
  if (!BandLink.support()[kind]) {
    $("#bandStatus").textContent = kind === "bluetooth" ? BLUETOOTH_OFF_IN_BROWSER : "This browser can't use USB devices. Open the page in Chrome, Edge or Vivaldi.";
    toast(kind === "bluetooth" ? "Bluetooth needs one browser setting. The steps are in Demo controls." : "Open this page in Chrome, Edge or Vivaldi to use USB.");
    return;
  }
  if (kind === "bluetooth" && navigator.bluetooth.getAvailability && !(await navigator.bluetooth.getAvailability().catch(() => true))) {
    $("#bandStatus").textContent = "Bluetooth is switched off on this computer. Turn it on, then try again.";
    toast("Turn on this computer's Bluetooth first");
    return;
  }
  try { await band.connect(kind); }
  catch (e) { toast(e && e.name === "NotFoundError" ? "No band chosen" : `Couldn't connect to the band: ${e && e.message ? e.message : e}`); }
}));
$("#soundBtn").addEventListener("click", () => { S.sound = !S.sound; unlockAudio(); $("#soundBtn").textContent = S.sound ? "Sound on" : "Sound off"; $("#soundBtn").setAttribute("aria-pressed", S.sound); if (S.sound) sfx("ok"); });
addEventListener("pointerdown", unlockAudio, { once: true });

/* ---------- phone controller (designs/controller, served by launch.py) ---------- */
// The controller sends commands through launch.py; each one presses the same
// button a presenter would, so it behaves exactly like the on-screen controls.
const REMOTE_OK = {
  press: ["up", "down", "left", "right", "ok", "back", "rep"],
  event: ["spo2", "hr", "overdo", "still", "done"],
  jump: ["home", "plan", "band", "live", "game", "summary", "club"],
  speed: ["1", "5", "20", "60"],
  workout: ["walk", "cycle", "lift"],
  profile: PROFILES.map((p) => p.id)
};
function labelOf(el) {
  const name = el.querySelector(".t-name, .m-name");
  return (el.getAttribute("aria-label") || (name ? name.textContent : el.textContent)).replace(/\s+/g, " ").trim().slice(0, 48);
}
function clickFirst(selector) { const el = $(selector); if (el) el.click(); }
function remoteCommand(c) {
  const ok = (kind, value) => REMOTE_OK[kind].includes(String(value));
  if (c.type === "press" && ok("press", c.act)) press(c.act);
  else if (c.type === "event" && ok("event", c.ev)) clickFirst(`[data-ev="${c.ev}"]`);
  else if (c.type === "jump" && ok("jump", c.to)) clickFirst(`[data-jump="${c.to}"]`);
  else if (c.type === "speed" && ok("speed", c.value)) clickFirst(`[data-speed="${c.value}"]`);
  else if (c.type === "workout" && ok("workout", c.w)) clickFirst(`#wkBtns [data-wk="${c.w}"]`);
  else if (c.type === "sound") clickFirst("#soundBtn");
  else if (c.type === "profile" && ok("profile", c.id)) {
    if (S.view !== "home") clickFirst('[data-jump="home"]');
    requestAnimationFrame(() => clickFirst(`[data-pid="${c.id}"]`));
  } else if (c.type === "tap") {  // a button that is on the TV right now
    const list = items(), at = list[c.index];
    const el = at && labelOf(at) === c.label ? at : list.find((x) => labelOf(x) === c.label);
    if (el) el.click();
  }
}
const VIEW_NAMES = { home: "Choosing a participant", plan: "Choosing a workout", band: "Putting the band on", live: "Workout in progress",
  game: "Minigame", summary: "Today's summary", club: "Club this week", call: "Video call" };
function remoteState() {
  const s = S.session, d = D(), w = S.workout, t = $("#toast");
  return {
    view: S.view, screen: VIEW_NAMES[S.view] || S.view, overlay: S.overlay || "",
    profile: S.profile ? S.profile.id : "", name: S.profile ? S.profile.name : "", workout: w,
    speed: String(S.speed), sound: S.sound,
    hr: hrText(), o2: o2Text(), zone: sim.hrOk ? zoneOf(sim.hr)[0] : "Finding the pulse",
    pace: w === "lift" ? (sim.tempo ? `${sim.tempo.toFixed(1)} s per lift` : "No lifts yet") : `${Math.round(sim.cad)} ${W().unit}`,
    dose: s ? Math.round(clamp(doseFrac(), 0, 1) * 100) : null,
    progress: s ? (w === "lift" ? `${s.reps} of ${d.reps * d.sets} lifts` : `${fmtTime(s.elapsed)} of ${d.min} minutes`) : "",
    paused: !!(s && s.paused), band: $("#bandStatus").textContent, bandLive: bandLive(),
    toast: t.classList.contains("show") ? t.textContent : "",
    actions: items().slice(0, 12).map((el, index) => ({ index, label: labelOf(el) })).filter((x) => x.label)
  };
}
if (location.protocol === "http:") {  // served locally by launch.py; GitHub Pages has no controller
  const events = new EventSource("/remote/events");
  let open = false, lastSent = "", lastAt = 0;
  events.onopen = () => { open = true; lastSent = ""; };
  events.onmessage = (e) => { try { remoteCommand(JSON.parse(e.data)); } catch (err) { /* ignore malformed */ } };
  events.onerror = () => { open = false; if (events.readyState === EventSource.CLOSED) events.close(); };
  setInterval(() => {
    if (!open) return;
    const state = JSON.stringify(remoteState());
    if (state === lastSent && performance.now() - lastAt < 4000) return;  // unchanged: a heartbeat every 4 s
    lastSent = state; lastAt = performance.now();
    fetch("/remote/state", { method: "POST", headers: { "Content-Type": "text/plain" }, body: state }).catch(() => {});
  }, 400);
}

/* ---------- main loop ---------- */
let last = performance.now();
function frame(now) {
  const rdt = frameDelta(now, last); if (Number.isFinite(now)) last = now; const t = now / 1000;
  const sdt = rdt * (Number.isFinite(S.speed) && S.speed > 0 ? S.speed : 1), n = clamp(Math.ceil(sdt / 0.04), 1, 60);
  const isLive = bandLive();
  if (isLive !== wasLive) {
    wasLive = isLive; renderBandStatus();
    if (!isLive && band.state === "on") toast("No readings from the band. Showing simulated readings.");
  }
  if (isLive) { const reps = advanceLive(sim, live, rdt, {workout: S.workout, plan: D(), profile: S.profile}); for (let i = 0; i < reps; i++) onDetect(false, true); }
  else for (let i = 0; i < n; i++) simSub(sdt / n);
  const coachFreq = S.workout === "lift" ? 1 / W().target : W().target / 60;
  sim.coachPhase += 2 * Math.PI * coachFreq * rdt;
  tickSession(sdt);
  coachTick(now);
  if (S.view === "live") {
    const o = canv.liveCanvas;
    if (o.w) {
      const sp = S.workout === "lift" ? 0.012 : 0.12 * clamp(sim.cad / W().target, 0, 1.8);
      if (running()) sim.scroll = (sim.scroll || 0) + o.w * sp * rdt * (reduceMotion ? 0.4 : 1);
      drawScene(o.x, o.w, o.h, sim.scroll || 0, S.workout === "lift" ? "evening" : "day", t);
      drawFig(o.x, o.w * 0.5, o.h * 0.885, o.h * 0.14, S.profile.look, S.workout === "cycle" ? "cycle" : S.workout === "lift" ? "lift" : "walk", sim.phase, t, true);
    }
    drawPip(t); drawTrace(canv.traceCanvas, sim.trace);
  } else if (S.view === "game") gameStep(rdt, t);
  else if (S.view === "band") drawTrace(canv.bandTrace, sim.trace.slice(-90));
  updateLive();
  requestAnimationFrame(frame);
}

/* boot */
renderBandStatus();
setInterval(() => band.send("PING"), 2000);  // lets the band show that the TV is listening
show("home");
requestAnimationFrame(frame);
