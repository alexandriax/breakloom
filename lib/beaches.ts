export type SurfZone = {
  name: string;
  lat: number;
  lon: number;
  note: string;
};

export type Beach = {
  id: string;
  name: string;
  region: string;
  country: string;
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

export const BEACHES: Beach[] = [
  {
    id: "rockaway",
    name: "Rockaway Beach",
    region: "Queens, New York",
    country: "USA",
    lat: 40.5834,
    lon: -73.8172,
    zoom: 13,
    heading: 156,
    difficulty: 2,
    breakType: "Beach break",
    palette: ["#73e6e1", "#e6b98a"],
    description: "A long, shifting Atlantic beach with jetties, peaks, and room to explore block by block.",
    zones: [
      { name: "Beach 67th", lat: 40.5902, lon: -73.7979, note: "Roomy western peaks" },
      { name: "Beach 90th", lat: 40.5867, lon: -73.8125, note: "Classic local lineup" },
      { name: "Beach 92nd", lat: 40.5857, lon: -73.8152, note: "Jetty-shaped walls" },
      { name: "Beach 98th", lat: 40.5821, lon: -73.8219, note: "Punchy sandbars" },
      { name: "Beach 108th", lat: 40.5782, lon: -73.8329, note: "Open-beach energy" },
    ],
    fallback: { waveHeight: 1.1, wavePeriod: 8, waveDirection: 168, waterTemperature: 20, windSpeed: 13 },
  },
  {
    id: "pipeline",
    name: "Banzai Pipeline",
    region: "North Shore, Oʻahu",
    country: "Hawaiʻi",
    lat: 21.6652,
    lon: -158.0528,
    zoom: 15,
    heading: 334,
    difficulty: 5,
    breakType: "Shallow reef",
    palette: ["#35b8bb", "#d2a161"],
    description: "The archetypal hollow reef wave: fast, powerful, and unforgiving when the North Pacific wakes up.",
    zones: [
      { name: "Ehukai", lat: 21.6638, lon: -158.0508, note: "Sand and reef mix" },
      { name: "First Reef", lat: 21.6652, lon: -158.0528, note: "The iconic peak" },
      { name: "Backdoor", lat: 21.666, lon: -158.0535, note: "Racing right barrel" },
    ],
    fallback: { waveHeight: 2.4, wavePeriod: 15, waveDirection: 330, waterTemperature: 25, windSpeed: 10 },
  },
  {
    id: "teahupoo",
    name: "Teahupoʻo",
    region: "Tahiti Iti",
    country: "French Polynesia",
    lat: -17.8332,
    lon: -149.2674,
    zoom: 15,
    heading: 208,
    difficulty: 5,
    breakType: "Outer reef pass",
    palette: ["#48d7c1", "#92b57c"],
    description: "Deep ocean energy folds over a shallow reef shelf to make one of surfing’s heaviest waves.",
    zones: [
      { name: "The Bowl", lat: -17.8332, lon: -149.2674, note: "Main west bowl" },
      { name: "West Bowl", lat: -17.8342, lon: -149.269, note: "Wider, rawer entry" },
      { name: "Inside", lat: -17.8318, lon: -149.2655, note: "Training shoulder" },
    ],
    fallback: { waveHeight: 2.8, wavePeriod: 17, waveDirection: 210, waterTemperature: 28, windSpeed: 8 },
  },
  {
    id: "jeffreys-bay",
    name: "Jeffreys Bay",
    region: "Eastern Cape",
    country: "South Africa",
    lat: -34.0289,
    lon: 24.9291,
    zoom: 14,
    heading: 229,
    difficulty: 4,
    breakType: "Point break",
    palette: ["#76c9d6", "#c5ab79"],
    description: "A long, flawless right wall that rewards trim, speed, and choosing the cleanest line through sections.",
    zones: [
      { name: "Boneyards", lat: -34.0229, lon: 24.9386, note: "Upper point entry" },
      { name: "Supertubes", lat: -34.0289, lon: 24.9291, note: "Fast performance wall" },
      { name: "Impossibles", lat: -34.037, lon: 24.9196, note: "Long connecting lines" },
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
    heading: 88,
    difficulty: 4,
    breakType: "Sand point",
    palette: ["#4bc4cd", "#efc98d"],
    description: "A sand-fed right-hand point where sections can link into a leg-burning run down the Superbank.",
    zones: [
      { name: "Snapper", lat: -28.1642, lon: 153.5513, note: "Takeoff behind the rock" },
      { name: "Rainbow Bay", lat: -28.1668, lon: 153.5481, note: "Open carving walls" },
      { name: "Greenmount", lat: -28.169, lon: 153.5455, note: "Long inside runner" },
    ],
    fallback: { waveHeight: 1.6, wavePeriod: 12, waveDirection: 110, waterTemperature: 23, windSpeed: 11 },
  },
  {
    id: "uluwatu",
    name: "Uluwatu",
    region: "Bali",
    country: "Indonesia",
    lat: -8.8149,
    lon: 115.0877,
    zoom: 15,
    heading: 244,
    difficulty: 4,
    breakType: "Limestone reef",
    palette: ["#2fd0c1", "#db9a62"],
    description: "Multiple left-hand reef peaks beneath a cliff, each changing character as the Indian Ocean tide moves.",
    zones: [
      { name: "Temples", lat: -8.8099, lon: 115.0862, note: "Long high-tide lines" },
      { name: "The Peak", lat: -8.8149, lon: 115.0877, note: "Consistent focal peak" },
      { name: "Racetracks", lat: -8.818, lon: 115.0855, note: "Low-tide speed run" },
    ],
    fallback: { waveHeight: 2.1, wavePeriod: 15, waveDirection: 210, waterTemperature: 27, windSpeed: 9 },
  },
  {
    id: "trestles",
    name: "Lower Trestles",
    region: "San Clemente, California",
    country: "USA",
    lat: 33.3817,
    lon: -117.5889,
    zoom: 15,
    heading: 226,
    difficulty: 3,
    breakType: "Cobblestone reef",
    palette: ["#58b9cb", "#cdaa7a"],
    description: "A symmetrical, high-performance peak with forgiving shoulders and endless room for progressive turns.",
    zones: [
      { name: "Uppers", lat: 33.3884, lon: -117.5942, note: "Powerful right walls" },
      { name: "Lowers", lat: 33.3817, lon: -117.5889, note: "A-frame performance peak" },
      { name: "Church", lat: 33.3739, lon: -117.5676, note: "Long cobblestone lines" },
    ],
    fallback: { waveHeight: 1.4, wavePeriod: 13, waveDirection: 205, waterTemperature: 20, windSpeed: 8 },
  },
  {
    id: "hossegor",
    name: "Hossegor",
    region: "Les Landes",
    country: "France",
    lat: 43.6647,
    lon: -1.4477,
    zoom: 14,
    heading: 272,
    difficulty: 4,
    breakType: "Heavy beach break",
    palette: ["#5aacc3", "#c49b68"],
    description: "Deep Atlantic canyons focus swell onto powerful sandbars that shift with every storm and tide.",
    zones: [
      { name: "La Gravière", lat: 43.6806, lon: -1.4424, note: "Hollow shorebreak peaks" },
      { name: "La Nord", lat: 43.6734, lon: -1.4455, note: "Big-wave outside bank" },
      { name: "Les Culs Nus", lat: 43.6952, lon: -1.4386, note: "Shifting northern banks" },
    ],
    fallback: { waveHeight: 2, wavePeriod: 12, waveDirection: 285, waterTemperature: 18, windSpeed: 14 },
  },
  {
    id: "nazare",
    name: "Nazaré",
    region: "Leiria",
    country: "Portugal",
    lat: 39.6017,
    lon: -9.0852,
    zoom: 14,
    heading: 282,
    difficulty: 5,
    breakType: "Submarine canyon",
    palette: ["#4b91ac", "#b99c77"],
    description: "A submarine canyon bends and amplifies Atlantic swell into moving mountains of water.",
    zones: [
      { name: "Praia do Norte", lat: 39.6087, lon: -9.0858, note: "Canyon-focused peak" },
      { name: "The Lighthouse", lat: 39.6044, lon: -9.0853, note: "Iconic overlook line" },
      { name: "South Beach", lat: 39.5932, lon: -9.0736, note: "Sheltered training wall" },
    ],
    fallback: { waveHeight: 3.5, wavePeriod: 16, waveDirection: 295, waterTemperature: 17, windSpeed: 18 },
  },
  {
    id: "cloudbreak",
    name: "Cloudbreak",
    region: "Mamanuca Islands",
    country: "Fiji",
    lat: -17.884,
    lon: 177.1884,
    zoom: 14,
    heading: 216,
    difficulty: 5,
    breakType: "Outer barrier reef",
    palette: ["#39d6d0", "#4eab93"],
    description: "A remote left reef that changes from playful walls to thick barrels as long-period swell fills in.",
    zones: [
      { name: "The Point", lat: -17.8806, lon: 177.1912, note: "Upper reef entry" },
      { name: "Cloudbreak", lat: -17.884, lon: 177.1884, note: "Main performance bowl" },
      { name: "Shish Kabobs", lat: -17.888, lon: 177.1852, note: "Fast inside section" },
    ],
    fallback: { waveHeight: 2.3, wavePeriod: 16, waveDirection: 205, waterTemperature: 28, windSpeed: 12 },
  },
  {
    id: "mavericks",
    name: "Mavericks",
    region: "Half Moon Bay, California",
    country: "USA",
    lat: 37.4946,
    lon: -122.5001,
    zoom: 14,
    heading: 238,
    difficulty: 5,
    breakType: "Deep-water reef",
    palette: ["#50899b", "#a9a693"],
    description: "Cold deep water and a dramatic reef ledge turn winter swell into a brutally powerful right peak.",
    zones: [
      { name: "Mushrooms", lat: 37.4926, lon: -122.502, note: "Outside staging zone" },
      { name: "The Bowl", lat: 37.4946, lon: -122.5001, note: "Main takeoff ledge" },
      { name: "Pillar Point", lat: 37.4959, lon: -122.496, note: "Inside shoulder" },
    ],
    fallback: { waveHeight: 3.1, wavePeriod: 15, waveDirection: 285, waterTemperature: 13, windSpeed: 17 },
  },
  {
    id: "raglan",
    name: "Raglan",
    region: "Waikato",
    country: "New Zealand",
    lat: -37.821,
    lon: 174.7998,
    zoom: 14,
    heading: 247,
    difficulty: 3,
    breakType: "Volcanic point",
    palette: ["#459f9f", "#778a69"],
    description: "A chain of long left points wraps Tasman swell into rhythmic walls across black volcanic sand.",
    zones: [
      { name: "Indicators", lat: -37.8162, lon: 174.7939, note: "Fast upper point" },
      { name: "Whale Bay", lat: -37.821, lon: 174.7998, note: "Technical middle point" },
      { name: "Manu Bay", lat: -37.8253, lon: 174.807, note: "Long accessible runners" },
    ],
    fallback: { waveHeight: 1.8, wavePeriod: 13, waveDirection: 235, waterTemperature: 17, windSpeed: 11 },
  },
  {
    id: "chicama",
    name: "Chicama",
    region: "La Libertad",
    country: "Peru",
    lat: -7.7043,
    lon: -79.4501,
    zoom: 14,
    heading: 205,
    difficulty: 3,
    breakType: "Desert point",
    palette: ["#6ab9c2", "#d09a68"],
    description: "An extraordinary series of peeling left sections along a desert headland, built for flow and endurance.",
    zones: [
      { name: "Malpaso", lat: -7.6907, lon: -79.4584, note: "Upper point swell magnet" },
      { name: "El Point", lat: -7.7043, lon: -79.4501, note: "Long primary runner" },
      { name: "El Hombre", lat: -7.7131, lon: -79.4448, note: "Clean inside walls" },
    ],
    fallback: { waveHeight: 1.5, wavePeriod: 15, waveDirection: 210, waterTemperature: 17, windSpeed: 10 },
  },
];

export const DEFAULT_BEACH = BEACHES[0];

export function getBeach(id: string) {
  return BEACHES.find((beach) => beach.id === id) ?? DEFAULT_BEACH;
}

