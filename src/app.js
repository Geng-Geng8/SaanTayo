import { VIBES, validateTrip, calculateBudget } from "../shared/travel.js";
import {
  readTrips,
  writeTrips,
  saveTrip,
  expireHistory,
  exportEligible,
  importTripsData,
} from "./storage.js";
import { el, link, renderAnswer } from "./render.js";

const $ = (id) => document.getElementById(id);
const API_BASE = __API_BASE__;
let mode = "itinerary",
  selectedVibes = [VIBES[0], VIBES[2]],
  current = null,
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
  $("savedCountBadge").textContent = readAll().length;
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
function persistCurrent() {
  if (!current) return;
  current.notes = $("travelNotes").value;
  current.updatedAt = new Date().toISOString();
  try {
    saveTrip(localStorage, current);
    badge();
    toast("Saved on this device. Open once online before travelling offline.");
  } catch (e) {
    storageError(e);
  }
}
function renderSaved() {
  const box = $("savedTripsList");
  box.replaceChildren();
  const trips = readAll();
  if (!trips.length)
    box.append(
      el("p", "No saved trips yet. Generate a plan, then tap Save.", "muted"),
    );
  for (const trip of trips) {
    const row = el("div", null, "saved-row"),
      text = el("div");
    text.append(
      el("h3", trip.destination),
      el(
        "p",
        trip.expired
          ? "Sourced answer expired · notes kept"
          : trip.createdAt?.slice(0, 10),
        "muted",
      ),
    );
    const load = el("button", "Open", "secondary");
    load.dataset.load = trip.id;
    load.disabled = !!controller;
    load.addEventListener("click", () => {
      if (controller) return;
      if (
        current &&
        $("travelNotes").value !== current.notes &&
        !confirm("Leave unsaved notes? Tap Cancel, then Save to keep them.")
      )
        return;
      current = expireHistory(trip).trip;
      $("savedTripsModal").close();
      showCurrent();
      if (current.trip?.currency !== "PHP") refreshFx();
      $("resultsContainer").scrollIntoView({ behavior: "smooth" });
    });
    const remove = el("button", "Delete", "secondary danger");
    remove.dataset.delete = trip.id;
    remove.disabled = !!controller;
    remove.setAttribute("aria-label", `Delete ${trip.destination}`);
    remove.addEventListener("click", () => {
      if (
        !confirm(
          `Delete “${trip.destination}” from this device? An exported backup can restore eligible content.`,
        )
      )
        return;
      try {
        writeTrips(
          localStorage,
          readTrips(localStorage).filter((t) => t.id !== trip.id),
        );
        badge();
        renderSaved();
        toast("Trip removed from this device. Existing backups are unchanged.");
      } catch (e) {
        storageError(e);
      }
    });
    row.append(text, load, remove);
    box.append(row);
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
for (const radio of document.querySelectorAll('input[name="party"]'))
  radio.addEventListener("change", () => {
    if (radio.value === "Solo Traveler") $("people").value = "1";
    else if (radio.value === "Couple / Partner") $("people").value = "2";
  });
for (const button of document.querySelectorAll("[data-dialog]"))
  button.addEventListener("click", () => {
    if (button.dataset.dialog === "savedTripsModal") renderSaved();
    $(button.dataset.dialog).showModal();
  });
for (const button of document.querySelectorAll("[data-close]"))
  button.addEventListener("click", () => button.closest("dialog").close());
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
      ? "Ready for travel research · saved plans stay on this device"
      : "Research setup needed · saved plans and checklist still work.";
  } catch {
    $("connectionStatus").textContent =
      "Backend unavailable · saved plans and checklist still work.";
  }
  setBusy(!!controller);
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
badge();
connection();
window.addEventListener("online", connection);
window.addEventListener("offline", connection);
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
