// SaanTayo V3.4 — Philippine Geo-Registry and Location Intelligence
// Provides deterministic coordinates for Philippine tourist regions, islands, cities, and hubs
// without incurring external paid Geocoding API costs.

export const POPULAR_REGIONS = Object.freeze([
  {
    id: "siargao",
    label: "Siargao Island",
    shortLabel: "Siargao",
    emoji: "🏄",
    coords: { latitude: 9.7801, longitude: 126.1541 },
    keywords: ["siargao", "general luna", "cloud 9", "pacificon", "dapa", "del carmen", "sugba"],
  },
  {
    id: "boracay",
    label: "Boracay Island",
    shortLabel: "Boracay",
    emoji: "🏖️",
    coords: { latitude: 11.9674, longitude: 121.9248 },
    keywords: ["boracay", "white beach", "station 1", "station 2", "station 3", "bulabog", "caticlan", "malay"],
  },
  {
    id: "elnido",
    label: "El Nido, Palawan",
    shortLabel: "El Nido",
    emoji: "🌊",
    coords: { latitude: 11.1812, longitude: 119.3908 },
    keywords: ["el nido", "bacuit", "nacpan", "las cabanas", "lio", "corong corong"],
  },
  {
    id: "coron",
    label: "Coron, Palawan",
    shortLabel: "Coron",
    emoji: "🌺",
    coords: { latitude: 12.0003, longitude: 120.2045 },
    keywords: ["coron", "busuanga", "kayangan", "barracuda lake", "malcapuya"],
  },
  {
    id: "cebu",
    label: "Cebu City & Mactan",
    shortLabel: "Cebu",
    emoji: "🏛️",
    coords: { latitude: 10.3157, longitude: 123.8854 },
    keywords: ["cebu", "cebu city", "it park", "lahug", "mactan", "lapu-lapu", "mandaue", "fuente", "colon", "ayala cebu"],
  },
  {
    id: "manila",
    label: "Metro Manila",
    shortLabel: "Metro Manila",
    emoji: "🏙️",
    coords: { latitude: 14.5839, longitude: 120.9794 },
    keywords: ["manila", "metro manila", "intramuros", "makati", "bgc", "bonifacio global city", "taguig", "pasay", "quezon city", "rizal park", "ermita", "malate", "poblacion", "ortigas"],
  },
  {
    id: "baguio",
    label: "Baguio & Benguet",
    shortLabel: "Baguio",
    emoji: "🌲",
    coords: { latitude: 16.4023, longitude: 120.596 },
    keywords: ["baguio", "benguet", "session road", "camp john hay", "mines view", "burnham park", "la trinidad"],
  },
  {
    id: "bohol",
    label: "Bohol & Panglao",
    shortLabel: "Bohol",
    emoji: "🐠",
    coords: { latitude: 9.6718, longitude: 123.8732 },
    keywords: ["bohol", "panglao", "alona", "tagbilaran", "loboc", "chocolate hills", "carmen", "anda"],
  },
  {
    id: "launion",
    label: "La Union (Elyu)",
    shortLabel: "La Union",
    emoji: "🏄",
    coords: { latitude: 16.6575, longitude: 120.3209 },
    keywords: ["la union", "elyu", "san juan", "san fernando la union", "urbiztondo"],
  },
  {
    id: "batanes",
    label: "Batanes",
    shortLabel: "Batanes",
    emoji: "⛰️",
    coords: { latitude: 20.4485, longitude: 121.9705 },
    keywords: ["batanes", "basco", "sabtang", "itbayat", "marlboro hills", "mahatao"],
  },
]);

// Extended regional hub coordinates for search matching
export const REGIONAL_HUBS = Object.freeze([
  ...POPULAR_REGIONS,
  {
    id: "puerto_princesa",
    label: "Puerto Princesa, Palawan",
    coords: { latitude: 9.7392, longitude: 118.7353 },
    keywords: ["puerto princesa", "underground river", "sabang", "honda bay"],
  },
  {
    id: "san_vicente",
    label: "San Vicente & Port Barton, Palawan",
    coords: { latitude: 10.505, longitude: 119.2974 },
    keywords: ["san vicente", "port barton", "long beach palawan"],
  },
  {
    id: "tagaytay",
    label: "Tagaytay & Batangas",
    coords: { latitude: 14.1153, longitude: 120.9621 },
    keywords: ["tagaytay", "batangas", "taal", "nasugbu", "anilao", "calatagan", "mabini", "laiya", "san juan batangas"],
  },
  {
    id: "siquijor",
    label: "Siquijor",
    coords: { latitude: 9.2141, longitude: 123.5158 },
    keywords: ["siquijor", "san juan siquijor", "salagdoong", "cambugahay", "larena"],
  },
  {
    id: "dumaguete",
    label: "Dumaguete & Negros Oriental",
    coords: { latitude: 9.3068, longitude: 123.3054 },
    keywords: ["dumaguete", "dauin", "apo island", "valencia negros", "manjuyod", "bais"],
  },
  {
    id: "sagada",
    label: "Sagada & Banaue",
    coords: { latitude: 17.0825, longitude: 120.9015 },
    keywords: ["sagada", "banaue", "batad", "mountain province", "ifugao"],
  },
  {
    id: "davao",
    label: "Davao & Samal Island",
    coords: { latitude: 7.1907, longitude: 125.4579 },
    keywords: ["davao", "davao city", "samal", "island garden city of samal", "talikud", "mt apo"],
  },
  {
    id: "camiguin",
    label: "Camiguin Island",
    coords: { latitude: 9.1732, longitude: 124.7299 },
    keywords: ["camiguin", "mambajao", "white island camiguin", "mantigue"],
  },
  {
    id: "iloilo",
    label: "Iloilo & Guimaras",
    coords: { latitude: 10.7202, longitude: 122.5621 },
    keywords: ["iloilo", "iloilo city", "guimaras", "jaro", "mandurriao", "gigantes", "islas de gigantes"],
  },
  {
    id: "bacolod",
    label: "Bacolod, Negros Occidental",
    coords: { latitude: 10.6766, longitude: 122.9509 },
    keywords: ["bacolod", "negros occidental", "silay", "the ruins", "lakawon"],
  },
  {
    id: "ilocos",
    label: "Ilocos (Vigan & Laoag)",
    coords: { latitude: 17.5707, longitude: 120.3871 },
    keywords: ["ilocos", "vigan", "laoag", "pagudpud", "calle crisologo", "paoay", "ilocos norte", "ilocos sur"],
  },
  {
    id: "bicol",
    label: "Bicol (Legazpi & Naga)",
    coords: { latitude: 13.1391, longitude: 123.7438 },
    keywords: ["bicol", "legazpi", "mayon", "albay", "naga", "caramoan", "donsol", "sorsogon"],
  },
  {
    id: "baler",
    label: "Baler, Aurora",
    coords: { latitude: 15.7592, longitude: 121.5621 },
    keywords: ["baler", "aurora", "sabang beach baler", "dicasalarin"],
  },
  {
    id: "subic",
    label: "Subic & Zambales",
    coords: { latitude: 14.8219, longitude: 120.2818 },
    keywords: ["subic", "zambales", "subic bay", "san antonio zambales", "anawangin", "nagsasa", "liwliwa"],
  },
  {
    id: "pampanga",
    label: "Clark & Angeles, Pampanga",
    coords: { latitude: 15.145, longitude: 120.5887 },
    keywords: ["pampanga", "clark", "angeles", "san fernando pampanga"],
  },
  {
    id: "moalboal",
    label: "Moalboal, Cebu",
    coords: { latitude: 9.9575, longitude: 123.4011 },
    keywords: ["moalboal", "panagsama", "pescador", "sardine run"],
  },
  {
    id: "bantayan",
    label: "Bantayan Island, Cebu",
    coords: { latitude: 11.2056, longitude: 123.7317 },
    keywords: ["bantayan", "santa fe bantayan", "madridejos"],
  },
  {
    id: "malapascua",
    label: "Malapascua Island, Cebu",
    coords: { latitude: 11.3323, longitude: 124.1169 },
    keywords: ["malapascua", "daanbantayan", "monad shoal"],
  },
  {
    id: "makati",
    label: "Makati, Metro Manila",
    coords: { latitude: 14.5547, longitude: 121.0244 },
    keywords: ["makati", "ayala center", "greenbelt", "glorietta", "poblacion", "legazpi village", "salcedo village"],
  },
  {
    id: "bgc",
    label: "BGC / Taguig, Metro Manila",
    coords: { latitude: 14.5507, longitude: 121.0494 },
    keywords: ["bgc", "bonifacio global city", "high street", "taguig", "uptown bonifacio", "market market"],
  },
  {
    id: "intramuros",
    label: "Intramuros / Ermita, Manila",
    coords: { latitude: 14.5895, longitude: 120.9745 },
    keywords: ["intramuros", "rizal park", "luneta", "ermita", "malate", "national museum", "manila bay", "binondo", "chinatown"],
  },
]);

/**
 * Resolves a text query or destination string to a credible Philippine coordinate set.
 * Returns { id, label, latitude, longitude } if matched, or null if unresolvable.
 */
export function resolvePhilippineLocation(query) {
  if (!query || typeof query !== "string") return null;

  const normalized = query
    .toLowerCase()
    .replace(/[,\.\-\/\\&]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized || normalized.length < 2) return null;

  // 1. Direct exact keyword match
  for (const hub of REGIONAL_HUBS) {
    for (const kw of hub.keywords) {
      if (normalized === kw) {
        return {
          id: hub.id,
          label: hub.label,
          latitude: hub.coords.latitude,
          longitude: hub.coords.longitude,
        };
      }
    }
  }

  // 2. Substring phrase match (longest keyword first for specificity, e.g. "cebu it park" before "cebu")
  const allKeywords = [];
  for (const hub of REGIONAL_HUBS) {
    for (const kw of hub.keywords) {
      allKeywords.push({ kw, hub });
    }
  }
  allKeywords.sort((a, b) => b.kw.length - a.kw.length);

  for (const { kw, hub } of allKeywords) {
    // Word-boundary aware or clean substring
    const regex = new RegExp(`(?:^|\\s)${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|\\s)`, "i");
    if (regex.test(normalized) || normalized.includes(kw)) {
      return {
        id: hub.id,
        label: hub.label,
        latitude: hub.coords.latitude,
        longitude: hub.coords.longitude,
      };
    }
  }

  return null;
}
