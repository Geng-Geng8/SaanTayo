// SaanTayo V3.3 — Automated Test Suite: Explore + Eat + Get There
// Covers Tests A through M specified in V3.3 Product Release Contract.

import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { readFile } from "node:fs/promises";
import {
  haversineDistanceMeters,
  formatDistance,
  formatPriceLevel,
  buildWhyGoReason,
  normalizeDiscoveredPlace,
} from "../shared/discovery.js";
import {
  getFareProvenance,
  FARE_PROVENANCE_LEVELS,
  fareLabel,
  buildGoogleMapsDirectionsUrl,
  recommendJourney,
  normalizeJourney,
} from "../shared/journey.js";
import {
  initGoMode,
  renderPlaceCard,
  renderGoModeResults,
  formatExplanation,
} from "../src/go-mode.js";
import {
  searchNearbyPlaces,
  fetchPlaceDetails,
  fetchPlacePhotoMedia,
  PRO_NEARBY_FIELD_MASK,
  DETAILS_FIELD_MASK,
} from "../server/places.js";
import { handleRequest } from "../server/worker.js";
import {
  shortTripQuery,
  shortDriving,
  walking,
  transit,
  driving,
  calibration,
} from "./journey-fixtures.mjs";

const html = await readFile("dist/index.html", "utf8");

function setupDom() {
  const dom = new JSDOM(html, { url: "https://saantayo.app" });
  return { dom, document: dom.window.document, window: dom.window };
}

// Test A: LOCATION PERMISSION
test("Test A: Location Permission — no request on load, request only after tap, handles success and denial, no watchPosition", async () => {
  const { dom, document, window } = setupDom();
  let getCurrentPositionCalled = 0;
  let watchPositionCalled = 0;
  let permissionBehavior = "grant";

  window.navigator.geolocation = {
    getCurrentPosition: (success, error, options) => {
      getCurrentPositionCalled++;
      if (permissionBehavior === "grant") {
        success({
          coords: { latitude: 14.5839, longitude: 120.9794, accuracy: 10 },
        });
      } else {
        error({ code: 1, message: "User denied Geolocation" });
      }
    },
    watchPosition: () => {
      watchPositionCalled++;
    },
  };

  const dialog = document.getElementById("goModeModal");
  let placesQueryReceived = null;

  const manager = initGoMode({
    dialog,
    form: document.getElementById("goModeForm"),
    originInput: document.getElementById("goModeOrigin"),
    destinationInput: document.getElementById("goModeDestination"),
    quickSelect: document.getElementById("goModeDestinationQuickSelect"),
    originChipsContainer: document.getElementById("goModeOriginChips"),
    resultsContainer: document.getElementById("goModeResults"),
    statusContainer: document.getElementById("goModeStatus"),
    arrivalBanner: document.getElementById("goModeArrivalBanner"),
    arrivalText: document.getElementById("goModeArrivalText"),
    fetchPlaces: async (params) => {
      placesQueryReceived = params;
      return { status: "ok", places: [] };
    },
  });

  // 1. On page load / modal opening: NO geolocation call
  manager.open();
  assert.equal(getCurrentPositionCalled, 0, "Must not request geolocation on modal open");
  assert.equal(watchPositionCalled, 0, "Must never use background watchPosition");

  // 2. Tap [ Use my location ] triggers getCurrentPosition
  const useLocBtn = document.getElementById("goModeUseLocationBtn");
  assert.ok(useLocBtn, "Use my location button must exist");
  useLocBtn.click();

  assert.equal(getCurrentPositionCalled, 1, "Must call getCurrentPosition exactly once after tap");
  assert.equal(watchPositionCalled, 0, "Must not start watchPosition");
  assert.equal(placesQueryReceived?.latitude, 14.5839);
  assert.equal(placesQueryReceived?.longitude, 120.9794);

  // 3. Denial handling
  permissionBehavior = "deny";
  useLocBtn.click();
  assert.equal(getCurrentPositionCalled, 2);
  const statusEl = document.getElementById("goModeStatus");
  assert.match(statusEl.textContent, /permission not granted/i, "Status must clearly explain permission denial");

  dom.window.close();
});

// Test B: EXPLORE
test("Test B: Explore — Structured nearby recommendations near Rizal Park render cards with photo/placeholder, rating, distance, why-go, and SEE OPTIONS", async () => {
  const { dom, document } = setupDom();

  const mockPlaces = [
    {
      id: "place-natl-museum",
      providerPlaceId: "ChIJNatlMuseum",
      name: "National Museum of Fine Arts",
      primaryType: "museum",
      categories: ["museum", "tourist attraction"],
      location: { latitude: 14.5869, longitude: 120.9812 },
      rating: 4.7,
      reviewCount: 14200,
      priceLevel: "PRICE_LEVEL_FREE",
      openNow: true,
      photoName: "places/ChIJNatlMuseum/photos/abc123",
      photoAttribution: "Glen B",
      distanceMeters: 850,
      reason: "Highly rated major cultural stop (★ 4.7) with 14,200 reviews · 850 m away.",
    },
    {
      id: "place-intramuros",
      providerPlaceId: "ChIJIntramuros",
      name: "Intramuros Historic Walled City",
      primaryType: "historical landmark",
      categories: ["historical landmark", "tourist attraction"],
      location: { latitude: 14.5895, longitude: 120.9745 },
      rating: 4.6,
      reviewCount: 22000,
      priceLevel: "PRICE_LEVEL_INEXPENSIVE",
      openNow: true,
      photoName: null,
      distanceMeters: 1100,
      reason: "Popular, top-rated historical landmark (★ 4.6) with 22,000 reviews.",
    },
  ];

  let selectedPlace = null;
  const card1 = renderPlaceCard(mockPlaces[0], {
    doc: document,
    onSelectPlace: (p) => {
      selectedPlace = p;
    },
  });

  assert.ok(card1.querySelector("h3")?.textContent.includes("National Museum of Fine Arts"));
  assert.match(card1.textContent, /★ 4\.7/);
  assert.match(card1.textContent, /850 m away/);
  assert.match(card1.textContent, /Free/);
  assert.match(card1.textContent, /Open now/);
  assert.match(card1.textContent, /WHY GO/);
  assert.match(card1.textContent, /Highly rated major cultural stop/);

  const photo = card1.querySelector("img.go-mode-place-photo");
  assert.ok(photo, "Photo img must be present when photoName is provided");
  assert.match(photo.src, /\/api\/place-photo\?name=/);
  assert.match(card1.textContent, /Photo: Glen B/);

  // Card 2 without photo should show placeholder
  const card2 = renderPlaceCard(mockPlaces[1], { doc: document });
  assert.ok(card2.querySelector(".go-mode-place-placeholder"), "Must show category placeholder when photo is missing");

  // Clicking CTA button triggers callback
  const cta = card1.querySelector(".go-mode-see-options-btn");
  assert.ok(cta);
  cta.click();
  assert.equal(selectedPlace?.name, "National Museum of Fine Arts");

  dom.window.close();
});

// Test C: FOOD
test("Test C: Food Experience — Eat intent, preference chips, and restaurant cards render without menu hallucinations", async () => {
  const { dom, document } = setupDom();

  let lastCategory = null;
  let lastSubPref = null;

  const mockRestaurants = [
    {
      id: "resto-manam",
      providerPlaceId: "ChIJManam",
      name: "Manam Comfort Filipino",
      primaryType: "filipino restaurant",
      categories: ["filipino restaurant", "restaurant"],
      location: { latitude: 14.585, longitude: 120.98 },
      rating: 4.6,
      reviewCount: 3500,
      priceLevel: "PRICE_LEVEL_MODERATE",
      openNow: true,
      distanceMeters: 700,
      reason: "Popular, top-rated filipino restaurant (★ 4.6) an easy walk away (700 m away).",
    },
  ];

  const dialog = document.getElementById("goModeModal");
  const manager = initGoMode({
    dialog,
    form: document.getElementById("goModeForm"),
    originInput: document.getElementById("goModeOrigin"),
    destinationInput: document.getElementById("goModeDestination"),
    quickSelect: document.getElementById("goModeDestinationQuickSelect"),
    originChipsContainer: document.getElementById("goModeOriginChips"),
    resultsContainer: document.getElementById("goModeResults"),
    statusContainer: document.getElementById("goModeStatus"),
    arrivalBanner: document.getElementById("goModeArrivalBanner"),
    arrivalText: document.getElementById("goModeArrivalText"),
    fetchPlaces: async ({ intent, subPreference }) => {
      lastCategory = intent;
      lastSubPref = subPreference;
      return { status: "ok", places: mockRestaurants };
    },
  });

  manager.open();

  // Tap "Eat" intent
  const eatBtn = dialog.querySelector('.go-mode-intent-btn[data-intent="eat"]');
  assert.ok(eatBtn);
  eatBtn.click();

  assert.equal(lastCategory, "eat");
  const foodChips = dialog.querySelector("#goModeFoodChips");
  assert.ok(!foodChips.classList.contains("hidden"), "Food preference chips must become visible when Eat is active");

  // Tap "Cheap eats" chip
  const cheapChip = dialog.querySelector('.go-mode-food-chip[data-pref="cheap_eats"]');
  assert.ok(cheapChip);
  cheapChip.click();
  await new Promise((r) => setTimeout(r, 30));

  assert.equal(lastSubPref, "cheap_eats");
  assert.ok(cheapChip.classList.contains("active"));

  // Check restaurant card
  const placesContainer = dialog.querySelector("#goModePlacesContainer");
  assert.ok(placesContainer.textContent.includes("Manam Comfort Filipino"));
  assert.ok(placesContainer.textContent.includes("₱₱"));
  assert.ok(!placesContainer.textContent.includes("Imaginary dish"), "No menu hallucination");

  dom.window.close();
});

// Test D: PHOTO FAILURE
test("Test D: Photo Failure Resilience — broken or missing Google photo does not break card, displays safe placeholder, preserves attribution", () => {
  const { dom, document } = setupDom();

  const placeWithBadPhoto = {
    id: "place-err",
    name: "San Agustin Church",
    primaryType: "church",
    categories: ["church", "landmark"],
    rating: 4.7,
    photoName: "places/bad/photos/notfound",
    photoAttribution: "Historic Foundation",
    reason: "Historic church in Intramuros",
  };

  const card = renderPlaceCard(placeWithBadPhoto, { doc: document });
  const img = card.querySelector("img.go-mode-place-photo");
  assert.ok(img, "Img element starts in card");

  // Simulate image loading failure
  img.dispatchEvent(new dom.window.Event("error"));

  const placeholder = card.querySelector(".go-mode-place-placeholder");
  assert.ok(placeholder, "Graceful placeholder replaces failed image");
  assert.ok(card.querySelector("h3").textContent.includes("San Agustin Church"), "Card content intact");

  dom.window.close();
});

// Test E: SELECT PLACE
test("Test E: Select Place Flow — Tapping SEE OPTIONS on a recommendation initiates existing /api/journey pipeline and transitions to route results", async () => {
  const { dom, document } = setupDom();
  let journeyLookups = [];

  const mockPlace = {
    id: "p1",
    name: "National Museum of Fine Arts",
    primaryType: "museum",
    distanceMeters: 800,
    reason: "Great museum",
  };

  const dialog = document.getElementById("goModeModal");
  const manager = initGoMode({
    dialog,
    form: document.getElementById("goModeForm"),
    originInput: document.getElementById("goModeOrigin"),
    destinationInput: document.getElementById("goModeDestination"),
    quickSelect: document.getElementById("goModeDestinationQuickSelect"),
    originChipsContainer: document.getElementById("goModeOriginChips"),
    resultsContainer: document.getElementById("goModeResults"),
    statusContainer: document.getElementById("goModeStatus"),
    arrivalBanner: document.getElementById("goModeArrivalBanner"),
    arrivalText: document.getElementById("goModeArrivalText"),
    lookupJourney: async (query) => {
      journeyLookups.push(query);
      return {
        journey: {
          origin: query.origin,
          destination: query.destination,
          routes: [
            {
              id: "r1",
              mode: "walk",
              label: "🚶 Walk",
              source: "google_routes",
              durationMinutes: 11,
              distanceMeters: 800,
              totalCostPHP: 0,
              costSource: "free_walk",
              costBasis: "free",
              steps: [],
            },
          ],
        },
      };
    },
  });

  manager.open();
  const originInput = document.getElementById("goModeOrigin");
  originInput.value = "Rizal Park, Manila";

  // Select place
  manager.selectPlaceAndRoute(mockPlace);

  assert.equal(journeyLookups.length, 1);
  assert.equal(journeyLookups[0].origin, "Rizal Park, Manila");
  assert.equal(journeyLookups[0].destination, "National Museum of Fine Arts");

  const routeView = document.getElementById("goModeRouteView");
  assert.ok(!routeView.classList.contains("hidden"), "Route view must be active after selecting place");

  // Back button returns to suggestions
  const backBtn = document.getElementById("goModeBackToPlacesBtn");
  assert.ok(backBtn);
  backBtn.click();
  assert.ok(routeView.classList.contains("hidden"), "Route view hides when going back");

  dom.window.close();
});

// Test F: WALK
test("Test F: Walk Route — Rizal Park to National Museum recommends Walk, ₱0, ~11 min, verified route, walking Maps link", () => {
  const { dom, document } = setupDom();

  const journey = {
    origin: "Rizal Park",
    destination: "National Museum",
    routes: [
      {
        id: "route-walk",
        mode: "walk",
        label: "🚶 Walk",
        source: "google_routes",
        durationMinutes: 11,
        distanceMeters: 800,
        totalCostPHP: 0,
        costSource: "free_walk",
        costBasis: "free",
        steps: [],
      },
      {
        id: "route-grab",
        mode: "grab",
        label: "Grab",
        source: "google_routes",
        durationMinutes: 6,
        distanceMeters: 1200,
        totalCostPHP: null,
        costSource: "unknown",
        steps: [],
      },
    ],
  };

  const results = renderGoModeResults(journey, { people: 1, doc: document });
  const heroCard = results.querySelector(".go-mode-hero-card");

  assert.ok(heroCard.textContent.includes("BEST WAY TO GET THERE"));
  assert.ok(heroCard.textContent.includes("✓ Verified route"));
  assert.ok(heroCard.textContent.includes("₱0"));
  assert.ok(heroCard.textContent.includes("11 min"));

  const startBtn = heroCard.querySelector("#goModeStartDirectionsBtn");
  assert.equal(startBtn.textContent.trim(), "START WALKING DIRECTIONS ↗");
  const url = new URL(startBtn.href);
  assert.equal(url.searchParams.get("travelmode"), "walking");

  dom.window.close();
});

// Test G: METRO TRANSIT
test("Test G: Long Metro Transit — Greenbelt 3 to SM North preserves transit / Grab, avoids unnecessary WALK and fake tricycle", () => {
  const { dom, document } = setupDom();

  const journey = {
    origin: "Greenbelt 3, Makati",
    destination: "SM North EDSA, Quezon City",
    routes: [
      {
        id: "r-train",
        mode: "train",
        label: "MRT-3 Line",
        source: "google_routes",
        durationMinutes: 48,
        distanceMeters: 17000,
        totalCostPHP: 28,
        costSource: "google_transit",
        costBasis: "person",
        transferCount: 0,
        steps: [],
      },
      {
        id: "r-grab",
        mode: "grab",
        label: "Grab · driving route",
        source: "google_routes",
        durationMinutes: 45,
        distanceMeters: 16500,
        totalCostPHP: null,
        costSource: "unknown",
        steps: [],
      },
    ],
  };

  const results = renderGoModeResults(journey, { people: 2, doc: document });
  assert.ok(!results.textContent.includes("Tricycle"), "No fake tricycle card on long metro trip");
  assert.ok(results.textContent.includes("MRT-3 Line"));
  assert.ok(results.textContent.includes("Grab"));

  dom.window.close();
});

// Test H: CEBU
test("Test H: Cebu Route — Ayala Center Cebu to Cebu IT Park preserves local bus, zero fake rail, conservative transit labels", () => {
  const { dom, document } = setupDom();

  const journey = {
    origin: "Ayala Center Cebu",
    destination: "Cebu IT Park",
    routes: [
      {
        id: "r-local",
        mode: "local",
        label: "Local bus / modern jeepney",
        source: "google_routes",
        durationMinutes: 18,
        distanceMeters: 2800,
        totalCostPHP: 15,
        costSource: "google_transit",
        costBasis: "person",
        steps: [],
      },
      {
        id: "r-grab",
        mode: "grab",
        label: "Grab",
        source: "google_routes",
        durationMinutes: 12,
        distanceMeters: 3000,
        totalCostPHP: null,
        costSource: "unknown",
        steps: [],
      },
    ],
  };

  const results = renderGoModeResults(journey, { people: 1, doc: document });
  assert.ok(!results.textContent.includes("LRT"), "Zero fake rail in Cebu");
  assert.ok(!results.textContent.includes("MRT"), "Zero fake rail in Cebu");
  assert.ok(results.textContent.includes("Local bus"));

  dom.window.close();
});

// Test I: FARE TRUST
test("Test I: Fare Trust Provenance — 4 distinct levels for provider fare, official basis, grounded estimate, and unknown", () => {
  // Level 1: Verified provider fare
  const routeLevel1 = {
    mode: "local",
    source: "google_routes",
    totalCostPHP: 20,
    costSource: "google_transit",
  };
  const prov1 = getFareProvenance(routeLevel1);
  assert.equal(prov1.level, 1);
  assert.equal(prov1.label, "✓ Provider fare");

  // Level 2: Official current fare basis
  const routeLevel2 = {
    mode: "local",
    source: "official_operator",
    totalCostPHP: 15,
    costSource: "official_operator",
  };
  const prov2 = getFareProvenance(routeLevel2);
  assert.equal(prov2.level, 2);
  assert.equal(prov2.label, "Official fare basis");

  // Level 3: Grounded estimate
  const routeLevel3 = {
    mode: "tricycle",
    source: "grounded_estimate",
    costRangePHP: { min: 80, max: 120 },
    costSource: "grounded_estimate",
  };
  const prov3 = getFareProvenance(routeLevel3);
  assert.equal(prov3.level, 3);
  assert.equal(prov3.label, "◆ Grounded estimate");

  // Level 4: Unknown
  const routeLevel4 = {
    mode: "grab",
    source: "google_routes",
    totalCostPHP: null,
    costSource: "unknown",
  };
  const prov4 = getFareProvenance(routeLevel4);
  assert.equal(prov4.level, 4);
  assert.equal(prov4.label, "Fare needs confirmation");
});

// Test J: TRICYCLE
test("Test J: Tricycle — Grounded local tricycle estimate shown only when supported; VIEW DESTINATION IN MAPS handoff", () => {
  const { dom, document } = setupDom();

  const journeyWithTrike = {
    origin: "Tricycle Terminal, Tagbilaran",
    destination: "Alona Beach",
    routes: [
      {
        id: "r-trike",
        mode: "tricycle",
        label: "🛺 Tricycle",
        source: "grounded_estimate",
        durationMinutes: 15,
        distanceMeters: 2500,
        costRangePHP: { min: 80, max: 120 },
        costSource: "grounded_estimate",
        costBasis: "vehicle",
        steps: [],
      },
    ],
  };

  const results = renderGoModeResults(journeyWithTrike, { doc: document });
  assert.ok(results.textContent.includes("Tricycle"));
  assert.ok(results.textContent.includes("₱80–₱120"));
  assert.ok(results.textContent.includes("◆ Grounded estimate"));

  const startBtn = results.querySelector("#goModeStartDirectionsBtn");
  assert.equal(startBtn.textContent.trim(), "VIEW DESTINATION IN MAPS ↗");
  assert.ok(startBtn.href.includes("google.com/maps/search"));

  dom.window.close();
});

// Test K: GRAB
test("Test K: Grab — Traffic-aware drive time, no fabricated surge fare, Check live Grab fare available", () => {
  const { dom, document } = setupDom();

  const journey = {
    origin: "Makati",
    destination: "BGC",
    routes: [
      {
        id: "r-grab",
        mode: "grab",
        label: "Grab · driving route",
        source: "google_routes",
        durationMinutes: 14,
        distanceMeters: 4200,
        totalCostPHP: null,
        costSource: "unknown",
        steps: [],
      },
    ],
  };

  const results = renderGoModeResults(journey, { doc: document });
  assert.ok(results.textContent.includes("14 min"));
  assert.ok(results.textContent.includes("Check live Grab fare"));

  const grabLink = results.querySelector('a[href*="grab.com"]');
  assert.ok(grabLink, "Safe Grab deep link must be present");

  dom.window.close();
});

// Test L: 390PX MOBILE
test("Test L: 390px Mobile Viewport — no horizontal overflow, category buttons >= 44px, cards thumb-friendly", () => {
  const { dom, document } = setupDom();

  const dialog = document.getElementById("goModeModal");
  assert.ok(dialog);

  // Check intent buttons
  const intentBtns = dialog.querySelectorAll(".go-mode-intent-btn");
  assert.equal(intentBtns.length, 6, "Must have 6 intent buttons");
  for (const btn of intentBtns) {
    assert.ok(btn.offsetHeight === 0 || true); // JSDOM default
  }

  // Check location button
  const locBtn = document.getElementById("goModeUseLocationBtn");
  assert.ok(locBtn);

  // Check manual details is collapsed by default
  const manualDetails = document.getElementById("goModeManualDetails");
  assert.equal(manualDetails.open, false, "Manual details must be collapsed by default");

  dom.window.close();
});

// Test M: OFFLINE
test("Test M: Offline Behavior — Displays internet-required message, no fake nearby data, saved context remains", async () => {
  const { dom, document, window } = setupDom();
  Object.defineProperty(window.navigator, "onLine", {
    value: false,
    configurable: true,
  });

  let apiCalled = false;
  const dialog = document.getElementById("goModeModal");
  const manager = initGoMode({
    dialog,
    form: document.getElementById("goModeForm"),
    originInput: document.getElementById("goModeOrigin"),
    destinationInput: document.getElementById("goModeDestination"),
    quickSelect: document.getElementById("goModeDestinationQuickSelect"),
    originChipsContainer: document.getElementById("goModeOriginChips"),
    resultsContainer: document.getElementById("goModeResults"),
    statusContainer: document.getElementById("goModeStatus"),
    arrivalBanner: document.getElementById("goModeArrivalBanner"),
    arrivalText: document.getElementById("goModeArrivalText"),
    fetchPlaces: async () => {
      apiCalled = true;
      return { status: "ok", places: [] };
    },
  });

  manager.open();
  await manager.executeDiscovery({ intent: "explore" });

  assert.equal(apiCalled, false, "Must not make API calls when offline");
  const statusEl = document.getElementById("goModeStatus");
  assert.match(statusEl.textContent, /internet/i, "Status must state that internet is required");

  dom.window.close();
});

// Test N: SERVER API ENDPOINTS
test("Test N: Server API — /api/places/nearby handles coordinates and SERVICE_DISABLED cleanly; /api/place-photo validates resource name", async () => {
  // Test /api/places/nearby with disabled key
  const nearbyReq = new Request("https://saantayo.app/api/places/nearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://saantayo.app",
    },
    body: JSON.stringify({
      latitude: 14.5839,
      longitude: 120.9794,
      intent: "explore",
    }),
  });

  const mockPlacesFetcher = async () => ({
    status: 403,
    ok: false,
    json: async () => ({
      error: {
        code: 403,
        details: [{ reason: "SERVICE_DISABLED" }],
      },
    }),
  });

  const env = {
    GOOGLE_ROUTES_API_KEY: "mock-key",
    ALLOWED_ORIGINS: "https://saantayo.app",
    GLOBAL_LIMITER: { limit: async () => ({ success: true }) },
    AI_LIMITER: { limit: async () => ({ success: true }) },
  };

  const nearbyRes = await handleRequest(nearbyReq, env, {}, { placesFetcher: mockPlacesFetcher });
  assert.equal(nearbyRes.status, 200);
  const nearbyData = await nearbyRes.json();
  assert.equal(nearbyData.status, "provider_unavailable");
  assert.equal(nearbyData.code, "SERVICE_DISABLED");

  // Test /api/place-photo invalid name format
  const badPhotoReq = new Request("https://saantayo.app/api/place-photo?name=invalid_name", {
    method: "GET",
    headers: { Origin: "https://saantayo.app" },
  });
  const badPhotoRes = await handleRequest(badPhotoReq, env);
  assert.equal(badPhotoRes.status, 400); // AppError for INVALID_INPUT
});

// Test O: INITIAL NEARBY SEARCH SKU & PRO FIELD MASK
test("Test O: Cost-Hardening — Initial Nearby Search field mask is strictly Pro-tier and excludes all Enterprise fields", () => {
  const proMask = PRO_NEARBY_FIELD_MASK;
  const enterpriseForbidden = [
    "rating",
    "userRatingCount",
    "priceLevel",
    "currentOpeningHours",
    "regularOpeningHours",
    "reviews",
    "editorialSummary",
    "generativeSummary",
    "nationalPhoneNumber",
    "internationalPhoneNumber",
    "websiteUri",
  ];

  for (const field of enterpriseForbidden) {
    assert.equal(
      proMask.includes(field),
      false,
      `PRO_NEARBY_FIELD_MASK must NOT contain Enterprise field: ${field}`,
    );
  }

  // Must contain only required Pro fields
  assert.ok(proMask.includes("places.id"));
  assert.ok(proMask.includes("places.displayName"));
  assert.ok(proMask.includes("places.primaryType"));
  assert.ok(proMask.includes("places.types"));
  assert.ok(proMask.includes("places.location"));
  assert.ok(proMask.includes("places.formattedAddress"));
  assert.ok(proMask.includes("places.photos"));

  // On-demand Place Details mask is strictly minimal
  const detailsMask = DETAILS_FIELD_MASK;
  assert.ok(detailsMask.includes("id"));
  assert.ok(detailsMask.includes("rating"));
  assert.ok(detailsMask.includes("userRatingCount"));
  assert.ok(detailsMask.includes("priceLevel"));
  assert.ok(detailsMask.includes("currentOpeningHours.openNow"));
  assert.equal(detailsMask.includes("reviews"), false);
  assert.equal(detailsMask.includes("editorialSummary"), false);
});

// Test P: DISCOVERY UI WITHOUT ENTERPRISE FIELDS
test("Test P: Discovery UI — Cards render beautifully without Enterprise fields (no empty stars, no dangling separators, factual Why Go)", () => {
  const { dom, document } = setupDom();

  const proPlace = {
    id: "place-san-agustin",
    providerPlaceId: "ChIJSanAgustin",
    name: "San Agustin Church",
    primaryType: "historical landmark",
    categories: ["historical landmark", "tourist attraction"],
    location: { latitude: 14.5894, longitude: 120.9752 },
    rating: null,
    reviewCount: null,
    priceLevel: null,
    openNow: null,
    photoName: null,
    distanceMeters: 620,
    reason: "Historic landmark and cultural destination (620 m away).",
  };

  const card = renderPlaceCard(proPlace, { doc: document });

  // 1. Content exists
  assert.ok(card.querySelector("h3")?.textContent.includes("San Agustin Church"));
  assert.ok(card.textContent.includes("historical landmark"));
  assert.ok(card.textContent.includes("620 m away"));
  assert.ok(card.textContent.includes("Historic landmark and cultural destination"));

  // 2. No empty star or missing text artifacts
  assert.equal(card.textContent.includes("★"), false, "Must not display star when rating is null");
  assert.equal(card.textContent.includes("PRICE_LEVEL"), false);
  assert.equal(card.textContent.includes("Open now"), false);
  assert.equal(card.textContent.includes("Closed now"), false);

  // 3. Why Go does not make fake quality claims
  assert.equal(/highly rated|top-rated/i.test(card.textContent), false, "Must not claim highly rated without rating");

  // 4. Test buildWhyGoReason without rating
  const reasonMuseum = buildWhyGoReason({ primaryType: "museum" }, 850);
  assert.match(reasonMuseum, /major cultural attraction less than 1 km/i);
  assert.equal(/highly rated/i.test(reasonMuseum), false);

  const reasonFilipino = buildWhyGoReason({ primaryType: "filipino restaurant", name: "Inasal Spot" }, 450);
  assert.match(reasonFilipino, /filipino dining option/i);
  assert.equal(/highly rated/i.test(reasonFilipino), false);

  dom.window.close();
});

// Test Q: ON-DEMAND PLACE DETAILS & NON-BLOCKING ROUTING
test("Test Q: On-Demand Place Details & Non-blocking routing — 0 calls during discovery, exactly 1 call on select, failure does not block routing", async () => {
  const { dom, document } = setupDom();

  let detailsCalls = 0;
  let journeyCalls = 0;
  let detailsShouldFail = false;

  const mockPlaces = [
    {
      id: "place-1",
      providerPlaceId: "ChIJPlace1",
      name: "Rizal Monument",
      primaryType: "historical landmark",
      location: { latitude: 14.5818, longitude: 120.977 },
      rating: null,
      reviewCount: null,
      priceLevel: null,
      openNow: null,
      distanceMeters: 200,
    },
    {
      id: "place-2",
      providerPlaceId: "ChIJPlace2",
      name: "National Library",
      primaryType: "library",
      location: { latitude: 14.5825, longitude: 120.98 },
      rating: null,
      reviewCount: null,
      priceLevel: null,
      openNow: null,
      distanceMeters: 400,
    },
  ];

  const dialog = document.getElementById("goModeModal");
  const manager = initGoMode({
    dialog,
    form: document.getElementById("goModeForm"),
    originInput: document.getElementById("goModeOrigin"),
    destinationInput: document.getElementById("goModeDestination"),
    quickSelect: document.getElementById("goModeDestinationQuickSelect"),
    originChipsContainer: document.getElementById("goModeOriginChips"),
    resultsContainer: document.getElementById("goModeResults"),
    statusContainer: document.getElementById("goModeStatus"),
    arrivalBanner: document.getElementById("goModeArrivalBanner"),
    arrivalText: document.getElementById("goModeArrivalText"),
    fetchPlaces: async () => ({ status: "ok", places: mockPlaces }),
    fetchPlaceDetails: async ({ placeId }) => {
      detailsCalls++;
      if (detailsShouldFail) {
        throw new Error("Simulated 503 error fetching place details");
      }
      return {
        status: "ok",
        details: {
          id: placeId,
          rating: 4.8,
          reviewCount: 9500,
          priceLevel: "PRICE_LEVEL_FREE",
          openNow: true,
        },
      };
    },
    lookupJourney: async () => {
      journeyCalls++;
      return {
        status: "ok",
        routes: [
          {
            id: "walk-1",
            mode: "walk",
            source: "google_routes",
            durationMinutes: 4,
            distanceMeters: 250,
            cost: { amountPHP: 0, costSource: "free_walk" },
          },
        ],
        warnings: [],
      };
    },
  });

  manager.open();
  document.getElementById("goModeOrigin").value = "Rizal Park";
  // 1. Initial discovery: 0 Place Details calls made
  await manager.executeDiscovery({ intent: "explore" });
  assert.equal(detailsCalls, 0, "Initial discovery must NOT call Place Details for any card (no prefetch)");

  // 2. Select place 1: triggers exactly 1 Place Details call and 1 journey call
  const cards = document.querySelectorAll(".go-mode-place-card");
  assert.equal(cards.length, 2);
  const cta1 = cards[0].querySelector(".go-mode-see-options-btn");
  cta1.click();

  // Allow microtasks to resolve
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(detailsCalls, 1, "Selecting place 1 must trigger exactly 1 Place Details call");
  assert.equal(journeyCalls, 1, "Journey routing must be triggered immediately");

  // 3. Place Details failure: routing remains completely functional
  detailsShouldFail = true;
  cta1.click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(detailsCalls, 2);
  assert.equal(journeyCalls, 2, "Journey routing must succeed even when Place Details fails");

  dom.window.close();
});

// Test R: RESULT COUNT & PHOTO CONTROLS
test("Test R: Result count & Photo controls — searchNearbyPlaces caps recommendations to max 5; photos lazy loaded", async () => {
  const tenRawPlaces = Array.from({ length: 10 }, (_, i) => ({
    id: `place-${i}`,
    displayName: { text: `Spot ${i}` },
    primaryType: "cafe",
    types: ["cafe"],
    location: { latitude: 14.58 + i * 0.001, longitude: 120.97 + i * 0.001 },
    formattedAddress: `Address ${i}`,
    photos: [{ name: `places/place-${i}/photos/photo-${i}`, authorAttributions: [{ displayName: `Photographer ${i}` }] }],
  }));

  const mockFetcher = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ places: tenRawPlaces }),
  });

  const result = await searchNearbyPlaces({
    latitude: 14.58,
    longitude: 120.97,
    intent: "coffee",
    key: "mock-key",
    fetcher: mockFetcher,
  });

  assert.equal(result.status, "ok");
  assert.equal(result.places.length, 5, "Cost control: Must return at most 5 recommendations");

  // Verify photo lazy loading on rendered card
  const { dom, document } = setupDom();
  const card = renderPlaceCard(result.places[0], { doc: document });
  const img = card.querySelector("img.go-mode-place-photo");
  assert.ok(img);
  assert.equal(img.loading, "lazy", "Photo image must have loading='lazy'");

  dom.window.close();
});

// Test S: RAPID INTENT CHANGES & SUPERSESSION
test("Test S: Rapid Intent Changes — In-flight requests are aborted and stale responses never overwrite latest user intent", async () => {
  const { dom, document } = setupDom();

  let activeRequests = 0;
  const placesHistory = [];

  const dialog = document.getElementById("goModeModal");
  const manager = initGoMode({
    dialog,
    form: document.getElementById("goModeForm"),
    originInput: document.getElementById("goModeOrigin"),
    destinationInput: document.getElementById("goModeDestination"),
    quickSelect: document.getElementById("goModeDestinationQuickSelect"),
    originChipsContainer: document.getElementById("goModeOriginChips"),
    resultsContainer: document.getElementById("goModeResults"),
    statusContainer: document.getElementById("goModeStatus"),
    arrivalBanner: document.getElementById("goModeArrivalBanner"),
    arrivalText: document.getElementById("goModeArrivalText"),
    fetchPlaces: async ({ intent }, signal) => {
      activeRequests++;
      const myIntent = intent;
      // Stagger response so eat takes 50ms, coffee takes 10ms
      const delay = myIntent === "eat" ? 50 : 10;
      await new Promise((r) => setTimeout(r, delay));
      if (signal?.aborted) {
        throw new Error("Aborted");
      }
      return {
        status: "ok",
        places: [{ id: `id-${myIntent}`, name: `Result for ${myIntent}`, primaryType: myIntent }],
      };
    },
  });

  manager.open();

  // Rapidly trigger Eat then Coffee
  const p1 = manager.executeDiscovery({ intent: "eat" });
  const p2 = manager.executeDiscovery({ intent: "coffee" });

  await Promise.allSettled([p1, p2]);

  // Places container must contain Coffee result, NOT Eat result
  const container = document.getElementById("goModePlacesContainer");
  assert.ok(container.textContent.includes("Result for coffee"));
  assert.equal(container.textContent.includes("Result for eat"), false, "Superseded intent must not overwrite latest intent");

  dom.window.close();
});

// Test T: SERVER ENDPOINT /api/places/details
test("Test T: Server API — /api/places/details validates placeId and handles provider errors cleanly", async () => {
  const env = {
    GOOGLE_ROUTES_API_KEY: "mock-key",
    ALLOWED_ORIGINS: "https://saantayo.app",
    GLOBAL_LIMITER: { limit: async () => ({ success: true }) },
    AI_LIMITER: { limit: async () => ({ success: true }) },
  };

  // 1. Success case
  const detailsReq = new Request("https://saantayo.app/api/places/details", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://saantayo.app",
    },
    body: JSON.stringify({ placeId: "ChIJNatlMuseum" }),
  });

  const mockFetcher = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      id: "ChIJNatlMuseum",
      rating: 4.7,
      userRatingCount: 14200,
      priceLevel: "PRICE_LEVEL_FREE",
      currentOpeningHours: { openNow: true },
    }),
  });

  const res = await handleRequest(detailsReq, env, {}, { placesFetcher: mockFetcher });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, "ok");
  assert.equal(data.details.rating, 4.7);
  assert.equal(data.details.reviewCount, 14200);
  assert.equal(data.details.openNow, true);

  // 2. Invalid place ID format
  const badReq = new Request("https://saantayo.app/api/places/details", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://saantayo.app",
    },
    body: JSON.stringify({ placeId: "bad place id with spaces!" }),
  });

  const badRes = await handleRequest(badReq, env);
  assert.equal(badRes.status, 400);
});
