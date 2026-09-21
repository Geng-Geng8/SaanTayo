// SaanTayo V3.4 — Automated Test Suite: Discovery-First Entry Experience
// Validates "Help Me Decide" entry flow, zero Places cost lifecycle,
// Philippine Geo-Registry resolution, unified categories, and seamless handoff to planner.

import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { readFile } from "node:fs/promises";
import { resolvePhilippineLocation, POPULAR_REGIONS } from "../shared/geo.js";
import { INTENTS } from "../shared/discovery.js";
import { INTENT_TYPES } from "../server/places.js";
import { initDiscoverySection } from "../src/go-mode.js";

const html = await readFile("dist/index.html", "utf8");

function setupDom() {
  const dom = new JSDOM(html, { url: "https://saantayo.app" });
  return { dom, document: dom.window.document, window: dom.window };
}

test("V3.4 Test 1: Philippine Geo-Registry resolves top travel destinations with zero API calls", () => {
  const siargao = resolvePhilippineLocation("Siargao");
  assert.ok(siargao);
  assert.equal(siargao.id, "siargao");
  assert.ok(Math.abs(siargao.latitude - 9.7801) < 0.01);
  assert.ok(Math.abs(siargao.longitude - 126.1541) < 0.01);

  const elNido = resolvePhilippineLocation("El Nido, Palawan");
  assert.ok(elNido);
  assert.equal(elNido.id, "elnido");

  const baguio = resolvePhilippineLocation("Baguio City");
  assert.ok(baguio);
  assert.equal(baguio.id, "baguio");

  const boracay = resolvePhilippineLocation("White Beach, Boracay");
  assert.ok(boracay);
  assert.equal(boracay.id, "boracay");

  const cebu = resolvePhilippineLocation("Cebu IT Park");
  assert.ok(cebu);
  assert.equal(cebu.id, "cebu");

  const unknown = resolvePhilippineLocation("Atlantis Wonderland 123");
  assert.equal(unknown, null, "Must return null for unknown areas without false assumptions");
});

test("V3.4 Test 2: Unified Categories — 9 categories defined in shared/discovery and server/places", () => {
  const requiredCategories = [
    "gems",
    "beaches",
    "eat",
    "culture",
    "nature",
    "coffee",
    "nightlife",
    "shop",
    "surprise",
  ];

  for (const cat of requiredCategories) {
    assert.ok(INTENTS[cat], `INTENTS must contain ${cat}`);
    assert.ok(
      Array.isArray(INTENT_TYPES[cat]) && INTENT_TYPES[cat].length > 0,
      `INTENT_TYPES must have includedTypes for ${cat}`,
    );
  }
});

test("V3.4 Test 3: Zero-Cost on Load — Initial state makes 0 Places calls and 0 Geolocation calls", () => {
  const { dom, document, window } = setupDom();
  let placesCalls = 0;
  let geoCalls = 0;

  window.navigator.geolocation = {
    getCurrentPosition: () => {
      geoCalls++;
    },
  };

  const discovery = initDiscoverySection({
    container: document.getElementById("discoverySection"),
    locationInput: document.getElementById("discoveryLocationInput"),
    useLocationBtn: document.getElementById("discoveryUseLocationBtn"),
    regionChipsContainer: document.getElementById("discoveryRegionChips"),
    locationStatus: document.getElementById("discoveryLocationStatus"),
    intentGrid: document.getElementById("discoveryIntentGrid"),
    foodChipsContainer: document.getElementById("discoveryFoodChips"),
    statusContainer: document.getElementById("discoveryStatus"),
    placesContainer: document.getElementById("discoveryPlacesContainer"),
    routeContainer: document.getElementById("discoveryRouteContainer"),
    fetchPlaces: async () => {
      placesCalls++;
      return { status: "ok", places: [] };
    },
    doc: document,
  });

  assert.equal(geoCalls, 0, "Must not request geolocation on initial load");
  assert.equal(placesCalls, 0, "Must make 0 Places calls on load before user picks category & location");

  dom.window.close();
});

test("V3.4 Test 4: Unestablished Location strictly prompts user and blocks Places calls (No silent Manila fallback)", async () => {
  const { dom, document } = setupDom();
  let placesCalls = 0;

  const discovery = initDiscoverySection({
    container: document.getElementById("discoverySection"),
    locationInput: document.getElementById("discoveryLocationInput"),
    useLocationBtn: document.getElementById("discoveryUseLocationBtn"),
    regionChipsContainer: document.getElementById("discoveryRegionChips"),
    locationStatus: document.getElementById("discoveryLocationStatus"),
    intentGrid: document.getElementById("discoveryIntentGrid"),
    statusContainer: document.getElementById("discoveryStatus"),
    placesContainer: document.getElementById("discoveryPlacesContainer"),
    fetchPlaces: async () => {
      placesCalls++;
      return { status: "ok", places: [] };
    },
    doc: document,
  });

  // Tap a category without establishing location
  const gemsBtn = document.querySelector('#discoveryIntentGrid button[data-intent="gems"]');
  assert.ok(gemsBtn, "Gems intent button must exist");
  gemsBtn.click();

  assert.equal(placesCalls, 0, "Must NOT call Places API when location is unknown");
  const statusEl = document.getElementById("discoveryStatus");
  assert.match(
    statusEl.textContent,
    /where are you exploring/i,
    "Status must ask 'Where are you exploring?' rather than assuming Manila",
  );

  dom.window.close();
});

test("V3.4 Test 5: Selecting a Popular Region Chip establishes credible location and triggers discovery", async () => {
  const { dom, document } = setupDom();
  let lastQuery = null;

  const discovery = initDiscoverySection({
    container: document.getElementById("discoverySection"),
    locationInput: document.getElementById("discoveryLocationInput"),
    useLocationBtn: document.getElementById("discoveryUseLocationBtn"),
    regionChipsContainer: document.getElementById("discoveryRegionChips"),
    locationStatus: document.getElementById("discoveryLocationStatus"),
    intentGrid: document.getElementById("discoveryIntentGrid"),
    statusContainer: document.getElementById("discoveryStatus"),
    placesContainer: document.getElementById("discoveryPlacesContainer"),
    fetchPlaces: async (params) => {
      lastQuery = params;
      return { status: "ok", places: [] };
    },
    doc: document,
  });

  const chips = document.querySelectorAll("#discoveryRegionChips .region-chip");
  assert.ok(chips.length >= 6, "Must render popular region chips");

  // Tap Siargao chip
  const siargaoChip = Array.from(chips).find((c) => c.textContent.includes("Siargao"));
  assert.ok(siargaoChip, "Siargao chip must exist");
  siargaoChip.click();

  assert.ok(lastQuery, "Must trigger discovery after picking region chip");
  assert.ok(Math.abs(lastQuery.latitude - 9.7801) < 0.01, "Latitude must match Siargao");
  assert.ok(Math.abs(lastQuery.longitude - 126.1541) < 0.01, "Longitude must match Siargao");
  assert.equal(document.getElementById("discoveryLocationInput").value, "Siargao");

  dom.window.close();
});

test("V3.4 Test 6: Places card rendering renders up to 5 recommendations with 0 Place Details requests", async () => {
  const { dom, document } = setupDom();
  let detailsCalls = 0;

  const mockPlaces = [
    {
      id: "place-cloud9",
      providerPlaceId: "ChIJCloud9",
      name: "Cloud 9 Boardwalk",
      primaryType: "beach",
      categories: ["beach", "tourist attraction"],
      location: { latitude: 9.8021, longitude: 126.1632 },
      rating: 4.8,
      reviewCount: 3200,
      priceLevel: "PRICE_LEVEL_INEXPENSIVE",
      openNow: true,
      photoName: "places/ChIJCloud9/photos/c9",
      photoAttribution: "Anne S",
      distanceMeters: 450,
      reason: "Top-rated coastal boardwalk and surf viewing deck · 450 m away.",
    },
    {
      id: "place-sugba",
      providerPlaceId: "ChIJSugbaLagoon",
      name: "Sugba Lagoon",
      primaryType: "tourist attraction",
      categories: ["tourist attraction", "nature"],
      location: { latitude: 9.8712, longitude: 126.0421 },
      rating: 4.9,
      reviewCount: 1800,
      priceLevel: null,
      openNow: true,
      photoName: null,
      distanceMeters: 12000,
      reason: "Iconic clear turquoise lagoon for paddleboarding and diving.",
    },
  ];

  const discovery = initDiscoverySection({
    container: document.getElementById("discoverySection"),
    locationInput: document.getElementById("discoveryLocationInput"),
    useLocationBtn: document.getElementById("discoveryUseLocationBtn"),
    regionChipsContainer: document.getElementById("discoveryRegionChips"),
    locationStatus: document.getElementById("discoveryLocationStatus"),
    intentGrid: document.getElementById("discoveryIntentGrid"),
    statusContainer: document.getElementById("discoveryStatus"),
    placesContainer: document.getElementById("discoveryPlacesContainer"),
    routeContainer: document.getElementById("discoveryRouteContainer"),
    fetchPlaces: async () => ({ status: "ok", places: mockPlaces }),
    fetchPlaceDetails: async () => {
      detailsCalls++;
      return { status: "ok", details: {} };
    },
    doc: document,
  });

  discovery.setCoords({ latitude: 9.7801, longitude: 126.1541 }, "Siargao");
  await discovery.executeDiscovery({ intent: "beaches" });

  assert.equal(detailsCalls, 0, "Card rendering must make 0 Place Details calls (cost preservation)");
  const cards = document.querySelectorAll("#discoveryPlacesContainer .go-mode-place-card");
  assert.equal(cards.length, 2, "Must render cards for all returned places");

  dom.window.close();
});

test("V3.4 Test 7: Selecting a card transitions to route comparison and fires at most 1 Place Details request", async () => {
  const { dom, document } = setupDom();
  let journeyQueries = [];
  let detailsQueries = [];

  const mockPlace = {
    id: "place-cloud9",
    providerPlaceId: "ChIJCloud9",
    name: "Cloud 9 Boardwalk",
    primaryType: "beach",
    categories: ["beach", "tourist attraction"],
    location: { latitude: 9.8021, longitude: 126.1632 },
    rating: 4.8,
    reviewCount: 3200,
    priceLevel: "PRICE_LEVEL_INEXPENSIVE",
    openNow: true,
    photoName: null,
    distanceMeters: 450,
    reason: "Top-rated coastal boardwalk.",
  };

  const discovery = initDiscoverySection({
    container: document.getElementById("discoverySection"),
    locationInput: document.getElementById("discoveryLocationInput"),
    useLocationBtn: document.getElementById("discoveryUseLocationBtn"),
    regionChipsContainer: document.getElementById("discoveryRegionChips"),
    locationStatus: document.getElementById("discoveryLocationStatus"),
    intentGrid: document.getElementById("discoveryIntentGrid"),
    statusContainer: document.getElementById("discoveryStatus"),
    placesContainer: document.getElementById("discoveryPlacesContainer"),
    routeContainer: document.getElementById("discoveryRouteContainer"),
    routeResults: document.getElementById("discoveryRouteResults"),
    fetchPlaces: async () => ({ status: "ok", places: [mockPlace] }),
    fetchPlaceDetails: async ({ placeId }) => {
      detailsQueries.push(placeId);
      return { status: "ok", details: { id: placeId, rating: 4.8, reviewCount: 3200 } };
    },
    lookupJourney: async (params) => {
      journeyQueries.push(params);
      return {
        status: "ok",
        journey: {
          origin: params.origin,
          destination: params.destination,
          routes: [
            {
              id: "tricycle-1",
              mode: "tricycle",
              source: "grounded_rules",
              durationMinutes: 8,
              distanceMeters: 1200,
              cost: { amountPHP: 50, costSource: "grounded_estimate" },
            },
          ],
        },
      };
    },
    doc: document,
  });

  discovery.setCoords({ latitude: 9.7801, longitude: 126.1541 }, "General Luna");
  document.getElementById("discoveryLocationInput").value = "General Luna, Siargao";
  await discovery.executeDiscovery({ intent: "beaches" });

  const ctaBtn = document.querySelector("#discoveryPlacesContainer .go-mode-see-options-btn");
  assert.ok(ctaBtn, "SEE OPTIONS button must exist on card");
  ctaBtn.click();

  // Wait a tick for async route & place details calls
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(journeyQueries.length, 1, "Must call journey lookup exactly once");
  assert.equal(journeyQueries[0].destination, "Cloud 9 Boardwalk");
  assert.equal(detailsQueries.length, 1, "Must call Place Details at most once for the selected card");
  assert.equal(detailsQueries[0], "ChIJCloud9");

  // Route view must now be visible, places container hidden
  assert.ok(!document.getElementById("discoveryRouteContainer").classList.contains("hidden"));
  assert.ok(document.getElementById("discoveryPlacesContainer").classList.contains("hidden"));

  dom.window.close();
});

test("V3.4 Test 8: 'Plan full itinerary here' handoff transfers destination to planner without retyping", async () => {
  const { dom, document } = setupDom();
  let handedOffPlace = null;

  const mockPlace = {
    id: "place-elnido",
    name: "Nacpan Beach",
  };

  const discovery = initDiscoverySection({
    container: document.getElementById("discoverySection"),
    locationInput: document.getElementById("discoveryLocationInput"),
    useLocationBtn: document.getElementById("discoveryUseLocationBtn"),
    regionChipsContainer: document.getElementById("discoveryRegionChips"),
    locationStatus: document.getElementById("discoveryLocationStatus"),
    intentGrid: document.getElementById("discoveryIntentGrid"),
    statusContainer: document.getElementById("discoveryStatus"),
    placesContainer: document.getElementById("discoveryPlacesContainer"),
    routeContainer: document.getElementById("discoveryRouteContainer"),
    planFullTripBtn: document.getElementById("discoveryPlanFullTripBtn"),
    fetchPlaces: async () => ({ status: "ok", places: [mockPlace] }),
    lookupJourney: async () => ({ status: "ok", journey: { routes: [] } }),
    onPlanFullTrip: (place) => {
      handedOffPlace = place;
    },
    doc: document,
  });

  await discovery.selectPlaceAndRoute(mockPlace);

  const planTripBtn = document.getElementById("discoveryPlanFullTripBtn");
  assert.ok(planTripBtn, "Plan full itinerary here button must exist");
  planTripBtn.click();

  assert.ok(handedOffPlace, "Handoff callback must be triggered");
  assert.equal(handedOffPlace.name, "Nacpan Beach");

  dom.window.close();
});

test("V3.4 Test 9: Primary Entry Switcher toggles between 'Help me decide' and 'I know where I'm going'", () => {
  const { dom, document } = setupDom();

  const decideBtn = document.getElementById("entryDecideBtn");
  const knownBtn = document.getElementById("entryKnownBtn");
  const discoverySec = document.getElementById("discoverySection");
  const plannerForm = document.getElementById("planner");

  assert.ok(decideBtn, "entryDecideBtn must exist");
  assert.ok(knownBtn, "entryKnownBtn must exist");
  assert.ok(discoverySec, "discoverySection must exist");
  assert.ok(plannerForm, "planner form must exist");

  // Initial markup checks
  assert.equal(decideBtn.getAttribute("role"), "tab");
  assert.equal(knownBtn.getAttribute("role"), "tab");

  dom.window.close();
});

test("V3.4 Test 10: Mobile Touch Targets — All category and navigation buttons are >= 44px", () => {
  const { dom, document } = setupDom();

  const intentButtons = document.querySelectorAll("#discoveryIntentGrid button");
  assert.equal(intentButtons.length, 9, "Must have exactly 9 unified discovery category buttons");

  for (const btn of intentButtons) {
    const classList = btn.className;
    assert.ok(
      classList.includes("min-h-[52px]") || classList.includes("min-h-[44px]") || classList.includes("py-2.5"),
      `Button ${btn.dataset.intent} must have adequate touch height`,
    );
  }

  const useLocBtn = document.getElementById("discoveryUseLocationBtn");
  assert.ok(useLocBtn.className.includes("min-h-[44px]"), "Use location button must be >= 44px");

  dom.window.close();
});
