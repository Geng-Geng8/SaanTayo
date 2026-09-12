import {
  buildTransitRouteLinks,
  safeUrl,
  TRANSIT_MODE_LABELS,
} from "../shared/travel.js";

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function externalLink(label, url, className, icon) {
  const a = el("a", null, className);
  const safe = safeUrl(url);
  if (!safe) return null;
  a.href = safe;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.append(el("span", icon, "transit-action-icon"), el("span", label));
  return a;
}

export function renderTransitRoute(
  route,
  { onPin, isPinned = false } = {},
) {
  const card = el(
    "article",
    null,
    `transit-route-card transit-route-${route.mode || "local"}`,
  );
  card.dataset.transitRoute = route.mode || "local";

  const header = el("div", null, "transit-route-header");
  const headingGroup = el("div", null, "transit-route-heading");
  headingGroup.append(
    el(
      "span",
      TRANSIT_MODE_LABELS[route.mode] || "Transit",
      `transit-route-mode mode-${route.mode || "local"}`,
    ),
    el("h3", route.label || "Recommended route", "transit-route-title"),
  );

  const pinBtn = el(
    "button",
    isPinned ? "✓ Saved" : "📌 Save",
    `transit-save-btn pin-btn ${isPinned ? "pinned" : ""}`,
  );
  pinBtn.type = "button";
  pinBtn.setAttribute(
    "aria-label",
    `Save ${route.label || "transit route"} to shortlist`,
  );
  if (onPin) {
    pinBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      onPin(route);
    });
  }
  header.append(headingGroup, pinBtn);

  const endpoints = el("div", null, "transit-endpoints");
  endpoints.append(
    el("span", route.origin || "Starting point", "transit-endpoint"),
    el("span", "→", "transit-endpoint-arrow"),
    el("span", route.destination || "Destination", "transit-endpoint"),
  );

  const facts = el("div", null, "transit-fact-grid");
  const factRows = [
    ["Vehicle", route.vehicle || "Local transit"],
    ["Time", route.duration || "Check current travel time"],
    ["Cost", route.estimatedCostPHP || "Confirm current fare"],
  ];
  for (const [label, value] of factRows) {
    const fact = el("div", null, "transit-fact");
    fact.append(
      el("span", label, "transit-fact-label"),
      el("strong", value, "transit-fact-value"),
    );
    facts.append(fact);
  }

  const payment = el("div", null, "transit-payment-callout");
  payment.append(
    el("span", "Payment", "transit-callout-label"),
    el(
      "p",
      route.paymentCaveat || "Confirm current payment method before boarding.",
      "transit-callout-text",
    ),
  );

  card.append(header, endpoints, facts, payment);

  if (route.mode === "local" && route.signboard) {
    const signboard = el("div", null, "transit-signboard");
    signboard.append(
      el("span", "🏷️", "transit-signboard-icon"),
      el("span", "Signboard:", "transit-signboard-label"),
      el("strong", `“${route.signboard}”`, "transit-signboard-text"),
    );
    card.append(signboard);
  }

  const wayfinder = el("div", null, "transit-wayfinder");
  wayfinder.append(el("h4", "Step-by-step wayfinder", "transit-wayfinder-title"));
  const stepper = el("ol", null, "transit-stepper");
  (route.steps || []).forEach((step, index) => {
    const row = el("li", null, "transit-step");
    const rail = el("div", null, "transit-step-rail");
    rail.append(el("span", String(index + 1), "transit-step-node"));

    const content = el("div", null, "transit-step-content");
    content.append(
      el("div", step.title || `Step ${index + 1}`, "transit-step-title"),
      el("p", step.instruction || "Follow the route signs.", "transit-step-instruction"),
    );
    if (step.landmark) {
      content.append(
        el("div", `📍 ${step.landmark}`, "transit-step-landmark"),
      );
    }
    if (step.transferTo) {
      content.append(
        el("div", `Transfer → ${step.transferTo}`, "transit-step-transfer"),
      );
    }
    row.append(rail, content);
    stepper.append(row);
  });
  wayfinder.append(stepper);
  card.append(wayfinder);

  const actions = el("div", null, "transit-route-actions");
  for (const item of buildTransitRouteLinks(route)) {
    const action = externalLink(
      item.name,
      item.url,
      `transit-action-btn transit-action-${item.id}`,
      item.id === "maps" ? "🗺️" : "🧭",
    );
    if (action) actions.append(action);
  }
  card.append(actions);

  return card;
}
