import { AppError } from "../shared/travel.js";
let cached;
export function validRate(rate, now = Date.now()) {
  return (
    rate &&
    rate.base === "PHP" &&
    rate.quote === "CAD" &&
    Number.isFinite(rate.rate) &&
    rate.rate > 0 &&
    rate.rate < 10 &&
    /^\d{4}-\d{2}-\d{2}$/.test(rate.date) &&
    Number.isFinite(Date.parse(rate.date)) &&
    Date.parse(rate.date) <= now + 86400000
  );
}
export async function getRate({ fetcher = fetch, now = Date.now() } = {}) {
  if (cached && now - cached.fetchedAt < 24 * 3600000) return cached;
  try {
    const response = await fetcher(
      "https://api.frankfurter.dev/v2/rate/PHP/CAD",
      {
        signal: AbortSignal.timeout(6000),
        cf: { cacheTtl: 86400, cacheEverything: true },
      },
    );
    const data = response.ok ? await response.json() : null;
    if (!validRate(data, now) || now - Date.parse(data.date) > 10 * 86400000)
      throw new Error();
    cached = {
      base: "PHP",
      quote: "CAD",
      rate: data.rate,
      date: data.date,
      fetchedAt: now,
      provider: "Frankfurter",
      source: "https://frankfurter.dev/",
      stale: false,
    };
    return cached;
  } catch {
    if (cached && now - Date.parse(cached.date) <= 10 * 86400000)
      return { ...cached, stale: true };
    throw new AppError(
      "FX_UNAVAILABLE",
      "CAD reference rate is unavailable. PHP amounts remain usable.",
      503,
    );
  }
}
export function resetRateCache() {
  cached = undefined;
}
