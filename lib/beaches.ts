export type SurfZone = {
  name: string;
  lat: number;
  lon: number;
  note: string;
  access: {
    name: string;
    lat: number;
    lon: number;
    towRecommended: boolean;
  };
};

export type CoastBiome = "urban" | "tropical" | "dune" | "rugged" | "cold" | "volcanic" | "desert";

export type BreakKind = "beach" | "reef" | "point" | "slab" | "canyon";

export type BreakCharacter = {
  kind: BreakKind;
  line: "LEFT" | "RIGHT" | "A-FRAME";
  peel: number;
  power: number;
  steepness: number;
  hollow: number;
  variability: number;
  length: number;
};

export type Beach = {
  id: string;
  name: string;
  region: string;
  country: string;
  /** Land-side reference used to identify and frame the coast on the map. */
  lat: number;
  lon: number;
  zoom: number;
  heading: number;
  difficulty: number;
  breakType: string;
  palette: [string, string];
  description: string;
  zones: SurfZone[];
  fallback: {
    waveHeight: number;
    wavePeriod: number;
    waveDirection: number;
    waterTemperature: number;
    windSpeed: number;
  };
};

/**
 * `heading` is the bearing each coast faces, out to sea. It orients the scene,
 * decides the angle swell arrives at, and drives the offshore/onshore wind
 * read, so a wrong one is felt in play rather than only seen on the map.
 *
 * Each value below was cross-checked two ways against the rendered
 * OpenStreetMap coastline - the reverse bearing from each surf zone to its
 * nearest land, and a fit through the shoreline points either side of the break
 * - then reconciled with how the break is known to sit. Where a headland,
 * breakwater or reef sits seaward of the peak, both fits mislead, and the
 * comment says so.
 *
 * A coast's top-level `lat` / `lon` identifies the wider destination. Every
 * playable `zone` has its own land-side `access` point so selecting a new peak
 * also selects a plausible beach entry. Outer reefs can recommend an optional
 * tow without preventing the player from paddling there under their own power.
 */
export const BEACHES: Beach[] = [
  {
    id: "pipeline",
    name: "Banzai Pipeline",
    region: "North Shore, Oʻahu",
    country: "Hawaiʻi",
    lat: 21.66511,
    lon: -158.05191,
    zoom: 15,
    heading: 322, // NNW-facing North Shore; both fits agree (312/327)
    difficulty: 5,
    breakType: "Shallow reef",
    palette: ["#35b8bb", "#d2a161"],
    description: "The archetypal hollow reef wave: fast, powerful, and unforgiving when the North Pacific wakes up.",
    zones: [
      { name: "Ehukai", lat: 21.667, lon: -158.0517, note: "Sand and reef mix", access: { name: "Ehukai beach entry", lat: 21.66626, lon: -158.05069, towRecommended: false } },
      { name: "First Reef", lat: 21.6655, lon: -158.053, note: "The iconic peak", access: { name: "First Reef beach entry", lat: 21.66489, lon: -158.05215, towRecommended: false } },
      { name: "Backdoor", lat: 21.6651, lon: -158.0548, note: "Racing right barrel", access: { name: "Backdoor beach entry", lat: 21.66416, lon: -158.05407, towRecommended: false } },
    ],
    fallback: { waveHeight: 2.4, wavePeriod: 15, waveDirection: 330, waterTemperature: 25, windSpeed: 10 },
  },
  {
    id: "mavericks",
    name: "Mavericks",
    region: "Half Moon Bay, California",
    country: "USA",
    lat: 37.4954, // Pillar Point beach access; the break is well offshore
    lon: -122.49809,
    zoom: 14,
    heading: 250, // WSW-facing; fits confused by the Pillar Point breakwater
    difficulty: 5,
    breakType: "Deep-water reef",
    palette: ["#50899b", "#a9a693"],
    description: "Cold deep water and a dramatic reef ledge turn winter swell into a brutally powerful right peak.",
    zones: [
      { name: "Mushrooms", lat: 37.4961, lon: -122.5023, note: "Outside staging zone", access: { name: "Mushrooms harbor entry", lat: 37.49555, lon: -122.4982, towRecommended: true } },
      { name: "The Bowl", lat: 37.4944, lon: -122.5005, note: "Main takeoff ledge", access: { name: "The Bowl harbor entry", lat: 37.4953, lon: -122.498, towRecommended: true } },
      { name: "Pillar Point", lat: 37.4946, lon: -122.4949, note: "Inside shoulder", access: { name: "Pillar Point beach entry", lat: 37.49485, lon: -122.49456, towRecommended: false } },
    ],
    fallback: { waveHeight: 3.1, wavePeriod: 15, waveDirection: 285, waterTemperature: 13, windSpeed: 17 },
  },
  {
    id: "teahupoo",
    name: "Teahupoʻo",
    region: "Tahiti Iti",
    country: "French Polynesia",
    lat: -17.8332,
    lon: -149.2674,
    zoom: 15,
    heading: 240, // SW-facing reef pass; both fits agree (252/254)
    difficulty: 5,
    breakType: "Outer reef pass",
    palette: ["#48d7c1", "#92b57c"],
    description: "Deep ocean energy folds over a shallow reef shelf to make one of surfing’s heaviest waves.",
    zones: [
      { name: "The Bowl", lat: -17.8442, lon: -149.2759, note: "Main west bowl", access: { name: "The Bowl lagoon entry", lat: -17.8407, lon: -149.27426, towRecommended: true } },
      { name: "West Bowl", lat: -17.8454, lon: -149.2742, note: "Wider, rawer entry", access: { name: "West Bowl lagoon entry", lat: -17.84696, lon: -149.2721, towRecommended: true } },
      { name: "Inside", lat: -17.8471, lon: -149.2728, note: "Training shoulder", access: { name: "Inside beach entry", lat: -17.84689, lon: -149.27234, towRecommended: false } },
    ],
    fallback: { waveHeight: 2.8, wavePeriod: 17, waveDirection: 210, waterTemperature: 28, windSpeed: 8 },
  },
  {
    id: "rockaway",
    name: "Rockaway Beach",
    region: "Queens, New York",
    country: "USA",
    lat: 40.5834,
    lon: -73.8172,
    zoom: 13,
    heading: 172, // S-facing Atlantic beach; both fits agree (185/165)
    difficulty: 2,
    breakType: "Beach break",
    palette: ["#73e6e1", "#e6b98a"],
    description: "A long, shifting Atlantic beach with jetties, peaks, and room to explore block by block.",
    zones: [
      { name: "Beach 67th", lat: 40.5836, lon: -73.8064, note: "Roomy western peaks", access: { name: "Beach 67th entry", lat: 40.5848, lon: -73.8064, towRecommended: false } },
      { name: "Beach 90th", lat: 40.5829, lon: -73.8115, note: "Classic local lineup", access: { name: "Beach 90th entry", lat: 40.5841, lon: -73.8115, towRecommended: false } },
      { name: "Beach 92nd", lat: 40.5816, lon: -73.8162, note: "Jetty-shaped walls", access: { name: "Beach 92nd entry", lat: 40.58264, lon: -73.81681, towRecommended: false } },
      { name: "Beach 98th", lat: 40.5803, lon: -73.8208, note: "Punchy sandbars", access: { name: "Beach 98th entry", lat: 40.58127, lon: -73.8216, towRecommended: false } },
      { name: "Beach 108th", lat: 40.5788, lon: -73.8254, note: "Open-beach energy", access: { name: "Beach 108th entry", lat: 40.57977, lon: -73.8262, towRecommended: false } },
    ],
    fallback: { waveHeight: 1.1, wavePeriod: 8, waveDirection: 168, waterTemperature: 20, windSpeed: 13 },
  },
  {
    id: "jeffreys-bay",
    name: "Jeffreys Bay",
    region: "Eastern Cape",
    country: "South Africa",
    lat: -34.0289,
    lon: 24.9291,
    zoom: 14,
    heading: 100, // E-facing point; fits say 63/67, was 229 - about 130 out
    difficulty: 4,
    breakType: "Point break",
    palette: ["#76c9d6", "#c5ab79"],
    description: "A long, flawless right wall that rewards trim, speed, and choosing the cleanest line through sections.",
    zones: [
      { name: "Boneyards", lat: -34.0226, lon: 24.9296, note: "Upper point entry", access: { name: "Boneyards beach entry", lat: -34.02276, lon: 24.92883, towRecommended: false } },
      { name: "Supertubes", lat: -34.026, lon: 24.9331, note: "Fast performance wall", access: { name: "Supertubes beach entry", lat: -34.02722, lon: 24.93122, towRecommended: false } },
      { name: "Impossibles", lat: -34.0302, lon: 24.9375, note: "Long connecting lines", access: { name: "Impossibles beach entry", lat: -34.03161, lon: 24.9333, towRecommended: false } },
    ],
    fallback: { waveHeight: 1.9, wavePeriod: 14, waveDirection: 220, waterTemperature: 19, windSpeed: 15 },
  },
  {
    id: "snapper-rocks",
    name: "Snapper Rocks",
    region: "Gold Coast",
    country: "Australia",
    lat: -28.1642,
    lon: 153.5513,
    zoom: 15,
    heading: 75, // ENE-facing Superbank; fits confused by the rocks themselves
    difficulty: 4,
    breakType: "Sand point",
    palette: ["#4bc4cd", "#efc98d"],
    description: "A sand-fed right-hand point where sections can link into a leg-burning run down the Superbank.",
    zones: [
      { name: "Snapper", lat: -28.16, lon: 153.5461, note: "Takeoff behind the rock", access: { name: "Snapper Rocks entry", lat: -28.16298, lon: 153.54856, towRecommended: false } },
      { name: "Rainbow Bay", lat: -28.1642, lon: 153.5529, note: "Open carving walls", access: { name: "Rainbow Bay entry", lat: -28.1642, lon: 153.5513, towRecommended: false } },
      { name: "Greenmount", lat: -28.1687, lon: 153.5465, note: "Long inside runner", access: { name: "Greenmount beach entry", lat: -28.16835, lon: 153.5465, towRecommended: false } },
    ],
    fallback: { waveHeight: 1.6, wavePeriod: 12, waveDirection: 110, waterTemperature: 23, windSpeed: 11 },
  },
  {
    id: "uluwatu",
    name: "Uluwatu",
    region: "Bali",
    country: "Indonesia",
    lat: -8.81506,
    lon: 115.08847,
    zoom: 15,
    heading: 245, // WSW-facing Bukit reef; fits confused by the cliff
    difficulty: 4,
    breakType: "Limestone reef",
    palette: ["#2fd0c1", "#db9a62"],
    description: "Multiple left-hand reef peaks beneath a cliff, each changing character as the Indian Ocean tide moves.",
    zones: [
      { name: "Temples", lat: -8.8111, lon: 115.0902, note: "Long high-tide lines", access: { name: "Temples cliff entry", lat: -8.81403, lon: 115.09128, towRecommended: false } },
      { name: "The Peak", lat: -8.8132, lon: 115.0912, note: "Consistent focal peak", access: { name: "The Peak cave entry", lat: -8.81393, lon: 115.0916, towRecommended: false } },
      { name: "Racetracks", lat: -8.8184, lon: 115.0858, note: "Low-tide speed run", access: { name: "Racetracks beach entry", lat: -8.81851, lon: 115.08686, towRecommended: false } },
    ],
    fallback: { waveHeight: 2.1, wavePeriod: 15, waveDirection: 210, waterTemperature: 27, windSpeed: 9 },
  },
  {
    id: "trestles",
    name: "Lower Trestles",
    region: "San Clemente, California",
    country: "USA",
    lat: 33.38276,
    lon: -117.5889,
    zoom: 15,
    heading: 210, // SW-facing; both fits agree (191/202)
    difficulty: 3,
    breakType: "Cobblestone reef",
    palette: ["#58b9cb", "#cdaa7a"],
    description: "A symmetrical, high-performance peak with forgiving shoulders and endless room for progressive turns.",
    zones: [
      { name: "Uppers", lat: 33.3846, lon: -117.595, note: "Powerful right walls", access: { name: "Uppers trail entry", lat: 33.38558, lon: -117.59466, towRecommended: false } },
      { name: "Lowers", lat: 33.3817, lon: -117.5889, note: "A-frame performance peak", access: { name: "Lowers trail entry", lat: 33.38262, lon: -117.5889, towRecommended: false } },
      { name: "Church", lat: 33.3801, lon: -117.5813, note: "Long cobblestone lines", access: { name: "Church trail entry", lat: 33.38102, lon: -117.58099, towRecommended: false } },
    ],
    fallback: { waveHeight: 1.4, wavePeriod: 13, waveDirection: 205, waterTemperature: 20, windSpeed: 8 },
  },
  {
    id: "hossegor",
    name: "Hossegor",
    region: "Les Landes",
    country: "France",
    lat: 43.6647,
    lon: -1.44329,
    zoom: 14,
    heading: 275, // W-facing Landes beach; both fits agree (269/283)
    difficulty: 4,
    breakType: "Heavy beach break",
    palette: ["#5aacc3", "#c49b68"],
    description: "Deep Atlantic canyons focus swell onto powerful sandbars that shift with every storm and tide.",
    zones: [
      { name: "La Gravière", lat: 43.6571, lon: -1.4489, note: "Hollow shorebreak peaks", access: { name: "La Gravière beach entry", lat: 43.65678, lon: -1.4471, towRecommended: false } },
      { name: "La Nord", lat: 43.6646, lon: -1.4453, note: "Big-wave outside bank", access: { name: "La Nord beach entry", lat: 43.66511, lon: -1.44312, towRecommended: false } },
      { name: "Les Culs Nus", lat: 43.6723, lon: -1.4442, note: "Shifting northern banks", access: { name: "Les Culs Nus beach entry", lat: 43.67235, lon: -1.44226, towRecommended: false } },
    ],
    fallback: { waveHeight: 2, wavePeriod: 12, waveDirection: 285, waterTemperature: 18, windSpeed: 14 },
  },
  {
    id: "nazare",
    name: "Nazaré",
    region: "Leiria",
    country: "Portugal",
    lat: 39.60422,
    lon: -9.0852,
    zoom: 14,
    heading: 270, // W-facing canyon beach; both fits agree (257/250)
    difficulty: 5,
    breakType: "Submarine canyon",
    palette: ["#4b91ac", "#b99c77"],
    description: "A submarine canyon bends and amplifies Atlantic swell into moving mountains of water.",
    zones: [
      { name: "Praia do Norte", lat: 39.6085, lon: -9.0875, note: "Canyon-focused peak", access: { name: "Praia do Norte entry", lat: 39.60877, lon: -9.08551, towRecommended: true } },
      { name: "The Lighthouse", lat: 39.6009, lon: -9.0803, note: "Iconic overlook line", access: { name: "Lighthouse beach entry", lat: 39.60379, lon: -9.07922, towRecommended: true } },
      { name: "South Beach", lat: 39.5918, lon: -9.0778, note: "Sheltered training wall", access: { name: "South Beach entry", lat: 39.5908, lon: -9.07655, towRecommended: false } },
    ],
    fallback: { waveHeight: 3.5, wavePeriod: 16, waveDirection: 295, waterTemperature: 17, windSpeed: 18 },
  },
  {
    id: "cloudbreak",
    name: "Cloudbreak",
    region: "Mamanuca Islands",
    country: "Fiji",
    lat: -17.85769, // Tavarua Island; Cloudbreak itself requires boat access
    lon: 177.20237,
    zoom: 14,
    heading: 210, // SW-facing outer reef; coastline fit agrees (194)
    difficulty: 5,
    breakType: "Outer barrier reef",
    palette: ["#39d6d0", "#4eab93"],
    description: "A remote left reef that changes from playful walls to thick barrels as long-period swell fills in.",
    zones: [
      { name: "The Point", lat: -17.883, lon: 177.1927, note: "Upper reef entry", access: { name: "The Point · Tavarua entry", lat: -17.85792, lon: 177.20208, towRecommended: true } },
      { name: "Cloudbreak", lat: -17.8814, lon: 177.1904, note: "Main performance bowl", access: { name: "Cloudbreak · Tavarua entry", lat: -17.85769, lon: 177.20237, towRecommended: true } },
      { name: "Shish Kabobs", lat: -17.8842, lon: 177.1945, note: "Fast inside section", access: { name: "Shish Kabobs · Tavarua entry", lat: -17.85746, lon: 177.20266, towRecommended: true } },
    ],
    fallback: { waveHeight: 2.3, wavePeriod: 16, waveDirection: 205, waterTemperature: 28, windSpeed: 12 },
  },
  {
    id: "raglan",
    name: "Raglan",
    region: "Waikato",
    country: "New Zealand",
    lat: -37.82258,
    lon: 174.80096,
    zoom: 14,
    heading: 310, // NW-facing points; fits say 341/355, was 247 - about 65 out
    difficulty: 3,
    breakType: "Volcanic point",
    palette: ["#459f9f", "#778a69"],
    description: "A chain of long left points wraps Tasman swell into rhythmic walls across black volcanic sand.",
    zones: [
      { name: "Indicators", lat: -37.8216, lon: 174.8061, note: "Fast upper point", access: { name: "Indicators point entry", lat: -37.82209, lon: 174.80655, towRecommended: false } },
      { name: "Whale Bay", lat: -37.8193, lon: 174.8048, note: "Technical middle point", access: { name: "Whale Bay point entry", lat: -37.82222, lon: 174.80615, towRecommended: false } },
      { name: "Manu Bay", lat: -37.8211, lon: 174.8017, note: "Long accessible runners", access: { name: "Manu Bay beach entry", lat: -37.82248, lon: 174.80158, towRecommended: false } },
    ],
    fallback: { waveHeight: 1.8, wavePeriod: 13, waveDirection: 235, waterTemperature: 17, windSpeed: 11 },
  },
  {
    id: "chicama",
    name: "Chicama",
    region: "La Libertad",
    country: "Peru",
    lat: -7.70571,
    lon: -79.44928,
    zoom: 14,
    heading: 230, // SW-facing desert point; fits confused by the harbour mole
    difficulty: 3,
    breakType: "Desert point",
    palette: ["#6ab9c2", "#d09a68"],
    description: "An extraordinary series of peeling left sections along a desert headland, built for flow and endurance.",
    zones: [
      { name: "Malpaso", lat: -7.7046, lon: -79.4528, note: "Upper point swell magnet", access: { name: "Malpaso beach entry", lat: -7.70587, lon: -79.45233, towRecommended: false } },
      { name: "El Point", lat: -7.7004, lon: -79.4483, note: "Long primary runner", access: { name: "El Point beach entry", lat: -7.70487, lon: -79.44666, towRecommended: false } },
      { name: "El Hombre", lat: -7.731, lon: -79.4542, note: "Clean inside walls", access: { name: "El Hombre beach entry", lat: -7.73021, lon: -79.45331, towRecommended: false } },
    ],
    fallback: { waveHeight: 1.5, wavePeriod: 15, waveDirection: 210, waterTemperature: 17, windSpeed: 10 },
  },
];

export const DEFAULT_BEACH = BEACHES[0];

export function getBeach(id: string) {
  return BEACHES.find((beach) => beach.id === id) ?? DEFAULT_BEACH;
}

export function getCoastBiome(id: string): CoastBiome {
  if (["pipeline", "teahupoo", "uluwatu", "cloudbreak"].includes(id)) return "tropical";
  if (["rockaway", "snapper-rocks"].includes(id)) return "urban";
  if (["hossegor", "jeffreys-bay"].includes(id)) return "dune";
  if (["nazare"].includes(id)) return "rugged";
  if (["mavericks", "trestles"].includes(id)) return "cold";
  if (id === "raglan") return "volcanic";
  return "desert";
}

const BREAK_CHARACTERS: Record<string, BreakCharacter> = {
  rockaway: { kind: "beach", line: "A-FRAME", peel: 0, power: .84, steepness: .62, hollow: .28, variability: .9, length: .76 },
  pipeline: { kind: "reef", line: "A-FRAME", peel: 0, power: 1.24, steepness: 1.08, hollow: 1, variability: .28, length: .82 },
  teahupoo: { kind: "slab", line: "LEFT", peel: -.88, power: 1.34, steepness: 1.18, hollow: 1, variability: .2, length: .78 },
  "jeffreys-bay": { kind: "point", line: "RIGHT", peel: .92, power: 1.02, steepness: .74, hollow: .52, variability: .12, length: 1.34 },
  "snapper-rocks": { kind: "point", line: "RIGHT", peel: .86, power: .96, steepness: .68, hollow: .42, variability: .2, length: 1.3 },
  uluwatu: { kind: "reef", line: "LEFT", peel: -.82, power: 1.1, steepness: .88, hollow: .72, variability: .24, length: 1.08 },
  trestles: { kind: "reef", line: "A-FRAME", peel: 0, power: .94, steepness: .66, hollow: .28, variability: .2, length: .98 },
  hossegor: { kind: "beach", line: "A-FRAME", peel: 0, power: 1.14, steepness: .9, hollow: .78, variability: .82, length: .76 },
  nazare: { kind: "canyon", line: "A-FRAME", peel: .1, power: 1.38, steepness: 1.02, hollow: .46, variability: .64, length: .9 },
  cloudbreak: { kind: "reef", line: "LEFT", peel: -.9, power: 1.18, steepness: .94, hollow: .84, variability: .18, length: 1.18 },
  mavericks: { kind: "reef", line: "RIGHT", peel: .76, power: 1.34, steepness: 1.06, hollow: .62, variability: .32, length: .88 },
  raglan: { kind: "point", line: "LEFT", peel: -.88, power: .92, steepness: .66, hollow: .34, variability: .14, length: 1.36 },
  chicama: { kind: "point", line: "LEFT", peel: -.94, power: .82, steepness: .54, hollow: .22, variability: .08, length: 1.48 },
};

const ZONE_CHARACTER_OVERRIDES: Record<string, Partial<BreakCharacter>> = {
  "rockaway:Beach 92nd": { line: "RIGHT", peel: .34, power: .94, steepness: .72, hollow: .4, variability: .56 },
  "rockaway:Beach 98th": { power: 1.02, steepness: .78, hollow: .46, variability: .7 },
  "pipeline:Ehukai": { power: .92, steepness: .72, hollow: .48, variability: .62, length: .74 },
  "pipeline:First Reef": { line: "LEFT", peel: -.54, steepness: 1.14, hollow: 1 },
  "pipeline:Backdoor": { line: "RIGHT", peel: .82, power: 1.28, steepness: 1.12, hollow: 1, length: .9 },
  "teahupoo:West Bowl": { power: 1.4, variability: .3, length: .86 },
  "teahupoo:Inside": { power: .76, steepness: .68, hollow: .42, variability: .42, length: .72 },
  "jeffreys-bay:Boneyards": { power: 1.08, steepness: .84, length: .98 },
  "jeffreys-bay:Impossibles": { power: .9, steepness: .62, hollow: .34, length: 1.46 },
  "snapper-rocks:Rainbow Bay": { power: .88, steepness: .58, hollow: .28, length: 1.4 },
  "snapper-rocks:Greenmount": { power: .82, steepness: .52, hollow: .22, length: 1.48 },
  "uluwatu:Temples": { steepness: .72, hollow: .48, length: 1.32 },
  "uluwatu:Racetracks": { power: 1.14, steepness: .98, hollow: .8, length: 1.22 },
  "trestles:Uppers": { line: "RIGHT", peel: .64, power: 1.02, steepness: .74 },
  "trestles:Church": { line: "RIGHT", peel: .52, power: .86, steepness: .54, length: 1.32 },
  "hossegor:La Gravière": { power: 1.2, steepness: 1.04, hollow: .94, variability: .64 },
  "hossegor:La Nord": { power: 1.34, steepness: 1.02, variability: .46 },
  "nazare:Praia do Norte": { power: 1.46, steepness: 1.12, variability: .58 },
  "nazare:South Beach": { power: .74, steepness: .6, hollow: .22, variability: .4, length: .86 },
  "cloudbreak:The Point": { steepness: .78, hollow: .62, length: 1.28 },
  "cloudbreak:Shish Kabobs": { power: 1.22, steepness: 1.04, hollow: .9, length: .92 },
  "mavericks:Mushrooms": { power: 1.4, variability: .4 },
  "mavericks:Pillar Point": { power: .92, steepness: .72, hollow: .36, length: 1.04 },
  "raglan:Indicators": { power: 1.02, steepness: .76, length: 1.12 },
  "raglan:Manu Bay": { power: .82, steepness: .56, length: 1.5 },
  "chicama:Malpaso": { power: .92, steepness: .64, length: 1.22 },
  "chicama:El Hombre": { power: .74, steepness: .46, length: 1.56 },
};

export function getBreakCharacter(id: string, zoneName = ""): BreakCharacter {
  const base = BREAK_CHARACTERS[id] ?? BREAK_CHARACTERS.rockaway;
  return { ...base, ...ZONE_CHARACTER_OVERRIDES[`${id}:${zoneName}`] };
}
