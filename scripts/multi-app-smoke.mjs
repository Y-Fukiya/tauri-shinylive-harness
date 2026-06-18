#!/usr/bin/env node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { exists, parseHarnessToml, runCommand } from "./harness-core.mjs";

const smokeRoot = await mkdtemp(path.join(os.tmpdir(), "tauri-shinylive-harness-smoke-"));
const target = path.join(smokeRoot, "generated-harness");

try {
  await runCommand("node", [
    "scripts/harness.mjs",
    "new",
    target,
    "--name",
    "generated-harness",
    "--portal-title",
    "Generated Harness Portal",
  ]);
  await runCommand("node", [
    "scripts/harness.mjs",
    "add-app",
    "lab-trends-mini",
    "--title",
    "Lab Trends Mini",
    "--description",
    "Second app used to verify multi-app harness scaffolding.",
  ], { cwd: target });

  const config = parseHarnessToml(await readFile(path.join(target, "harness.toml"), "utf8"));
  const expected = [
    "shinylive-src/subject-safety-mini/app.R",
    "shinylive-src/lab-trends-mini/app.R",
    "scripts/harness.mjs",
    "src/App.tsx",
    "src-tauri/tauri.conf.json",
  ];
  const missing = [];
  for (const relativePath of expected) {
    if (!(await exists(path.join(target, relativePath)))) {
      missing.push(relativePath);
    }
  }

  const ok = config.apps.length === 2 && missing.length === 0;
  const report = {
    ok,
    target,
    appIds: config.apps.map((app) => app.id),
    missing,
  };

  console.log(JSON.stringify(report, null, 2));
  if (!ok) {
    process.exit(1);
  }
} finally {
  if (!process.argv.includes("--keep")) {
    await rm(smokeRoot, { recursive: true, force: true });
  } else {
    console.error(`Kept smoke directory: ${smokeRoot}`);
  }
}
