// SaanTayo V3.3 — Server-side Google Places API (New) Provider
// Conforms strictly to official Places API (New) searchNearby & Place Photos Media endpoints.
// Never exposes API keys to client JavaScript or browser URLs.

import { normalizeDiscoveredPlace, haversineDistanceMeters } from "../shared/discovery.js";

const NEARBY_ENDPOINT = "https://places.googleapis.com/v1/places:searchNearby";
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.primaryType",
  "places.types",
  "places.location",
  "places.formattedAddress",
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
  "places.currentOpeningHours.openNow",
  "places.photos",
].join(",");

export const INTENT_TYPES = Object.freeze({
  eat: ["restaurant", "cafe", "fast_food_restaurant", "bakery"],
  explore: [
    "tourist_attraction",
    "museum",
    "historical_landmark",
    "park",
    "cultural_landmark",
    "art_gallery",
  ],
  coffee: ["cafe", "coffee_shop"],
  shop: ["shopping_mall", "market", "department_store"],
  nightlife: ["bar", "night_club", "live_music_venue", "pub"],
  surprise: [
    "tourist_attraction",
    "museum",
    "park",
    "restaurant",
    "cafe",
  ],
});

export const FOOD_SUB_TYPES = Object.freeze({
  filipino: {
    types: ["restaurant"],
    filterTerms: ["filipino", "pinoy", "inasal", "lechon", "lutong bahay", "sinigang", "adobo"],
  },
  cheap_eats: {
    types: ["restaurant", "fast_food_restaurant", "cafe"],
    priceLevels: ["PRICE_LEVEL_INEXPENSIVE", "PRICE_LEVEL_FREE"],
  },
  local: {
    types: ["restaurant", "cafe", "bakery"],
    filterTerms: [],
  },
  dessert: {
    types: ["bakery", "cafe", "ice_cream_shop"],
    filterTerms: ["dessert", "halo-halo", "bakery", "cake", "ice cream"],
  },
  coffee: {
    types: ["cafe", "coffee_shop"],
    filterTerms: ["coffee", "cafe", "espresso"],
  },
  anything: {
    types: ["restaurant", "cafe", "fast_food_restaurant"],
    filterTerms: [],
  },
});

export async function searchNearbyPlaces({
  latitude,
  longitude,
  intent = "explore",
  subPreference = null,
  radiusMeters = 2500,
  key,
  fetcher = fetch,
  signal,
  tripContext = [],
  providerOverride = null,
} = {}) {
  if (providerOverride) {
    return providerOverride({ latitude, longitude, intent, subPreference, radiusMeters, tripContext });
  }

  if (!key) {
    return {
      status: "not_configured",
      places: [],
      warnings: ["Google Places API key is not configured."],
    };
  }

  let includedTypes = INTENT_TYPES[intent] || INTENT_TYPES.explore;
  let priceLevels = undefined;

  if (intent === "eat" && subPreference && FOOD_SUB_TYPES[subPreference]) {
    const pref = FOOD_SUB_TYPES[subPreference];
    if (pref.types) includedTypes = pref.types;
    if (pref.priceLevels) priceLevels = pref.priceLevels;
  }

  const clampedRadius = Math.min(Math.max(Number(radiusMeters) || 2500, 300), 10000);
  const requestBody = {
    includedTypes,
    maxResultCount: 15,
    locationRestriction: {
      circle: {
        center: {
          latitude: Number(latitude),
          longitude: Number(longitude),
        },
        radius: clampedRadius,
      },
    },
    ...(priceLevels ? { priceLevels } : {}),
  };

  try {
    const response = await fetcher(NEARBY_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(requestBody),
      signal,
    });

    if (response.status === 403) {
      const errorJson = await response.json().catch(() => ({}));
      const reason = errorJson?.error?.details?.[0]?.reason || "SERVICE_DISABLED";
      return {
        status: "provider_unavailable",
        code: reason,
        places: [],
        warnings: [
          "Google Places API (New) is not enabled on this Google Cloud project. Enable Places API (New) in Google Cloud Console.",
        ],
      };
    }

    if (!response.ok) {
      return {
        status: "unavailable",
        places: [],
        warnings: [`Google Places returned status ${response.status}.`],
      };
    }

    const data = await response.json();
    const rawPlaces = Array.isArray(data?.places) ? data.places : [];

    const userCoords = { latitude: Number(latitude), longitude: Number(longitude) };
    const normalized = rawPlaces
      .map((p) => normalizeDiscoveredPlace(p, userCoords, tripContext))
      .filter(Boolean);

    // Filter by sub-preference keywords if applicable
    let filtered = normalized;
    if (intent === "eat" && subPreference && FOOD_SUB_TYPES[subPreference]?.filterTerms?.length > 0) {
      const terms = FOOD_SUB_TYPES[subPreference].filterTerms;
      const matched = normalized.filter((p) => {
        const text = `${p.name} ${p.primaryType} ${p.categories.join(" ")}`.toLowerCase();
        return terms.some((t) => text.includes(t));
      });
      if (matched.length >= 3) {
        filtered = matched;
      }
    }

    // Rank: top ratings and reasonable distance, prioritizing 5-8 strong candidates
    filtered.sort((a, b) => {
      // Saved in trip context ranks highest
      if (a.tripContext?.isSaved && !b.tripContext?.isSaved) return -1;
      if (!a.tripContext?.isSaved && b.tripContext?.isSaved) return 1;

      // Then by rating volume and score
      const scoreA = (a.rating || 3.8) * Math.log10((a.reviewCount || 10) + 1);
      const scoreB = (b.rating || 3.8) * Math.log10((b.reviewCount || 10) + 1);
      return scoreB - scoreA;
    });

    const finalPlaces = filtered.slice(0, 8);

    return {
      status: finalPlaces.length ? "ok" : "no_results",
      places: finalPlaces,
      warnings: finalPlaces.length ? [] : ["No matching places found near this location."],
    };
  } catch (err) {
    if (signal?.aborted) throw err;
    return {
      status: "unavailable",
      places: [],
      warnings: ["Unable to connect to Google Places. Check connection."],
    };
  }
}

export async function fetchPlacePhotoMedia({
  photoName,
  key,
  fetcher = fetch,
  signal,
  maxHeightPx = 400,
  maxWidthPx = 600,
} = {}) {
  if (!key) return null;
  if (!photoName || typeof photoName !== "string") return null;

  // Validate photo name format: places/.../photos/...
  if (!/^places\/[a-zA-Z0-9_-]+\/photos\/[a-zA-Z0-9_-]+$/.test(photoName)) {
    return null;
  }

  const url = `https://places.googleapis.com/v1/${photoName}/media?maxHeightPx=${maxHeightPx}&maxWidthPx=${maxWidthPx}`;

  try {
    const response = await fetcher(url, {
      method: "GET",
      headers: {
        "X-Goog-Api-Key": key,
      },
      signal,
      redirect: "follow",
    });

    if (!response.ok) return null;
    return response;
  } catch {
    return null;
  }
}
