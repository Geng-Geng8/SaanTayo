import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../server/worker.js";
import { getRate, resetRateCache } from "../server/fx.js";
import { trip, costs, interaction, env, apiRequest } from "./fixtures.mjs";
const ok = () => Promise.resolve(Response.json(interaction()));
test("normal itinerary sends stable Interactions, medium thinking and Search+Maps, no legacy params", async () => {
  let observed;
  const res = await handleRequest(
    apiRequest("travel", { trip }),
    env,
    {},
    {
      fetcher: async (url, options) => {
        observed = { url, options, body: JSON.parse(options.body) };
        return Response.json(interaction());
      },
    },
  );
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.conversation);
  assert.equal(
    observed.url,
    "https://generativelanguage.googleapis.com/v1/interactions",
  );
  assert.equal(observed.body.model, "gemini-3.7-flash");
  assert.equal(observed.body.generation_config.thinking_level, "medium");
  assert.deepEqual(observed.body.tools, [
    { type: "google_search" },
    { type: "google_maps" },
  ]);
  assert.equal(observed.body.contents, undefined);
  assert.equal(observed.body.generation_config.temperature, undefined);
  assert.equal(observed.options.headers["x-goog-api-key"], env.GEMINI_API_KEY);
  assert.equal(JSON.stringify(data).includes(env.GEMINI_API_KEY), false);
});
test("comparison and research include actual party, preferences and question", async () => {
  for (const mode of ["compare", "research"]) {
    let body;
    await handleRequest(
      apiRequest("travel", {
        trip: {
          ...trip,
          mode,
          destinationB: "Siquijor",
          question: "Current ferry schedule?",
        },
      }),
      env,
      {},
      {
        fetcher: async (u, o) => {
          body = JSON.parse(o.body);
          return Response.json(interaction());
        },
      },
    );
    assert.match(body.input, /Must-Try Food/);
    assert.match(body.input, /Couple/);
    assert.match(body.input, /Current ferry/);
  }
});
test("stayType preference adapts backend prompt for hotels, rentals, and resorts/hostels", async () => {
  const types = [
    { stayType: "hotel", pattern: /hotels/i },
    { stayType: "rental", pattern: /Airbnb|vacation rentals/i },
    { stayType: "resort_hostel", pattern: /resorts|hostels/i },
  ];
  for (const item of types) {
    let body;
    await handleRequest(
      apiRequest("travel", {
        trip: { ...trip, stayType: item.stayType },
      }),
      env,
      {},
      {
        fetcher: async (u, o) => {
          body = JSON.parse(o.body);
          return Response.json(interaction());
        },
      },
    );
    assert.match(body.input, item.pattern);
  }
});
test("immediate and multiple follow-ups use previous ID, not a growing transcript", async () => {
  let res = await handleRequest(
    apiRequest("travel", { trip }),
    env,
    {},
    { fetcher: ok },
  );
  let conversation = (await res.json()).conversation;
  for (let i = 0; i < 3; i++) {
    let body;
    res = await handleRequest(
      apiRequest("travel", {
        trip,
        action: "chat",
        message: "Summarize this plan",
        conversation,
        grounding: "context",
      }),
      env,
      {},
      {
        fetcher: async (u, o) => {
          body = JSON.parse(o.body);
          return Response.json(interaction());
        },
      },
    );
    assert.equal(res.status, 200);
    assert.equal(body.previous_interaction_id, "test-interaction-1");
    assert.equal(body.tools, undefined);
    assert.equal(body.generation_config.thinking_level, "low");
    assert.ok(body.input.length < 100);
    conversation = (await res.json()).conversation;
  }
});
test("saved/legacy plan follow-up includes context on reconnect and fresh tools when requested", async () => {
  let body;
  const res = await handleRequest(
    apiRequest("travel", {
      trip,
      action: "chat",
      message: "What are the ferry times now?",
      context: "My saved Cebu itinerary",
      grounding: "auto",
    }),
    env,
    {},
    {
      fetcher: async (u, o) => {
        body = JSON.parse(o.body);
        return Response.json(interaction());
      },
    },
  );
  assert.equal(res.status, 200);
  assert.match(body.input, /My saved Cebu itinerary/);
  assert.equal(body.tools.length, 2);
  assert.equal(body.previous_interaction_id, undefined);
});
test("malformed or expired interaction tokens fail before spending a request", async () => {
  let calls = 0;
  const res = await handleRequest(
    apiRequest("travel", {
      trip,
      action: "chat",
      message: "Help",
      conversation: "bogus",
    }),
    env,
    {},
    {
      fetcher: async () => {
        calls++;
        return ok();
      },
    },
  );
  assert.equal(res.status, 409);
  assert.equal(calls, 0);
});
test("Maps restrictions follow conversation context even when the next turn uses no tools", async () => {
  const first = await handleRequest(
    apiRequest("travel", { trip }),
    env,
    {},
    { fetcher: ok },
  );
  const firstData = await first.json();
  const res = await handleRequest(
    apiRequest("travel", {
      trip,
      action: "chat",
      message: "Summarize",
      conversation: firstData.conversation,
      grounding: "context",
    }),
    env,
    {},
    {
      fetcher: async () =>
        Response.json({
          id: "test-2",
          status: "completed",
          steps: [
            {
              type: "model_output",
              content: [{ type: "text", text: "Summary of Maps-derived data" }],
            },
          ],
        }),
    },
  );
  const data = await res.json();
  assert.equal(data.result.hasMaps, true);
  assert.ok(data.result.expiresAt <= firstData.result.expiresAt);
});
test("expired provider interaction returns recoverable conflict, not automatic retry", async () => {
  const first = await handleRequest(
    apiRequest("travel", { trip }),
    env,
    {},
    { fetcher: ok },
  );
  const conversation = (await first.json()).conversation;
  let calls = 0;
  const res = await handleRequest(
    apiRequest("travel", {
      trip,
      action: "chat",
      message: "Help",
      conversation,
    }),
    env,
    {},
    {
      fetcher: async () => {
        calls++;
        return new Response("", { status: 404 });
      },
    },
  );
  assert.equal(res.status, 409);
  assert.equal(calls, 1);
});
test("optional cost extraction is structured, low thinking, tool-free and not stored", async () => {
  let body;
  const res = await handleRequest(
    apiRequest("budget", { trip, context: "Estimated costs" }),
    env,
    {},
    {
      fetcher: async (u, o) => {
        body = JSON.parse(o.body);
        return Response.json({
          status: "completed",
          steps: [
            {
              type: "model_output",
              content: [{ type: "text", text: JSON.stringify(costs) }],
            },
          ],
        });
      },
    },
  );
  assert.equal(res.status, 200);
  assert.equal(body.response_format.mime_type, "application/json");
  assert.equal(body.store, false);
  assert.equal(body.tools, undefined);
  assert.equal((await res.json()).costs.items.length, 6);
});
test("malformed cost JSON leaves original answer untouched and returns useful error", async () => {
  const res = await handleRequest(
    apiRequest("budget", { trip, context: "Some plan" }),
    env,
    {},
    {
      fetcher: async () =>
        Response.json({
          status: "completed",
          steps: [
            {
              type: "model_output",
              content: [{ type: "text", text: "not json" }],
            },
          ],
        }),
    },
  );
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error.code, "INVALID_COSTS");
});
test("bad origins, missing origins, non-JSON and overlarge input are rejected", async () => {
  for (const origin of ["https://evil.example", "null"]) {
    const req = apiRequest("travel", { trip });
    req.headers.set("Origin", origin);
    assert.equal(
      (await handleRequest(req, env, {}, { fetcher: ok })).status,
      403,
    );
  }
  const missing = apiRequest("travel", { trip });
  missing.headers.delete("Origin");
  assert.equal((await handleRequest(missing, env)).status, 403);
  const text = apiRequest("travel", { trip });
  text.headers.set("Content-Type", "text/plain");
  assert.equal((await handleRequest(text, env)).status, 415);
  assert.equal(
    (
      await handleRequest(
        apiRequest("travel", { trip, context: "x".repeat(181000) }),
        env,
      )
    ).status,
    413,
  );
});
test("preflight CORS is exact, no wildcard or cookies", async () => {
  const req = new Request("https://api.example/api/travel", {
    method: "OPTIONS",
    headers: { Origin: "https://geng-geng8.github.io" },
  });
  const res = await handleRequest(req, env);
  assert.equal(res.status, 204);
  assert.equal(
    res.headers.get("Access-Control-Allow-Origin"),
    "https://geng-geng8.github.io",
  );
  assert.equal(res.headers.get("Access-Control-Allow-Credentials"), null);
});
test("missing absence of secret or rate limiter fails closed", async () => {
  for (const key of ["GEMINI_API_KEY", "CONVERSATION_SECRET", "AI_LIMITER"]) {
    const config = { ...env, [key]: undefined };
    const res = await handleRequest(
      apiRequest("travel", { trip }),
      config,
      {},
      {
        fetcher: () => {
          throw new Error("must not call");
        },
      },
    );
    assert.equal(res.status, 503);
  }
});
test("rate limiting occurs before Google and includes Retry-After", async () => {
  const res = await handleRequest(apiRequest("travel", { trip }), {
    ...env,
    AI_LIMITER: { limit: async () => ({ success: false }) },
  });
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("Retry-After"), "60");
});
for (const [status, expected, code] of [
  [429, 429, "RATE_LIMITED"],
  [403, 503, "PROVIDER_CONFIGURATION"],
  [503, 502, "UPSTREAM_ERROR"],
  [400, 502, "UPSTREAM_ERROR"],
])
  test(`Google ${status} is sanitized and never blindly retried`, async () => {
    let calls = 0;
    const res = await handleRequest(
      apiRequest("travel", { trip }),
      env,
      {},
      {
        fetcher: async () => {
          calls++;
          return Response.json(
            { error: { message: "PRIVATE STACK KEY" } },
            { status },
          );
        },
      },
    );
    assert.equal(res.status, expected);
    const data = await res.json();
    assert.equal(data.error.code, code);
    assert.equal(JSON.stringify(data).includes("PRIVATE"), false);
    assert.equal(calls, 1);
  });
test("network, invalid JSON, incomplete output, no output and timeout become errors", async () => {
  const fetchers = [
    async () => {
      throw new TypeError("network");
    },
    async () => new Response("bad"),
    async () => Response.json({ status: "in_progress", steps: [] }),
    async () => Response.json({ status: "completed", steps: [] }),
    async () => {
      throw new DOMException("timed out", "TimeoutError");
    },
  ];
  for (const fetcher of fetchers) {
    const res = await handleRequest(
      apiRequest("travel", { trip }),
      env,
      {},
      { fetcher },
    );
    assert.ok([502, 504].includes(res.status));
    assert.ok((await res.json()).error.message);
  }
});
test("FX uses daily cached reference data; outage never manufactures a rate", async () => {
  resetRateCache();
  let calls = 0;
  const now = Date.parse("2026-08-27");
  const fetcher = async () => {
    calls++;
    return Response.json({
      base: "PHP",
      quote: "CAD",
      date: "2026-08-26",
      rate: 0.024,
    });
  };
  assert.equal((await getRate({ fetcher, now })).rate, 0.024);
  await getRate({ fetcher, now: now + 100 });
  assert.equal(calls, 1);
  assert.equal(
    (
      await getRate({
        fetcher: async () => {
          throw new Error();
        },
        now: now + 86400000,
      })
    ).stale,
    true,
  );
  resetRateCache();
  await assert.rejects(
    getRate({ fetcher: async () => Response.json({ rate: 0 }), now }),
  );
});
