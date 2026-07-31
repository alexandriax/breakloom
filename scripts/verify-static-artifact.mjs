import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const output = resolve(root, "out");
const failures = [];
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  }));
  return files.flat();
}

async function requireFile(relativePath) {
  const path = resolve(output, relativePath);
  try {
    const details = await stat(path);
    if (!details.isFile() || details.size === 0) failures.push(`${relativePath} is empty`);
  } catch {
    failures.push(`${relativePath} is missing`);
  }
}

const requiredFiles = [
  "index.html",
  "404.html",
  "breakloom-og.jpg",
  "favicon.svg",
  "manifest.webmanifest",
  "sw.js",
];
await Promise.all(requiredFiles.map(requireFile));

const source = await readFile(resolve(root, "lib/game.ts"), "utf8");
const releaseMatch = source.match(
  /BREAKLOOM_RELEASE\s*=\s*{\s*version:\s*(\d+),\s*channel:\s*"([^"]+)"/s,
);
if (!releaseMatch) failures.push("lib/game.ts has no parseable release marker");
const release = releaseMatch
  ? { version: Number(releaseMatch[1]), channel: releaseMatch[2] }
  : { version: 0, channel: "UNKNOWN" };

function artifactPathForReference(reference) {
  let path = decodeURIComponent(reference.split(/[?#]/)[0]);
  if (basePath && (path === basePath || path === `${basePath}/`)) return "index.html";
  if (basePath && path.startsWith(`${basePath}/`)) path = path.slice(basePath.length);
  return path.replace(/^\/+/, "");
}

const indexHtml = await readFile(resolve(output, "index.html"), "utf8");
if (!indexHtml.includes("breakloom-og.jpg")) {
  failures.push("Generated page does not reference the Breakloom social preview");
}
const localReferences = new Set(
  [...indexHtml.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((reference) => reference.startsWith("/") && !reference.startsWith("//"))
    .map(artifactPathForReference)
    .filter(Boolean),
);
for (const reference of localReferences) {
  await requireFile(reference);
}

// Every track the player can shuffle into has to actually ship.
const audioSource = await readFile(resolve(root, "lib/audio.ts"), "utf8");
const soundtrackBlock = audioSource.match(/export const SOUNDTRACK = \[([^\]]*)\]/s);
if (!soundtrackBlock) {
  failures.push("lib/audio.ts has no parseable SOUNDTRACK list");
} else {
  const tracks = [...soundtrackBlock[1].matchAll(/file:\s*"([^"]+)"/g)].map((match) => match[1]);
  if (tracks.length === 0) failures.push("SOUNDTRACK is empty");
  await Promise.all(tracks.map((track) => requireFile(`audio/${track}.mp3`)));
}

const manifest = JSON.parse(await readFile(resolve(output, "manifest.webmanifest"), "utf8"));
for (const icon of manifest.icons ?? []) {
  if (typeof icon.src === "string") {
    await requireFile(artifactPathForReference(icon.src));
  }
}

const files = await filesBelow(output);
const sizedFiles = await Promise.all(files.map(async (path) => ({
  path,
  size: (await stat(path)).size,
})));
const totalBytes = sizedFiles.reduce((total, file) => total + file.size, 0);
const javascript = sizedFiles.filter((file) => file.path.endsWith(".js"));
const javascriptBytes = javascript.reduce((total, file) => total + file.size, 0);
const largestJavascriptBytes = Math.max(0, ...javascript.map((file) => file.size));
// The soundtrack is streamed one track at a time and is never precached by the
// service worker, so it does not affect how long the game takes to become
// playable. It gets its own budget instead of competing with the app shell.
const soundtrack = sizedFiles.filter((file) => /[\\/]audio[\\/][^\\/]+\.mp3$/.test(file.path));
const soundtrackBytes = soundtrack.reduce((total, file) => total + file.size, 0);
const shellBytes = totalBytes - soundtrackBytes;

if (shellBytes > 10 * 1024 * 1024) failures.push("App shell exceeds the 10 MiB release budget");
if (soundtrackBytes > 18 * 1024 * 1024) failures.push("Soundtrack exceeds the 18 MiB release budget");
if (javascriptBytes > 3 * 1024 * 1024) failures.push("JavaScript exceeds the 3 MiB release budget");
if (largestJavascriptBytes > 1.6 * 1024 * 1024) {
  failures.push("A JavaScript chunk exceeds the 1.6 MiB release budget");
}

const searchableFiles = sizedFiles.filter((file) => /\.(?:html|js|json|webmanifest)$/.test(file.path));
const searchableContents = await Promise.all(searchableFiles.map((file) => readFile(file.path, "utf8")));
if (searchableContents.some((content) => /https?:\/\/(?:localhost|127\.0\.0\.1)/.test(content))) {
  failures.push("Static artifact contains a localhost URL");
}
const releaseNeedle = `version:${release.version},channel:"${release.channel}"`;
if (!searchableContents.some((content) => content.includes(releaseNeedle))) {
  failures.push(`Emitted client does not contain release marker ${release.version} ${release.channel}`);
}

if (failures.length > 0) {
  throw new Error(`Static release artifact failed:\n- ${failures.join("\n- ")}`);
}

console.log(JSON.stringify({
  release,
  basePath,
  files: sizedFiles.length,
  localReferences: localReferences.size,
  totalBytes,
  shellBytes,
  soundtrackBytes,
  soundtrackTracks: soundtrack.length,
  javascriptBytes,
  largestJavascriptBytes,
}, null, 2));
