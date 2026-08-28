import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../server/worker.js";
import { trip, interaction, env, apiRequest } from "./fixtures.mjs";

test("free mode disables Search and Maps tools and warns against live-verification claims", async () => {
  let body;
  const freeEnv = { ...env, ENABLE_GROUNDING: "false" };
  const res = await handleRequest(
    apiRequest("travel", { trip }),
    freeEnv,
    {},
    {
      fetcher: async (url, options) => {
        body = JSON.parse(options.body);
        return Response.json(interaction("Free mode synthetic response", false));
      },
    },
  );

  assert.equal(res.status, 200);
  assert.equal(body.tools, undefined);
  assert.match(body.system_instruction, /grounding are disabled/i);
  assert.match(body.system_instruction, /verified live/i);
});

test("health reports grounding off in free mode", async () => {
  const res = await handleRequest(
    new Request("https://api.example/api/health", { method: "GET" }),
    { ...env, ENABLE_GROUNDING: "false" },
  );
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.grounding, "off");
  assert.equal(data.model, "gemini-3.7-flash");
});
