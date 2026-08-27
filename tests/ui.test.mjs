import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { normalizeInteraction } from "../server/gemini.js";
import { interaction, costs } from "./fixtures.mjs";
const html = await readFile("dist/index.html", "utf8"),
  bundle = await readFile("dist/assets/app.js", "utf8");
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
async function setup({ initial = {}, post } = {}) {
  const dom = new JSDOM(html, {
    url: "https://app.example/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window;
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  w.confirm = () => true;
  for (const [k, v] of Object.entries(initial)) w.localStorage.setItem(k, v);
  const requests = [];
  w.fetch = async (url, options = {}) => {
    if (url.endsWith("/health")) return Response.json({ ready: true });
    if (url.endsWith("/fx"))
      return Response.json({
        base: "PHP",
        quote: "CAD",
        rate: 0.024,
        date: new Date().toISOString().slice(0, 10),
      });
    const body = JSON.parse(options.body);
    requests.push({ url, body });
    if (post) return post(url, body, options);
    if (url.endsWith("/budget")) return Response.json({ costs });
    return Response.json({
      result: normalizeInteraction(interaction()),
      conversation: "signed-test-token",
    });
  };
  w.eval(bundle);
  await tick();
  const $ = (id) => w.document.getElementById(id);
  const submit = (id) =>
    $(id).dispatchEvent(
      new w.Event("submit", { bubbles: true, cancelable: true }),
    );
  const generate = async () => {
    $("destination").value = "Cebu City";
    submit("planner");
    await tick();
  };
  return { dom, w, $, submit, generate, requests };
}
test("full mocked itinerary → budget PHP/CAD → save → reload → follow-up → delete", async () => {
  const app = await setup();
  await app.generate();
  assert.match(app.$("renderedMarkdown").textContent, /Cebu City/);
  assert.equal(
    app.$("renderedMarkdown").querySelectorAll(".source-row").length,
    2,
  );
  app.$("calculateBudget").click();
  await tick();
  assert.match(app.$("budgetOutput").textContent, /9,300.00/);
  assert.match(app.$("budgetOutput").textContent, /C\$223.20/);
  app.$("travelNotes").value = "Meet near the lobby";
  app.$("savePlan").click();
  const saved = app.w.localStorage.getItem("saantayo_trips_v2");
  assert.ok(saved);
  app.dom.window.close();
  const next = await setup({ initial: { saantayo_trips_v2: saved } });
  next.w.document.querySelector('[data-dialog="savedTripsModal"]').click();
  next.w.document.querySelector("[data-load]").click();
  assert.equal(next.$("travelNotes").value, "Meet near the lobby");
  next.$("chatInput").value = "Summarize day one";
  next.$("chatGrounding").value = "context";
  next.submit("chatForm");
  await tick();
  assert.equal(next.requests[0].body.conversation, "signed-test-token");
  assert.equal(next.requests[0].body.context, undefined);
  assert.match(next.$("chatMessages").textContent, /Summarize day one/);
  next.w.document.querySelector('[data-dialog="savedTripsModal"]').click();
  next.w.document.querySelector("[data-delete]").click();
  assert.equal(next.$("savedCountBadge").textContent, "0");
  next.dom.window.close();
});
test("legacy saved-trip injection stays text and legacy follow-up rehydrates actual itinerary", async () => {
  const app = await setup({
    initial: {
      saantayo_gemini_key: "old-browser-test-key",
      saantayo_saved_trips: JSON.stringify([
        {
          id: 1,
          destination: "<img src=x onerror=alert(1)>",
          date: "2026-08-27",
          content: "Legacy Siquijor plan",
        },
      ]),
    },
  });
  assert.equal(app.w.localStorage.getItem("saantayo_gemini_key"), null);
  app.w.document.querySelector('[data-dialog="savedTripsModal"]').click();
  assert.equal(app.$("savedTripsList").querySelector("img"), null);
  app.w.document.querySelector("[data-load]").click();
  app.$("chatInput").value = "<img src=x onerror=alert(1)>";
  app.submit("chatForm");
  await tick();
  assert.equal(app.$("chatMessages").querySelector("img"), null);
  assert.match(app.requests[0].body.context, /Legacy Siquijor plan/);
  app.dom.window.close();
});
test("failed chat preserves draft/history; regeneration failure preserves current result", async () => {
  let fail = false;
  const app = await setup({
    post: async () =>
      fail
        ? Response.json(
            { error: { code: "RATE_LIMITED", message: "Please wait" } },
            { status: 429 },
          )
        : Response.json({
            result: normalizeInteraction(interaction()),
            conversation: "x",
          }),
  });
  await app.generate();
  const original = app.$("renderedMarkdown").textContent;
  fail = true;
  app.$("chatInput").value = "Try a cheaper hotel";
  app.submit("chatForm");
  await tick();
  assert.equal(app.$("chatInput").value, "Try a cheaper hotel");
  assert.equal(
    app.$("chatMessages").querySelectorAll(".chat-bubble-user").length,
    0,
  );
  assert.match(app.$("errorMessage").textContent, /Please wait/);
  await app.generate();
  assert.equal(app.$("renderedMarkdown").textContent, original);
  app.dom.window.close();
});
test("expiry recovery is one bounded retry containing the plan", async () => {
  let count = 0;
  const app = await setup({
    post: async (url, body) => {
      if (body.action === "chat" && ++count === 1)
        return Response.json(
          { error: { code: "CONVERSATION_EXPIRED", message: "Expired" } },
          { status: 409 },
        );
      return Response.json({
        result: normalizeInteraction(interaction()),
        conversation: "new",
      });
    },
  });
  await app.generate();
  app.$("chatInput").value = "Where should I eat?";
  app.submit("chatForm");
  await tick();
  assert.equal(count, 2);
  assert.match(app.requests.at(-1).body.context, /Cebu City/);
  assert.equal(app.requests.at(-1).body.conversation, null);
  app.dom.window.close();
});
test("sanitizer blocks script/event/unsafe URL payloads and source URLs", async () => {
  const result = normalizeInteraction(
    interaction(
      "# Travel\n<img src=x onerror=alert(1)>\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))\n\n[good](https://example.com)",
    ),
  );
  result.sources.push({
    type: "url_citation",
    title: "<img onerror=alert(1)>",
    url: "javascript:alert(1)",
  });
  const app = await setup({
    post: async () => Response.json({ result, conversation: "x" }),
  });
  await app.generate();
  const box = app.$("renderedMarkdown");
  assert.equal(box.querySelector("script,img,[onerror]"), null);
  assert.ok(
    [...box.querySelectorAll("a")].every(
      (a) => !a.getAttribute("href")?.startsWith("javascript:"),
    ),
  );
  assert.equal(
    box.querySelector('a[href="https://example.com/"]').rel,
    "noopener noreferrer",
  );
  app.dom.window.close();
});
test("comparison, research and selected-vibe controls expose the correct data", async () => {
  const app = await setup();
  app.$("modeCompareBtn").click();
  app.$("destination").value = "Cebu";
  app.$("destinationB").value = "Siquijor";
  app.submit("planner");
  await tick();
  assert.equal(app.requests.at(-1).body.trip.mode, "compare");
  assert.ok(
    app.requests.at(-1).body.trip.vibes.includes("Must-Try Food & Local Eats"),
  );
  app.$("modeResearchBtn").click();
  app.$("question").value = "Current ferry schedules?";
  app.submit("planner");
  await tick();
  assert.equal(
    app.requests.at(-1).body.trip.question,
    "Current ferry schedules?",
  );
  app.dom.window.close();
});
test("offline state disables paid actions while leaving saved plans and checklist usable", async () => {
  const app = await setup();
  Object.defineProperty(app.w.navigator, "onLine", {
    value: false,
    configurable: true,
  });
  app.w.dispatchEvent(new app.w.Event("offline"));
  assert.equal(app.$("generateBtn").disabled, true);
  app.w.document.querySelector('[data-dialog="checklistModal"]').click();
  assert.equal(app.$("checklistModal").open, true);
  const check = app.$("checklistItems").querySelector("input");
  check.click();
  assert.match(app.w.localStorage.getItem("saantayo_checklist"), /true/);
  app.dom.window.close();
});
test("Enter submits one follow-up while composition does not submit", async () => {
  const app = await setup();
  await app.generate();
  app.$("chatInput").value = "Summarize";
  app
    .$("chatInput")
    .dispatchEvent(
      new app.w.KeyboardEvent("keydown", {
        key: "Enter",
        isComposing: true,
        bubbles: true,
      }),
    );
  assert.equal(app.requests.length, 1);
  app
    .$("chatInput")
    .dispatchEvent(
      new app.w.KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
  await tick();
  assert.equal(app.requests.length, 2);
  assert.match(app.$("chatMessages").textContent, /Summarize/);
  app.dom.window.close();
});
test("cancel prevents a late response replacing the plan and duplicate submits", async () => {
  let finish;
  const app = await setup({
    post: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  app.$("destination").value = "Cebu";
  app.submit("planner");
  app.submit("planner");
  assert.equal(app.requests.length, 1);
  app.$("cancelRequest").click();
  finish(
    Response.json({
      result: normalizeInteraction(interaction()),
      conversation: "x",
    }),
  );
  await tick();
  assert.equal(app.$("resultsContainer").classList.contains("hidden"), true);
  app.dom.window.close();
});
