const concepts = [
  ['01-channel-plaza', 'Pulse Plaza', 'Your daily dose of good energy.', 'A sunny channel plaza turns your exercise plan into a collection of playful activities.', 'play', '☀', '#d9f2ff', '#147cb7'],
  ['02-island-tour', 'Breezy Isle', 'A small step. A new discovery.', 'Walk, ride, and lift your way around a cheerful island with landmarks to unlock.', 'play', '⛵', '#d1f3ed', '#188477'],
  ['03-sports-day', 'Field Day', 'Everyone has a place on the field.', 'A friendly sports festival celebrates completing your personal dose and joining the relay.', 'together', '⚑', '#e5f0ce', '#5d852d'],
  ['04-rhythm-reps', 'Beat Plaza', 'Find a rhythm that feels like you.', 'Follow a musical note highway and turn steady movement into a feel-good performance.', 'play', '♫', '#ede3ff', '#7855ba'],
  ['05-garden-grow', 'Bloom Patch', 'Grow something with every session.', 'Tend a little garden, play a watering game, and watch consistent effort blossom.', 'play', '✿', '#e5f0d5', '#5b8436'],
  ['06-postcard-trip', 'Postcard Trip', 'Good movement takes you places.', 'Collect illustrated postcards as your exercise carries a shared journey down the road.', 'play', '✉', '#ffe9cc', '#b47630'],
  ['07-living-room-club', 'Lamplight Club', 'Your favourite class, closer to home.', 'A warm virtual living room brings a small exercise group and gentle encouragement together.', 'together', '⌂', '#ffe3d7', '#ae6451'],
  ['08-coach-buddy', 'Tumbo Coach', 'A little encouragement goes a long way.', 'A friendly companion helps you set up your band, follow your plan, and celebrate progress.', 'care', '☺', '#d9eeff', '#377ab2'],
  ['09-instructor-gym', 'Circuit Club', 'A clearer view of everyone’s session.', 'An instructor-first gym floor makes participant progress and check-ins easy to follow.', 'care', '▦', '#d7efeb', '#347e74'],
  ['10-checkup-lab', 'Checkup Lab', 'Meet yourself where you are today.', 'Playful movement checks and live signals make a personal exercise plan tangible.', 'care', '⌁', '#e1eaff', '#536db2'],
  ['11-trophy-stamps', 'Medal Hall', 'Little milestones deserve a big cheer.', 'Collect stamps and trophies for consistency, personal progress, and completing your dose.', 'play', '★', '#fff0c4', '#a77b1e'],
  ['12-toybox-3d', 'Toybox Gym', 'Big imagination. Gentle movement.', 'A colourful 3D toy world brings band-driven exercise and a playful toss game to life.', 'play', '◆', '#fce0e8', '#b45378'],
  ['13-league-night', 'League Night', 'On this team, showing up counts.', 'A community league rewards personal dose completion with friendly shared challenges.', 'together', '⚑', '#e8e2ff', '#7552ab'],
  ['14-tv-tenfoot', 'Sunroom TV', 'Make room for a little movement.', 'An extra-readable, television-friendly experience with big controls and a sunny personality.', 'together', '▣', '#d6efff', '#347eaa'],
  ['15-band-companion', 'PairUp Band', 'From first connection to one more turn.', 'Explore band pairing, placement, live sensor signals, and a rep-powered board game.', 'care', '∞', '#e0f0e8', '#4b8468'],
];
const cards = document.querySelector('#cards');
const viewer = document.querySelector('#viewer');
const gallery = document.querySelector('#gallery');
const preview = document.querySelector('#preview');
let current = -1;
let returnFocus;

function renderCards(filter = 'all') {
  const selected = concepts.filter(c => filter === 'all' || c[4] === filter);
  document.querySelector('#count').textContent = selected.length;
  cards.innerHTML = selected.map(c => `<a class="card" href="#${c[0]}" style="--wash:${c[6]};--accent:${c[7]}"><div class="card-art"><span class="concept-no">CONCEPT ${c[0].slice(0, 2)}</span><span class="art-circle"></span><span class="art-symbol" aria-hidden="true">${c[5]}</span><span class="art-dot d1"></span><span class="art-dot d2"></span><span class="art-wave"></span><span class="card-tag">${{play:'Play & explore',care:'Coach & care',together:'Together'}[c[4]]}</span></div><div class="card-copy"><div class="card-heading"><h3>${c[1]}</h3><span class="arrow" aria-hidden="true">↗</span></div><p class="tagline">${c[2]}</p><p class="description">${c[3]}</p><span class="launch">Explore concept <span aria-hidden="true">→</span></span></div></a>`).join('');
}

function syncPreview() {
  const index = concepts.findIndex(c => `#${c[0]}` === location.hash);
  if (index < 0) {
    if (current >= 0) {
      preview.removeAttribute('src');
      document.title = 'Movement Studio — 15 interactive concepts';
      viewer.hidden = true;
      gallery.hidden = false;
      document.body.classList.remove('viewing');
      returnFocus?.focus({preventScroll:true});
    }
    current = -1;
    return;
  }
  if (current < 0) returnFocus = document.activeElement;
  current = index;
  const c = concepts[index];
  document.querySelector('#design-number').textContent = `${String(index + 1).padStart(2, '0')} / 15`;
  document.querySelector('#design-title').textContent = c[1];
  document.querySelector('#standalone').href = `./${c[0]}/index.html?v=rest-fix-2`;
  preview.title = `${c[1]} — interactive exercise demo`;
  preview.src = `./${c[0]}/index.html?v=rest-fix-2`;
  gallery.hidden = true;
  viewer.hidden = false;
  document.body.classList.add('viewing');
  document.title = `${c[1]} — Movement Studio`;
  document.querySelector('#back').focus();
}
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-filter]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
  renderCards(button.dataset.filter);
}));
document.querySelector('#back').addEventListener('click', () => { location.hash = ''; });
document.querySelector('#previous').addEventListener('click', () => { location.hash = concepts[(current + 14) % 15][0]; });
document.querySelector('#next').addEventListener('click', () => { location.hash = concepts[(current + 1) % 15][0]; });
window.addEventListener('hashchange', syncPreview);
renderCards();
syncPreview();
