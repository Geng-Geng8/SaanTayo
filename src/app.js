import {
  VIBES,
  STAY_TYPES,
  validateTrip,
  calculateBudget,
  safeUrl,
  buildAllProviderLinks,
  parseTransitLegs,
  buildTransitLinks,
  SHEETS_API_URL,
  cleanTripPayload,
  fetchSheetsApi,
  parseStayNameFromUrl,
  parseDining,
  buildMapsSearchLink,
  parseAccommodations,
  buildStaySearchLink,
  parseActivities,
  buildActivitySearchLink,
  canonicalizeSavedItem,
  normalizeSavedItems,
  PARTNERS,
  PARTNER_STORAGE_KEY,
  normalizePartnerIdentity,
} from "../shared/travel.js";
import {
  readTrips,
  writeTrips,
  saveTrip,
  expireHistory,
  exportEligible,
  importTripsData,
  getPartnerIdentity,
  setPartnerIdentity,
  readSharedTripsCache,
  writeSharedTripsCache,
} from "./storage.js";
import {
  el,
  link,
  renderAnswer,
  renderProviderCard,
  renderShortlistItem,
  renderSharedTripRow,
  renderTransitCard,
  renderTransitLinkButton,
  renderDiningCard,
  renderActivityCard,
  renderStayCard,
} from "./render.js";

const $ = (id) =>
  typeof document !== "undefined" ? document.getElementById(id) : null;
const API_BASE = __API_BASE__;
let mode = "itinerary",
  selectedVibes = [VIBES[0], VIBES[2]],
  activeStayFilter = "all",
  activePartnerFilter = "all",
  sharedTrips = [],
  hasSharedSnapshot = false,
  isLoadingSharedTrips = false,
  inFlightRefreshes = new Set(),
  lastAutoRefresh = 0,
  current = null,
  globalSavedItems = [],
  savedItems = globalSavedItems,
  pinnedStays = savedItems,
  controller = null,
  fx = null,
  toastTimer,
  ready = false;
const asNumber = (id) => ($(id).value === "" ? null : Number($(id).value));
function toast(message) {
  $("toastMessage").textContent = message;
  $("toast").classList.remove("opacity-0", "pointer-events-none");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => $("toast").classList.add("opacity-0", "pointer-events-none"),
    4500,
  );
}
function error(message) {
  $("errorMessage").textContent = message;
  $("errorMessage").classList.remove("hidden");
}
function storageError(e) {
  $("storageWarning").textContent =
    e.message || "Device storage is unavailable.";
  $("storageWarning").classList.remove("hidden");
}
function readAll() {
  try {
    return readTrips(localStorage);
  } catch (e) {
    storageError(e);
    return [];
  }
}
function badge() {
  let count = 0;
  if (hasSharedSnapshot) {
    count = sharedTrips.length;
  } else {
    count = readAll().length;
  }
  const badgeEl = $("savedCountBadge");
  if (badgeEl) badgeEl.textContent = String(count);
}
function setBusy(busy, message = "Researching your trip…") {
  $("loadingStatus").classList.toggle("hidden", !busy);
  $("cancelRequest").classList.toggle("hidden", !busy);
  $("loadingMessage").textContent = message;
  for (const id of ["generateBtn", "sendChat", "calculateBudget"])
    $(id).disabled = busy || !navigator.onLine;
  for (const button of document.querySelectorAll(
    "[data-mode], [data-load], [data-delete]",
  ))
    button.disabled = busy;
  $("planner").setAttribute("aria-busy", String(busy));
  $("chatStatus").textContent = busy
    ? message
    : $("errorMessage").classList.contains("hidden")
      ? ""
      : $("errorMessage").textContent;
}
async function request(path, body, signal) {
  if (!navigator.onLine)
    throw new Error(
      "You are offline. Open a saved plan or use the checklist; live research needs internet.",
    );
  let response;
  try {
    response = await fetch(`${API_BASE}/api/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (signal.aborted)
      throw new Error(
        "Request cancelled. Google may still charge for work already started.",
      );
    throw new Error(
      "Cannot reach the backend. Check your connection and try again.",
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    const e = new Error(
      data?.error?.message ||
        "The backend returned an invalid response. Your saved plans are unchanged.",
    );
    e.code = data?.error?.code;
    throw e;
  }
  return data;
}
async function action(task, message) {
  if (controller) return;
  controller = new AbortController();
  const active = controller;
  const timeout = setTimeout(() => active.abort(), 100000);
  $("errorMessage").classList.add("hidden");
  setBusy(true, message);
  try {
    await task(active.signal);
  } catch (e) {
    error(e.message);
  } finally {
    clearTimeout(timeout);
    controller = null;
    setBusy(false);
  }
}
function formTrip() {
  return validateTrip({
    mode,
    destination: $("destination").value,
    destinationB: $("destinationB").value,
    origin: $("arrivalBase").value,
    start: $("startDate").value,
    end: $("endDate").value,
    days: Number($("tripDays").value),
    people: Number($("people").value),
    party: document.querySelector('input[name="party"]:checked').value,
    stayType: $("stayType").value,
    vibes: selectedVibes,
    currency: $("currencyPref").value,
    free: $("freeSightseeing").checked,
    strict: $("strictBudget").value === "strict",
    question: $("question").value,
    budgets: {
      total: asNumber("budgetTotal"),
      hotel: asNumber("budgetHotel"),
      transit: asNumber("budgetTransit"),
      activities: asNumber("budgetExcursion"),
    },
  });
}
function setMode(value) {
  mode = value;
  for (const b of document.querySelectorAll("[data-mode]")) {
    b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
    b.classList.toggle("selected-mode", b.dataset.mode === mode);
    b.classList.remove("bg-cyan-500", "text-slate-950");
  }
  $("secondDestination").classList.toggle("hidden", mode !== "compare");
  $("destinationB").required = mode === "compare";
  $("researchQuestion").classList.toggle("hidden", mode !== "research");
  $("question").required = mode === "research";
  $("generateBtn").lastElementChild.textContent =
    mode === "compare"
      ? "Compare destinations"
      : mode === "research"
        ? "Research this question"
        : "Generate & Research Plan";
}
function syncVibes() {
  for (const b of document.querySelectorAll("[data-vibe]"))
    b.setAttribute(
      "aria-pressed",
      String(selectedVibes.includes(b.dataset.vibe)),
    );
}
function safeResult(result) {
  if (
    !result ||
    !Array.isArray(result.parts) ||
    !result.parts.length ||
    result.parts.some((p) => typeof p.text !== "string") ||
    !Array.isArray(result.sources)
  )
    throw new Error(
      "The backend returned an incomplete answer. Please try again.",
    );
  return result;
}
function planText() {
  return (
    current?.result?.parts.map((p) => p.text).join("\n\n") ||
    current?.content ||
    ""
  );
}
function context() {
  const recent = (current.chat || [])
    .slice(-6)
    .map(
      (m) =>
        `${m.role}: ${m.text || m.result?.parts.map((p) => p.text).join("\n") || "[expired answer]"}`,
    )
    .join("\n");
  const sources = (current.result?.sources || [])
    .map((s) => `${s.title}: ${s.url}`)
    .join("\n");
  const text = `Saved itinerary:\n${planText()}\nPreviously retrieved sources (not necessarily current):\n${sources}\nRecent conversation:\n${recent}`;
  if (text.length > 100000)
    throw new Error(
      "This saved conversation is too large to reconnect. Start a shorter new research plan.",
    );
  return text;
}
function legacyDetails() {
  return validateTrip({
    destination: current.destination,
    days: 3,
    people: 2,
    vibes: [],
    budgets: {},
    origin:
      "Legacy plan: party size and dates unknown; ask the traveller before assuming them.",
  });
}
function showCurrent() {
  $("resultsContainer").classList.remove("hidden");
  $("resultMetaBadge").textContent = current.destination;
  $("renderedMarkdown").replaceChildren(
    renderAnswer(current.result, current.content),
  );
  const date = current.result?.createdAt || current.createdAt;
  $("planTimestamp").textContent =
    `${current.legacy ? "Older saved plan · dates and prices may be stale" : "Researched " + new Date(date).toLocaleDateString()}${current.result?.expiresAt ? " · Saved answer available until " + new Date(current.result.expiresAt).toLocaleDateString() : ""}`;
  $("travelNotes").value = current.notes || "";
  $("chatStatus").textContent = "";
  $("sharePlan").disabled = !!current.result?.hasMaps || current.expired;
  $("sharePlan").title = current.result?.hasMaps
    ? "Google Maps answers stay in your personal history; share your own notes separately."
    : "Share complete plan";
  $("budgetSection").classList.toggle(
    "hidden",
    current.legacy || current.expired || current.trip?.mode !== "itinerary",
  );
  $("transitSection").classList.toggle(
    "hidden",
    current.legacy || current.expired || current.trip?.mode !== "itinerary",
  );
  renderTransit();
  $("diningSection").classList.toggle(
    "hidden",
    current.legacy || current.expired || current.trip?.mode !== "itinerary",
  );
  renderDining();
  $("activitiesSection").classList.toggle(
    "hidden",
    current.legacy || current.expired || current.trip?.mode !== "itinerary",
  );
  renderActivities();
  activeStayFilter = current.trip?.stayType || "all";
  $("accommodationSection").classList.toggle(
    "hidden",
    current.legacy || current.expired || current.trip?.mode !== "itinerary",
  );
  renderAccommodations();
  $("chatSection").classList.toggle("hidden", !!current.expired);
  renderChat();
  renderBudget();
}
function renderChat() {
  const container = $("chatMessages");
  container.replaceChildren();
  if (!current.chat?.length)
    container.append(
      el(
        "p",
        "Ask about this plan. Auto mode can research fresh information; “This plan only” uses no live tools.",
        "muted",
      ),
    );
  for (const message of current.chat || []) {
    const bubble = el(
      "div",
      null,
      `chat-message ${message.role === "user" ? "chat-bubble-user" : "chat-bubble-model"}`,
    );
    if (message.role === "user") bubble.textContent = message.text;
    else
      bubble.append(
        renderAnswer(
          message.result,
          message.expired ? "This sourced answer has expired." : "",
        ),
      );
    container.append(bubble);
  }
  container.scrollTop = container.scrollHeight;
}
function currency(value) {
  const php =
    "₱" +
    value.toLocaleString("en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  return (
    php +
    (current?.trip?.currency !== "PHP" && fx
      ? " ≈ C$" +
        (value * fx.rate).toLocaleString("en-CA", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : "")
  );
}
function renderTransit() {
  if (!current?.trip) return;
  const rawText = planText();
  const legs = parseTransitLegs(rawText, {
    origin: current.trip.origin || "Arrival Base",
    destination: current.trip.destination,
  });

  const grid = $("transitCardsGrid");
  grid.replaceChildren();
  for (const leg of legs) {
    const isPinned = savedItems.some(
      (s) =>
        s.itemType === "transport" &&
        s.name?.toLowerCase() === (leg.route || "").toLowerCase(),
    );
    grid.append(renderTransitCard(leg, { onPin: pinTransit, isPinned }));
  }

  const links = buildTransitLinks(
    current.trip.origin,
    current.trip.destination,
  );
  const linksRow = $("transitLinksRow");
  linksRow.replaceChildren();
  for (const item of links) {
    linksRow.append(renderTransitLinkButton(item));
  }
}
function renderDining() {
  if (!current?.trip) return;
  const rawText = planText();
  const spots = parseDining(rawText, {
    destination: current.trip.destination || current.destination,
  });

  const grid = $("diningCardsGrid");
  grid.replaceChildren();
  for (const spot of spots) {
    const isPinned = savedItems.some(
      (s) =>
        s.itemType === "food" &&
        s.name?.toLowerCase() ===
          (spot.spotName || spot.name || "").toLowerCase(),
    );
    grid.append(renderDiningCard(spot, { onPin: pinDining, isPinned }));
  }
}
function renderActivities() {
  if (!current?.trip) return;
  const rawText = planText();
  const activities = parseActivities(rawText, {
    destination: current.trip.destination || current.destination,
  });

  const grid = $("activitiesCardsGrid");
  if (!grid) return;
  grid.replaceChildren();
  for (const act of activities) {
    const isPinned = savedItems.some(
      (s) =>
        s.itemType === "activity" &&
        s.name?.toLowerCase() === (act.name || "").toLowerCase(),
    );
    grid.append(renderActivityCard(act, { onPin: pinActivity, isPinned }));
  }
}
function renderAccommodations() {
  if (!current?.trip) return;
  const trip = current.trip;
  const stayTypeObj =
    STAY_TYPES.find((s) => s.id === activeStayFilter) || STAY_TYPES[0];

  $("activeStayBadge").textContent = stayTypeObj.label;
  for (const b of document.querySelectorAll("[data-stay-filter]")) {
    const isSelected = b.dataset.stayFilter === activeStayFilter;
    b.setAttribute("aria-selected", String(isSelected));
    b.classList.toggle("bg-cyan-500", isSelected);
    b.classList.toggle("text-slate-950", isSelected);
    b.classList.toggle("text-slate-400", !isSelected);
  }

  const rawText = planText();
  const allStays = parseAccommodations(rawText, {
    destination: trip.destination || current.destination,
  });

  let filteredStays = allStays;
  if (activeStayFilter === "hotel") {
    filteredStays = allStays.filter((s) => s.type?.toLowerCase() === "hotel");
  } else if (activeStayFilter === "rental") {
    filteredStays = allStays.filter((s) => s.type?.toLowerCase() === "rental");
  } else if (activeStayFilter === "resort_hostel") {
    filteredStays = allStays.filter((s) =>
      ["resort", "hostel"].includes(s.type?.toLowerCase()),
    );
  }

  if (!filteredStays.length) filteredStays = allStays;

  const grid = $("aiStaysGrid") || $("providerLinksGrid");
  if (grid) {
    grid.replaceChildren();
    for (const item of filteredStays) {
      const isPinned = savedItems.some(
        (s) =>
          s.itemType === "stay" &&
          (s.name || s.hotelName)?.toLowerCase() ===
            (item.stayName || item.name)?.toLowerCase(),
      );
      grid.append(renderStayCard(item, { onPin: pinStay, isPinned }));
    }
  }

  const stayCount = $("stayCountLabel");
  if (stayCount) {
    stayCount.textContent = `${filteredStays.length} curated ${filteredStays.length === 1 ? "option" : "options"}`;
  }

  const dateStr =
    trip.start && trip.end
      ? ` · ${trip.start} to ${trip.end}`
      : ` · ${trip.days} days flexible`;
  const guestStr = `${trip.people} ${trip.people === 1 ? "traveller" : "travellers"}`;
  $("stayFilterSummary").textContent =
    `Viewing ${stayTypeObj.label.toLowerCase()} in ${trip.destination} for ${guestStr}${dateStr}.`;
}
function renderBudget() {
  const box = $("budgetOutput");
  box.replaceChildren();
  if (!current?.costs || !current.trip) return;
  let budget;
  try {
    budget = calculateBudget(current.costs, current.trip);
  } catch (e) {
    box.append(el("p", e.message, "notice warning"));
    return;
  }
  box.append(
    el(
      "h3",
      budget.missing.length
        ? "Known-cost subtotal · incomplete"
        : "Estimated trip total",
    ),
    el("p", currency(budget.totalPHP), "budget-total"),
  );
  box.append(
    el(
      "p",
      `${currency(budget.perPersonPHP)} / person · ${currency(budget.perDayPHP)} / day`,
      "muted",
    ),
  );
  if (budget.remainingPHP != null)
    box.append(
      el(
        "p",
        `${budget.remainingPHP >= 0 ? "Remaining against cap" : "Over cap"}: ${currency(Math.abs(budget.remainingPHP))}${budget.missing.length ? " (before missing costs)" : ""}`,
        budget.remainingPHP < 0 ? "warning" : "",
      ),
    );
  for (const [category, value] of Object.entries(budget.categories)) {
    const row = el("div", null, "budget-row");
    row.append(
      el("span", category.replaceAll("_", " ")),
      el("strong", currency(value)),
    );
    box.append(row);
  }
  const detail = el("details");
  detail.append(el("summary", "Cost rows and assumptions"));
  for (const item of budget.items)
    detail.append(
      el(
        "p",
        `${item.label}: ₱${item.unitPHP} × ${item.units} (${item.basis.replaceAll("_", " ")}) = ${currency(item.totalPHP)}`,
      ),
    );
  for (const assumption of budget.assumptions)
    detail.append(el("p", assumption, "muted"));
  box.append(detail);
  if (budget.missing.length)
    box.append(
      el(
        "p",
        "Not fully priced: " +
          budget.missing.map((c) => c.replaceAll("_", " ")).join(", ") +
          ". Do not treat this subtotal as the full trip cost.",
        "notice warning",
      ),
    );
  if (budget.exceeded.length)
    box.append(
      el(
        "p",
        "Above your " +
          budget.exceeded.join(", ") +
          ". Ask for cheaper alternatives before booking.",
        "notice warning",
      ),
    );
  if (current.trip.currency !== "PHP") {
    box.append(
      el(
        "p",
        fx
          ? `Reference FX: 1 PHP = ${fx.rate} CAD · rate date ${fx.date}${fx.stale ? " · cached/stale" : ""}. Bank fees/spreads not included.`
          : "CAD unavailable: no recent reference rate. PHP totals are unchanged.",
        "muted",
      ),
    );
    if (fx)
      box.append(link("FX source · Frankfurter", "https://frankfurter.dev/"));
  }
  box.append(
    el(
      "p",
      "Estimates, not quotes. Reconfirm prices and availability. After itinerary changes, recalculate using a new plan.",
      "muted",
    ),
  );
}
async function refreshFx() {
  try {
    const cached = JSON.parse(localStorage.getItem("saantayo_fx") || "null");
    if (
      cached &&
      Date.now() - Date.parse(cached.date) < 10 * 86400000 &&
      Number.isFinite(cached.rate) &&
      cached.rate > 0
    )
      fx = { ...cached, stale: true };
  } catch {}
  try {
    const response = await fetch(`${API_BASE}/api/fx`, {
      signal: AbortSignal.timeout(8000),
    });
    const data = await response.json();
    if (
      !response.ok ||
      data.base !== "PHP" ||
      data.quote !== "CAD" ||
      !Number.isFinite(data.rate)
    )
      throw new Error();
    fx = data;
    try {
      localStorage.setItem("saantayo_fx", JSON.stringify(data));
    } catch {}
  } catch {}
  renderBudget();
}
function readGlobalShortlistCache() {
  try {
    const raw = localStorage.getItem("saantayo_global_shortlist");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return normalizeSavedItems(parsed);
    }
  } catch {}
  return [];
}

function updateShortlistBadge(isLoading = false) {
  const badge = $("shortlistBadge");
  if (badge) {
    badge.textContent =
      isLoading && !globalSavedItems.length ? "…" : String(globalSavedItems.length);
  }
}

function syncGlobalSavedItems(items = []) {
  const tripId = current?.id || "";
  const partner = getPartnerIdentity(localStorage) || "Glen";
  globalSavedItems = normalizeSavedItems(items || [], tripId, partner);
  try {
    localStorage.setItem(
      "saantayo_global_shortlist",
      JSON.stringify(globalSavedItems),
    );
  } catch {}
  savedItems = globalSavedItems;
  pinnedStays = savedItems;
  if (current) {
    current.savedItems = globalSavedItems.filter((s) => !s.tripId || s.tripId === current.id);
    current.stays = current.savedItems.filter((s) => s.itemType === "stay");
  }
  badge();
  updateShortlistBadge();
}

function syncSavedItemsState(items = []) {
  const tripId = current?.id || "";
  const partner = getPartnerIdentity(localStorage) || "Glen";
  const normalized = normalizeSavedItems(items || [], tripId, partner);

  if (normalized.length && normalized.some((i) => i.tripId && tripId && i.tripId !== tripId)) {
    globalSavedItems = normalized;
  } else {
    const otherTripItems = globalSavedItems.filter(
      (i) => i.tripId && tripId && i.tripId !== tripId,
    );
    globalSavedItems = [...normalized, ...otherTripItems];
  }

  try {
    localStorage.setItem(
      "saantayo_global_shortlist",
      JSON.stringify(globalSavedItems),
    );
  } catch {}

  savedItems = globalSavedItems;
  pinnedStays = savedItems;
  if (current) {
    current.savedItems = globalSavedItems.filter(
      (s) => !s.tripId || s.tripId === current.id,
    );
    current.stays = current.savedItems.filter((s) => s.itemType === "stay");
  }
  badge();
  updateShortlistBadge();
}

function persistCurrent() {
  if (!current) return;
  current.notes = $("travelNotes").value;
  if (current.id) {
    current.savedItems = globalSavedItems.filter(
      (s) => !s.tripId || s.tripId === current.id,
    );
    current.stays = current.savedItems.filter((s) => s.itemType === "stay");
  }
  current.updatedAt = new Date().toISOString();
  try {
    saveTrip(localStorage, current);
    badge();
    toast("Saved on this device. Open once online before travelling offline.");
  } catch (e) {
    storageError(e);
  }
  saveCurrentToSheets();
}
async function saveCurrentToSheets() {
  if (!current) return;
  if (!current.id) current.id = crypto.randomUUID();
  const tripId = current.id;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("trip", tripId);
    window.history.replaceState({}, "", url.href);
  } catch {}

  const payload = {
    action: "save_trip",
    tripId,
    destination: current.destination || current.trip?.destination || "Philippines",
    startDate: current.trip?.start || "",
    endDate: current.trip?.end || "",
    tripDataJSON: cleanTripPayload(current),
  };

  try {
    await fetchSheetsApi(payload);
    const syncStatus = $("shortlistSyncStatus");
    if (syncStatus) syncStatus.textContent = "Google Sheets synced just now";
  } catch (err) {
    console.warn("Google Sheets save notice:", err);
  }
}

async function saveItem(rawItem) {
  const partner = getPartnerIdentity(localStorage);
  if (!partner) {
    const modal = $("partnerModal");
    if (modal && typeof modal.showModal === "function") {
      modal.showModal();
    }
    toast("Please select who's using this device first.");
    return;
  }
  if (!current) current = {};
  if (!current.id) current.id = crypto.randomUUID();
  const tripId = current.id;
  const canonical = canonicalizeSavedItem(
    {
      ...rawItem,
      tripId,
      itemId: rawItem.itemId || rawItem.stayId || crypto.randomUUID(),
      savedBy: rawItem.savedBy || partner,
    },
    tripId,
    partner,
  );

  // Optimistic local update in global collection
  const existingIdx = globalSavedItems.findIndex(
    (s) => s.itemId === canonical.itemId || s.stayId === canonical.itemId,
  );
  if (existingIdx >= 0) {
    globalSavedItems[existingIdx] = canonical;
  } else {
    globalSavedItems.unshift(canonical);
  }
  syncSavedItemsState(globalSavedItems);
  try {
    saveTrip(localStorage, current);
  } catch {}
  renderShortlist();
  renderAccommodations();
  renderDining();
  renderActivities();
  renderTransit();
  toast(`Saved "${canonical.name}" to Shortlist!`);

  try {
    const payload = {
      action: "save_item",
      itemId: canonical.itemId,
      stayId: canonical.itemId,
      tripId,
      itemType: canonical.itemType,
      name: canonical.name,
      hotelName: canonical.name,
      location: canonical.location,
      category: canonical.category,
      price: canonical.price,
      link: canonical.link,
      savedBy: canonical.savedBy,
      status: canonical.status,
      detailsJSON: JSON.stringify(canonical.details || {}),
    };

    const res = await fetchSheetsApi(payload);
    const remoteList = Array.isArray(res?.items)
      ? res.items
      : Array.isArray(res?.stays)
        ? res.stays
        : Array.isArray(res?.data)
          ? res.data
          : null;

    if (remoteList !== null) {
      syncGlobalSavedItems(remoteList);
      try {
        saveTrip(localStorage, current);
      } catch {}
      renderShortlist();
      renderAccommodations();
      renderDining();
      renderActivities();
      renderTransit();
    } else {
      await loadGlobalSavedItemsFromSheets({ silent: true });
    }
  } catch (err) {
    console.warn("Failed to save item to Google Sheets:", err);
    toast("Saved locally · will sync to Google Sheets when online.");
  }
}

async function deleteItem(itemId, itemTripId) {
  const found = globalSavedItems.find(
    (s) => s.itemId === itemId || s.stayId === itemId,
  );
  const tripId = itemTripId || found?.tripId || "";
  if (!tripId) {
    toast("Cannot delete item: missing trip reference.");
    return;
  }

  // Optimistic local update
  globalSavedItems = globalSavedItems.filter(
    (s) => s.itemId !== itemId && s.stayId !== itemId,
  );
  syncSavedItemsState(globalSavedItems);
  try {
    if (current) saveTrip(localStorage, current);
  } catch {}
  renderShortlist();
  renderAccommodations();
  renderDining();
  renderActivities();
  renderTransit();
  toast("Removed item from Shortlist.");

  try {
    const res = await fetchSheetsApi({
      action: "delete_item",
      itemId,
      stayId: itemId,
      tripId,
    });
    const remoteList = Array.isArray(res?.items)
      ? res.items
      : Array.isArray(res?.stays)
        ? res.stays
        : Array.isArray(res?.data)
          ? res.data
          : null;

    if (remoteList !== null) {
      syncGlobalSavedItems(remoteList);
      try {
        if (current) saveTrip(localStorage, current);
      } catch {}
      renderShortlist();
      renderAccommodations();
      renderDining();
      renderActivities();
      renderTransit();
    } else {
      await loadGlobalSavedItemsFromSheets({ silent: true });
    }
  } catch (err) {
    console.warn("Failed to delete item from Google Sheets:", err);
  }
}

async function pinStay(stay) {
  const hotelName = stay.stayName || stay.name || "Stay Option";
  const price = stay.estimatedPricePHP || stay.badge || "Live rates";
  const link =
    stay.searchUrl ||
    stay.url ||
    buildStaySearchLink(hotelName, stay.neighborhood || "");
  await saveItem({
    itemType: "stay",
    name: hotelName,
    location: stay.neighborhood || current?.trip?.destination || "",
    category: stay.type || "Hotel",
    price,
    link,
    details: { description: stay.description || "" },
  });
}

async function pinDining(spot) {
  const spotName = spot.spotName || spot.name || "Local Dining";
  const price = spot.estimatedCostPHP || "Check menu prices";
  const link =
    spot.mapsUrl ||
    buildMapsSearchLink(
      spotName,
      spot.location || current?.trip?.destination || "",
    );
  await saveItem({
    itemType: "food",
    name: spotName,
    location: spot.location || current?.trip?.destination || "",
    category: spot.category || "Restaurant",
    price,
    link,
    details: {
      mustTryDish: spot.mustTryDish || "",
      description: spot.description || "",
    },
  });
}

async function pinActivity(activity) {
  const name = activity.name || "Curated Activity";
  const price = activity.estimatedPrice || "Check prices";
  const link =
    activity.link ||
    buildActivitySearchLink(
      name,
      activity.location || current?.trip?.destination || "",
    );
  await saveItem({
    itemType: "activity",
    name,
    location: activity.location || current?.trip?.destination || "",
    category: activity.category || "Activity",
    price,
    link,
    details: {
      description: activity.description || "",
      duration: activity.duration || "",
      bestFor: activity.bestFor || "",
      bookingTip: activity.bookingTip || "",
    },
  });
}

async function pinTransit(leg) {
  const routeName =
    leg.route ||
    `${leg.origin || "Origin"} → ${leg.destination || "Destination"}`;
  const price = leg.estimatedFarePHP || "Check fare";
  const links = buildTransitLinks(
    leg.origin || current?.trip?.origin || "",
    leg.destination || current?.trip?.destination || "",
  );
  const link = links[0]?.url || "";
  await saveItem({
    itemType: "transport",
    name: routeName,
    location: `${leg.origin || ""} → ${leg.destination || ""}`.trim(),
    category: leg.mode || "Transit",
    price,
    link,
    details: {
      paymentMethod: leg.paymentMethod || "Cash only",
      localTip: leg.localTip || "",
    },
  });
}

const unpinStay = deleteItem;

function renderShortlist({ isLoading = false } = {}) {
  if (!globalSavedItems.length) {
    const cached = readGlobalShortlistCache();
    if (cached.length) {
      syncGlobalSavedItems(cached);
    }
  }

  updateShortlistBadge(isLoading);

  document.querySelectorAll("[data-partner-filter]").forEach((b) => {
    const isSelected =
      (b.dataset.partnerFilter || "").toLowerCase() ===
      activePartnerFilter.toLowerCase();
    b.classList.toggle("bg-cyan-500", isSelected);
    b.classList.toggle("text-slate-950", isSelected);
    b.classList.toggle("bg-slate-800", !isSelected);
    b.classList.toggle("text-slate-400", !isSelected);
  });

  const container = $("shortlistItemsList");
  if (!container) return;
  container.replaceChildren();

  if (isLoading && !globalSavedItems.length) {
    container.append(
      el(
        "p",
        "Loading saved items from Google Sheets…",
        "muted text-xs py-4 text-center animate-pulse",
      ),
    );
    return;
  }

  if (!globalSavedItems.length) {
    container.append(
      el(
        "p",
        "No saved items yet. Tap 📌 Pin / Save on any stay, food spot, activity, or transit route.",
        "muted text-xs py-4 text-center",
      ),
    );
    return;
  }

  const visibleItems =
    activePartnerFilter === "all"
      ? globalSavedItems
      : globalSavedItems.filter(
          (item) =>
            (item.savedBy || "Glen").toLowerCase() ===
            activePartnerFilter.toLowerCase(),
        );

  if (!visibleItems.length) {
    container.append(
      el(
        "p",
        `No saved items attributed to ${activePartnerFilter} yet.`,
        "muted text-xs py-4 text-center",
      ),
    );
    return;
  }

  for (const item of visibleItems) {
    container.append(renderShortlistItem(item, { onDelete: deleteItem }));
  }
}

async function loadGlobalSavedItemsFromSheets({ silent = false } = {}) {
  try {
    const statusEl = $("shortlistSyncStatus");
    if (statusEl && !silent) {
      statusEl.textContent = "Refreshing shared items…";
    }

    let res = null;
    try {
      res = await fetchSheetsApi(
        { action: "get_all_items" },
        { method: "GET" },
      );
    } catch {}

    if (
      !res ||
      (!Array.isArray(res) &&
        !Array.isArray(res?.items) &&
        !Array.isArray(res?.data) &&
        !Array.isArray(res?.stays))
    ) {
      if (current?.id) {
        try {
          res = await fetchSheetsApi(
            { action: "get_items", tripId: current.id },
            { method: "GET" },
          );
        } catch {}
      }
    }

    const rawList = Array.isArray(res)
      ? res
      : Array.isArray(res?.items)
        ? res.items
        : Array.isArray(res?.stays)
          ? res.stays
          : Array.isArray(res?.data)
            ? res.data
            : null;

    if (rawList !== null) {
      syncGlobalSavedItems(rawList);
      if (current) {
        try {
          saveTrip(localStorage, current);
        } catch {}
      }
      renderShortlist();
      renderAccommodations();
      renderDining();
      renderActivities();
      renderTransit();
      if (statusEl) statusEl.textContent = "Synced just now";
      return globalSavedItems;
    }
  } catch (err) {
    console.warn("Could not load global saved items from Sheets:", err);
    if (!globalSavedItems.length) {
      const cached = readGlobalShortlistCache();
      if (cached.length) {
        syncGlobalSavedItems(cached);
        renderShortlist();
        renderAccommodations();
        renderDining();
        renderActivities();
        renderTransit();
      }
    }
    const statusEl = $("shortlistSyncStatus");
    if (statusEl) {
      statusEl.textContent = "Offline · showing cached items";
    }
  }
  return null;
}

async function loadSavedItemsFromSheets(tripId) {
  if (!tripId) return null;
  const globalItems = await loadGlobalSavedItemsFromSheets({ silent: true });
  if (globalItems !== null) return globalItems;

  if (inFlightRefreshes.has(tripId)) return savedItems;
  inFlightRefreshes.add(tripId);
  try {
    const statusEl = $("shortlistSyncStatus");
    if (statusEl && current?.id === tripId) {
      statusEl.textContent = "Refreshing shared items…";
    }

    let res = null;
    try {
      res = await fetchSheetsApi(
        { action: "get_items", tripId },
        { method: "GET" },
      );
    } catch {}

    if (
      !res ||
      (!Array.isArray(res) &&
        !Array.isArray(res?.items) &&
        !Array.isArray(res?.data) &&
        !Array.isArray(res?.stays))
    ) {
      try {
        res = await fetchSheetsApi(
          { action: "get_stays", tripId },
          { method: "GET" },
        );
      } catch {}
    }

    const rawList = Array.isArray(res)
      ? res
      : Array.isArray(res?.items)
        ? res.items
        : Array.isArray(res?.stays)
          ? res.stays
          : Array.isArray(res?.data)
            ? res.data
            : null;

    if (rawList !== null) {
      if (!current || current.id === tripId) {
        syncSavedItemsState(rawList);
        if (current) {
          try {
            saveTrip(localStorage, current);
          } catch {}
        }
        renderShortlist();
        renderAccommodations();
        renderDining();
        renderActivities();
        renderTransit();
        if (statusEl) statusEl.textContent = "Synced just now";
        return savedItems;
      } else {
        try {
          const allLocal = readTrips(localStorage);
          const targetTrip = allLocal.find((t) => t.id === tripId);
          if (targetTrip) {
            targetTrip.savedItems = rawList;
            saveTrip(localStorage, targetTrip);
          }
        } catch {}
        return rawList;
      }
    }
  } catch (err) {
    console.warn("Could not load saved items from Sheets:", err);
    if (!globalSavedItems.length) {
      const cached = readGlobalShortlistCache();
      if (cached.length) {
        syncGlobalSavedItems(cached);
        renderShortlist();
        renderAccommodations();
        renderDining();
        renderActivities();
        renderTransit();
      }
    }
    const statusEl = $("shortlistSyncStatus");
    if (statusEl && current?.id === tripId) {
      statusEl.textContent = "Offline · showing cached items";
    }
  } finally {
    inFlightRefreshes.delete(tripId);
  }
  return null;
}
const loadStaysFromSheets = loadSavedItemsFromSheets;

async function loadTripFromSheets(tripId) {
  if (!tripId) return;
  $("connectionStatus").textContent = "Loading shared trip from Google Sheets…";
  let remoteLoaded = false;
  try {
    const res = await fetchSheetsApi(
      { action: "get_trip", tripId },
      { method: "GET" },
    );
    const rawData =
      res?.tripDataJSON ||
      res?.tripData ||
      res?.trip ||
      (res?.destination ? res : null);

    if (rawData) {
      const parsed =
        typeof rawData === "string" ? JSON.parse(rawData) : rawData;
      if (parsed && (parsed.result || parsed.trip)) {
        // Race check: only apply if this tripId is still active (or current not yet initialized)
        if (!current || !current.id || current.id === tripId) {
          current = parsed;
          current.id = tripId;

          const directItems = Array.isArray(res?.items)
            ? res.items
            : Array.isArray(res?.stays)
              ? res.stays
              : Array.isArray(parsed?.savedItems)
                ? parsed.savedItems
                : Array.isArray(parsed?.stays)
                  ? parsed.stays
                  : null;

          if (directItems !== null) {
            syncSavedItemsState(directItems);
          }

          try {
            saveTrip(localStorage, current);
          } catch {}

          showCurrent();
          renderShortlist();
          toast("Trip itinerary hydrated from Google Sheets.");
          $("resultsContainer")?.scrollIntoView({ behavior: "smooth" });
          remoteLoaded = true;
        }
      }
    }
  } catch (err) {
    console.warn("Could not hydrate trip from Google Sheets:", err);
  }

  const remoteItems = await loadSavedItemsFromSheets(tripId);
  if (remoteItems === null && !remoteLoaded && current?.id === tripId) {
    $("connectionStatus").textContent =
      "Offline · showing cached trip and saved items.";
  }
}

async function loadTripFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const tripId = params.get("trip");
  if (!tripId) return;

  // 1. Check local cache first so user sees immediate data if offline or fast-boot
  let cachedTrip = null;
  try {
    const allLocal = readTrips(localStorage);
    cachedTrip = allLocal.find((t) => t.id === tripId) || null;
  } catch {}

  if (cachedTrip) {
    current = expireHistory(cachedTrip).trip;
    syncSavedItemsState(
      current.savedItems || current.stays || cachedTrip.savedItems || cachedTrip.stays || [],
    );
    showCurrent();
    renderShortlist();
  } else {
    renderShortlist({ isLoading: true });
  }

  await loadTripFromSheets(tripId);
}

async function loadSharedTripsFromSheets({ showToast = false } = {}) {
  if (isLoadingSharedTrips) return sharedTrips;
  isLoadingSharedTrips = true;
  try {
    const res = await fetchSheetsApi(
      { action: "list_trips" },
      { method: "GET" },
    );
    if (res?.status === "success" && Array.isArray(res?.trips)) {
      sharedTrips = res.trips;
      hasSharedSnapshot = true;
      writeSharedTripsCache(localStorage, sharedTrips);
      badge();
      renderSaved();
      if (showToast) toast("Shared trips refreshed from Google Sheets.");
      return sharedTrips;
    }
  } catch (err) {
    console.warn("Could not load shared trips from Sheets:", err);
    // Remote failure: retain cache if it exists (including empty snapshot [])
    const cached = readSharedTripsCache(localStorage);
    if (cached !== null) {
      sharedTrips = cached;
      hasSharedSnapshot = true;
      badge();
      renderSaved();
    }
  } finally {
    isLoadingSharedTrips = false;
  }
  return null;
}

function renderSaved() {
  const box = $("savedTripsList");
  if (!box) return;
  box.replaceChildren();

  if (hasSharedSnapshot) {
    if (!sharedTrips.length) {
      box.append(
        el(
          "p",
          "No shared trips yet. Generate a plan, then tap Save.",
          "muted text-xs py-4 text-center",
        ),
      );
      return;
    }
    for (const trip of sharedTrips) {
      box.append(
        renderSharedTripRow(trip, {
          onLoad: (t) => openSharedTrip(t),
          onDelete: (t) => deleteSharedTrip(t),
        }),
      );
    }
    return;
  }

  // Only fall back to legacy/local storage if NO shared snapshot has ever existed
  const trips = readAll();
  if (!trips.length) {
    box.append(
      el(
        "p",
        "No shared trips yet. Generate a plan, then tap Save.",
        "muted text-xs py-4 text-center",
      ),
    );
    return;
  }

  for (const trip of trips) {
    box.append(
      renderSharedTripRow(trip, {
        onLoad: (t) => openSharedTrip(t),
        onDelete: (t) => deleteSharedTrip(t),
      }),
    );
  }
}

async function openSharedTrip(trip) {
  if (controller) return;
  if (
    current &&
    $("travelNotes").value !== current.notes &&
    !confirm("Leave unsaved notes? Tap Cancel, then Save to keep them.")
  )
    return;

  $("savedTripsModal")?.close();

  const tripId = trip.tripId || trip.id;

  // If orphan saved items (no TripDataJSON)
  if (trip.hasTripData === false) {
    const dest = trip.destination || "Shared Trip";
    current = {
      id: tripId,
      destination: dest,
      trip: {
        destination: dest,
        mode: "itinerary",
        days: 1,
        people: 2,
      },
      result: null,
      content: `### Shared Workspace for ${dest}\n\nThis shared workspace contains pinned items (stays, food spots, activities, and transit legs) synced via Google Sheets.`,
      notes: "",
      chat: [],
      savedItems: [],
    };
    showCurrent();
    renderShortlist({ isLoading: true });
    $("resultsContainer")?.scrollIntoView({ behavior: "smooth" });
    await loadSavedItemsFromSheets(tripId);
    toast(`Opened workspace for "${dest}".`);
    return;
  }

  let cachedTrip = null;
  try {
    const allLocal = readTrips(localStorage);
    cachedTrip = allLocal.find((t) => t.id === tripId) || null;
  } catch {}

  if (cachedTrip) {
    current = expireHistory(cachedTrip).trip;
    syncSavedItemsState(
      current.savedItems || current.stays || cachedTrip.savedItems || cachedTrip.stays || [],
    );
    showCurrent();
    renderShortlist();
    $("resultsContainer")?.scrollIntoView({ behavior: "smooth" });
  } else {
    renderShortlist({ isLoading: true });
  }

  await loadTripFromSheets(tripId);
}

function deleteSharedTrip(trip) {
  const tripId = trip.tripId || trip.id;
  const dest = trip.destination || "trip";
  if (
    !confirm(
      `Delete “${dest}” from this device? (Shared Google Sheets items remain intact).`,
    )
  )
    return;
  try {
    writeTrips(
      localStorage,
      readTrips(localStorage).filter((t) => t.id !== tripId),
    );
    sharedTrips = sharedTrips.filter((t) => (t.tripId || t.id) !== tripId);
    hasSharedSnapshot = true;
    writeSharedTripsCache(localStorage, sharedTrips);
    badge();
    renderSaved();
    toast("Trip removed from this device. Existing backups are unchanged.");
  } catch (e) {
    storageError(e);
  }
}
function download(name, data) {
  const url = URL.createObjectURL(
    new Blob([data], { type: "application/json" }),
  );
  const a = el("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("planner").addEventListener("submit", (event) => {
  event.preventDefault();
  let trip;
  try {
    trip = formTrip();
  } catch (e) {
    error(e.message);
    return;
  }
  if (
    current &&
    $("travelNotes").value !== current.notes &&
    !confirm(
      "Generate a new plan and leave unsaved notes? Cancel and Save to keep them.",
    )
  )
    return;
  action(async (signal) => {
    const data = await request("travel", { action: "generate", trip }, signal);
    if (signal.aborted) return;
    const result = safeResult(data.result);
    current = {
      id: crypto.randomUUID(),
      destination:
        trip.mode === "compare"
          ? `${trip.destination} vs ${trip.destinationB}`
          : trip.destination,
      trip,
      result,
      content: "",
      chat: [],
      notes: "",
      conversation: data.conversation,
      createdAt: result.createdAt,
      updatedAt: result.createdAt,
      costs: null,
    };
    showCurrent();
    saveCurrentToSheets();
    toast("Plan ready. Save it for your trip.");
    $("resultsContainer").scrollIntoView({ behavior: "smooth" });
    if (trip.currency !== "PHP") refreshFx();
  });
});
$("chatForm").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!current || controller) return;
  const message = $("chatInput").value.trim();
  if (!message) return;
  if ((current.chat || []).length >= 80) {
    error(
      "This conversation is long. Start a fresh itinerary to keep requests manageable.",
    );
    return;
  }
  action(async (signal) => {
    const trip = current.trip || legacyDetails();
    const results = [
      current.result,
      ...(current.chat || []).map((m) => m.result),
    ].filter(Boolean);
    const expiries = results
      .map((r) => r.expiresAt)
      .filter(Boolean)
      .sort();
    const body = {
      action: "chat",
      trip,
      message,
      grounding: $("chatGrounding").value,
      conversation: current.conversation,
      contextHasMaps: results.some((r) => r.hasMaps),
      contextExpiresAt: expiries[0],
    };
    if (!body.conversation) body.context = context();
    let data;
    try {
      data = await request("travel", body, signal);
    } catch (e) {
      if (e.code !== "CONVERSATION_EXPIRED") throw e;
      // One bounded recovery after an explicit expiry error, never a retry for timeout/quota/tool failure.
      current.conversation = null;
      data = await request(
        "travel",
        { ...body, conversation: null, context: context() },
        signal,
      );
      toast(
        "Conversation reconnected using the saved plan and recent questions.",
      );
    }
    if (signal.aborted) return;
    const result = safeResult(data.result);
    current.chat.push(
      { role: "user", text: message },
      { role: "model", result },
    );
    current.conversation = data.conversation;
    $("chatInput").value = "";
    renderChat();
    toast("Reply ready. Tap Save to keep this conversation.");
  }, "Thinking about your question…");
});
$("calculateBudget").addEventListener("click", () => {
  if (!current?.trip) return;
  if (current.costs) {
    renderBudget();
    return;
  }
  action(async (signal) => {
    const data = await request(
      "budget",
      { trip: current.trip, context: planText() },
      signal,
    );
    if (signal.aborted) return;
    calculateBudget(data.costs, current.trip);
    current.costs = data.costs;
    renderBudget();
    if (current.trip.currency !== "PHP") refreshFx();
  }, "Extracting estimated cost rows…");
});
$("cancelRequest").addEventListener("click", () => controller?.abort());
$("chatInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.isComposing) {
    event.preventDefault();
    $("chatForm").requestSubmit();
  }
});
$("savePlan").addEventListener("click", persistCurrent);
$("sharePlan").addEventListener("click", async () => {
  if (!current || current.result?.hasMaps) return;
  const sources = (current.result?.sources || [])
    .map((s) => `${s.title}: ${s.url}`)
    .join("\n");
  const text = `${current.destination}\n\n${planText()}\n\n${sources}\n\nSaanTayo · AI-assisted travel research`;
  try {
    if (navigator.share)
      await navigator.share({ title: current.destination, text });
    else {
      await navigator.clipboard.writeText(text);
      toast("Complete plan and sources copied.");
    }
  } catch (e) {
    if (e.name !== "AbortError")
      error(
        "Sharing was unavailable. Export this plan from Saved trips instead.",
      );
  }
});
for (const button of document.querySelectorAll("[data-mode]"))
  button.addEventListener("click", () => setMode(button.dataset.mode));
for (const button of document.querySelectorAll("[data-vibe]"))
  button.addEventListener("click", () => {
    const v = button.dataset.vibe;
    selectedVibes = selectedVibes.includes(v)
      ? selectedVibes.filter((x) => x !== v)
      : [...selectedVibes, v];
    syncVibes();
  });
for (const button of document.querySelectorAll("[data-stay-filter]"))
  button.addEventListener("click", () => {
    activeStayFilter = button.dataset.stayFilter;
    renderAccommodations();
  });
for (const radio of document.querySelectorAll('input[name="party"]'))
  radio.addEventListener("change", () => {
    if (radio.value === "Solo Traveler") $("people").value = "1";
    else if (radio.value === "Couple / Partner") $("people").value = "2";
  });
for (const button of document.querySelectorAll("[data-dialog]"))
  button.addEventListener("click", () => {
    if (button.dataset.dialog === "savedTripsModal") renderSaved();
    if (button.dataset.dialog === "shortlistModal") renderShortlist();
    $(button.dataset.dialog)?.showModal();
  });
$("openShortlistBtn")?.addEventListener("click", () => {
  renderShortlist();
  $("shortlistModal")?.showModal();
});
for (const button of document.querySelectorAll("[data-close]"))
  button.addEventListener("click", () => button.closest("dialog").close());
$("toggleAddStayBtn")?.addEventListener("click", () => {
  const form = $("addStayForm");
  if (!form) return;
  const isHidden = form.classList.toggle("hidden");
  if (!isHidden) {
    $("manualStayLink")?.focus();
  }
});
$("smartPasteStayBtn")?.addEventListener("click", async () => {
  let text = "";
  try {
    text = await navigator.clipboard.readText();
  } catch {
    text = prompt("Paste your stay or hotel link here:") || "";
  }
  if (!text || typeof text !== "string" || !text.trim()) {
    toast("Clipboard is empty. Copy a link first!");
    return;
  }
  const trimmed = text.trim();
  const linkInput = $("manualStayLink");
  if (linkInput) linkInput.value = trimmed;

  const parsedName = parseStayNameFromUrl(trimmed);
  const nameInput = $("manualStayName");
  if (nameInput && parsedName) {
    nameInput.value = parsedName;
  }

  const priceInput = $("manualStayPrice");
  if (priceInput) {
    priceInput.focus();
  }

  toast(
    parsedName
      ? `Parsed "${parsedName}"! Enter price to save.`
      : "Link pasted! Enter property name and price.",
  );
});
$("cancelAddStayBtn")?.addEventListener("click", () => {
  const form = $("addStayForm");
  if (!form) return;
  form.reset();
  form.classList.add("hidden");
});
$("addStayForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const hotelName = $("manualStayName")?.value.trim();
  if (!hotelName) return;
  const rawPrice = $("manualStayPrice")?.value.trim();
  const rawLink = $("manualStayLink")?.value.trim();
  const price = rawPrice || "Custom listed rate";
  const link = rawLink ? safeUrl(rawLink) || "" : "";

  const form = $("addStayForm");
  if (form) {
    form.reset();
    form.classList.add("hidden");
  }

  await saveItem({
    itemType: "stay",
    name: hotelName,
    location: current?.trip?.destination || "",
    category: "Custom Stay",
    price,
    link,
  });
});
$("exportTrips").addEventListener("click", () => {
  try {
    download(
      "saantayo-trips.json",
      JSON.stringify(exportEligible(readTrips(localStorage)), null, 2),
    );
    toast("Backup exported. Maps answers omitted; notes retained.");
  } catch (e) {
    storageError(e);
  }
});
$("importTrips").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 4000000)
      throw new Error("Backup is too large (maximum 4 MB).");
    const imported = importTripsData(await file.text());
    const existing = readTrips(localStorage);
    writeTrips(localStorage, [...existing, ...imported]);
    badge();
    renderSaved();
    toast(`Imported ${imported.length} plans. Existing trips kept.`);
  } catch (e) {
    storageError(e);
  } finally {
    event.target.value = "";
  }
});
const checklist = [
  "Save plans and check they open offline",
  "Keep copies of bookings and emergency contacts",
  "Pack medicines, charging cable and power bank",
  "Plan cash access and a backup payment method",
  "Check weather and operator updates before transfers",
  "Allow connection buffers; keep a flexible backup day",
];
let checks = {};
try {
  checks = JSON.parse(localStorage.getItem("saantayo_checklist") || "{}");
} catch {}
checklist.forEach((text, index) => {
  const label = el("label", null, "checklist-item"),
    input = el("input");
  input.type = "checkbox";
  input.checked = checks?.[index] === true;
  input.addEventListener("change", () => {
    checks = { ...checks, [index]: input.checked };
    try {
      localStorage.setItem("saantayo_checklist", JSON.stringify(checks));
    } catch (e) {
      storageError(e);
    }
  });
  label.append(input, document.createTextNode(text));
  $("checklistItems").append(label);
});
async function connection() {
  if (!navigator.onLine) {
    $("connectionStatus").textContent =
      "Offline · saved plans and checklist are available. Live research needs internet.";
    setBusy(!!controller);
    return;
  }
  $("connectionStatus").textContent = "Online · checking research connection…";
  try {
    const response = await fetch(`${API_BASE}/api/health`, {
      signal: AbortSignal.timeout(6000),
    });
    const data = await response.json();
    ready = response.ok && data.ready;
    $("connectionStatus").textContent = ready
      ? "Shared workspace ready · saved trips sync across devices"
      : "Research setup needed · saved plans and checklist still work.";
  } catch {
    $("connectionStatus").textContent =
      "Backend unavailable · saved plans and checklist still work.";
  }
  setBusy(!!controller);
}
function updatePartnerIdentityUI() {
  const partner = getPartnerIdentity(localStorage);
  const label = $("currentPartnerLabel");
  if (label) label.textContent = partner || "Select";

  const glenBtn = $("selectGlenBtn");
  const anneBtn = $("selectAnneBtn");
  if (glenBtn && anneBtn) {
    glenBtn.classList.toggle("ring-2", partner === "Glen");
    glenBtn.classList.toggle("ring-cyan-400", partner === "Glen");
    anneBtn.classList.toggle("ring-2", partner === "Anne");
    anneBtn.classList.toggle("ring-pink-400", partner === "Anne");
  }
}

function switchPartner(identity) {
  const norm = setPartnerIdentity(localStorage, identity);
  updatePartnerIdentityUI();
  $("partnerModal")?.close();
  toast(`Using SaanTayo as ${norm}`);
}

function triggerAutoRefresh(reason = "auto") {
  if (!current?.id || inFlightRefreshes.has(current.id)) return;
  const now = Date.now();
  if (reason !== "manual" && now - lastAutoRefresh < 1000) return;
  lastAutoRefresh = now;
  loadSavedItemsFromSheets(current.id);
}

try {
  localStorage.removeItem("saantayo_gemini_key");
  const trips = readTrips(localStorage),
    updates = trips.map((t) => expireHistory(t));
  if (updates.some((t) => t.changed))
    writeTrips(
      localStorage,
      updates.map((t) => t.trip),
    );
} catch (e) {
  storageError(e);
}
setMode("itinerary");
syncVibes();
const cachedShared = readSharedTripsCache(localStorage);
if (cachedShared !== null) {
  sharedTrips = cachedShared;
  hasSharedSnapshot = true;
}
const cachedGlobal = readGlobalShortlistCache();
if (cachedGlobal.length) {
  syncGlobalSavedItems(cachedGlobal);
}
updatePartnerIdentityUI();
badge();
renderShortlist();
renderSaved();
loadTripFromUrl();
loadGlobalSavedItemsFromSheets({ silent: true });
connection();

// First-use chooser: if no partner identity has been set, open chooser modal automatically
const initialPartner = getPartnerIdentity(localStorage);
if (!initialPartner) {
  const modal = $("partnerModal");
  if (modal && typeof modal.showModal === "function") {
    modal.showModal();
  }
}

// Auto-discover shared trips at startup
loadSharedTripsFromSheets();

$("selectGlenBtn")?.addEventListener("click", () => switchPartner("Glen"));
$("selectAnneBtn")?.addEventListener("click", () => switchPartner("Anne"));

$("refreshSharedTripsBtn")?.addEventListener("click", () => {
  loadSharedTripsFromSheets({ showToast: true });
});

document.querySelectorAll('[data-dialog="savedTripsModal"]').forEach((btn) => {
  btn.addEventListener("click", () => {
    loadSharedTripsFromSheets();
  });
});

document.querySelectorAll('[data-dialog="shortlistModal"]').forEach((btn) => {
  btn.addEventListener("click", () => {
    loadGlobalSavedItemsFromSheets({ silent: true });
    if (current?.id) triggerAutoRefresh("manual");
  });
});

$("openShortlistBtn")?.addEventListener("click", () => {
  loadGlobalSavedItemsFromSheets({ silent: true });
});

document.querySelectorAll("[data-partner-filter]").forEach((btn) => {
  btn.addEventListener("click", () => {
    activePartnerFilter = btn.dataset.partnerFilter || "all";
    document.querySelectorAll("[data-partner-filter]").forEach((b) => {
      const isSelected = b.dataset.partnerFilter === activePartnerFilter;
      b.classList.toggle("bg-cyan-500", isSelected);
      b.classList.toggle("text-slate-950", isSelected);
      b.classList.toggle("bg-slate-800", !isSelected);
      b.classList.toggle("text-slate-400", !isSelected);
    });
    renderShortlist();
  });
});

window.addEventListener("online", connection);
window.addEventListener("offline", connection);
window.addEventListener("focus", () => triggerAutoRefresh("focus"));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    triggerAutoRefresh("visibility");
  }
});

setInterval(() => {
  if (
    current?.id &&
    typeof document !== "undefined" &&
    document.visibilityState === "visible" &&
    (typeof navigator === "undefined" || navigator.onLine !== false)
  ) {
    triggerAutoRefresh("poll");
  }
}, 50000);

window.addEventListener("beforeunload", (event) => {
  if (current && $("travelNotes").value !== current.notes) {
    event.preventDefault();
    event.returnValue = "";
  }
});
if ("serviceWorker" in navigator) {
  let reloadForUpdate = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadForUpdate) location.reload();
  });
  navigator.serviceWorker
    .register("./sw.js")
    .then((registration) => {
      const offerUpdate = () => {
        if (registration.waiting) $("updateApp").classList.remove("hidden");
      };
      offerUpdate();
      registration.addEventListener("updatefound", () =>
        registration.installing?.addEventListener("statechange", offerUpdate),
      );
      $("updateApp").addEventListener("click", () => {
        if (controller) {
          toast("Finish or cancel the request before updating.");
          return;
        }
        if (
          current &&
          !confirm(
            "Reload for the update? Save your plan, replies and notes first if you want to keep them.",
          )
        )
          return;
        if (registration.waiting) {
          reloadForUpdate = true;
          registration.waiting.postMessage({ type: "ACTIVATE_UPDATE" });
        }
      });
      return navigator.serviceWorker.ready;
    })
    .then(() => {
      if (!ready && navigator.onLine)
        toast("Offline app shell is ready. Save a plan to take it with you.");
    })
    .catch(() => {
      error(
        "Offline app caching failed. Saved data remains on this device, but reopening without internet may not work.",
      );
    });
}
