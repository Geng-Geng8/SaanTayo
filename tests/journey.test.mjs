import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  normalizeJourney,
  normalizeRoute,
  legacyJourneys,
  partyCost,
  recommendJourney,
  comparePartyRoutes,
  fareLabel,
  buildGoogleMapsDirectionsUrl,
  buildSakayRouteUrl,
  buildTransitRouteLinks,
  departureISO,
} from "../shared/journey.js";
import {
  normalizeGoogleTransit,
  normalizeGoogleDriving,
  planJourney,
  createGoogleProvider,
  phpMoney,
  FIELD_MASKS,
} from "../server/routes.js";
import { estimateGrab } from "../server/grab-estimate.js";
import { handleRequest } from "../server/worker.js";
import { renderJourney, renderTransitRoute } from "../src/transit-render.js";
import { renderShortlistItem } from "../src/render.js";
import {
  query,
  calibration,
  driving,
  transit,
  journeyFixture,
  localRoute,
} from "./journey-fixtures.mjs";
import { apiRequest, env, trip, interaction } from "./fixtures.mjs";

test("Google transit captures source, stops, headsign, walk, two transfers and schedule", () => {
  const [route] = normalizeGoogleTransit(transit(), query);
  assert.equal(route.mode, "train");
  assert.equal(route.walkingMinutes, 8);
  assert.equal(route.transferCount, 2);
  assert.equal(route.steps.filter((s) => s.type === "transfer").length, 2);
  assert.equal(
    route.steps.find((s) => s.type === "board").stopName,
    "Test stop 0",
  );
  assert.equal(
    route.steps.find((s) => s.type === "board").headsign,
    "Test headsign 0",
  );
  assert.equal(
    route.steps.find((s) => s.type === "board").departureTime,
    "2026-09-12T08:10:00Z",
  );
  assert.ok(route.sourceAttribution.includes("Synthetic operator"));
});
test("only a returned PHP transit fare gets Google provenance; missing and foreign fare stay unknown", () => {
  assert.equal(normalizeGoogleTransit(transit(), query)[0].totalCostPHP, 42);
  assert.equal(
    normalizeGoogleTransit(transit(), query)[0].costSource,
    "google_transit",
  );
  const missing = normalizeRoute(
    normalizeGoogleTransit(transit({ fare: false }), query)[0],
  );
  assert.equal(missing.totalCostPHP, null);
  assert.equal(fareLabel(missing), "Fare needs confirmation");
  const foreign = transit();
  foreign.routes[0].travelAdvisory.transitFare.currencyCode = "USD";
  assert.equal(normalizeGoogleTransit(foreign, query)[0].costSource, "unknown");
  assert.equal(phpMoney({ currencyCode: "PHP" }), 0);
  assert.equal(phpMoney({ currencyCode: "PHP", units: "-1" }), null);
});
test("driving estimate uses reviewed calibration, distance, traffic duration and sourced toll; rounds outwards", () => {
  const route = normalizeGoogleDriving(
    driving,
    query,
    calibration,
    Date.parse("2026-09-12"),
  )[0];
  assert.deepEqual(route.costRangePHP, { min: 300, max: 420 });
  assert.equal(route.costSource, "saantayo_estimate");
  assert.equal(route.tollEstimatePHP, 20);
  assert.equal(route.costBasis, "vehicle");
});
test("no calibration, expired calibration, unknown toll, missing duration and large group do not guess Grab prices", () => {
  const inputs = {
    distanceMeters: 10000,
    durationMinutes: 30,
    trafficAware: true,
    tollEstimatePHP: 0,
  };
  const opts = { now: Date.parse("2026-09-12"), people: 4 };
  for (const c of [
    null,
    { ...calibration, reviewedAt: "2020-01-01" },
    { ...calibration, evidence: "" },
  ])
    assert.equal(estimateGrab(inputs, c, opts), null);
  assert.equal(
    estimateGrab({ ...inputs, tollEstimatePHP: null }, calibration, opts),
    null,
  );
  assert.equal(
    estimateGrab({ ...inputs, durationMinutes: null }, calibration, opts),
    null,
  );
  assert.equal(estimateGrab(inputs, calibration, { ...opts, people: 5 }), null);
  const route = normalizeRoute(normalizeGoogleDriving(driving, query, null)[0]);
  assert.equal(fareLabel(route), "Check live Grab fare");
});
test("no Google key makes no calls and returns an explicit unavailable journey", async () => {
  const j = await planJourney(
    query,
    {},
    {
      fetcher: () => {
        throw new Error("must not fetch");
      },
    },
  );
  assert.equal(j.status, "not_configured");
  assert.deepEqual(j.routes, []);
});
test("Google failure and partial failure are contained with no fabricated alternatives", async () => {
  const provider = {
    lookup: async (_, mode) => {
      if (mode === "TRANSIT") throw new Error("secret upstream response");
      return driving;
    },
  };
  const j = await planJourney(query, {}, { provider });
  assert.equal(j.status, "partial");
  assert.equal(j.routes.length, 1);
  assert.equal(j.routes[0].mode, "grab");
  assert.ok(!JSON.stringify(j).includes("secret upstream"));
  const failed = await planJourney(
    query,
    {},
    {
      provider: {
        lookup: async () => {
          throw new Error();
        },
      },
    },
  );
  assert.equal(failed.status, "unavailable");
  assert.deepEqual(failed.routes, []);
});
test("bus-only city has no rail; empty/malformed steps do not become infrastructure", () => {
  assert.equal(
    normalizeGoogleTransit(transit({ rail: false }), query)[0].mode,
    "local",
  );
  for (const value of [
    {},
    { routes: [null] },
    { routes: [{ legs: [{ steps: [null] }] }] },
  ])
    assert.deepEqual(normalizeGoogleTransit(value, query), []);
});
test("legacy multimodal and flat formats preserve endpoints only, ignoring forged provenance", () => {
  for (const row of [
    {
      legTitle: "Cebu Hotel to Cebu Museum",
      modes: {
        train: { costPHP: "₱42", steps: [{ node: "Fake Central Station" }] },
        local: { signboard: "CEBU VIA HIGHWAY" },
      },
    },
    {
      route: "Cebu Hotel to Cebu Museum",
      mode: "train",
      source: "google_routes",
      costSource: "google_transit",
      totalCostPHP: 42,
    },
  ]) {
    const [j] = legacyJourneys(
      "```transit\n" + JSON.stringify([row]) + "\n```",
    );
    assert.equal(j.origin, "Cebu Hotel");
    assert.equal(j.destination, "Cebu Museum");
    assert.deepEqual(j.routes, []);
    assert.doesNotMatch(JSON.stringify(j), /Central Station|HIGHWAY|₱42/);
  }
  for (const value of [
    "",
    "```transit\n{broken\n```",
    "```transit\nnull\n```",
    "```transit\n[null,4,[]]\n```",
  ])
    assert.doesNotMatch(
      JSON.stringify(legacyJourneys(value, { destination: "Cebu" })),
      /Station|Beep|signboard|₱/,
    );
});
test("party costs require known basis and capacity; comparisons use the full range", () => {
  const j = journeyFixture();
  assert.deepEqual(partyCost(j.routes[0], 4), {
    min: 168,
    max: 168,
    perPersonMin: 42,
    perPersonMax: 42,
  });
  assert.equal(partyCost(j.routes[1], 4).perPersonMin, 75);
  assert.equal(partyCost({ ...j.routes[0], costBasis: "unknown" }, 4), null);
  assert.equal(partyCost(j.routes[1], 5), null);
  assert.match(comparePartyRoutes(j, 4), /₱132–₱252 more.*25 fewer minutes/);
  assert.equal(
    comparePartyRoutes(
      { ...j, routes: [j.routes[0], { ...j.routes[1], origin: "different" }] },
      4,
    ),
    "",
  );
});
test("recommendations require comparable structured evidence, not arbitrary luggage/traffic badges", () => {
  const j = recommendJourney(journeyFixture(), 4);
  assert.deepEqual(j.routes[0].bestFor, ["Cheapest"]);
  assert.deepEqual(j.routes[1].bestFor, ["Fastest", "Fewest transfers"]);
  assert.equal(j.recommendedRouteId, j.routes[1].id);
  const missing = recommendJourney(
    {
      ...j,
      routes: j.routes.map((r) => ({
        ...r,
        durationMinutes: null,
        totalCostPHP: null,
        costRangePHP: null,
        transferCount: null,
      })),
    },
    4,
  );
  assert.equal(missing.recommendedRouteId, null);
  assert.ok(missing.routes.every((r) => !r.bestFor.length));
});
test("application-owned Maps and Sakay links include endpoints and ignore AI URLs", () => {
  const maps = new URL(
    buildGoogleMapsDirectionsUrl("A & B, Manila", "C, Manila", {
      mode: "grab",
    }),
  );
  assert.equal(maps.searchParams.get("origin"), "A & B, Manila");
  assert.equal(maps.searchParams.get("destination"), "C, Manila");
  assert.equal(maps.searchParams.get("travelmode"), "driving");
  const sakay = new URL(buildSakayRouteUrl("Makati", "BGC"));
  assert.equal(sakay.searchParams.get("from"), "Makati");
  assert.equal(sakay.searchParams.get("to"), "BGC");
  assert.equal(
    buildTransitRouteLinks({
      ...query,
      mode: "grab",
      url: "javascript:alert(1)",
    }).length,
    1,
  );
  assert.equal(buildTransitRouteLinks({ ...query, mode: "local" }).length, 2);
  assert.equal(
    buildTransitRouteLinks({
      origin: "Cebu",
      destination: "Mandaue",
      mode: "local",
    }).length,
    1,
  );
});
test("departure presets and custom date use Philippine time regardless of device timezone", () => {
  const now = Date.parse("2026-09-12T01:00:00Z");
  assert.equal(departureISO("morning", "", now), "2026-09-13T00:00:00.000Z");
  assert.equal(departureISO("midday", "", now), "2026-09-12T04:00:00.000Z");
  assert.equal(
    departureISO("custom", "2026-09-12T18:30", now),
    "2026-09-12T10:30:00.000Z",
  );
  assert.equal(departureISO("custom", "2020-01-01T00:00", now), null);
});
test("provider uses minimal masks, no retries, traffic only for driving, and deduplicates identical lookups", async () => {
  const calls = [];
  const provider = createGoogleProvider({
    key: "synthetic-test-key",
    fetcher: async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      return Response.json(transit());
    },
  });
  await Promise.all([
    provider.lookup(query, "TRANSIT"),
    provider.lookup(query, "TRANSIT"),
    provider.lookup(query, "DRIVE"),
  ]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.routingPreference, undefined);
  assert.equal(calls[1].body.routingPreference, "TRAFFIC_AWARE");
  assert.equal(calls[0].body.departureTime, query.departureTime);
  assert.equal(
    calls[0].options.headers["X-Goog-FieldMask"],
    FIELD_MASKS.TRANSIT,
  );
  assert.ok(!FIELD_MASKS.TRANSIT.includes("*"));
  assert.ok(!FIELD_MASKS.DRIVE.includes("polyline"));
});
test("provider timeout, HTTP error and oversized response are bounded", async () => {
  let calls = 0;
  const stalled = createGoogleProvider({
    key: "test",
    timeoutMs: 5,
    fetcher: () => {
      calls++;
      return new Promise(() => {});
    },
  });
  await assert.rejects(stalled.lookup(query, "TRANSIT"), /timeout/);
  assert.equal(calls, 1);
  for (const response of [
    new Response("secret", { status: 403 }),
    new Response("x".repeat(500001)),
  ]) {
    const p = createGoogleProvider({
      key: "test",
      fetcher: async () => response,
    });
    await assert.rejects(p.lookup(query, "TRANSIT"), /provider_/);
  }
});
test("journey endpoint works independently of Gemini credentials; validates input and origin", async () => {
  const q = {
    ...query,
    departureTime: new Date(Date.now() + 60000).toISOString(),
  };
  const response = await handleRequest(apiRequest("journey", q), {
    ALLOWED_ORIGINS: env.ALLOWED_ORIGINS,
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).journey.status, "not_configured");
  for (const invalid of [
    { ...q, origin: "" },
    { ...q, people: 0 },
    { ...q, departureTime: "bad" },
  ])
    assert.equal(
      (await handleRequest(apiRequest("journey", invalid), env)).status,
      400,
    );
  const request = new Request("https://api.example/api/journey", {
    method: "POST",
    headers: {
      Origin: "https://evil.example",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(q),
  });
  assert.equal((await handleRequest(request, env)).status, 403);
});
test("journey endpoint enforces limiters and contains upstream errors without leaking key", async () => {
  const q = {
    ...query,
    departureTime: new Date(Date.now() + 60000).toISOString(),
  };
  const config = {
    ...env,
    GOOGLE_ROUTES_API_KEY: "synthetic-secret",
    GLOBAL_LIMITER: { limit: async () => ({ success: true }) },
  };
  const response = await handleRequest(
    apiRequest("journey", q),
    config,
    {},
    {
      routesFetcher: async () => {
        throw new Error("synthetic-secret");
      },
    },
  );
  assert.equal(response.status, 200);
  assert.doesNotMatch(await response.text(), /synthetic-secret/);
  assert.equal(
    (
      await handleRequest(apiRequest("journey", q), {
        ...config,
        AI_LIMITER: { limit: async () => ({ success: false }) },
      })
    ).status,
    429,
  );
});
test("Google outage never breaks itinerary generation or triggers Google calls on generation", async () => {
  const response = await handleRequest(
    apiRequest("travel", { trip }),
    { ...env, GOOGLE_ROUTES_API_KEY: "test" },
    {},
    {
      fetcher: async () => Response.json(interaction()),
      routesFetcher: () => {
        throw new Error("must not call");
      },
    },
  );
  assert.equal(response.status, 200);
  assert.ok((await response.json()).result);
});
test("UI disables missing rail and keeps mode switching/disclosure client-side and accessible", () => {
  const dom = new JSDOM("<main></main>", { url: "https://app.example" });
  global.document = dom.window.document;
  const j = journeyFixture();
  j.routes.push(normalizeRoute(localRoute(), 2));
  const root = renderJourney(j, { people: 4 });
  document.body.append(root);
  const train = root.querySelector('[data-transit-mode="train"]');
  train.click();
  assert.equal(train.getAttribute("aria-selected"), "true");
  assert.equal(
    document.getElementById(train.getAttribute("aria-controls")).hidden,
    false,
  );
  const disclosure = root.querySelector("details");
  assert.equal(disclosure.open, false);
  disclosure.open = true;
  assert.equal(disclosure.open, true);
  train.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
    }),
  );
  assert.equal(
    root
      .querySelector('[data-transit-mode="local"]')
      .getAttribute("aria-selected"),
    "true",
  );
  assert.equal(dom.window.location.href, "https://app.example/");
  const empty = renderJourney({ routes: [] });
  assert.ok([...empty.querySelectorAll("[role=tab]")].every((b) => b.disabled));
  assert.match(empty.textContent, /Train \/ Transit unavailable/);
  dom.window.close();
});
test("verified signboards and Cash/Beep render only with structured provenance; route text cannot inject HTML", () => {
  const dom = new JSDOM("<main></main>");
  global.document = dom.window.document;
  const local = normalizeRoute(localRoute());
  const card = renderTransitRoute(local);
  assert.match(card.textContent, /LOOK FOR THIS SIGN/);
  assert.match(card.textContent, /TEST PARK/);
  assert.match(card.textContent, /Cash/);
  assert.doesNotMatch(card.textContent, /Beep/);
  const rail = normalizeRoute({
    ...localRoute(),
    mode: "train",
    payment: "Beep",
  });
  assert.match(renderTransitRoute(rail).textContent, /Beep/);
  const unverified = normalizeRoute({
    ...localRoute(),
    source: "google_routes",
    steps: [
      {
        ...localRoute().steps[0],
        source: "google_routes",
        title: "<img src=x onerror=alert(1)>",
      },
    ],
  });
  const safe = renderTransitRoute(unverified);
  assert.equal(safe.querySelectorAll("img,script,[onerror]").length, 0);
  assert.equal(safe.querySelector(".transit-signboard"), null);
  assert.match(safe.textContent, /Signboard varies/);
  assert.doesNotMatch(safe.textContent, /· Cash/);
  dom.window.close();
});

test("older saved transit prices and tips are not presented as current facts", () => {
  const dom = new JSDOM("<main></main>");
  global.document = dom.window.document;
  const row = renderShortlistItem({
    itemType: "transport",
    name: "Saved commute",
    price: "₱42",
    details: { localTip: "Board at Fake Central Station" },
  });
  assert.match(row.textContent, /Fare needs confirmation/);
  assert.doesNotMatch(row.textContent, /₱42|Fake Central Station/);
  dom.window.close();
});
