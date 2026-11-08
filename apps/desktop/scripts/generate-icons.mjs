#!/usr/bin/env node
// Generate macOS .icns + favicon from the brand assets synced from the piwork
// web repo (src/brand/logo.svg + src/brand/icon.png). Runs sips/iconutil only,
// no extra dependencies. Rerun after `scripts/sync-from-web.mjs --apply` when
// the upstream logo changes.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const brandDir = join(appDir, "src", "brand");
const buildDir = join(appDir, "build");
const publicDir = join(appDir, "public");
const logoSvg = join(brandDir, "logo.svg");
const iconPng = join(brandDir, "icon.png");

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: ["ignore", "inherit", "inherit"] });
}

function pngSize(file) {
  const out = execFileSync("sips", ["-g", "pixelWidth", file], {
    encoding: "utf8",
  });
  return Number.parseInt(out.match(/pixelWidth: (\d+)/)[1], 10);
}

// Base image at 1024px: prefer rendering the vector source, fall back to the
// raster shipped upstream (upscaled).
let base1024;
const tmp = join(appDir, ".icon-tmp");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
try {
  run("qlmanage", ["-t", "-s", "1024", "-o", tmp, logoSvg]);
  const generated = join(tmp, "logo.svg.png");
  if (statSync(generated).size > 0 && pngSize(generated) >= 512) {
    base1024 = generated;
  }
} catch {
  // qlmanage unavailable or refused the svg; fall through to the raster path.
}
if (!base1024) {
  if (!statSync(iconPng).isFinite()) throw new Error("missing src/brand/icon.png");
  base1024 = join(tmp, "base-1024.png");
  cpSync(iconPng, base1024);
  run("sips", ["-z", "1024", "1024", "--resampleHeightWidth", "1024", "1024", base1024]);
}

// Assemble the iconset and convert to .icns.
const iconset = join(tmp, "icon.iconset");
mkdirSync(iconset, { recursive: true });
const sizes = [16, 32, 128, 256, 512];
for (const size of sizes) {
  run("sips", ["-z", String(size), String(size), base1024, "--out", join(iconset, `icon_${size}x${size}.png`)]);
  const double = size * 2;
  if (double <= 1024) {
    run("sips", ["-z", String(double), String(double), base1024, "--out", join(iconset, `icon_${size}x${size}@2x.png`)]);
  }
}
mkdirSync(buildDir, { recursive: true });
run("iconutil", ["-c", "icns", iconset, "-o", join(buildDir, "icon.icns")]);

// Favicon for index.html (dev window + packaged Chromium).
mkdirSync(publicDir, { recursive: true });
run("sips", ["-z", "128", "128", base1024, "--out", join(publicDir, "icon.png")]);

rmSync(tmp, { recursive: true, force: true });
console.log("brand icons generated: build/icon.icns, public/icon.png");
