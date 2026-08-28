// Explicit opt-in paid verification. Does not save raw research or print any secret.
import { callGemini, normalizeInteraction, MODEL } from "../server/gemini.js";
import { systemInstruction } from "../server/prompts.js";
try {
  process.loadEnvFile(".env");
} catch {}
if (process.env.RUN_LIVE_GEMINI !== "1" || !process.env.GEMINI_API_KEY) {
  console.log(
    "SKIPPED: set RUN_LIVE_GEMINI=1 and server-side GEMINI_API_KEY to run paid live checks.",
  );
  process.exit(0);
}
const base = {
  model: MODEL,
  system_instruction: systemInstruction(new Date().toISOString().slice(0, 10)),
  generation_config: { thinking_level: "medium", max_output_tokens: 6000 },
  store: true,
};
const cases = [
  [
    "Places",
    "Recommend two cafés in Cebu IT Park. Use Google Maps and cite actual retrieved places.",
  ],
  [
    "Transport",
    "Check current official information on ferries from Cebu to Tagbilaran. Distinguish current sources from schedules that need confirmation.",
  ],
];
let previous;
for (const [name, input] of cases) {
  const data = await callGemini(
    {
      ...base,
      input,
      tools: [{ type: "google_search" }, { type: "google_maps" }],
    },
    process.env.GEMINI_API_KEY,
  );
  const answer = normalizeInteraction(data);
  previous = data.id;
  console.log(
    `${name}: completed; ${answer.sources.length} sources; tools: ${answer.toolsUsed.join(", ") || "none"}.`,
  );
  if (!answer.sources.length) process.exitCode = 1;
}
const follow = await callGemini(
  {
    ...base,
    input: "Summarize that answer in three short bullets; do not add facts.",
    previous_interaction_id: previous,
    generation_config: { thinking_level: "low", max_output_tokens: 2000 },
  },
  process.env.GEMINI_API_KEY,
);
normalizeInteraction(follow);
console.log(
  "Stateful follow-up: completed without enabling tools. Review real answers manually before production use.",
);
