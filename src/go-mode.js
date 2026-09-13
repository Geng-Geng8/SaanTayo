// SaanTayo V3.3 — Go Mode / Local Travel Concierge
// Primary flow: "I'm here. What should we do?"
// 1. User picks location (Use my location / hotel / base / manual)
// 2. User chooses intent (Eat, Explore, Coffee, Shop, Nightlife, Surprise me)
// 3. User sees visual place cards with deterministic reasons to go & trip context
// 4. User taps a place to compare practical transit options (Walk, Train, Local, Tricycle, Grab)
// 5. Hands off turn-by-turn navigation directly to Google Maps.

import {
  recommendJourney,
  normalizeJourney,
  fareLabel,
  getFareProvenance,
  buildGoogleMapsDirectionsUrl,
  departureISO,
  legacyJourneys,
} from "../shared/journey.js";
import {
  parseDining,
  parseActivities,
  parseAccommodations,
} from "../shared/travel.js";
import {
  formatDistance,
  formatPriceLevel,
  normalizeDiscoveredPlace,
} from "../shared/discovery.js";

export const GO_MODE_STORAGE_KEY = "saantayo_go_mode_state_v1";
export const GRAB_SAFE_URL = "https://www.grab.com/ph/transport/";

export function readGoModeState(storage = typeof localStorage !== "undefined" ? localStorage : null) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(GO_MODE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    }
  } catch {}
  return null;
}

export function writeGoModeState(storage = typeof localStorage !== "undefined" ? localStorage : null, state = {}) {
  if (!storage) return;
  try {
    storage.setItem(
      GO_MODE_STORAGE_KEY,
      JSON.stringify({
        ...state,
        updatedAt: new Date().toISOString(),
      }),
    );
  } catch {}
}

export function collectGoModeDestinations({ currentTrip = null, savedItems = [], planText = "" } = {}) {
  const list = [];
  const seen = new Set();

  const add = (name, category, source) => {
    const trimmed = (name || "").trim();
    if (!trimmed || trimmed.length < 2) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    list.push({
      label: `${trimmed} (${category})`,
      value: trimmed,
      category,
      source,
    });
  };

  // 1. Sourced from Shared Shortlist (highest user intent)
  for (const item of savedItems || []) {
    const typeLabel =
      item.itemType === "stay"
        ? "Stay"
        : item.itemType === "food"
          ? "Food"
          : item.itemType === "activity"
            ? "Activity"
            : item.itemType === "transport"
              ? "Transport"
              : "Saved";
    if (item.itemType === "transport") {
      const parts = (item.name || "").split(/\s+(?:to|→)\s+/i);
      if (parts.length === 2) {
        add(parts[1], typeLabel, "shortlist");
      } else {
        add(item.name, typeLabel, "shortlist");
      }
    } else {
      add(item.name, typeLabel, "shortlist");
    }
  }

  // 2. Structured items extracted from active itinerary
  if (planText) {
    const destName = currentTrip?.trip?.destination || currentTrip?.destination || "";
    try {
      const foods = parseDining(planText, { destination: destName });
      for (const f of foods) add(f.spotName || f.name, "Food", "itinerary");
    } catch {}

    try {
      const acts = parseActivities(planText, { destination: destName });
      for (const a of acts) add(a.name, "Activity", "itinerary");
    } catch {}

    try {
      const stays = parseAccommodations(planText);
      for (const s of stays) add(s.stayName || s.name, "Stay", "itinerary");
    } catch {}

    try {
      const legs = legacyJourneys(planText, { origin: currentTrip?.trip?.origin || "", destination: destName });
      for (const l of legs) {
        if (l.destination) add(l.destination, "Route", "itinerary");
      }
    } catch {}
  }

  // 3. Trip Base Destination
  if (currentTrip?.trip?.destination) {
    add(currentTrip.trip.destination, "Trip Base", "trip");
  } else if (currentTrip?.destination) {
    add(currentTrip.destination, "Trip Base", "trip");
  }

  return list;
}

export function collectGoModeOrigins({ currentTrip = null, savedItems = [], lastArrived = "" } = {}) {
  const list = [];
  const seen = new Set();

  const add = (name, badge) => {
    const trimmed = (name || "").trim();
    if (!trimmed || trimmed.length < 2) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    list.push({ label: trimmed, badge, value: trimmed });
  };

  if (lastArrived) {
    add(lastArrived, "Current place");
  }

  if (currentTrip?.trip?.origin) {
    add(currentTrip.trip.origin, "Arrival base");
  }

  for (const item of savedItems || []) {
    if (item.itemType === "stay") {
      add(item.name, "Saved stay");
    }
  }

  if (currentTrip?.trip?.destination) {
    add(currentTrip.trip.destination, "Base destination");
  }

  return list;
}

export function formatExplanation(route, allRoutes = [], people = 1) {
  if (!route) return "";

  if (route.mode === "walk") {
    const distKm = route.distanceMeters !== null ? (route.distanceMeters / 1000).toFixed(1) : null;
    const min = Math.ceil(route.durationMinutes || 0);
    const grab = allRoutes.find((r) => r.mode === "grab");
    const driveMin = grab && grab.durationMinutes !== null ? Math.ceil(grab.durationMinutes) : null;

    if (distKm && driveMin !== null) {
      return `Walking is recommended for this short trip (~${distKm} km, ~${min} min, ₱0). Grab driving takes about ${driveMin} min, but pickup wait is not included and live fare applies.`;
    }
    return `Walking is recommended for this short trip (~${min} min, ₱0). Free and healthy way to travel.`;
  }

  if (route.mode === "grab") {
    const min = Math.ceil(route.durationMinutes || 0);
    const distKm = route.distanceMeters !== null ? (route.distanceMeters / 1000).toFixed(1) : null;
    return `Fastest vehicle route (~${min} min${distKm ? `, ~${distKm} km` : ""}). Check live Grab fare and pickup wait in the app.`;
  }

  if (route.mode === "train" || route.mode === "local") {
    const min = Math.ceil(route.durationMinutes || 0);
    const fare = fareLabel(route);
    const transfers = route.transferCount !== null ? `${route.transferCount} transfer${route.transferCount === 1 ? "" : "s"}` : "";
    return `Public transit option (~${min} min, ${fare}${transfers ? `, ${transfers}` : ""}). Compare with driving traffic before boarding.`;
  }

  if (route.mode === "tricycle") {
    const min = Math.ceil(route.durationMinutes || 12);
    const fare = fareLabel(route);
    return `Grounded local tricycle estimate (~${min} min, ${fare}). Confirm fare and destination before boarding.`;
  }

  return "";
}

function modeActionButtonLabel(mode) {
  switch (mode) {
    case "walk":
      return "START WALKING DIRECTIONS ↗";
    case "grab":
      return "START DRIVING DIRECTIONS ↗";
    case "train":
    case "local":
      return "START TRANSIT DIRECTIONS ↗";
    case "tricycle":
      return "VIEW DESTINATION IN MAPS ↗";
    default:
      return "START DIRECTIONS ↗";
  }
}

function makeEl(doc) {
  return function el(tag, text, className) {
    const d = doc || (typeof document !== "undefined" ? document : null);
    const node = d.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
}

function createCategoryPlaceholder(place, el) {
  const box = el("div", null, "go-mode-place-placeholder");
  const cat = (place.categories || []).join(" ").toLowerCase();
  const icon =
    /food|restaurant|dining|bakery|fast_food|meal/i.test(cat) ? "🍜" :
    /coffee|cafe/i.test(cat) ? "☕" :
    /shop|mall|market|store/i.test(cat) ? "🛍" :
    /bar|nightlife|club|pub/i.test(cat) ? "🌙" :
    "🏛";
  box.append(
    el("span", icon, "text-3xl mb-1"),
    el("span", place.primaryType || "Local spot", "text-[10px] text-slate-400 capitalize font-semibold"),
  );
  return box;
}

export function renderPlaceCard(place, { onSelectPlace, doc = null } = {}) {
  const el = makeEl(doc);
  const card = el("article", null, "go-mode-place-card p-3 space-y-2.5");

  // Visual Photo Header
  const photoWrap = el("div", null, "relative rounded-lg overflow-hidden");
  if (place.photoName) {
    const img = el("img", null, "go-mode-place-photo");
    img.src = `/api/place-photo?name=${encodeURIComponent(place.photoName)}`;
    img.alt = place.name;
    img.loading = "lazy";
    img.addEventListener("error", () => {
      photoWrap.replaceChildren(createCategoryPlaceholder(place, el));
    });
    photoWrap.append(img);
    if (place.photoAttribution) {
      const attr = el("span", `Photo: ${place.photoAttribution}`, "absolute bottom-1 right-2 text-[9px] text-slate-300 bg-slate-950/75 px-1.5 py-0.5 rounded backdrop-blur max-w-[85%] truncate");
      photoWrap.append(attr);
    }
  } else {
    photoWrap.append(createCategoryPlaceholder(place, el));
  }
  card.append(photoWrap);

  // Content Area
  const content = el("div", null, "space-y-1.5");
  const titleRow = el("div", null, "flex items-start justify-between gap-2");
  const nameEl = el("h3", place.name, "text-sm font-bold text-white leading-tight");
  titleRow.append(nameEl);

  if (place.tripContext?.isSaved) {
    const badge = el("span", `★ Saved by ${place.tripContext.savedBy || "Partner"}`, "text-[10px] font-bold text-cyan-300 bg-cyan-950/60 border border-cyan-500/40 px-2 py-0.5 rounded-full shrink-0");
    titleRow.append(badge);
  } else if (place.tripContext?.isItinerary) {
    const badge = el("span", "On your trip", "text-[10px] font-bold text-indigo-300 bg-indigo-950/60 border border-indigo-500/40 px-2 py-0.5 rounded-full shrink-0");
    titleRow.append(badge);
  }
  content.append(titleRow);

  // Metadata: Rating, Category, Distance, Price Level, Open Now
  const metaRow = el("div", null, "flex items-center gap-1.5 text-[11px] text-slate-400 flex-wrap");
  if (place.rating !== null && place.rating !== undefined) {
    const ratingEl = el("span", `★ ${Number(place.rating).toFixed(1)}${place.reviewCount ? ` (${place.reviewCount.toLocaleString()})` : ""}`, "font-bold text-amber-300");
    metaRow.append(ratingEl);
  }
  if (place.primaryType) {
    if (metaRow.children.length > 0) metaRow.append(el("span", "·", "text-slate-600"));
    metaRow.append(el("span", place.primaryType, "capitalize text-slate-300 font-medium"));
  }
  if (place.distanceMeters !== null && place.distanceMeters !== undefined) {
    if (metaRow.children.length > 0) metaRow.append(el("span", "·", "text-slate-600"));
    metaRow.append(el("span", formatDistance(place.distanceMeters), "font-medium text-cyan-300"));
  }
  const priceDisplay = formatPriceLevel(place.priceLevel) || (typeof place.priceLevel === "string" && !place.priceLevel.startsWith("PRICE_LEVEL_") ? place.priceLevel : null);
  if (priceDisplay) {
    if (metaRow.children.length > 0) metaRow.append(el("span", "·", "text-slate-600"));
    metaRow.append(el("span", priceDisplay, "font-bold text-emerald-400"));
  }
  if (place.openNow === true) {
    if (metaRow.children.length > 0) metaRow.append(el("span", "·", "text-slate-600"));
    metaRow.append(el("span", "Open now", "text-[10px] font-bold text-emerald-400"));
  } else if (place.openNow === false) {
    if (metaRow.children.length > 0) metaRow.append(el("span", "·", "text-slate-600"));
    metaRow.append(el("span", "Closed now", "text-[10px] font-bold text-slate-500"));
  }
  content.append(metaRow);

  // WHY GO Fact Box
  if (place.reason) {
    const whyBox = el("div", null, "bg-cyan-950/30 p-2 rounded-lg border border-cyan-500/20 text-xs space-y-0.5");
    whyBox.append(
      el("strong", "WHY GO", "block text-[9px] font-extrabold text-cyan-400 tracking-wider"),
      el("p", place.reason, "text-[11px] leading-relaxed text-slate-200"),
    );
    content.append(whyBox);
  }

  // CTA Button
  const ctaBtn = el("button", "SEE OPTIONS ↗", "go-mode-see-options-btn w-full py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs shadow-md shadow-cyan-950/30 active:scale-[0.98] transition-all cursor-pointer flex items-center justify-center min-h-[44px]");
  ctaBtn.type = "button";
  ctaBtn.addEventListener("click", () => onSelectPlace?.(place));
  content.append(ctaBtn);

  card.append(content);
  return card;
}

export function renderGoModeResults(journeyData, { people = 1, onArrived = null, advisor = null, doc = null } = {}) {
  const el = makeEl(doc);
  const container = el("div", null, "go-mode-results-container space-y-4");
  const model = recommendJourney(normalizeJourney(journeyData), people);

  // If verified routes are present
  if (model.routes && model.routes.length > 0) {
    const recommended =
      model.routes.find((r) => r.id === model.recommendedRouteId) ||
      model.routes[0];
    const otherRoutes = model.routes.filter((r) => r.id !== recommended.id);

    // Primary Hero Card — The Smart Recommendation
    const heroCard = el("article", null, "go-mode-hero-card p-4 rounded-2xl bg-slate-900 border-2 border-cyan-500/80 shadow-2xl shadow-cyan-950/40 space-y-3");

    const heroHeader = el("div", null, "flex items-center justify-between flex-wrap gap-2");
    const recPill = el("span", "★ BEST WAY TO GET THERE", "text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full bg-cyan-500 text-slate-950");
    const trustChip = el("span", recommended.source === "google_routes" ? "✓ Verified route" : "◆ Grounded estimate", `journey-trust-chip ${recommended.source === "google_routes" ? "journey-trust-verified" : "journey-trust-grounded"} text-[10px] font-bold px-2 py-0.5 rounded-full`);
    const provenance = getFareProvenance(recommended);
    const fareTrustChip = el("span", provenance.label, `fare-trust-chip ${provenance.badgeClass} text-[10px] font-bold px-2 py-0.5 rounded-full`);
    heroHeader.append(recPill, trustChip, fareTrustChip);
    heroCard.append(heroHeader);

    const titleRow = el("div", null, "flex items-baseline justify-between gap-2");
    const modeTitle = el("h3", recommended.label, "text-base font-extrabold text-white flex items-center gap-1.5");
    const fareBadge = el("span", fareLabel(recommended), "text-xs font-bold text-cyan-300 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800");
    titleRow.append(modeTitle, fareBadge);
    heroCard.append(titleRow);

    // Key Metrics (Time, Distance, Cost)
    const metricsGrid = el("div", null, "grid grid-cols-3 gap-2 py-1");
    const durationMin = recommended.durationMinutes !== null ? `${Math.ceil(recommended.durationMinutes)} min` : "—";
    const distKm = recommended.distanceMeters !== null ? `${(recommended.distanceMeters / 1000).toFixed(1)} km` : "—";

    const mTime = el("div", null, "bg-slate-950 p-2 rounded-xl border border-slate-800 text-center");
    mTime.append(el("span", "DURATION", "block text-[9px] font-bold text-slate-400"), el("strong", durationMin, "block text-sm font-extrabold text-white"));

    const mDist = el("div", null, "bg-slate-950 p-2 rounded-xl border border-slate-800 text-center");
    mDist.append(el("span", "DISTANCE", "block text-[9px] font-bold text-slate-400"), el("strong", distKm, "block text-sm font-extrabold text-white"));

    const mFare = el("div", null, "bg-slate-950 p-2 rounded-xl border border-slate-800 text-center");
    mFare.append(
      el("span", "FARE", "block text-[9px] font-bold text-slate-400"),
      el("strong", fareLabel(recommended), "block text-xs font-extrabold text-emerald-400 truncate"),
    );

    metricsGrid.append(mTime, mDist, mFare);
    heroCard.append(metricsGrid);

    // Deterministic Why Recommended
    const whyText = formatExplanation(recommended, model.routes, people);
    if (whyText) {
      const whyPara = el("p", whyText, "text-xs text-slate-300 leading-relaxed bg-cyan-950/30 p-2.5 rounded-xl border border-cyan-500/20");
      heroCard.append(whyPara);
    }

    // Action Buttons Row (START DIRECTIONS + I'M HERE)
    const actionsRow = el("div", null, "space-y-2 pt-1");

    const originPlace = recommended.origin || journeyData?.origin || "";
    const destPlace = recommended.destination || journeyData?.destination || "";
    const mapsUrl = buildGoogleMapsDirectionsUrl(originPlace, destPlace, { mode: recommended.mode });
    const directionsBtn = el("a", modeActionButtonLabel(recommended.mode), "go-mode-directions-btn block w-full text-center py-3 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 font-black text-xs rounded-xl shadow-lg shadow-emerald-950/40 transition-all cursor-pointer min-h-[44px] flex items-center justify-center");
    directionsBtn.href = mapsUrl || "#";
    directionsBtn.target = "_blank";
    directionsBtn.rel = "noopener noreferrer";
    directionsBtn.id = "goModeStartDirectionsBtn";
    actionsRow.append(directionsBtn);

    if (recommended.mode === "grab") {
      const grabLink = el("a", "CHECK LIVE GRAB FARE ↗", "block w-full text-center py-2 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 text-xs font-bold rounded-xl transition-all cursor-pointer");
      grabLink.href = GRAB_SAFE_URL;
      grabLink.target = "_blank";
      grabLink.rel = "noopener noreferrer";
      actionsRow.append(grabLink);
    }

    const hereBtn = el("button", "✓ I’m here (Mark arrived & pick next stop)", "go-mode-here-btn w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 min-h-[44px]");
    hereBtn.type = "button";
    hereBtn.id = "goModeHereBtn";
    hereBtn.addEventListener("click", () => onArrived?.(destPlace));
    actionsRow.append(hereBtn);

    heroCard.append(actionsRow);
    container.append(heroCard);

    // Other Options (Secondary Cards)
    if (otherRoutes.length > 0) {
      const otherSection = el("div", null, "space-y-2 pt-2");
      otherSection.append(el("h4", "Other Options", "text-xs font-extrabold text-slate-400 uppercase tracking-wider"));

      for (const route of otherRoutes) {
        const card = el("article", null, "go-mode-secondary-card p-3 rounded-xl bg-slate-950 border border-slate-800 hover:border-slate-700 transition-colors flex items-center justify-between gap-3");

        const left = el("div", null, "min-w-0 space-y-0.5");
        const heading = el("h5", route.label, "text-xs font-bold text-slate-200 flex items-center gap-1.5");
        const rProv = getFareProvenance(route);
        heading.append(el("span", rProv.label, `fare-trust-chip ${rProv.badgeClass} text-[9px]`));

        const details = el(
          "p",
          `${route.durationMinutes !== null ? `${Math.ceil(route.durationMinutes)} min` : "Time unknown"} · ${fareLabel(route)}${route.distanceMeters !== null ? ` · ${(route.distanceMeters / 1000).toFixed(1)} km` : ""}`,
          "text-[11px] text-slate-400",
        );
        left.append(heading, details);

        const right = el("div", null, "shrink-0 flex items-center gap-2");
        const rOrigin = route.origin || journeyData?.origin || "";
        const rDest = route.destination || journeyData?.destination || "";
        const rMapsUrl = buildGoogleMapsDirectionsUrl(rOrigin, rDest, { mode: route.mode });
        const dirBtn = el("a", "Maps ↗", "text-[11px] font-bold px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 transition-colors cursor-pointer min-h-[36px] flex items-center");
        dirBtn.href = rMapsUrl || "#";
        dirBtn.target = "_blank";
        dirBtn.rel = "noopener noreferrer";
        right.append(dirBtn);

        if (route.mode === "grab") {
          const gBtn = el("a", "Grab ↗", "text-[11px] font-bold px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 transition-colors cursor-pointer min-h-[36px] flex items-center");
          gBtn.href = GRAB_SAFE_URL;
          gBtn.target = "_blank";
          gBtn.rel = "noopener noreferrer";
          right.append(gBtn);
        }

        card.append(left, right);
        otherSection.append(card);
      }
      container.append(otherSection);
    }

    return container;
  }

  // If verified routes are empty but Grounded Advisor returned options
  if (advisor && (advisor.options?.length > 0 || advisor.status === "grounded")) {
    const advisorCard = el("article", null, "go-mode-hero-card p-4 rounded-2xl bg-slate-900 border-2 border-sky-500/80 shadow-2xl shadow-sky-950/40 space-y-3");

    const advisorHeader = el("div", null, "flex items-center justify-between flex-wrap gap-2");
    const chip = el("span", "◆ Grounded estimate", "journey-trust-chip journey-trust-grounded text-[10px] font-bold px-2 py-0.5 rounded-full");
    advisorHeader.append(el("span", "SaanTayo Route Intelligence", "text-[10px] font-bold text-sky-400 uppercase tracking-wider"), chip);
    advisorCard.append(advisorHeader);

    if (advisor.summary) {
      advisorCard.append(el("p", advisor.summary, "text-xs text-slate-300 leading-relaxed"));
    }

    // Render advisor options
    for (const opt of advisor.options || []) {
      const row = el("div", null, "p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5");
      const rHead = el("div", null, "flex items-center justify-between");
      rHead.append(el("strong", opt.label, "text-xs font-bold text-white"), el("span", opt.mode === advisor.recommendedMode ? "Recommended" : "", "text-[10px] text-sky-300 font-bold"));
      row.append(rHead);
      if (opt.why) row.append(el("p", opt.why, "text-[11px] text-slate-400"));

      const resolvedOrigin = advisor.resolvedOrigin || journeyData.origin;
      const resolvedDestination = advisor.resolvedDestination || journeyData.destination;
      const navUrl = buildGoogleMapsDirectionsUrl(resolvedOrigin, resolvedDestination, { mode: opt.mode });
      const navBtn = el("a", modeActionButtonLabel(opt.mode), "inline-block text-center text-xs font-bold py-2 px-3 rounded-lg bg-sky-900/60 hover:bg-sky-800 text-sky-200 border border-sky-500/40 transition-colors");
      navBtn.href = navUrl || "#";
      navBtn.target = "_blank";
      navBtn.rel = "noopener noreferrer";
      row.append(navBtn);
      advisorCard.append(row);
    }

    const hereBtn = el("button", "✓ I’m here (Mark arrived & pick next stop)", "go-mode-here-btn w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 min-h-[44px]");
    hereBtn.type = "button";
    hereBtn.addEventListener("click", () => onArrived?.(advisor.resolvedDestination || journeyData.destination));
    advisorCard.append(hereBtn);

    container.append(advisorCard);
    return container;
  }

  // Empty state
  const empty = el("div", null, "p-4 rounded-xl bg-slate-900 border border-slate-800 text-center space-y-2");
  empty.append(
    el("p", "SaanTayo could not build a route between these specific places yet.", "text-xs text-slate-300 font-medium"),
    el("p", "Try using a more specific landmark name or address, then search again.", "text-[11px] text-slate-500"),
  );
  container.append(empty);
  return container;
}

export function initGoMode({
  dialog,
  form,
  originInput,
  destinationInput,
  quickSelect,
  originChipsContainer,
  resultsContainer,
  statusContainer,
  arrivalBanner,
  arrivalText,
  getCurrentTrip = () => null,
  getSavedItems = () => [],
  getPlanText = () => "",
  lookupJourney = null,
  fetchPlaces = null,
  fetchPlaceDetails = null,
  toast = () => {},
  storage = typeof localStorage !== "undefined" ? localStorage : null,
} = {}) {
  let currentController = null;
  let discoveryController = null;
  let discoverySeq = 0;
  let lastLookupData = null;
  let currentCoords = null;
  let currentIntent = "explore";
  let currentSubPref = null;

  const doc = dialog?.ownerDocument || (typeof document !== "undefined" ? document : null);
  const el = makeEl(doc);
  const win = doc?.defaultView || (typeof window !== "undefined" ? window : null);
  const nav = win?.navigator || (typeof navigator !== "undefined" ? navigator : null);

  // V3.3 DOM queries inside dialog
  const useLocationBtn = dialog?.querySelector("#goModeUseLocationBtn");
  const currentLocationLabel = dialog?.querySelector("#goModeCurrentLocationLabel");
  const intentGrid = dialog?.querySelector("#goModeIntentGrid");
  const foodChipsContainer = dialog?.querySelector("#goModeFoodChips");
  const placesSection = dialog?.querySelector("#goModePlacesSection");
  const placesContainer = dialog?.querySelector("#goModePlacesContainer");
  const routeView = dialog?.querySelector("#goModeRouteView");
  const backToPlacesBtn = dialog?.querySelector("#goModeBackToPlacesBtn");
  const selectedPlaceBadge = dialog?.querySelector("#goModeSelectedPlaceBadge");
  const manualDetails = dialog?.querySelector("#goModeManualDetails");

  function refreshOriginChips(lastArrived = "") {
    if (!originChipsContainer) return;
    originChipsContainer.replaceChildren();

    const trip = getCurrentTrip();
    const saved = getSavedItems();
    const origins = collectGoModeOrigins({ currentTrip: trip, savedItems: saved, lastArrived });

    if (!origins.length) return;

    for (const item of origins.slice(0, 4)) {
      const chip = el("button", item.label, "go-mode-chip text-[11px] font-semibold px-2.5 py-1 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors cursor-pointer shrink-0 truncate max-w-[170px]");
      chip.type = "button";
      chip.title = `${item.label} (${item.badge})`;
      chip.addEventListener("click", () => {
        if (originInput) originInput.value = item.value;
        if (currentLocationLabel) currentLocationLabel.textContent = item.label;
        saveSessionState();
        // If this place is selected as origin, execute discovery nearby
        executeDiscovery({ intent: currentIntent, subPreference: currentSubPref });
      });
      originChipsContainer.append(chip);
    }
  }

  function refreshDestinationOptions() {
    if (!quickSelect) return;
    quickSelect.replaceChildren();

    const defaultOpt = el("option", "Choose saved place…");
    defaultOpt.value = "";
    quickSelect.append(defaultOpt);

    const trip = getCurrentTrip();
    const saved = getSavedItems();
    const plan = getPlanText();
    const destinations = collectGoModeDestinations({ currentTrip: trip, savedItems: saved, planText: plan });

    for (const item of destinations) {
      const opt = el("option", item.label);
      opt.value = item.value;
      quickSelect.append(opt);
    }
  }

  function saveSessionState() {
    const trip = getCurrentTrip();
    writeGoModeState(storage, {
      tripId: trip?.id || "",
      origin: originInput?.value || "",
      destination: destinationInput?.value || "",
      lastArrived: arrivalText?.dataset?.arrivedPlace || "",
      coords: currentCoords,
      intent: currentIntent,
    });
  }

  function restoreSessionState() {
    const state = readGoModeState(storage);
    const trip = getCurrentTrip();

    refreshDestinationOptions();

    if (state) {
      if (state.lastArrived) {
        setArrivalState(state.lastArrived);
      } else {
        refreshOriginChips();
      }

      if (state.origin && originInput && !originInput.value) {
        originInput.value = state.origin;
        if (currentLocationLabel) currentLocationLabel.textContent = state.origin;
      }

      if (state.destination && destinationInput && !destinationInput.value) {
        destinationInput.value = state.destination;
      }

      if (state.coords && typeof state.coords.latitude === "number") {
        currentCoords = state.coords;
      }

      if (state.intent) {
        currentIntent = state.intent;
        updateActiveIntentButton(state.intent);
      }
    } else {
      if (trip?.trip?.origin && originInput && !originInput.value) {
        originInput.value = trip.trip.origin;
        if (currentLocationLabel) currentLocationLabel.textContent = trip.trip.origin;
      }
      refreshOriginChips();
    }
  }

  function setArrivalState(arrivedPlace) {
    if (!arrivedPlace) return;
    if (originInput) originInput.value = arrivedPlace;
    if (destinationInput) destinationInput.value = "";
    if (quickSelect) quickSelect.value = "";
    if (currentLocationLabel) currentLocationLabel.textContent = arrivedPlace;

    if (arrivalBanner && arrivalText) {
      arrivalBanner.classList.remove("hidden");
      arrivalText.textContent = `You’re at ${arrivedPlace}. Where to next?`;
      arrivalText.dataset.arrivedPlace = arrivedPlace;
    }

    refreshOriginChips(arrivedPlace);
    saveSessionState();
  }

  function updateActiveIntentButton(intent) {
    if (!intentGrid) return;
    for (const btn of intentGrid.querySelectorAll(".go-mode-intent-btn")) {
      if (btn.dataset.intent === intent) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    }
    if (foodChipsContainer) {
      if (intent === "eat") {
        foodChipsContainer.classList.remove("hidden");
      } else {
        foodChipsContainer.classList.add("hidden");
      }
    }
  }

  // Geolocation handling — STRICTLY on explicit user tap
  function requestUserLocation() {
    if (!nav?.geolocation) {
      if (statusContainer) {
        statusContainer.textContent = "Location is not supported by your browser. Enter your location below.";
      }
      return;
    }

    if (statusContainer) {
      statusContainer.textContent = "Getting current location…";
    }

    nav.geolocation.getCurrentPosition(
      (pos) => {
        currentCoords = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        };
        if (currentLocationLabel) {
          currentLocationLabel.textContent = "📍 Current location";
        }
        if (originInput) {
          originInput.value = "Current location";
        }
        saveSessionState();
        executeDiscovery({ intent: currentIntent, subPreference: currentSubPref });
      },
      (err) => {
        currentCoords = null;
        if (statusContainer) {
          statusContainer.textContent = "Location permission not granted. Choose your hotel or enter where you are.";
        }
        if (manualDetails) {
          manualDetails.open = true;
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      },
    );
  }

  async function executeDiscovery({ intent = currentIntent, subPreference = currentSubPref, coords = null } = {}) {
    currentIntent = intent;
    currentSubPref = subPreference;
    updateActiveIntentButton(intent);

    const seq = ++discoverySeq;

    // If offline: Live discovery requires internet
    if (nav && nav.onLine === false) {
      if (statusContainer) {
        statusContainer.textContent = "Nearby suggestions and live routes require internet. Your saved trip places remain accessible.";
      }
      return;
    }

    let searchCoords = coords || currentCoords;
    if (!searchCoords) {
      // Fallback coordinate mapping for common known bases in Philippines
      const originText = (originInput?.value || "").toLowerCase();
      const trip = getCurrentTrip();
      const destText = (trip?.trip?.destination || trip?.destination || "").toLowerCase();
      const context = `${originText} ${destText}`;

      if (/cebu|it park|mactan|lahug/i.test(context)) {
        searchCoords = { latitude: 10.3157, longitude: 123.8854 };
      } else {
        // Default Manila / Rizal Park area
        searchCoords = { latitude: 14.5839, longitude: 120.9794 };
      }
    }

    if (discoveryController) {
      discoveryController.abort();
    }
    const controller = new AbortController();
    discoveryController = controller;

    if (statusContainer) {
      statusContainer.textContent = `Finding nearby ${intent} options…`;
    }
    if (placesContainer) {
      placesContainer.replaceChildren(
        el("div", `Loading ${intent} recommendations…`, "p-4 text-center text-xs text-slate-400"),
      );
    }

    try {
      const tripContext = getSavedItems();
      let data = null;

      if (typeof fetchPlaces === "function") {
        data = await fetchPlaces({
          latitude: searchCoords.latitude,
          longitude: searchCoords.longitude,
          intent,
          subPreference,
          radiusMeters: 2500,
          tripContext,
        }, controller.signal);
      } else {
        const res = await fetch("/api/places/nearby", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            latitude: searchCoords.latitude,
            longitude: searchCoords.longitude,
            intent,
            subPreference,
            radius: 2500,
            tripContext,
          }),
          signal: controller.signal,
        });
        data = await res.json();
      }

      if (controller.signal.aborted || seq !== discoverySeq) return;

      if (data?.status === "provider_unavailable") {
        if (statusContainer) {
          statusContainer.textContent = data.warnings?.[0] || "Places API is currently disabled. Use saved places or enter destination.";
        }
        if (placesContainer) {
          const warnBox = el("div", null, "p-4 rounded-xl bg-slate-900 border border-slate-800 text-center space-y-2");
          warnBox.append(
            el("p", "Google Places API (New) is not enabled on this project.", "text-xs font-bold text-amber-300"),
            el("p", "You can choose from your saved trip places below or enter a destination manually.", "text-[11px] text-slate-400"),
          );
          placesContainer.replaceChildren(warnBox);
        }
        return;
      }

      const places = Array.isArray(data?.places) ? data.places : [];
      if (!places.length) {
        if (statusContainer) {
          statusContainer.textContent = "No nearby places found for this category. Try another intent.";
        }
        if (placesContainer) {
          placesContainer.replaceChildren(
            el("div", "No nearby spots found. Try another category.", "p-4 text-center text-xs text-slate-400"),
          );
        }
        return;
      }

      if (statusContainer) {
        statusContainer.textContent = `Showing ${places.length} nearby recommendations. Tap one to get there.`;
      }

      if (placesContainer) {
        placesContainer.replaceChildren();
        for (const place of places) {
          const card = renderPlaceCard(place, {
            doc,
            onSelectPlace: (selected) => {
              selectPlaceAndRoute(selected);
            },
          });
          placesContainer.append(card);
        }
      }
    } catch (err) {
      if (controller.signal.aborted || seq !== discoverySeq) return;
      if (statusContainer) {
        statusContainer.textContent = "Unable to load nearby places. Check connection or search below.";
      }
    } finally {
      if (discoveryController === controller) {
        discoveryController = null;
      }
    }
  }

  function selectPlaceAndRoute(place) {
    if (!place) return;
    if (destinationInput) destinationInput.value = place.name;
    if (selectedPlaceBadge) selectedPlaceBadge.textContent = place.name;

    // Switch view to route comparison
    if (placesSection) placesSection.classList.add("hidden");
    if (routeView) routeView.classList.remove("hidden");

    // 1. Immediately start route search (never blocked by place details)
    executeRouteSearch();

    // 2. On-demand: Fetch richer Place Details for this ONE selected place
    const placeId = place.providerPlaceId || place.id;
    if (placeId && typeof fetchPlaceDetails === "function") {
      fetchPlaceDetails({ placeId })
        .then((res) => {
          if (res?.status === "ok" && res.details) {
            if (res.details.rating !== null) place.rating = res.details.rating;
            if (res.details.reviewCount !== null) place.reviewCount = res.details.reviewCount;
            if (res.details.priceLevel !== null) place.priceLevel = res.details.priceLevel;
            if (res.details.openNow !== null) place.openNow = res.details.openNow;
            if (selectedPlaceBadge && place.rating) {
              selectedPlaceBadge.textContent = `${place.name} (★ ${place.rating.toFixed(1)})`;
            }
          }
        })
        .catch(() => {
          // Failure must never block routing
        });
    }
  }

  // Event wiring
  useLocationBtn?.addEventListener("click", () => {
    requestUserLocation();
  });

  intentGrid?.addEventListener("click", (e) => {
    const btn = e.target.closest(".go-mode-intent-btn");
    if (!btn || !btn.dataset.intent) return;
    executeDiscovery({ intent: btn.dataset.intent, subPreference: null });
  });

  foodChipsContainer?.addEventListener("click", (e) => {
    const chip = e.target.closest(".go-mode-food-chip");
    if (!chip || !chip.dataset.pref) return;
    for (const c of foodChipsContainer.querySelectorAll(".go-mode-food-chip")) {
      c.classList.remove("active");
    }
    chip.classList.add("active");
    executeDiscovery({ intent: "eat", subPreference: chip.dataset.pref });
  });

  backToPlacesBtn?.addEventListener("click", () => {
    if (routeView) routeView.classList.add("hidden");
    if (placesSection) placesSection.classList.remove("hidden");
    if (statusContainer) {
      statusContainer.textContent = "Returned to suggestions.";
    }
  });

  quickSelect?.addEventListener("change", () => {
    if (quickSelect.value) {
      destinationInput.value = quickSelect.value;
      saveSessionState();
      destinationInput.focus();
    }
  });

  originInput?.addEventListener("input", () => {
    if (currentLocationLabel) currentLocationLabel.textContent = originInput.value || "Select location";
    saveSessionState();
  });
  destinationInput?.addEventListener("input", () => saveSessionState());

  async function executeRouteSearch() {
    const origin = (originInput?.value || "").trim();
    const destination = (destinationInput?.value || "").trim();

    if (!origin || !destination) {
      if (statusContainer) {
        statusContainer.textContent = "Please enter where you are now and where you want to go.";
      }
      return;
    }

    if (origin.toLowerCase() === destination.toLowerCase()) {
      if (statusContainer) {
        statusContainer.textContent = "Your origin and destination are the same place.";
      }
      return;
    }

    // Offline check: Live routing requires internet
    if (nav && nav.onLine === false) {
      if (statusContainer) {
        statusContainer.textContent = "You are offline. Live route comparison requires internet, but your saved trip places remain accessible.";
      }
      return;
    }

    if (currentController) {
      currentController.abort();
    }

    const controller = new AbortController();
    currentController = controller;
    const findBtn = form?.querySelector("button[type=submit]");
    if (findBtn) findBtn.disabled = true;

    if (statusContainer) {
      statusContainer.textContent = "Comparing Walk, Grab, and Transit options…";
    }
    if (resultsContainer) {
      resultsContainer.replaceChildren();
    }

    const trip = getCurrentTrip();
    const people = trip?.trip?.people || 1;
    const departureTime = departureISO("now", null);

    try {
      const response = await lookupJourney(
        {
          origin,
          destination,
          departureTime,
          people,
        },
        controller.signal,
      );

      if (controller.signal.aborted) return;

      lastLookupData = response;

      const results = renderGoModeResults(response.journey, {
        people,
        advisor: response.advisor,
        doc,
        onArrived: (destinationName) => {
          setArrivalState(destinationName);
          resultsContainer?.replaceChildren();
          if (statusContainer) {
            statusContainer.textContent = `Arrived at ${destinationName}. Ready for your next stop.`;
          }
          toast(`Arrived at ${destinationName}! Where to next?`);
        },
      });

      if (resultsContainer) {
        resultsContainer.replaceChildren(results);
      }

      if (statusContainer) {
        const hasVerified = response.journey?.routes?.length > 0;
        statusContainer.textContent = hasVerified
          ? "SaanTayo selected the practical option. Tap START DIRECTIONS to navigate in Google Maps."
          : response.advisor?.status === "grounded"
            ? "Grounded estimate found. Tap to navigate in Google Maps."
            : "Review options below.";
      }

      saveSessionState();
    } catch (err) {
      if (controller.signal.aborted) return;
      if (statusContainer) {
        statusContainer.textContent = err.message || "Route search unavailable. Check your connection or place names.";
      }
    } finally {
      if (currentController === controller) {
        currentController = null;
        if (findBtn) findBtn.disabled = false;
      }
    }
  }

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    executeRouteSearch();
  });

  return {
    open() {
      restoreSessionState();
      if (typeof dialog?.showModal === "function") {
        dialog.showModal();
      } else if (dialog) {
        dialog.open = true;
      }
      // Trigger initial discovery on open if places container is empty
      if (placesContainer && !placesContainer.hasChildNodes()) {
        executeDiscovery({ intent: currentIntent, subPreference: currentSubPref });
      }
    },
    close() {
      if (typeof dialog?.close === "function") {
        dialog.close();
      } else if (dialog) {
        dialog.open = false;
      }
    },
    refresh() {
      restoreSessionState();
    },
    executeRouteSearch,
    executeDiscovery,
    requestUserLocation,
    selectPlaceAndRoute,
    setArrivalState,
  };
}
