import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGoogleTransit, planJourney, FIELD_MASKS } from "../server/routes.js";
import { query, transit, driving } from "./journey-fixtures.mjs";

test("total transit time includes initial wait, transfer waits and final walking", () => {
  assert.equal(normalizeGoogleTransit(transit(), query)[0].durationMinutes, 55);
  const later = transit({ rides: 1 });
  const stops = later.routes[0].legs[0].steps[1].transitDetails.stopDetails;
  stops.departureTime = "2026-09-12T08:17:00Z";
  stops.arrivalTime = "2026-09-12T08:27:00Z";
  assert.equal(normalizeGoogleTransit(later, query)[0].durationMinutes, 29);
  assert.equal(normalizeGoogleTransit(transit({ rides: 1 }), query)[0].durationMinutes, 22);
});

test("incomplete or uncatchable timetables cannot produce fastest duration claims", () => {
  for (const mutate of [
    (steps) => delete steps[1].transitDetails.stopDetails.arrivalTime,
    (steps) => { steps[1].transitDetails.stopDetails.departureTime = "2026-09-12T08:01:00Z"; },
    (steps) => delete steps[0].staticDuration,
    (steps) => { steps[2].transitDetails.stopDetails.departureTime = "2026-09-12T08:15:00Z"; },
  ]) {
    const response = transit();
    mutate(response.routes[0].legs[0].steps);
    const route = normalizeGoogleTransit(response, query)[0];
    assert.equal(route.durationMinutes, null);
    assert.match(route.warnings.join(" "), /Total time needs confirmation/);
  }
});

test("repeated rail departures do not hide a later local alternative", () => {
  const response = transit({ rides: 1 });
  const duplicates = Array.from({ length: 5 }, (_, i) => {
    const route = structuredClone(response.routes[0]);
    const stops = route.legs[0].steps[1].transitDetails.stopDetails;
    for (const field of ["departureTime", "arrivalTime"])
      stops[field] = new Date(Date.parse(stops[field]) + i * 7 * 60000).toISOString();
    return route;
  });
  response.routes = [...duplicates.reverse(), transit({ rides: 1, rail: false }).routes[0]];
  const routes = normalizeGoogleTransit(response, query);
  assert.equal(routes.length, 2);
  assert.deepEqual(routes.map((r) => r.mode), ["train", "local"]);
  assert.ok(routes.every((r) => r.durationMinutes === 22));
});

test("ambiguous, missing or inconsistent geocoding suppresses misleading routes", async () => {
  const invalid = [
    undefined,
    { ...driving.geocodingResults, destination: { placeId: "broad-area", type: ["political", "sublocality"] } },
    { ...driving.geocodingResults, destination: { ...driving.geocodingResults.destination, partialMatch: true } },
    { ...driving.geocodingResults, origin: { ...driving.geocodingResults.origin, geocoderStatus: { code: 5 } } },
    { ...driving.geocodingResults, destination: { ...driving.geocodingResults.destination, placeId: "different-place" } },
  ];
  for (const geocodingResults of invalid) {
    const journey = await planJourney(query, {}, { provider: {
      lookup: async (_, mode) => mode === "TRANSIT" ? transit() : { ...driving, geocodingResults },
    } });
    assert.equal(journey.status, "unavailable");
    assert.deepEqual(journey.routes, []);
    assert.match(journey.warnings.join(" "), /exact building, station or street address/);
  }
});

test("specific consistent geocoding permits rail and traffic-aware driving", async () => {
  const journey = await planJourney(query, {}, { provider: {
    lookup: async (_, mode) => mode === "TRANSIT" ? transit() : driving,
  } });
  assert.equal(journey.status, "ok");
  assert.deepEqual(journey.routes.map((r) => r.mode), ["train", "grab"]);
  for (const mask of Object.values(FIELD_MASKS))
    for (const endpoint of ["origin", "destination"])
      for (const field of ["type", "partialMatch", "placeId", "geocoderStatus.code"])
        assert.ok(mask.includes(`geocodingResults.${endpoint}.${field}`));
});
