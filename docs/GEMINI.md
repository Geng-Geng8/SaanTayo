# Gemini contract and decisions

Verified against current official Google documentation on **2026-08-27**:

- [Model](https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash) and [migration](https://ai.google.dev/gemini-api/docs/latest-model): production ID `gemini-3.7-flash`; use low/medium/high, not minimal. No temperature, top_p, top_k, thinking_budget or candidate_count is sent.
- [API versions](https://ai.google.dev/gemini-api/docs/api-versions) and [v1 reference](https://ai.google.dev/api/interactions-api-v1): direct REST `POST /v1/interactions`, `input`, `system_instruction`, `generation_config`, `tools`, `store`, `previous_interaction_id`. Some examples still show v1beta; the version guide explicitly documents v1. Live-smoke-test the actual paid project.
- [Interactions](https://ai.google.dev/gemini-api/docs/interactions-overview): repeat system instruction, tool configuration and thinking level on every request. Paid history retention is normally 55 days (configurable shorter). App tokens expire after 7 days; missing/expired history recovers from the saved answer and last six messages.
- [Search](https://ai.google.dev/gemini-api/docs/google-search) and [Maps](https://ai.google.dev/gemini-api/docs/maps-grounding): both tools supplied for new research; Gemini decides whether to invoke them. “This plan only” supplies neither. Tool availability/loading animations are not evidence of retrieval.
- [Structured output](https://ai.google.dev/gemini-api/docs/structured-output): optional budget extraction is schema-constrained JSON in a separate tool-free interaction. Its page does not explicitly establish Maps + JSON schema support; the app does not assume that combination works. No SDK/schema library is needed for this small REST boundary. Current SDK guidance uses `@google/genai`, not the legacy `@google/generative-ai`.
- [Key security](https://ai.google.dev/gemini-api/docs/api-key): server secrets/header authentication only; rotate browser-used credentials. Check Google's current auth-key migration requirements in AI Studio, including the documented September 2026 transition.

## Response handling

Read every text block in `steps[type=model_output].content`. Preserve `url_citation`/`place_citation`, title/name, URL, UTF-8 byte ranges and claim excerpt. Display source links immediately after the unchanged answer, including Google Maps attribution and review links. “Claims supported” expanders associate claims with sources without unsafe Markdown interpolation. Thought summaries/signatures are not exposed.

Preserve `google_search_result.result[].search_suggestions`, displayed in a sanitized, CSS-isolated shadow root. URL protocols and credential-bearing URLs are checked. No click tracking. Missing citations produce an unverified warning. Incomplete outputs/tool failures are not automatically retried or silently switched to another model/tool configuration.

## History and sharing

[Grounding terms](https://ai.google.dev/gemini-api/terms) restrict display, storage and export. Saved answers are personal conversation history, not a places database/shared cache. Maps-derived history lasts 175 days; Search-only history 700 days. Expiry removes the sourced answer, derived costs and token, retaining metadata/own notes. Checks run on app opening and loading/exporting; a closed app cannot actively erase browser data. Legacy plans remain unchanged because they lack trustworthy grounding metadata.

Maps restrictions follow signed conversation state even on tool-free turns. Maps answers cannot be shared/exported; own notes can. Backups omit conversation tokens. Browser/device backups are outside the app's control. Legacy migration preserves its original key as a recovery copy.

HMAC tokens prevent arbitrary raw interaction IDs from reaching Google. They are bearer capabilities, not authentication/encryption. Keep them private: a leaked token could reveal conversation context through the endpoint until expiry. Rotating `CONVERSATION_SECRET` invalidates tokens; local plans can reconnect.

## Cost

One request per generation/follow-up; optional extra extraction request. Search/Maps invocations may incur additional charges. Medium thinking, low for extraction/context-only chat; output caps 9,000/3,500/6,000 tokens (generation/chat/extraction). No retry for quota, network, timeout or malformed output. Explicit conversation expiry alone triggers one bounded recovery. Stateful history reduces retransmission but historical context is not free. See [current pricing](https://ai.google.dev/gemini-api/docs/pricing).
