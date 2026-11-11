// Small, consistent geometric symbols. No illustrated characters or scenery.
export function sunflowerSVG(cls = '') {
  return `<svg viewBox="0 0 48 48" class="${cls}" aria-hidden="true"><circle cx="24" cy="24" r="18" fill="#ffc52e"/><path d="m16 24 6 6 11-12" fill="none" stroke="#183b56" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export function avatarSVG(look) {
  return `<svg viewBox="0 0 120 120" aria-hidden="true"><rect width="120" height="120" rx="28" fill="${look.shirt}"/><text x="60" y="79" text-anchor="middle" fill="white" font-family="system-ui,sans-serif" font-size="56" font-weight="600">${look.initial || 'P'}</text></svg>`;
}

export function figSVG(kind) {
  const paths = {
    walk: '<path d="M39 97c-9-8-19-3-21 10l-5 31c-1 9 6 12 11 5l23-29c5-7 0-12-8-17ZM78 39c-9-8-19-3-21 10l-5 31c-1 9 6 12 11 5l23-29c5-7 0-12-8-17Z"/><path d="m28 159-4 9m50-72-4 9"/>',
    cycle: '<circle cx="33" cy="119" r="25"/><circle cx="123" cy="119" r="25"/><path d="m33 119 29-50 30 50H33l51-64 39 64M52 69h23m5-14h20"/>',
    lift: '<path d="m53 74 45 45M34 83l29-29m23 83 29-29M24 73l29-29m43 103 29-29"/>'
  };
  return `<svg class="fig" viewBox="0 0 160 200" aria-hidden="true"><g fill="none" stroke="#236dad" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" transform="translate(5 0)">${paths[kind] || paths.lift}</g></svg>`;
}

export function placementSVG(workout) {
  const wrist = workout === 'lift';
  return `<svg class="fig" viewBox="0 0 200 240" aria-hidden="true"><g fill="none" stroke="#a9bfd1" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"><circle cx="96" cy="35" r="16" fill="#a9bfd1" stroke="none"/><path d="M96 69v67m0-53-37 43m37-43 38 43M96 136l-25 71m25-71 26 71"/></g><rect x="${wrist ? 121 : 107}" y="${wrist ? 110 : 181}" width="30" height="17" rx="5" fill="#236dad"/><circle cx="${wrist ? 136 : 122}" cy="${wrist ? 118 : 189}" r="26" fill="none" stroke="#e2aa24" stroke-width="3"/></svg>`;
}

export function drawScene(c, w, h, off, theme) {
  c.fillStyle = theme === 'night' ? '#e8eef8' : '#edf5fb';
  c.fillRect(0, 0, w, h);
  // A simple route and evenly spaced progress markers.
  c.strokeStyle = '#d6e5f0'; c.lineWidth = h * .12;
  c.beginPath(); c.moveTo(0, h * .83); c.lineTo(w, h * .83); c.stroke();
  c.strokeStyle = '#b4cedf'; c.lineWidth = Math.max(2, h * .004);
  c.setLineDash([w * .025, w * .035]); c.lineDashOffset = -off;
  c.beginPath(); c.moveTo(0, h * .83); c.lineTo(w, h * .83); c.stroke(); c.setLineDash([]);
}

export function drawFig(c, x, y, size, look, pose, phase) {
  const r = size * .23;
  c.fillStyle = '#236dad'; c.beginPath(); c.arc(x, y - r, r, 0, Math.PI * 2); c.fill();
  c.strokeStyle = '#fff'; c.lineWidth = Math.max(2, r * .12); c.lineCap = 'round';
  c.beginPath(); c.moveTo(x - r * .35, y - r); c.lineTo(x, y - r * 1.35); c.lineTo(x + r * .35, y - r); c.stroke();
  const pulse = .5 + .5 * Math.sin(phase);
  c.strokeStyle = '#236dad55'; c.lineWidth = 2;
  c.beginPath(); c.arc(x, y-r, r * (1.25 + pulse * .3), 0, Math.PI * 2); c.stroke();
}

export function drawFlowerHead(c, x, y, radius, open) {
  c.fillStyle = open > .5 ? '#dfaa29' : '#a7bbca';
  c.beginPath(); c.arc(x, y, radius * .7, 0, Math.PI * 2); c.fill();
  c.strokeStyle = '#fff'; c.lineWidth = Math.max(2, radius * .12);
  c.beginPath(); c.moveTo(x-radius*.25,y); c.lineTo(x,y+radius*.22); c.lineTo(x+radius*.3,y-radius*.25); c.stroke();
}

export function drawSunflower(c, x, ground, height, radius, open) {
  drawFlowerHead(c, x, ground-height, radius, open);
}
