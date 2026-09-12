import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  groundJourneyAdvice,
  normalizeJourneyAdvice,
  parseAdvisorJson,
} from "../server/journey-advisor.js";
import { handleRequest } from "../server/worker.js";
import { renderJourney } from "../src/transit-render.js";
import { apiRequest, env } from "./fixtures.mjs";

const rawAdvice = {
  status: "grounded",
  resolvedOrigin: "National Museum of Fine Arts, Manila",
  resolvedDestination: "Fort Santiago, Intramuros, Manila",
  confidence: "medium",
  assumption: "Interpreted National Museum as the National Museum of Fine Arts.",
  summary: "A short Manila trip with driving and local transport options.",
  recommendedMode: "grab",
  options: [
    {
      mode: "grab",
      label: "Grab / taxi",
      confidence: "medium",
      durationMin: 15,
      durationMax: 30,
      costMinPHP: 120,
      costMaxPHP: 220,
      costBasis: "vehicle",
      why: "Simplest door-to-door option.",
      caveats: ["Traffic can change quickly."],
      steps: [
        { type: "start", title: "National Museum of Fine Arts", instruction: "Use the main entrance pickup area.", landmark: "Padre Burgos Ave" },
        { type: "ride", title: "Ride toward Intramuros", instruction: "Allow extra time for traffic.", landmark: "Intramuros" },
        { type: "arrive", title: "Fort Santiago", instruction: "Enter at the visitor gate.", landmark: "Fort Santiago" },
      ],
    },
    {
      mode: "local",
      label: "Local transport + walk",
      confidence: "low",
      durationMin: 25,
      durationMax: 45,
      costMinPHP: 20,
      costMaxPHP: 60,
      costBasis: "person",
      why: "Cheaper if you are comfortable with local transfers.",
      caveats: ["Exact boarding point needs confirmation."],
      steps: [
        { type: "walk", title: "Walk toward a main road", instruction: "Use a well-lit public pickup area.", landmark: "Padre Burgos Ave" },
        { type: "ride", title: "Take local transport toward Intramuros", instruction: "Confirm the destination with the driver before boarding.", landmark: "Intramuros" },
        { type: "arrive", title: "Walk to Fort Santiago", instruction: "Follow signs inside Intramuros.", landmark: "Fort Santiago" },
      ],
    },
  ],
  suggestions: [],
};

const source = {
  type: "maps",
  title: "Fort Santiago",
  url: "https://www.google.com/maps/place/Fort+Santiago/",
};

const normalizedAdvice = () =>
  normalizeJourneyAdvice(rawAdvice, {
    sources: [source],
    mapsUsed: true,
    searchUsed: true,
  });

test("grounded advice requires evidence and keeps estimates as ranges", () => {
  const advice = normalizedAdvice();
  assert.equal(advice.status, "grounded");
  assert.equal(advice.options.length, 2);
  assert.deepEqual(
    [advice.options[0].durationMin, advice.options[0].durationMax],
    [15, 30],
  );
  assert.equal(advice.sources[0].type, "maps");
  assert.equal(
    normalizeJourneyAdvice(rawAdvice, { sources: [], mapsUsed: true }).status,
    "unavailable",
  );
});

test("advisor uses Maps/Search structured output and strips unsafe citations", async () => {
  let body;
  const response = {
    status: "completed",
    steps: [
      { type: "google_maps_call" },
      { type: "google_search_call" },
      {
        type: "model_output",
        content: [
          {
            type: "text",
            text: JSON.stringify(rawAdvice),
            annotations: [
              { type: "place_citation", name: "Fort Santiago", url: source.url },
              { type: "url_citation", title: "unsafe", url: "javascript:alert(1)" },
            ],
          },
        ],
      },
    ],
  };
  const advice = await groundJourneyAdvice(
    {
      origin: "national museum",
      destination: "Fort Santiago, Intramuros, Manila",
      departureTime: new Date(Date.now() + 60000).toISOString(),
      people: 2,
    },
    { GEMINI_API_KEY: "test-key", ENABLE_GROUNDING: "true" },
    {
      fetcher: async (_url, options) => {
        body = JSON.parse(options.body);
        return Response.json(response);
      },
    },
  );
  assert.equal(advice.status, "grounded");
  assert.deepEqual(advice.toolsUsed.sort(), ["maps", "search"]);
  assert.equal(advice.sources.length, 1);
  assert.match(advice.sources[0].url, /^https:/);
  assert.deepEqual(
    body.tools.map((tool) => tool.type),
    ["google_maps", "google_search"],
  );
  assert.equal(body.response_format.mime_type, "application/json");
});

test("journey endpoint invokes advisor when structured routing has no useful route", async () => {
  const q = {
    origin: "national museum",
    destination: "Fort Santiago, Intramuros, Manila",
    departureTime: new Date(Date.now() + 60000).toISOString(),
    people: 2,
  };
  let calls = 0;
  const response = await handleRequest(
    apiRequest("journey", q),
    {
      ...env,
      GOOGLE_ROUTES_API_KEY: "",
      GEMINI_API_KEY: "test-key",
      ENABLE_GROUNDING: "true",
      GLOBAL_LIMITER: { limit: async () => ({ success: true }) },
      AI_LIMITER: { limit: async () => ({ success: true }) },
    },
    {},
    {
      journeyAdvisor: async () => {
        calls++;
        return normalizedAdvice();
      },
    },
  );
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(calls, 1);
  assert.equal(data.journey.status, "not_configured");
  assert.equal(data.advisor.status, "grounded");
});

test("grounded place resolution gets one bounded retry for a verified route", async () => {
  const q = {
    origin: "national museum",
    destination: "Fort Santiago, Intramuros, Manila",
    departureTime: new Date(Date.now() + 60000).toISOString(),
    people: 2,
  };
  const planned = [];
  const response = await handleRequest(
    apiRequest("journey", q),
    {
      ...env,
      GOOGLE_ROUTES_API_KEY: "routes-key",
      GEMINI_API_KEY: "gemini-key",
      ENABLE_GROUNDING: "true",
      GLOBAL_LIMITER: { limit: async () => ({ success: true }) },
      AI_LIMITER: { limit: async () => ({ success: true }) },
    },
    {},
    {
      planJourney: async (query) => {
        planned.push(query);
        return planned.length === 1
          ? { ...query, status: "unavailable", routes: [], warnings: [] }
          : {
              ...query,
              status: "ok",
              routes: [{ mode: "local", label: "Verified local route" }],
              warnings: [],
            };
      },
      journeyAdvisor: async () => normalizedAdvice(),
    },
  );
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(planned.length, 2);
  assert.equal(planned[1].origin, "National Museum of Fine Arts, Manila");
  assert.equal(data.journey.status, "ok");
  assert.equal(data.advisor, undefined);
  assert.match(data.journey.warnings[0], /Matched your places/);
});

test("grounded advisor replaces the dead-end UI and clarification can retry in app", () => {
  const dom = new JSDOM("<main></main>", { url: "https://app.example" });
  global.document = dom.window.document;
  const advice = normalizedAdvice();
  const root = renderJourney(
    {
      origin: "national museum",
      destination: "Fort Santiago, Intramuros, Manila",
      departureTime: new Date().toISOString(),
      generatedAt: new Date().toISOString(),
      routes: [],
      status: "unavailable",
      warnings: ["Some routing data is unavailable."],
    },
    { advisor: advice },
  );
  assert.match(root.textContent, /Grounded estimate/i);
  assert.match(root.textContent, /15–30 min/);
  assert.match(root.textContent, /₱120–₱220/);
  assert.doesNotMatch(root.textContent, /No verified route available/);
  assert.equal(root.querySelectorAll(".journey-source-link").length, 1);
  assert.equal(root.querySelectorAll("script,img,[onerror]").length, 0);

  let refined;
  const clarify = {
    status: "clarify",
    confidence: "low",
    resolvedOrigin: "",
    resolvedDestination: "Fort Santiago, Manila",
    assumption: "",
    summary: "Choose which National Museum you mean.",
    options: [],
    sources: [],
    suggestions: [
      {
        label: "National Museum of Fine Arts",
        origin: "National Museum of Fine Arts, Manila",
        destination: "Fort Santiago, Intramuros, Manila",
      },
    ],
  };
  const clarification = renderJourney(
    { routes: [], status: "unavailable" },
    { advisor: clarify, onRefine: (value) => (refined = value) },
  );
  clarification.querySelector(".journey-refine-option").click();
  assert.equal(refined.origin, "National Museum of Fine Arts, Manila");
  dom.window.close();
});

test("parseAdvisorJson parses raw JSON, fenced JSON, and embedded JSON objects", () => {
  assert.equal(parseAdvisorJson('{"status":"grounded"}').status, "grounded");
  assert.equal(
    parseAdvisorJson('```json\n{"status":"grounded"}\n```').status,
    "grounded",
  );
  assert.equal(
    parseAdvisorJson('Here is the advice:\n```json\n{"status":"clarify"}\n```\nDone').status,
    "clarify",
  );
  assert.equal(
    parseAdvisorJson('Here is the advice: {"status":"grounded"} hope this helps').status,
    "grounded",
  );
  assert.equal(parseAdvisorJson("not valid json").status, "unavailable");
  assert.equal(parseAdvisorJson(null).status, "unavailable");
});

test("retry on resolved places provides future departureTime to avoid Google Routes 400", async () => {
  const q = {
    origin: "national museum",
    destination: "Fort Santiago, Intramuros, Manila",
    departureTime: new Date().toISOString(),
    people: 1,
  };
  const planned = [];
  await handleRequest(
    apiRequest("journey", q),
    {
      ...env,
      GOOGLE_ROUTES_API_KEY: "routes-key",
      GEMINI_API_KEY: "gemini-key",
      ENABLE_GROUNDING: "true",
      GLOBAL_LIMITER: { limit: async () => ({ success: true }) },
      AI_LIMITER: { limit: async () => ({ success: true }) },
    },
    {},
    {
      planJourney: async (query) => {
        planned.push(query);
        return planned.length === 1
          ? { ...query, status: "unavailable", routes: [], warnings: [] }
          : {
              ...query,
              status: "ok",
              routes: [{ mode: "grab", label: "Grab · driving route" }],
              warnings: [],
            };
      },
      journeyAdvisor: async () => normalizedAdvice(),
    },
  );
  assert.equal(planned.length, 2);
  const now = Date.now();
  const retryDeparture = Date.parse(planned[1].departureTime);
  assert.ok(
    retryDeparture >= now + 50000,
    `Retry departure time must be future buffered, got ${planned[1].departureTime}`,
  );
});
