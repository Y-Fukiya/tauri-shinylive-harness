#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { exists, reportsRoot, rootDir, toPosix, writeJson } from "./harness-core.mjs";

const executableNames = (command) => {
  if (process.platform !== "win32") {
    return [command];
  }
  const extensions = (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean);
  return extensions.map((extension) => `${command}${extension.toLowerCase()}`);
};

const findExecutable = async (command) => {
  for (const directory of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    for (const name of executableNames(command)) {
      const candidate = path.join(directory, name);
      try {
        await access(candidate);
        return { ok: true, value: candidate };
      } catch {
        // Try next path.
      }
    }
  }
  return { ok: false, value: "not found on PATH" };
};

const readTrimmed = async (relativePath) => {
  const targetPath = path.join(rootDir, relativePath);
  return (await exists(targetPath)) ? (await readFile(targetPath, "utf8")).trim() : null;
};

const readPackageManager = async () => {
  const packageJsonText = await readTrimmed("package.json");
  if (!packageJsonText) {
    return null;
  }
  try {
    return JSON.parse(packageJsonText).packageManager ?? null;
  } catch {
    return null;
  }
};

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

const normalizeScope = (scope) => {
  if (["tooling", "artifacts", "all"].includes(scope)) {
    return scope;
  }
  return "all";
};

const addCheck = (checks, id, ok, message, details = {}) => {
  checks.push({ id, ok, severity: ok ? "ok" : "error", message, details });
};

export const runReleaseDoctor = async ({
  scope = "all",
  reportPath = path.join(reportsRoot, "release-doctor.json"),
  writeReport = true,
} = {}) => {
  const checks = [];
  const normalizedScope = normalizeScope(scope);
  const includeTooling = normalizedScope === "tooling" || normalizedScope === "all";
  const includeArtifacts = normalizedScope === "artifacts" || normalizedScope === "all";
  const pinnedNode = await readTrimmed(".nvmrc");
  const pinnedR = await readTrimmed(".R-version");
  const packageManager = await readPackageManager();
  const rustToolchain = await readTrimmed("rust-toolchain.toml");
  const rustChannel = rustToolchain?.match(/channel\s*=\s*"([^"]+)"/)?.[1] ?? null;

  if (includeTooling) {
    const node = await findExecutable("node");
    const npm = await findExecutable("npm");
    const rscript = await findExecutable("Rscript");
    const rustc = await findExecutable("rustc");
    const cargo = await findExecutable("cargo");
    const tauri = await findExecutable("tauri");

    addCheck(checks, "node-present", node.ok, "Node.js is available.", { observed: node.value });
    addCheck(checks, "npm-present", npm.ok, "npm is available.", { observed: npm.value });
    addCheck(checks, "rscript-present", rscript.ok, "Rscript is available.", { observed: rscript.value });
    addCheck(checks, "rustc-present", rustc.ok, "rustc is available.", { observed: rustc.value });
    addCheck(checks, "cargo-present", cargo.ok, "Cargo is available.", { observed: cargo.value });
    addCheck(checks, "tauri-cli-present", tauri.ok, "Tauri CLI is available.", { observed: tauri.value });

    addCheck(checks, "node-pin-present", Boolean(pinnedNode), ".nvmrc pins Node.js.", { pinned: pinnedNode });
    addCheck(checks, "r-pin-present", Boolean(pinnedR), ".R-version pins R.", { pinned: pinnedR });
    addCheck(checks, "rust-pin-present", Boolean(rustChannel), "rust-toolchain.toml pins Rust.", { pinned: rustChannel });
    addCheck(checks, "package-lock-present", await exists(path.join(rootDir, "package-lock.json")), "package-lock.json is present.");
    addCheck(checks, "package-manager-pin-present", /^npm@\d+\.\d+\.\d+$/.test(packageManager ?? ""), "package.json pins npm through packageManager.", {
      packageManager,
    });
  }

  if (includeArtifacts) {
    addCheck(checks, "dist-present", await exists(path.join(rootDir, "dist", "harness-bundle-manifest.json")), "dist bundle manifest is present.");
    addCheck(checks, "dist-checksums-present", await exists(path.join(rootDir, "dist", "checksums", "SHA256SUMS")), "dist checksums are present.");
    addCheck(checks, "apps-present", await exists(path.join(rootDir, "apps")), "exported apps directory is present.");
    addCheck(checks, "reports-present", await exists(path.join(rootDir, "reports", "evidence-index.html")), "reports evidence index is present.");
    addCheck(checks, "release-summary-present", await exists(path.join(rootDir, "release", "release-summary.json")), "release summary is present.");
    addCheck(checks, "validation-pack-present", await exists(path.join(rootDir, "release", "validation-pack", "evidence-index.json")), "validation pack evidence index is present.");
    addCheck(checks, "validation-pack-zip-present", await exists(path.join(rootDir, "release", "validation-pack.zip")), "validation pack zip is present.");
  }

  const errorCount = checks.filter((check) => !check.ok).length;
  const report = {
    schemaVersion: 1,
    ok: errorCount === 0,
    checkedAt: new Date().toISOString(),
    mode: "release-strict",
    scope: normalizedScope,
    summary: {
      checkCount: checks.length,
      errorCount,
    },
    checks,
  };

  if (writeReport) {
    await writeJson(reportPath, report);
  }

  return report;
};

const options = parseOptions(process.argv.slice(2));
const scope = normalizeScope(options.scope === true ? "all" : options.scope ?? "all");
const result = await runReleaseDoctor({ scope });
console.log(
  JSON.stringify(
    {
      ok: result.ok,
      report: toPosix(path.relative(rootDir, path.join(reportsRoot, "release-doctor.json"))),
      scope: result.scope,
      errors: result.summary.errorCount,
      checks: result.summary.checkCount,
    },
    null,
    2,
  ),
);

if (!result.ok) {
  throw new Error("Release doctor failed. See reports/release-doctor.json.");
}
