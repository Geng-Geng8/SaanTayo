import { safeUrl } from "../shared/travel.js";
import { text, number } from "../shared/journey.js";
import { MODEL, callGemini } from "./gemini.js";

export const JOURNEY_ADVISOR_SCHEMA = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["grounded", "clarify", "unavailable"] },
    resolvedOrigin: { type: "string" },
    resolvedDestination: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    assumption: { type: "string" },
    summary: { type: "string" },
    recommendedMode: { type: ["string", "null"], enum: ["walk", "grab", "train", "local", null] },
    options: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["walk", "grab", "train", "local"] },
          label: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          durationMin: { type: ["number", "null"] },
          durationMax: { type: ["number", "null"] },
          costMinPHP: { type: ["number", "null"] },
          costMaxPHP: { type: ["number", "null"] },
          costBasis: { type: "string", enum: ["person", "vehicle", "free", "unknown"] },
          why: { type: "string" },
          caveats: { type: "array", maxItems: 4, items: { type: "string" } },
          steps: {
            type: "array",
            maxItems: 8,
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["start", "walk", "board", "ride", "transfer", "alight", "arrive"] },
                title: { type: "string" },
                instruction: { type: "string" },
                landmark: { type: "string" }
              },
              required: ["type", "title", "instruction", "landmark"]
            }
          }
        },
        required: ["mode", "label", "confidence", "durationMin", "durationMax", "costMinPHP", "costMaxPHP", "costBasis", "why", "caveats", "steps"]
      }
    },
    suggestions: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          origin: { type: "string" },
          destination: { type: "string" }
        },
        required: ["label", "origin", "destination"]
      }
    }
  },
  required: ["status", "resolvedOrigin", "resolvedDestination", "confidence", "assumption", "summary", "recommendedMode", "options", "suggestions"]
};

const SYSTEM = `You are SaanTayo's Philippine travel route advisor. Your job is to keep travellers inside SaanTayo when structured routing is missing or incomplete.

Use Google Maps and Google Search grounding before answering. Resolve natural place names into the most likely specific Philippine place using trip context. If an endpoint remains genuinely ambiguous, return status "clarify" with up to 3 concrete suggestions instead of guessing.

For route options, provide practical door-to-door estimates for walking (when places are nearby/walkable), Grab/taxi, rail, and local transport only when evidence supports them. Prefer ranges over false precision. Never invent an exact vehicle number, platform, headsign, stop, departure time, signboard, or fare. If evidence is weak, use null, a broad range, or omit that option. Walking cost is 0 PHP. Keep steps short and useful: where to walk, what mode to board, useful transfer area or landmark, and where to get off. Do not tell the user to leave SaanTayo; outside apps are optional confirmation tools only.

This is advisory guidance, not turn-by-turn navigation. Distinguish grounded estimates from verified provider data.`;

const bounded = (v, min, max) => {
  const n = number(v);
  return n !== null && n >= min && n <= max ? n : null;
};
const list = (v) => (Array.isArray(v) ? v : []);

function collectSources(data) {
  const sources = [];
  let mapsUsed = false;
  let searchUsed = false;
  for (const step of list(data?.steps)) {
    if (step.type === "google_maps_call" || step.type === "google_maps_result") mapsUsed = true;
    if (step.type === "google_search_call" || step.type === "google_search_result") searchUsed = true;
    if (step.type !== "model_output") continue;
    for (const block of list(step.content)) {
      if (block?.type !== "text") continue;
      for (const a of list(block.annotations)) {
        if (!["place_citation", "url_citation"].includes(a?.type)) continue;
        const url = safeUrl(a.url);
        if (!url) continue;
        const title = text(a.type === "place_citation" ? a.name || "Place" : a.title || "Source", 180);
        if (!title || sources.some((s) => s.url === url)) continue;
        sources.push({
          type: a.type === "place_citation" ? "maps" : "web",
          title,
          url,
        });
        if (sources.length >= 8) break;
      }
    }
  }
  return { sources, mapsUsed, searchUsed };
}

function modelText(data) {
  return list(data?.steps)
    .filter((s) => s?.type === "model_output")
    .flatMap((s) => list(s.content))
    .filter((c) => c?.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("");
}

export function parseAdvisorJson(text) {
  if (typeof text !== "string") return { status: "unavailable" };
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {}
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {}
  }
  const obj = trimmed.match(/\{[\s\S]*\}/);
  if (obj) {
    try {
      return JSON.parse(obj[0]);
    } catch {}
  }
  return { status: "unavailable" };
}

export function normalizeJourneyAdvice(raw, evidence = {}) {
  const status = ["grounded", "clarify", "unavailable"].includes(raw?.status)
    ? raw.status
    : "unavailable";
  const options = list(raw?.options)
    .slice(0, 3)
    .flatMap((option) => {
      if (!option || !["walk", "grab", "train", "local"].includes(option.mode)) return [];
      let durationMin = bounded(option.durationMin, 0, 1440);
      let durationMax = bounded(option.durationMax, 0, 1440);
      if (durationMin !== null && durationMax !== null && durationMax < durationMin)
        [durationMin, durationMax] = [durationMax, durationMin];
      let costMinPHP = option.mode === "walk" ? 0 : bounded(option.costMinPHP, 0, 50000);
      let costMaxPHP = option.mode === "walk" ? 0 : bounded(option.costMaxPHP, 0, 50000);
      if (costMinPHP !== null && costMaxPHP !== null && costMaxPHP < costMinPHP)
        [costMinPHP, costMaxPHP] = [costMaxPHP, costMinPHP];
      return [{
        mode: option.mode,
        label: text(option.label, 160) || `${option.mode} estimate`,
        confidence: ["high", "medium", "low"].includes(option.confidence) ? option.confidence : "low",
        durationMin,
        durationMax,
        costMinPHP,
        costMaxPHP,
        costBasis: option.mode === "walk" ? "free" : ["person", "vehicle", "free", "unknown"].includes(option.costBasis) ? option.costBasis : "unknown",
        why: text(option.why, 320),
        caveats: list(option.caveats).slice(0, 4).map((x) => text(x, 240)).filter(Boolean),
        steps: list(option.steps).slice(0, 8).flatMap((step) => {
          if (!step || !["start", "walk", "board", "ride", "transfer", "alight", "arrive"].includes(step.type)) return [];
          return [{ type: step.type, title: text(step.title, 160), instruction: text(step.instruction, 400), landmark: text(step.landmark, 180) }];
        })
      }];
    });
  const suggestions = list(raw?.suggestions)
    .slice(0, 3)
    .flatMap((s) => {
      const label = text(s?.label, 180), origin = text(s?.origin, 240), destination = text(s?.destination, 240);
      return label && origin && destination ? [{ label, origin, destination }] : [];
    });
  const sources = list(evidence.sources).slice(0, 8);
  const groundedStatus = status === "grounded" && options.length && sources.length ? "grounded" : status === "clarify" && suggestions.length ? "clarify" : "unavailable";
  return {
    status: groundedStatus,
    resolvedOrigin: text(raw?.resolvedOrigin, 240),
    resolvedDestination: text(raw?.resolvedDestination, 240),
    confidence: ["high", "medium", "low"].includes(raw?.confidence) ? raw.confidence : "low",
    assumption: text(raw?.assumption, 320),
    summary: text(raw?.summary, 500),
    recommendedMode: ["walk", "grab", "train", "local"].includes(raw?.recommendedMode) ? raw.recommendedMode : null,
    options: groundedStatus === "grounded" ? options : [],
    suggestions: groundedStatus === "clarify" ? suggestions : [],
    sources,
    toolsUsed: [evidence.mapsUsed ? "maps" : null, evidence.searchUsed ? "search" : null].filter(Boolean),
    generatedAt: new Date().toISOString(),
  };
}

export async function groundJourneyAdvice(
  query,
  env,
  { fetcher, signal, timeoutMs = 25000 } = {},
) {
  if (!env.GEMINI_API_KEY || env.ENABLE_GROUNDING !== "true")
    return normalizeJourneyAdvice({ status: "unavailable" });
  const model = /^gemini-[a-z0-9.-]+$/.test(env.GEMINI_MODEL || MODEL)
    ? env.GEMINI_MODEL || MODEL
    : MODEL;
  const data = await callGemini(
    {
      model,
      input: `Origin: ${query.origin}\nDestination: ${query.destination}\nDeparture: ${query.departureTime}\nTravellers: ${query.people}\n\nCreate the most useful in-app route guidance you can support with current Maps/Search evidence.`,
      system_instruction: SYSTEM,
      tools: [{ type: "google_maps" }, { type: "google_search", search_types: ["web_search"] }],
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: JOURNEY_ADVISOR_SCHEMA,
      },
      generation_config: { thinking_level: "medium", max_output_tokens: 4500 },
      store: false,
    },
    env.GEMINI_API_KEY,
    { fetcher, signal, timeoutMs },
  );
  const evidence = collectSources(data);
  const raw = parseAdvisorJson(modelText(data));
  return normalizeJourneyAdvice(raw, evidence);
}
