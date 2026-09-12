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
function estimateRange(min, max, suffix = "") {
  if (min == null && max == null) return "Needs confirmation";
  if (min == null) return `Up to ${Math.ceil(max)}${suffix}`;
  if (max == null) return `From ${Math.ceil(min)}${suffix}`;
  return min === max
    ? `${Math.ceil(min)}${suffix}`
    : `${Math.ceil(min)}–${Math.ceil(max)}${suffix}`;
}
function estimateCost(option) {
  const { costMinPHP: min, costMaxPHP: max } = option;
  if (min == null && max == null) return "Fare needs confirmation";
  const value = estimateRange(min, max);
  return `₱${value.replace(/^Up to /, "up to ₱").replace(/^From /, "from ₱")}`;
}
function renderAdvisorSources(sources) {
  const wrap = el("div", null, "journey-advisor-sources");
  if (!sources?.length) return wrap;
  wrap.append(el("span", "Grounded sources", "journey-source-label"));
  for (const source of sources) {
    const a = el("a", source.title, "journey-source-link");
    a.href = source.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    if (source.type === "maps") {
      a.prepend(document.createTextNode("Google Maps · "));
      a.setAttribute("translate", "no");
    }
    wrap.append(a);
  }
  return wrap;
}
function renderJourneyAdvisor(advisor, { onRefine } = {}) {
  if (!advisor || !["grounded", "clarify"].includes(advisor.status)) return null;
  const section = el("section", null, "journey-advisor");
  const top = el("div", null, "journey-advisor-head");
  top.append(
    el("span", "SaanTayo route intelligence", "journey-advisor-kicker"),
    el(
      "span",
      advisor.status === "grounded"
        ? `◆ Grounded estimate · ${advisor.confidence} confidence`
        : "◆ Place clarification needed",
      "journey-trust-chip journey-trust-grounded",
    ),
  );
  section.append(top);
  if (advisor.resolvedOrigin || advisor.resolvedDestination)
    section.append(
      el(
        "p",
        `${advisor.resolvedOrigin || "Starting point"} → ${advisor.resolvedDestination || "Destination"}`,
        "journey-advisor-route",
      ),
    );
  if (advisor.assumption)
    section.append(el("p", `Assumption: ${advisor.assumption}`, "journey-assumption"));
  if (advisor.summary) section.append(el("p", advisor.summary, "journey-advisor-summary"));

  if (advisor.status === "clarify") {
    section.append(el("h3", "Which place did you mean?", "journey-advisor-title"));
    const choices = el("div", null, "journey-refine-options");
    for (const suggestion of advisor.suggestions || []) {
      const button = el("button", suggestion.label, "journey-refine-option");
      button.type = "button";
      button.addEventListener("click", () => onRefine?.(suggestion));
      choices.append(button);
    }
    section.append(choices);
    return section;
  }

  const grid = el("div", null, "journey-advisor-options");
  const icons = { grab: "🚗", train: "🚊", local: "🚐" };
  for (const option of advisor.options || []) {
    const card = el("article", null, "journey-advisor-card");
    if (option.mode === advisor.recommendedMode) card.classList.add("recommended");
    const heading = el("div", null, "journey-advisor-card-head");
    heading.append(
      el("h3", `${icons[option.mode] || "•"} ${option.label}`, "journey-advisor-title"),
      el(
        "span",
        option.mode === advisor.recommendedMode ? "Recommended" : `${option.confidence} confidence`,
        "journey-trust-chip journey-trust-grounded",
      ),
    );
    card.append(heading);
    const metrics = el("div", null, "journey-advisor-metrics");
    metrics.append(
      el("strong", estimateRange(option.durationMin, option.durationMax, " min")),
      el("strong", estimateCost(option)),
    );
    card.append(metrics);
    if (option.costBasis !== "unknown")
      card.append(
        el(
          "p",
          option.costBasis === "vehicle" ? "Estimated per vehicle" : "Estimated per person",
          "muted",
        ),
      );
    if (option.why) card.append(el("p", option.why, "journey-advisor-why"));
    if (option.steps?.length) {
      const details = el("details", null, "journey-directions journey-advisor-directions");
      details.append(el("summary", "How this would work ↓"));
      const list = el("ol", null, "journey-advisor-steps");
      for (const step of option.steps) {
        const row = el("li");
        row.append(el("strong", step.title));
        if (step.instruction) row.append(el("p", step.instruction));
        if (step.landmark) row.append(el("p", `Landmark: ${step.landmark}`, "muted"));
        list.append(row);
      }
      details.append(list);
      card.append(details);
    }
    for (const caveat of option.caveats || [])
      card.append(el("p", caveat, "muted"));
    card.append(renderAdvisorSources(advisor.sources));
    grid.append(card);
  }
  section.append(grid);
  section.append(
    el(
      "p",
      "Grounded estimates help you decide inside SaanTayo. Confirm exact pickup points, schedules and fares before boarding or booking.",
      "journey-advisor-footnote",
    ),
  );
  return section;
}

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
  badges.append(el("span", "✓ Verified route", "journey-trust-chip journey-trust-verified"));
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
  { people = 1, onPin, isPinned = () => false, advisor = null, onRefine } = {},
) {
  const model = recommendJourney(normalizeJourney(journey), people);
  const root = el("div", null, "journey-results");
  for (const warning of model.warnings)
    if (model.routes.length || !advisor) root.append(el("p", warning, "muted"));
  if (model.generatedAt)
    root.append(
      el(
        "p",
        `Checked ${schedule(model.generatedAt)} · Departure ${schedule(model.departureTime)}`,
        "muted",
      ),
    );
  const advisorView = renderJourneyAdvisor(advisor, { onRefine });
  if (!model.routes.length && advisorView) root.append(advisorView);
  if (!model.routes.length && !advisorView) {
    root.append(
      el(
        "p",
        "SaanTayo could not build a useful route yet. Try a more specific landmark or address.",
        "journey-empty",
      ),
    );
    for (const item of buildTransitRouteLinks({ ...model, mode: "local" }))
      root.append(link(item));
  }
  const comparison = comparePartyRoutes(model, people);
  if (comparison) root.append(el("p", comparison, "journey-comparison"));
  if (model.routes.length) {
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
    if (advisorView) {
      const heading = el("h3", "Grounded alternatives", "journey-advisor-section-title");
      root.append(heading, advisorView);
    }
  }
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
  const from = input("journeyOrigin", "From · landmark, hotel, station or address");
  const to = input("journeyDestination", "To · landmark, hotel, station or address");
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
  const submit = el("button", "Find the best way", "primary");
  submit.type = "submit";
  form.append(submit);
  const status = el(
    "p",
    "Enter a landmark, hotel, station or address. SaanTayo checks verified routes first, then grounded estimates when needed.",
    "muted",
  );
  status.setAttribute("role", "status");
  const results = el("div");
  const reset = () => {
    controller?.abort();
    controller = null;
    submit.disabled = false;
    results.replaceChildren();
    status.textContent = "Journey changed. Find the best way to refresh guidance.";
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
    const timer = setTimeout(() => active.abort(), 24000);
    status.textContent = "Checking verified routes and local travel intelligence…";
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
      const onRefine = (suggestion) => {
        from.value = suggestion.origin;
        to.value = suggestion.destination;
        reset();
        form.requestSubmit();
      };
      results.append(
        renderJourney(response.journey, {
          people,
          onPin,
          isPinned,
          advisor: response.advisor,
          onRefine,
        }),
      );
      status.textContent = response.advisor?.status === "clarify"
        ? "Choose the place you meant below — SaanTayo will retry automatically."
        : response.journey?.status === "ok"
          ? "Verified routes found. Choose an option below."
          : response.advisor?.status === "grounded"
            ? "Grounded route estimates found. Review the assumptions and choose an option."
            : "Some route details still need confirmation.";
    } catch (error) {
      if (!disposed && controller === active)
        status.textContent = active.signal.aborted
          ? "This lookup took too long. Try again with a more specific landmark or address."
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