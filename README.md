# Surfscape

Surfscape is a browser-based 3D surfing game driven by current marine forecast data. Pick an exact paddle-out on a real OpenStreetMap shoreline, read the local swell, walk into the water, paddle beyond the break, and surf a procedural wave.

You can also walk up to the coast road, enter the Surfscape van, and drive between peaks with three boards on the roof rack.

## Play locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Controls

- `WASD` or arrow keys: walk, paddle, and steer
- Mouse horizontal position: balance while riding
- `Space`: catch a wave
- `Space` beside the parked van: enter; stop and press again to exit
- `Esc`: pause
- Mobile: on-screen D-pad, balance rail, and Catch button

## Live data

Surfscape reads current wave height, direction, period, swell, ocean current, sea level/tide, sea temperature, wind, cloud cover, sunrise, and sunset from [Open-Meteo](https://open-meteo.com/). Coastal model output is for gameplay and is not suitable for navigation. Shoreline maps use [OpenStreetMap](https://www.openstreetmap.org/) with visible attribution.

If the APIs are temporarily unavailable, each break has a modeled fallback so the game stays playable offline after its code has loaded.

## Deploy to GitHub Pages

The workflow in `.github/workflows/deploy-pages.yml` builds and publishes the static `out` directory on every push to `main`. In the repository settings, set **Pages → Source** to **GitHub Actions**.

The build automatically accounts for project-page paths such as `username.github.io/surfscape`.

## Scope

This version is a high-quality vertical slice: one procedural surfer, thirteen coastlines, selectable zones, live conditions, training/advanced/playground modes, scoring, procedural audio, and responsive desktop/mobile controls. It is intentionally single-player; crowds and lineup etiquette are future systems.
