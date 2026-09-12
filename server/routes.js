import {
  normalizeJourney,
  recommendJourney,
  number,
  text,
} from "../shared/journey.js";
import { calibrationFor, estimateGrab } from "./grab-estimate.js";

const ENDPOINT = "https://routes.googleapis.com/directions/v2:computeRoutes";
const STEP_MASK = "routes.legs.steps.";
export const FIELD_MASKS = Object.freeze({
  TRANSIT: [
    "routes.duration",
    "routes.distanceMeters",
    "routes.travelAdvisory.transitFare",
    ...[
      "travelMode",
      "staticDuration",
      "distanceMeters",
      "navigationInstruction.instructions",
      "transitDetails.stopDetails",
      "transitDetails.headsign",
      "transitDetails.transitLine.name",
      "transitDetails.transitLine.nameShort",
      "transitDetails.transitLine.vehicle.type",
      "transitDetails.transitLine.agencies.name",
    ].map((x) => STEP_MASK + x),
  ].join(","),
  DRIVE: "routes.duration,routes.distanceMeters,routes.travelAdvisory.tollInfo",
});
const seconds = (value) =>
  typeof value === "string" && /^\d+(\.\d+)?s$/.test(value)
    ? Number(value.slice(0, -1)) / 60
    : null;
export function phpMoney(value) {
  if (
    !value ||
    value.currencyCode !== "PHP" ||
    !/^-?\d+$/.test(String(value.units ?? 0))
  )
    return null;
  const nanos = value.nanos ?? 0;
  if (!Number.isInteger(nanos) || nanos < 0 || nanos >= 1e9) return null;
  return number(Number(value.units ?? 0) + nanos / 1e9);
}
const array = (value) => (Array.isArray(value) ? value : []);
export function normalizeGoogleTransit(response, query) {
  return array(response?.routes)
    .slice(0, 3)
    .flatMap((route) => {
      const rawSteps = array(route?.legs).flatMap((leg) => array(leg?.steps));
      if (
        !rawSteps.length ||
        rawSteps.length > 60 ||
        rawSteps.some((s) => !s || !["WALK", "TRANSIT"].includes(s.travelMode))
      )
        return [];
      const rides = rawSteps.filter((s) => s.travelMode === "TRANSIT");
      if (
        !rides.length ||
        rides.some(
          (s) =>
            !s.transitDetails?.stopDetails?.departureStop?.name ||
            !s.transitDetails?.stopDetails?.arrivalStop?.name,
        )
      )
        return [];
      const names = [],
        operators = [],
        steps = [
          { type: "start", title: query.origin, source: "google_routes" },
        ];
      let boarded = 0;
      for (const s of rawSteps) {
        if (s.travelMode === "WALK") {
          steps.push({
            type: "walk",
            title: "Walk",
            instruction: text(s.navigationInstruction?.instructions, 600),
            durationMinutes: seconds(s.staticDuration),
            distanceMeters: number(s.distanceMeters),
            source: "google_routes",
          });
          continue;
        }
        const d = s.transitDetails,
          stops = d.stopDetails,
          line = text(d.transitLine?.nameShort || d.transitLine?.name);
        if (line) names.push(line);
        operators.push(
          ...array(d.transitLine?.agencies)
            .map((a) => text(a?.name))
            .filter(Boolean),
        );
        if (boarded++)
          steps.push({
            type: "transfer",
            title: "Transfer",
            transferTo: line,
            stopName: text(stops.departureStop.name),
            source: "google_routes",
          });
        steps.push({
          type: "board",
          title: `Board${line ? ` ${line}` : ""}`,
          stopName: text(stops.departureStop.name),
          lineName: line,
          headsign: text(d.headsign),
          departureTime: text(stops.departureTime),
          source: "google_routes",
        });
        steps.push({
          type: "ride",
          title: line || "Ride",
          instruction: text(s.navigationInstruction?.instructions, 600),
          durationMinutes: seconds(s.staticDuration),
          distanceMeters: number(s.distanceMeters),
          lineName: line,
          source: "google_routes",
        });
        steps.push({
          type: "alight",
          title: "Alight",
          stopName: text(stops.arrivalStop.name),
          arrivalTime: text(stops.arrivalTime),
          source: "google_routes",
        });
      }
      steps.push({
        type: "arrive",
        title: query.destination,
        source: "google_routes",
      });
      const fare = phpMoney(route.travelAdvisory?.transitFare);
      const walks = rawSteps
        .filter((s) => s.travelMode === "WALK")
        .map((s) => seconds(s.staticDuration));
      const rail = rides.some((s) =>
        [
          "SUBWAY",
          "RAIL",
          "HEAVY_RAIL",
          "COMMUTER_TRAIN",
          "HIGH_SPEED_TRAIN",
          "LONG_DISTANCE_TRAIN",
          "METRO_RAIL",
          "MONORAIL",
          "TRAM",
        ].includes(s.transitDetails.transitLine?.vehicle?.type),
      );
      return [
        {
          ...query,
          mode: rail ? "train" : "local",
          label: [...new Set(names)].join(" + ") || "Public transit",
          source: "google_routes",
          durationMinutes: seconds(route.duration),
          distanceMeters: number(route.distanceMeters),
          totalCostPHP: fare,
          costSource: fare === null ? "unknown" : "google_transit",
          costBasis: "person",
          walkingMinutes: walks.every((v) => v !== null)
            ? walks.reduce((a, b) => a + b, 0)
            : null,
          transferCount: rides.length - 1,
          sourceAttribution: [
            "Google Maps · transit data",
            ...new Set(operators),
          ],
          warnings: [
            "Schedules and service may change. Confirm payment with the operator.",
          ],
          steps,
        },
      ];
    });
}
export function normalizeGoogleDriving(response, query, calibration, now) {
  return array(response?.routes)
    .slice(0, 1)
    .flatMap((route) => {
      const durationMinutes = seconds(route?.duration),
        distanceMeters = number(route?.distanceMeters);
      if (durationMinutes === null || distanceMeters === null) return [];
      const toll = route.travelAdvisory?.tollInfo;
      // An absent tollInfo means no tolls expected per Google; present without price means unknown.
      const prices = array(toll?.estimatedPrice).map(phpMoney);
      const tollEstimatePHP = !toll
        ? 0
        : prices.length && prices.every((p) => p !== null)
          ? prices.reduce((a, b) => a + b, 0)
          : null;
      const costRangePHP = estimateGrab(
        {
          durationMinutes,
          distanceMeters,
          tollEstimatePHP,
          trafficAware: true,
        },
        calibration,
        { people: query.people, now },
      );
      return [
        {
          ...query,
          mode: "grab",
          label: "Grab · driving route",
          source: "google_routes",
          durationMinutes,
          distanceMeters,
          costRangePHP,
          costSource: costRangePHP ? "saantayo_estimate" : "unknown",
          costBasis: "vehicle",
          capacity: calibration?.capacity || null,
          tollEstimatePHP,
          tollSource: "google_routes",
          walkingMinutes: null,
          transferCount: 0,
          sourceAttribution: [
            "Google Maps · driving data",
            ...(costRangePHP
              ? [`SaanTayo estimate · ${text(calibration.id)}`]
              : []),
          ],
          warnings: [
            "Check Grab availability and pickup wait in the app. Driving time excludes pickup wait.",
            "Actual Grab pricing may vary with demand.",
            ...(tollEstimatePHP === null ? ["Tolls need confirmation."] : []),
            ...(costRangePHP
              ? []
              : [
                  "No current regional calibration or sufficient fare inputs. Check live Grab fare.",
                ]),
          ],
          steps: [
            { type: "start", title: query.origin },
            {
              type: "board",
              title: "Confirm pickup in Grab",
              instruction:
                "Check service availability, pickup point, fare, payment and vehicle details in the app.",
            },
            {
              type: "ride",
              title: "Driving route",
              durationMinutes,
              distanceMeters,
            },
            { type: "arrive", title: query.destination },
          ],
        },
      ];
    });
}
async function boundedJson(response) {
  if (!response.ok || !response.body) throw new Error("provider_unavailable");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 500000) {
      await reader.cancel();
      throw new Error("provider_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
// Request-scoped deduplication only. Google route content is not persisted/cached.
export function createGoogleProvider({
  key,
  fetcher = fetch,
  signal,
  timeoutMs = 6000,
} = {}) {
  const pending = new Map();
  return {
    lookup(query, travelMode) {
      const body = {
        origin: { address: query.origin },
        destination: { address: query.destination },
        travelMode,
        departureTime: query.departureTime,
        languageCode: "en",
        regionCode: "PH",
        ...(travelMode === "DRIVE"
          ? { routingPreference: "TRAFFIC_AWARE", extraComputations: ["TOLLS"] }
          : { computeAlternativeRoutes: true }),
      };
      const id = JSON.stringify(body);
      if (!pending.has(id))
        pending.set(
          id,
          (async () => {
            const controller = new AbortController();
            const abort = () => controller.abort();
            signal?.addEventListener("abort", abort, { once: true });
            if (signal?.aborted) abort();
            let timer;
            try {
              return await Promise.race([
                fetcher(ENDPOINT, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "X-Goog-Api-Key": key,
                    "X-Goog-FieldMask": FIELD_MASKS[travelMode],
                  },
                  body: id,
                  signal: controller.signal,
                }).then(boundedJson),
                new Promise((_, reject) => {
                  timer = setTimeout(
                    () => {
                      controller.abort();
                      reject(new Error("provider_timeout"));
                    },
                    Math.min(Math.max(timeoutMs, 1), 8000),
                  );
                }),
              ]);
            } finally {
              clearTimeout(timer);
              signal?.removeEventListener("abort", abort);
            }
          })(),
        );
      return pending.get(id);
    },
  };
}
export async function planJourney(
  query,
  env,
  { fetcher, signal, timeoutMs, now = Date.now(), provider } = {},
) {
  const base = {
    ...query,
    generatedAt: new Date(now).toISOString(),
    routes: [],
    warnings: [],
  };
  if (!env.GOOGLE_ROUTES_API_KEY && !provider)
    return normalizeJourney({
      ...base,
      status: "not_configured",
      warnings: [
        "Routing is not configured. Fare and directions need confirmation.",
      ],
    });
  const google =
    provider ||
    createGoogleProvider({
      key: env.GOOGLE_ROUTES_API_KEY,
      fetcher,
      signal,
      timeoutMs,
    });
  const results = await Promise.allSettled(
    ["TRANSIT", "DRIVE"].map((mode) => google.lookup(query, mode)),
  );
  let routes = [],
    failed = 0;
  for (const [index, result] of results.entries()) {
    if (result.status !== "fulfilled") {
      failed++;
      continue;
    }
    try {
      routes.push(
        ...(index === 0
          ? normalizeGoogleTransit(result.value, query)
          : normalizeGoogleDriving(
              result.value,
              query,
              calibrationFor(
                env.GRAB_ESTIMATE_CALIBRATIONS,
                query.origin,
                query.destination,
              ),
              now,
            )),
      );
    } catch {
      failed++;
    }
  }
  return recommendJourney(
    normalizeJourney({
      ...base,
      routes,
      status: routes.length ? (failed ? "partial" : "ok") : "unavailable",
      warnings: failed
        ? ["Some routing data is unavailable. Try again later or check Maps."]
        : routes.length
          ? []
          : [
              "No supported routes returned for these endpoints and departure time.",
            ],
    }),
    query.people,
  );
}
