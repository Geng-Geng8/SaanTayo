import test from "node:test";
import assert from "node:assert/strict";
import {
  validateTrip,
  tripDays,
  calculateBudget,
  safeUrl,
  validateCosts,
  buildProviderSearchUrl,
  buildAllProviderLinks,
  STAY_TYPES,
  parseTransitLegs,
  buildTransitLinks,
  stripTransitBlock,
  TRANSIT_MODES,
  cleanTripPayload,
  SHEETS_API_URL,
  parseStayNameFromUrl,
  buildMapsSearchLink,
  parseDining,
  stripDiningBlock,
  DINING_CATEGORIES,
  STAY_PROPERTY_TYPES,
  buildStaySearchLink,
  parseAccommodations,
  stripAccommodationsBlock,
  escapeSpreadsheetFormula,
  sanitizeSheetsPayload,
  ITEM_TYPES,
  canonicalizeSavedItem,
  normalizeSavedItems,
  ACTIVITY_CATEGORIES,
  buildActivitySearchLink,
  stripActivitiesBlock,
  parseActivities,
  PARTNERS,
  PARTNER_STORAGE_KEY,
  normalizePartnerIdentity,
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
  getPartnerIdentity,
  setPartnerIdentity,
  readSharedTripsCache,
  writeSharedTripsCache,
  SHARED_TRIPS_CACHE_KEY,
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
      assert.equal(t.stayType, "all");
    }
});
test("stayType validates known types and falls back to all", () => {
  for (const s of ["hotel", "rental", "resort_hostel", "all"]) {
    assert.equal(validateTrip({ ...trip, stayType: s }).stayType, s);
  }
  assert.equal(validateTrip({ ...trip, stayType: "unknown" }).stayType, "all");
  assert.equal(validateTrip({ ...trip, stayType: null }).stayType, "all");
});
test("provider deep links generate valid URLs for all providers with and without dates", () => {
  const withDates = {
    destination: "Coron, Palawan",
    start: "2026-09-01",
    end: "2026-09-05",
    people: 3,
  };
  const airbnb = buildProviderSearchUrl("airbnb", withDates);
  assert.ok(airbnb.includes("airbnb.com/s/Coron%2C%20Palawan/homes"));
  assert.ok(airbnb.includes("checkin=2026-09-01"));
  assert.ok(airbnb.includes("checkout=2026-09-05"));
  assert.ok(airbnb.includes("adults=3"));

  const expedia = buildProviderSearchUrl("expedia", withDates);
  assert.ok(expedia.includes("expedia.com/Hotel-Search"));
  assert.ok(expedia.includes("startDate=2026-09-01"));
  assert.ok(expedia.includes("endDate=2026-09-05"));
  assert.ok(expedia.includes("adults=3"));

  const agoda = buildProviderSearchUrl("agoda", withDates);
  assert.ok(agoda.includes("agoda.com/search"));
  assert.ok(agoda.includes("checkIn=2026-09-01"));
  assert.ok(agoda.includes("checkOut=2026-09-05"));

  const kayak = buildProviderSearchUrl("kayak", withDates);
  assert.ok(kayak.includes("kayak.com/hotels/Coron%2C%20Palawan/2026-09-01/2026-09-05/3adults"));

  const trivago = buildProviderSearchUrl("trivago", withDates);
  assert.ok(trivago.includes("trivago.com/en-US/srl"));
  assert.ok(trivago.includes("checkin=2026-09-01"));

  const flexible = { destination: "El Nido", people: 2 };
  const kayakFlex = buildProviderSearchUrl("kayak", flexible);
  assert.ok(kayakFlex.includes("kayak.com/hotels/El%20Nido?guests=2"));

  const links = buildAllProviderLinks(withDates);
  assert.equal(links.length, 5);
  assert.deepEqual(
    links.map((l) => l.id),
    ["airbnb", "expedia", "agoda", "kayak", "trivago"],
  );

  assert.equal(buildProviderSearchUrl("unknown", withDates), null);
  assert.equal(buildProviderSearchUrl("airbnb", { destination: "" }), null);
});
test("parseTransitLegs parses structured transit JSON blocks and falls back gracefully", () => {
  const markdownWithTransit = `## Day 1 Plan
Take an early transfer to the pier.

\`\`\`transit
[
  {
    "mode": "Grab",
    "route": "Mactan Airport to Cebu Pier 1",
    "estimatedFarePHP": "₱350 - ₱500",
    "paymentMethod": "GrabPay / GCash",
    "localTip": "Book via GrabCar to avoid airport meter queues."
  },
  {
    "mode": "Ferry",
    "route": "Cebu Pier 1 to Tagbilaran Bohol",
    "estimatedFarePHP": "₱800 - ₱1,200",
    "paymentMethod": "Cash only",
    "localTip": "OceanJet takes 2 hours; buy tickets 1 hour prior."
  }
]
\`\`\`
`;
  const legs = parseTransitLegs(markdownWithTransit, {
    origin: "Airport",
    destination: "Bohol",
  });
  assert.equal(legs.length, 2);
  assert.equal(legs[0].mode, "Grab");
  assert.equal(legs[0].route, "Mactan Airport to Cebu Pier 1");
  assert.equal(legs[0].estimatedFarePHP, "₱350 - ₱500");
  assert.equal(legs[0].paymentMethod, "GrabPay / GCash");
  assert.equal(legs[1].mode, "Ferry");

  const clean = stripTransitBlock(markdownWithTransit);
  assert.ok(!clean.includes("```transit"));
  assert.ok(clean.includes("Take an early transfer to the pier."));

  // Fallback when text has no transit block
  const fallbackLegs = parseTransitLegs("Just a plain text itinerary.", {
    origin: "Manila Airport",
    destination: "El Nido",
  });
  assert.ok(fallbackLegs.length >= 3);
  assert.equal(fallbackLegs[0].mode, "Grab");
});
test("buildTransitLinks generates valid URLs for Sakay, Grab, 12Go, Klook, and Maps", () => {
  const links = buildTransitLinks("Makati", "BGC Taguig");
  assert.equal(links.length, 5);

  const sakay = links.find((l) => l.id === "sakay");
  assert.ok(sakay.url.includes("sakay.ph/?from=Makati&to=BGC%20Taguig"));

  const grab = links.find((l) => l.id === "grab");
  assert.ok(grab.url.includes("grab.com/ph/transport/"));

  const twelvego = links.find((l) => l.id === "twelvego");
  assert.ok(twelvego.url.includes("12go.asia/en/travel?from=Makati&to=BGC%20Taguig"));

  const klook = links.find((l) => l.id === "klook");
  assert.ok(klook.url.includes("klook.com/en-PH/search"));

  const maps = links.find((l) => l.id === "maps");
  assert.ok(maps.url.includes("google.com/maps/dir"));
  assert.ok(maps.url.includes("travelmode=transit"));
});
test("cleanTripPayload formats compact trip JSON strictly under 50,000 chars", () => {
  const sampleTrip = {
    id: "test-uuid-1234",
    destination: "Boracay",
    trip: { destination: "Boracay", days: 3, nights: 2, people: 2 },
    result: {
      parts: [{ text: "Day 1 in Boracay...", annotations: [] }],
      sources: [{ title: "Boracay Guide", url: "https://example.com" }],
      createdAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
      model: "gemini-3.7-flash",
      hasMaps: false,
    },
    notes: "Remember sunblock",
    costs: null,
    chat: [{ role: "user", text: "Is White Beach crowded?" }],
  };

  const payloadStr = cleanTripPayload(sampleTrip);
  assert.ok(typeof payloadStr === "string");
  assert.ok(payloadStr.length < 50000);

  const parsed = JSON.parse(payloadStr);
  assert.equal(parsed.id, "test-uuid-1234");
  assert.equal(parsed.destination, "Boracay");
  assert.equal(parsed.notes, "Remember sunblock");

  assert.ok(SHEETS_API_URL.startsWith("https://script.google.com/macros/s/"));
});
test("parseStayNameFromUrl extracts human readable titles from Airbnb, Agoda, Booking.com URLs", () => {
  assert.equal(
    parseStayNameFromUrl(
      "https://www.airbnb.ca/rooms/12345?title=Minimalist-Villa",
    ),
    "Minimalist Villa",
  );
  assert.equal(
    parseStayNameFromUrl(
      "https://www.agoda.com/city-garden-hotel/hotel/manila-ph.html",
    ),
    "City Garden Hotel",
  );
  assert.equal(
    parseStayNameFromUrl(
      "https://www.booking.com/hotel/ph/shangri-las-boracay-resort-and-spa.html",
    ),
    "Shangri Las Boracay Resort And Spa",
  );
  assert.equal(
    parseStayNameFromUrl(
      "https://www.airbnb.com/rooms/998877/bamboo-eco-cottage-in-siargao",
    ),
    "Bamboo Eco Cottage In Siargao",
  );
});
test("buildMapsSearchLink generates valid Google Maps search URLs", () => {
  const link = buildMapsSearchLink("D'Talipapa Seafood", "Boracay");
  assert.equal(
    link,
    "https://www.google.com/maps/search/?api=1&query=D%27Talipapa%20Seafood%20Boracay",
  );
  assert.equal(buildMapsSearchLink("", ""), null);
});
test("parseDining parses structured dining blocks and stripDiningBlock cleans text", () => {
  const samplePlan = `
Here is your culinary itinerary:
- Morning: Coffee and pandesal

\`\`\`dining
[
  {
    "location": "El Nido Town",
    "category": "Plant-Based",
    "spotName": "Taste El Nido Vegan Cafe",
    "mustTryDish": "Vegan Smoothie Bowls & Ginataang Tofu",
    "description": "Chill plant-based sanctuary with healthy breakfast bowls.",
    "estimatedCostPHP": "₱250 - ₱400"
  },
  {
    "location": "Corong-Corong",
    "category": "Restaurant",
    "spotName": "La Plage Sunset Bar",
    "mustTryDish": "Grilled Catch of the Day in Coconut Cream",
    "description": "Seaside sunset dining with fresh seafood.",
    "estimatedCostPHP": "₱450 - ₱800"
  }
]
\`\`\`
Enjoy your meals!
`;

  const spots = parseDining(samplePlan, { destination: "El Nido" });
  assert.equal(spots.length, 2);
  assert.equal(spots[0].spotName, "Taste El Nido Vegan Cafe");
  assert.equal(spots[0].category, "Plant-Based");
  assert.equal(spots[0].mustTryDish, "Vegan Smoothie Bowls & Ginataang Tofu");
  assert.ok(spots[0].mapsUrl.includes("maps/search"));

  assert.equal(spots[1].spotName, "La Plage Sunset Bar");
  assert.equal(spots[1].category, "Restaurant");

  const stripped = stripDiningBlock(samplePlan);
  assert.ok(!stripped.includes("```dining"));
  assert.ok(stripped.includes("Morning: Coffee and pandesal"));
  assert.ok(stripped.includes("Enjoy your meals!"));
});
test("parseDining fallback provides generic discovery categories and no fabricated restaurants", () => {
  for (const invalidInput of ["", "No dining block here", "```dining\n[invalid json\n```"]) {
    const fallbacks = parseDining(invalidInput, { destination: "Bohol" });
    assert.ok(fallbacks.length >= 3);
    for (const spot of fallbacks) {
      assert.equal(spot.isFallback, true);
      assert.equal(spot.estimatedCostPHP, "Check menu prices");
      assert.ok(!spot.spotName.includes("Aling's Hometown Carenderia"));
      assert.ok(!spot.spotName.includes("Green Haven Kitchen"));
    }
    assert.ok(fallbacks.some((s) => s.spotName.includes("Carenderias in Bohol")));
    assert.ok(fallbacks.some((s) => s.spotName.includes("Plant-Based Dining in Bohol")));
  }
});
test("escapeSpreadsheetFormula and sanitizeSheetsPayload escape formula triggers", () => {
  assert.equal(escapeSpreadsheetFormula("=1+1"), "'=1+1");
  assert.equal(escapeSpreadsheetFormula("+SUM(A1:A2)"), "'+SUM(A1:A2)");
  assert.equal(escapeSpreadsheetFormula("-1+2"), "'-1+2");
  assert.equal(escapeSpreadsheetFormula("@malicious"), "'@malicious");
  assert.equal(escapeSpreadsheetFormula("Normal Hotel Name"), "Normal Hotel Name");
  assert.equal(
    escapeSpreadsheetFormula("https://booking.example.com"),
    "https://booking.example.com",
  );
  assert.equal(escapeSpreadsheetFormula(123), 123);
  assert.equal(escapeSpreadsheetFormula(null), null);

  const payload = {
    action: "save_stay",
    stayId: "123",
    hotelName: "=HYPERLINK(\"https://evil.com\",\"Click\")",
    price: "+₱5,000",
    link: "https://example.com",
    count: 2,
  };
  const sanitized = sanitizeSheetsPayload(payload);
  assert.equal(sanitized.hotelName, "'=HYPERLINK(\"https://evil.com\",\"Click\")");
  assert.equal(sanitized.price, "'+₱5,000");
  assert.equal(sanitized.link, "https://example.com");
  assert.equal(sanitized.count, 2);
});
test("buildStaySearchLink generates safe Google booking search URLs", () => {
  const link = buildStaySearchLink("Crimson Resort & Spa", "Boracay Station 0");
  assert.equal(
    link,
    "https://www.google.com/search?q=Crimson%20Resort%20%26%20Spa%20Boracay%20Station%200%20booking",
  );
  assert.equal(buildStaySearchLink("", ""), null);
});
test("parseAccommodations parses structured accommodations blocks and stripAccommodationsBlock cleans text", () => {
  const samplePlan = `
Here is your lodging plan:

\`\`\`accommodations
[
  {
    "stayName": "Henann Crystal Sands Resort",
    "neighborhood": "Station 2 Beachfront",
    "type": "Resort",
    "description": "Luxurious beachfront resort with upper deck pool.",
    "estimatedPricePHP": "₱6,500 - ₱10,000 / night"
  },
  {
    "stayName": "Ferra Hotel and Garden Suites",
    "neighborhood": "Station 2 Inland",
    "type": "Hotel",
    "description": "Chic boutique hotel with rooftop pool and bar.",
    "estimatedPricePHP": "₱3,200 - ₱5,000 / night"
  }
]
\`\`\`
Have a restful stay!
`;

  const stays = parseAccommodations(samplePlan, { destination: "Boracay" });
  assert.equal(stays.length, 2);
  assert.equal(stays[0].stayName, "Henann Crystal Sands Resort");
  assert.equal(stays[0].type, "Resort");
  assert.equal(stays[0].neighborhood, "Station 2 Beachfront");
  assert.ok(stays[0].searchUrl.includes("google.com/search"));

  assert.equal(stays[1].stayName, "Ferra Hotel and Garden Suites");
  assert.equal(stays[1].type, "Hotel");

  const stripped = stripAccommodationsBlock(samplePlan);
  assert.ok(!stripped.includes("```accommodations"));
  assert.ok(stripped.includes("Here is your lodging plan:"));
  assert.ok(stripped.includes("Have a restful stay!"));
});
test("parseAccommodations fallback provides generic discovery categories and no fabricated properties", () => {
  for (const invalidInput of ["", "No lodging block", "```accommodations\n[corrupt json\n```"]) {
    const fallbacks = parseAccommodations(invalidInput, { destination: "Siargao" });
    assert.ok(fallbacks.length >= 4);
    for (const stay of fallbacks) {
      assert.equal(stay.isFallback, true);
      assert.equal(stay.estimatedPricePHP, "Check live rates");
      assert.ok(!stay.stayName.includes("Grand Hotel & Suites"));
      assert.ok(!stay.stayName.includes("Beachfront Resort & Spa"));
      assert.ok(!stay.stayName.includes("Tropical Garden Villa & Loft"));
    }
    assert.ok(fallbacks.some((s) => s.stayName.includes("Hotels in Siargao")));
    assert.ok(fallbacks.some((s) => s.stayName.includes("Beachfront Resorts in Siargao")));
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

test("ITEM_TYPES contains supported and future entity types", () => {
  assert.deepEqual(ITEM_TYPES, [
    "stay",
    "food",
    "transport",
    "activity",
    "flight",
    "note",
  ]);
});

test("canonicalizeSavedItem and normalizeSavedItems parse legacy stay rows seamlessly", () => {
  const legacyRow = {
    StayID: "stay-uuid-101",
    TripID: "trip-uuid-202",
    CreatedAt: "2026-08-30T10:00:00.000Z",
    HotelName: "Crimson Resort & Spa",
    Price: "₱7,500 / night",
    Link: "https://example.com/crimson",
    SavedBy: "Glen",
    Status: "saved",
  };

  const normalized = canonicalizeSavedItem(legacyRow, "trip-uuid-fallback");
  assert.equal(normalized.itemId, "stay-uuid-101");
  assert.equal(normalized.stayId, "stay-uuid-101"); // backward-compatible alias
  assert.equal(normalized.tripId, "trip-uuid-202");
  assert.equal(normalized.itemType, "stay");
  assert.equal(normalized.name, "Crimson Resort & Spa");
  assert.equal(normalized.hotelName, "Crimson Resort & Spa"); // backward-compatible alias
  assert.equal(normalized.price, "₱7,500 / night");
  assert.equal(normalized.link, "https://example.com/crimson");
  assert.equal(normalized.savedBy, "Glen");
  assert.equal(normalized.status, "saved");
  assert.deepEqual(normalized.details, {});
});

test("canonicalizeSavedItem parses universal food and transport rows with detailsJSON", () => {
  const foodRow = {
    itemId: "food-1",
    tripId: "trip-1",
    itemType: "food",
    name: "Taste El Nido",
    location: "El Nido Town",
    category: "Plant-Based",
    price: "₱300 - ₱500",
    link: "https://maps.google.com/?q=Taste+El+Nido",
    savedBy: "Glen",
    status: "saved",
    detailsJSON: JSON.stringify({
      mustTryDish: "Vegan Ginataan Curry",
      description: "Tropical garden cafe",
    }),
  };

  const normalizedFood = canonicalizeSavedItem(foodRow);
  assert.equal(normalizedFood.itemId, "food-1");
  assert.equal(normalizedFood.itemType, "food");
  assert.equal(normalizedFood.name, "Taste El Nido");
  assert.equal(normalizedFood.location, "El Nido Town");
  assert.equal(normalizedFood.category, "Plant-Based");
  assert.equal(normalizedFood.details.mustTryDish, "Vegan Ginataan Curry");

  const transportRow = {
    itemId: "trans-1",
    tripId: "trip-1",
    itemType: "transport",
    name: "Airport to Hotel Van Transfer",
    location: "PPS Airport → El Nido",
    category: "Van",
    price: "₱600 / person",
    link: "https://12go.asia",
    savedBy: "Glen",
    details: { paymentMethod: "Cash only", localTip: "Book aircon van" },
  };

  const normalizedTrans = canonicalizeSavedItem(transportRow);
  assert.equal(normalizedTrans.itemId, "trans-1");
  assert.equal(normalizedTrans.itemType, "transport");
  assert.equal(normalizedTrans.details.paymentMethod, "Cash only");
});

test("normalizeSavedItems ignores corrupt/null entries and sanitizes rows", () => {
  const mixed = [
    null,
    undefined,
    "not-an-object",
    { StayID: "s1", HotelName: "=SUM(1,2)", Price: "+₱100" },
    { ItemID: "f1", ItemType: "food", Name: "@danger", Category: "Cafe" },
    { ItemID: "a1", ItemType: "activity", Name: "Island Hopping Tour A", Category: "Island Hopping" },
  ];

  const clean = normalizeSavedItems(mixed, "fallback-trip");
  assert.equal(clean.length, 3);
  assert.equal(clean[0].itemId, "s1");
  assert.equal(clean[0].name, "=SUM(1,2)");
  assert.equal(clean[0].price, "+₱100");
  assert.equal(clean[1].itemId, "f1");
  assert.equal(clean[1].itemType, "food");
  assert.equal(clean[1].name, "@danger");
  assert.equal(clean[2].itemId, "a1");
  assert.equal(clean[2].itemType, "activity");
});

test("parseActivities parses structured activities blocks and stripActivitiesBlock cleans text", () => {
  const sample = `
Here is your El Nido adventure plan.

\`\`\`activities
[
  {
    "name": "Bacuit Bay Island Hopping Tour A",
    "location": "Miniloc Island & Big Lagoon",
    "category": "Island Hopping",
    "description": "Paddle through turquoise waters and limestone karst formations.",
    "estimatedPrice": "₱1,200 / person",
    "bestFor": "Adventure seekers & photographers",
    "duration": "Full Day (8:30 AM - 4:00 PM)",
    "bookingTip": "Pre-book kayaking permit for Big Lagoon.",
    "link": "https://example.com/tour-a"
  },
  {
    "name": "Taraw Cliff Canopy Walk",
    "location": "El Nido Town",
    "category": "Hiking",
    "description": "Suspended canopy bridge with panoramic view of Bacuit Bay.",
    "estimatedPrice": "₱400 / person",
    "bestFor": "Active travelers",
    "duration": "1-2 Hours",
    "bookingTip": "Wear rubber shoes; harness provided."
  }
]
\`\`\`

Enjoy your trip!
`;

  const activities = parseActivities(sample, { destination: "El Nido" });
  assert.equal(activities.length, 2);
  assert.equal(activities[0].name, "Bacuit Bay Island Hopping Tour A");
  assert.equal(activities[0].location, "Miniloc Island & Big Lagoon");
  assert.equal(activities[0].category, "Island Hopping");
  assert.equal(activities[0].estimatedPrice, "₱1,200 / person");
  assert.equal(activities[0].bestFor, "Adventure seekers & photographers");
  assert.equal(activities[0].duration, "Full Day (8:30 AM - 4:00 PM)");
  assert.equal(activities[0].bookingTip, "Pre-book kayaking permit for Big Lagoon.");
  assert.equal(activities[0].link, "https://example.com/tour-a");

  assert.equal(activities[1].name, "Taraw Cliff Canopy Walk");
  assert.equal(activities[1].category, "Hiking");
  assert.ok(activities[1].link.includes("google.com/search"));

  const stripped = stripActivitiesBlock(sample);
  assert.ok(!stripped.includes("```activities"));
  assert.ok(!stripped.includes("Bacuit Bay"));
  assert.ok(stripped.includes("Here is your El Nido adventure plan."));
  assert.ok(stripped.includes("Enjoy your trip!"));
});

test("parseActivities fallback provides neutral destination-safe discovery without false geographic claims", () => {
  const fallback = parseActivities("No structured block present", {
    destination: "Baguio",
  });
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].isFallback, true);
  assert.equal(fallback[0].name, "Things to Do in Baguio");
  assert.equal(fallback[0].location, "Baguio");
  assert.equal(fallback[0].category, "Activity");
  assert.ok(fallback[0].link.startsWith("https://"));

  // Must not make unsupported geographic claims for inland destinations
  const allText = `${fallback[0].name} ${fallback[0].category} ${fallback[0].description} ${fallback[0].bookingTip}`.toLowerCase();
  assert.ok(!allText.includes("island hopping"));
  assert.ok(!allText.includes("snorkeling"));
  assert.ok(!allText.includes("diving"));
  assert.ok(!allText.includes("beach"));
  assert.ok(!allText.includes("coastal"));
});

test("parseActivities fails safely on malformed JSON and produces neutral discovery fallback", () => {
  const malformed = `
\`\`\`activities
[
  { "name": "Broken Activity", "location":
\`\`\`
`;
  const fallback = parseActivities(malformed, { destination: "Sagada" });
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].isFallback, true);
  assert.equal(fallback[0].name, "Things to Do in Sagada");
  assert.equal(fallback[0].category, "Activity");
  assert.ok(fallback[0].link.startsWith("https://"));
});

test("parseActivities rejects javascript: URLs and sanitizes unsafe links", () => {
  const unsafeSample = `
\`\`\`activities
[
  {
    "name": "Intramuros Night Walking Tour",
    "location": "Manila",
    "category": "Heritage",
    "description": "Historic walking tour inside the walled city.",
    "estimatedPrice": "₱300 / person",
    "bestFor": "History lovers",
    "duration": "2 Hours",
    "bookingTip": "Wear comfortable walking shoes.",
    "link": "javascript:alert(1)"
  }
]
\`\`\`
`;
  const activities = parseActivities(unsafeSample, { destination: "Manila" });
  assert.equal(activities.length, 1);
  assert.equal(activities[0].name, "Intramuros Night Walking Tour");
  assert.ok(!activities[0].link.toLowerCase().includes("javascript:"));
  assert.ok(activities[0].link.startsWith("https://"));
});

test("canonicalizeSavedItem correctly parses activity items with all metadata fields", () => {
  const rawActivity = {
    itemId: "act-1",
    tripId: "trip-99",
    itemType: "activity",
    name: "Kayangan Lake Snorkel Tour",
    location: "Coron Island",
    category: "Snorkeling",
    estimatedPrice: "₱1,500",
    detailsJSON: JSON.stringify({
      description: "Crystal-clear brackish lake surrounded by karst cliffs.",
      duration: "Half Day",
      bestFor: "Swimmers and families",
      bookingTip: "Life vests mandatory in the lake.",
    }),
  };

  const item = canonicalizeSavedItem(rawActivity);
  assert.equal(item.itemId, "act-1");
  assert.equal(item.tripId, "trip-99");
  assert.equal(item.itemType, "activity");
  assert.equal(item.name, "Kayangan Lake Snorkel Tour");
  assert.equal(item.category, "Snorkeling");
  assert.equal(item.price, "₱1,500");
  assert.equal(item.details.duration, "Half Day");
  assert.equal(item.details.bestFor, "Swimmers and families");
  assert.equal(item.details.bookingTip, "Life vests mandatory in the lake.");
});

test("normalizePartnerIdentity validates Glen and Anne and defaults to Glen", () => {
  assert.equal(normalizePartnerIdentity("Glen"), "Glen");
  assert.equal(normalizePartnerIdentity("glen"), "Glen");
  assert.equal(normalizePartnerIdentity("Anne"), "Anne");
  assert.equal(normalizePartnerIdentity("anne"), "Anne");
  assert.equal(normalizePartnerIdentity("Unknown"), "Glen");
  assert.equal(normalizePartnerIdentity(null), "Glen");
  assert.equal(normalizePartnerIdentity("", "Anne"), "Anne");
});

test("getPartnerIdentity and setPartnerIdentity store and retrieve identity from storage", () => {
  const mem = memory();
  assert.equal(getPartnerIdentity(mem), null);
  setPartnerIdentity(mem, "Anne");
  assert.equal(getPartnerIdentity(mem), "Anne");
  assert.equal(mem.getItem(PARTNER_STORAGE_KEY), "Anne");
  setPartnerIdentity(mem, "Glen");
  assert.equal(getPartnerIdentity(mem), "Glen");
});

test("readSharedTripsCache and writeSharedTripsCache handle compact trip descriptors", () => {
  const mem = memory();
  assert.equal(readSharedTripsCache(mem), null);

  const mockTrips = [
    { tripId: "t-1", destination: "Coron", itemCount: 3, hasTripData: true },
  ];
  writeSharedTripsCache(mem, mockTrips);
  assert.deepEqual(readSharedTripsCache(mem), mockTrips);
  assert.equal(mem.getItem(SHARED_TRIPS_CACHE_KEY), JSON.stringify(mockTrips));

  writeSharedTripsCache(mem, []);
  assert.deepEqual(readSharedTripsCache(mem), []);
});

test("canonicalizeSavedItem respects fallbackSavedBy when savedBy is absent", () => {
  const raw = { itemId: "item-1", name: "Sample Cafe", itemType: "food" };
  const itemGlen = canonicalizeSavedItem(raw, "trip-1", "Glen");
  assert.equal(itemGlen.savedBy, "Glen");

  const itemAnne = canonicalizeSavedItem(raw, "trip-1", "Anne");
  assert.equal(itemAnne.savedBy, "Anne");

  const rawExplicit = {
    itemId: "item-2",
    name: "Beach Resort",
    itemType: "stay",
    savedBy: "Anne",
  };
  const itemExplicit = canonicalizeSavedItem(rawExplicit, "trip-1", "Glen");
  assert.equal(itemExplicit.savedBy, "Anne");
});

test("cross-device Glen and Anne saves normalize into a combined list with distinct attribution", () => {
  const glenSave = canonicalizeSavedItem(
    { name: "Shangri-La Mactan", price: "₱12,000", itemType: "stay" },
    "cebu-2026",
    "Glen",
  );
  const anneSave = canonicalizeSavedItem(
    { name: "Lantaw Floating Restaurant", price: "₱600", itemType: "food" },
    "cebu-2026",
    "Anne",
  );

  const combined = normalizeSavedItems([glenSave, anneSave], "cebu-2026");
  assert.equal(combined.length, 2);
  assert.equal(combined[0].savedBy, "Glen");
  assert.equal(combined[1].savedBy, "Anne");
});

test("mixed items separation — savedItems retains all types while stays retains only stay", () => {
  const mixed = [
    { itemId: "s1", itemType: "stay", name: "Hotel", savedBy: "Glen" },
    { itemId: "f1", itemType: "food", name: "Cafe", savedBy: "Anne" },
    { itemId: "a1", itemType: "activity", name: "Tour", savedBy: "Glen" },
    { itemId: "t1", itemType: "transport", name: "Bus", savedBy: "Anne" },
  ];
  const normalized = normalizeSavedItems(mixed, "trip-1", "Glen");
  assert.equal(normalized.length, 4);
  const staysOnly = normalized.filter((item) => item.itemType === "stay");
  assert.equal(staysOnly.length, 1);
  assert.equal(staysOnly[0].itemType, "stay");
  assert.equal(staysOnly[0].name, "Hotel");
});

test("canonicalizeSavedItem and normalizeSavedItems preserve partner attribution and cross-trip IDs", () => {
  const itemTripA = canonicalizeSavedItem(
    { name: "Cebu Hotel", tripId: "trip-a", savedBy: "Glen", itemType: "stay" },
    "trip-a",
    "Glen",
  );
  const itemTripB = canonicalizeSavedItem(
    { name: "Boracay Cafe", tripId: "trip-b", savedBy: "Anne", itemType: "food" },
    "trip-b",
    "Anne",
  );

  const globalList = normalizeSavedItems([itemTripA, itemTripB]);
  assert.equal(globalList.length, 2);
  assert.equal(globalList[0].tripId, "trip-a");
  assert.equal(globalList[0].savedBy, "Glen");
  assert.equal(globalList[1].tripId, "trip-b");
  assert.equal(globalList[1].savedBy, "Anne");
});
