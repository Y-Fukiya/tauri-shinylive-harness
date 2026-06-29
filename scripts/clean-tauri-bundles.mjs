#!/usr/bin/env node
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { rootDir, toPosix } from "./harness-core.mjs";

export const tauriBundleTargets = [
  "src-tauri/target/release/bundle/macos",
  "src-tauri/target/release/bundle/dmg",
  "src-tauri/target/release/bundle/nsis",
  "src-tauri/target/release/bundle/msi",
];

export const cleanTauriBundles = async ({ baseRoot = rootDir, targets = tauriBundleTargets } = {}) => {
  await Promise.all(
    targets.map((target) => rm(path.join(baseRoot, target), { recursive: true, force: true })),
  );
  return {
    ok: true,
    removed: targets.map(toPosix),
  };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await cleanTauriBundles();
  console.log(JSON.stringify(result, null, 2));
}
