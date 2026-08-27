import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { handleRequest } from "../server/worker.js";
try {
  process.loadEnvFile(".env");
} catch {}
export function startDevelopment({
  port = Number(process.env.PORT || 8787),
  override = {},
  dependencies = {},
  fixture = false,
} = {}) {
  const origin = `http://127.0.0.1:${port}`,
    root = resolve("dist");
  // Local-only limiter. Production uses Cloudflare's rate-limit binding, never this map.
  const counters = new Map();
  const env = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    CONVERSATION_SECRET:
      process.env.CONVERSATION_SECRET || randomBytes(32).toString("hex"),
    ALLOWED_ORIGINS: origin,
    AI_LIMITER: {
      async limit({ key }) {
        const minute = Math.floor(Date.now() / 60000),
          old = counters.get(key);
        const count = old?.minute === minute ? old.count + 1 : 1;
        counters.set(key, { minute, count });
        return { success: count <= 6 };
      },
    },
    ...override,
  };
  const types = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".webp": "image/webp",
    ".png": "image/png",
  };
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, origin);
      if (url.pathname.startsWith("/api/")) {
        const controller = new AbortController();
        res.on("close", () => {
          if (!res.writableEnded) controller.abort();
        });
        const request = new Request(url, {
          method: req.method,
          headers: req.headers,
          body: ["GET", "HEAD"].includes(req.method) ? undefined : req,
          duplex: "half",
          signal: controller.signal,
        });
        const response = await handleRequest(request, env, {}, dependencies);
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      const path = resolve(
        root,
        "." +
          decodeURIComponent(
            url.pathname === "/" ? "/index.html" : url.pathname,
          ),
      );
      if (!path.startsWith(root + sep) || !(await stat(path)).isFile()) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": types[extname(path)] || "application/octet-stream",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      });
      const data = await readFile(path);
      res.end(
        fixture && extname(path) === ".html"
          ? data
              .toString()
              .replace(
                "<main ",
                '<aside class="notice warning">TEST PREVIEW · synthetic answers, not live travel research.</aside><main ',
              )
          : data,
      );
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  }).listen(port, "127.0.0.1", () =>
    console.log(
      `SaanTayo: ${origin} · ${env.GEMINI_API_KEY ? "live backend enabled" : "no key; offline features available"}`,
    ),
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  startDevelopment();
