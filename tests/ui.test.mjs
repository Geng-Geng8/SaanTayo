import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { normalizeInteraction } from "../server/gemini.js";
import { interaction, costs } from "./fixtures.mjs";
const html = await readFile("dist/index.html", "utf8"),
  bundle = await readFile("dist/assets/app.js", "utf8");
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
async function setup({
  initial = {},
  post,
  sheetsHandler,
  url = "https://app.example/",
  fresh = false,
} = {}) {
  const dom = new JSDOM(html, {
    url,
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
  const init = fresh
    ? initial
    : { saantayo_partner_identity_v1: "Glen", ...initial };
  for (const [k, v] of Object.entries(init)) {
    if (v !== null && v !== undefined) w.localStorage.setItem(k, v);
  }
  const requests = [];
  const sheetsRequests = [];
  w.fetch = async (reqUrl, options = {}) => {
    if (reqUrl.endsWith("/health")) return Response.json({ ready: true });
    if (reqUrl.endsWith("/fx"))
      return Response.json({
        base: "PHP",
        quote: "CAD",
        rate: 0.024,
        date: new Date().toISOString().slice(0, 10),
      });
    if (reqUrl.includes("script.google.com")) {
      const parsedUrl = new URL(reqUrl);
      const action = parsedUrl.searchParams.get("action");
      let bodyObj = null;
      if (options.body) {
        try {
          bodyObj = JSON.parse(options.body);
        } catch {}
      }
      const effAction = action || bodyObj?.action;
      sheetsRequests.push({
        url: reqUrl,
        action: effAction,
        body: bodyObj,
      });
      if (sheetsHandler)
        return sheetsHandler(reqUrl, options, { action: effAction, bodyObj });
      return Response.json({ status: "success" });
    }
    const body = options.body ? JSON.parse(options.body) : {};
    requests.push({ url: reqUrl, body });
    if (post) return post(reqUrl, body, options);
    if (reqUrl.endsWith("/budget")) return Response.json({ costs });
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
  return {
    dom,
    w,
    $,
    submit,
    generate,
    requests,
    sheetsRequests,
    get travelRequests() {
      return requests.filter((r) => r.url.endsWith("/travel"));
    },
  };
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
  assert.equal(app.travelRequests.at(-1).body.trip.mode, "compare");
  assert.ok(
    app.travelRequests.at(-1).body.trip.vibes.includes("Must-Try Food & Local Eats"),
  );
  app.$("modeResearchBtn").click();
  app.$("question").value = "Current ferry schedules?";
  app.submit("planner");
  await tick();
  assert.equal(
    app.travelRequests.at(-1).body.trip.question,
    "Current ferry schedules?",
  );
  app.dom.window.close();
});
test("accommodation type filters update badge, provider links, and planner selection", async () => {
  const app = await setup();
  app.$("stayType").value = "hotel";
  await app.generate();

  assert.equal(app.travelRequests[0].body.trip.stayType, "hotel");
  assert.equal(app.$("accommodationSection").classList.contains("hidden"), false);
  assert.equal(app.$("activeStayBadge").textContent, "Hotels Only");

  const cards = (app.$("aiStaysGrid") || app.$("providerLinksGrid")).querySelectorAll(".stay-card, .provider-card");
  assert.ok(cards.length >= 1);

  // Click Airbnb / Rentals filter
  app.$("stayFilterRental").click();
  await tick();
  assert.equal(app.$("activeStayBadge").textContent, "Airbnb / Vacation Rentals");
  assert.equal(app.$("stayFilterRental").getAttribute("aria-selected"), "true");
  assert.equal(app.$("stayFilterHotel").getAttribute("aria-selected"), "false");

  const rentalLinks = (app.$("aiStaysGrid") || app.$("providerLinksGrid")).querySelectorAll("a");
  assert.ok(rentalLinks.length >= 1);

  // Click All filter
  app.$("stayFilterAll").click();
  await tick();
  assert.equal(app.$("activeStayBadge").textContent, "All Accommodations");
  assert.equal(app.$("stayFilterAll").getAttribute("aria-selected"), "true");

  app.dom.window.close();
});
test("transit navigator renders high-contrast transit cards and deep links", async () => {
  const app = await setup();
  await app.generate();

  assert.equal(app.$("transitSection").classList.contains("hidden"), false);
  const transitCards = app.$("transitCardsGrid").querySelectorAll(".transit-card");
  assert.ok(transitCards.length >= 2);

  const firstBadge = transitCards[0].querySelector(".transit-mode-badge");
  assert.ok(firstBadge);
  assert.ok(firstBadge.textContent.length > 0);

  const fareChip = transitCards[0].querySelector(".transit-fare-chip");
  assert.ok(fareChip);
  assert.ok(fareChip.textContent.includes("₱"));

  const actionLinks = app.$("transitLinksRow").querySelectorAll(".transit-link-btn");
  assert.ok(actionLinks.length >= 4);
  assert.ok([...actionLinks].some((l) => l.href.includes("grab.com") || l.href.includes("sakay.ph")));

  app.dom.window.close();
});
test("culinary and dining guide renders dining cards with map deep links", async () => {
  const app = await setup();
  await app.generate();

  assert.equal(app.$("diningSection").classList.contains("hidden"), false);
  const diningCards = app.$("diningCardsGrid").querySelectorAll(".dining-card");
  assert.ok(diningCards.length >= 2);

  const firstBadge = diningCards[0].querySelector(".dining-category-badge");
  assert.ok(firstBadge);
  assert.ok(firstBadge.textContent.length > 0);

  const dishPill = diningCards[0].querySelector(".dining-dish-pill");
  assert.ok(dishPill);
  assert.ok(dishPill.textContent.includes("Must Try"));

  const mapBtn = diningCards[0].querySelector(".dining-map-btn");
  assert.ok(mapBtn);
  assert.ok(mapBtn.href.includes("google.com/maps/search"));

  app.dom.window.close();
});
test("things to do and experiences guide renders activity cards with booking/search links and pin buttons", async () => {
  const app = await setup();
  await app.generate();

  assert.equal(app.$("activitiesSection").classList.contains("hidden"), false);
  const actCards = app.$("activitiesCardsGrid").querySelectorAll(".activity-card");
  assert.ok(actCards.length >= 1);

  const firstBadge = actCards[0].querySelector(".activity-category-badge");
  assert.ok(firstBadge);
  assert.ok(firstBadge.textContent.length > 0);

  const priceChip = actCards[0].querySelector(".activity-price-chip");
  assert.ok(priceChip);

  const searchBtn = actCards[0].querySelector(".activity-search-btn");
  assert.ok(searchBtn);
  assert.ok(searchBtn.href.startsWith("https://"));
  assert.ok(!searchBtn.href.includes("javascript:"));

  const pinBtn = actCards[0].querySelector(".pin-btn");
  assert.ok(pinBtn);

  app.dom.window.close();
});
test("pinned stays shortlist opens drawer, pins stays, and deletes stays", async () => {
  const app = await setup();
  await app.generate();

  // Open Shortlist Drawer
  app.$("openShortlistBtn").click();
  assert.equal(app.$("shortlistModal").open, true);
  assert.equal(app.$("shortlistBadge").textContent, "0");

  // Close drawer
  app.$("shortlistModal").close();

  // Find a pin button on an accommodation card
  const pinBtns = (app.$("aiStaysGrid") || app.$("providerLinksGrid")).querySelectorAll(".stay-pin-btn, .pin-btn");
  assert.ok(pinBtns.length > 0);

  // Click pin button
  pinBtns[0].click();
  await tick();

  assert.equal(app.$("shortlistBadge").textContent, "1");
  const updatedPinBtns = (app.$("aiStaysGrid") || app.$("providerLinksGrid")).querySelectorAll(".stay-pin-btn, .pin-btn");
  assert.ok(updatedPinBtns[0].classList.contains("pinned"));

  // Check item in shortlist drawer
  const shortlistItems = app.$("shortlistItemsList").querySelectorAll(".shortlist-item");
  assert.equal(shortlistItems.length, 1);
  assert.ok(shortlistItems[0].textContent.includes("Saved by Glen"));

  // Click delete button
  const delBtn = shortlistItems[0].querySelector(".shortlist-delete-btn");
  assert.ok(delBtn);
  delBtn.click();
  await tick();

  // Test manual Add Stay form
  app.$("openShortlistBtn").click();
  assert.equal(app.$("addStayForm").classList.contains("hidden"), true);

  app.$("toggleAddStayBtn").click();
  assert.equal(app.$("addStayForm").classList.contains("hidden"), false);

  app.$("manualStayName").value = "Henann Resort Alona Beach";
  app.$("manualStayPrice").value = "₱6,200 / night";
  app.$("manualStayLink").value = "https://example.com/henann";

  app.submit("addStayForm");
  await tick();

  assert.equal(app.$("addStayForm").classList.contains("hidden"), true);
  assert.equal(app.$("manualStayName").value, "");
  assert.equal(app.$("shortlistBadge").textContent, "1");

  const customItems = app.$("shortlistItemsList").querySelectorAll(".shortlist-item");
  assert.equal(customItems.length, 1);
  assert.ok(customItems[0].textContent.includes("Henann Resort Alona Beach"));
  assert.ok(customItems[0].textContent.includes("₱6,200 / night"));
  assert.ok(customItems[0].textContent.includes("Saved by Glen"));

  // Test Smart Paste button
  app.w.navigator.clipboard = {
    readText: async () =>
      "https://www.agoda.com/crimson-resort-and-spa/hotel/cebu-ph.html",
  };
  app.$("toggleAddStayBtn").click();
  app.$("smartPasteStayBtn").click();
  await tick();

  assert.equal(
    app.$("manualStayLink").value,
    "https://www.agoda.com/crimson-resort-and-spa/hotel/cebu-ph.html",
  );
  assert.equal(app.$("manualStayName").value, "Crimson Resort And Spa");

  app.$("manualStayPrice").value = "₱8,500 / night";
  app.submit("addStayForm");
  await tick();

  assert.equal(app.$("shortlistBadge").textContent, "2");
  const itemsAfterPaste = app.$("shortlistItemsList").querySelectorAll(".shortlist-item");
  assert.equal(itemsAfterPaste.length, 2);
  assert.ok(itemsAfterPaste[0].textContent.includes("Crimson Resort And Spa"));

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
  assert.equal(app.travelRequests.length, 1);
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
  assert.equal(app.travelRequests.length, 2);
  assert.match(app.$("chatMessages").textContent, /Summarize/);
  app.dom.window.close();
});
test("cancel prevents a late response replacing the plan and duplicate submits", async () => {
  const finish = (val) => {
    if (finishCallback) finishCallback(val);
  };
  let finishCallback;
  const app = await setup({
    post: () =>
      new Promise((resolve) => {
        finishCallback = resolve;
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

test("Test A & G — Remote truth beats empty local cache on clean second device", async () => {
  const tripId = "11111111-2222-3333-4444-555555555555";
  const remoteStays = [
    { stayId: "s1", tripId, hotelName: "Hotel One", price: "₱3,500", link: "https://example.com/1", savedBy: "Glen" },
    { stayId: "s2", tripId, hotelName: "Resort Two", price: "₱5,000", link: "https://example.com/2", savedBy: "Glen" },
    { stayId: "s3", tripId, hotelName: "Villa Three", price: "₱7,000", link: "https://example.com/3", savedBy: "Glen" },
  ];

  const app = await setup({
    url: `https://app.example/?trip=${tripId}`,
    sheetsHandler: (reqUrl, options, { action }) => {
      if (action === "get_trip") {
        return Response.json({
          status: "success",
          tripId,
          tripDataJSON: JSON.stringify({
            id: tripId,
            destination: "Siargao",
            trip: { destination: "Siargao", days: 5, nights: 4, people: 2, mode: "itinerary" },
            result: normalizeInteraction(interaction()),
          }),
          stays: remoteStays,
        });
      }
      if (action === "get_stays") {
        return Response.json({ status: "success", stays: remoteStays });
      }
      return Response.json({ status: "success" });
    },
  });

  await tick();
  await tick();

  assert.equal(app.$("shortlistBadge").textContent, "3");
  const items = app.$("shortlistItemsList").querySelectorAll(".shortlist-item");
  assert.equal(items.length, 3);
  assert.ok(items[0].textContent.includes("Hotel One"));
  assert.ok(items[1].textContent.includes("Resort Two"));
  assert.ok(items[2].textContent.includes("Villa Three"));

  app.dom.window.close();
});

test("Test B — Remote truth beats stale local cache", async () => {
  const tripId = "22222222-3333-4444-5555-666666666666";
  const staleTrip = {
    id: tripId,
    destination: "El Nido",
    trip: { destination: "El Nido", days: 3, nights: 2, people: 2, mode: "itinerary" },
    result: normalizeInteraction(interaction()),
    stays: [
      { stayId: "s1", tripId, hotelName: "Old Stale Hotel", price: "₱2,000", link: "", savedBy: "Glen" },
    ],
  };

  const remoteStays = [
    { stayId: "s1", tripId, hotelName: "Hotel One", price: "₱3,500", link: "", savedBy: "Glen" },
    { stayId: "s2", tripId, hotelName: "Resort Two", price: "₱5,000", link: "", savedBy: "Glen" },
    { stayId: "s3", tripId, hotelName: "Villa Three", price: "₱7,000", link: "", savedBy: "Glen" },
  ];

  const app = await setup({
    url: `https://app.example/?trip=${tripId}`,
    initial: {
      saantayo_trips_v2: JSON.stringify({ version: 2, trips: [staleTrip] }),
    },
    sheetsHandler: (reqUrl, options, { action }) => {
      if (action === "get_stays") {
        return Response.json({ status: "success", stays: remoteStays });
      }
      return Response.json({ status: "success" });
    },
  });

  await tick();
  await tick();

  assert.equal(app.$("shortlistBadge").textContent, "3");
  const items = app.$("shortlistItemsList").querySelectorAll(".shortlist-item");
  assert.equal(items.length, 3);
  assert.ok(!app.$("shortlistItemsList").textContent.includes("Old Stale Hotel"));

  app.dom.window.close();
});

test("Test C — Successful authoritative empty list overrides local stays", async () => {
  const tripId = "33333333-4444-5555-6666-777777777777";
  const localTrip = {
    id: tripId,
    destination: "Coron",
    trip: { destination: "Coron", days: 3, nights: 2, people: 2, mode: "itinerary" },
    result: normalizeInteraction(interaction()),
    stays: [
      { stayId: "s1", tripId, hotelName: "Hotel One", price: "₱3,500", link: "", savedBy: "Glen" },
      { stayId: "s2", tripId, hotelName: "Resort Two", price: "₱5,000", link: "", savedBy: "Glen" },
    ],
  };

  const app = await setup({
    url: `https://app.example/?trip=${tripId}`,
    initial: {
      saantayo_trips_v2: JSON.stringify({ version: 2, trips: [localTrip] }),
    },
    sheetsHandler: (reqUrl, options, { action }) => {
      if (action === "get_stays" || action === "get_trip") {
        return Response.json({ status: "success", stays: [] });
      }
      return Response.json({ status: "success" });
    },
  });

  await tick();
  await tick();

  assert.equal(app.$("shortlistBadge").textContent, "0");
  assert.ok(
    app.$("shortlistItemsList").textContent.includes("No saved items yet") ||
      app.$("shortlistItemsList").textContent.includes("No pinned stays yet"),
  );

  app.dom.window.close();
});

test("Test D — Network failure preserves local cached stays", async () => {
  const tripId = "44444444-5555-6666-7777-888888888888";
  const localTrip = {
    id: tripId,
    destination: "Batanes",
    trip: { destination: "Batanes", days: 4, nights: 3, people: 2, mode: "itinerary" },
    result: normalizeInteraction(interaction()),
    stays: [
      { stayId: "s1", tripId, hotelName: "Batanes Homestay", price: "₱1,800", link: "", savedBy: "Glen" },
      { stayId: "s2", tripId, hotelName: "Lighthouse Lodge", price: "₱3,000", link: "", savedBy: "Glen" },
    ],
  };

  const app = await setup({
    url: `https://app.example/?trip=${tripId}`,
    initial: {
      saantayo_trips_v2: JSON.stringify({ version: 2, trips: [localTrip] }),
    },
    sheetsHandler: () => {
      throw new Error("Network offline / 500 Internal Error");
    },
  });

  await tick();
  await tick();

  // Cached stays should remain visible
  assert.equal(app.$("shortlistBadge").textContent, "2");
  const items = app.$("shortlistItemsList").querySelectorAll(".shortlist-item");
  assert.equal(items.length, 2);
  assert.ok(items[0].textContent.includes("Batanes Homestay"));
  assert.ok(items[1].textContent.includes("Lighthouse Lodge"));

  app.dom.window.close();
});

test("Test E & F — Pin and Delete reconcile authoritatively with Sheets", async () => {
  let serverStays = [
    { stayId: "s1", tripId: "initial-trip", hotelName: "Initial Resort", price: "₱4,000", link: "", savedBy: "Glen" },
  ];

  const app = await setup({
    sheetsHandler: (reqUrl, options, { action, bodyObj }) => {
      if ((action === "save_item" || action === "save_stay") && bodyObj) {
        serverStays = [
          ...serverStays,
          {
            stayId: bodyObj.itemId || bodyObj.stayId,
            tripId: bodyObj.tripId,
            hotelName: bodyObj.name || bodyObj.hotelName,
            price: bodyObj.price,
            link: bodyObj.link,
            savedBy: bodyObj.savedBy,
          },
        ];
        return Response.json({ status: "success", stays: serverStays });
      }
      if ((action === "delete_item" || action === "delete_stay") && bodyObj) {
        serverStays = serverStays.filter(
          (s) => s.stayId !== (bodyObj.itemId || bodyObj.stayId),
        );
        return Response.json({ status: "success", stays: serverStays });
      }
      if (action === "get_items" || action === "get_stays") {
        return Response.json({ status: "success", stays: serverStays });
      }
      return Response.json({ status: "success" });
    },
  });

  await app.generate();

  // Pin a stay
  const pinBtns = app.$("aiStaysGrid").querySelectorAll(".stay-pin-btn");
  assert.ok(pinBtns.length > 0);
  pinBtns[0].click();
  await tick();
  await tick();

  assert.equal(app.$("shortlistBadge").textContent, "2");

  // Delete first stay
  const delBtns = app.$("shortlistItemsList").querySelectorAll(".shortlist-delete-btn");
  assert.equal(delBtns.length, 2);
  delBtns[0].click();
  await tick();
  await tick();

  assert.equal(app.$("shortlistBadge").textContent, "1");

  app.dom.window.close();
});

test("Test H — All Sheets actions use consistent tripId", async () => {
  let observedTripIds = new Set();

  const app = await setup({
    sheetsHandler: (reqUrl, options, { action, bodyObj }) => {
      const urlObj = new URL(reqUrl);
      const qTripId = urlObj.searchParams.get("tripId");
      if (qTripId) observedTripIds.add(qTripId);
      if (bodyObj?.tripId) observedTripIds.add(bodyObj.tripId);
      return Response.json({ status: "success", stays: [] });
    },
  });

  await app.generate();

  // Pin stay
  const pinBtns = app.$("aiStaysGrid").querySelectorAll(".stay-pin-btn");
  if (pinBtns.length) {
    pinBtns[0].click();
    await tick();
  }

  // Save trip
  app.$("savePlan").click();
  await tick();

  // There should be exactly 1 unique tripId across all Sheets requests
  assert.equal(observedTripIds.size, 1);
  const canonicalId = [...observedTripIds][0];
  assert.ok(canonicalId.length > 10);

  app.dom.window.close();
});

test("Universal Saved Items — Pins stay, food, and transport and displays type badges in Shortlist", async () => {
  let serverItems = [];

  const app = await setup({
    sheetsHandler: (reqUrl, options, { action, bodyObj }) => {
      if ((action === "save_item" || action === "save_stay") && bodyObj) {
        serverItems = [
          ...serverItems,
          {
            itemId: bodyObj.itemId || bodyObj.stayId,
            tripId: bodyObj.tripId,
            itemType: bodyObj.itemType || "stay",
            name: bodyObj.name || bodyObj.hotelName,
            location: bodyObj.location || "",
            category: bodyObj.category || "General",
            price: bodyObj.price,
            link: bodyObj.link,
            savedBy: bodyObj.savedBy || "Glen",
            detailsJSON: bodyObj.detailsJSON || "{}",
          },
        ];
        return Response.json({ status: "success", items: serverItems });
      }
      if ((action === "delete_item" || action === "delete_stay") && bodyObj) {
        serverItems = serverItems.filter(
          (s) => (s.itemId || s.stayId) !== (bodyObj.itemId || bodyObj.stayId),
        );
        return Response.json({ status: "success", items: serverItems });
      }
      if (action === "get_items" || action === "get_stays") {
        return Response.json({ status: "success", items: serverItems });
      }
      return Response.json({ status: "success" });
    },
  });

  await app.generate();

  // 1. Pin a Stay
  const stayPinBtns = (app.$("aiStaysGrid") || app.$("providerLinksGrid")).querySelectorAll(".pin-btn");
  assert.ok(stayPinBtns.length > 0);
  stayPinBtns[0].click();
  await tick();
  await tick();

  // 2. Pin a Dining spot
  const foodPinBtns = app.$("diningCardsGrid").querySelectorAll(".pin-btn");
  assert.ok(foodPinBtns.length > 0);
  foodPinBtns[0].click();
  await tick();
  await tick();

  // 3. Pin an Activity
  const actPinBtns = app.$("activitiesCardsGrid").querySelectorAll(".pin-btn");
  assert.ok(actPinBtns.length > 0);
  actPinBtns[0].click();
  await tick();
  await tick();

  // 4. Pin a Transit leg
  const transitPinBtns = app.$("transitCardsGrid").querySelectorAll(".pin-btn");
  assert.ok(transitPinBtns.length > 0);
  transitPinBtns[0].click();
  await tick();
  await tick();

  // Shortlist badge should show 4 items
  assert.equal(app.$("shortlistBadge").textContent, "4");

  // Open Shortlist drawer and inspect type pills
  app.$("openShortlistBtn").click();
  const items = app.$("shortlistItemsList").querySelectorAll(".shortlist-item");
  assert.equal(items.length, 4);

  const typePills = app.$("shortlistItemsList").querySelectorAll(".shortlist-type-pill");
  assert.equal(typePills.length, 4);
  const pillTexts = [...typePills].map((p) => p.textContent.trim().toLowerCase());
  assert.ok(pillTexts.some((t) => t.includes("stay")));
  assert.ok(pillTexts.some((t) => t.includes("food")));
  assert.ok(pillTexts.some((t) => t.includes("activity")));
  assert.ok(pillTexts.some((t) => t.includes("transit")));

  // Delete the food item
  const delBtns = app.$("shortlistItemsList").querySelectorAll(".shortlist-delete-btn");
  assert.equal(delBtns.length, 4);
  delBtns[1].click();
  await tick();
  await tick();

  assert.equal(app.$("shortlistBadge").textContent, "3");

  app.dom.window.close();
});

test("First-use partner identity chooser and explicit selection without accidental toggle", async () => {
  const app = await setup({ fresh: true });

  // Fresh storage: identity is not silently Glen
  assert.equal(
    app.dom.window.localStorage.getItem("saantayo_partner_identity_v1"),
    null,
  );
  assert.equal(app.$("currentPartnerLabel").textContent, "Select");
  // Chooser opened automatically
  assert.equal(app.$("partnerModal").open, true);

  // Clicking partner toggle button does NOT change identity
  app.$("partnerToggleBtn").click();
  await tick();
  assert.equal(
    app.dom.window.localStorage.getItem("saantayo_partner_identity_v1"),
    null,
  );

  // Trying to save without selecting partner blocks save and ensures modal is open
  await app.generate();
  const stayPinBtns = (app.$("aiStaysGrid") || app.$("providerLinksGrid")).querySelectorAll(".pin-btn");
  stayPinBtns[0].click();
  await tick();
  assert.equal(app.$("shortlistBadge").textContent, "0");
  assert.equal(app.$("partnerModal").open, true);

  // Select Anne
  app.$("selectAnneBtn").click();
  await tick();
  assert.equal(
    app.dom.window.localStorage.getItem("saantayo_partner_identity_v1"),
    "Anne",
  );
  assert.equal(app.$("currentPartnerLabel").textContent, "Anne");
  assert.equal(app.$("partnerModal").open, false);

  app.dom.window.close();

  // Reload: Anne is restored and chooser does not auto-open
  const appReload = await setup({
    initial: { saantayo_partner_identity_v1: "Anne" },
  });
  assert.equal(appReload.$("currentPartnerLabel").textContent, "Anne");
  assert.equal(appReload.$("partnerModal").open, false);
  appReload.dom.window.close();
});

test("Test A — Glen → clean Anne device cross-device synchronization", async () => {
  let backendTrips = [];
  let backendItems = [];

  const sheetsBackendHandler = (reqUrl, options, { action, bodyObj }) => {
    if (action === "save_trip") {
      backendTrips.push(bodyObj);
      return Response.json({ status: "success", type: "trip_saved" });
    }
    if (action === "save_item") {
      backendItems.push(bodyObj);
      return Response.json({ status: "success", type: "item_saved", items: backendItems });
    }
    if (action === "list_trips") {
      return Response.json({
        status: "success",
        trips: [
          {
            tripId: "shared-cebu-1",
            destination: "Cebu City",
            startDate: "2026-10-01",
            endDate: "2026-10-05",
            createdAt: "2026-08-31T10:00:00Z",
            itemCount: backendItems.length,
            hasTripData: true,
          },
        ],
      });
    }
    if (action === "get_trip") {
      return Response.json({
        status: "success",
        tripId: "shared-cebu-1",
        tripDataJSON: JSON.stringify({
          id: "shared-cebu-1",
          destination: "Cebu City",
          trip: { destination: "Cebu City", mode: "itinerary", days: 4, people: 2 },
          result: { parts: [{ text: "Cebu City itinerary plan" }], createdAt: "2026-08-31" },
        }),
        items: backendItems,
      });
    }
    if (action === "get_items") {
      return Response.json({
        status: "success",
        tripId: "shared-cebu-1",
        items: backendItems,
      });
    }
    return Response.json({ status: "success" });
  };

  // Device A (Glen)
  const deviceA = await setup({
    initial: { saantayo_partner_identity_v1: "Glen" },
    sheetsHandler: sheetsBackendHandler,
  });

  await deviceA.generate();
  // Pin stay as Glen
  const stayPinBtns = (deviceA.$("aiStaysGrid") || deviceA.$("providerLinksGrid")).querySelectorAll(".pin-btn");
  stayPinBtns[0].click();
  await tick();
  await tick();

  assert.equal(backendItems.length, 1);
  assert.equal(backendItems[0].savedBy, "Glen");
  deviceA.dom.window.close();

  // Device B (Anne) - completely fresh localStorage
  const deviceB = await setup({
    initial: { saantayo_partner_identity_v1: "Anne" },
    sheetsHandler: sheetsBackendHandler,
  });

  // Device B automatically runs list_trips at startup
  await tick();
  await tick();

  // Open Shared Trips modal
  deviceB.dom.window.document.querySelector('[data-dialog="savedTripsModal"]').click();
  await tick();
  await tick();

  const rows = deviceB.$("savedTripsList").querySelectorAll(".shared-trip-row");
  assert.equal(rows.length, 1);
  assert.ok(rows[0].textContent.includes("Cebu City"));

  // Open the trip
  const openBtn = rows[0].querySelector('[data-load]');
  openBtn.click();
  await tick();
  await tick();

  assert.equal(deviceB.$("shortlistBadge").textContent, "1");
  deviceB.$("openShortlistBtn").click();
  await tick();
  const visibleItems = deviceB.$("shortlistItemsList").querySelectorAll(".shortlist-item");
  assert.equal(visibleItems.length, 1);
  assert.ok(visibleItems[0].textContent.includes("Saved by Glen"));

  deviceB.dom.window.close();
});

test("Test B — Anne → Glen live refresh", async () => {
  let backendItems = [
    { itemId: "glen-1", tripId: "shared-trip-1", itemType: "stay", name: "Radisson Blu Cebu", price: "₱6,000", savedBy: "Glen" },
  ];

  const appGlen = await setup({
    initial: {
      saantayo_partner_identity_v1: "Glen",
      saantayo_trips_v2: JSON.stringify({
        version: 2,
        trips: [
          {
            id: "shared-trip-1",
            destination: "Cebu City",
            trip: { destination: "Cebu City", mode: "itinerary", days: 3, people: 2 },
            result: { parts: [{ text: "Cebu Itinerary" }], createdAt: "2026-08-31" },
            savedItems: backendItems,
          },
        ],
      }),
    },
    url: "https://app.example/?trip=shared-trip-1",
    sheetsHandler: (reqUrl, options, { action }) => {
      if (action === "get_items") {
        return Response.json({ status: "success", tripId: "shared-trip-1", items: backendItems });
      }
      if (action === "get_trip") {
        return Response.json({
          status: "success",
          tripId: "shared-trip-1",
          tripDataJSON: JSON.stringify({
            id: "shared-trip-1",
            destination: "Cebu City",
            trip: { destination: "Cebu City", mode: "itinerary", days: 3, people: 2 },
            result: { parts: [{ text: "Cebu Itinerary" }], createdAt: "2026-08-31" },
          }),
          items: backendItems,
        });
      }
      return Response.json({ status: "success" });
    },
  });

  await tick();
  await tick();
  assert.equal(appGlen.$("shortlistBadge").textContent, "1");

  // Anne adds an item on backend
  backendItems.push({
    itemId: "anne-1",
    tripId: "shared-trip-1",
    itemType: "food",
    name: "Lantaw Floating Restaurant",
    price: "₱600",
    savedBy: "Anne",
  });

  // Trigger focus event on Glen's browser window
  appGlen.dom.window.dispatchEvent(new appGlen.dom.window.Event("focus"));
  await tick();
  await tick();

  assert.equal(appGlen.$("shortlistBadge").textContent, "2");
  appGlen.$("openShortlistBtn").click();
  await tick();
  const visible = appGlen.$("shortlistItemsList").querySelectorAll(".shortlist-item");
  assert.equal(visible.length, 2);
  assert.ok(visible[1].textContent.includes("Saved by Anne"));

  appGlen.dom.window.close();
});

test("Cross-trip stale response protection", async () => {
  let tripAItemsResolver;
  const tripAPromise = new Promise((resolve) => {
    tripAItemsResolver = resolve;
  });

  const app = await setup({
    initial: {
      saantayo_partner_identity_v1: "Glen",
      saantayo_trips_v2: JSON.stringify({
        version: 2,
        trips: [
          {
            id: "trip-A",
            destination: "Manila",
            trip: { destination: "Manila", mode: "itinerary", days: 2, people: 2 },
            result: { parts: [{ text: "Manila Itinerary" }], sources: [], createdAt: "2026-08-31", expiresAt: "2099-01-01T00:00:00Z" },
            savedItems: [],
          },
          {
            id: "trip-B",
            destination: "Baguio",
            trip: { destination: "Baguio", mode: "itinerary", days: 2, people: 2 },
            result: { parts: [{ text: "Baguio Itinerary" }], sources: [], createdAt: "2026-08-31", expiresAt: "2099-01-01T00:00:00Z" },
            savedItems: [],
          },
        ],
      }),
    },
    url: "https://app.example/?trip=trip-A",
    sheetsHandler: async (reqUrl, options, { action, bodyObj }) => {
      const parsed = new URL(reqUrl);
      const tripId = parsed.searchParams.get("tripId");
      if (action === "get_items" && tripId === "trip-A") {
        await tripAPromise;
        return Response.json({
          status: "success",
          tripId: "trip-A",
          items: [{ itemId: "item-a", name: "Manila Hotel", itemType: "stay", savedBy: "Glen" }],
        });
      }
      if (action === "get_items" && tripId === "trip-B") {
        return Response.json({
          status: "success",
          tripId: "trip-B",
          items: [{ itemId: "item-b", name: "The Manor Baguio", itemType: "stay", savedBy: "Anne" }],
        });
      }
      if (action === "get_trip" && tripId === "trip-B") {
        return Response.json({
          status: "success",
          tripId: "trip-B",
          tripDataJSON: JSON.stringify({
            id: "trip-B",
            destination: "Baguio",
            trip: { destination: "Baguio", mode: "itinerary", days: 2, people: 2 },
            result: { parts: [{ text: "Baguio Itinerary" }], sources: [], createdAt: "2026-08-31", expiresAt: "2099-01-01T00:00:00Z" },
          }),
          items: [{ itemId: "item-b", name: "The Manor Baguio", itemType: "stay", savedBy: "Anne" }],
        });
      }
      return Response.json({ status: "success" });
    },
  });

  await tick();
  // While trip-A get_items is in flight, user opens trip-B via Shared Trips modal
  app.dom.window.document.querySelector('[data-dialog="savedTripsModal"]').click();
  await tick();
  const openTripBBtn = app.$("savedTripsList").querySelectorAll('[data-load]')[1];
  openTripBBtn.click();
  await tick();
  await tick();

  // Active trip is now Baguio (trip-B)
  assert.equal(app.$("resultMetaBadge").textContent, "Baguio");

  // Now resolve the delayed trip-A get_items response
  tripAItemsResolver();
  await tick();
  await tick();

  // Active shortlist must NOT contain Manila Hotel
  assert.equal(app.$("shortlistBadge").textContent, "1");
  app.$("openShortlistBtn").click();
  await tick();
  const items = app.$("shortlistItemsList").querySelectorAll(".shortlist-item");
  assert.equal(items.length, 1);
  assert.ok(items[0].textContent.includes("The Manor Baguio"));
  assert.ok(!items[0].textContent.includes("Manila Hotel"));

  app.dom.window.close();
});

test("Authoritative empty state reconciliation clears stale local cache", async () => {
  const staleItems = [
    { itemId: "stale-1", tripId: "trip-authoritative", name: "Old Pinned Hotel", itemType: "stay", savedBy: "Glen" },
  ];

  const app = await setup({
    initial: {
      saantayo_partner_identity_v1: "Glen",
      saantayo_trips_v2: JSON.stringify({
        version: 2,
        trips: [
          {
            id: "trip-authoritative",
            destination: "Davao",
            trip: { destination: "Davao", mode: "itinerary", days: 2, people: 2 },
            result: { parts: [{ text: "Davao Itinerary" }], sources: [], createdAt: "2026-08-31", expiresAt: "2099-01-01T00:00:00Z" },
            savedItems: staleItems,
          },
        ],
      }),
    },
    url: "https://app.example/?trip=trip-authoritative",
    sheetsHandler: (reqUrl, options, { action }) => {
      if (action === "get_items") {
        return Response.json({
          status: "success",
          tripId: "trip-authoritative",
          items: [],
        });
      }
      return Response.json({ status: "success" });
    },
  });

  await tick();
  await tick();

  assert.equal(app.$("shortlistBadge").textContent, "0");
  app.$("openShortlistBtn").click();
  await tick();
  assert.equal(app.$("shortlistItemsList").querySelectorAll(".shortlist-item").length, 0);

  // Local storage for that trip is also emptied
  const localTripsData = JSON.parse(app.dom.window.localStorage.getItem("saantayo_trips_v2"));
  assert.deepEqual(localTripsData.trips[0].savedItems, []);

  app.dom.window.close();
});

test("Offline shared-trip cache persists descriptors across restarts", async () => {
  const cachedDescriptors = [
    {
      tripId: "offline-trip-1",
      destination: "Batanes",
      startDate: "2026-11-01",
      endDate: "2026-11-05",
      createdAt: "2026-08-31T10:00:00Z",
      itemCount: 3,
      hasTripData: true,
    },
  ];

  const app = await setup({
    initial: {
      saantayo_partner_identity_v1: "Anne",
      saantayo_shared_trips_v1: JSON.stringify(cachedDescriptors),
    },
    sheetsHandler: () => {
      throw new Error("Network offline / 500");
    },
  });

  await tick();
  await tick();

  // Open Shared Trips modal while offline
  app.dom.window.document.querySelector('[data-dialog="savedTripsModal"]').click();
  await tick();

  const rows = app.$("savedTripsList").querySelectorAll(".shared-trip-row");
  assert.equal(rows.length, 1);
  assert.ok(rows[0].textContent.includes("Batanes"));
  assert.ok(rows[0].textContent.includes("3 items"));

  app.dom.window.close();
});

test("Authoritative empty Shared Trips snapshot overrides stale local trips and persists across restarts", async () => {
  const staleLocalTrips = {
    version: 2,
    trips: [
      {
        id: "trip-stale-a",
        destination: "Stale Manila",
        trip: { destination: "Stale Manila", mode: "itinerary", days: 2, people: 2 },
        result: { parts: [{ text: "Manila" }], sources: [], createdAt: "2026-08-31", expiresAt: "2099-01-01T00:00:00Z" },
        savedItems: [],
      },
      {
        id: "trip-stale-b",
        destination: "Stale Baguio",
        trip: { destination: "Stale Baguio", mode: "itinerary", days: 2, people: 2 },
        result: { parts: [{ text: "Baguio" }], sources: [], createdAt: "2026-08-31", expiresAt: "2099-01-01T00:00:00Z" },
        savedItems: [],
      },
    ],
  };

  // Run 1: Local device has stale trips A & B, but Sheets authoritative list_trips returns []
  const app1 = await setup({
    initial: {
      saantayo_partner_identity_v1: "Glen",
      saantayo_trips_v2: JSON.stringify(staleLocalTrips),
    },
    sheetsHandler: (reqUrl, options, { action }) => {
      if (action === "list_trips") {
        return Response.json({ status: "success", trips: [] });
      }
      return Response.json({ status: "success" });
    },
  });

  await tick();
  await tick();
  await tick();
  await tick();

  // Shared trips badge must be 0
  assert.equal(app1.$("savedCountBadge").textContent, "0");

  // Open modal: must NOT render stale Trip A or Trip B
  app1.dom.window.document.querySelector('[data-dialog="savedTripsModal"]').click();
  await tick();
  await tick();

  const rows1 = app1.$("savedTripsList").querySelectorAll(".shared-trip-row");
  assert.equal(rows1.length, 0);
  assert.ok(app1.$("savedTripsList").textContent.includes("No shared trips yet"));
  assert.ok(!app1.$("savedTripsList").textContent.includes("Stale Manila"));
  assert.ok(!app1.$("savedTripsList").textContent.includes("Stale Baguio"));

  const storageAfterRun1 = {
    saantayo_partner_identity_v1: app1.dom.window.localStorage.getItem("saantayo_partner_identity_v1"),
    saantayo_trips_v2: app1.dom.window.localStorage.getItem("saantayo_trips_v2"),
    saantayo_shared_trips_v1: app1.dom.window.localStorage.getItem("saantayo_shared_trips_v1"),
  };
  app1.dom.window.close();

  // Run 2: Reload with backend offline / network failure
  const app2 = await setup({
    initial: storageAfterRun1,
    sheetsHandler: () => {
      throw new Error("Network offline / 500");
    },
  });

  await tick();
  await tick();
  await tick();
  await tick();

  // Cached authoritative [] must NOT resurrect stale local trips
  assert.equal(app2.$("savedCountBadge").textContent, "0");
  app2.dom.window.document.querySelector('[data-dialog="savedTripsModal"]').click();
  await tick();
  await tick();

  const rows2 = app2.$("savedTripsList").querySelectorAll(".shared-trip-row");
  assert.equal(rows2.length, 0);
  assert.ok(app2.$("savedTripsList").textContent.includes("No shared trips yet"));
  assert.ok(!app2.$("savedTripsList").textContent.includes("Stale Manila"));
  assert.ok(!app2.$("savedTripsList").textContent.includes("Stale Baguio"));

  app2.dom.window.close();
});

test("Compatibility regression — current.savedItems contains all types while current.stays contains stays only", async () => {
  const mixedItems = [
    { itemId: "item-stay", tripId: "mixed-trip-1", itemType: "stay", name: "Crimson Resort", price: "₱8,000", savedBy: "Glen" },
    { itemId: "item-food", tripId: "mixed-trip-1", itemType: "food", name: "Lantaw Restaurant", price: "₱600", savedBy: "Anne" },
    { itemId: "item-act", tripId: "mixed-trip-1", itemType: "activity", name: "Island Hopping Tour", price: "₱1,500", savedBy: "Glen" },
    { itemId: "item-trans", tripId: "mixed-trip-1", itemType: "transport", name: "Cebu Airport Taxi", price: "₱400", savedBy: "Anne" },
  ];

  const app = await setup({
    initial: {
      saantayo_partner_identity_v1: "Glen",
      saantayo_trips_v2: JSON.stringify({
        version: 2,
        trips: [
          {
            id: "mixed-trip-1",
            destination: "Cebu",
            trip: { destination: "Cebu", mode: "itinerary", days: 3, people: 2 },
            result: { parts: [{ text: "Cebu Trip" }], sources: [], createdAt: "2026-08-31", expiresAt: "2099-01-01T00:00:00Z" },
            savedItems: mixedItems,
          },
        ],
      }),
    },
    url: "https://app.example/?trip=mixed-trip-1",
    sheetsHandler: (reqUrl, options, { action }) => {
      if (action === "get_items") {
        return Response.json({
          status: "success",
          tripId: "mixed-trip-1",
          items: mixedItems,
        });
      }
      return Response.json({ status: "success" });
    },
  });

  await tick();
  await tick();

  // Shortlist UI displays all 4 items
  assert.equal(app.$("shortlistBadge").textContent, "4");

  // Verify persisted trip in localStorage has universal savedItems (4 items) and stay-only stays (1 item)
  const localData = JSON.parse(app.dom.window.localStorage.getItem("saantayo_trips_v2"));
  const persistedTrip = localData.trips.find((t) => t.id === "mixed-trip-1");
  assert.ok(persistedTrip);
  assert.equal(persistedTrip.savedItems.length, 4);
  assert.equal(persistedTrip.stays.length, 1);
  assert.equal(persistedTrip.stays[0].name, "Crimson Resort");
  assert.equal(persistedTrip.stays[0].itemType, "stay");

  app.dom.window.close();
});

test("Global Shared Shortlist — Multi-trip items, partner filtering (All / Glen / Anne), and global badge count", async () => {
  const remoteItems = [
    {
      itemId: "stay-glen-1",
      tripId: "trip-cebu",
      itemType: "stay",
      name: "Radisson Blu Cebu",
      location: "Cebu City",
      category: "Hotel",
      price: "₱5,500/night",
      savedBy: "Glen",
      detailsJSON: JSON.stringify({ description: "Near SM City" }),
    },
    {
      itemId: "food-anne-1",
      tripId: "trip-siargao",
      itemType: "food",
      name: "Shaka Cafe",
      location: "General Luna",
      category: "Restaurant",
      price: "₱350",
      savedBy: "Anne",
      detailsJSON: JSON.stringify({ mustTryDish: "Bom Dia Bowl" }),
    },
    {
      itemId: "activity-glen-2",
      tripId: "trip-siargao",
      itemType: "activity",
      name: "Cloud 9 Surfing",
      location: "Siargao",
      category: "Activity",
      price: "₱1,000",
      savedBy: "Glen",
      detailsJSON: JSON.stringify({ bestFor: "Intermediate Surfers" }),
    },
  ];

  const app = await setup({
    initial: {
      saantayo_partner_identity_v1: "Glen",
    },
    sheetsHandler: (reqUrl, options, { action }) => {
      if (action === "get_all_items") {
        return Response.json({ status: "success", items: remoteItems });
      }
      return Response.json({ status: "success", items: remoteItems });
    },
  });

  await tick();
  await tick();

  // Shortlist badge shows 3 (global count across all trips)
  assert.equal(app.$("shortlistBadge").textContent, "3");

  // Open shortlist drawer
  app.$("openShortlistBtn").click();
  await tick();

  // By default, 'all' filter is active
  let displayed = app
    .$("shortlistItemsList")
    .querySelectorAll(".shortlist-item");
  assert.equal(displayed.length, 3);

  // Click existing 'Glen' partner filter button
  const glenBtn = app
    .$("shortlistPartnerFilter")
    .querySelector('[data-partner-filter="Glen"]');
  assert.ok(glenBtn);
  glenBtn.click();
  await tick();

  displayed = app.$("shortlistItemsList").querySelectorAll(".shortlist-item");
  assert.equal(displayed.length, 2);
  const glenTexts = [...displayed].map((d) => d.textContent);
  assert.ok(glenTexts.some((t) => t.includes("Radisson Blu Cebu")));
  assert.ok(glenTexts.some((t) => t.includes("Cloud 9 Surfing")));
  assert.ok(!glenTexts.some((t) => t.includes("Shaka Cafe")));

  // Click existing 'Anne' partner filter button
  const anneBtn = app
    .$("shortlistPartnerFilter")
    .querySelector('[data-partner-filter="Anne"]');
  assert.ok(anneBtn);
  anneBtn.click();
  await tick();

  displayed = app.$("shortlistItemsList").querySelectorAll(".shortlist-item");
  assert.equal(displayed.length, 1);
  assert.ok(displayed[0].textContent.includes("Shaka Cafe"));
  assert.ok(displayed[0].textContent.includes("Saved by Anne"));

  // Click existing 'All' partner filter button again
  const allBtn = app
    .$("shortlistPartnerFilter")
    .querySelector('[data-partner-filter="all"]');
  assert.ok(allBtn);
  allBtn.click();
  await tick();

  displayed = app.$("shortlistItemsList").querySelectorAll(".shortlist-item");
  assert.equal(displayed.length, 3);

  app.dom.window.close();
});

test("Global Shared Shortlist — Cross-trip deletion sends target item's own TripID", async () => {
  let deletedItemPayload = null;
  let itemsInStore = [
    {
      itemId: "item-trip-a",
      tripId: "trip-a",
      itemType: "stay",
      name: "Cebu Waterfront",
      location: "Cebu",
      savedBy: "Glen",
    },
    {
      itemId: "item-trip-b",
      tripId: "trip-b",
      itemType: "food",
      name: "Siargao Spot",
      location: "Siargao",
      savedBy: "Anne",
    },
  ];

  const app = await setup({
    url: "https://saantayo.app/?trip=trip-a",
    initial: {
      saantayo_partner_identity_v1: "Glen",
    },
    sheetsHandler: (reqUrl, options, { action, bodyObj }) => {
      if (action === "get_all_items") {
        return Response.json({ status: "success", items: itemsInStore });
      }
      if (action === "get_trip") {
        return Response.json({
          status: "success",
          destination: "Cebu City",
          tripDataJSON: JSON.stringify({
            id: "trip-a",
            destination: "Cebu City",
            result: normalizeInteraction(interaction()),
            trip: {
              mode: "itinerary",
              destination: "Cebu City",
              days: 3,
              people: 2,
              vibes: ["Beach", "Foodie"],
              stayType: "all",
            },
          }),
        });
      }
      if (action === "delete_item") {
        deletedItemPayload = bodyObj;
        itemsInStore = itemsInStore.filter((i) => i.itemId !== bodyObj.itemId);
        return Response.json({ status: "success", items: itemsInStore });
      }
      return Response.json({ status: "success", items: itemsInStore });
    },
  });

  await tick();
  await tick();
  await tick();

  // Active trip is trip-a
  app.$("openShortlistBtn").click();
  await tick();

  const displayed = app
    .$("shortlistItemsList")
    .querySelectorAll(".shortlist-item");
  assert.equal(displayed.length, 2);

  // Delete Anne's item (which belongs to trip-b)
  const delBtns = app
    .$("shortlistItemsList")
    .querySelectorAll(".shortlist-delete-btn");
  assert.equal(delBtns.length, 2);
  delBtns[1].click(); // Deletes item-trip-b
  await tick();
  await tick();

  assert.ok(deletedItemPayload);
  assert.equal(deletedItemPayload.itemId, "item-trip-b");
  assert.equal(deletedItemPayload.tripId, "trip-b"); // MUST be trip-b, NOT trip-a!

  app.dom.window.close();
});

test("Global Shared Shortlist — Active partner identity stamps savedBy on new saves", async () => {
  let savedPayload = null;
  const itemsInStore = [];

  const app = await setup({
    initial: {
      saantayo_partner_identity_v1: "Anne",
    },
    sheetsHandler: (reqUrl, options, { action, bodyObj }) => {
      if (action === "get_all_items") {
        return Response.json({ status: "success", items: itemsInStore });
      }
      if (action === "save_item") {
        savedPayload = bodyObj;
        itemsInStore.unshift(bodyObj);
        return Response.json({ status: "success", items: itemsInStore });
      }
      return Response.json({ status: "success", items: itemsInStore });
    },
  });

  await tick();
  await app.generate();
  await tick();

  // Pin a stay while identity is Anne
  const stayPinBtns = (
    app.$("aiStaysGrid") || app.$("providerLinksGrid")
  ).querySelectorAll(".pin-btn");
  assert.ok(stayPinBtns.length > 0);
  stayPinBtns[0].click();
  await tick();
  await tick();

  assert.ok(savedPayload);
  assert.equal(savedPayload.savedBy, "Anne");

  app.dom.window.close();
});

test("Global Shared Shortlist — Offline fallback preserves cached global shortlist without overwriting", async () => {
  const cachedItems = [
    {
      itemId: "cached-item-1",
      tripId: "trip-coron",
      itemType: "stay",
      name: "Coron Underground Resort",
      location: "Coron",
      savedBy: "Glen",
    },
    {
      itemId: "cached-item-2",
      tripId: "trip-el-nido",
      itemType: "food",
      name: "Artcafe El Nido",
      location: "El Nido",
      savedBy: "Anne",
    },
  ];

  const app = await setup({
    initial: {
      saantayo_partner_identity_v1: "Glen",
      saantayo_global_shortlist: JSON.stringify(cachedItems),
    },
    sheetsHandler: () => {
      throw new Error("Network offline / 500 Sheets Outage");
    },
  });

  await tick();

  // Trigger shortlist drawer open
  app.$("openShortlistBtn").click();
  await tick();

  const displayed = app
    .$("shortlistItemsList")
    .querySelectorAll(".shortlist-item");
  assert.equal(displayed.length, 2);
  app.dom.window.close();
});

test("Global Shared Shortlist — Global delete fails closed when TripID is missing", async () => {
  let deleteCalled = false;
  const itemsInStore = [
    {
      itemId: "orphan-item-1",
      tripId: "", // Deliberately missing tripId
      itemType: "stay",
      name: "Orphaned Mystery Stay",
      location: "Unknown",
      savedBy: "Glen",
    },
  ];

  const app = await setup({
    url: "https://saantayo.app/?trip=active-workspace-trip-id",
    initial: {
      saantayo_partner_identity_v1: "Glen",
    },
    sheetsHandler: (reqUrl, options, { action }) => {
      if (action === "get_all_items") {
        return Response.json({ status: "success", items: itemsInStore });
      }
      if (action === "delete_item") {
        deleteCalled = true;
        return Response.json({ status: "success", items: [] });
      }
      return Response.json({ status: "success", items: itemsInStore });
    },
  });

  await tick();
  await tick();

  app.$("openShortlistBtn").click();
  await tick();

  const displayedBefore = app
    .$("shortlistItemsList")
    .querySelectorAll(".shortlist-item");
  assert.equal(displayedBefore.length, 1);

  // Attempt to delete the orphan item
  const delBtn = app
    .$("shortlistItemsList")
    .querySelector(".shortlist-delete-btn");
  assert.ok(delBtn);
  delBtn.click();
  await tick();
  await tick();

  // Fail-closed verification:
  // 1. Google Sheets delete_item must NOT have been called
  assert.equal(deleteCalled, false);

  // 2. Shortlist must remain unchanged (item not deleted)
  const displayedAfter = app
    .$("shortlistItemsList")
    .querySelectorAll(".shortlist-item");
  assert.equal(displayedAfter.length, 1);

  // 3. Error toast informing user of missing trip reference must be shown
  assert.ok(
    app.$("toastMessage").textContent.includes("missing trip reference"),
  );

  app.dom.window.close();
});
