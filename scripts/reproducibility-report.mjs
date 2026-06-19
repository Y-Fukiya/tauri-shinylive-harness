#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFile, stat as fsStat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

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

const commandVersion = async (command, args = ["--version"]) => {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { cwd: rootDir, timeout: 10000 });
    return `${stdout}${stderr}`.trim();
  } catch (error) {
    return error instanceof Error ? `unavailable: ${error.message}` : "unavailable";
  }
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

export const createReproducibilityReport = async ({
  reportPath = path.join(reportsRoot, "reproducibility.json"),
  writeReport = true,
  includeAssetHashes = true,
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

  const result = {
    schemaVersion: 1,
    ok: Boolean(pinnedNode && pinnedR && rustChannel && sourceFiles.some((file) => file.path === "package-lock.json")),
    checkedAt: new Date().toISOString(),
    pins: {
      node: pinnedNode,
      r: pinnedR,
      rustToolchain: {
        channel: rustChannel,
      },
    },
    observed: {
      node: await commandVersion("node"),
      npm: await commandVersion("npm"),
      rustc: await commandVersion("rustc"),
      cargo: await commandVersion("cargo"),
      rscript: await commandVersion("Rscript"),
    },
    files: sourceFiles,
    assets: assetHashes,
  };

  if (writeReport) {
    await writeJson(reportPath, result);
  }

  return result;
};

const runCli = async () => {
  const options = parseOptions(process.argv.slice(2));
  const reportPath = options.report ? path.resolve(options.report) : path.join(reportsRoot, "reproducibility.json");
  const result = await createReproducibilityReport({ reportPath });
  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        report: toPosix(path.relative(rootDir, reportPath)),
        node: result.pins.node,
        rust: result.pins.rustToolchain.channel,
        r: result.pins.r,
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
