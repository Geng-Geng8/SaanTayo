import {
  COST_SOURCES,
  MODE_LABELS,
  normalizeJourney,
  recommendJourney,
  partyCost,
  comparePartyRoutes,
  moneyRange,
  fareLabel,
  buildTransitRouteLinks,
  departureISO,
} from "../shared/journey.js";

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}
const minutes = (n) =>
  n === null ? "Time needs confirmation" : `${Math.ceil(n)} min`;
function link(item) {
  const a = el("a", item.name, "transit-maps-btn");
  a.href = item.url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  return a;
}
function schedule(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("en-PH", {
        timeZone: "Asia/Manila",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }) + " PHT"
    : "";
}
// PR #6's small renderer, semantic stepper and application-owned actions are
// retained here, with canonical facts and native disclosure replacing AI fields.
export function renderTransitRoute(
  route,
  { onPin, isPinned = false, people = 1, recommended = false } = {},
) {
  const card = el("article", null, "transit-card journey-route");
  card.dataset.transitRoute = route.mode;
  const header = el("div", null, "transit-card-header");
  const title = el("h3", route.label, "transit-route");
  const pin = el("button", isPinned ? "✓ Saved" : "📌 Save route", "pin-btn");
  pin.type = "button";
  pin.dataset.bookmarkOrigin = route.origin;
  pin.dataset.bookmarkDestination = route.destination;
  pin.setAttribute("aria-label", `Save ${route.label} to shortlist`);
  pin.addEventListener("click", () => onPin?.(route));
  header.append(title, pin);
  card.append(header);
  const badges = el("div", null, "journey-badges");
  for (const badge of [
    ...(recommended ? ["Recommended · fastest route"] : []),
    ...route.bestFor,
  ])
    badges.append(el("span", badge, "transit-chip transit-chip-duration"));
  card.append(
    badges,
    el("p", `${route.origin} → ${route.destination}`, "muted"),
  );
  card.append(
    el(
      "p",
      `${minutes(route.durationMinutes)}${route.mode === "grab" ? " driving · pickup wait extra" : ""}${route.distanceMeters === null ? "" : ` · ${(route.distanceMeters / 1000).toFixed(1)} km`}`,
      "journey-time",
    ),
  );
  const payment = route.payment || "Confirm payment before boarding";
  card.append(el("p", `${fareLabel(route)} · ${payment}`, "journey-fare"));
  card.append(el("p", COST_SOURCES[route.costSource], "muted"));
  if (route.costSource === "google_transit")
    card.append(el("p", "Google did not specify ticket type or discount eligibility. Confirm the applicable fare with the operator.", "muted"));
  if (route.costBasis !== "unknown")
    card.append(
      el(
        "p",
        route.costBasis === "person"
          ? "Fare basis: per person"
          : "Fare basis: per vehicle",
        "muted",
      ),
    );
  const cost = partyCost(route, people);
  if (cost)
    card.append(
      el(
        "p",
        `${moneyRange(cost.min, cost.max)} group total · ≈ ${moneyRange(cost.perPersonMin, cost.perPersonMax)} / person (${people} travellers)`,
        "journey-party",
      ),
    );
  else if (route.mode === "grab" && people > 1)
    card.append(
      el("p", "Confirm vehicle capacity and group fare in Grab.", "muted"),
    );
  if (route.transferCount !== null)
    card.append(
      el(
        "p",
        `${route.transferCount} transfer${route.transferCount === 1 ? "" : "s"}${route.walkingMinutes === null ? "" : ` · ${minutes(route.walkingMinutes)} walking`}`,
        "muted",
      ),
    );
  const disclosure = el("details", null, "journey-directions");
  const summary = el("summary", "View directions ↓");
  disclosure.append(summary);
  disclosure.addEventListener("toggle", () => {
    summary.textContent = disclosure.open
      ? "Hide directions ↑"
      : "View directions ↓";
  });
  const stepper = el("ol", null, "transit-stepper");
  const markers = {
    start: "●",
    walk: "↗",
    board: "↑",
    ride: "→",
    transfer: "◆",
    alight: "◎",
    arrive: "★",
  };
  for (const step of route.steps) {
    const row = el("li", null, `transit-step-row journey-step-${step.type}`);
    const marker = el("span", markers[step.type], "transit-step-marker");
    marker.setAttribute("aria-hidden", "true");
    const content = el("div", null, "transit-step-content");
    content.append(
      el(
        "strong",
        `${step.type === "arrive" ? "DESTINATION" : step.type.toUpperCase()}${step.durationMinutes === null ? "" : ` · ${minutes(step.durationMinutes)}`}`,
        "journey-step-type",
      ),
      el("p", step.title, "transit-step-title"),
    );
    for (const value of [
      step.instruction,
      step.stopName,
      step.headsign ? `Toward ${step.headsign}` : "",
      step.landmark,
      step.transferTo ? `Transfer to ${step.transferTo}` : "",
      step.distanceMeters === null ? "" : `${step.distanceMeters} m`,
      step.payment,
      step.departureTime ? `Departs ${schedule(step.departureTime)}` : "",
      step.arrivalTime ? `Arrives ${schedule(step.arrivalTime)}` : "",
    ])
      if (value) content.append(el("p", value, "transit-step-detail"));
    if (step.costPHP !== null)
      content.append(
        el(
          "p",
          `${fareLabel({ ...step, totalCostPHP: step.costPHP })} · ${COST_SOURCES[step.costSource]}`,
          "muted",
        ),
      );
    if (step.signboard) {
      const sign = el("div", null, "transit-signboard");
      sign.append(
        el("span", "LOOK FOR THIS SIGN", "transit-signboard-tag"),
        el("p", step.signboard, "transit-signboard-text"),
      );
      content.append(sign);
    }
    row.append(marker, content);
    stepper.append(row);
  }
  disclosure.append(stepper);
  if (route.mode === "local" && !route.steps.some((s) => s.signboard))
    disclosure.append(
      el(
        "p",
        "Signboard varies — confirm the route locally before boarding.",
        "muted",
      ),
    );
  for (const warning of route.warnings)
    disclosure.append(el("p", warning, "muted"));
  card.append(disclosure);
  const attribution = el("div", null, "journey-attribution");
  if (route.source === "google_routes") {
    const google = el("span", "Google Maps", "google-maps-attribution");
    google.setAttribute("translate", "no");
    attribution.append(google);
  }
  for (const source of route.sourceAttribution.filter(
    (s) => !s.startsWith("Google Maps"),
  ))
    attribution.append(el("span", source));
  card.append(attribution);
  const actions = el("div", null, "journey-actions");
  for (const item of buildTransitRouteLinks(route)) actions.append(link(item));
  card.append(actions);
  return card;
}

export function renderJourney(
  journey,
  { people = 1, onPin, isPinned = () => false } = {},
) {
  const model = recommendJourney(normalizeJourney(journey), people);
  const root = el("div", null, "journey-results");
  for (const warning of model.warnings) root.append(el("p", warning, "muted"));
  if (model.generatedAt)
    root.append(
      el(
        "p",
        `Checked ${schedule(model.generatedAt)} · Departure ${schedule(model.departureTime)}`,
        "muted",
      ),
    );
  if (!model.routes.length) {
    root.append(
      el(
        "p",
        "No verified route available. Fare needs confirmation.",
        "journey-empty",
      ),
    );
    for (const item of buildTransitRouteLinks({ ...model, mode: "local" }))
      root.append(link(item));
  }
  const comparison = comparePartyRoutes(model, people);
  if (comparison) root.append(el("p", comparison, "journey-comparison"));
  const tabs = el("div", null, "transit-mode-tabs");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Transit mode");
  const panels = el("div");
  let selected =
    model.routes.find((r) => r.id === model.recommendedRouteId)?.mode ||
    model.routes[0]?.mode;
  const buttons = [];
  const prefix = `journey-${crypto.randomUUID()}`;
  const select = (mode) => {
    selected = mode;
    for (const b of buttons) {
      const active = b.dataset.transitMode === selected;
      b.setAttribute("aria-selected", String(active));
      b.tabIndex = active ? 0 : -1;
    }
    for (const p of panels.children) p.hidden = p.dataset.mode !== mode;
  };
  for (const [mode, label] of Object.entries(MODE_LABELS)) {
    const routes = model.routes.filter((r) => r.mode === mode);
    const button = el(
      "button",
      routes.length ? label : `${label} unavailable`,
      "transit-mode-tab",
    );
    button.type = "button";
    button.id = `${prefix}-tab-${mode}`;
    button.dataset.transitMode = mode;
    button.disabled = !routes.length;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", `${prefix}-panel-${mode}`);
    button.addEventListener("click", () => select(mode));
    buttons.push(button);
    tabs.append(button);
    const panel = el("div", null, "journey-mode-panel");
    panel.id = `${prefix}-panel-${mode}`;
    panel.dataset.mode = mode;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", button.id);
    panel.tabIndex = 0;
    for (const route of routes)
      panel.append(
        renderTransitRoute(route, {
          people,
          onPin,
          isPinned: isPinned(route),
          recommended: route.id === model.recommendedRouteId,
        }),
      );
    panels.append(panel);
  }
  tabs.addEventListener("keydown", (event) => {
    const enabled = buttons.filter((b) => !b.disabled);
    const i = enabled.indexOf(event.target);
    if (
      i < 0 ||
      !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
    )
      return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? enabled.length - 1
          : (i + (event.key === "ArrowRight" ? 1 : -1) + enabled.length) %
            enabled.length;
    enabled[next].click();
    enabled[next].focus();
  });
  // All route alternatives remain visible as compact summaries above the tabs.
  if (model.routes.length > 1) {
    const overview = el("div", null, "journey-overview");
    for (const r of model.routes) {
      const button = el(
        "button",
        `${r.id === model.recommendedRouteId ? "Recommended · " : ""}${r.label} · ${minutes(r.durationMinutes)} · ${fareLabel(r)}${r.bestFor.length ? ` · ${r.bestFor.join(" · ")}` : ""}`,
        "journey-option",
      );
      button.type = "button";
      button.addEventListener("click", () => {
        select(r.mode);
        document.getElementById(`${prefix}-tab-${r.mode}`)?.focus();
      });
      overview.append(button);
    }
    root.append(overview);
  }
  select(selected);
  root.append(tabs, panels);
  return root;
}

export function createJourneyNavigator(
  host,
  { suggestions, people, lookup, onPin, isPinned },
) {
  let controller = null,
    disposed = false;
  const form = el("form", null, "journey-form");
  const input = (id, label, type = "text") => {
    const wrapper = el("label", label);
    const field = el("input");
    field.id = id;
    field.type = type;
    field.required = true;
    field.maxLength = 240;
    wrapper.append(field);
    form.append(wrapper);
    return field;
  };
  const from = input("journeyOrigin", "From · place and city");
  const to = input("journeyDestination", "To · place and city");
  from.value = suggestions[0]?.origin || "";
  to.value = suggestions[0]?.destination || "";
  if (suggestions.length > 1) {
    const label = el("label", "Suggested journey");
    const select = el("select");
    select.id = "journeySuggestion";
    suggestions.forEach((s, i) => {
      const option = el("option", s.label);
      option.value = i;
      select.append(option);
    });
    select.addEventListener("change", () => {
      const s = suggestions[Number(select.value)];
      from.value = s.origin;
      to.value = s.destination;
      reset();
    });
    label.append(select);
    form.prepend(label);
  }
  const departureLabel = el("label", "Depart · Philippine time");
  const departure = el("select");
  departure.id = "journeyDeparture";
  for (const [value, label] of [
    ["now", "Now"],
    ["morning", "Next morning · 8 AM"],
    ["midday", "Next midday · 12 PM"],
    ["evening", "Next evening · 6 PM"],
    ["custom", "Custom date and time"],
  ]) {
    const o = el("option", label);
    o.value = value;
    departure.append(o);
  }
  departureLabel.append(departure);
  form.append(departureLabel);
  const custom = input(
    "journeyCustomDeparture",
    "Custom departure · Asia/Manila",
    "datetime-local",
  );
  custom.parentElement.hidden = true;
  custom.required = false;
  const submit = el("button", "Find routes", "primary");
  submit.type = "submit";
  form.append(submit);
  const status = el(
    "p",
    "Confirm the endpoints, then find current routes. Fares and service depend on available source data.",
    "muted",
  );
  status.setAttribute("role", "status");
  const results = el("div");
  const reset = () => {
    controller?.abort();
    controller = null;
    submit.disabled = false;
    results.replaceChildren();
    status.textContent = "Journey changed. Find routes to update directions.";
  };
  for (const field of [from, to, custom])
    field.addEventListener("input", reset);
  departure.addEventListener("change", () => {
    custom.parentElement.hidden = departure.value !== "custom";
    custom.required = departure.value === "custom";
    reset();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (controller) return;
    const departureTime = departureISO(departure.value, custom.value);
    if (!departureTime || !from.value.trim() || !to.value.trim()) {
      status.textContent =
        "Enter both endpoints and a future departure within 100 days.";
      return;
    }
    const active = new AbortController();
    controller = active;
    submit.disabled = true;
    const timer = setTimeout(() => active.abort(), 12000);
    status.textContent = "Checking route providers…";
    results.replaceChildren();
    try {
      const response = await lookup(
        {
          origin: from.value.trim(),
          destination: to.value.trim(),
          departureTime,
          people,
        },
        active.signal,
      );
      if (disposed || controller !== active) return;
      results.append(
        renderJourney(response.journey, { people, onPin, isPinned }),
      );
      status.textContent =
        response.journey?.status === "ok"
          ? "Routes checked. Choose an option below."
          : "Some route details need confirmation.";
    } catch (error) {
      if (!disposed && controller === active)
        status.textContent = active.signal.aborted
          ? "Routing timed out. Try again or check Maps."
          : error.message || "Routing unavailable. Try again later.";
    } finally {
      clearTimeout(timer);
      if (controller === active) {
        controller = null;
        submit.disabled = false;
      }
    }
  });
  const bookmark = el("button", "📌 Save journey bookmark", "pin-btn");
  bookmark.type = "button";
  bookmark.addEventListener("click", () => {
    if (from.value.trim() && to.value.trim())
      onPin({
        origin: from.value.trim(),
        destination: to.value.trim(),
        mode: "local",
        label: `${from.value.trim()} → ${to.value.trim()}`,
      });
  });
  host.replaceChildren(form, status, bookmark, results);
  return {
    refreshSaved() {
      for (const pin of host.querySelectorAll("[data-bookmark-origin]")) {
        const saved = isPinned?.({
          origin: pin.dataset.bookmarkOrigin,
          destination: pin.dataset.bookmarkDestination,
        });
        pin.textContent = saved ? "✓ Saved" : "📌 Save route";
      }
    },
    dispose() {
      disposed = true;
      controller?.abort();
    },
  };
}
