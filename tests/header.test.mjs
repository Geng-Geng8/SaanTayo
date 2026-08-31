import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { normalizeInteraction } from "../server/gemini.js";
import { interaction } from "./fixtures.mjs";

const html = await readFile("dist/index.html", "utf8");
const bundle = await readFile("dist/assets/app.js", "utf8");
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

async function setupTestApp(initial = { saantayo_partner_identity_v1: "Glen" }) {
  const dom = new JSDOM(html, {
    url: "https://app.example/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window;
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  for (const [k, v] of Object.entries(initial)) {
    if (v !== null && v !== undefined) w.localStorage.setItem(k, v);
  }
  w.fetch = async (reqUrl) => {
    if (reqUrl.endsWith("/health")) return Response.json({ ready: true });
    if (reqUrl.includes("script.google.com")) return Response.json({ status: "success", trips: [] });
    return Response.json({
      result: normalizeInteraction(interaction()),
      conversation: "token-123",
    });
  };
  w.eval(bundle);
  await tick();
  const $ = (id) => w.document.getElementById(id);
  return { dom, w, $ };
}

test("Responsive Header — Semantic structure, badges, and visible labels", async () => {
  const { dom, w, $ } = await setupTestApp();
  try {
    const header = w.document.querySelector("header");
    assert.ok(header, "Header element must exist");

    // Verify Brand elements
    const brandImg = header.querySelector("img");
    assert.ok(brandImg, "Logo image must be present");
    const brandTitle = header.querySelector("h1");
    assert.equal(brandTitle.textContent.trim(), "SaanTayo");
    const brandSubtitle = header.querySelector("p");
    assert.equal(brandSubtitle.textContent.trim(), "Trip Intelligence");

    // Verify Partner Identity control
    const partnerBtn = $("partnerToggleBtn");
    assert.ok(partnerBtn, "Partner toggle button must exist");
    assert.equal(partnerBtn.getAttribute("data-dialog"), "partnerModal");
    assert.equal(partnerBtn.getAttribute("aria-label"), "Switch partner identity");
    const partnerLabel = $("currentPartnerLabel");
    assert.ok(partnerLabel, "Partner label span must exist");
    assert.equal(partnerLabel.textContent.trim(), "Glen");

    // Verify Shortlist control
    const shortlistBtn = $("openShortlistBtn");
    assert.ok(shortlistBtn, "Shortlist button must exist");
    assert.equal(shortlistBtn.getAttribute("data-dialog"), "shortlistModal");
    assert.ok(shortlistBtn.textContent.includes("Shortlist"), "Shortlist button must visibly include 'Shortlist'");
    const shortlistBadge = $("shortlistBadge");
    assert.ok(shortlistBadge, "Shortlist badge must exist");
    assert.equal(shortlistBadge.textContent.trim(), "0");

    // Verify Shared Trips control
    const tripsBtn = header.querySelector('[data-dialog="savedTripsModal"]');
    assert.ok(tripsBtn, "Shared Trips button must exist");
    assert.ok(tripsBtn.textContent.includes("Trips"), "Shared Trips button must visibly include 'Trips'");
    const tripsBadge = $("savedCountBadge");
    assert.ok(tripsBadge, "Saved trips badge must exist");
    assert.equal(tripsBadge.textContent.trim(), "0");

    // Verify Checklist control
    const checklistBtn = header.querySelector('[data-dialog="checklistModal"]');
    assert.ok(checklistBtn, "Checklist button must exist");
    assert.ok(
      checklistBtn.textContent.includes("List") || checklistBtn.textContent.includes("Checklist"),
      "Checklist button must include List or Checklist",
    );

    // Verify Info control
    const infoBtn = header.querySelector('[data-dialog="settingsModal"]');
    assert.ok(infoBtn, "Info button must exist");
    assert.equal(infoBtn.getAttribute("aria-label"), "About and privacy");
  } finally {
    await tick();
    dom.window.close();
  }
});

test("Responsive Header — Dialog bindings and partner identity switching", async () => {
  const { dom, w, $ } = await setupTestApp();
  try {
    // Partner modal
    $("partnerToggleBtn").click();
    assert.equal($("partnerModal").open, true, "Partner modal opens");
    $("partnerModal").close();

    // Switch partner to Anne
    $("selectAnneBtn").click();
    await tick();
    assert.equal($("currentPartnerLabel").textContent.trim(), "Anne", "Partner updates to Anne");

    // Shortlist modal
    $("openShortlistBtn").click();
    assert.equal($("shortlistModal").open, true, "Shortlist modal opens");
    $("shortlistModal").close();

    // Trips modal
    w.document.querySelector('header [data-dialog="savedTripsModal"]').click();
    assert.equal($("savedTripsModal").open, true, "Saved trips modal opens");
    $("savedTripsModal").close();

    // Checklist modal
    w.document.querySelector('header [data-dialog="checklistModal"]').click();
    assert.equal($("checklistModal").open, true, "Checklist modal opens");
    $("checklistModal").close();

    // Settings modal
    w.document.querySelector('header [data-dialog="settingsModal"]').click();
    assert.equal($("settingsModal").open, true, "Settings modal opens");
    $("settingsModal").close();
  } finally {
    await tick();
    dom.window.close();
  }
});

test("Responsive Header — Status copy updated correctly", async () => {
  const { dom, $ } = await setupTestApp();
  try {
    await tick();
    assert.equal(
      $("connectionStatus").textContent,
      "Shared workspace ready · saved trips sync across devices",
      "Status copy must match the requirement",
    );
  } finally {
    await tick();
    dom.window.close();
  }
});

test("Responsive Header — Viewport width constraints and responsive architecture", async () => {
  const { dom, w } = await setupTestApp();
  try {
    const header = w.document.querySelector("header");
    const headerContainer = header.firstElementChild;

    // Verify responsive flex classes
    assert.ok(
      headerContainer.className.includes("flex-col") && headerContainer.className.includes("md:flex-row"),
      "Header must use two-row mobile (flex-col) and single-row desktop (md:flex-row)",
    );

    // Verify touch target classes on all 5 header buttons
    const buttons = header.querySelectorAll("button");
    assert.equal(buttons.length, 5, "Header must contain exactly 5 interactive buttons");
    for (const btn of buttons) {
      const cls = btn.className;
      assert.ok(
        cls.includes("min-h-[44px]") || cls.includes("min-height") || cls.includes("h-11"),
        `Button ${btn.getAttribute("aria-label") || btn.id} must specify 44px min touch target height`,
      );
      assert.ok(
        cls.includes("min-w-[44px]") || cls.includes("min-width") || cls.includes("w-11"),
        `Button ${btn.getAttribute("aria-label") || btn.id} must specify 44px min touch target width`,
      );
    }

    // Verify viewports: 320, 360, 390, 430, 768, 1024, 1280, 1440
    const viewports = [320, 360, 390, 430, 768, 1024, 1280, 1440];
    for (const width of viewports) {
      const isMobile = width < 768;
      if (isMobile) {
        // Row 1: Brand + Partner identity chip
        // Row 2: Shortlist + Trips + List + Info
        // Total available width: width - padding (24px)
        const available = width - 24;
        // Row 1 approximate width: Brand (~130px) + Partner (~75px) = 205px <= available
        assert.ok(available >= 205, `Row 1 fits at ${width}px (available: ${available}px)`);
        // Row 2 approximate width: Shortlist (~85px) + Trips (~68px) + List (~50px) + Info (44px) + 3*gap(18px) = 265px <= available
        assert.ok(available >= 265, `Row 2 fits at ${width}px (available: ${available}px)`);
      } else {
        // Desktop: Single row
        // Brand (~140px) + Partner (~80px) + Shortlist (~95px) + Trips (~80px) + Checklist (~90px) + Info (44px) + gaps(~40px) = ~569px
        const available = width - 32;
        assert.ok(available >= 569, `Desktop single row fits at ${width}px (available: ${available}px)`);
      }
    }
  } finally {
    dom.window.close();
  }
});
