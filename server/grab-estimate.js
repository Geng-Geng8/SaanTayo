import { number } from "../shared/journey.js";

// No default tariff: the deployment must supply a reviewed regional model.
// Coefficients describe SaanTayo's estimate, never a Grab quote or live surge.
export function estimateGrab(
  route,
  calibration,
  { people = 1, now = Date.now() } = {},
) {
  const c = calibration;
  if (
    !c ||
    !c.id ||
    !c.evidence ||
    !Number.isFinite(Date.parse(c.reviewedAt)) ||
    Date.parse(c.reviewedAt) > now ||
    now - Date.parse(c.reviewedAt) > 90 * 86400000
  )
    return null;
  const fields = [
    "basePHP",
    "perKmPHP",
    "perMinutePHP",
    "minMultiplier",
    "maxMultiplier",
    "maxKm",
    "capacity",
  ];
  if (
    fields.some((key) => number(c[key]) === null) ||
    c.minMultiplier <= 0 ||
    c.maxMultiplier <= c.minMultiplier ||
    !Number.isInteger(c.capacity) ||
    people > c.capacity ||
    people < 1
  )
    return null;
  if (
    !(route.distanceMeters > 0) ||
    !(route.durationMinutes > 0) ||
    route.distanceMeters / 1000 > c.maxKm ||
    !route.trafficAware
  )
    return null;
  // Unknown tolls cannot be silently treated as zero in an all-in estimate.
  if (number(route.tollEstimatePHP) === null) return null;
  const base =
    c.basePHP +
    (route.distanceMeters / 1000) * c.perKmPHP +
    route.durationMinutes * c.perMinutePHP;
  if (!(base > 0)) return null;
  return {
    min: Math.floor((base * c.minMultiplier + route.tollEstimatePHP) / 10) * 10,
    max: Math.ceil((base * c.maxMultiplier + route.tollEstimatePHP) / 10) * 10,
  };
}

export function calibrationFor(serialized, origin, destination) {
  try {
    const rows = JSON.parse(serialized || "[]");
    // Explicit region names must occur in BOTH user-confirmed endpoints.
    return Array.isArray(rows)
      ? rows
          .slice(0, 30)
          .find(
            (c) =>
              typeof c?.region === "string" &&
              c.region.length > 2 &&
              origin.toLowerCase().includes(c.region.toLowerCase()) &&
              destination.toLowerCase().includes(c.region.toLowerCase()),
          )
      : null;
  } catch {
    return null;
  }
}
