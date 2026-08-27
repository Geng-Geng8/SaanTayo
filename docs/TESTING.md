# Verification record

Run date: 2026-08-27. Runtime: Node 24.19.0, pnpm 11.19.0, Windows.

## Executed

- `pnpm build`: passed. Locally bundled JS/CSS, manifest/icons and versioned service worker emitted. Tailwind reports an outdated Browserslist dataset warning; compilation succeeds.
- `pnpm check`: passed syntax, unique IDs, accessible labels, manifest, no inline handlers, no remote runtime assets and no backend key/API identifiers in the browser bundle.
- `pnpm test`: **47 passing** tests across API, deterministic domain logic, storage, DOM interactions/sanitization, and service-worker cache policy.
- `pnpm audit`: zero reported production or development advisories after upgrading sharp to 0.35.4. Advisory scans are a point-in-time check, not a security guarantee.
- `wrangler deploy --dry-run`: passed Worker compilation/bindings; no deployment performed.
- `pnpm test:live`: explicitly **skipped** because no Gemini credentials/paid-test opt-in were configured. No live Gemini billable request was made.
- Real unauthenticated Frankfurter PHP/CAD endpoint: returned a valid dated rate (`2026-08-27`, `0.02245` CAD/PHP). This is a test observation, not a permanently configured rate.

## Automated coverage

| Area | Exercised with synthetic fixtures |
|---|---|
| Itinerary | Cebu trip, strict/flexible, PHP/dual currency, multiple priorities, party size, valid/invalid dates |
| Research | Search/Maps request config, sources/reviews/suggestions, all text blocks, UTF-8 citation offsets, missing citations |
| Comparison | Two distinct destinations required, traveller priorities and party carried to prompt; no assertion of actual model verdict quality |
| Budget | All categories, deterministic totals/per-person/per-day/remaining, cap violations, incomplete costs, malformed schema, no double multiplication |
| Chat | Immediate/repeated follow-ups, context-only/no tools, fresh tools, saved context, expired/tampered IDs, one bounded recovery |
| Saved plans | Save/update/reload/open/follow-up/delete, legacy migration >15 records, original backup retained, corrupt JSON/quota errors, notes, retention and export restrictions |
| Failures | Network/backend/provider errors, 429 quota/rate, missing secrets/limiter, bad JSON, no output, incomplete output, timeout, cancellation/late reply, duplicate submit |
| Security | Chat/saved-title/Markdown injection, unsafe URL schemes, CORS, body limits, signed capabilities, secrets absent from bundle |
| Offline | UI offline mode, saved data/checklist, shell-only cache install/fetch, unrelated caches preserved |

## Browser checks

Used the Codex in-app Chromium browser with the actual built frontend and an isolated, visibly labelled synthetic-response server. No browser request was sent to Google. Exercised itinerary generation, strict cap input, PHP/CAD estimate, source links/long names, saved notes, saving/reloading/reopening a trip, follow-up sending and restoration. Actual live model quality is not established by these checks.

Viewport overrides: **320, 375, 390, 430, 768, 1440 px**. DOM layout measurements found no document horizontal overflow at each width; wide tables scroll inside their own region. Content widths were 4px smaller due to the scrollbar. Source names wrap. Mobile screenshots reviewed at 390 and 320px. Native dialog/keyboard controls inspected. Mobile Safari, Android installation, on-device airplane mode and slow real mobile networks still require hands-on verification.

Stopped the fixture server, reloaded the browser, opened Saved trips and restored the itinerary and its notes from the cached shell/local storage. This verifies server-unreachable reopening, not a hardware airplane-mode test. Enter handling has a separate DOM test; browser keyboard checks are recorded separately from click submission.

## Required live acceptance before production

Set the Worker secrets/billing first. Run the opt-in live script (three model calls) and then manually check:

1. A 3-day Cebu itinerary for two with food/heritage preferences, then a strict low-budget version. Check total/unit assumptions and whether impossibility is honestly explained.
2. El Nido + Coron: reject or appropriately budget long transfers; check geography, weather/sea buffers and flight connections.
3. Ask for current cafés in Cebu IT Park; inspect actual Maps citations and source names.
4. Ask for current Cebu–Tagbilaran ferry information; inspect operator/date/schedule sources and confirmation caveats.
5. Compare Siquijor vs Bohol for a couple prioritising food/beaches, then a family prioritising transport ease. Confirm the explanation changes, allows ties, and avoids fake scores.
6. Ask a fresh transport question in Auto, then a pure summary in This plan only; inspect provider usage/tool steps. Verify no tools for context-only.
7. Save, reload, open, ask two follow-ups, test an expired token/reconnect. Ensure correct itinerary, not another saved plan.
8. Open online, save, close and reopen in airplane mode on the travel phone. Test notes/checklist/source labels. External source pages and AI must not appear available offline.
9. Review Google Search suggestion styling and Maps attribution against real provider payloads and current terms.

Document real response quality and provider permissions before calling this production-validated. No test here confirms future ferry departures, hotel availability or final booking prices.
