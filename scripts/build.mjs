import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import sharp from "sharp";
const require = createRequire(import.meta.url);
const apiBase = (process.env.SAANTAYO_API_BASE || "").replace(/\/$/, "");
if (apiBase) {
  const url = new URL(apiBase);
  if (
    url.protocol !== "https:" ||
    url.origin !== apiBase ||
    url.username ||
    url.password
  )
    throw new Error("SAANTAYO_API_BASE must be a plain HTTPS origin.");
}
await mkdir("dist/assets", { recursive: true });
await build({
  entryPoints: ["src/app.js"],
  bundle: true,
  format: "esm",
  minify: true,
  target: ["es2022"],
  outfile: "dist/assets/app.js",
  define: { __API_BASE__: JSON.stringify(apiBase) },
  legalComments: "linked",
});
execFileSync(
  process.execPath,
  [
    require.resolve("tailwindcss/lib/cli.js"),
    "-i",
    "src/styles.css",
    "-o",
    "dist/assets/app.css",
    "--minify",
  ],
  { stdio: "inherit" },
);
const csp = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://script.google.com https://script.googleusercontent.com${apiBase ? " " + apiBase : ""}; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; worker-src 'self'`;
const html = (await readFile("index.html", "utf8")).replace("__CSP__", csp);
await writeFile("dist/index.html", html);
await copyFile("manifest.json", "dist/manifest.json");
await sharp("SaayTayo-Logo.jpeg")
  .resize(80, 80, { fit: "contain", background: "#fff1d6" })
  .webp({ quality: 80 })
  .toFile("dist/assets/logo.webp");
for (const size of [192, 512])
  await sharp("SaayTayo-Logo.jpeg")
    .resize(size, size, { fit: "contain", background: "#fff1d6" })
    .png()
    .toFile(`dist/assets/icon-${size}.png`);
await writeFile("dist/.nojekyll", "");
const files = [
  "./",
  "./index.html",
  "./manifest.json",
  "./assets/app.js",
  "./assets/app.css",
  "./assets/logo.webp",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
];
const hash = createHash("sha256");
for (const file of files.slice(1))
  hash.update(await readFile("dist/" + file.slice(2)));
const sw = (await readFile("src/sw.js", "utf8"))
  .replace("__VERSION__", hash.digest("hex").slice(0, 16))
  .replace("__FILES__", JSON.stringify(files));
await writeFile("dist/sw.js", sw);
console.log("Static build complete. Gemini secrets are not read by the build.");
