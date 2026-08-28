# SaanTayo

Mobile-first Philippines travel intelligence: practical itineraries, destination comparisons, local research, estimated budgets, saved conversations and travel notes. Vanilla HTML/JavaScript, the existing slate/cyan aesthetic, no accounts or database.

## Architecture

```text
GitHub Pages (static build + device-local plans + service worker)
    → Cloudflare Worker /api/travel → Gemini 3.7 Flash Interactions + Search/Maps
    → /api/budget → optional tool-free structured cost extraction
    → /api/fx → Frankfurter daily PHP/CAD reference rate
```

Google holds conversation state via `previous_interaction_id`. The browser holds a signed, expiring capability token and local recovery context. The key never reaches the frontend. The Worker uses official REST, with no Gemini SDK dependency. See [API decisions](docs/GEMINI.md), [audit](docs/AUDIT.md), [test coverage](docs/TESTING.md).

## Local development

Use Node 24 and pnpm 11.19 (`corepack enable` if pnpm is absent).

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm dev
```

Open `http://127.0.0.1:8787`. Rebuild after edits; there is no HMR. Saved plans/checklist work without a key; research reports setup is missing. For live research, copy `.env.example` to ignored `.env`, supply `GEMINI_API_KEY` and random `CONVERSATION_SECRET` (at least 32 characters), then restart the dev server. Never put secrets in frontend files or the app UI.

## Production setup — before merging

The original public site is **`https://geng-geng8.github.io/SaanTayo/`, GitHub Pages from `main:/`**. Keep this origin so old local plans remain accessible. Change its publishing mode to **GitHub Actions** for compiled assets; serving this source checkout directly is unsupported.

1. Create/use a Cloudflare account. Run `pnpm exec wrangler login` and `pnpm deploy:api` from this branch. No database/domain purchase is required. Review current hosting limits.
2. Set secrets interactively: `pnpm exec wrangler secret put GEMINI_API_KEY` and `pnpm exec wrangler secret put CONVERSATION_SECRET`. Generate the latter with a password manager or `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Never commit either. Rotate the Gemini key previously used in the browser; use the currently supported auth-key type in AI Studio and enable paid project/grounding access as needed.
3. Keep `ALLOWED_ORIGINS=https://geng-geng8.github.io` in `wrangler.jsonc`; explicitly add any other frontend origin, never `*`. CORS operates at origin level, so all pages under that GitHub user origin share the allowance.
4. Create GitHub **Actions repository variable** `SAANTAYO_API_BASE` with the Worker HTTPS origin printed by Wrangler (no path). This URL is public, not a secret. Do not add a frontend Gemini-key variable. Check `/api/health` reports `ready: true`.
5. Set conservative Gemini request quotas and billing alerts. Alerts and Worker rate limits are not hard global spending caps.
6. In **Settings → Pages → Build and deployment**, choose **GitHub Actions**. Merge the reviewed branch only after the Worker and public URL are ready. The Pages workflow validates, builds and publishes `dist/` on main. PR CI uses no credentials/paid Gemini and does not deploy the Worker.
7. Run the live checks below. Review sources and route feasibility on your phone; open once online, save a plan, test airplane mode. Close/reopen tabs after service-worker updates.

This upgrade does not change live credentials, billing, Pages settings or production hosting. **Do not merge while Pages still serves the raw branch.** Moving origins requires exporting eligible plans from the old origin first; browser storage cannot cross origins automatically.

### Environment

| Variable | Location | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | Worker secret / ignored local `.env` | Google authentication |
| `CONVERSATION_SECRET` | Worker secret / ignored `.env` | HMAC token signing, ≥32 characters |
| `GEMINI_MODEL` | Worker variable | `gemini-3.7-flash`; not client-controlled |
| `ALLOWED_ORIGINS` | Worker variable | Comma-separated exact frontend origins |
| `SAANTAYO_API_BASE` | GitHub variable / build environment | Public Worker HTTPS origin; empty for same-origin local development |

Bindings in `wrangler.jsonc`: 6 AI requests/minute/IP, 30/minute across users **per Cloudflare location**. Missing limiter fails closed. Mobile users may share an IP. These are not authentication or distributed-abuse protection. Add a challenge/private hosting access if this stops being a personal app; don't rely on CORS alone.

## Budgets and currencies

All caps are **PHP for the whole group**: lodging is all rooms/night; transport/activities/overall are whole-trip caps. Dates are inclusive; nights = days minus one. Flexible dates require an explicit 1–21-day duration and traveller count.

“Calculate itemized estimate” is one extra low-thinking extraction request. JavaScript validates rows, multiplies units/people/days/nights, sums in centavos, and displays category/per-person/per-day totals and overruns. Missing categories produce a subtotal warning. These are estimates, not quotes; check occupancy, optional alternatives and exclusions. Follow-ups do not silently rewrite the original plan/budget; generate a revised plan for a revised total.

PHP is the source currency. CAD is calculated from Frankfurter's dated reference rate, cached 24 hours. During outages a labelled cached rate may be used up to 10 days old; otherwise CAD is unavailable. Card/ATM fees and spreads aren't included. No paid FX service.

## Saved trips and offline use

Old `saantayo_saved_trips` records migrate to a separate versioned key without deleting/truncating the original. JSON/quota errors are visible. Save updates the same plan; tap Save to preserve replies/notes. Storage is device-local, unencrypted, and can be cleared/evicted. Export eligible plans for backup; Maps-answer export is restricted. [Retention details](docs/GEMINI.md).

After one successful online load, the service worker caches only app-shell/assets. Saved answers/source labels, own notes and checklist work offline. Links, live AI and fresh FX require internet. Unsaved answers are not silently cached. No runtime CDN/fonts are required. Linked manifest and real 192/512 icons support installation; browser install UI varies. Updates activate after old tabs close.

## Security and cost boundaries

User text uses text nodes; Markdown is sanitized by pinned DOMPurify; URL protocols are checked; provider CSS is isolated; external links use `noopener noreferrer`. CSP blocks remote scripts/unexpected connections. The API validates inputs/size/origins, masks errors, and doesn't log prompts/keys. Hosting/provider metadata logs may exist. Local storage is not secret storage; the public paid proxy retains abuse risk.

One request per generation/follow-up, optional extra cost extraction. Tools may add grounding charges. Medium thinking (low for extraction/context-only follow-ups), bounded outputs/context, no background research or blind paid retries. Signed server-side conversation references avoid resending an ever-growing transcript. [Details](docs/GEMINI.md).

## Tests and updates

```sh
pnpm build
pnpm check
pnpm test
pnpm audit
pnpm exec wrangler deploy --dry-run
```

Tests use synthetic Google responses, not a live model. `node tests/preview.mjs` serves a labelled fixture preview on port 8788 and never calls Google. For paid verification set `RUN_LIVE_GEMINI=1` and server-side `GEMINI_API_KEY`, then `pnpm test:live` (three requests). It reports metadata only; manually review answers as described in [TESTING](docs/TESTING.md).

For a model update, review Google's current model/version/tool contracts, change Worker `GEMINI_MODEL`, update prompts/contract tests, run live checks, then deploy the Worker. Do not silently fall back to a different model.
