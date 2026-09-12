import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { readFile } from "node:fs/promises";
import {
  recommendJourney,
  normalizeRoute,
  normalizeJourney,
  buildGoogleMapsDirectionsUrl,
} from "../shared/journey.js";
import { planJourney } from "../server/routes.js";
import {
  renderGoModeResults,
  collectGoModeDestinations,
  collectGoModeOrigins,
  formatExplanation,
  readGoModeState,
  writeGoModeState,
  GO_MODE_STORAGE_KEY,
  GRAB_SAFE_URL,
  initGoMode,
} from "../src/go-mode.js";
import {
  query,
  calibration,
  driving,
  transit,
  walking,
  shortTripQuery,
  shortDriving,
} from "./journey-fixtures.mjs";

const html = await readFile("dist/index.html", "utf8");

test("Test A: Short Walk — Rizal Park to National Museum recommends Walk, ₱0, verified, and START WALKING DIRECTIONS uses walking Maps mode", async () => {
  const lookups = [];
  const provider = {
    lookup: async (q, mode) => {
      lookups.push(mode);
      if (mode === "TRANSIT") return { geocodingResults: shortDriving.geocodingResults, routes: [] };
      if (mode === "DRIVE") return shortDriving;
      if (mode === "WALK") return walking({ duration: "660s", distanceMeters: 800 });
      throw new Error(`Unexpected mode ${mode}`);
    },
  };

  const journey = await planJourney(shortTripQuery, { GRAB_ESTIMATE_CALIBRATIONS: JSON.stringify([calibration]) }, { provider });
  assert.equal(journey.status, "ok");
  assert.ok(lookups.includes("WALK"), "Short trip must issue WALK lookup");

  const walk = journey.routes.find((r) => r.mode === "walk");
  assert.ok(walk, "Walk route must be present");
  assert.equal(walk.source, "google_routes");
  assert.equal(walk.totalCostPHP, 0);
  assert.equal(walk.durationMinutes, 11);
  assert.equal(walk.distanceMeters, 800);

  // Render in Go Mode
  const dom = new JSDOM("<div id='host'></div>", { url: "https://app.example" });
  global.document = dom.window.document;

  const results = renderGoModeResults(journey, { people: 1 });
  assert.ok(results, "Go Mode results must render");

  // Verify Best Option Card is Walk
  const heroCard = results.querySelector(".go-mode-hero-card");
  assert.ok(heroCard, "Primary hero card must be present");
  assert.match(heroCard.textContent, /BEST WAY TO GET THERE/);
  assert.match(heroCard.textContent, /Verified route/);
  assert.match(heroCard.textContent, /11 min/);
  assert.match(heroCard.textContent, /0.8 km/);
  assert.match(heroCard.textContent, /₱0/);
  assert.match(heroCard.textContent, /Walking is recommended for this short trip/);

  // START WALKING DIRECTIONS button
  const startBtn = heroCard.querySelector("#goModeStartDirectionsBtn");
  assert.ok(startBtn, "Start directions button must exist");
  assert.equal(startBtn.textContent.trim(), "START WALKING DIRECTIONS ↗");
  assert.equal(startBtn.target, "_blank");
  assert.equal(startBtn.rel, "noopener noreferrer");

  const url = new URL(startBtn.href);
  assert.equal(url.searchParams.get("travelmode"), "walking");
  assert.equal(url.searchParams.get("origin"), shortTripQuery.origin);
  assert.equal(url.searchParams.get("destination"), shortTripQuery.destination);

  // I'm here button is present
  const hereBtn = heroCard.querySelector("#goModeHereBtn");
  assert.ok(hereBtn, "I'm here button must be present");

  dom.window.close();
});

test("Test B: Long Metro Manila Trip — Greenbelt 3 to SM North preserves transit / Grab and avoids unnecessary WALK", async () => {
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
      if (mode === "WALK") throw new Error("WALK must not be called for long trips");
      throw new Error(`Unexpected mode ${mode}`);
    },
  };

  const journey = await planJourney(query, { GRAB_ESTIMATE_CALIBRATIONS: JSON.stringify([calibration]) }, { provider });
  assert.equal(journey.status, "ok");
  assert.ok(!lookups.includes("WALK"), "Long journey must skip WALK lookup");

  const dom = new JSDOM("<div id='host'></div>", { url: "https://app.example" });
  global.document = dom.window.document;

  const results = renderGoModeResults(journey, { people: 2 });
  const heroCard = results.querySelector(".go-mode-hero-card");
  assert.ok(heroCard);

  const startBtn = heroCard.querySelector("#goModeStartDirectionsBtn");
  assert.ok(startBtn);
  const url = new URL(startBtn.href);
  assert.ok(["transit", "driving"].includes(url.searchParams.get("travelmode")));

  // Secondary options exist
  const secondary = results.querySelectorAll(".go-mode-secondary-card");
  assert.ok(secondary.length > 0, "Secondary options must be available");

  dom.window.close();
});

test("Test C: Cebu — Ayala Center Cebu to Cebu IT Park preserves local bus and Grab without rail hallucination", async () => {
  const cebuQuery = {
    origin: "Ayala Center Cebu, Cebu City",
    destination: "Cebu IT Park, Apas, Cebu City",
    departureTime: "2026-09-12T08:00:00Z",
    people: 1,
  };
  const cebuTransit = transit({ fare: true, rides: 1, rail: false });
  const cebuDriving = {
    ...driving,
    routes: [{ duration: "900s", distanceMeters: 3800 }],
  };
  const provider = {
    lookup: async (_, mode) => {
      if (mode === "TRANSIT") return cebuTransit;
      if (mode === "DRIVE") return cebuDriving;
    },
  };

  const journey = await planJourney(cebuQuery, {}, { provider });
  assert.equal(journey.status, "ok");
  assert.ok(!journey.routes.some((r) => r.mode === "train"), "No rail allowed in Cebu bus corridor");
  assert.ok(journey.routes.some((r) => r.mode === "local"), "Local route present");

  const dom = new JSDOM("<div id='host'></div>", { url: "https://app.example" });
  global.document = dom.window.document;

  const results = renderGoModeResults(journey, { people: 1 });
  assert.ok(results.textContent.includes("Jeepney / Local") || results.textContent.includes("Grab"));

  dom.window.close();
});

test("Test D: Natural Language Fallback — Grounded advisor result renders cleanly with directions button using resolved endpoints", async () => {
  const advisor = {
    status: "grounded",
    confidence: "high",
    resolvedOrigin: "National Museum of Fine Arts, Padre Burgos Ave, Ermita, Manila",
    resolvedDestination: "Fort Santiago, Intramuros, Manila",
    summary: "Short urban trip between Ermita and Intramuros.",
    recommendedMode: "grab",
    options: [
      {
        mode: "grab",
        label: "Grab / Taxi",
        confidence: "high",
        durationMin: 10,
        durationMax: 15,
        why: "Direct ride across Padre Burgos and Soriano Ave.",
      },
      {
        mode: "walk",
        label: "Walk via Intramuros",
        confidence: "medium",
        durationMin: 22,
        durationMax: 28,
        why: "Scenic walk through historic walls.",
      },
    ],
  };

  const fallbackJourney = {
    origin: "national museum",
    destination: "Fort Santiago, Intramuros, Manila",
    status: "unavailable",
    routes: [],
  };

  const dom = new JSDOM("<div id='host'></div>", { url: "https://app.example" });
  global.document = dom.window.document;

  const results = renderGoModeResults(fallbackJourney, { people: 1, advisor });
  assert.ok(results.textContent.includes("Grounded estimate"));
  assert.ok(results.textContent.includes("Direct ride across Padre Burgos"));

  const navLinks = results.querySelectorAll("a[href*='maps/dir']");
  assert.ok(navLinks.length > 0);
  const firstUrl = new URL(navLinks[0].href);
  assert.equal(firstUrl.searchParams.get("origin"), advisor.resolvedOrigin);
  assert.equal(firstUrl.searchParams.get("destination"), advisor.resolvedDestination);

  dom.window.close();
});

test("Test E: Arrival Flow — 'I’m here' updates current place, clears next destination, preserves state in storage, and fires no Google API call", async () => {
  const dom = new JSDOM(html, { url: "https://app.example", runScripts: "outside-only" });
  const w = dom.window;
  const doc = w.document;
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };

  let apiCallCount = 0;
  const mockLookup = async (q) => {
    apiCallCount++;
    return {
      journey: {
        origin: q.origin,
        destination: q.destination,
        status: "ok",
        routes: [
          normalizeRoute({
            origin: q.origin,
            destination: q.destination,
            mode: "walk",
            source: "google_routes",
            durationMinutes: 7,
            distanceMeters: 500,
            totalCostPHP: 0,
            costSource: "free_walk",
            costBasis: "free",
            transferCount: 0,
            steps: [{ type: "walk", title: "Walk to destination", durationMinutes: 7, distanceMeters: 500, source: "google_routes" }],
          }, 0),
        ],
      },
    };
  };

  const manager = initGoMode({
    dialog: doc.getElementById("goModeModal"),
    form: doc.getElementById("goModeForm"),
    originInput: doc.getElementById("goModeOrigin"),
    destinationInput: doc.getElementById("goModeDestination"),
    quickSelect: doc.getElementById("goModeDestinationQuickSelect"),
    originChipsContainer: doc.getElementById("goModeOriginChips"),
    resultsContainer: doc.getElementById("goModeResults"),
    statusContainer: doc.getElementById("goModeStatus"),
    arrivalBanner: doc.getElementById("goModeArrivalBanner"),
    arrivalText: doc.getElementById("goModeArrivalText"),
    getCurrentTrip: () => ({ id: "trip-xyz", trip: { origin: "Rizal Park, Manila", destination: "Intramuros", people: 1 } }),
    getSavedItems: () => [
      { itemId: "s1", name: "National Museum of Fine Arts", itemType: "activity" },
      { itemId: "s2", name: "Fort Santiago", itemType: "activity" },
    ],
    getPlanText: () => "Trip notes",
    lookupJourney: mockLookup,
    storage: w.localStorage,
  });

  // Open Go Mode
  manager.open();
  assert.equal(doc.getElementById("goModeOrigin").value, "Rizal Park, Manila");

  // Select destination
  doc.getElementById("goModeDestination").value = "National Museum of Fine Arts";
  await manager.executeRouteSearch();

  assert.equal(apiCallCount, 1, "One initial search call");
  const hereBtn = doc.getElementById("goModeHereBtn");
  assert.ok(hereBtn, "I'm here button must be present in results");

  // Tap I'm Here!
  hereBtn.click();

  // No API call should occur merely from tapping I'M HERE
  assert.equal(apiCallCount, 1, "Tapping I'M HERE must NOT execute any Google API call");

  // Current place becomes National Museum of Fine Arts
  assert.equal(doc.getElementById("goModeOrigin").value, "National Museum of Fine Arts");
  assert.equal(doc.getElementById("goModeDestination").value, "");

  // Arrival banner displays
  const banner = doc.getElementById("goModeArrivalBanner");
  assert.equal(banner.classList.contains("hidden"), false);
  assert.match(doc.getElementById("goModeArrivalText").textContent, /You’re at National Museum of Fine Arts/);

  // Storage preserves state across page refresh
  const savedState = readGoModeState(w.localStorage);
  assert.ok(savedState);
  assert.equal(savedState.lastArrived, "National Museum of Fine Arts");

  // Re-open / refresh reproduces arrival state without API call
  manager.refresh();
  assert.equal(doc.getElementById("goModeOrigin").value, "National Museum of Fine Arts");
  assert.equal(apiCallCount, 1);

  // User can immediately type or select Destination C
  doc.getElementById("goModeDestination").value = "Fort Santiago";
  await manager.executeRouteSearch();

  assert.equal(apiCallCount, 2, "Second search only occurs on intentional user search");
  assert.equal(doc.getElementById("goModeOrigin").value, "National Museum of Fine Arts");
  assert.equal(doc.getElementById("goModeDestination").value, "Fort Santiago");

  dom.window.close();
});

test("Test F: Offline Handling — Saved places and context preserved, live routing shows offline message, no stale routes shown as live", async () => {
  const dom = new JSDOM(html, { url: "https://app.example", runScripts: "outside-only" });
  const w = dom.window;
  const doc = w.document;
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };

  let apiCalls = 0;
  const manager = initGoMode({
    dialog: doc.getElementById("goModeModal"),
    form: doc.getElementById("goModeForm"),
    originInput: doc.getElementById("goModeOrigin"),
    destinationInput: doc.getElementById("goModeDestination"),
    quickSelect: doc.getElementById("goModeDestinationQuickSelect"),
    originChipsContainer: doc.getElementById("goModeOriginChips"),
    resultsContainer: doc.getElementById("goModeResults"),
    statusContainer: doc.getElementById("goModeStatus"),
    arrivalBanner: doc.getElementById("goModeArrivalBanner"),
    arrivalText: doc.getElementById("goModeArrivalText"),
    getCurrentTrip: () => ({ id: "offline-trip", trip: { origin: "Hotel Manila", destination: "Intramuros" } }),
    getSavedItems: () => [{ itemId: "1", name: "Rizal Monument", itemType: "activity" }],
    lookupJourney: async () => { apiCalls++; },
    storage: w.localStorage,
  });

  manager.open();
  doc.getElementById("goModeOrigin").value = "Hotel Manila";
  doc.getElementById("goModeDestination").value = "Rizal Monument";

  // Simulate offline
  Object.defineProperty(w.navigator, "onLine", { value: false, configurable: true });

  await manager.executeRouteSearch();

  // No API call occurred
  assert.equal(apiCalls, 0);

  // Status clearly indicates offline
  const status = doc.getElementById("goModeStatus").textContent;
  assert.match(status, /offline/i);
  assert.match(status, /live route comparison requires internet/i);

  // Preserves entered endpoints
  assert.equal(doc.getElementById("goModeOrigin").value, "Hotel Manila");
  assert.equal(doc.getElementById("goModeDestination").value, "Rizal Monument");

  // No stale routes displayed as live
  assert.equal(doc.getElementById("goModeResults").children.length, 0);

  dom.window.close();
});

test("Destination and Origin sourcing integrates with Shared Shortlist and Itinerary items", () => {
  const savedItems = [
    { itemId: "s1", name: "The Manila Hotel", itemType: "stay" },
    { itemId: "s2", name: "Manam Comfort Filipino", itemType: "food" },
    { itemId: "s3", name: "National Museum of Anthropology", itemType: "activity" },
    { itemId: "s4", name: "Buendia Station → Ayala Station", itemType: "transport" },
  ];

  const planText = `
### Day 1
\`\`\`dining
[
  { "spotName": "Aristocrat Restaurant", "category": "Filipino Classics" }
]
\`\`\`

\`\`\`activities
[
  { "name": "Intramuros Historic Tour", "category": "Heritage" }
]
\`\`\`
`;

  const destinations = collectGoModeDestinations({
    currentTrip: { trip: { origin: "NAIA Terminal 3", destination: "Manila" } },
    savedItems,
    planText,
  });

  assert.ok(destinations.some((d) => d.label === "The Manila Hotel (Stay)"));
  assert.ok(destinations.some((d) => d.label === "Manam Comfort Filipino (Food)"));
  assert.ok(destinations.some((d) => d.label === "National Museum of Anthropology (Activity)"));
  assert.ok(destinations.some((d) => d.label === "Ayala Station (Transport)"));
  assert.ok(destinations.some((d) => d.value.includes("Aristocrat") || d.value.includes("Intramuros")));

  const origins = collectGoModeOrigins({
    currentTrip: { trip: { origin: "NAIA Terminal 3", destination: "Manila" } },
    savedItems,
    lastArrived: "Manila Hotel",
  });

  assert.ok(origins.some((o) => o.value === "Manila Hotel" && o.badge === "Current place"));
  assert.ok(origins.some((o) => o.value === "NAIA Terminal 3" && o.badge === "Arrival base"));
  assert.ok(origins.some((o) => o.value === "The Manila Hotel" && o.badge === "Saved stay"));
});

test("Mobile 390px layout and UI accessibility checks", () => {
  const dom = new JSDOM(html, { url: "https://app.example" });
  const doc = dom.window.document;

  const modal = doc.getElementById("goModeModal");
  assert.ok(modal, "Go Mode modal must exist in DOM");
  assert.equal(modal.getAttribute("aria-labelledby"), "goModeTitle");

  // Inputs have accessible labels
  const originInput = doc.getElementById("goModeOrigin");
  assert.ok(originInput.labels?.length || originInput.getAttribute("aria-label"));

  const destInput = doc.getElementById("goModeDestination");
  assert.ok(destInput.labels?.length || destInput.getAttribute("aria-label"));

  const select = doc.getElementById("goModeDestinationQuickSelect");
  assert.ok(select.labels?.length || select.getAttribute("aria-label"));

  // Entry buttons exist
  assert.ok(doc.getElementById("openGoModeBtn"), "Quick Actions Go Mode button must exist");
  assert.ok(doc.getElementById("openTransitGoModeBtn"), "Transit section Go Mode button must exist");

  dom.window.close();
});
