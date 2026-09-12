// Canonical journey contract. Provider adapters own facts; AI/legacy text only
// supplies editable endpoints. Null means unknown, including for money and time.
export const COST_SOURCES = Object.freeze({
  google_transit: "Google transit fare",
  official_operator: "Official operator fare",
  saantayo_estimate: "SaanTayo estimate",
  user_confirmed: "User-confirmed fare",
  free_walk: "Free · no fare",
  unknown: "Fare needs confirmation",
});
export const MODE_LABELS = Object.freeze({
  walk: "🚶 Walk",
  grab: "🚗 Grab estimate",
  train: "🚊 Train / Transit",
  local: "🚐 Jeepney / Local",
});
export const text = (v, max = 240) =>
  typeof v === "string"
    ? v
        .trim()
        .replace(/[\u0000-\u001f]/g, " ")
        .slice(0, max)
    : "";
export const number = (v) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
const list = (v) => (Array.isArray(v) ? v : []);
export function normalizeRoute(raw = {}, index = 0) {
  if (!raw || !Object.hasOwn(MODE_LABELS, raw.mode)) return null;
  const sourced = [
    "google_routes",
    "official_operator",
    "user_confirmed",
  ].includes(raw.source);
  if (!sourced) return null;
  // Reject overlong wayfinders instead of silently dropping the arrival/transfer.
  if (list(raw.steps).length > 80) return null;
  const costSource = raw.mode === "walk"
    ? "free_walk"
    : Object.hasOwn(COST_SOURCES, raw.costSource)
      ? raw.costSource
      : "unknown";
  const range = raw.costRangePHP;
  const costRangePHP =
    costSource !== "unknown" &&
    number(range?.min) !== null &&
    number(range?.max) !== null &&
    range.max > range.min
      ? { min: range.min, max: range.max }
      : null;
  const steps = list(raw.steps)
    .slice(0, 80)
    .filter(
      (s) =>
        s &&
        [
          "start",
          "walk",
          "board",
          "ride",
          "transfer",
          "alight",
          "arrive",
        ].includes(s.type),
    )
    .map((s) => ({
      type: s.type,
      title: text(s.title),
      instruction: text(s.instruction, 600),
      durationMinutes: number(s.durationMinutes),
      distanceMeters: number(s.distanceMeters),
      lineName: text(s.lineName),
      headsign: text(s.headsign),
      stopName: text(s.stopName),
      landmark: text(s.landmark),
      transferTo: text(s.transferTo),
      departureTime: text(s.departureTime),
      arrivalTime: text(s.arrivalTime),
      payment:
        s.source === "official_operator" || s.source === "user_confirmed"
          ? text(s.payment)
          : "",
      signboard:
        s.source === "official_operator" || s.source === "user_confirmed"
          ? text(s.signboard)
          : "",
      costPHP:
        Object.hasOwn(COST_SOURCES, s.costSource) && s.costSource !== "unknown"
          ? number(s.costPHP)
          : null,
      costSource: Object.hasOwn(COST_SOURCES, s.costSource)
        ? s.costSource
        : "unknown",
      source: ["google_routes", "official_operator", "user_confirmed"].includes(
        s.source,
      )
        ? s.source
        : raw.source,
    }));
  return {
    id: `route-${index}`,
    mode: raw.mode,
    modeFamily: raw.mode === "grab" ? "driving" : raw.mode === "walk" ? "walking" : "transit",
    label: text(raw.label) || MODE_LABELS[raw.mode],
    origin: text(raw.origin),
    destination: text(raw.destination),
    durationMinutes: number(raw.durationMinutes),
    distanceMeters: number(raw.distanceMeters),
    totalCostPHP: raw.mode === "walk" ? 0 : costSource !== "unknown" ? number(raw.totalCostPHP) : null,
    costRangePHP,
    costSource,
    costBasis: ["person", "vehicle", "free"].includes(raw.costBasis)
      ? raw.costBasis
      : raw.mode === "walk"
        ? "free"
        : "unknown",
    capacity: number(raw.capacity),
    confidence: raw.source === "google_routes" ? "provider" : "confirmed",
    source: raw.source,
    walkingMinutes: number(raw.walkingMinutes),
    transferCount:
      Number.isInteger(raw.transferCount) && raw.transferCount >= 0
        ? raw.transferCount
        : null,
    tollEstimatePHP: number(raw.tollEstimatePHP),
    tollSource:
      number(raw.tollEstimatePHP) !== null ? text(raw.tollSource) : "unknown",
    payment: ["official_operator", "user_confirmed"].includes(raw.source)
      ? text(raw.payment)
      : "",
    warnings: list(raw.warnings)
      .slice(0, 8)
      .map((x) => text(x, 400)),
    sourceAttribution: list(raw.sourceAttribution)
      .slice(0, 10)
      .map((x) => text(x)),
    bestFor: [],
    steps,
  };
}
export function normalizeJourney(raw = {}) {
  return {
    version: 1,
    origin: text(raw.origin),
    destination: text(raw.destination),
    departureTime: text(raw.departureTime),
    generatedAt: text(raw.generatedAt),
    status: ["ok", "partial", "unavailable", "not_configured"].includes(
      raw.status,
    )
      ? raw.status
      : "unavailable",
    warnings: list(raw.warnings)
      .slice(0, 8)
      .map((x) => text(x, 400)),
    recommendedRouteId: null,
    routes: list(raw.routes).slice(0, 6).map(normalizeRoute).filter(Boolean),
  };
}
export function legacyJourneys(markdown, defaults = {}) {
  let rows = [];
  try {
    const match =
      typeof markdown === "string" &&
      markdown
        .slice(0, 100000)
        .match(/```(?:transit|json:transit)\s*([\s\S]*?)```/i);
    const parsed = match ? JSON.parse(match[1]) : [];
    rows = Array.isArray(parsed) ? parsed : [];
  } catch {
    /* An invalid AI block is not route data. */
  }
  const seen = new Set();
  return (rows.length ? rows : [defaults]).slice(0, 6).flatMap((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return [];
    const parts = text(row.legTitle || row.route).split(/\s+(?:to|→)\s+/i);
    const origin =
      text(row.origin) ||
      (parts.length === 2 ? parts[0] : "") ||
      text(defaults.origin);
    const destination =
      text(row.destination) ||
      (parts.length === 2 ? parts[1] : "") ||
      text(defaults.destination);
    const key = `${origin}|${destination}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [
      {
        ...normalizeJourney({ origin, destination }),
        legacy: true,
        label: `${origin || "Starting point"} → ${destination || "Destination"}`,
        warnings: [
          "Saved route details need a fresh lookup. Confirm the endpoints before searching.",
        ],
      },
    ];
  });
}
export function partyCost(route, people) {
  if (route.mode === "walk") {
    return {
      min: 0,
      max: 0,
      perPersonMin: 0,
      perPersonMax: 0,
    };
  }
  if (
    !Number.isInteger(people) ||
    people < 1 ||
    route.costSource === "unknown" ||
    route.costBasis === "unknown"
  )
    return null;
  if (
    route.costBasis === "vehicle" &&
    (!route.capacity || people > route.capacity)
  )
    return null;
  const range =
    route.costRangePHP ||
    (number(route.totalCostPHP) !== null
      ? { min: route.totalCostPHP, max: route.totalCostPHP }
      : null);
  if (!range) return null;
  const multiplier = route.costBasis === "person" ? people : 1;
  return {
    min: range.min * multiplier,
    max: range.max * multiplier,
    perPersonMin: (range.min * multiplier) / people,
    perPersonMax: (range.max * multiplier) / people,
  };
}
export function recommendJourney(journey, people = 1) {
  const routes = journey.routes.map((r) => ({ ...r, bestFor: [] }));
  // Compare only alternatives for this exact journey, never unrelated legs.
  const candidates = routes.filter(
    (r) => r.origin === journey.origin && r.destination === journey.destination,
  );
  const badgeMinimum = (get, label) => {
    const values = candidates.map((r) => [r, get(r)]);
    if (values.length < 2 || values.some(([, v]) => v === null)) return;
    const min = Math.min(...values.map(([, v]) => v));
    if (values.every(([, v]) => v === min)) return;
    for (const [r, v] of values) if (v === min) r.bestFor.push(label);
  };
  badgeMinimum((r) => r.durationMinutes, "Fastest");
  badgeMinimum((r) => r.transferCount, "Fewest transfers");
  const priced = candidates.map((r) => [r, partyCost(r, people)]);
  if (priced.length > 1 && priced.every(([, cost]) => cost)) {
    for (const [r, cost] of priced)
      if (priced.every(([other, c]) => other === r || cost.max < c.min))
        r.bestFor.push("Cheapest");
  }

  // For short journeys, walking is considered before recommending a vehicle.
  const walk = candidates.find((r) => r.mode === "walk");
  const isWalkableShortTrip =
    walk &&
    walk.distanceMeters !== null &&
    walk.distanceMeters <= 2000 &&
    walk.durationMinutes !== null &&
    walk.durationMinutes <= 25;

  let recommended = null;
  if (isWalkableShortTrip) {
    const drive = candidates.find((r) => r.mode === "grab");
    const driveSavings =
      drive && drive.durationMinutes !== null && walk.durationMinutes !== null
        ? walk.durationMinutes - drive.durationMinutes
        : 0;
    // When driving savings is under 15 min, Grab booking + pickup wait erases the advantage.
    if (driveSavings <= 15) {
      walk.bestFor.push("Recommended for short trip");
      recommended = walk;
    }
  }

  if (!recommended) {
    recommended = candidates.find((r) => r.bestFor.includes("Fastest"));
  }
  return { ...journey, routes, recommendedRouteId: recommended?.id || null };
}
export function comparePartyRoutes(journey, people) {
  const grab = journey.routes.find((r) => r.mode === "grab");
  const transit = journey.routes.find(
    (r) => r.mode === "train" || r.mode === "local",
  );
  if (
    grab &&
    transit &&
    grab.origin === transit.origin &&
    grab.destination === transit.destination &&
    grab.durationMinutes !== null &&
    transit.durationMinutes !== null
  ) {
    const g = partyCost(grab, people),
      t = partyCost(transit, people);
    const saved = Math.round(transit.durationMinutes - grab.durationMinutes);
    if (g && t && g.min > t.max && saved > 0) {
      return `For ${people} traveller${people === 1 ? "" : "s"}, Grab costs about ${moneyRange(g.min - t.max, g.max - t.min)} more and the driving route takes about ${saved} fewer minutes. Pickup wait is not included.`;
    }
  }
  const walk = journey.routes.find((r) => r.mode === "walk");
  if (
    grab &&
    walk &&
    grab.origin === walk.origin &&
    grab.destination === walk.destination &&
    walk.distanceMeters !== null &&
    walk.distanceMeters <= 2000 &&
    walk.durationMinutes !== null &&
    grab.durationMinutes !== null
  ) {
    const distKm = (walk.distanceMeters / 1000).toFixed(1);
    const walkMin = Math.ceil(walk.durationMinutes);
    const driveMin = Math.ceil(grab.durationMinutes);
    return `Walking is recommended for this short trip (~${distKm} km, ~${walkMin} min, ₱0). Grab driving takes about ${driveMin} min, but pickup wait is not included and live fare applies.`;
  }
  return "";
}
export const money = (v) =>
  `₱${v.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;
export const moneyRange = (min, max) =>
  min === max ? money(min) : `${money(min)}–${money(max)}`;
export function fareLabel(route) {
  if (route.mode === "walk") return "₱0";
  if (route.costSource === "unknown")
    return route.mode === "grab"
      ? "Check live Grab fare"
      : "Fare needs confirmation";
  if (route.costRangePHP)
    return `${moneyRange(route.costRangePHP.min, route.costRangePHP.max)} estimated`;
  return number(route.totalCostPHP) !== null
    ? money(route.totalCostPHP)
    : "Fare needs confirmation";
}
// Reused from PR #6: application-owned endpoint-aware directions helpers.
export function buildGoogleMapsDirectionsUrl(
  origin,
  destination,
  { mode = "transit" } = {},
) {
  if (!text(destination)) return null;
  const travelmode =
    mode === "grab"
      ? "driving"
      : mode === "walk"
        ? "walking"
        : "transit";
  const params = new URLSearchParams({
    api: "1",
    destination: text(destination),
    travelmode,
  });
  if (text(origin)) params.set("origin", text(origin));
  return `https://www.google.com/maps/dir/?${params}`;
}
export function buildSakayRouteUrl(origin, destination) {
  if (!text(destination)) return null;
  const params = new URLSearchParams({ to: text(destination) });
  if (text(origin)) params.set("from", text(origin));
  return `https://sakay.ph/?${params}`;
}
export function buildTransitRouteLinks(route) {
  const links = [
    {
      id: "maps",
      name: "Open route in Google Maps",
      url: buildGoogleMapsDirectionsUrl(route.origin, route.destination, {
        mode: route.mode,
      }),
    },
  ];
  if (
    (route.mode === "train" || route.mode === "local") &&
    /manila|makati|taguig|pasig|quezon|mandaluyong|pasay|bgc|intramuros/i.test(
      `${route.origin} ${route.destination}`,
    )
  )
    links.push({
      id: "sakay",
      name: "Open in Sakay · check coverage",
      url: buildSakayRouteUrl(route.origin, route.destination),
    });
  return links.filter((l) => l.url);
}
export function departureISO(choice, custom, now = Date.now()) {
  if (choice === "now") return new Date(now).toISOString();
  if (choice === "custom") {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(custom || "")) return null;
    const date = Date.parse(`${custom}:00+08:00`);
    return Number.isFinite(date) && date > now && date < now + 100 * 86400000
      ? new Date(date).toISOString()
      : null;
  }
  const hours = { morning: 8, midday: 12, evening: 18 };
  if (!Object.hasOwn(hours, choice)) return null;
  const day = new Date(now + 8 * 3600000).toISOString().slice(0, 10);
  let date = Date.parse(
    `${day}T${String(hours[choice]).padStart(2, "0")}:00:00+08:00`,
  );
  if (date <= now) date += 86400000;
  return new Date(date).toISOString();
}
