#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { listFiles, reportsRoot, rootDir, runCommand, sha256File, toPosix, writeJson } from "./harness-core.mjs";

const execFileAsync = promisify(execFile);
const outputRoot = path.join(rootDir, "dist", "source-template");
const manifestPath = path.join(reportsRoot, "source-template-manifest.json");
const zipPath = path.join(outputRoot, "source-template.zip");

const parseOptions = (values) => {
  const options = { _: [] };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
      options._.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
    } else {
      options[key] = next;
      index += 1;
    }
  }
  return options;
};

const includePrefixes = [
  ".nvmrc",
  ".R-version",
  "AGENTS.md",
  "LICENSE",
  "README.md",
  "README.ja.md",
  "THIRD_PARTY_NOTICES.md",
  "crates/",
  "data-packs/",
  "docs/",
  "harness.toml",
  "index.html",
  "mappings/",
  "package-lock.json",
  "package.json",
  "rust-toolchain.toml",
  "schemas/",
  "scripts/",
  "shinylive-src/",
  "src-tauri/",
  "src/",
  "templates/",
  "tsconfig.json",
  "vite.config.ts",
];

const excludedPrefixes = [
  "apps/",
  "dist/",
  "reports/",
  "release/",
  "node_modules/",
  ".r-lib/",
  ".shinylive-cache/",
];

const included = (file) =>
  includePrefixes.some((prefix) => file === prefix || file.startsWith(prefix)) &&
  !excludedPrefixes.some((prefix) => file.startsWith(prefix));

const options = parseOptions(process.argv.slice(2));
let files = [];
let fileSource = "git-ls-files";
try {
  const { stdout } = await execFileAsync("git", ["ls-files"], { cwd: rootDir, timeout: 15000 });
  files = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(included)
    .sort();
} catch {
  fileSource = "filesystem-fallback";
  files = (await listFiles(rootDir))
    .map(toPosix)
    .filter(included)
    .sort();
}

await mkdir(outputRoot, { recursive: true });

let zip = null;
if (options.zip) {
  if (fileSource !== "git-ls-files") {
    throw new Error("Creating source-template.zip requires a git repository. Run without --zip in filesystem fallback mode.");
  }
  await runCommand("git", ["archive", "--format=zip", "-o", zipPath, "HEAD", ...files]);
  const metadata = await stat(zipPath);
  zip = {
    path: toPosix(path.relative(rootDir, zipPath)),
    size: metadata.size,
    sha256: await sha256File(zipPath),
  };
}

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  ok: true,
  mode: options.zip ? "manifest-and-zip" : "manifest-only",
  fileSource,
  outputRoot: toPosix(path.relative(rootDir, outputRoot)),
  zip,
  includedFileCount: files.length,
  includedPrefixes: includePrefixes,
  excludedPrefixes,
  files,
};

await writeJson(manifestPath, manifest);
console.log(
  JSON.stringify(
    {
      ok: true,
      report: toPosix(path.relative(rootDir, manifestPath)),
      files: files.length,
      zip: zip?.path ?? null,
    },
    null,
    2,
  ),
);
