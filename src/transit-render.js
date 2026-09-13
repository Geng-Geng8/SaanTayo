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
  if (option.mode === "walk") return "₱0 · Free walk";
  const { costMinPHP: min, costMaxPHP: max } = option;
  if (min == null && max == null) return "Fare needs confirmation";
  if (min == null) return `Up to ₱${Math.ceil(max)}`;
  if (max == null) return `From ₱${Math.ceil(min)}`;
  return min === max
    ? `₱${Math.ceil(min)}`
    : `₱${Math.ceil(min)}–₱${Math.ceil(max)}`;
}
function ensureJourneyAdvisorStyles() {
  if (document.getElementById("journeyAdvisorStyles")) return;
  const style = document.createElement("style");
  style.id = "journeyAdvisorStyles";
  style.textContent = `
    .journey-advisor{margin-top:.85rem;padding:1rem;border:1px solid rgba(6,182,212,.38);border-radius:1.15rem;background:linear-gradient(180deg,rgba(6,182,212,.08),rgba(15,23,42,.3));box-shadow:0 12px 30px rgba(0,0,0,.22)}
    .journey-advisor-head,.journey-advisor-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:.65rem;flex-wrap:wrap}
    .journey-advisor-kicker{font-size:.7rem;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#67e8f9}
    .journey-trust-chip{display:inline-flex;align-items:center;max-width:100%;padding:.25rem .55rem;border-radius:999px;font-size:.68rem;font-weight:800;line-height:1.25}
    .journey-trust-verified{color:#6ee7b7;background:rgba(16,185,129,.13);border:1px solid rgba(16,185,129,.35)}
    .journey-trust-grounded{color:#7dd3fc;background:rgba(14,165,233,.13);border:1px solid rgba(14,165,233,.35)}
    .journey-advisor-route{margin:.65rem 0 .25rem;color:#f8fafc;font-size:.92rem;font-weight:800;line-height:1.4;overflow-wrap:anywhere}
    .journey-assumption{margin:.3rem 0;color:#fbbf24;font-size:.78rem;line-height:1.45}
    .journey-advisor-summary{margin:.45rem 0 .8rem;color:#cbd5e1;font-size:.84rem;line-height:1.55}
    .journey-advisor-options{display:grid;gap:.7rem}
    .journey-advisor-card{min-width:0;padding:.9rem;border:1px solid #253349;border-radius:.9rem;background:#07101d}
    .journey-advisor-card.recommended{border-color:rgba(6,182,212,.7);box-shadow:inset 3px 0 #06b6d4,0 8px 24px rgba(6,182,212,.08)}
    .journey-advisor-title{margin:0;color:#f8fafc;font-size:.92rem;font-weight:850;line-height:1.35}
    .journey-advisor-metrics{display:grid;grid-template-columns:1fr 1fr;gap:.45rem;margin:.75rem 0 .35rem}
    .journey-advisor-metrics strong{padding:.55rem .65rem;border:1px solid #26364d;border-radius:.7rem;background:#0b1626;color:#fff;font-size:.9rem;text-align:center}
    .journey-advisor-why{margin:.55rem 0;color:#e2e8f0;font-size:.8rem;line-height:1.5}
    .journey-advisor-directions{margin-top:.55rem}
    .journey-advisor-steps{display:grid;gap:.55rem;margin:.65rem 0 0;padding-left:1.25rem;color:#cbd5e1;font-size:.78rem;line-height:1.5}
    .journey-advisor-steps p{margin:.15rem 0}
    .journey-advisor-sources{display:flex;gap:.4rem;align-items:center;flex-wrap:wrap;margin-top:.8rem;padding-top:.7rem;border-top:1px solid #1e293b}
    .journey-source-label{font-size:.67rem;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em}
    .journey-source-link{display:inline-flex;padding:.3rem .5rem;border:1px solid #334155;border-radius:.55rem;color:#7dd3fc;font-size:.69rem;font-weight:700;text-decoration:none;overflow-wrap:anywhere}
    .journey-source-link:hover{border-color:#06b6d4;color:#cffafe}
    .journey-advisor-footnote{margin:.75rem 0 0;color:#94a3b8;font-size:.72rem;line-height:1.45}
    .journey-refine-options{display:grid;gap:.55rem;margin-top:.7rem}
    .journey-refine-option{width:100%;padding:.75rem .8rem;border:1px solid rgba(6,182,212,.45);border-radius:.75rem;background:rgba(6,182,212,.08);color:#e6fbff;font-weight:800;text-align:left;cursor:pointer}
    .journey-refine-option:hover,.journey-refine-option:focus-visible{background:rgba(6,182,212,.16);outline:2px solid transparent;border-color:#22d3ee}
    .journey-advisor-section-title{margin:1rem 0 .25rem;color:#f8fafc;font-size:.9rem}
    .journey-unavailable-modes{margin:.7rem 0;color:#64748b;font-size:.72rem;line-height:1.5}
    @media(min-width:720px){.journey-advisor-options{grid-template-columns:repeat(2,minmax(0,1fr))}.journey-advisor-card.recommended{grid-column:1/-1}.journey-refine-options{grid-template-columns:repeat(2,minmax(0,1fr))}}
  `;
  document.head.append(style);
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
  ensureJourneyAdvisorStyles();
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
    if (advisor.sources?.length) section.append(renderAdvisorSources(advisor.sources));
    return section;
  }

  const grid = el("div", null, "journey-advisor-options");
  const icons = { walk: "🚶", grab: "🚗", train: "🚊", local: "🚐" };
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
    if (option.costBasis !== "unknown" && option.costBasis !== "free" && option.mode !== "walk")
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
    grid.append(card);
  }
  section.append(grid);
  section.append(renderAdvisorSources(advisor.sources));
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
  ensureJourneyAdvisorStyles();
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
  const extraBadges = [];
  if (recommended) {
    extraBadges.push(
      route.mode === "walk"
        ? "Recommended · short walk"
        : "Recommended · fastest route",
    );
  }
  for (const badge of route.bestFor) {
    if (badge === "Recommended for short trip" && recommended) continue;
    extraBadges.push(badge);
  }
  for (const badge of extraBadges)
    badges.append(el("span", badge, "transit-chip transit-chip-duration"));
  card.append(
    badges,
    el("p", `${route.origin} → ${route.destination}`, "muted"),
  );
  const timeSuffix =
    route.mode === "grab"
      ? " driving · pickup wait extra"
      : route.mode === "walk"
        ? " walking"
        : "";
  card.append(
    el(
      "p",
      `${minutes(route.durationMinutes)}${timeSuffix}${route.distanceMeters === null ? "" : ` · ${(route.distanceMeters / 1000).toFixed(1)} km`}`,
      "journey-time",
    ),
  );
  const payment =
    route.mode === "walk"
      ? "Free"
      : route.payment || "Confirm payment before boarding";
  card.append(el("p", `${fareLabel(route)} · ${payment}`, "journey-fare"));
  card.append(el("p", COST_SOURCES[route.costSource], "muted"));
  if (route.costSource === "google_transit")
    card.append(el("p", "Google did not specify ticket type or discount eligibility. Confirm the applicable fare with the operator.", "muted"));
  if (route.costBasis !== "unknown" && route.costBasis !== "free" && route.mode !== "walk")
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
  if (cost && route.mode !== "walk")
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
      el(
        "p",
        "🚗 Grab estimate unavailable · 🚊 Train / Transit unavailable · 🚐 Jeepney / Local unavailable",
        "journey-unavailable-modes",
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
    const modeEntries = Object.entries(MODE_LABELS)
      .filter(([mode]) => (mode !== "walk" && mode !== "tricycle") || model.routes.some((r) => r.mode === mode))
      .sort(([modeA], [modeB]) => {
        const hasA = model.routes.some((r) => r.mode === modeA) ? 1 : 0;
        const hasB = model.routes.some((r) => r.mode === modeB) ? 1 : 0;
        return hasB - hasA;
      });
    for (const [mode, label] of modeEntries) {
      const routes = model.routes.filter((r) => r.mode === mode);
      const button = el(
        "button",
        routes.length ? label : `${label} unavailable`,
        `transit-mode-tab${routes.length ? "" : " transit-mode-tab-disabled"}`,
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
      const sortedRoutes = [...model.routes].sort((a, b) => {
        if (a.id === model.recommendedRouteId) return -1;
        if (b.id === model.recommendedRouteId) return 1;
        return 0;
      });
      for (const r of sortedRoutes) {
        const isRec = r.id === model.recommendedRouteId;
        const button = el(
          "button",
          `${isRec ? "Recommended · " : ""}${r.label} · ${minutes(r.durationMinutes)} · ${fareLabel(r)}${r.bestFor.length ? ` · ${r.bestFor.join(" · ")}` : ""}`,
          `journey-option${isRec ? " recommended" : ""}`,
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
    const timer = setTimeout(() => active.abort(), 35000);
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