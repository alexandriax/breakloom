import { readFileSync } from "node:fs";

const appSource = readFileSync(
  new URL("../components/BreakloomApp.tsx", import.meta.url),
  "utf8",
);
const sceneSource = readFileSync(
  new URL("../components/SurfScene.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);
const beachesSource = readFileSync(
  new URL("../lib/beaches.ts", import.meta.url),
  "utf8",
);
const gameSource = readFileSync(
  new URL("../lib/game.ts", import.meta.url),
  "utf8",
);

function invariant(condition, message) {
  if (!condition) throw new Error(`HUD stability contract failed: ${message}`);
}

const boundaryStart = appSource.indexOf("HUD_STABILITY_BOUNDARY:");
const boundaryEnd = appSource.indexOf("HUD_STABILITY_BOUNDARY_END");
invariant(boundaryStart >= 0 && boundaryEnd > boundaryStart, "stable HUD boundary is missing");

const stableHudMarkup = appSource.slice(boundaryStart, boundaryEnd);
[
  'className="game-topbar"',
  'className="hud-vitals"',
  'className="hud-drawer"',
  'className="score-panel"',
  'className="set-panel"',
  'className="hud-event-slot"',
  'className="van-board-rack"',
  "className={`tow-instrument",
  "className={`mobile-controls",
  'className="run-button"',
].forEach((token) => {
  invariant(stableHudMarkup.includes(token), `${token} escaped the persistent paint layer`);
});
invariant(
  appSource.indexOf('data-hud-stability="persistent"') < boundaryStart,
  "persistent HUD data marker no longer owns the stable boundary",
);

const sceneStart = appSource.indexOf("<SurfScene");
const sceneEnd = appSource.indexOf("/>", sceneStart);
invariant(sceneStart >= 0 && sceneEnd > sceneStart, "scene boundary is missing");
const sceneMarkup = appSource.slice(sceneStart, sceneEnd);
invariant(
  sceneMarkup.includes("replayControl={sceneReplayControl}"),
  "scene replay controls are recreated during HUD telemetry renders",
);
invariant(
  !sceneMarkup.includes("replayControl={{"),
  "an inline scene prop defeats the memoized render boundary",
);
invariant(
  sceneSource.includes("const SHORE_WALK_SPEED = 5.1;")
    && sceneSource.includes("const SHORE_RUN_SPEED = 9.2;"),
  "shore traversal no longer has the faster walk and run speeds",
);
invariant(
  appSource.includes("controls.current.returnPronePresses += 1;")
    && sceneSource.includes("requested: divePressed || returnPronePressed"),
  "Space no longer starts the return-to-prone transition while riding",
);
invariant(
  sceneSource.includes("const pickupAvailable = tow.available")
    && sceneSource.includes("pickupBeacon.current.visible = pickupAvailable;")
    && sceneSource.includes('playerMotion.current.phase === "shore" || playerMotion.current.phase === "wading"')
    && sceneSource.includes("<sphereGeometry args={[.065, mobile ? 8 : 12, mobile ? 6 : 8]} />"),
  "the compact tow pickup beacon no longer follows pickup availability",
);
invariant(
  sceneSource.includes("export default memo(SurfScene);"),
  "HUD telemetry can reconcile the full 3D scene",
);
invariant(
  /startTransition\(\(\) =>\s*\{\s*setStats\(next\)/.test(appSource),
  "live telemetry is no longer scheduled below direct input",
);

const stabilityStart = styles.indexOf("Live HUD paint stability");
const stabilityEnd = styles.indexOf("v234 legibility floor");
invariant(
  stabilityStart >= 0 && stabilityEnd > stabilityStart,
  "paint-stability stylesheet section is missing",
);
const stabilityCss = styles.slice(stabilityStart, stabilityEnd);
[
  ".hud-persistent-layer",
  "contain: none",
  "transform: none",
  "will-change: auto",
  "backdrop-filter: none !important",
  "backface-visibility: visible",
].forEach((token) => {
  invariant(stabilityCss.includes(token), `${token} is no longer enforced`);
});
[
  /backface-visibility:\s*hidden\b/,
  /contain:[^;]*paint/,
  /isolation:\s*isolate\b/,
  /will-change:\s*transform\b/,
].forEach((pattern) => {
  invariant(!pattern.test(stabilityCss), `${pattern} reintroduces a WebGL/HUD compositing hazard`);
});
for (const match of stabilityCss.matchAll(/(?:-webkit-)?backdrop-filter:\s*([^;]+)/g)) {
  invariant(match[1].trim() === "none !important", "backdrop sampling returned to a live HUD surface");
}

const persistentLayerBlock = stabilityCss.match(/\.hud-persistent-layer\s*\{([^}]+)\}/)?.[1] ?? "";
invariant(!/\b(?:opacity|filter)\s*:/.test(persistentLayerBlock), "the persistent layer can be faded or filtered");

[
  ".game-ui.has-hud-message .hud-vitals",
  ".game-ui.has-hud-message .mechanics-guide",
  ".game-ui.has-hud-message .paddle-out-controls",
  ".game-ui.has-hud-message .duck-dive-alert",
].forEach((selector) => {
  invariant(styles.includes(selector), `${selector} no longer yields to a priority message`);
});
invariant(
  appSource.includes('rideToast || hudEventToast ? "has-hud-message" : ""'),
  "the HUD no longer declares its priority-message state",
);
invariant(
  appSource.includes('hudEventVisible && !rideToast ? "is-visible" : ""'),
  "a fading event can overlap the ride recap",
);
invariant(
  appSource.includes('stats.nearVan && !stats.vehicleMode'),
  "the board rack is no longer restricted to the van",
);
invariant(
  appSource.includes('const selectBoardAtVan = (board: BoardType)'),
  "the board rack no longer updates the equipped board",
);
[
  ".game-ui.has-hud-message .van-board-rack",
  ".game-ui.is-van-board-picker .mobile-controls",
].forEach((selector) => {
  invariant(styles.includes(selector), `${selector} no longer yields to the active HUD surface`);
});

const destinationIds = [...beachesSource.matchAll(/^\s+id: "([^"]+)"/gm)].map((match) => match[1]);
invariant(destinationIds[1] === "mavericks", "Mavericks is no longer second in the destination list");

[
  "Hard shell · PU foam core · fiberglass · polyester resin",
  "Hard shell · EPS foam core · fiberglass · epoxy resin",
  "Hard shell · PU foam core · wood stringer · fiberglass · polyester resin",
].forEach((construction) => {
  invariant(gameSource.includes(construction), `${construction} is no longer declared for the board rack`);
});
invariant(
  appSource.includes("no soft foamies"),
  "the board rack no longer clarifies that it has no soft foamies",
);

const reportCadence = sceneSource.match(
  /t\s*-\s*lastStatsAt\.current\s*>\s*(0?\.\d+)/,
);
invariant(reportCadence, "live telemetry cadence is no longer explicit");
const reportInterval = Number(reportCadence[1]);
invariant(
  reportInterval >= 0.12,
  `telemetry is repainting React at ${Math.round(1 / reportInterval)} Hz`,
);

console.log(JSON.stringify({
  persistentSurfaces: 9,
  telemetryHz: Number((1 / reportInterval).toFixed(2)),
  telemetryPriority: "transition",
  sceneBoundary: "memoized",
  backdropSampling: false,
  compositedBoundary: "stable",
}, null, 2));
