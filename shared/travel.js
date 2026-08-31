export const CATEGORIES = [
  "accommodation",
  "local_transport",
  "intercity_transport",
  "activities",
  "food",
  "miscellaneous",
];
export const VIBES = [
  "Pristine Beaches & Clear Water",
  "Adventures & Active Thrills",
  "Must-Try Food & Local Eats",
  "Local Hidden Gems",
  "Historic Landmarks & Heritage",
];
export const PARTIES = [
  "Couple / Partner",
  "Solo Traveler",
  "Family with Kids",
  "Friends Group",
];
export const STAY_TYPES = [
  { id: "all", label: "All Accommodations" },
  { id: "hotel", label: "Hotels Only" },
  { id: "rental", label: "Airbnb / Vacation Rentals" },
  { id: "resort_hostel", label: "Resorts / Hostels" },
];
export const STAY_TYPE_IDS = STAY_TYPES.map((s) => s.id);

export class AppError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
export function textValue(value, label, max, optional = false) {
  if (optional && (value == null || value === "")) return "";
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new AppError(
      "INVALID_INPUT",
      `${label} must be between 1 and ${max} characters.`,
    );
  return value.trim();
}
export function numberValue(value, label, min, max, integer = false) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    throw new AppError(
      "INVALID_INPUT",
      `${label} must be ${integer ? "a whole number " : ""}between ${min} and ${max}.`,
    );
  return value;
}
export function civilDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || ""))
    throw new AppError("INVALID_DATES", "Use valid start and end dates.");
  const date = new Date(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new AppError("INVALID_DATES", "Use valid calendar dates.");
  return date.getTime() / 86400000;
}
export function tripDays(start, end, flexibleDays = 3) {
  if (!start && !end)
    return numberValue(flexibleDays, "Trip days", 1, 21, true);
  const days = civilDay(end) - civilDay(start) + 1;
  if (days < 1 || days > 21)
    throw new AppError(
      "INVALID_DATES",
      "Choose an end date on or after the start, up to 21 days.",
    );
  return days;
}
export function validateTrip(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new AppError("INVALID_INPUT", "Trip details are required.");
  const mode = raw.mode || "itinerary";
  if (!["itinerary", "compare", "research"].includes(mode))
    throw new AppError("INVALID_INPUT", "Choose a valid planning mode.");
  const destination = textValue(raw.destination, "Destination", 200);
  const destinationB = textValue(
    raw.destinationB,
    "Second destination",
    200,
    mode !== "compare",
  );
  if (
    mode === "compare" &&
    destination.toLowerCase() === destinationB.toLowerCase()
  )
    throw new AppError("INVALID_INPUT", "Choose two different destinations.");
  const start = raw.start || "",
    end = raw.end || "";
  const days = tripDays(start, end, raw.days ?? 3);
  const people = numberValue(raw.people ?? 2, "Travellers", 1, 20, true);
  const party = PARTIES.includes(raw.party) ? raw.party : PARTIES[0];
  const stayType = STAY_TYPE_IDS.includes(raw.stayType) ? raw.stayType : "all";
  const vibes = Array.isArray(raw.vibes)
    ? [...new Set(raw.vibes.filter((v) => VIBES.includes(v)))]
    : [];
  const budgets = {};
  for (const key of ["total", "hotel", "transit", "activities"]) {
    const value = raw.budgets?.[key];
    budgets[key] =
      value == null || value === ""
        ? null
        : numberValue(value, `${key} budget in PHP`, 0, 10000000);
  }
  return {
    mode,
    destination,
    destinationB,
    start,
    end,
    days,
    nights: days - 1,
    people,
    party,
    stayType,
    vibes,
    budgets,
    strict: raw.strict === true,
    free: raw.free !== false,
    currency: raw.currency === "PHP" ? "PHP" : "PHP_CAD",
    origin: textValue(raw.origin, "Arrival base", 200, true),
    question: textValue(
      raw.question,
      "Research question",
      3000,
      mode !== "research",
    ),
  };
}
export function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function buildProviderSearchUrl(
  provider,
  { destination, start = "", end = "", people = 2 } = {},
) {
  const dest = (destination || "").trim();
  if (!dest) return null;
  const count = Number.isInteger(people) && people > 0 ? people : 2;
  const hasDates = Boolean(
    start &&
      end &&
      /^\d{4}-\d{2}-\d{2}$/.test(start) &&
      /^\d{4}-\d{2}-\d{2}$/.test(end),
  );

  let rawUrl = "";
  switch (provider) {
    case "airbnb": {
      const query = encodeURIComponent(dest);
      const params = new URLSearchParams();
      params.set("adults", String(count));
      if (hasDates) {
        params.set("checkin", start);
        params.set("checkout", end);
      }
      rawUrl = `https://www.airbnb.com/s/${query}/homes?${params.toString()}`;
      break;
    }
    case "expedia": {
      const params = new URLSearchParams();
      params.set("destination", dest);
      params.set("adults", String(count));
      if (hasDates) {
        params.set("startDate", start);
        params.set("endDate", end);
      }
      rawUrl = `https://www.expedia.com/Hotel-Search?${params.toString()}`;
      break;
    }
    case "agoda": {
      const params = new URLSearchParams();
      params.set("text", dest);
      params.set("adults", String(count));
      params.set("rooms", "1");
      if (hasDates) {
        params.set("checkIn", start);
        params.set("checkOut", end);
      }
      rawUrl = `https://www.agoda.com/search?${params.toString()}`;
      break;
    }
    case "kayak": {
      const encodedDest = encodeURIComponent(dest);
      if (hasDates) {
        rawUrl = `https://www.kayak.com/hotels/${encodedDest}/${start}/${end}/${count}adults`;
      } else {
        rawUrl = `https://www.kayak.com/hotels/${encodedDest}?guests=${count}`;
      }
      break;
    }
    case "trivago": {
      const params = new URLSearchParams();
      params.set("search", dest);
      params.set("adults", String(count));
      if (hasDates) {
        params.set("checkin", start);
        params.set("checkout", end);
      }
      rawUrl = `https://www.trivago.com/en-US/srl?${params.toString()}`;
      break;
    }
    default:
      return null;
  }
  return safeUrl(rawUrl);
}
export function buildAllProviderLinks(params) {
  const providers = [
    { id: "airbnb", name: "Airbnb", badge: "Vacation Rentals" },
    { id: "expedia", name: "Expedia", badge: "Hotels & Packages" },
    { id: "agoda", name: "Agoda", badge: "Asia Top Deals" },
    { id: "kayak", name: "Kayak", badge: "Hotel Meta" },
    { id: "trivago", name: "Trivago", badge: "Price Comparison" },
  ];
  return providers
    .map((p) => ({
      ...p,
      url: buildProviderSearchUrl(p.id, params),
    }))
    .filter((p) => p.url != null);
}

export const TRANSIT_MODES = [
  "Grab",
  "Jeepney",
  "Tricycle",
  "Ferry",
  "Bus",
  "Train",
];

export function stripTransitBlock(text) {
  if (typeof text !== "string") return "";
  return text.replace(/```(?:transit|json:transit)[\s\S]*?```/gi, "").trim();
}

export function parseTransitLegs(
  text,
  { origin = "", destination = "Destination" } = {},
) {
  const result = [];
  if (typeof text === "string" && text) {
    const transitMatch =
      text.match(/```(?:transit|json:transit)\s*([\s\S]*?)\s*```/i) ||
      text.match(/```json\s*(\[\s*\{[\s\S]*?"mode"[\s\S]*?\}\s*\])\s*```/i) ||
      text.match(/\[\s*\{[\s\S]*?"mode"[\s\S]*?"route"[\s\S]*?\}\s*\]/i);
    if (transitMatch) {
      try {
        const rawJson = JSON.parse(transitMatch[1] || transitMatch[0]);
        if (Array.isArray(rawJson)) {
          for (const item of rawJson) {
            if (item && typeof item === "object") {
              const rawMode = String(item.mode || "").trim();
              const matchedMode =
                TRANSIT_MODES.find(
                  (m) => m.toLowerCase() === rawMode.toLowerCase(),
                ) ||
                rawMode ||
                "Jeepney";
              result.push({
                mode: matchedMode,
                route:
                  textValue(item.route, "Route", 300, true) ||
                  `${origin || "Base"} to ${destination}`,
                estimatedFarePHP:
                  textValue(item.estimatedFarePHP, "Estimated fare", 100, true) ||
                  "₱50 - ₱150",
                paymentMethod:
                  textValue(item.paymentMethod, "Payment method", 100, true) ||
                  "Cash only",
                localTip:
                  textValue(item.localTip, "Local tip", 500, true) ||
                  "Confirm fare before boarding.",
              });
            }
          }
        }
      } catch {}
    }
  }

  if (!result.length) {
    const dest = (destination || "Local Area").trim();
    const orig = (origin || "Arrival Hub").trim();
    result.push(
      {
        mode: "Grab",
        route: `${orig} to ${dest} City Center`,
        estimatedFarePHP: "₱250 - ₱450",
        paymentMethod: "GCash / GrabPay / Cash",
        localTip:
          "Best for fixed fares, airport pickups, and air-conditioned travel.",
      },
      {
        mode: "Jeepney",
        route: `${dest} Main Highway & Landmark Loop`,
        estimatedFarePHP: "₱15 - ₱30",
        paymentMethod: "Cash only (exact change preferred)",
        localTip:
          "Pass your fare forward saying 'Bayad po' and tap the ceiling or say 'Para po' to alight.",
      },
      {
        mode: "Tricycle",
        route: `${dest} Local Town Center / Beach Access`,
        estimatedFarePHP: "₱50 - ₱150",
        paymentMethod: "Cash only",
        localTip:
          "Negotiate special trip vs regular route fare before getting in.",
      },
    );
  }
  return result;
}

export function buildTransitLinks(origin, destination) {
  const from = (origin || "").trim();
  const to = (destination || "").trim();
  const target = to || from || "Philippines";

  const sakayUrl =
    from && to
      ? `https://sakay.ph/?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      : `https://sakay.ph/?to=${encodeURIComponent(target)}`;

  const twelveGoUrl =
    from && to
      ? `https://12go.asia/en/travel?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      : `https://12go.asia/en/travel?z=${encodeURIComponent(target)}`;

  const klookUrl = `https://www.klook.com/en-PH/search/result/?query=${encodeURIComponent(target + " transfer")}`;
  const grabUrl = "https://www.grab.com/ph/transport/";

  const mapsUrl =
    from && to
      ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(from)}&destination=${encodeURIComponent(to)}&travelmode=transit`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(target + " transit terminal")}`;

  const links = [
    {
      id: "sakay",
      name: "Sakay.ph",
      badge: "Metro Commute & Jeepneys",
      url: safeUrl(sakayUrl),
    },
    {
      id: "grab",
      name: "Grab Transport",
      badge: "Book Fixed Fare Ride",
      url: safeUrl(grabUrl),
    },
    {
      id: "twelvego",
      name: "12Go Asia",
      badge: "Buses, Ferries & Vans",
      url: safeUrl(twelveGoUrl),
    },
    {
      id: "klook",
      name: "Klook Transfers",
      badge: "Island Ferries & Private Cars",
      url: safeUrl(klookUrl),
    },
    {
      id: "maps",
      name: "Google Maps Transit",
      badge: "Live Schedules & Routes",
      url: safeUrl(mapsUrl),
    },
  ];

  return links.filter((l) => l.url != null);
}
export function validateCosts(value) {
  if (
    !value ||
    !Array.isArray(value.items) ||
    value.items.length > 100 ||
    !Array.isArray(value.missing) ||
    !Array.isArray(value.assumptions)
  )
    throw new AppError(
      "INVALID_COSTS",
      "The cost estimate was incomplete. Your itinerary is still available.",
      502,
    );
  const items = value.items.map((row) => {
    if (
      !CATEGORIES.includes(row.category) ||
      ![
        "group_once",
        "person_once",
        "group_day",
        "person_day",
        "group_night",
        "person_night",
      ].includes(row.basis)
    )
      throw new AppError(
        "INVALID_COSTS",
        "The cost units could not be verified. Your itinerary is still available.",
        502,
      );
    return {
      label: textValue(row.label, "Cost label", 160),
      category: row.category,
      basis: row.basis,
      unitPHP: numberValue(row.unitPHP, "Estimated unit cost", 0, 10000000),
      quantity: numberValue(row.quantity, "Quantity", 1, 100, true),
    };
  });
  return {
    items,
    missing: value.missing.filter((x) => CATEGORIES.includes(x)),
    assumptions: value.assumptions
      .slice(0, 15)
      .map((x) => textValue(x, "Assumption", 500)),
  };
}
export function calculateBudget(costs, trip) {
  const clean = validateCosts(costs);
  const categories = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  const items = clean.items.map((row) => {
    const people = row.basis.startsWith("person_") ? trip.people : 1;
    const duration = row.basis.endsWith("_day")
      ? trip.days
      : row.basis.endsWith("_night")
        ? trip.nights
        : 1;
    const cents =
      Math.round(row.unitPHP * 100) * row.quantity * people * duration;
    if (!Number.isSafeInteger(cents))
      throw new AppError(
        "INVALID_COSTS",
        "Cost estimate is outside the supported range.",
      );
    categories[row.category] += cents;
    return {
      ...row,
      units: row.quantity * people * duration,
      totalPHP: cents / 100,
    };
  });
  const totalCents = Object.values(categories).reduce((a, b) => a + b, 0);
  const totalPHP = totalCents / 100;
  const missing = [
    ...new Set([
      ...clean.missing,
      ...CATEGORIES.filter((c) => !items.some((i) => i.category === c)),
    ]),
  ];
  const caps = trip.budgets || {};
  const exceeded = [];
  if (caps.total != null && totalPHP > caps.total)
    exceeded.push("overall budget");
  if (
    caps.transit != null &&
    (categories.local_transport + categories.intercity_transport) / 100 >
      caps.transit
  )
    exceeded.push("transport cap");
  if (caps.activities != null && categories.activities / 100 > caps.activities)
    exceeded.push("activities cap");
  // Compare the highest nightly group requirement, not an average that could hide an expensive night.
  const nightly = items
    .filter((i) => i.category === "accommodation" && i.basis.endsWith("_night"))
    .reduce(
      (sum, i) =>
        sum +
        i.unitPHP *
          i.quantity *
          (i.basis.startsWith("person") ? trip.people : 1),
      0,
    );
  if (caps.hotel != null && nightly > caps.hotel)
    exceeded.push("nightly accommodation cap");
  return {
    items,
    categories: Object.fromEntries(
      Object.entries(categories).map(([k, v]) => [k, v / 100]),
    ),
    totalPHP,
    perPersonPHP: Math.round(totalCents / trip.people) / 100,
    perDayPHP: Math.round(totalCents / trip.days) / 100,
    remainingPHP:
      caps.total == null
        ? null
        : Math.round(caps.total * 100 - totalCents) / 100,
    missing,
    exceeded,
    assumptions: clean.assumptions,
  };
}

export const SHEETS_API_URL =
  "https://script.google.com/macros/s/AKfycbxOlR4xCYpwFW7lV9PF55ljYCpiPvKT3GHtfYjgzYUFz7M5y1HAdO2vZF7nhO3IEVup1g/exec";

export function escapeSpreadsheetFormula(value) {
  if (typeof value !== "string") return value;
  if (/^[=+\-@]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

export function sanitizeSheetsPayload(payload) {
  if (payload == null) return payload;
  if (typeof payload === "string") {
    try {
      const parsed = JSON.parse(payload);
      if (parsed && typeof parsed === "object") {
        return JSON.stringify(sanitizeSheetsPayload(parsed));
      }
    } catch {}
    return escapeSpreadsheetFormula(payload);
  }
  if (Array.isArray(payload)) {
    return payload.map(sanitizeSheetsPayload);
  }
  if (typeof payload === "object") {
    const sanitized = {};
    for (const [key, val] of Object.entries(payload)) {
      sanitized[key] = sanitizeSheetsPayload(val);
    }
    return sanitized;
  }
  return payload;
}

export const ITEM_TYPES = [
  "stay",
  "food",
  "transport",
  "activity",
  "flight",
  "note",
];

export function canonicalizeSavedItem(raw, fallbackTripId = "") {
  if (!raw || typeof raw !== "object") return null;

  const itemId = String(
    raw.itemId ||
      raw.ItemID ||
      raw.ItemId ||
      raw.stayId ||
      raw.StayID ||
      raw.StayId ||
      raw.id ||
      raw.ID ||
      crypto.randomUUID(),
  );
  const tripId = String(raw.tripId || raw.TripID || fallbackTripId || "");
  const createdAt = raw.createdAt || raw.CreatedAt || new Date().toISOString();

  let itemType = String(raw.itemType || raw.ItemType || "").toLowerCase().trim();
  if (!itemType || !ITEM_TYPES.includes(itemType)) {
    if (raw.hotelName || raw.HotelName || raw.stayType) {
      itemType = "stay";
    } else if (raw.spotName || raw.mustTryDish) {
      itemType = "food";
    } else if (raw.route || raw.mode || raw.fare) {
      itemType = "transport";
    } else if (raw.bestFor || raw.duration || raw.bookingTip || raw.activityName) {
      itemType = "activity";
    } else {
      itemType = "stay";
    }
  }

  const name = String(
    raw.name ||
      raw.Name ||
      raw.hotelName ||
      raw.HotelName ||
      raw.spotName ||
      raw.activityName ||
      raw.route ||
      raw.title ||
      "Saved Item",
  );

  const location = String(
    raw.location || raw.Location || raw.neighborhood || "",
  );

  const category = String(
    raw.category ||
      raw.Category ||
      raw.type ||
      raw.mode ||
      (itemType === "stay"
        ? "Hotel"
        : itemType === "food"
          ? "Restaurant"
          : itemType === "activity"
            ? "Activity"
            : "Transit"),
  );

  const price = String(
    raw.price ||
      raw.Price ||
      raw.estimatedPrice ||
      raw.estimatedPricePHP ||
      raw.estimatedCostPHP ||
      raw.estimatedFarePHP ||
      raw.badge ||
      "Live rates",
  );

  const link =
    raw.link || raw.Link || raw.url || raw.searchUrl || raw.mapsUrl || "";

  const savedBy = String(raw.savedBy || raw.SavedBy || "Glen");
  const status = String(raw.status || raw.Status || "Shortlisted");

  let details = {};
  if (raw.details && typeof raw.details === "object") {
    details = raw.details;
  } else if (raw.detailsJSON || raw.DetailsJSON) {
    try {
      const parsed = JSON.parse(raw.detailsJSON || raw.DetailsJSON);
      if (parsed && typeof parsed === "object") details = parsed;
    } catch {}
  } else {
    if (raw.mustTryDish) details.mustTryDish = raw.mustTryDish;
    if (raw.description) details.description = raw.description;
    if (raw.paymentMethod) details.paymentMethod = raw.paymentMethod;
    if (raw.localTip) details.localTip = raw.localTip;
    if (raw.origin) details.origin = raw.origin;
    if (raw.destination) details.destination = raw.destination;
    if (raw.bestFor) details.bestFor = raw.bestFor;
    if (raw.duration) details.duration = raw.duration;
    if (raw.bookingTip) details.bookingTip = raw.bookingTip;
  }

  const itemObj = {
    itemId,
    tripId,
    createdAt,
    itemType,
    name,
    location,
    category,
    price,
    link: safeUrl(link) || "",
    savedBy,
    status,
    details,
  };

  // Backward compatibility accessors for existing stay consumers
  Object.defineProperty(itemObj, "stayId", {
    get() {
      return this.itemId;
    },
    enumerable: true,
  });
  Object.defineProperty(itemObj, "hotelName", {
    get() {
      return this.name;
    },
    enumerable: true,
  });

  return itemObj;
}

export function normalizeSavedItems(rawItems, fallbackTripId = "") {
  if (!Array.isArray(rawItems)) return [];
  return rawItems
    .map((item) => canonicalizeSavedItem(item, fallbackTripId))
    .filter(Boolean);
}

export function cleanTripPayload(current) {
  if (!current) return "{}";
  const rawItems = Array.isArray(current.savedItems)
    ? current.savedItems
    : Array.isArray(current.stays)
      ? current.stays
      : [];

  const clean = {
    id: current.id,
    destination: current.destination,
    trip: current.trip,
    result: current.result
      ? {
          parts: (current.result.parts || []).map((p) => ({
            text: p.text,
            annotations: (p.annotations || []).slice(0, 20),
          })),
          sources: (current.result.sources || []).slice(0, 20),
          createdAt: current.result.createdAt,
          expiresAt: current.result.expiresAt,
          model: current.result.model,
          hasMaps: current.result.hasMaps,
        }
      : null,
    notes: (current.notes || "").slice(0, 10000),
    costs: current.costs,
    savedItems: rawItems.slice(0, 50).map((item) => {
      const canonical = canonicalizeSavedItem(item, current.id);
      return {
        itemId: canonical.itemId,
        tripId: canonical.tripId,
        createdAt: canonical.createdAt,
        itemType: canonical.itemType,
        name: canonical.name,
        location: canonical.location,
        category: canonical.category,
        price: canonical.price,
        link: canonical.link,
        savedBy: canonical.savedBy,
        status: canonical.status,
        details: canonical.details,
        stayId: canonical.itemId,
        hotelName: canonical.name,
      };
    }),
    stays: rawItems
      .filter(
        (item) => (item.itemType || "stay").toLowerCase().trim() === "stay",
      )
      .slice(0, 50)
      .map((s) => ({
        stayId: s.itemId || s.stayId || s.id,
        tripId: s.tripId || current.id,
        hotelName: s.name || s.hotelName,
        price: s.price,
        link: s.link || s.url,
        savedBy: s.savedBy,
        createdAt: s.createdAt,
      })),
    chat: (current.chat || []).slice(-10).map((m) => ({
      role: m.role,
      text: m.text,
      result: m.result
        ? {
            parts: (m.result.parts || []).map((p) => ({ text: p.text })),
          }
        : undefined,
    })),
    createdAt: current.createdAt,
    updatedAt: current.updatedAt,
  };
  const safeClean = sanitizeSheetsPayload(clean);
  const json = JSON.stringify(safeClean);
  if (json.length > 49000) {
    safeClean.chat = [];
    return JSON.stringify(safeClean);
  }
  return json;
}

export async function fetchSheetsApi(
  payload,
  { method = "POST", signal, apiUrl = SHEETS_API_URL } = {},
) {
  const safePayload = sanitizeSheetsPayload(payload);
  let response;
  if (method.toUpperCase() === "GET") {
    const url = new URL(apiUrl);
    if (safePayload && typeof safePayload === "object") {
      for (const [k, v] of Object.entries(safePayload)) {
        if (v != null) url.searchParams.set(k, String(v));
      }
    }
    response = await fetch(url.href, {
      method: "GET",
      redirect: "follow",
      signal,
    });
  } else {
    response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body:
        typeof safePayload === "string"
          ? safePayload
          : JSON.stringify(safePayload),
      redirect: "follow",
      signal,
    });
  }
  if (!response.ok) {
    throw new Error(`Sheets API responded with status ${response.status}`);
  }
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { status: "success", text };
  }
}

export function parseStayNameFromUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return "";
  try {
    const trimmed = rawUrl.trim();
    const url = new URL(
      trimmed.startsWith("http://") || trimmed.startsWith("https://")
        ? trimmed
        : `https://${trimmed}`,
    );

    // Check common query parameters first (e.g. ?title=Minimalist-Villa)
    for (const key of [
      "title",
      "hotel_name",
      "hotelName",
      "name",
      "property",
      "q",
      "query",
    ]) {
      const val = url.searchParams.get(key);
      if (val && val.length > 2) {
        return cleanSlugToTitle(val);
      }
    }

    const pathname = url.pathname;
    const hostname = url.hostname.toLowerCase();

    // Provider: Agoda
    if (hostname.includes("agoda.com")) {
      const parts = pathname.split("/").filter(Boolean);
      const hotelIndex = parts.indexOf("hotel");
      if (hotelIndex > 0 && parts[hotelIndex - 1]) {
        return cleanSlugToTitle(parts[hotelIndex - 1]);
      }
      const namedPart = parts.find(
        (p) =>
          !["en-gb", "en-us", "hotel", "hotels", "country", "city"].includes(
            p.toLowerCase(),
          ) && isNaN(Number(p)),
      );
      if (namedPart) return cleanSlugToTitle(namedPart);
    }

    // Provider: Booking.com
    if (hostname.includes("booking.com")) {
      const match = pathname.match(/\/hotel\/[a-z]{2}\/([^/.]+)/i);
      if (match && match[1]) {
        return cleanSlugToTitle(match[1]);
      }
    }

    // Provider: Airbnb
    if (hostname.includes("airbnb")) {
      const parts = pathname.split("/").filter(Boolean);
      const namedSlug = parts.find(
        (p) => p !== "rooms" && p !== "s" && isNaN(Number(p)),
      );
      if (namedSlug) return cleanSlugToTitle(namedSlug);
    }

    // Generic path segment parsing
    const segments = pathname
      .split("/")
      .filter(Boolean)
      .map((s) => s.replace(/\.(html|htm|php|asp|aspx)$/i, ""))
      .filter(
        (s) =>
          ![
            "rooms",
            "hotel",
            "hotels",
            "stay",
            "stays",
            "property",
            "index",
            "en",
            "ph",
            "room",
            "h",
          ].includes(s.toLowerCase()) && isNaN(Number(s)),
      );

    if (segments.length > 0) {
      const best = segments.reduce(
        (longest, s) => (s.length > longest.length ? s : longest),
        "",
      );
      if (best.length >= 3) {
        return cleanSlugToTitle(best);
      }
    }

    const domain = hostname.replace(/^www\./, "").split(".")[0];
    return `${domain.charAt(0).toUpperCase() + domain.slice(1)} Stay`;
  } catch {
    return cleanSlugToTitle(rawUrl);
  }
}

function cleanSlugToTitle(slug) {
  if (!slug) return "";
  return decodeURIComponent(slug)
    .replace(/\.(html|htm|php)$/i, "")
    .replace(/[._\-+]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b[a-z]/g, (char) => char.toUpperCase())
    .trim();
}

export const DINING_CATEGORIES = [
  "Street Food",
  "Carenderia",
  "Restaurant",
  "Plant-Based",
  "Cafe",
];

export function buildMapsSearchLink(spotName, location) {
  const query = `${spotName || ""} ${location || ""}`.trim();
  if (!query) return null;
  return safeUrl(
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,
  );
}

export function stripDiningBlock(text) {
  if (typeof text !== "string") return "";
  return text.replace(/```(?:dining|json:dining)[\s\S]*?```/gi, "").trim();
}

export function parseDining(
  text,
  { destination = "Local Destination" } = {},
) {
  const result = [];
  if (typeof text === "string" && text) {
    const match =
      text.match(/```(?:dining|json:dining)\s*([\s\S]*?)\s*```/i) ||
      text.match(/```json\s*(\[\s*\{[\s\S]*?"spotName"[\s\S]*?\}\s*\])\s*```/i) ||
      text.match(/\[\s*\{[\s\S]*?"spotName"[\s\S]*?"mustTryDish"[\s\S]*?\}\s*\]/i);

    if (match) {
      try {
        const rawJson = JSON.parse(match[1] || match[0]);
        if (Array.isArray(rawJson)) {
          for (const item of rawJson) {
            if (item && typeof item === "object") {
              const spotName =
                textValue(item.spotName, "Spot name", 150, true) ||
                "Local Dining Spot";
              const location =
                textValue(item.location, "Location", 150, true) || destination;
              const rawCat = String(item.category || "").trim();
              const matchedCat =
                DINING_CATEGORIES.find(
                  (c) => c.toLowerCase() === rawCat.toLowerCase(),
                ) ||
                rawCat ||
                "Restaurant";

              result.push({
                spotName,
                location,
                category: matchedCat,
                mustTryDish:
                  textValue(item.mustTryDish, "Must-try dish", 200, true) ||
                  "Regional Specialty",
                description:
                  textValue(item.description, "Description", 400, true) ||
                  "A celebrated local food experience.",
                estimatedCostPHP:
                  textValue(item.estimatedCostPHP, "Estimated cost", 100, true) ||
                  "₱150 - ₱400",
                mapsUrl: buildMapsSearchLink(spotName, location),
              });
            }
          }
        }
      } catch {}
    }
  }

  if (!result.length) {
    const dest = (destination || "Local Area").trim();
    result.push(
      {
        spotName: `Street Food & Night Markets in ${dest}`,
        location: dest,
        category: "Street Food",
        mustTryDish: "Explore local food stalls & evening markets",
        description: "Search current street food hubs and popular local night markets on Google Maps.",
        estimatedCostPHP: "Check menu prices",
        mapsUrl: buildMapsSearchLink(`Street Food Night Market`, dest),
        isFallback: true,
      },
      {
        spotName: `Local Carenderias in ${dest}`,
        location: dest,
        category: "Carenderia",
        mustTryDish: "Explore homestyle turo-turo & claypot dishes",
        description: "Browse neighborhood carenderias for authentic Filipino home-style meals.",
        estimatedCostPHP: "Check menu prices",
        mapsUrl: buildMapsSearchLink("Carenderia Eateries", dest),
        isFallback: true,
      },
      {
        spotName: `Filipino Restaurants in ${dest}`,
        location: dest,
        category: "Restaurant",
        mustTryDish: "Explore regional specialties & seafood",
        description: "Search highly rated local restaurants and culinary specialties on Google Maps.",
        estimatedCostPHP: "Check menu prices",
        mapsUrl: buildMapsSearchLink("Filipino Restaurant", dest),
        isFallback: true,
      },
      {
        spotName: `Plant-Based Dining in ${dest}`,
        location: dest,
        category: "Plant-Based",
        mustTryDish: "Explore vegetarian & vegan choices",
        description: "Search plant-forward dining, vegetarian cafes, and wholesome local options.",
        estimatedCostPHP: "Check menu prices",
        mapsUrl: buildMapsSearchLink("Plant-Based Vegetarian Cafe", dest),
        isFallback: true,
      },
    );
  }

  return result;
}

export const STAY_PROPERTY_TYPES = ["Hotel", "Resort", "Rental", "Hostel"];

export function buildStaySearchLink(stayName, location) {
  const nameLoc = `${stayName || ""} ${location || ""}`.trim();
  if (!nameLoc) return null;
  return safeUrl(
    `https://www.google.com/search?q=${encodeURIComponent(nameLoc + " booking")}`,
  );
}

export function stripAccommodationsBlock(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/```(?:accommodations|json:accommodations)[\s\S]*?```/gi, "")
    .trim();
}

export function parseAccommodations(
  text,
  { destination = "Local Destination" } = {},
) {
  const result = [];
  if (typeof text === "string" && text) {
    const match =
      text.match(/```(?:accommodations|json:accommodations)\s*([\s\S]*?)\s*```/i) ||
      text.match(/```json\s*(\[\s*\{[\s\S]*?"stayName"[\s\S]*?\}\s*\])\s*```/i) ||
      text.match(/\[\s*\{[\s\S]*?"stayName"[\s\S]*?"neighborhood"[\s\S]*?\}\s*\]/i);

    if (match) {
      try {
        const rawJson = JSON.parse(match[1] || match[0]);
        if (Array.isArray(rawJson)) {
          for (const item of rawJson) {
            if (item && typeof item === "object") {
              const stayName =
                textValue(item.stayName, "Stay name", 150, true) ||
                "Boutique Property";
              const neighborhood =
                textValue(item.neighborhood, "Neighborhood", 150, true) ||
                destination;
              const rawType = String(item.type || "").trim();
              const matchedType =
                STAY_PROPERTY_TYPES.find(
                  (t) => t.toLowerCase() === rawType.toLowerCase(),
                ) ||
                rawType ||
                "Hotel";

              result.push({
                stayName,
                neighborhood,
                type: matchedType,
                description:
                  textValue(item.description, "Description", 400, true) ||
                  "Convenient and highly rated stay for your trip.",
                estimatedPricePHP:
                  textValue(item.estimatedPricePHP, "Estimated price", 100, true) ||
                  "₱2,500 - ₱5,000 / night",
                searchUrl: buildStaySearchLink(stayName, neighborhood),
              });
            }
          }
        }
      } catch {}
    }
  }

  if (!result.length) {
    const dest = (destination || "Local Area").trim();
    result.push(
      {
        stayName: `Hotels in ${dest}`,
        neighborhood: dest,
        type: "Hotel",
        description: "Search current hotels, verified amenities, and live rates.",
        estimatedPricePHP: "Check live rates",
        searchUrl: buildStaySearchLink(`Hotels in ${dest}`, dest),
        isFallback: true,
      },
      {
        stayName: `Beachfront Resorts in ${dest}`,
        neighborhood: dest,
        type: "Resort",
        description: "Browse seaside resorts, verified amenities, and current availability.",
        estimatedPricePHP: "Check live rates",
        searchUrl: buildStaySearchLink(`Resorts in ${dest}`, dest),
        isFallback: true,
      },
      {
        stayName: `Vacation Rentals in ${dest}`,
        neighborhood: dest,
        type: "Rental",
        description: "Search local apartments, private homes, and verified vacation rentals.",
        estimatedPricePHP: "Check live rates",
        searchUrl: buildStaySearchLink(`Vacation Rentals in ${dest}`, dest),
        isFallback: true,
      },
      {
        stayName: `Hostels in ${dest}`,
        neighborhood: dest,
        type: "Hostel",
        description: "Search budget hostels, social hubs, and pod stays.",
        estimatedPricePHP: "Check live rates",
        searchUrl: buildStaySearchLink(`Hostels in ${dest}`, dest),
        isFallback: true,
      },
    );
  }

  return result;
}

export const ACTIVITY_CATEGORIES = [
  "Island Hopping",
  "Beach",
  "Snorkeling",
  "Diving",
  "Hiking",
  "Nature",
  "Museum",
  "Heritage",
  "Cultural Attraction",
  "Market",
  "Food Experience",
  "Nightlife",
  "Family Attraction",
  "Wellness",
  "Day Trip",
  "Tour",
  "Adventure",
];

export function buildActivitySearchLink(name, location) {
  const query = `${name || ""} ${location || ""}`.trim();
  if (!query) return null;
  return safeUrl(
    `https://www.google.com/search?q=${encodeURIComponent(query + " tour booking ticket")}`,
  );
}

export function stripActivitiesBlock(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/```(?:activities|json:activities)[\s\S]*?```/gi, "")
    .trim();
}

export function parseActivities(
  text,
  { destination = "Local Destination" } = {},
) {
  const result = [];
  if (typeof text === "string" && text) {
    const match =
      text.match(/```(?:activities|json:activities)\s*([\s\S]*?)\s*```/i) ||
      text.match(/```json\s*(\[\s*\{[\s\S]*?"bestFor"[\s\S]*?\}\s*\])\s*```/i) ||
      text.match(/\[\s*\{[\s\S]*?"name"[\s\S]*?"duration"[\s\S]*?\}\s*\]/i);

    if (match) {
      try {
        const rawJson = JSON.parse(match[1] || match[0]);
        if (Array.isArray(rawJson)) {
          for (const item of rawJson) {
            if (item && typeof item === "object") {
              const name =
                textValue(
                  item.name || item.activityName,
                  "Activity name",
                  150,
                  true,
                ) || "Curated Experience";
              const location =
                textValue(item.location, "Location", 150, true) || destination;
              const rawCat = String(item.category || "").trim();
              const matchedCat =
                ACTIVITY_CATEGORIES.find(
                  (c) => c.toLowerCase() === rawCat.toLowerCase(),
                ) ||
                rawCat ||
                "Activity";

              result.push({
                name,
                location,
                category: matchedCat,
                description:
                  textValue(item.description, "Description", 400, true) ||
                  "A celebrated local adventure and experience.",
                estimatedPrice:
                  textValue(
                    item.estimatedPrice || item.estimatedPricePHP,
                    "Estimated price",
                    100,
                    true,
                  ) || "Check ticket prices",
                bestFor:
                  textValue(item.bestFor, "Best for", 150, true) ||
                  "All travelers",
                duration:
                  textValue(item.duration, "Duration", 100, true) ||
                  "Flexible",
                bookingTip:
                  textValue(item.bookingTip, "Booking tip", 250, true) ||
                  "Book in advance or inquire with local tour operators.",
                link:
                  safeUrl(item.link) ||
                  buildActivitySearchLink(name, location),
              });
            }
          }
        }
      } catch {}
    }
  }

  if (!result.length) {
    const dest = (destination || "Local Area").trim();
    result.push({
      name: `Things to Do in ${dest}`,
      location: dest,
      category: "Activity",
      description:
        "Browse current attractions, cultural sites, and local experiences for this destination.",
      estimatedPrice: "Check current prices",
      bestFor: "All travelers",
      duration: "Varies",
      bookingTip:
        "Confirm current hours, availability, prices, and local conditions before booking.",
      link: buildActivitySearchLink(`things to do in ${dest}`, dest),
      isFallback: true,
    });
  }

  return result;
}
