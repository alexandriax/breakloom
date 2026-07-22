# Surfscape

Surfscape is a browser-based 3D surfing game driven by current marine forecast data. Pick an exact paddle-out on a real OpenStreetMap shoreline, read the local swell, walk into the water, paddle beyond the break, and surf a procedural wave set.

You can also walk up to the coast road, enter the Surfscape van, and drive between peaks with three boards on the roof rack.

## Play locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Controls

- `WASD` or arrow keys: walk, paddle, and steer
- `W` while riding: move forward and pump for speed (uses stamina)
- `S` while riding: step toward the tail for tighter rail control
- Mouse horizontal position: balance while riding
- `Space`: catch a wave; while riding, land a context-sensitive maneuver
- `Space` beside the parked van: enter; stop and press again to exit
- `Esc`: pause
- Mobile: on-screen D-pad, balance rail, and context-sensitive Catch/Move button

Wave sets build and fade on the swell radar. Better-timed catches start with more flow, while stamina management, nose-to-tail stance, line choice, balance, and rail pressure determine whether a Lip Snap, Foam Floater, Pocket Cutback, Rail Carve, Power Pump, High Line, Nose Ride, or Tail Release lands cleanly. Stay composed high on the face to hold the barrel. Session objectives, per-wave recaps, grades, and personal bests are saved in the browser.

## Live data

Surfscape reads current wave height, direction, period, swell, ocean current, sea level/tide, sea temperature, wind, cloud cover, sunrise, and sunset from [Open-Meteo](https://open-meteo.com/). Coastal model output is for gameplay and is not suitable for navigation. Shoreline maps use [OpenStreetMap](https://www.openstreetmap.org/) with visible attribution.

If the APIs are temporarily unavailable, each break has a modeled fallback so the game stays playable offline after its code has loaded.

## Deploy to GitHub Pages

The workflow in `.github/workflows/deploy-pages.yml` builds and publishes the static `out` directory on every push to `main`. In the repository settings, set **Pages → Source** to **GitHub Actions**.

The build automatically accounts for project-page paths such as `username.github.io/surfscape`.

## Scope

This version is a high-quality vertical slice: one procedural surfer, thirteen coastlines, selectable zones, live conditions, grouped wave sets, stance/stamina/barrel/maneuver systems, reactive wake and spray, cinematic ride cameras, training/advanced/playground modes, persistent scoring, a drivable surf van, adaptive procedural audio, and responsive desktop/mobile controls. It is intentionally single-player; crowds and lineup etiquette are future systems.
