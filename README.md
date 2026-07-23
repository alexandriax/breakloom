# Surfscape

Surfscape is a browser-based 3D surfing game driven by current marine forecast data. Pick an exact paddle-out on a real OpenStreetMap shoreline, read the local swell, walk into the water, paddle beyond the break, and surf a procedural wave set.

You can also walk up to the coast road, enter the Surfscape van, and drive between peaks with three boards on the roof rack.

Those three boards form a playable quiver: the Apex performance shortboard turns fastest and scores technical surfing, the Drift Twin fish carries speed through weaker sections, and the Horizon longboard paddles easily, stabilizes balance, and unlocks stronger nose rides. Their fiberglass shells flex and torsionally load under speed, stance, rail pressure, and landings before springing back on release.

## Play locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Controls

- `WASD` or arrow keys: camera-relative movement on land, then paddle and steer in the water
- Hold `Shift` to run on desktop; push the mobile stick fully to run
- Drag the open scene: orbit the chase camera; double-click or double-tap to recenter
- `W` while riding: move forward and pump for speed (uses stamina)
- `S` while riding: step toward the tail for tighter rail control
- Mouse horizontal position: balance while riding
- `Space`: catch a wave; while riding, land a context-sensitive maneuver
- `Space` beside the parked van: enter; stop and press again to exit
- `C`: cycle Follow, Immersive, and Cinematic cameras
- `Esc`: pause
- Mobile: analog movement stick, target-tracking balance rail with landing zones and haptic lock feedback, camera switcher, and a context-sensitive Move/Paddle/Catch/Trick/Drive button

Paddling uses directional board physics: steer to pivot, hold forward or the mobile Paddle control to build momentum, account for current drift, then turn back toward shore before committing to a takeoff. Alternating hand-entry ripples and directional droplets stay synchronized to the articulated paddle stroke so every pull visibly connects to the water.

Wave sets build and fade on the swell radar. Once caught, a GPU-shaped wave face steepens beside the surfer, pitches a translucent falling-water curtain, throws directional crest spray, and closes into a misty barrel as line quality rises. Every ride commits to a moving left or right shoulder: each break's peel and variability sweep the power pocket down the line, so going too deep risks a closeout while outrunning it onto the shoulder loses speed and flow. Live cloud cover, wind, and WMO weather conditions shape a moving marine sky with haze, sun corona, moonlight, rain, snow, sea fog, lightning, night-star visibility, and articulated coastal gulls that alternate between flapping and wind-shaped gliding; Wave Lab can override the weather for custom sessions. Better-timed catches start with more flow, while pocket tracking, stamina management, nose-to-tail stance, balance, and rail pressure determine whether a Lip Snap, Foam Floater, Pocket Cutback, Rail Carve, Power Pump, High Line, Nose Ride, or Tail Release lands cleanly. Session objectives, per-wave recaps, grades, and personal bests are saved in the browser.

## Live data

Surfscape reads current and hourly forecast wave height, direction, period, swell, ocean current, sea level/tide, sea temperature, wind, cloud cover, sunrise, and sunset from [Open-Meteo](https://open-meteo.com/). Wave, current, and wind bearings remain separate all the way into the simulation: the incoming wave vector aims the primary wave field, currents create longshore drift, and wind shapes chop, spray, precipitation, cloud travel, balance, and barrel quality. Tide physically advances or exposes the playable shoreline, wet-sand band, wading depth, paddle transition, lineup, and breaking zone while keeping CPU board motion aligned with the rendered ocean. Wave Lab exposes each vector independently. Coastal model output is for gameplay and is not suitable for navigation. Shoreline maps use [OpenStreetMap](https://www.openstreetmap.org/) with visible attribution.

If the APIs are temporarily unavailable, each break has a modeled fallback so the game stays playable offline after its code has loaded.

## Character asset

The in-game surfer is an articulated Blender-authored GLB with named joints for the live walk, paddle, stance, maneuver, barrel, and wipeout poses. The current character uses athletic human proportions, tapered anatomy, a detailed face, five-finger hands, articulated bare feet, layered wet hair, and a PBR limestone-neoprene suit with stretch panels, reinforced knees, sealed seams, and restrained Surfscape branding. Procedural secondary motion adds exertion-aware breathing, idle gaze and weight shifts, while shared water exposure drives wet materials and post-session runoff droplets. The checked-in model can be regenerated on macOS with Blender installed:

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

This version is a high-quality vertical slice: one detailed surfer, thirteen coastlines with urban, tropical, dune, cliff, cold-water, volcanic, and desert environments, selectable zones, synchronized hourly conditions, premium terrain materials, wind-shaped instanced dune grass, weather-reactive beach fabric, articulated coastal wildlife, a spring-loaded fiberglass three-board quiver with distinct silhouettes and hardware, coast-relative multi-vector Gerstner swells, a live breaking-wave face, stance/stamina/pocket/barrel/maneuver systems, stroke-synchronized paddle splashes, wind-deflected wake and spray, cinematic ride cameras, training/advanced/playground modes, persistent scoring, a drivable surf van, adaptive procedural audio, and responsive desktop/mobile controls. It is intentionally single-player; crowds and lineup etiquette are future systems.
