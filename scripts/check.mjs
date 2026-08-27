import { readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
for (const directory of ["src", "server", "shared", "scripts"])
  for (const file of await readdir(directory))
    if (/\.m?js$/.test(file))
      execFileSync(process.execPath, ["--check", `${directory}/${file}`]);
const html = await readFile("dist/index.html", "utf8"),
  js = await readFile("dist/assets/app.js", "utf8");
const doc = new JSDOM(html).window.document;
assert.equal(
  doc.querySelectorAll('script[src^="http"],link[href^="http"]').length,
  0,
);
assert.equal(doc.querySelectorAll("[onclick],[onerror]").length, 0);
const ids = [...doc.querySelectorAll("[id]")].map((x) => x.id);
assert.equal(ids.length, new Set(ids).size);
for (const input of doc.querySelectorAll(
  "input:not([type=radio]):not([type=checkbox]),select,textarea",
))
  assert.ok(
    input.labels?.length || input.getAttribute("aria-label"),
    `Missing label: ${input.id}`,
  );
assert.ok(doc.querySelector("link[rel=manifest]"));
assert.ok(!html.includes("user-scalable=no"));
assert.ok(!html.includes("__CSP__"));
for (const needle of [
  "generativelanguage.googleapis.com",
  "x-goog-api-key",
  "GEMINI_API_KEY",
  "unit-test-only",
  "unit-test-signing-secret",
])
  assert.ok(!js.includes(needle), `Server value in browser bundle: ${needle}`);
const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));
assert.deepEqual(
  manifest.icons.map((i) => i.sizes),
  ["192x192", "512x512"],
);
console.log(
  "Syntax, labels, unique IDs, manifest, no remote runtime assets, and client/server boundary checks passed.",
);
