# Sunroom TV

A TV-friendly exercise prototype for the ECE 198 CCCARE project. Sunroom TV is the current main design; the original collection of 15 interactive concepts is preserved in `designs/`.

- [Open Sunroom TV](https://zeiteigen.github.io/wiihealth/)
- [Browse all 15 concepts](https://zeiteigen.github.io/wiihealth/collection.html)

The demo uses simulated participants, heart rate, oxygen, and movement signals, so no wristband is required. Calls and notifications do not contact anyone.

The ESP32 wristband in `firmware/` can drive it with real readings: open **Demo controls > Wristband** in Chrome or Edge and connect by USB or Bluetooth. See [firmware/README.md](firmware/README.md) for wiring, flashing, and the protocol.

## Local preview

```sh
python designs/launch.py
```

The launcher also starts a phone-friendly **controller** on port 4174 (`http://localhost:4174/`). It drives the Sunroom TV page from a second screen: tap the TV's on-screen buttons, use a remote, pick participants and workouts, trigger safety moments, and watch live heart rate, oxygen and dose progress. If Tailscale is running, the controller is also reachable from your phone at the tailnet address the launcher prints (for example `http://<laptop>.<tailnet>.ts.net:4174/`); the TV page itself stays on the laptop. Keep one Sunroom TV tab open while using it. Connect the wristband on the TV page itself.

The floating **Remote** and **Demo controls** buttons on the TV page still open the same controls on screen. Arrow keys and Enter navigate the screen; Space simulates a step or lift. Screens scroll when their contents exceed the viewport.

## Tests

```sh
node --test "designs/14-tv-tenfoot/tests/*.test.mjs"
firmware/test/run.sh   # band firmware against simulated sensors
```

## GitHub Pages

Pushes to `main` run the sensor and band-link tests, package the static files from `designs/`, and deploy through GitHub Actions. No application build or dependency installation is needed.

```sh
python scripts/build-pages.py
python -m http.server --directory _site 4173
```

The site uses relative asset paths so it works under the GitHub Pages repository path. Local captures, environment files, and the course PDF are excluded from the repository. Only HTML, CSS, and JavaScript are included in the deployed site.
