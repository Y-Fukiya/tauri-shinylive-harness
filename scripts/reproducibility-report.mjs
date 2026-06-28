#!/usr/bin/env node
import { execFile } from "node:child_process";
import { access, readFile, stat as fsStat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { exists, listFiles, reportsRoot, rootDir, sha256File, toPosix, writeJson } from "./harness-core.mjs";

const execFileAsync = promisify(execFile);

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

const readTrimmed = async (relativePath) => {
  const targetPath = path.join(rootDir, relativePath);
  return (await exists(targetPath)) ? (await readFile(targetPath, "utf8")).trim() : null;
};

const executableNames = (command) => {
  if (process.platform !== "win32") {
    return [command];
  }
  const extensions = (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean);
  return extensions.flatMap((extension) => [extension.toLowerCase(), extension.toUpperCase()].map((next) => `${command}${next}`));
};

const commandVersion = async (command, args = ["--version"]) => {
  try {
    const result = await execFileAsync(command, args, {
      cwd: rootDir,
      timeout: 15000,
      windowsHide: true,
    });
    return {
      ok: true,
      command,
      raw: `${result.stdout}${result.stderr}`.trim(),
    };
  } catch (error) {
    return {
      ok: false,
      command,
      raw: error instanceof Error ? error.message : String(error),
    };
  }
};

const parseFirstSemver = (value) => value?.match(/v?(\d+\.\d+\.\d+)/)?.[1] ?? null;

const strictPinCheck = ({ name, pin, observed, exact = true }) => {
  const observedVersion = parseFirstSemver(observed.raw);
  const pinVersion = parseFirstSemver(pin);
  const ok = Boolean(observed.ok && pinVersion && observedVersion && (exact ? observedVersion === pinVersion : observedVersion.startsWith(pinVersion)));
  return {
    name,
    ok,
    pin,
    observed: observed.raw,
    observedVersion,
    requirement: exact ? "exact-semver-match" : "prefix-semver-match",
  };
};

const hashIfExists = async (relativePath) => {
  const targetPath = path.join(rootDir, relativePath);
  if (!(await exists(targetPath))) {
    return null;
  }
  return {
    path: relativePath,
    kind: "file-hash",
    sha256: await sha256File(targetPath),
  };
};

const directoryInventory = async (relativeDir) => {
  const directory = path.join(rootDir, relativeDir);
  if (!(await exists(directory))) {
    return null;
  }
  let totalSize = 0;
  let fileCount = 0;
  for (const file of (await listFiles(directory)).sort()) {
    const metadata = await fsStat(path.join(directory, file));
    fileCount += 1;
    totalSize += metadata.size;
  }
  return {
    path: relativeDir,
    kind: "directory-inventory",
    fileCount,
    totalSize,
  };
};

const hashMatchedAssets = async (relativeDir, suffixes) => {
  const directory = path.join(rootDir, relativeDir);
  if (!(await exists(directory))) {
    return [];
  }
  const files = (await listFiles(directory))
    .map(toPosix)
    .filter((file) => suffixes.some((suffix) => file.endsWith(suffix)))
    .sort();

  return Promise.all(
    files.map(async (file) => ({
      path: toPosix(path.join(relativeDir, file)),
      kind: "asset-anchor-hash",
      sha256: await sha256File(path.join(directory, file)),
    })),
  );
};

const readRenvPackages = async () => {
  const targetPath = path.join(rootDir, "renv.lock");
  if (!(await exists(targetPath))) {
    return {};
  }
  const lock = JSON.parse(await readFile(targetPath, "utf8"));
  return Object.fromEntries(
    Object.entries(lock.Packages ?? {}).map(([name, metadata]) => [
      name,
      {
        pinned: metadata.Version ?? null,
        source: metadata.Source ?? null,
        repository: metadata.Repository ?? null,
      },
    ]),
  );
};

const rPackageVersion = async (packageName) => {
  const result = await commandVersion("Rscript", ["-e", `cat(as.character(utils::packageVersion("${packageName}")))`]);
  return {
    ok: result.ok,
    package: packageName,
    observed: result.ok ? result.raw : null,
    error: result.ok ? null : result.raw,
  };
};

export const createReproducibilityReport = async ({
  reportPath = path.join(reportsRoot, "reproducibility.json"),
  writeReport = true,
  includeAssetHashes = true,
  strict = false,
  includeObservedVersions = true,
} = {}) => {
  const pinnedNode = await readTrimmed(".nvmrc");
  const pinnedR = await readTrimmed(".R-version");
  const rustToolchainText = await readTrimmed("rust-toolchain.toml");
  const rustChannel = rustToolchainText?.match(/channel\s*=\s*"([^"]+)"/)?.[1] ?? null;
  const sourceFiles = [
    ...(await Promise.all(
      [
        "package-lock.json",
        "package.json",
        "Cargo.lock",
        "crates/harness-server/Cargo.lock",
        "src-tauri/Cargo.lock",
        "harness.toml",
        ".nvmrc",
        ".R-version",
        "rust-toolchain.toml",
        "renv.lock",
      ].map(hashIfExists),
    )),
  ].filter(Boolean);
  const assetHashes = includeAssetHashes
    ? [
        await directoryInventory(".shinylive-cache"),
        ...(await hashMatchedAssets(".shinylive-cache", [
          "shinylive/shinylive.js",
          "shinylive/shinylive.css",
          "shinylive/webr/R.wasm",
          "shinylive/webr/library.data.gz",
        ])),
        await hashIfExists("dist/harness-bundle-manifest.json"),
        await hashIfExists("dist/checksums/SHA256SUMS"),
      ].filter(Boolean)
    : [];

  const observed = {
    node: includeObservedVersions ? await commandVersion("node") : { ok: true, raw: "skipped" },
    npm: includeObservedVersions ? await commandVersion("npm") : { ok: true, raw: "skipped" },
    rustc: includeObservedVersions ? await commandVersion("rustc") : { ok: true, raw: "skipped" },
    cargo: includeObservedVersions ? await commandVersion("cargo") : { ok: true, raw: "skipped" },
    rscript: includeObservedVersions ? await commandVersion("Rscript") : { ok: true, raw: "skipped" },
  };
  const renvPackages = await readRenvPackages();
  const rPackages = {
    shinylive: await rPackageVersion("shinylive"),
  };
  const strictVersionChecks = strict
    ? [
        strictPinCheck({ name: "node", pin: pinnedNode, observed: observed.node, exact: true }),
        strictPinCheck({ name: "r", pin: pinnedR, observed: observed.rscript, exact: true }),
        strictPinCheck({ name: "rustc", pin: rustChannel, observed: observed.rustc, exact: true }),
        {
          name: "r-package:shinylive",
          ok: Boolean(renvPackages.shinylive?.pinned && rPackages.shinylive.observed === renvPackages.shinylive.pinned),
          pin: renvPackages.shinylive?.pinned ?? null,
          observed: rPackages.shinylive.observed,
          requirement: "renv-lock-version-match",
        },
      ]
    : [];
  const strictChecks = strict
    ? await Promise.all(
        [
          "dist/harness-bundle-manifest.json",
          "dist/checksums/SHA256SUMS",
          "apps",
          "reports/evidence-index.html",
          "release/validation-pack/evidence-index.json",
          "release/validation-pack.zip",
        ].map(async (relativePath) => ({
          path: relativePath,
          ok: await exists(path.join(rootDir, relativePath)),
        })),
      )
    : [];
  const missingStrict = strictChecks.filter((check) => !check.ok);
  const failingStrictVersionChecks = strictVersionChecks.filter((check) => !check.ok);

  const result = {
    schemaVersion: 1,
    ok: Boolean(pinnedNode && pinnedR && rustChannel && sourceFiles.some((file) => file.path === "package-lock.json")) &&
      (!strict || (missingStrict.length === 0 && failingStrictVersionChecks.length === 0)),
    checkedAt: new Date().toISOString(),
    mode: strict ? "release-strict" : "standard",
    pins: {
      node: pinnedNode,
      r: pinnedR,
      rustToolchain: {
        channel: rustChannel,
      },
    },
    observed,
    rPackages,
    renvPackages,
    files: sourceFiles,
    assets: assetHashes,
    strictChecks,
    strictVersionChecks,
    missingStrict,
    failingStrictVersionChecks,
  };

  if (writeReport) {
    await writeJson(reportPath, result);
  }

  return result;
};

const runCli = async () => {
  const options = parseOptions(process.argv.slice(2));
  const reportPath = options.report ? path.resolve(options.report) : path.join(reportsRoot, "reproducibility.json");
  const strict = Boolean(options.strict);
  const result = await createReproducibilityReport({
    reportPath,
    strict,
    includeAssetHashes: !strict,
    includeObservedVersions: true,
  });
  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        report: toPosix(path.relative(rootDir, reportPath)),
        node: result.pins.node,
        rust: result.pins.rustToolchain.channel,
        r: result.pins.r,
        mode: result.mode,
        missingStrict: result.missingStrict.length,
        failingStrictVersionChecks: result.failingStrictVersionChecks.length,
      },
      null,
      2,
    ),
  );
  if (!result.ok) {
    throw new Error(`Reproducibility report failed. See ${toPosix(path.relative(rootDir, reportPath))}`);
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
