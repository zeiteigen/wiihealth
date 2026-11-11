# Sunroom TV

Sunroom TV is the current main design at `/`. All 15 concepts remain in the gallery at `/collection.html`. Sunroom uses local HTML, CSS, and JavaScript modules; the other concepts retain their standalone pages.

Launch from the project root:

```sh
python designs/launch.py
```

This opens <http://localhost:4173/> in your default browser. Use `--port 4174` if that port is occupied, or `--no-browser` to serve without opening a tab. Stop with Ctrl+C. The server is bound to your computer only.

Serve the folder with the launcher: Sunroom uses ES modules and needs HTTP. Use **All concepts** in the floating toolbar to open the gallery. **Remote** and **Demo controls** toggle overlays; Escape closes them. Screens scroll when content exceeds the available height.

Choose a participant and workout, then open **Demo controls** inside a concept to accelerate the simulation, trigger safety events, and explore the remaining screens. All readings and participants are demonstration data; no hardware connection is needed. The instructor concept focuses on the class overview.

The concepts use Google Fonts. Breezy Isle and Toybox Gym also load pinned Three.js r128 from cdnjs; their source includes fallback handling for unavailable 3D rendering.

Validation: inline JavaScript syntax checked for all 15 concepts; gallery JavaScript syntax checked; local page references checked. Browser checks cover opening screens, workout switching, summary/community navigation, and deliberately triggered oxygen alerts. Inactive screens and dialogs explicitly respect the HTML `hidden` attribute so layout styles cannot leave rest overlays blocking the controls.

Sunroom sensor regression tests: `node --test designs/14-tv-tenfoot/tests/sensor.test.mjs`. Browser checks cover all three workouts and games, numerical readings, safety recovery, overlay controls, and summary scrolling at desktop, phone, and short-window sizes.
