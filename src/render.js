import DOMPurify from "dompurify";
import { marked } from "marked";
import {
  safeUrl,
  stripTransitBlock,
  stripDiningBlock,
  stripAccommodationsBlock,
  stripActivitiesBlock,
  buildMapsSearchLink,
  buildStaySearchLink,
  buildActivitySearchLink,
} from "../shared/travel.js";

marked.use({ breaks: true, gfm: true });
export function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}
export function link(title, url) {
  const a = el("a", title);
  const safe = safeUrl(url);
  if (safe) {
    a.href = safe;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  }
  return a;
}
export function renderProviderCard(
  provider,
  { onPin, isPinned = false } = {},
) {
  const card = el("div", null, "provider-card");

  const top = el("div", null, "provider-top");
  const linkEl = el("a", null, "flex items-center gap-1.5 provider-name hover:text-cyan-300");
  linkEl.href = provider.url;
  linkEl.target = "_blank";
  linkEl.rel = "noopener noreferrer";

  const name = el("strong", provider.name);
  const arrow = el("span", "↗", "provider-arrow");
  linkEl.append(name, arrow);

  const pinBtn = el(
    "button",
    isPinned ? "✓ Pinned" : "📌 Pin",
    `pin-btn ${isPinned ? "pinned" : ""}`,
  );
  pinBtn.type = "button";
  pinBtn.setAttribute("aria-label", `Pin ${provider.name} to shortlist`);
  if (onPin) {
    pinBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      onPin(provider);
    });
  }

  top.append(linkEl, pinBtn);

  const badge = el("span", provider.badge, "provider-badge");
  card.append(top, badge);
  return card;
}
export function renderShortlistItem(item, { onDelete } = {}) {
  const row = el("div", null, "shortlist-item");
  const content = el("div", null, "shortlist-item-content");

  const type = (item.itemType || "stay").toLowerCase();
  const typeIcons = {
    stay: "🏨",
    food: "🍜",
    transport: "🚌",
    activity: "🏄",
    flight: "✈️",
    note: "📝",
  };
  const typeLabels = {
    stay: "Stay",
    food: "Food",
    transport: "Transit",
    activity: "Activity",
    flight: "Flight",
    note: "Note",
  };

  const titleRow = el("div", null, "shortlist-item-title");
  const typeBadge = el(
    "span",
    `${typeIcons[type] || "📌"} ${typeLabels[type] || "Item"}`,
    `shortlist-type-pill shortlist-type-${type}`,
  );
  titleRow.append(typeBadge);

  const displayName = item.name || item.hotelName || "Saved Item";
  if (item.link) {
    const linkEl = el(
      "a",
      displayName,
      "hover:text-cyan-400 underline decoration-cyan-500/50 flex-1 truncate",
    );
    linkEl.href = item.link;
    linkEl.target = "_blank";
    linkEl.rel = "noopener noreferrer";
    titleRow.append(linkEl);
  } else {
    const nameSpan = el("span", displayName, "flex-1 truncate");
    titleRow.append(nameSpan);
  }

  const metaRow = el("div", null, "shortlist-item-meta");
  const priceSpan = el(
    "span",
    item.price || "Live rates",
    "text-lime-300 font-semibold",
  );
  metaRow.append(priceSpan);

  if (item.location) {
    const locSpan = el("span", `📍 ${item.location}`, "text-slate-400");
    metaRow.append(locSpan);
  }

  const savedByName = String(item.savedBy || "Glen");
  const isAnne = savedByName.toLowerCase() === "anne";
  const userTag = el(
    "span",
    `Saved by ${savedByName}`,
    `shortlist-user-tag ${isAnne ? "shortlist-user-anne" : "shortlist-user-glen"}`,
  );
  metaRow.append(userTag);

  content.append(titleRow, metaRow);

  const detailSnippet =
    item.details?.mustTryDish
      ? `🍽️ Must Try: ${item.details.mustTryDish}`
      : item.details?.localTip
        ? `💡 ${item.details.localTip}`
        : item.details?.bookingTip
          ? `🎟️ Tip: ${item.details.bookingTip}`
          : item.details?.bestFor
            ? `✨ Best for: ${item.details.bestFor}`
            : item.details?.description
              ? item.details.description
              : null;

  if (detailSnippet) {
    const detailEl = el(
      "div",
      detailSnippet,
      "shortlist-item-detail text-xs text-slate-400 mt-1 line-clamp-1",
    );
    content.append(detailEl);
  }

  const delBtn = el("button", "🗑️", "shortlist-delete-btn");
  delBtn.type = "button";
  const itemId = item.itemId || item.stayId || item.id;
  delBtn.setAttribute("aria-label", `Remove ${displayName} from shortlist`);
  if (onDelete) {
    delBtn.addEventListener("click", () => onDelete(itemId));
  }

  row.append(content, delBtn);
  return row;
}

export function renderSharedTripRow(trip, { onLoad, onDelete } = {}) {
  const row = el("div", null, "saved-row shared-trip-row");
  const text = el("div", null, "flex-1 min-w-0");

  const titleRow = el("div", null, "flex items-center gap-2 flex-wrap");
  const title = el(
    "h3",
    trip.destination || "Shared Trip",
    "font-bold text-sm text-slate-100",
  );
  titleRow.append(title);

  if (trip.itemCount !== undefined && trip.itemCount > 0) {
    const countBadge = el(
      "span",
      `📌 ${trip.itemCount} ${trip.itemCount === 1 ? "item" : "items"}`,
      "text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40",
    );
    titleRow.append(countBadge);
  }

  if (trip.hasTripData === false) {
    const orphanBadge = el(
      "span",
      "Saved Items",
      "text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30",
    );
    titleRow.append(orphanBadge);
  }

  let dateInfo = "";
  if (trip.startDate && trip.endDate) {
    dateInfo = `${trip.startDate} to ${trip.endDate}`;
  } else if (trip.createdAt) {
    dateInfo = trip.expired
      ? "Sourced answer expired · notes kept"
      : `Created ${trip.createdAt.slice(0, 10)}`;
  } else {
    dateInfo = "Shared travel workspace";
  }

  const sub = el("p", dateInfo, "muted text-xs mt-0.5");
  text.append(titleRow, sub);

  const actions = el("div", null, "flex items-center gap-2");
  const loadBtn = el(
    "button",
    "Open",
    "secondary font-bold text-xs py-1.5 px-3",
  );
  loadBtn.dataset.load = trip.tripId || trip.id;
  if (onLoad) {
    loadBtn.addEventListener("click", () => onLoad(trip));
  }
  actions.append(loadBtn);

  if (onDelete && (trip.id || trip.tripId)) {
    const removeBtn = el(
      "button",
      "Delete",
      "secondary danger text-xs py-1.5 px-2.5",
    );
    removeBtn.dataset.delete = trip.tripId || trip.id;
    removeBtn.setAttribute(
      "aria-label",
      `Delete ${trip.destination || "trip"} from this device`,
    );
    removeBtn.addEventListener("click", () => onDelete(trip));
    actions.append(removeBtn);
  }

  row.append(text, actions);
  return row;
}

export function renderActivityCard(
  activity,
  { onPin, isPinned = false } = {},
) {
  const card = el("div", null, "activity-card");

  const header = el("div", null, "activity-header-row");
  const catKey = (activity.category || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  const catClass = `activity-cat-${catKey}`;
  const catBadge = el(
    "span",
    activity.category || "Activity",
    `activity-category-badge ${catClass}`,
  );

  const priceChip = el(
    "span",
    activity.estimatedPrice || "Check prices",
    "activity-price-chip",
  );

  const pinBtn = el(
    "button",
    isPinned ? "✓ Saved" : "📌 Save",
    `activity-pin-btn pin-btn ${isPinned ? "pinned" : ""}`,
  );
  pinBtn.type = "button";
  pinBtn.setAttribute(
    "aria-label",
    `Save ${activity.name || "activity"} to shortlist`,
  );
  if (onPin) {
    pinBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      onPin(activity);
    });
  }

  header.append(catBadge, priceChip, pinBtn);

  const nameGroup = el("div", null, "space-y-0.5");
  const name = el(
    "div",
    activity.name || "Curated Experience",
    "activity-name",
  );
  const location = el(
    "div",
    `📍 ${activity.location || "Local Area"}`,
    "activity-location",
  );
  nameGroup.append(name, location);

  const desc = el(
    "div",
    activity.description || "A celebrated local experience and highlight.",
    "activity-description",
  );

  const metaRow = el("div", null, "activity-meta-row");
  if (activity.duration) {
    const durChip = el(
      "span",
      `⏱️ ${activity.duration}`,
      "activity-chip activity-chip-duration",
    );
    metaRow.append(durChip);
  }
  if (activity.bestFor) {
    const bestChip = el(
      "span",
      `✨ ${activity.bestFor}`,
      "activity-chip activity-chip-bestfor",
    );
    metaRow.append(bestChip);
  }

  const tip = activity.bookingTip
    ? el("div", `💡 ${activity.bookingTip}`, "activity-tip")
    : null;

  const searchUrl =
    activity.link ||
    buildActivitySearchLink(activity.name, activity.location);

  const actionsRow = el("div", null, "activity-actions-row");
  const searchBtn = el("a", null, "activity-search-btn");
  searchBtn.href =
    searchUrl ||
    `https://www.google.com/search?q=${encodeURIComponent((activity.name || "") + " " + (activity.location || "") + " tour booking")}`;
  searchBtn.target = "_blank";
  searchBtn.rel = "noopener noreferrer";
  searchBtn.setAttribute(
    "aria-label",
    `Check booking and details for ${activity.name}`,
  );
  const searchIcon = el("span", "🔍");
  const searchLabel = el("span", "Explore & Book");
  searchBtn.append(searchIcon, searchLabel);

  actionsRow.append(searchBtn);

  card.append(header, nameGroup, desc);
  if (metaRow.children.length) card.append(metaRow);
  if (tip) card.append(tip);
  card.append(actionsRow);

  return card;
}
export function renderTransitCard(leg, { onPin, isPinned = false } = {}) {
  const card = el("div", null, "transit-card");

  const header = el("div", null, "transit-card-header");
  const modeKey = (leg.mode || "").toLowerCase();
  const modeClass = `mode-${modeKey}`;
  const modeBadge = el(
    "span",
    leg.mode || "Transit",
    `transit-mode-badge ${[
      "mode-grab",
      "mode-jeepney",
      "mode-tricycle",
      "mode-ferry",
      "mode-bus",
      "mode-train",
    ].includes(modeClass)
      ? modeClass
      : "mode-default"}`,
  );

  const fareChip = el(
    "span",
    leg.estimatedFarePHP || "₱ --",
    "transit-fare-chip",
  );

  const pinBtn = el(
    "button",
    isPinned ? "✓ Saved" : "📌 Save",
    `stay-pin-btn pin-btn ${isPinned ? "pinned" : ""}`,
  );
  pinBtn.type = "button";
  pinBtn.setAttribute(
    "aria-label",
    `Save ${leg.route || "transit route"} to shortlist`,
  );
  if (onPin) {
    pinBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      onPin(leg);
    });
  }

  header.append(modeBadge, fareChip, pinBtn);

  const route = el("div", leg.route || "Local route", "transit-route");

  const metaRow = el("div", null, "transit-meta-row");
  const payLabel = el("span", "Payment:", "text-slate-400 font-medium");
  const payVal = el(
    "span",
    leg.paymentMethod || "Cash only",
    "transit-payment",
  );
  metaRow.append(payLabel, payVal);

  const tip = el(
    "div",
    `💡 ${leg.localTip || "Confirm route and price before boarding."}`,
    "transit-tip",
  );

  card.append(header, route, metaRow, tip);
  return card;
}
export function renderTransitLinkButton(linkItem) {
  const a = el("a", null, "transit-link-btn");
  a.href = linkItem.url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";

  const iconMap = {
    sakay: "🧭",
    grab: "🚗",
    twelvego: "🚌",
    klook: "🎟️",
    maps: "🗺️",
  };
  const icon = el("span", iconMap[linkItem.id] || "↗");
  const name = el("span", linkItem.name);
  a.append(icon, name);
  return a;
}
export function renderDiningCard(spot, { onPin, isPinned = false } = {}) {
  const card = el("div", null, "dining-card");

  const header = el("div", null, "dining-header-row");
  const catKey = (spot.category || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  const catClass = `dining-cat-${catKey}`;
  const catBadge = el(
    "span",
    spot.category || "Restaurant",
    `dining-category-badge ${[
      "dining-cat-street-food",
      "dining-cat-carenderia",
      "dining-cat-restaurant",
      "dining-cat-plant-based",
      "dining-cat-cafe",
    ].includes(catClass)
      ? catClass
      : "dining-cat-default"}`,
  );

  const priceChip = el(
    "span",
    spot.estimatedCostPHP || "Check menu prices",
    "dining-price-chip",
  );

  const pinBtn = el(
    "button",
    isPinned ? "✓ Saved" : "📌 Save",
    `stay-pin-btn pin-btn ${isPinned ? "pinned" : ""}`,
  );
  pinBtn.type = "button";
  pinBtn.setAttribute("aria-label", `Save ${spot.spotName} to shortlist`);
  if (onPin) {
    pinBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      onPin(spot);
    });
  }

  header.append(catBadge, priceChip, pinBtn);

  const nameGroup = el("div", null, "space-y-0.5");
  const spotName = el("div", spot.spotName || "Local Dining", "dining-name");
  const location = el(
    "div",
    `📍 ${spot.location || "Local Area"}`,
    "dining-location",
  );
  nameGroup.append(spotName, location);

  const dishPill = el(
    "div",
    `🍽️ Must Try: ${spot.mustTryDish || "Explore Local Specialties"}`,
    "dining-dish-pill",
  );

  const desc = el(
    "div",
    spot.description || "Popular local favorite.",
    "dining-description",
  );

  const mapsUrl =
    spot.mapsUrl || buildMapsSearchLink(spot.spotName, spot.location);
  const mapBtn = el("a", null, "dining-map-btn");
  mapBtn.href =
    mapsUrl ||
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((spot.spotName || "") + " " + (spot.location || ""))}`;
  mapBtn.target = "_blank";
  mapBtn.rel = "noopener noreferrer";
  mapBtn.setAttribute("aria-label", `View ${spot.spotName} on Google Maps`);
  const pinIcon = el("span", "📍");
  const btnText = el("span", "View on Map");
  mapBtn.append(pinIcon, btnText);

  card.append(header, nameGroup, dishPill, desc, mapBtn);
  return card;
}
export function renderStayCard(stay, { onPin, isPinned = false } = {}) {
  const card = el("div", null, "stay-card");

  const header = el("div", null, "stay-header-row");
  const typeKey = (stay.type || "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const typeClass = `stay-type-${typeKey}`;
  const typeBadge = el(
    "span",
    stay.type || "Hotel",
    `stay-type-badge ${[
      "stay-type-hotel",
      "stay-type-resort",
      "stay-type-rental",
      "stay-type-hostel",
    ].includes(typeClass)
      ? typeClass
      : "stay-type-default"}`,
  );

  const priceChip = el(
    "span",
    stay.estimatedPricePHP || "Check live rates",
    "stay-price-chip",
  );
  header.append(typeBadge, priceChip);

  const nameGroup = el("div", null, "space-y-0.5");
  const stayName = el("div", stay.stayName || "Curated Stay", "stay-name");
  const neighborhood = el(
    "div",
    `📍 ${stay.neighborhood || "Local Area"}`,
    "stay-neighborhood",
  );
  nameGroup.append(stayName, neighborhood);

  const desc = el(
    "div",
    stay.description || "Curated lodging recommendation.",
    "stay-description",
  );

  const searchUrl =
    stay.searchUrl || buildStaySearchLink(stay.stayName, stay.neighborhood);

  const actionsRow = el("div", null, "stay-actions-row");
  const searchBtn = el("a", null, "stay-search-btn");
  searchBtn.href =
    searchUrl ||
    `https://www.google.com/search?q=${encodeURIComponent((stay.stayName || "") + " " + (stay.neighborhood || "") + " booking")}`;
  searchBtn.target = "_blank";
  searchBtn.rel = "noopener noreferrer";
  searchBtn.setAttribute("aria-label", `Check booking for ${stay.stayName}`);
  const searchIcon = el("span", "🔍");
  const searchLabel = el("span", "Check Booking");
  searchBtn.append(searchIcon, searchLabel);

  const pinBtn = el(
    "button",
    isPinned ? "✓ Pinned" : "📌 Pin",
    `stay-pin-btn pin-btn ${isPinned ? "pinned" : ""}`,
  );
  pinBtn.type = "button";
  pinBtn.setAttribute(
    "aria-label",
    `Pin ${stay.stayName} to collaborative shortlist`,
  );
  if (onPin) {
    pinBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      onPin(stay);
    });
  }

  actionsRow.append(searchBtn, pinBtn);
  card.append(header, nameGroup, desc, actionsRow);
  return card;
}
export function markdown(text) {
  const node = el("div", null, "prose");
  const cleanText = stripActivitiesBlock(
    stripAccommodationsBlock(stripDiningBlock(stripTransitBlock(text))),
  );
  node.innerHTML = DOMPurify.sanitize(marked.parse(cleanText), {
    ALLOWED_TAGS: [
      "p",
      "br",
      "h1",
      "h2",
      "h3",
      "h4",
      "strong",
      "em",
      "ul",
      "ol",
      "li",
      "blockquote",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "a",
      "code",
      "pre",
      "hr",
      "del",
    ],
    ALLOWED_ATTR: ["href", "title"],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
  for (const a of node.querySelectorAll("a")) {
    const safe = safeUrl(a.getAttribute("href"));
    if (!safe) a.removeAttribute("href");
    else {
      a.href = safe;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
  }
  for (const table of node.querySelectorAll("table")) {
    const wrap = el("div", null, "table-scroll");
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", "Scrollable comparison table");
    table.replaceWith(wrap);
    wrap.append(table);
  }
  return node;
}
function searchSuggestions(html) {
  const host = el("div", null, "search-suggestions");
  host.setAttribute("aria-label", "Google Search suggestions");
  const root = host.attachShadow({ mode: "open" });
  // Isolate provider CSS from the app. No scripts, event handlers, frames or remote images.
  const clean = DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ["style"],
    FORBID_TAGS: ["script", "iframe", "object", "form", "input", "img"],
    FORBID_ATTR: ["id", "name"],
    ALLOW_DATA_ATTR: false,
  });
  const parsed = new DOMParser().parseFromString(clean, "text/html");
  for (const style of parsed.querySelectorAll("style")) {
    style.textContent = style.textContent
      .replace(/@import[^;]*;?/gi, "")
      .replace(/url\([^)]*\)/gi, "none");
  }
  for (const a of parsed.querySelectorAll("a")) {
    const safe = safeUrl(a.getAttribute("href"));
    if (safe) {
      a.href = safe;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    } else a.removeAttribute("href");
  }
  root.append(...parsed.head.childNodes, ...parsed.body.childNodes);
  return host;
}
export function renderAnswer(result, legacyContent = "") {
  const container = el("div");
  if (!result) {
    container.append(
      markdown(
        legacyContent ||
          "This answer is no longer stored. Your notes are still available.",
      ),
    );
    return container;
  }
  for (const part of result.parts || []) container.append(markdown(part.text));
  // Keep the original grounded text intact. Attribution sits directly after it, before any app calculation.
  if (result.sources?.length) {
    const sources = el("section", null, "sources");
    sources.append(el("h3", "Sources"));
    result.sources.forEach((source, index) => {
      const row = el("div", null, "source-row");
      if (source.type === "place_citation") {
        const credit = el("span", "Google Maps", "maps-credit");
        credit.translate = false;
        row.append(credit, document.createTextNode(" · "));
      }
      row.append(link(source.title, source.url));
      const excerpts = [
        ...new Set(
          (result.parts || []).flatMap((p) =>
            (p.annotations || [])
              .filter((a) => a.source === index && a.excerpt)
              .map((a) => a.excerpt),
          ),
        ),
      ];
      if (excerpts.length) {
        const detail = el("details");
        detail.append(el("summary", "Claims supported"));
        for (const excerpt of excerpts)
          detail.append(el("p", excerpt, "source-excerpt"));
        row.append(detail);
      }
      for (const review of source.reviews || [])
        row.append(link(`Review · ${review.title}`, review.url));
      sources.append(row);
    });
    container.append(sources);
  }
  for (const html of result.suggestions || [])
    container.append(searchSuggestions(html));
  for (const warning of result.warnings || [])
    container.append(el("p", warning, "notice warning"));
  return container;
}
