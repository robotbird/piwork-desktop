// Guard: dependencies shared with the piwork web repo must stay on the same
// version so copied components behave identically on both sides. Fails with a
// table when a shared dep drifts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), "..", "apps", "desktop");
const webDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "piwork");

const read = (dir) => JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
const desktopPkg = read(desktopDir);
const webPkg = read(webDir);

const depsOf = (pkg) => ({ ...pkg.dependencies, ...pkg.devDependencies });
const desktopDeps = depsOf(desktopPkg);
const webDeps = depsOf(webPkg);

const base = (range) => range.replace(/^[~^]/, "");
const pinned = [
  "react",
  "react-dom",
  "lucide-react",
  "next-intl",
  "next-themes",
  "swr",
  "ai",
  "@ai-sdk/react",
  "clsx",
  "tailwind-merge",
  "class-variance-authority",
  "radix-ui",
  "tailwindcss",
  "tailwindcss-animate",
  "@tailwindcss/typography",
  "streamdown",
  "@streamdown/cjk",
  "@streamdown/code",
  "@streamdown/math",
  "@streamdown/mermaid",
  "framer-motion",
  "motion",
  "shiki",
  "classnames",
  "date-fns",
  "fast-deep-equal",
  "sonner",
  "use-intl",
  "zod",
  "use-stick-to-bottom",
  "@radix-ui/react-use-controllable-state",
];
const shared = [
  ...pinned,
  ...Object.keys(desktopDeps).filter((name) => name.startsWith("@earendil-works/")),
];

test("shared dependencies stay version-locked with the piwork web repo", () => {
  const drift = [];
  for (const name of shared) {
    const d = desktopDeps[name];
    const w = webDeps[name];
    if (!w) continue; // desktop-only pi package; nothing to lock against yet
    if (base(d) !== base(w)) drift.push(`${name}: desktop ${d} vs web ${w}`);
  }
  assert.deepEqual(drift, [], `version drift detected (align both repos):\n  ${drift.join("\n  ")}`);
});

test("piwork web repo dependency versions are readable", () => {
  assert.equal(base(webDeps.react), "19.2.7");
  assert.ok(Object.keys(webDeps).some((name) => name.startsWith("@earendil-works/")));
});
