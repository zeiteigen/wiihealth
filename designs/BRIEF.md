# Shared design brief: gamified smart-wristband frontend (15 iterations)

## The project
ECE 198 (University of Waterloo) team project for CCCARE (Centre for Community, Clinical & Applied
Research Excellence), which runs exercise programs for **older adults**: general fitness, people in or
recovering from cancer treatment, stroke survivors, and program graduates exercising on their own.
CCCARE's problems:
- Personalized exercise "dosage" (type + amount of activity, set by kinesiologists, adjusted over time).
- Tracking quality of exercise when one instructor supervises 10–12 patients (up to 30 graduates):
  some under-do their dose, some overdo it.
- Remote / at-home care: combat isolation, keep community, confirm patients do the right exercise at
  the right dose, without breaching privacy.

## The hardware
A smart wristband/strap with:
- **Pulse oximeter** → heart rate (BPM) and blood oxygen (SpO2 %).
- **3-axis accelerometer** → reps, cadence, motion quality (smoothness, range, tempo), stillness/falls.
Three workouts:
- **Running / walking** — band worn on the **leg** (steps, cadence spm, stride regularity).
- **Cycling** (stationary or outdoor) — band worn on the **leg** (pedal RPM, smoothness).
- **Dumbbell** (curls, presses, lateral raises) — band worn on the **wrist** (rep count, range of
  motion, tempo, left/right).

## The goal
Track patient statistics AND game-ify the workout: cool animations, leaderboards, minigames, rewards.
Aesthetic: **inspired by the late-2000s motion-control sports console era** — bright clean whites, sky
blues, glossy rounded "bubble" buttons, soft drop shadows, friendly rounded type, cheerful chimes,
cartoony round-headed avatars, sunny outdoor plazas, big readable UI.

## Hard rules
- **Original work only.** Evoke the era's feel; do NOT recreate any specific existing game or console UI.
  No Nintendo/"Wii"/Mii/"Wii Fit"/"Wii Sports" names, logos, characters, music, or screen layouts.
  Draw your own avatars (simple shapes: round heads, bean bodies) — not Mii lookalikes. Invent a
  product name for your iteration (2 words max, no "Wii").
- **Audience is older adults.** Large type (≥18px body on the participant-facing screens), high
  contrast, big tap targets, plain language, no tiny jargon. Celebrate consistency and completing the
  prescribed dose over raw speed. Safety is visible: HR target zone from the dosage, SpO2 warning
  below ~92%, "slow down / take a break" prompts, overdoing-it detection.
- **Demo mode that fully works.** No real hardware is attached, so the page must ship a convincing
  **simulated sensor stream** (HR, SpO2, accel x/y/z at a believable rate) that drives everything.
  A viewer must be able to click through the entire experience: pick a participant/profile → choose
  a workout (all three: running, cycling, dumbbell, each showing correct band placement) → live
  session with real-time gamified feedback → at least one playable minigame → safety alert moment
  (provide a demo button to trigger e.g. a SpO2 dip or HR spike) → session summary with dose
  completion → leaderboard/community view. Include an obvious "Demo controls" affordance (e.g. a
  small panel to speed up time, trigger events, switch workouts) so a presenter at the symposium can
  show every feature in ~3 minutes. Optionally let keyboard keys stand in for reps (e.g. Space = rep).
- Accelerometer-derived numbers should be plausible (cadence 100–130 spm walking/jogging for this
  population, 50–80 RPM cycling, curls ~2–4 s per rep). Show a live mini sparkline/trace of the raw
  signal somewhere so engineers see the sensor is "real".
- Use Web Audio for optional sound effects started from a user click (with a mute toggle); never autoplay.

## Technical constraints (artifact page)
- **Load the `artifact-design` skill first** (Skill tool) and follow its page contract exactly
  (no doctype/html/head/body tags; `<title>` at top; CDN allowlist; theme tokens; phone-width safe;
  prefers-reduced-motion respected; no alert/confirm/prompt).
- One self-contained `index.html` in your assigned folder. Inline CSS/JS. Libraries only from the
  allowlisted CDNs with exact pinned versions (e.g. three.js r128 from cdnjs) if truly needed.
  Fonts from Google Fonts only. Draw art with CSS/SVG/Canvas — no external images.
- This is a game-like editorial piece: it may commit to a single (light, sunny) theme by choice, but
  then set every color explicitly and set body background.
- Make it robust: no console errors, every button does something, the first frame looks good at rest.
- Do at most one visual check if your session offers one, one round of fixes, then publish with the
  Artifact tool (give it an `icon`, a 2–4 word `<title>` that is your product name, and a one-sentence
  `description`). Do not iterate endlessly.

## What to report back (short)
1. Product name + one-line concept.
2. Artifact URL and the absolute path of the file.
3. 4–6 bullets: the distinctive ideas (signature screen, minigame(s), how leaderboard works, how safety
   is shown, how sensor sim works).
4. Anything that doesn't work or was cut.
