// Explicit local QA only. Never imported by the production Worker or static bundle.
import { startDevelopment } from "../scripts/dev.mjs";
import { costs, interaction, env } from "./fixtures.mjs";
import { calibration, driving, transit } from "./journey-fixtures.mjs";
startDevelopment({
  port: 8788,
  fixture: true,
  override: {
    ...env,
    ALLOWED_ORIGINS: "http://127.0.0.1:8788",
    GOOGLE_ROUTES_API_KEY: "synthetic-preview-only",
    GRAB_ESTIMATE_CALIBRATIONS: JSON.stringify([
      { ...calibration, reviewedAt: new Date().toISOString() },
    ]),
    GLOBAL_LIMITER: { limit: async () => ({ success: true }) },
  },
  dependencies: {
    routesFetcher: async (_, options) =>
      Response.json(
        JSON.parse(options.body).travelMode === "TRANSIT" ? transit() : driving,
      ),
    fetcher: async (url, options) => {
      if (url.includes("frankfurter"))
        return Response.json({
          base: "PHP",
          quote: "CAD",
          rate: 0.024,
          date: new Date().toISOString().slice(0, 10),
        });
      const body = JSON.parse(options.body);
      if (body.response_format)
        return Response.json({
          status: "completed",
          steps: [
            {
              type: "model_output",
              content: [{ type: "text", text: JSON.stringify(costs) }],
            },
          ],
        });
      const text = body.previous_interaction_id
        ? "## Follow-up · synthetic fixture\n\nKeep the heritage stops together. This answer tests conversation continuity; it is not verified travel advice."
        : undefined;
      return Response.json(interaction(text));
    },
  },
});
