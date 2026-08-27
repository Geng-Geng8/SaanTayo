import test from "node:test";
import assert from "node:assert/strict";
import {
  validateTrip,
  tripDays,
  calculateBudget,
  safeUrl,
  validateCosts,
} from "../shared/travel.js";
import {
  readTrips,
  writeTrips,
  saveTrip,
  STORE_KEY,
  LEGACY_KEY,
  expireHistory,
  exportEligible,
  importTripsData,
} from "../src/storage.js";
import { normalizeInteraction } from "../server/gemini.js";
import {
  signConversation,
  verifyConversation,
} from "../server/conversation.js";
import { trip, costs, interaction } from "./fixtures.mjs";
const memory = () => {
  const data = new Map();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v),
    removeItem: (k) => data.delete(k),
  };
};

test("civil dates are timezone/DST independent, inclusive and leap-safe", () => {
  assert.equal(tripDays("2026-03-07", "2026-03-09"), 3);
  assert.equal(tripDays("2028-02-28", "2028-03-01"), 3);
  assert.equal(tripDays("2026-08-27", "2026-08-27"), 1);
  assert.throws(() => tripDays("2026-02-30", "2026-03-01"));
  assert.throws(() => tripDays("2026-09-01", "2026-08-01"));
  assert.throws(() => tripDays("2026-08-01", ""));
  assert.throws(() => tripDays("", "", 22));
});
test("strict/flexible, PHP/dual, multiple preferences and explicit party size survive validation", () => {
  for (const strict of [true, false])
    for (const currency of ["PHP", "PHP_CAD"]) {
      const t = validateTrip({
        ...trip,
        strict,
        currency,
        vibes: ["Must-Try Food & Local Eats", "Pristine Beaches & Clear Water"],
      });
      assert.equal(t.strict, strict);
      assert.equal(t.currency, currency);
      assert.equal(t.nights, 2);
      assert.equal(t.vibes.length, 2);
    }
});
test("invalid input and negative/NaN/oversized budgets are rejected", () => {
  for (const total of [-1, NaN, Infinity, "1", 1e10])
    assert.throws(() => validateTrip({ ...trip, budgets: { total } }));
  assert.throws(() => validateTrip({ ...trip, destination: "" }));
  assert.throws(() => validateTrip({ ...trip, people: 0 }));
  assert.throws(() => validateTrip({ ...trip, people: 1.5 }));
});
test("comparison needs two different destinations and retains preferences", () => {
  assert.throws(() => validateTrip({ ...trip, mode: "compare" }));
  assert.throws(() =>
    validateTrip({ ...trip, mode: "compare", destinationB: "cebu city" }),
  );
  assert.equal(
    validateTrip({ ...trip, mode: "compare", destinationB: "Siquijor" })
      .vibes[0],
    trip.vibes[0],
  );
});
test("budget arithmetic is deterministic for groups, people, days, nights and caps", () => {
  const b = calculateBudget(costs, validateTrip(trip));
  assert.equal(b.totalPHP, 9300);
  assert.equal(b.perPersonPHP, 4650);
  assert.equal(b.perDayPHP, 3100);
  assert.equal(b.remainingPHP, 5700);
  assert.deepEqual(b.missing, []);
  assert.deepEqual(b.exceeded, []);
  assert.equal(b.categories.accommodation, 3600);
});
test("strict cap violations, incomplete estimates and free rows are explicit", () => {
  const t = validateTrip({
    ...trip,
    budgets: { total: 1000, hotel: 1000, transit: 100, activities: 100 },
  });
  assert.equal(calculateBudget(costs, t).exceeded.length, 4);
  assert.ok(
    calculateBudget(
      { ...costs, items: costs.items.slice(1) },
      t,
    ).missing.includes("accommodation"),
  );
  assert.equal(
    calculateBudget(costs, validateTrip({ ...trip, days: 1 })).categories
      .accommodation,
    0,
  );
});
test("malformed structured costs cannot become totals", () => {
  for (const unitPHP of [-10, "200", Infinity])
    assert.throws(() =>
      validateCosts({ ...costs, items: [{ ...costs.items[0], unitPHP }] }),
    );
  assert.throws(() => validateCosts({ items: [] }));
  assert.throws(() =>
    validateCosts({
      ...costs,
      items: [{ ...costs.items[0], basis: "invented" }],
    }),
  );
});
test("money is summed in centavos, not floating-point pesos", () => {
  const c = {
    items: [
      { ...costs.items[0], unitPHP: 0.1, basis: "group_once", quantity: 3 },
    ],
    missing: [],
    assumptions: [],
  };
  assert.equal(calculateBudget(c, validateTrip(trip)).totalPHP, 0.3);
});
test("unsafe URLs and credential-bearing URLs are rejected", () => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,x",
    "//evil.test",
    "https://user:secret@evil.test",
  ])
    assert.equal(safeUrl(url), null);
  assert.equal(safeUrl("https://example.com"), "https://example.com/");
});
test("legacy storage migrates without editing the original or truncating >15 plans", () => {
  const s = memory();
  const old = Array.from({ length: 20 }, (_, id) => ({
    id,
    destination: "Cebu",
    date: "2026-08-27",
    content: "Old plan",
  }));
  const raw = JSON.stringify(old);
  s.setItem(LEGACY_KEY, raw);
  assert.equal(readTrips(s).length, 20);
  assert.equal(s.getItem(LEGACY_KEY), raw);
  assert.equal(JSON.parse(s.getItem(STORE_KEY)).version, 2);
});
test("corrupt legacy/v2 records are not overwritten", () => {
  for (const key of [STORE_KEY, LEGACY_KEY]) {
    const s = memory();
    s.setItem(key, "{bad");
    assert.throws(() => readTrips(s));
    assert.equal(s.getItem(key), "{bad");
  }
});
test("full storage still permits reading old plans and reports save failure", () => {
  const s = memory();
  s.setItem(
    LEGACY_KEY,
    JSON.stringify([{ id: 1, destination: "Cebu", content: "Keep" }]),
  );
  s.setItem = () => {
    throw new Error("QuotaExceeded");
  };
  assert.equal(readTrips(s)[0].content, "Keep");
  assert.throws(() => saveTrip(s, { id: "new" }), /storage is full/);
});
test("save/reload/update/delete works without dropping unrelated plans", () => {
  const s = memory();
  saveTrip(s, { id: "a", content: "first" });
  saveTrip(s, { id: "b", content: "second" });
  saveTrip(s, { id: "a", content: "updated" });
  assert.equal(readTrips(s).length, 2);
  assert.equal(readTrips(s).find((t) => t.id === "a").content, "updated");
  writeTrips(
    s,
    readTrips(s).filter((t) => t.id !== "a"),
  );
  assert.equal(readTrips(s)[0].id, "b");
});
test("Maps retention expires answer and derived costs, retaining notes/metadata", () => {
  const result = normalizeInteraction(interaction(), new Date("2026-01-01"));
  const t = {
    id: "1",
    destination: "Cebu",
    result,
    costs,
    notes: "My meeting point",
    content: "",
    chat: [],
  };
  const expired = expireHistory(t, Date.parse("2026-08-27"));
  assert.equal(expired.trip.result, null);
  assert.equal(expired.trip.costs, null);
  assert.equal(expired.trip.notes, t.notes);
  assert.equal(expired.changed, true);
});
test("exports omit Maps data and conversation capabilities; imports append with fresh IDs", () => {
  const result = normalizeInteraction(interaction());
  const exported = exportEligible([
    {
      id: "1",
      destination: "Cebu",
      content: "",
      result,
      notes: "My note",
      conversation: "secret-token",
    },
  ]);
  assert.equal(exported.trips[0].result, null);
  assert.equal(exported.trips[0].conversation, null);
  assert.equal(exported.trips[0].notes, "My note");
  const imported = importTripsData(
    JSON.stringify([{ id: 1, destination: "Old", content: "Legacy" }]),
  );
  assert.equal(imported[0].content, "Legacy");
  assert.notEqual(imported[0].id, "legacy-1");
});
test("grounding parser keeps all output blocks, source claims, suggestions and review attribution", () => {
  const data = interaction("₱400 🚢 ferry");
  data.steps.at(-1).content[0].annotations[0].start_index = 0;
  data.steps.at(-1).content[0].annotations[0].end_index =
    new TextEncoder().encode("₱400 🚢").length;
  data.steps.at(-1).content.push({ type: "text", text: "Second block" });
  const result = normalizeInteraction(data);
  assert.equal(result.parts.length, 2);
  assert.equal(result.parts[0].annotations[0].excerpt, "₱400 🚢");
  assert.equal(result.sources.length, 2);
  assert.equal(result.sources[1].reviews.length, 1);
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.hasMaps, true);
});
test("ungrounded output is not labelled verified; invalid/no text fails safely", () => {
  const r = normalizeInteraction({
    steps: [
      { type: "model_output", content: [{ type: "text", text: "Estimate" }] },
    ],
  });
  assert.ok(r.warnings.length);
  assert.throws(() => normalizeInteraction({ steps: [] }));
});
test("signed interaction tokens accept valid, reject tampered/expired tokens", async () => {
  const secret = "unit-test-long-secret";
  const token = await signConversation("interaction-123", secret, 1000);
  assert.equal(
    await verifyConversation(token, secret, 2000),
    "interaction-123",
  );
  await assert.rejects(verifyConversation(token + "x", secret, 2000));
  await assert.rejects(verifyConversation(token, secret, 1e12));
  await assert.rejects(verifyConversation(token, "different", 2000));
});
