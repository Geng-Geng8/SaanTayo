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
