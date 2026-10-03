import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

// Static checks that keep the installed app working offline.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sw = read("public/sw.js");
const html = read("public/index.html");
const app = read("public/app.js");
const manifest = JSON.parse(read("public/manifest.webmanifest"));
const pkg = JSON.parse(read("package.json"));

const shell = JSON.parse(
  sw.match(/const SHELL = (\[[\s\S]*?\]);/)[1].replace(/,\s*\]/, "]"), // trailing comma
);
const libFiles = readdirSync(new URL("../public/lib", import.meta.url)).map((f) => `/lib/${f}`);
const appImports = [...app.matchAll(/^import .* from "\.(\/lib\/[\w-]+\.js)";$/gm)].map((m) => m[1]);

describe("offline app shell", () => {
  it("app.js imports every module in public/lib", () => {
    expect(appImports.sort()).toEqual(libFiles.sort());
  });

  it("the service worker saves every module app.js imports", () => {
    for (const file of appImports) expect(shell).toContain(file);
  });

  it("the service worker saves the files index.html loads", () => {
    for (const [, path] of html.matchAll(/(?:href|src)="(\/[^"]+)"/g)) {
      if (path.startsWith("/icons/icon-512") || path === "/privacy" || path === "/terms") continue;
      expect(shell, path).toContain(path);
    }
  });

  it("index.html preloads every module so they download in parallel", () => {
    for (const file of appImports) expect(html).toContain(`<link rel="modulepreload" href="${file}" />`);
  });
});

describe("web app manifest", () => {
  it("has what browsers need to install the app", () => {
    expect(manifest).toMatchObject({ id: "/", start_url: "/", scope: "/", display: "standalone" });
    expect(manifest.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(manifest.icons.some((i) => i.purpose === "maskable")).toBe(true);
  });
});

describe("release version", () => {
  it("the service worker cache name matches package.json, so each release updates phones", () => {
    expect(sw).toContain(`const VERSION = "studyslot-${pkg.version}";`);
  });

  it("the app reports the same version in feedback emails", () => {
    expect(app).toContain(`const APP_VERSION = "${pkg.version}";`);
  });
});
