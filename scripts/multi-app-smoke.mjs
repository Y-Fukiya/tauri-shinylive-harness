#!/usr/bin/env node
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { exists, parseHarnessToml, removeTree, runCommand } from "./harness-core.mjs";

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
  await runCommand("node", [
    "scripts/harness.mjs",
    "add-app",
    "subject-profile-clone",
    "--title",
    "Subject Profile Clone",
    "--template",
    "subject-profile",
  ], { cwd: target });
  await runCommand("node", [
    "scripts/harness.mjs",
    "validate-data",
    "subject-profile-clone",
  ], { cwd: target });

  const config = parseHarnessToml(await readFile(path.join(target, "harness.toml"), "utf8"));
  const expected = [
    "shinylive-src/subject-safety-mini/app.R",
    "shinylive-src/lab-trends-mini/app.R",
    "shinylive-src/subject-profile-clone/app.R",
    "data-packs/subject-profile-clone-clinical-demo-data-v1/clinical-demo-data-pack.json",
    "AGENTS.md",
    "schemas/harness.schema.json",
    "schemas/clinical-data-pack.schema.json",
    "templates/apps/subject-profile-reference/app.R",
    "docs/generated/clinical-data-dictionary.md",
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

  const ok = config.apps.length === 3 && missing.length === 0;
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
    await removeTree(smokeRoot);
  } else {
    console.error(`Kept smoke directory: ${smokeRoot}`);
  }
}
