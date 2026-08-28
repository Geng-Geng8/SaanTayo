# SaanTayo production audit — 2026-08-27

Baseline: `2068ac9`. All four tracked files and the nine-commit history inspected before implementation. GitHub API confirmed public GitHub Pages, `main:/`, at https://geng-geng8.github.io/SaanTayo/ (legacy branch publishing). No backend, tests, build system, service worker, repository deployment workflow, or repository instructions existed. GitHub's generated Pages workflow was present.

## Preserve

Mobile-first slate/cyan styling; small vanilla HTML/JS architecture; itinerary and destination comparison; traveller type and multi-select priorities; free activities; category budget controls; local saved plans; Markdown output; follow-up chat; native sharing. DOMPurify was correctly used on AI Markdown, but not on all other inputs.

## Ranked findings and decisions

| Priority | Problem and traveller impact | Proposed solution | Complexity | Now? |
| --- | --- | --- | --- | --- |
| P0 | User chat HTML and interpolated saved-trip names/IDs reach `innerHTML`: stored/reflected DOM injection can read the Gemini key. | Text nodes for user content, safe event listeners, current pinned sanitizer, URL allowlist, CSP. | Small | Yes |
| P0 | Browser key in `saantayo_gemini_key`, query-string authentication; “saved securely” is false. | Server-side secret in one Worker; remove legacy local key; rotate previously used key. | Medium | Yes |
| P0 | Unvalidated numbers/dates, currency-ambiguous caps, AI arithmetic and invented FX. | Explicit PHP caps and party size, civil-date validation, validated cost rows and deterministic totals; daily reference FX. | Medium | Yes |
| P1 | Loading falsely claims Reddit scanning/verified reviews; no citations, Maps or confidence. | Honest loading; preserve Search/Maps response annotations and attribution; grounded logistics instructions. | Medium | Yes |
| P1 | Saved plans restore text but leave a different/empty chat history. | Versioned local records; interaction token plus bounded context recovery; reset chat on load. | Medium | Yes |
| P1 | Comparison drops traveller type/priorities and asks for arbitrary scores. | Two explicit destinations; qualitative criteria, tie allowed, preference-based verdict. | Small | Yes |
| P1 | No days/people model; routes may be impractical. | Explicit duration, party size, arrival base, transfers, buffers and geographically clustered days. | Small | Yes |
| P2 | Manifest is not linked; icon dimensions declared without resizing; no offline shell; every dependency is remote. | Built local assets, real icons, linked manifest, versioned service worker; saved answers and checklist available offline. | Medium | Yes |
| P2 | `candidates[0].content.parts[0]` assumes valid output; raw errors, no cancellation, concurrent chat races. | Typed errors, HTTP/output checks, timeouts, one in-flight action, cancel, old answer retained on failure. | Medium | Yes |
| P2 | Saving silently truncates to 15 plans; JSON/storage errors crash; native share truncates at 500 characters. | Non-destructive migration and quota errors; explicit deletion; portable legacy export/import across origins. Respect Maps export restrictions. | Medium | Yes |
| P2 | Zoom disabled, tiny/icon-only controls, unlabelled fields, modal focus absent, wide tables, chat Enter absent. | Zoom, 44px targets, labels, native dialogs, scrollable tables, form keyboard submission. | Small | Yes |
| P2 | Default foodie vibe is not visually selected (brittle first-word matching). | Stable values with `aria-pressed`, no text matching. | Small | Yes |
| P2 | 1.91MB logo used at 32px; runtime Tailwind and unpinned CDNs. | Keep original asset; generate small derivatives; compile Tailwind, bundle pinned Markdown/sanitizer. | Small | Yes |
| P2 | Checklist states an entry action without eligibility/currentness. | Evergreen tickable reminders; official immigration/eTravel links for current requirements. | Small | Yes |
| P2 | Transcript grows indefinitely; searches enabled without request policy. | Server-side `previous_interaction_id`, bounded recovery, context-only follow-ups, no automatic paid retries. | Medium | Yes |
| P3 | No database, accounts, analytics, map canvas, route optimizer, or synchronisation. | Do not add them. Native Maps links and device-local plans are sufficient. | Large | No |

## Architecture decision

Preserve the GitHub Pages origin so existing localStorage remains accessible. Add one independently deployed Cloudflare Worker for `/api/travel`, `/api/budget`, `/api/fx`, `/api/health`. GitHub Actions builds the static frontend with its configured public Worker URL. The Worker can also serve the same static build on one origin. No database or accounts. Restrictive CORS is not authentication: native per-IP throttling and provider quota limits are required; public access retains distributed-abuse risk.

Use official Interactions REST rather than add an SDK for one JSON endpoint. The production model is `gemini-3.7-flash`, medium thinking. Check the version matrix and exact request/response schema; do not copy older `generateContent` examples or deprecated sampling parameters. Search + Maps are model-selected tools; context-only follow-ups omit tools. The structured budget extraction is an explicit optional second, tool-free request, avoiding an undocumented Maps + JSON-schema combination and preserving the original grounded answer.

Maps-grounded answers are personal chat history, not an exportable place database. Show all supplied attribution, preserve original answer separately from app calculations, cap retained Maps history below six months and Search history below two years. Keep traveller notes separately. No automatic background AI research or retries.

## Evidence caveats

Comments and commit messages are unreliable: two “print statement” commits actually replace large portions of HTML. No hard-coded real key was found in the repository; browser storage/network exposure still requires rotation of keys used there. Live model quality, billing/tool access and production hosting require credentials and must not be reported as tested without a live run.
