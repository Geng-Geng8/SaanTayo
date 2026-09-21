import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { initDiscoverySection } from "../src/go-mode.js";
import { handleRequest } from "../server/worker.js";

const html = await readFile("index.html", "utf8");
const origin = "https://saantayo.app";
const settle = () => new Promise((resolve) => setImmediate(resolve));
const rawPlaces = Array.from({ length: 10 }, (_, i) => ({
  id: `place-${i}`,
  displayName: { text: `Shopping stop ${i}` },
  primaryType: "shopping_mall",
  types: ["shopping_mall"],
  location: { latitude: 14.5839 + i * 0.001, longitude: 120.9794 },
}));

function setup(t, options = {}) {
  const dom = new JSDOM(html, { url: origin });
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const el = (id) => document.getElementById(`discovery${id}`);
  const requests = [], googleRequests = [], details = [], journeys = [];
  const env = {
    ALLOWED_ORIGINS: origin,
    GOOGLE_ROUTES_API_KEY: "unit-test-only",
    AI_LIMITER: { limit: async () => ({ success: !options.rateLimited }) },
    GLOBAL_LIMITER: { limit: async () => ({ success: true }) },
  };
  const transport = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return handleRequest(new Request(`${origin}/api/places/nearby`, {
      ...init, headers: { ...init.headers, Origin: origin },
    }), env, {}, {
      ...(options.backendFailure ? { searchNearbyPlaces: async () => {
        throw new Error("Internal provider stack trace must not reach the traveller");
      } } : {}),
      placesFetcher: async (_url, init) => {
        googleRequests.push({ body: JSON.parse(init.body), headers: init.headers });
        return Response.json({ places: rawPlaces });
      },
    });
  };
  const fetchPlaces = async (body, signal) => {
    const response = await transport(null, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal,
    });
    const data = await response.json();
    // Same safe application-error contract as src/app.js request().
    if (!response.ok) {
      const err = new Error(data.error.message);
      err.code = data.error.code;
      throw err;
    }
    return data;
  };
  if (options.fallback) t.mock.method(globalThis, "fetch", transport);
  const discovery = initDiscoverySection({
    doc: document,
    container: el("Section"), locationInput: el("LocationInput"),
    useLocationBtn: el("UseLocationBtn"), regionChipsContainer: el("RegionChips"),
    locationStatus: el("LocationStatus"), intentGrid: el("IntentGrid"),
    foodChipsContainer: el("FoodChips"), statusContainer: el("Status"),
    placesContainer: el("PlacesContainer"), routeContainer: el("RouteContainer"),
    routeResults: el("RouteResults"),
    fetchPlaces: options.fallback ? null : options.fetchPlaces || fetchPlaces,
    fetchPlaceDetails: async (query) => { details.push(query); return { status: "ok", details: {} }; },
    lookupJourney: async (query) => { journeys.push(query); return { journey: { routes: [] } }; },
  });
  const region = (id = "manila") => document.querySelector(`[data-region-id="${id}"]`).click();
  const intent = (id = "shop") => el("IntentGrid").querySelector(`[data-intent="${id}"]`).click();
  return { dom, document, el, discovery, region, intent, requests, googleRequests, details, journeys };
}

for (const locationMethod of ["region", "geolocation", "manual change", "manual Enter"]) {
  test(`Location via ${locationMethod} costs zero searches; Shopping costs exactly one`, async (t) => {
    const f = setup(t);
    assert.equal(f.requests.length, 0);
    if (locationMethod === "region") f.region();
    else if (locationMethod === "geolocation") {
      f.dom.window.navigator.geolocation = { getCurrentPosition: (success) => success({
        coords: { latitude: 14.5839, longitude: 120.9794 },
      }) };
      f.el("UseLocationBtn").click();
    } else {
      f.el("LocationInput").value = "Cebu";
      f.el("LocationInput").dispatchEvent(new f.dom.window.Event("input"));
      f.el("LocationInput").dispatchEvent(locationMethod === "manual change"
        ? new f.dom.window.Event("change")
        : new f.dom.window.KeyboardEvent("keydown", { key: "Enter" }));
    }
    await settle();
    assert.equal(f.requests.length, 0);
    assert.equal(f.googleRequests.length, 0);
    assert.match(f.el("Status").textContent, /Location set\. What sounds good/);
    f.intent();
    await settle();
    assert.equal(f.requests.length, 1);
    assert.equal(f.googleRequests.length, 1);
    assert.equal(f.requests[0].intent, "shop");
    assert.equal(f.requests[0].radiusMeters, 3500);
    assert.equal(f.googleRequests[0].body.locationRestriction.circle.radius, 3500);
    assert.deepEqual(f.googleRequests[0].body.includedTypes, ["shopping_mall", "market", "department_store"]);
    assert.equal(f.googleRequests[0].headers["X-Goog-FieldMask"],
      "places.id,places.displayName,places.primaryType,places.types,places.location,places.formattedAddress,places.photos");
    assert.equal(f.el("PlacesContainer").querySelectorAll(".go-mode-place-card").length, 5);
    assert.equal(f.details.length, 0);
    f.el("PlacesContainer").querySelector(".go-mode-see-options-btn").click();
    await settle();
    assert.equal(f.details.length, 1);
    assert.equal(f.journeys.length, 1);
  });
}

for (const fallback of [false, true]) {
  test(`429 clears the loader and permits an explicit retry (${fallback ? "direct fetch" : "app callback"})`, async (t) => {
    const options = { rateLimited: true, fallback };
    const f = setup(t, options);
    f.region();
    f.intent();
    assert.match(f.el("PlacesContainer").textContent, /Loading shop/);
    await settle();
    assert.equal(f.el("Status").textContent, "Too many searches right now. Wait a moment and try again.");
    assert.doesNotMatch(f.el("PlacesContainer").textContent, /Loading/);
    assert.equal(f.el("PlacesContainer").children.length, 1);
    assert.equal(f.googleRequests.length, 0);
    options.rateLimited = false;
    f.el("PlacesContainer").querySelector("button").click();
    await settle();
    assert.equal(f.requests.length, 2);
    assert.equal(f.googleRequests.length, 1);
    assert.equal(f.requests[1].radiusMeters, 3500);
    assert.equal(f.googleRequests[0].body.locationRestriction.circle.radius, 3500);
    assert.match(f.el("Status").textContent, /Showing 5/);
  });
}

test("Backend SERVER_ERROR preserves its safe message and permits another category", async (t) => {
  const options = { backendFailure: true };
  const f = setup(t, options);
  f.region(); f.intent();
  await settle();
  assert.equal(f.el("Status").textContent, "Research is temporarily unavailable. Your saved trips are unchanged.");
  assert.doesNotMatch(f.el("PlacesContainer").textContent, /Loading|stack trace/);
  options.backendFailure = false;
  f.intent("coffee");
  await settle();
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].intent, "coffee");
  assert.match(f.el("Status").textContent, /Showing 5/);
});

test("Unexpected exceptions hide internals and remove the loader", async (t) => {
  const f = setup(t, { fetchPlaces: async () => { throw new Error("TypeError: private implementation detail"); } });
  f.region(); f.intent(); await settle();
  assert.equal(f.el("Status").textContent, "Unable to load recommendations right now. Please try again.");
  assert.doesNotMatch(f.el("PlacesContainer").textContent, /Loading|TypeError/);
});

test("Changing location cancels an in-flight search without searching or restoring stale results", async (t) => {
  let finish, signal, calls = 0;
  const f = setup(t, { fetchPlaces: (_params, s) => {
    calls++; signal = s;
    return new Promise((resolve) => { finish = resolve; });
  } });
  f.region(); f.intent();
  f.region("cebu");
  assert.equal(signal.aborted, true);
  assert.equal(calls, 1);
  finish({ status: "ok", places: [] });
  await settle();
  assert.match(f.el("Status").textContent, /Location set/);
  assert.equal(f.el("PlacesContainer").children.length, 0);
});

test("Invalid manual location cannot reuse previous Metro Manila coordinates", async (t) => {
  const f = setup(t);
  f.region();
  f.el("LocationInput").value = "Unknown place 12345";
  f.el("LocationInput").dispatchEvent(new f.dom.window.Event("input"));
  f.el("LocationInput").dispatchEvent(new f.dom.window.Event("change"));
  f.intent(); await settle();
  assert.equal(f.requests.length, 0);
  assert.match(f.el("Status").textContent, /Where are you exploring/);
});

test("Offline failure removes an in-flight loader", async (t) => {
  const f = setup(t, { fetchPlaces: () => new Promise(() => {}) });
  f.region(); f.intent();
  Object.defineProperty(f.dom.window.navigator, "onLine", { value: false });
  f.intent("coffee");
  assert.match(f.el("Status").textContent, /require internet/);
  assert.doesNotMatch(f.el("PlacesContainer").textContent, /Loading/);
});

for (const status of ["unavailable", "provider_unavailable", "not_configured"]) {
  test(`${status} is a clean failure state, not an empty search`, async (t) => {
    const f = setup(t, { fetchPlaces: async () => ({ status, places: [], warnings: ["Internal provider error"] }) });
    f.region(); f.intent(); await settle();
    assert.match(f.el("Status").textContent, /temporarily unavailable/);
    assert.doesNotMatch(f.el("PlacesContainer").textContent, /Loading|Internal/);
    assert.ok(f.el("PlacesContainer").querySelector("button"));
  });
}

test("Worker prefers radiusMeters, supports cached radius clients, and preserves clamps", async () => {
  for (const [fields, expected] of [
    [{ radiusMeters: 3500, radius: 9000 }, 3500],
    [{ radius: 3500 }, 3500],
    [{}, 2500],
    [{ radiusMeters: 1 }, 300],
    [{ radiusMeters: 99999 }, 10000],
  ]) {
    let received;
    const response = await handleRequest(new Request(`${origin}/api/places/nearby`, {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ latitude: 14.5839, longitude: 120.9794, intent: "shop", ...fields }),
    }), { ALLOWED_ORIGINS: origin }, {}, {
      searchNearbyPlaces: async (query) => { received = query; return { status: "ok", places: [] }; },
    });
    assert.equal(response.status, 200);
    assert.equal(received.radiusMeters, expected);
  }
});
