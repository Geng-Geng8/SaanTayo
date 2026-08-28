import DOMPurify from "dompurify";
import { marked } from "marked";
import { safeUrl } from "../shared/travel.js";

marked.use({ breaks: true, gfm: true });
export function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}
export function link(title, url) {
  const a = el("a", title);
  const safe = safeUrl(url);
  if (safe) {
    a.href = safe;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  }
  return a;
}
export function markdown(text) {
  const node = el("div", null, "prose");
  node.innerHTML = DOMPurify.sanitize(marked.parse(text), {
    ALLOWED_TAGS: [
      "p",
      "br",
      "h1",
      "h2",
      "h3",
      "h4",
      "strong",
      "em",
      "ul",
      "ol",
      "li",
      "blockquote",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "a",
      "code",
      "pre",
      "hr",
      "del",
    ],
    ALLOWED_ATTR: ["href", "title"],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
  for (const a of node.querySelectorAll("a")) {
    const safe = safeUrl(a.getAttribute("href"));
    if (!safe) a.removeAttribute("href");
    else {
      a.href = safe;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
  }
  for (const table of node.querySelectorAll("table")) {
    const wrap = el("div", null, "table-scroll");
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", "Scrollable comparison table");
    table.replaceWith(wrap);
    wrap.append(table);
  }
  return node;
}
function searchSuggestions(html) {
  const host = el("div", null, "search-suggestions");
  host.setAttribute("aria-label", "Google Search suggestions");
  const root = host.attachShadow({ mode: "open" });
  // Isolate provider CSS from the app. No scripts, event handlers, frames or remote images.
  const clean = DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ["style"],
    FORBID_TAGS: ["script", "iframe", "object", "form", "input", "img"],
    FORBID_ATTR: ["id", "name"],
    ALLOW_DATA_ATTR: false,
  });
  const parsed = new DOMParser().parseFromString(clean, "text/html");
  for (const style of parsed.querySelectorAll("style")) {
    style.textContent = style.textContent
      .replace(/@import[^;]*;?/gi, "")
      .replace(/url\([^)]*\)/gi, "none");
  }
  for (const a of parsed.querySelectorAll("a")) {
    const safe = safeUrl(a.getAttribute("href"));
    if (safe) {
      a.href = safe;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    } else a.removeAttribute("href");
  }
  root.append(...parsed.head.childNodes, ...parsed.body.childNodes);
  return host;
}
export function renderAnswer(result, legacyContent = "") {
  const container = el("div");
  if (!result) {
    container.append(
      markdown(
        legacyContent ||
          "This answer is no longer stored. Your notes are still available.",
      ),
    );
    return container;
  }
  for (const part of result.parts || []) container.append(markdown(part.text));
  // Keep the original grounded text intact. Attribution sits directly after it, before any app calculation.
  if (result.sources?.length) {
    const sources = el("section", null, "sources");
    sources.append(el("h3", "Sources"));
    result.sources.forEach((source, index) => {
      const row = el("div", null, "source-row");
      if (source.type === "place_citation") {
        const credit = el("span", "Google Maps", "maps-credit");
        credit.translate = false;
        row.append(credit, document.createTextNode(" · "));
      }
      row.append(link(source.title, source.url));
      const excerpts = [
        ...new Set(
          (result.parts || []).flatMap((p) =>
            (p.annotations || [])
              .filter((a) => a.source === index && a.excerpt)
              .map((a) => a.excerpt),
          ),
        ),
      ];
      if (excerpts.length) {
        const detail = el("details");
        detail.append(el("summary", "Claims supported"));
        for (const excerpt of excerpts)
          detail.append(el("p", excerpt, "source-excerpt"));
        row.append(detail);
      }
      for (const review of source.reviews || [])
        row.append(link(`Review · ${review.title}`, review.url));
      sources.append(row);
    });
    container.append(sources);
  }
  for (const html of result.suggestions || [])
    container.append(searchSuggestions(html));
  for (const warning of result.warnings || [])
    container.append(el("p", warning, "notice warning"));
  return container;
}
