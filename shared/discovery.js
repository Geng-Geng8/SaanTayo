// SaanTayo V3.3 — Place Discovery Contract and Intelligence
// Normalizes nearby places across providers with deterministic, fact-grounded reasons to go.

export const INTENTS = Object.freeze({
  eat: "🍜 Eat",
  explore: "🏛 Explore",
  coffee: "☕ Coffee",
  shop: "🛍 Shop",
  nightlife: "🌙 Nightlife",
  surprise: "🎯 Surprise me",
});

export const FOOD_PREFERENCES = Object.freeze([
  { id: "filipino", label: "Filipino" },
  { id: "cheap_eats", label: "Cheap eats" },
  { id: "local", label: "Something local" },
  { id: "dessert", label: "Dessert" },
  { id: "coffee", label: "Coffee" },
  { id: "anything", label: "Anything good" },
]);

export function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  if (
    typeof lat1 !== "number" ||
    typeof lon1 !== "number" ||
    typeof lat2 !== "number" ||
    typeof lon2 !== "number" ||
    !Number.isFinite(lat1) ||
    !Number.isFinite(lon1) ||
    !Number.isFinite(lat2) ||
    !Number.isFinite(lon2)
  ) {
    return null;
  }
  const R = 6371000; // Earth's radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

export function formatDistance(meters) {
  if (meters === null || meters === undefined || !Number.isFinite(meters))
    return "";
  if (meters < 1000) return `${Math.round(meters)} m away`;
  return `${(meters / 1000).toFixed(1)} km away`;
}

export function formatPriceLevel(level) {
  if (!level && level !== 0) return null;
  if (typeof level === "string") {
    switch (level) {
      case "PRICE_LEVEL_FREE":
        return "Free";
      case "PRICE_LEVEL_INEXPENSIVE":
        return "₱";
      case "PRICE_LEVEL_MODERATE":
        return "₱₱";
      case "PRICE_LEVEL_EXPENSIVE":
        return "₱₱₱";
      case "PRICE_LEVEL_VERY_EXPENSIVE":
        return "₱₱₱₱";
      default:
        return null;
    }
  }
  if (typeof level === "number") {
    if (level === 0) return "Free";
    if (level === 1) return "₱";
    if (level === 2) return "₱₱";
    if (level === 3) return "₱₱₱";
    if (level >= 4) return "₱₱₱₱";
  }
  return null;
}

export function buildWhyGoReason(place, distanceMeters = null, tripContext = null) {
  if (tripContext) {
    if (tripContext.isSaved) {
      if (tripContext.savedBy) {
        return `Saved on your shortlist by ${tripContext.savedBy}.`;
      }
      return "Saved on your trip shortlist.";
    }
    if (tripContext.isItinerary) {
      return "Matches a stop in your current trip plan.";
    }
    if (tripContext.isNearStay) {
      return "Conveniently located near your saved accommodation.";
    }
  }

  const rating = typeof place.rating === "number" ? place.rating : null;
  const count = typeof place.reviewCount === "number" ? place.reviewCount : null;
  const category = place.primaryType || place.categories?.[0] || "spot";
  const dist = distanceMeters !== null ? formatDistance(distanceMeters) : "";

  if (rating !== null && rating >= 4.7 && count && count >= 500) {
    return `Highly rated major ${category} (★ ${rating.toFixed(1)}) with ${count.toLocaleString()} reviews${dist ? ` · ${dist}` : ""}.`;
  }

  if (rating !== null && rating >= 4.5) {
    if (distanceMeters !== null && distanceMeters <= 1000) {
      return `Popular, top-rated ${category} (★ ${rating.toFixed(1)}) an easy walk away (${dist}).`;
    }
    return `Strongly recommended ${category} (★ ${rating.toFixed(1)})${count ? ` with ${count.toLocaleString()} reviews` : ""}.`;
  }

  if (distanceMeters !== null && distanceMeters <= 600) {
    return `Right around the corner (${dist}) for a quick, convenient stop.`;
  }

  if (place.priceLevel === "PRICE_LEVEL_INEXPENSIVE" || place.priceLevel === 1) {
    return `Great-value budget-friendly ${category}${rating ? ` (★ ${rating.toFixed(1)})` : ""}.`;
  }

  if (rating !== null && rating >= 4.0) {
    return `Solid local ${category} (★ ${rating.toFixed(1)})${dist ? ` · ${dist}` : ""}.`;
  }

  return `Worthwhile nearby ${category}${dist ? ` (${dist})` : ""}.`;
}

export function normalizeDiscoveredPlace(raw, userCoords = null, tripContextList = []) {
  if (!raw || typeof raw !== "object") return null;

  const id = String(raw.id || raw.providerPlaceId || raw.placeId || crypto.randomUUID());
  const providerPlaceId = String(raw.providerPlaceId || raw.id || raw.placeId || id);
  const name = String(
    (typeof raw.displayName === "object" ? raw.displayName?.text : raw.displayName) ||
      raw.name ||
      "Local Spot",
  ).trim();

  let primaryType = "";
  if (typeof raw.primaryType === "string") {
    primaryType = raw.primaryType.replace(/_/g, " ");
  } else if (Array.isArray(raw.types) && raw.types.length > 0) {
    primaryType = String(raw.types[0]).replace(/_/g, " ");
  } else if (raw.category) {
    primaryType = String(raw.category);
  }

  const categories = Array.isArray(raw.types)
    ? raw.types.slice(0, 3).map((t) => String(t).replace(/_/g, " "))
    : primaryType
      ? [primaryType]
      : [];

  const lat =
    typeof raw.location?.latitude === "number"
      ? raw.location.latitude
      : typeof raw.location?.lat === "number"
        ? raw.location.lat
        : typeof raw.lat === "number"
          ? raw.lat
          : null;

  const lng =
    typeof raw.location?.longitude === "number"
      ? raw.location.longitude
      : typeof raw.location?.lng === "number"
        ? raw.location.lng
        : typeof raw.lng === "number"
          ? raw.lng
          : null;

  const address = String(raw.formattedAddress || raw.address || "").trim();
  const rating =
    typeof raw.rating === "number" && Number.isFinite(raw.rating)
      ? Math.round(raw.rating * 10) / 10
      : null;
  const reviewCount =
    typeof raw.userRatingCount === "number" && Number.isFinite(raw.userRatingCount)
      ? raw.userRatingCount
      : typeof raw.reviewCount === "number" && Number.isFinite(raw.reviewCount)
        ? raw.reviewCount
        : null;

  const priceLevel = formatPriceLevel(raw.priceLevel);

  let openNow = null;
  if (typeof raw.currentOpeningHours?.openNow === "boolean") {
    openNow = raw.currentOpeningHours.openNow;
  } else if (typeof raw.openNow === "boolean") {
    openNow = raw.openNow;
  }

  let photoName = null;
  let photoAttribution = "";
  if (Array.isArray(raw.photos) && raw.photos.length > 0) {
    const firstPhoto = raw.photos[0];
    photoName = firstPhoto.name || firstPhoto.photo_reference || null;
    if (Array.isArray(firstPhoto.authorAttributions) && firstPhoto.authorAttributions.length > 0) {
      photoAttribution = firstPhoto.authorAttributions[0].displayName || "";
    }
  } else if (typeof raw.photo === "string") {
    photoName = raw.photo;
  } else if (raw.photo?.name) {
    photoName = raw.photo.name;
    photoAttribution = raw.photo.attribution || "";
  }

  let distanceMeters =
    typeof raw.distanceMeters === "number" && Number.isFinite(raw.distanceMeters)
      ? raw.distanceMeters
      : null;

  if (
    distanceMeters === null &&
    userCoords &&
    typeof userCoords.latitude === "number" &&
    typeof userCoords.longitude === "number" &&
    lat !== null &&
    lng !== null
  ) {
    distanceMeters = haversineDistanceMeters(
      userCoords.latitude,
      userCoords.longitude,
      lat,
      lng,
    );
  }

  // Check matching trip context
  let matchedTripContext = null;
  if (Array.isArray(tripContextList) && tripContextList.length > 0) {
    const nameLower = name.toLowerCase();
    for (const item of tripContextList) {
      const itemName = (item.name || "").toLowerCase().trim();
      if (itemName && (nameLower.includes(itemName) || itemName.includes(nameLower))) {
        matchedTripContext = {
          isSaved: true,
          savedBy: item.savedBy || null,
          itemType: item.itemType || null,
        };
        break;
      }
    }
  }

  const reason = raw.reason || buildWhyGoReason(
    { rating, reviewCount, primaryType, categories, priceLevel },
    distanceMeters,
    matchedTripContext,
  );

  return {
    id,
    providerPlaceId,
    name,
    primaryType,
    categories,
    location: lat !== null && lng !== null ? { latitude: lat, longitude: lng } : null,
    address,
    rating,
    reviewCount,
    priceLevel,
    openNow,
    photoName,
    photoAttribution,
    provider: raw.provider || "google_places",
    distanceMeters,
    reason,
    sourceTrust: raw.sourceTrust || "verified_provider",
    tripContext: matchedTripContext,
  };
}
