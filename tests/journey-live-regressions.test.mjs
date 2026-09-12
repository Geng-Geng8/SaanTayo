import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { normalizeGoogleTransit, planJourney, FIELD_MASKS } from "../server/routes.js";
import { normalizeRoute } from "../shared/journey.js";
import { renderJourney } from "../src/transit-render.js";
import { query, transit, driving, calibration, shortTripQuery, shortDriving, walking } from "./journey-fixtures.mjs";

test("total transit time includes initial wait, transfer waits and final walking", () => {
  assert.equal(normalizeGoogleTransit(transit(), query)[0].durationMinutes, 55);
  const later = transit({ rides: 1 });
  const stops = later.routes[0].legs[0].steps[1].transitDetails.stopDetails;
  stops.departureTime = "2026-09-12T08:17:00Z";
  stops.arrivalTime = "2026-09-12T08:27:00Z";
  assert.equal(normalizeGoogleTransit(later, query)[0].durationMinutes, 29);
  assert.equal(normalizeGoogleTransit(transit({ rides: 1 }), query)[0].durationMinutes, 22);
});

test("incomplete or uncatchable timetables cannot produce fastest duration claims", () => {
  for (const mutate of [
    (steps) => delete steps[1].transitDetails.stopDetails.arrivalTime,
    (steps) => { steps[1].transitDetails.stopDetails.departureTime = "2026-09-12T08:01:00Z"; },
    (steps) => delete steps[0].staticDuration,
    (steps) => { steps[2].transitDetails.stopDetails.departureTime = "2026-09-12T08:15:00Z"; },
  ]) {
    const response = transit();
    mutate(response.routes[0].legs[0].steps);
    const route = normalizeGoogleTransit(response, query)[0];
    assert.equal(route.durationMinutes, null);
    assert.match(route.warnings.join(" "), /Total time needs confirmation/);
  }
});

test("repeated rail departures do not hide a later local alternative", () => {
  const response = transit({ rides: 1 });
  const duplicates = Array.from({ length: 5 }, (_, i) => {
    const route = structuredClone(response.routes[0]);
    const stops = route.legs[0].steps[1].transitDetails.stopDetails;
    for (const field of ["departureTime", "arrivalTime"])
      stops[field] = new Date(Date.parse(stops[field]) + i * 7 * 60000).toISOString();
    return route;
  });
  response.routes = [...duplicates.reverse(), transit({ rides: 1, rail: false }).routes[0]];
  const routes = normalizeGoogleTransit(response, query);
  assert.equal(routes.length, 2);
  assert.deepEqual(routes.map((r) => r.mode), ["train", "local"]);
  assert.ok(routes.every((r) => r.durationMinutes === 22));
});

test("ambiguous, missing or inconsistent geocoding suppresses misleading routes", async () => {
  const invalid = [
    undefined,
    { ...driving.geocodingResults, destination: { placeId: "broad-area", type: ["political", "sublocality"] } },
    { ...driving.geocodingResults, destination: { ...driving.geocodingResults.destination, partialMatch: true } },
    { ...driving.geocodingResults, origin: { ...driving.geocodingResults.origin, geocoderStatus: { code: 5 } } },
    { ...driving.geocodingResults, destination: { ...driving.geocodingResults.destination, placeId: "different-place" } },
  ];
  for (const geocodingResults of invalid) {
    const journey = await planJourney(query, {}, { provider: {
      lookup: async (_, mode) => mode === "TRANSIT" ? transit() : { ...driving, geocodingResults },
    } });
    assert.equal(journey.status, "unavailable");
    assert.deepEqual(journey.routes, []);
    assert.match(journey.warnings.join(" "), /exact building, station or street address/);
  }
});

test("specific consistent geocoding permits rail and traffic-aware driving", async () => {
  const journey = await planJourney(query, {}, { provider: {
    lookup: async (_, mode) => mode === "TRANSIT" ? transit() : driving,
  } });
  assert.equal(journey.status, "ok");
  assert.deepEqual(journey.routes.map((r) => r.mode), ["train", "grab"]);
  for (const mask of Object.values(FIELD_MASKS))
    for (const endpoint of ["origin", "destination"])
      for (const field of ["type", "partialMatch", "placeId", "geocoderStatus.code"])
        assert.ok(mask.includes(`geocodingResults.${endpoint}.${field}`));
});

test("Test A: Short Walk — Rizal Park to National Museum recommends verified ₱0 walking route", async () => {
  const lookups = [];
  const provider = {
    lookup: async (q, mode) => {
      lookups.push(mode);
      if (mode === "TRANSIT") {
        return { geocodingResults: shortDriving.geocodingResults, routes: [] };
      }
      if (mode === "DRIVE") {
        return shortDriving;
      }
      if (mode === "WALK") {
        return walking({ duration: "660s", distanceMeters: 800 });
      }
      throw new Error(`Unexpected mode ${mode}`);
    },
  };

  const journey = await planJourney(shortTripQuery, { GRAB_ESTIMATE_CALIBRATIONS: JSON.stringify([calibration]) }, { provider });
  assert.equal(journey.status, "ok");
  assert.ok(lookups.includes("WALK"), "Provider must perform WALK lookup when driving distance <= 2.5 km");
  assert.equal(lookups.filter((m) => m === "WALK").length, 1, "Provider must perform at most one WALK lookup");

  const walk = journey.routes.find((r) => r.mode === "walk");
  assert.ok(walk, "WALK route must be present in journey.routes");
  assert.equal(walk.source, "google_routes");
  assert.equal(walk.totalCostPHP, 0);
  assert.equal(walk.costBasis, "free");
  assert.equal(walk.transferCount, 0);
  assert.equal(walk.durationMinutes, 11);
  assert.equal(walk.distanceMeters, 800);
  assert.equal(walk.steps.length, 4); // start + 2 walk steps + arrive
  assert.ok(walk.steps.some((s) => s.type === "walk" && s.instruction.includes("Padre Burgos")));

  const grab = journey.routes.find((r) => r.mode === "grab");
  assert.ok(grab, "Grab driving route remains available as secondary option");

  // Walk is the recommended route for this short trip
  assert.equal(journey.recommendedRouteId, walk.id);
  assert.ok(walk.bestFor.includes("Recommended for short trip"));
  assert.ok(walk.bestFor.includes("Cheapest"));
});

test("Test B: Verified Transit Regression — Greenbelt 3 to SM North skips WALK and preserves transit recommendation", async () => {
  const lookups = [];
  const longTransit = transit({ fare: true, rides: 2, rail: true });
  const longDriving = {
    ...driving,
    routes: [{ duration: "2700s", distanceMeters: 16500 }],
  };
  const provider = {
    lookup: async (_, mode) => {
      lookups.push(mode);
      if (mode === "TRANSIT") return longTransit;
      if (mode === "DRIVE") return longDriving;
      if (mode === "WALK") throw new Error("WALK must not be called for long journeys");
      throw new Error(`Unexpected mode ${mode}`);
    },
  };

  const journey = await planJourney(query, {}, { provider });
  assert.equal(journey.status, "ok");
  assert.ok(!lookups.includes("WALK"), "Long-distance journey (> 2.5 km) must never issue a WALK call");
  assert.deepEqual(journey.routes.map((r) => r.mode), ["train", "grab"]);
  assert.notEqual(journey.recommendedRouteId, null);
});

test("Test C: Cebu Safety — verified local bus routes preserved without rail hallucination", async () => {
  const cebuQuery = {
    origin: "Ayala Center Cebu, Cebu City",
    destination: "Cebu IT Park, Apas, Cebu City",
    departureTime: "2026-09-12T08:00:00Z",
    people: 2,
  };
  const cebuTransit = transit({ fare: true, rides: 1, rail: false });
  const cebuDriving = {
    ...driving,
    routes: [{ duration: "900s", distanceMeters: 3800 }],
  };
  const lookups = [];
  const provider = {
    lookup: async (_, mode) => {
      lookups.push(mode);
      if (mode === "TRANSIT") return cebuTransit;
      if (mode === "DRIVE") return cebuDriving;
      if (mode === "WALK") throw new Error("WALK lookup not expected for 3.8 km trip");
    },
  };

  const journey = await planJourney(cebuQuery, {}, { provider });
  assert.equal(journey.status, "ok");
  assert.ok(!journey.routes.some((r) => r.mode === "train"), "No rail routes allowed in bus-only corridor");
  assert.ok(journey.routes.some((r) => r.mode === "local"), "Verified local route must be present");
  assert.ok(!lookups.includes("WALK"));
});

test("Test D & Mobile UX: Mobile 390px layout renders short-trip walking recommendation, ₱0, and accessible non-dominant controls", () => {
  const dom = new JSDOM("<main style='width: 390px;'></main>", { url: "https://app.example" });
  global.document = dom.window.document;

  const walkRoute = normalizeRoute({
    ...shortTripQuery,
    mode: "walk",
    source: "google_routes",
    durationMinutes: 11,
    distanceMeters: 800,
    totalCostPHP: 0,
    costSource: "free_walk",
    costBasis: "free",
    transferCount: 0,
    steps: [
      { type: "start", title: shortTripQuery.origin, source: "google_routes" },
      { type: "walk", title: "Walk", instruction: "Head northeast on Padre Burgos Ave", durationMinutes: 11, distanceMeters: 800, source: "google_routes" },
      { type: "arrive", title: shortTripQuery.destination, source: "google_routes" },
    ],
  }, 0);

  const grabRoute = normalizeRoute({
    ...shortTripQuery,
    mode: "grab",
    source: "google_routes",
    durationMinutes: 4,
    distanceMeters: 800,
    costSource: "unknown",
    costBasis: "vehicle",
    transferCount: 0,
    steps: [
      { type: "start", title: shortTripQuery.origin },
      { type: "ride", title: "Driving route", durationMinutes: 4, distanceMeters: 800 },
      { type: "arrive", title: shortTripQuery.destination },
    ],
  }, 1);

  const j = {
    ...shortTripQuery,
    status: "ok",
    routes: [walkRoute, grabRoute],
    warnings: [],
  };

  const root = renderJourney(j, { people: 1 });
  document.body.append(root);

  // Overview button: Recommended Walk is at the top
  const overviewButtons = root.querySelectorAll(".journey-option");
  assert.equal(overviewButtons.length, 2);
  assert.match(overviewButtons[0].textContent, /Recommended · 🚶 Walk · 11 min · ₱0/);
  assert.ok(overviewButtons[0].classList.contains("recommended"));
  assert.match(overviewButtons[1].textContent, /Grab.*4 min/);

  // Tab list checks: Walk and Grab are active, Train and Local are disabled
  const tabs = root.querySelectorAll("[role=tab]");
  assert.equal(tabs.length, 4);
  assert.equal(tabs[0].dataset.transitMode, "walk");
  assert.equal(tabs[0].disabled, false);
  assert.equal(tabs[0].getAttribute("aria-selected"), "true");
  assert.equal(tabs[1].dataset.transitMode, "grab");
  assert.equal(tabs[1].disabled, false);

  // Train and Local are disabled and styled as unavailable
  const trainTab = root.querySelector('[data-transit-mode="train"]');
  const localTab = root.querySelector('[data-transit-mode="local"]');
  assert.ok(trainTab.disabled, "Train tab must be disabled when no rail route exists");
  assert.ok(trainTab.classList.contains("transit-mode-tab-disabled"));
  assert.ok(localTab.disabled, "Local tab must be disabled when no jeepney route exists");
  assert.ok(localTab.classList.contains("transit-mode-tab-disabled"));

  // Walk panel verification
  const walkPanel = root.querySelector('[data-mode="walk"]');
  assert.equal(walkPanel.hidden, false);
  assert.match(walkPanel.textContent, /✓ Verified route/);
  assert.match(walkPanel.textContent, /Recommended · short walk/);
  assert.match(walkPanel.textContent, /11 min walking · 0.8 km/);
  assert.match(walkPanel.textContent, /₱0 · Free/);
  assert.match(walkPanel.textContent, /Free · no fare/);
  assert.doesNotMatch(walkPanel.textContent, /Fare basis: per person/);
  assert.doesNotMatch(walkPanel.textContent, /Confirm payment before boarding/);

  dom.window.close();
});
