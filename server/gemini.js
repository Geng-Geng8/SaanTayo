import { AppError, safeUrl } from "../shared/travel.js";

export const MODEL = "gemini-3.7-flash";
export const ENDPOINT =
  "https://generativelanguage.googleapis.com/v1/interactions";
const encoder = new TextEncoder(),
  decoder = new TextDecoder();

export async function callGemini(
  body,
  key,
  { fetcher = fetch, signal, timeoutMs = 90000 } = {},
) {
  const timeout = AbortSignal.timeout(timeoutMs);
  let response;
  try {
    response = await fetcher(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) {
    if (signal?.aborted)
      throw new AppError(
        "CANCELLED",
        "Request cancelled. A request already received by Google may still incur usage.",
        499,
      );
    if (timeout.aborted || error.name === "TimeoutError")
      throw new AppError(
        "TIMEOUT",
        "Research took too long. Try a smaller request. Your previous plan is unchanged.",
        504,
      );
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      "The research service could not be reached. Try again when connected.",
      502,
    );
  }
  if (!response.ok) {
    // Never reflect provider messages: these may include project identifiers or request details.
    if ([404, 410].includes(response.status) && body.previous_interaction_id)
      throw new AppError(
        "CONVERSATION_EXPIRED",
        "This conversation is no longer available. Reconnect using the saved plan.",
        409,
      );
    if (response.status === 400 && body.previous_interaction_id) {
      const error = await response.json().catch(() => ({}));
      if (
        /previous_interaction|interaction.*(expired|not found|invalid)/i.test(
          error.error?.message || "",
        )
      )
        throw new AppError(
          "CONVERSATION_EXPIRED",
          "Reconnect using the saved plan.",
          409,
        );
    }
    if (response.status === 429)
      throw new AppError(
        "RATE_LIMITED",
        "Research quota or rate limit reached. Please wait and try again; the owner may need to check billing.",
        429,
      );
    if ([401, 403, 404].includes(response.status))
      throw new AppError(
        "PROVIDER_CONFIGURATION",
        "Gemini access needs attention. The app owner should check the server key, model access and billing.",
        503,
      );
    throw new AppError(
      "UPSTREAM_ERROR",
      "Google could not complete this research. Please try again later.",
      502,
    );
  }
  const data = await response.json().catch(() => null);
  if (!data || data.status !== "completed" || !Array.isArray(data.steps))
    throw new AppError(
      "INVALID_RESPONSE",
      "Google returned an incomplete answer. Try a smaller request; your previous plan is unchanged.",
      502,
    );
  return data;
}

export function normalizeInteraction(data, now = new Date()) {
  const parts = [],
    sources = [],
    suggestions = [],
    toolsUsed = new Set();
  let sawMaps = false;
  for (const step of data.steps) {
    if (
      step.type === "google_search_call" ||
      step.type === "google_search_result"
    )
      toolsUsed.add("search");
    if (
      step.type === "google_maps_call" ||
      step.type === "google_maps_result"
    ) {
      toolsUsed.add("maps");
      sawMaps = true;
    }
    if (step.type === "google_search_result" && Array.isArray(step.result)) {
      for (const result of step.result)
        if (
          typeof result.search_suggestions === "string" &&
          result.search_suggestions.length <= 100000
        )
          suggestions.push(result.search_suggestions);
    }
    if (step.type !== "model_output" || !Array.isArray(step.content)) continue;
    for (const block of step.content) {
      if (
        block.type !== "text" ||
        typeof block.text !== "string" ||
        !block.text.trim()
      )
        continue;
      const annotations = [];
      for (const a of Array.isArray(block.annotations)
        ? block.annotations
        : []) {
        if (!["url_citation", "place_citation"].includes(a.type)) continue;
        if (a.type === "place_citation") {
          sawMaps = true;
          toolsUsed.add("maps");
        }
        const url = safeUrl(a.url);
        if (!url) continue;
        const title = String(
          a.type === "place_citation"
            ? a.name || "Place"
            : a.title || new URL(url).hostname,
        ).slice(0, 400);
        const source = {
          type: a.type,
          title,
          url,
          reviews: (a.review_snippets || [])
            .filter((r) => safeUrl(r.url))
            .slice(0, 20)
            .map((r) => ({
              title: String(r.title || "Review"),
              url: safeUrl(r.url),
            })),
        };
        let index = sources.findIndex(
          (s) => s.url === url && s.type === a.type,
        );
        if (index < 0) {
          index = sources.length;
          sources.push(source);
        }
        // Official REST offsets are UTF-8 byte offsets, not JS UTF-16 indices.
        const bytes = encoder.encode(block.text);
        const start = Number.isInteger(a.start_index) ? a.start_index : -1,
          end = Number.isInteger(a.end_index) ? a.end_index : -1;
        const excerpt =
          start >= 0 && end > start && end <= bytes.length
            ? decoder.decode(bytes.slice(start, end))
            : "";
        annotations.push({
          source: index,
          startByte: start,
          endByte: end,
          excerpt: excerpt.slice(0, 1200),
        });
      }
      parts.push({ text: block.text, annotations });
    }
  }
  if (!parts.length || parts.reduce((n, p) => n + p.text.length, 0) > 120000)
    throw new AppError(
      "INVALID_RESPONSE",
      "No usable travel answer was returned. Your previous plan is unchanged.",
      502,
    );
  // Conservative retention within Google's six-month Maps / two-year Search history limits.
  const expiresAt = new Date(
    now.getTime() + (sawMaps ? 175 : 700) * 86400000,
  ).toISOString();
  return {
    parts,
    sources,
    suggestions,
    toolsUsed: [...toolsUsed],
    createdAt: now.toISOString(),
    expiresAt,
    model: MODEL,
    hasMaps: sawMaps,
    warnings: sources.length
      ? []
      : [
          "No source citations were returned. Treat time-sensitive information as unverified.",
        ],
  };
}
