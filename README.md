# Surfscape

Surfscape is a browser-based 3D surfing game driven by current marine forecast data. Pick an exact paddle-out on a real OpenStreetMap shoreline, read the local swell, walk into the water, paddle beyond the break, and surf a procedural wave set.

You can also walk up to the coast road, enter the Surfscape van, and drive between peaks with three boards on the roof rack.

Those three boards form a playable quiver: the Apex performance shortboard turns fastest and scores technical surfing, the Drift Twin fish carries speed through weaker sections, and the Horizon longboard paddles easily, stabilizes balance, and unlocks stronger nose rides.

## Play locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Controls

- `WASD` or arrow keys: walk, paddle, and steer
- Drag the open scene: orbit the chase camera; double-click or double-tap to recenter
- `W` while riding: move forward and pump for speed (uses stamina)
- `S` while riding: step toward the tail for tighter rail control
- Mouse horizontal position: balance while riding
- `Space`: catch a wave; while riding, land a context-sensitive maneuver
- `Space` beside the parked van: enter; stop and press again to exit
- `Esc`: pause
- Mobile: analog movement stick, precision balance rail, phase haptics, and a context-sensitive Move/Paddle/Catch/Trick/Drive button

Wave sets build and fade on the swell radar. Once caught, a GPU-shaped wave face steepens beside the surfer, pitches a translucent falling-water curtain, throws directional crest spray, and closes into a misty barrel as line quality rises. Live cloud cover and wind shape a moving marine sky with haze, sun corona, moonlight, and night-star visibility. Better-timed catches start with more flow, while stamina management, nose-to-tail stance, line choice, balance, and rail pressure determine whether a Lip Snap, Foam Floater, Pocket Cutback, Rail Carve, Power Pump, High Line, Nose Ride, or Tail Release lands cleanly. Session objectives, per-wave recaps, grades, and personal bests are saved in the browser.

## Live data

Surfscape reads current wave height, direction, period, swell, ocean current, sea level/tide, sea temperature, wind, cloud cover, sunrise, and sunset from [Open-Meteo](https://open-meteo.com/). Coastal model output is for gameplay and is not suitable for navigation. Shoreline maps use [OpenStreetMap](https://www.openstreetmap.org/) with visible attribution.

If the APIs are temporarily unavailable, each break has a modeled fallback so the game stays playable offline after its code has loaded.

## Character asset

The in-game surfer is an articulated Blender-authored GLB with named joints for the live walk, paddle, stance, maneuver, barrel, and wipeout poses. The current character uses athletic human proportions, tapered anatomy, a detailed face, five-finger hands, articulated bare feet, layered wet hair, and a PBR limestone-neoprene suit with stretch panels, reinforced knees, sealed seams, and restrained Surfscape branding. The checked-in model can be regenerated on macOS with Blender installed:

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build-surfer-model.py
```

The script exports `public/models/surfer-premium.glb` and renders a local QA preview before the application build.

## Vehicle asset

The drivable two-tone surf expedition van is also Blender-authored. Its compact PBR GLB includes a modeled cabin and dash, all-terrain tires, detailed wheels, mirrors, lights, bumpers, awning, rear ladder and spare, plus a strapped three-board roof quiver. Named steering, wheel, body, headlight, and brake-light joints keep those details live in the driving simulation. Regenerate it with:

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build-van-model.py
```

The script exports `public/models/surf-van-premium.glb` and renders a local QA preview before the application build.

## Deploy to GitHub Pages

The workflow in `.github/workflows/deploy-pages.yml` builds and publishes the static `out` directory on every push to `main`. In the repository settings, set **Pages → Source** to **GitHub Actions**.

The build automatically accounts for project-page paths such as `username.github.io/surfscape`.

## Scope

This version is a high-quality vertical slice: one detailed surfer, thirteen coastlines with urban, tropical, dune, cliff, cold-water, volcanic, and desert environments, selectable zones, live conditions, premium terrain materials, a fiberglass three-board quiver with distinct silhouettes and hardware, directional Gerstner swells, a live breaking-wave face, stance/stamina/barrel/maneuver systems, reactive wake and spray, cinematic ride cameras, training/advanced/playground modes, persistent scoring, a drivable surf van, adaptive procedural audio, and responsive desktop/mobile controls. It is intentionally single-player; crowds and lineup etiquette are future systems.
