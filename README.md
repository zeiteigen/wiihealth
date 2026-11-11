# Sunroom TV

A TV-friendly exercise prototype for the ECE 198 CCCARE project. Sunroom TV is the current main design; the original collection of 15 interactive concepts is preserved in `designs/`.

- [Open Sunroom TV](https://zeiteigen.github.io/wiihealth/)
- [Browse all 15 concepts](https://zeiteigen.github.io/wiihealth/collection.html)

The demo uses simulated participants, heart rate, oxygen, and movement signals. No wristband is required, and calls and notifications do not contact anyone.

## Local preview

```sh
python designs/launch.py
```

Use the floating **Remote** and **Demo controls** buttons to open the optional controls. Arrow keys and Enter navigate the screen; Space simulates a step or lift. Screens scroll when their contents exceed the viewport.

## Tests

```sh
node --test designs/14-tv-tenfoot/tests/sensor.test.mjs
```

## GitHub Pages

Pushes to `main` run the sensor tests, package the static files from `designs/`, and deploy through GitHub Actions. No application build or dependency installation is needed.

```sh
python scripts/build-pages.py
python -m http.server --directory _site 4173
```

The site uses relative asset paths so it works under the GitHub Pages repository path. Local captures, environment files, and the course PDF are excluded from the repository. Only HTML, CSS, and JavaScript are included in the deployed site.
