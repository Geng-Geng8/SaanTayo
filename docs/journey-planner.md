# Trustworthy journey planner

## Scope and branch decision

Started from main `f9a62ed611d2b0b4425f576a5a45850db39d2402`. Compared draft PR #6 at `0ca963ae7726a7de29f59f138f02c471789dc505` before editing. The new branch `feature/trustworthy-journey-planner` supersedes its transit implementation without merging or closing it. PR #6's small renderer, endpoint-aware Maps/Sakay helpers, semantic stepper and mode availability patterns informed this implementation. Its AI-first parser and broad styling changes were not carried forward. Main's existing itinerary, dining, activities, accommodation, budgeting and shared shortlist flows remain in place.

## Data flow

Traveller confirms endpoints and departure → POST `/api/journey` → Google Routes adapter → canonical journey → deterministic comparisons → UI.

`shared/journey.js` defines the validated version-1 contract, cost provenance, safe legacy adapter, party calculations, recommendations and link construction. `server/routes.js` owns Google requests and normalization; `server/grab-estimate.js` owns optional regional calibration. `src/transit-render.js` renders text nodes, native disclosures and accessible mode tabs. No new dependencies or infrastructure are required.

A journey has origin, destination, departureTime, generatedAt, status, warnings, recommendedRouteId and routes. Routes include mode/family, durationMinutes, distanceMeters, monetary fields, costSource, costBasis, capacity, confidence, walkingMinutes, transferCount, tollEstimatePHP/tollSource, sourceAttribution, warnings, bestFor and typed steps. Steps retain walk distance/time, line, stop, headsign, departure/arrival time, transfer target, payment, signboard and cost provenance when available. All unknown numeric fields are null. An absent fare is not zero. PHP is accepted only when Google's Money currencyCode is PHP.

Legacy flat and multimodal `transit` blocks supply editable endpoints only. Unsourced prices, instructions, signboards and stations cannot enter the canonical routes, even if an AI block claims a trusted source. Existing saved plans remain readable. New shortlist entries save user-confirmed endpoints and an application-built Maps link, with an unknown fare. Google-derived steps, schedules and estimates are not written to localStorage or Sheets.

Google does not expose payment methods or exact physical jeepney signs in this adapter. Those fields stay unknown. The canonical model supports `official_operator` and `user_confirmed` facts for a future trusted server adapter; no operator dataset or user-confirmation editor is shipped here. Such adapters must supply their own verified evidence. No AI data should call `normalizeRoute` directly. The browser renders only the server response, while all saved itinerary text uses `legacyJourneys`.

## Google configuration

Optional server secret: `GOOGLE_ROUTES_API_KEY`. It is independent of `GEMINI_API_KEY` and never read by the build. Enable the Routes API and billing in your Google Cloud project, restrict the key to that API, and set an appropriate Google quota/budget for your account. For local development add it to the ignored `.env`; for a future deployment set it as a Worker secret. This change does not set secrets or deploy anything.

When you choose to activate real routing, use `pnpm exec wrangler secret put GOOGLE_ROUTES_API_KEY` from the repository root and enter the key at its prompt. The optional JSON calibration can likewise be set with `pnpm exec wrangler secret put GRAB_ESTIMATE_CALIBRATIONS`. These setup commands are documentation only; they were not executed during this task.

The endpoint applies the existing origin checks and body limit, validates endpoints, party size and departure, and requires both existing Worker rate-limit bindings when Google is configured. It does not require Gemini credentials. No key returns HTTP 200 with `not_configured`, empty routes and explicit unknown messaging. Provider failure is similarly contained; itinerary generation does not call this endpoint automatically.

Each explicit lookup makes at most two calls: TRANSIT with alternatives and DRIVE with TRAFFIC_AWARE and TOLLS. Separate field masks request only used route/step facts and agency names, excluding polylines. Each response is limited to 500 KB and each call to 6 seconds (hard maximum 8 seconds); there are no retries. Identical lookups share a promise inside a provider instance. Duplicate form submits are blocked; switching mode, expanding directions and saving do not call Google. The existing per-IP and aggregate limiters are location-scoped safeguards, not a hard global billing cap.

There is no cross-request Google content cache. In-flight deduplication and reuse of the displayed response avoid duplicate calls without persisting restricted route content. [Google Routes policies](https://developers.google.com/maps/documentation/routes/policies) describe caching restrictions and attribution. The UI displays Google Maps text attribution and returned agency names. Google data is visually contained in route cards.

TRANSIT accepts the requested departure, up to 100 days ahead; this implementation does not request past departures. Now and presets resolve to explicit ISO timestamps; presets mean the next 08:00, 12:00 or 18:00 in Asia/Manila. Custom input is also Philippine time, regardless of device timezone. The card shows the resolved date/time and lookup time. [Google request reference](https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes), [transit documentation](https://developers.google.com/maps/documentation/routes/transit-route).

## Grab range calibration

There is no scraping, private API, live Grab quote or built-in assumed tariff. Without a suitable reviewed model, the driving route displays **Check live Grab fare**. Service availability, pickup wait and payment are confirmed in Grab; a driving route does not establish Grab availability.

Optional server configuration: `GRAB_ESTIMATE_CALIBRATIONS`, a JSON array. Each regional model needs:

| Field | Meaning |
| --- | --- |
| id | Versioned model identifier |
| region | Explicit region string required in both confirmed endpoint addresses |
| evidence | Description/reference for the operator's calibration observations |
| reviewedAt | ISO date; models expire after 90 days |
| basePHP, perKmPHP, perMinutePHP | Reviewed coefficients |
| minMultiplier, maxMultiplier | Positive ordered range bounds |
| maxKm | Maximum distance covered by the model |
| capacity | Maximum travellers in the calibrated vehicle |

Base estimate = basePHP + distanceKm × perKmPHP + drivingMinutes × perMinutePHP. Bounds apply the calibrated multipliers and add Google's returned PHP toll estimate; lower/upper bounds round outward to ₱10. Unknown tolls, expired or absent calibration, missing timing/distance, excess range or excess party capacity suppress the estimate. Google's absent tollInfo means no tolls expected; a present tollInfo without a price remains unknown. [Google toll documentation](https://developers.google.com/maps/documentation/routes/calculate_toll_fees).

The repository includes only explicitly synthetic calibration in test fixtures. Supply a locally reviewed model before expecting monetary Grab ranges in production. This is intentional: invented default coefficients would reproduce the original trust problem.

## Comparison and UX

All alternatives receive compact overview buttons. A faster known duration earns Fastest; a strictly lower group cost interval earns Cheapest only when every alternative has comparable cost basis/capacity. Fewest transfers requires complete transfer counts. The recommendation is explicitly **fastest route**, not an assertion about an unknown pickup wait or traveller preference. Unknown metrics prevent badges. No unsupported luggage, groups or traffic badges are emitted.

Per-person transit costs multiply by traveller count; per-vehicle ranges divide by count only within known capacity. Cross-mode tradeoff text requires compatible endpoints and known times and costs. It uses the entire cost difference interval and states that driving excludes pickup wait.

Mode buttons have disabled states, tab/tabpanel relationships, roving tabindex and Arrow/Home/End keyboard handling. Native details/summary expose collapsed directions to keyboards and assistive technology. Start, walk, board, ride, transfer, alight and destination have distinct markers plus textual labels. Costs and payment appear together. Missing physical signs explicitly require local confirmation.

Google Maps directions include both endpoints. Sakay search links use the PR #6 from/to convention and appear only for Metro Manila-related endpoints; users must verify coverage and results on Sakay. The parameter convention has automated construction tests, but live Sakay routing behavior has not been verified. There is no undocumented Grab deep link; the UI instructs travellers to check their Grab app.

## Verification and preview

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm run check
pnpm test
pnpm audit --prod
pnpm exec wrangler deploy --dry-run --outdir worker-build
```

The final command packages only; it does not deploy. On this Windows host, esbuild/Wrangler needed execution outside the filesystem sandbox to resolve dependency paths. CI runs the same commands on Linux. New tests cover Google contract normalization, present/absent fares, estimates and calibration failures, missing credentials, outages, no rail fallback, legacy/malformed AI blocks, verified versus unverified signboards, Cash versus Beep, multiple transfers, group costs, Maps/Sakay URLs, tab switching, disclosure, shortlist bookmarks, XSS, time selection, limits, deduplication, timeout and oversized responses.

Credential-free synthetic preview:

```sh
pnpm run build
node tests/preview.mjs
```

Open `http://127.0.0.1:8788/?synthetic=1` (the query ensures the isolation header is fetched even if an older service worker cached the app shell). The banner identifies synthetic answers. Generate a test itinerary, then enter **Test hotel, Manila** and **Test museum, Manila** in Transit Navigator, select a departure and press **Find routes**. Inspect range/source labels, group totals, tabs, disabled Local mode, and expanded Train directions. The synthetic preview restricts browser connections to itself so fixture trips cannot reach the production Sheets endpoint. Synthetic provider data and calibration are confined to tests.

For no-key operation, `pnpm dev` serves `http://127.0.0.1:8787`. Open an existing itinerary (or generate one if Gemini is configured), confirm endpoints and search. Expect unknown/unavailable routing, with the itinerary unaffected. For real routing, set the ignored local GOOGLE_ROUTES_API_KEY first, restart `pnpm dev`, and use real, explicit Philippine endpoint addresses. Live routing and local calibration quality still need validation with real credentials before release.
