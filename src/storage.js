export const STORE_KEY = "saantayo_trips_v2",
  LEGACY_KEY = "saantayo_saved_trips";
export function legacyTrip(value, index = 0) {
  if (
    !value ||
    typeof value.destination !== "string" ||
    typeof value.content !== "string"
  )
    return null;
  return {
    id: `legacy-${String(value.id ?? index)}`,
    destination: value.destination.slice(0, 400),
    createdAt: value.date || new Date().toISOString(),
    updatedAt: value.date || "",
    content: value.content,
    result: null,
    trip: null,
    chat: [],
    notes: "",
    conversation: null,
    costs: null,
    legacy: true,
  };
}
export function readTrips(storage) {
  const current = storage.getItem(STORE_KEY);
  if (current !== null) {
    let data;
    try {
      data = JSON.parse(current);
    } catch {
      throw new Error(
        "Saved-trip storage is damaged. Nothing was overwritten. Export a browser backup before repairing it.",
      );
    }
    if (data.version !== 2 || !Array.isArray(data.trips))
      throw new Error(
        "Unrecognised saved-trip version. Nothing was overwritten.",
      );
    if (
      data.trips.some(
        (t) =>
          !t ||
          typeof t.id !== "string" ||
          (t.destination != null && typeof t.destination !== "string") ||
          (t.chat != null && !Array.isArray(t.chat)) ||
          (t.result &&
            (!Array.isArray(t.result.parts) ||
              !Array.isArray(t.result.sources))),
      )
    )
      throw new Error(
        "A saved trip has an invalid structure. Nothing was overwritten.",
      );
    return data.trips;
  }
  const legacy = storage.getItem(LEGACY_KEY);
  if (!legacy) return [];
  let values;
  try {
    values = JSON.parse(legacy);
  } catch {
    throw new Error(
      "Older saved plans could not be read. The original data has been kept.",
    );
  }
  if (!Array.isArray(values) || values.some((v) => !legacyTrip(v)))
    throw new Error(
      "Older saved plans have an unexpected format. The original data has been kept.",
    );
  const migrated = values.map(legacyTrip);
  // Write a separate versioned key; NEVER modify/remove the old source during migration.
  try {
    writeTrips(storage, migrated);
  } catch {
    /* Read old plans even when storage is full. */
  }
  return migrated;
}
export function writeTrips(storage, trips) {
  try {
    storage.setItem(STORE_KEY, JSON.stringify({ version: 2, trips }));
  } catch {
    throw new Error(
      "Device storage is full or unavailable. Your previous saved plans were not changed. Export a backup or free space.",
    );
  }
}
export function saveTrip(storage, trip) {
  const trips = readTrips(storage);
  const index = trips.findIndex((t) => t.id === trip.id);
  if (index < 0) trips.unshift(trip);
  else trips[index] = trip;
  writeTrips(storage, trips);
  return trips;
}
export function expireHistory(trip, now = Date.now()) {
  let changed = false;
  const expired = (result) =>
    result && (!result.expiresAt || Date.parse(result.expiresAt) <= now);
  const next = {
    ...trip,
    chat: (trip.chat || []).map((message) => {
      if (expired(message.result)) {
        changed = true;
        return { ...message, result: null, expired: true };
      }
      return message;
    }),
  };
  if (expired(next.result)) {
    changed = true;
    next.result = null;
    next.content = "";
    next.costs = null;
    next.conversation = null;
    next.expired = true;
  }
  if (changed) next.conversation = null;
  return { trip: next, changed };
}
export function exportEligible(trips) {
  return {
    version: 2,
    trips: trips.map((value) => {
      const t = expireHistory(value).trip;
      // Conversation capability tokens are never exported.
      const clean = { ...t, conversation: null, chat: [] };
      if (t.result?.hasMaps)
        return {
          ...clean,
          result: null,
          content: "",
          costs: null,
          expired: true,
          exportNotice: "Maps answer omitted; notes retained.",
        };
      return clean;
    }),
  };
}
export function importTripsData(raw) {
  const data = JSON.parse(raw);
  const values = Array.isArray(data)
    ? data.map(legacyTrip)
    : data.version === 2
      ? data.trips
      : null;
  if (!Array.isArray(values) || values.length > 200)
    throw new Error("Choose a SaanTayo backup containing up to 200 trips.");
  return values.map((value) => {
    if (
      !value ||
      typeof value.destination !== "string" ||
      value.destination.length > 400 ||
      typeof value.content !== "string" ||
      value.content.length > 120000 ||
      typeof (value.notes || "") !== "string"
    )
      throw new Error(
        "This backup contains an invalid trip. No saved plans were changed.",
      );
    if (
      value.result &&
      (!Array.isArray(value.result.parts) ||
        !Array.isArray(value.result.sources) ||
        value.result.parts.some((p) => typeof p.text !== "string") ||
        value.result.hasMaps)
    )
      throw new Error(
        "This backup contains an unsupported sourced answer. Maps data cannot be imported.",
      );
    return {
      ...value,
      id: crypto.randomUUID(),
      conversation: null,
      chat: [],
      notes: (value.notes || "").slice(0, 12000),
    };
  });
}
