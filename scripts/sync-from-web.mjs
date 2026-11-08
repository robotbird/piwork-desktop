#!/usr/bin/env node
// Sync copied frontend code/assets from the piwork web repo (the single source
// of truth) into this desktop repo. The piwork repo is never modified.
//
// Usage:
//   node scripts/sync-from-web.mjs                 # status: report drift + upstream commits
//   node scripts/sync-from-web.mjs --apply          # copy all verbatim entries, bump baseline
//   node scripts/sync-from-web.mjs --apply <dest>   # apply a single manifest entry (by dest)
//
// Manifest (sync-manifest.json) entry fields:
//   source   path inside the piwork repo
//   dest     path inside this repo
//   mode     "verbatim"  byte-identical copy, safe to auto-apply
//            "adapted"   copy + mechanical rewrites; review DESKTOP-ADAPTED blocks after apply
//   dir      true to sync every file under the directory (verbatim only)
//   rewrites optional [{ from, to }] literal replacements applied on copy (adapted mode)
//   baseline (adapted) piwork commit this copy was last reconciled against
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(root, "sync-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const srcRepo = resolve(root, manifest.sourceRepo);

function git(args) {
  try {
    return execFileSync("git", args, { cwd: srcRepo, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function head() {
  return git(["rev-parse", "HEAD"]);
}

function listFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

function entryFiles(entry) {
  const src = join(srcRepo, entry.source);
  if (entry.dir) return listFiles(src).map((f) => ({ source: f, dest: join(root, entry.dest, relative(src, f)) }));
  return [{ source: src, dest: join(root, entry.dest) }];
}

function sameBytes(a, b) {
  if (!existsSync(a) || !existsSync(b)) return false;
  const sa = statSync(a);
  const sb = statSync(b);
  if (sa.size !== sb.size) return false;
  return readFileSync(a).equals(readFileSync(b));
}

function applyRewrites(text, rewrites) {
  for (const { from, to } of rewrites ?? []) text = text.split(from).join(to);
  return text;
}

const applyIndex = process.argv.indexOf("--apply");
const singleDest = applyIndex !== -1 ? process.argv[applyIndex + 1] : undefined;
const applying = applyIndex !== -1;

let drift = 0;
const notes = [];
const selected = manifest.entries.filter((e) => !singleDest || e.dest === singleDest || e.dest.startsWith(`${singleDest}/`));
if (singleDest && selected.length === 0) {
  console.error(`no manifest entry matches ${singleDest}`);
  process.exit(1);
}

for (const entry of selected) {
  if (entry.mode === "verbatim") {
    for (const { source, dest } of entryFiles(entry)) {
      const rel = relative(root, dest);
      if (applying) {
        cpSync(source, dest);
        console.log(`applied  ${rel}`);
        if (/brand\/(logo\.svg|icon\.png)$/.test(rel)) notes.push(entry.postSyncNote);
      } else if (!sameBytes(source, dest)) {
        console.log(`DIFFERS  ${rel}  <- ${entry.source}`);
        drift++;
      }
    }
  } else if (entry.mode === "adapted") {
    if (applying) {
      for (const { source, dest } of entryFiles(entry)) {
        cpSync(source, dest);
        writeFileSync(dest, applyRewrites(readFileSync(dest, "utf8"), entry.rewrites));
        console.log(`applied* ${relative(root, dest)} (rewrites applied; review DESKTOP-ADAPTED blocks)`);
      }
      entry.baseline = head();
    } else if (entry.baseline) {
      const log = git(["log", "--oneline", `${entry.baseline}..HEAD`, "--", entry.source]);
      if (log) {
        const count = log.split("\n").filter(Boolean).length;
        if (count > 0) {
          console.log(`UPSTREAM ${entry.dest} <- ${count} commit(s) since baseline ${entry.baseline.slice(0, 8)}:`);
          for (const line of log.split("\n")) console.log(`         ${line}`);
          drift++;
        }
      }
    } else {
      console.log(`NOBASE   ${entry.dest} (adapted entry missing baseline; set it after first reconciliation)`);
    }
  }
}

if (applying) {
  manifest.lastSyncCommit = head();
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\nbaseline updated to ${manifest.lastSyncCommit.slice(0, 8)}`);
  for (const note of [...new Set(notes)]) if (note) console.log(`note: ${note}`);
  console.log("next: pnpm --dir apps/desktop build && pnpm test");
} else {
  const since = manifest.lastSyncCommit ? git(["log", "--oneline", `${manifest.lastSyncCommit}..HEAD`]) : null;
  if (since) {
    const commits = since.split("\n").filter(Boolean);
    if (commits.length > 0) {
      console.log(`\npiwork has ${commits.length} new commit(s) since lastSyncCommit ${manifest.lastSyncCommit.slice(0, 8)}:`);
      for (const line of commits) console.log(`  ${line}`);
    }
  } else if (!git(["rev-parse", "HEAD"])) {
    console.log("\nwarning: piwork repo has no git history; commit-level reports unavailable");
  }
  if (drift === 0) console.log("\nall manifest entries in sync");
  else {
    console.log(`\n${drift} entr${drift === 1 ? "y" : "ies"} out of sync — run with --apply to update`);
    process.exitCode = 1;
  }
}
