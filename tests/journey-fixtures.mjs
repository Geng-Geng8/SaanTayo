// Synthetic provider contract fixtures; never used by the production app.
import {
  normalizeGoogleTransit,
  normalizeGoogleDriving,
} from "../server/routes.js";
import { normalizeJourney } from "../shared/journey.js";
export const query = {
  origin: "Test hotel, Manila",
  destination: "Test museum, Manila",
  departureTime: "2026-09-12T08:00:00Z",
  people: 4,
};
export const calibration = {
  id: "synthetic-model",
  evidence: "Synthetic test data only",
  region: "Manila",
  reviewedAt: "2026-09-11",
  basePHP: 50,
  perKmPHP: 13,
  perMinutePHP: 2,
  minMultiplier: 1,
  maxMultiplier: 1.35,
  maxKm: 40,
  capacity: 4,
};
export const geocodingResults = {
  origin: { placeId: "synthetic-origin", type: ["point_of_interest"] },
  destination: { placeId: "synthetic-destination", type: ["point_of_interest"] },
};
export const driving = {
  geocodingResults,
  routes: [
    {
      duration: "1800s",
      distanceMeters: 13800,
      travelAdvisory: {
        tollInfo: { estimatedPrice: [{ currencyCode: "PHP", units: "20" }] },
      },
    },
  ],
};
export function transit({ fare = true, rides = 3, rail = true } = {}) {
  return {
    geocodingResults,
    routes: [
      {
        duration: "3300s",
        distanceMeters: 15000,
        ...(fare
          ? {
              travelAdvisory: {
                transitFare: { currencyCode: "PHP", units: "42" },
              },
            }
          : {}),
        legs: [
          {
            steps: [
              {
                travelMode: "WALK",
                staticDuration: "360s",
                distanceMeters: 450,
                navigationInstruction: {
                  instructions: "Walk to the test stop",
                },
              },
              ...Array.from({ length: rides }, (_, i) => ({
                travelMode: "TRANSIT",
                staticDuration: "600s",
                distanceMeters: 4000,
                transitDetails: {
                  headsign: `Test headsign ${i}`,
                  stopDetails: {
                    departureStop: { name: `Test stop ${i}` },
                    arrivalStop: { name: `Test stop ${i + 1}` },
                    departureTime: new Date(Date.parse("2026-09-12T08:10:00Z") + (i * 16 + (i > 1 ? 1 : 0)) * 60000).toISOString(),
                    arrivalTime: new Date(Date.parse("2026-09-12T08:20:00Z") + (i * 16 + (i > 1 ? 1 : 0)) * 60000).toISOString(),
                  },
                  transitLine: {
                    nameShort: `Test line ${i}`,
                    vehicle: { type: rail ? "SUBWAY" : "BUS" },
                    agencies: [{ name: "Synthetic operator" }],
                  },
                },
              })),
              {
                travelMode: "WALK",
                staticDuration: "120s",
                distanceMeters: 150,
              },
            ],
          },
        ],
      },
    ],
  };
}
export function journeyFixture() {
  return normalizeJourney({
    ...query,
    status: "ok",
    generatedAt: "2026-09-12T07:59:00Z",
    routes: [
      ...normalizeGoogleTransit(transit(), query),
      ...normalizeGoogleDriving(
        driving,
        query,
        calibration,
        Date.parse("2026-09-12"),
      ),
    ],
  });
}
export function localRoute() {
  return {
    ...query,
    mode: "local",
    source: "official_operator",
    label: "Synthetic local route",
    totalCostPHP: 18,
    costSource: "official_operator",
    costBasis: "person",
    durationMinutes: 65,
    transferCount: 0,
    payment: "Cash",
    sourceAttribution: ["Synthetic operator"],
    steps: [
      {
        type: "board",
        title: "Board test vehicle",
        source: "official_operator",
        signboard: "TEST PARK • TEST TERMINAL",
        payment: "Cash",
        instruction: "Board at the marked test stop.",
      },
    ],
  };
}
