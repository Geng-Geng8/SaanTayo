import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
test("service worker installs all shell assets; never caches API or external requests; cleans only its own scope", async () => {
  const source = await readFile("dist/sw.js", "utf8"),
    events = {},
    deleted = [],
    assets = [];
  const cache = {
    addAll: async (files) => assets.push(...files),
    match: async () => new Response("cached shell"),
  };
  const context = {
    URL,
    Set,
    Response,
    self: {
      registration: { scope: "https://example.com/SaanTayo/" },
      clients: { claim: async () => {} },
      addEventListener: (name, fn) => (events[name] = fn),
    },
    caches: {
      open: async () => cache,
      keys: async () => [
        "unrelated-cache",
        "saantayo-shell-/Other/-old",
        "saantayo-shell-/SaanTayo/-old",
      ],
      delete: async (name) => deleted.push(name),
    },
    fetch: async () => {
      throw new Error("offline");
    },
  };
  vm.runInNewContext(source, context);
  let work;
  events.install({ waitUntil: (p) => (work = p) });
  await work;
  assert.ok(assets.includes("./index.html"));
  assert.ok(assets.includes("./assets/app.js"));
  assert.ok(assets.includes("./assets/app.css"));
  events.activate({ waitUntil: (p) => (work = p) });
  await work;
  assert.deepEqual(deleted, ["saantayo-shell-/SaanTayo/-old"]);
  for (const url of [
    "https://example.com/api/travel",
    "https://example.com/SaanTayo/api/fx",
    "https://maps.google.com/",
  ]) {
    let intercepted = false;
    events.fetch({
      request: new Request(url),
      respondWith: () => (intercepted = true),
    });
    assert.equal(intercepted, false);
  }
  let result;
  events.fetch({
    request: new Request("https://example.com/SaanTayo/"),
    respondWith: (p) => (result = p),
  });
  assert.equal(await (await result).text(), "cached shell");
});
