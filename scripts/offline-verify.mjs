#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { distRoot, exists, reportsRoot, rootDir, toPosix, writeJson } from "./harness-core.mjs";

const inspectedExtensions = new Set([".html", ".js", ".css", ".json", ".mjs", ".cjs"]);
const externalUrlPattern = /\bhttps?:\/\/(?!(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$))[^\s"'<>\\)]+/gi;
const shouldInspect = (file) => {
  const normalized = toPosix(file);
  if (normalized.includes("/shinylive/") || normalized.includes("/webr/")) {
    return false;
  }
  if (normalized.endsWith(".map")) {
    return false;
  }
  return true;
};

const listInspectableFiles = async (basePath, relative = "") => {
  const current = path.join(basePath, relative);
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const nextRelative = path.join(relative, entry.name);
    const normalized = toPosix(nextRelative);
    if (entry.isDirectory()) {
      if (normalized.includes("/shinylive") || normalized.endsWith("shinylive") || normalized.includes("/webr") || normalized.endsWith("webr")) {
        continue;
      }
      files.push(...(await listInspectableFiles(basePath, nextRelative)));
      continue;
    }
    if (entry.isFile() && shouldInspect(nextRelative)) {
      files.push(nextRelative);
    }
  }
  return files;
};

const listShellFiles = async (basePath) => {
  const files = [];
  for (const file of ["manifest.json", "portal/index.html", "harness-bundle-manifest.json"]) {
    if (await exists(path.join(basePath, file))) {
      files.push(file);
    }
  }
  const appsRoot = path.join(basePath, "apps");
  if (await exists(appsRoot)) {
    for (const entry of await readdir(appsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      for (const file of ["index.html", "harness-boot.js", "app.json", "harness-app.json"]) {
        const relativePath = path.join("apps", entry.name, file);
        if (await exists(path.join(basePath, relativePath))) {
          files.push(relativePath);
        }
      }
    }
  }
  return files;
};

const parseOptions = (values) => {
  const options = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
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

export const verifyOfflineBundle = async ({
  targetRoot = distRoot,
  reportPath = path.join(reportsRoot, "offline-verification.json"),
  writeReport = true,
} = {}) => {
  const issues = [];
  const matches = [];
  if (!(await exists(targetRoot))) {
    throw new Error("dist/ is missing. Run npm run build:all before npm run verify:offline.");
  }

  for (const file of await listShellFiles(targetRoot)) {
    const extension = path.extname(file).toLowerCase();
    if (!inspectedExtensions.has(extension)) {
      continue;
    }
    const absolutePath = path.join(targetRoot, file);
    const metadata = await stat(absolutePath);
    if (metadata.size > 5_000_000) {
      continue;
    }
    const contents = await readFile(absolutePath, "utf8");
    const found = [...contents.matchAll(externalUrlPattern)].map((match) => match[0]);
    for (const url of found) {
      const item = {
        path: toPosix(path.relative(rootDir, absolutePath)),
        url,
      };
      matches.push(item);
      issues.push({
        severity: "error",
        code: "external-url-reference",
        message: "Bundled app content references an external HTTP(S) URL.",
        details: item,
      });
    }
  }

  const result = {
    schemaVersion: 1,
    ok: issues.length === 0,
    checkedAt: new Date().toISOString(),
    targetRoot: toPosix(path.relative(rootDir, targetRoot)),
    offlineClaim:
      "App content is bundled for offline use. Platform prerequisites such as Windows WebView2 may still be required depending on the target machine.",
    regulatedUse: false,
    submissionReady: false,
    matches,
    issues,
  };
  if (writeReport) {
    await writeJson(reportPath, result);
  }
  return result;
};

const runCli = async () => {
  const options = parseOptions(process.argv.slice(2));
  const result = await verifyOfflineBundle({
    targetRoot: options.root ? path.resolve(options.root) : distRoot,
    reportPath: options.report ? path.resolve(options.report) : path.join(reportsRoot, "offline-verification.json"),
  });
  console.log(JSON.stringify({
    ok: result.ok,
    report: toPosix(path.relative(rootDir, options.report ? path.resolve(options.report) : path.join(reportsRoot, "offline-verification.json"))),
    externalReferences: result.matches.length,
  }, null, 2));
  if (!result.ok) {
    throw new Error("Offline verification failed.");
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
