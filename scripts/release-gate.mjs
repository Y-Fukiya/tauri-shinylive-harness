#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import { reportsRoot, rootDir, runCommand, toPosix, writeJson } from "./harness-core.mjs";

const steps = [
  { name: "doctor:tooling", command: "npm", args: ["run", "doctor:tooling"] },
  { name: "check", command: "npm", args: ["run", "check"] },
  { name: "test:unit", command: "npm", args: ["run", "test:unit"] },
  { name: "test:rust", command: "npm", args: ["run", "test:rust"] },
  { name: "validate:config:strict", command: "npm", args: ["run", "validate:config", "--", "--strict"] },
  { name: "validate:data:strict", command: "npm", args: ["run", "validate:data", "--", "--strict"] },
  { name: "guard:phi", command: "npm", args: ["run", "guard:phi"] },
  { name: "build:all", command: "npm", args: ["run", "build:all"], env: { HARNESS_RELEASE_MODE: "true" } },
  { name: "verify:static:strict", command: "npm", args: ["run", "verify:static", "--", "--strict"] },
  { name: "audit:tauri-security", command: "npm", args: ["run", "audit:tauri-security"] },
  { name: "audit:reproducibility:strict", command: "npm", args: ["run", "audit:reproducibility:strict"] },
  {
    name: "clinical:cdisc-preflight:demo",
    command: "npm",
    args: ["run", "clinical:cdisc-preflight", "--", "--mode", "demo"],
  },
  { name: "verify:offline", command: "npm", args: ["run", "verify:offline"] },
  { name: "verify:e2e", command: "npm", args: ["run", "verify:e2e"] },
  { name: "phase3:preflight:strict", command: "npm", args: ["run", "phase3:preflight:strict"] },
  { name: "phase3:package", command: "npm", args: ["run", "phase3:package"] },
  { name: "doctor:artifacts", command: "npm", args: ["run", "doctor:artifacts"] },
  { name: "verify:release", command: "npm", args: ["run", "verify:release"] },
];

const buildReport = ({ ok, status, startedAt, results }) => ({
  schemaVersion: 1,
  ok,
  status,
  startedAt,
  completedAt: new Date().toISOString(),
  project: "tauri-shinylive-harness",
  regulatedUse: false,
  submissionReady: false,
  results,
});

const runCli = async () => {
  const startedAt = new Date().toISOString();
  const results = [];
  const reportPath = path.join(reportsRoot, "release-gate.json");
  const writeGateReport = async (ok, status) => {
    await writeJson(reportPath, buildReport({ ok, status, startedAt, results }));
  };

  await writeGateReport(false, "running");

  for (const step of steps) {
    const stepStartedAt = new Date().toISOString();
    const result = {
      name: step.name,
      ok: null,
      status: "running",
      startedAt: stepStartedAt,
    };
    results.push(result);

    try {
      await runCommand(step.command, step.args, {
        env: {
          ...process.env,
          ...(step.env ?? {}),
        },
      });
      result.ok = true;
      result.status = "passed";
      result.completedAt = new Date().toISOString();
      await writeGateReport(false, "running");
    } catch (error) {
      result.ok = false;
      result.status = "failed";
      result.completedAt = new Date().toISOString();
      result.error = error instanceof Error ? error.message : String(error);
      await writeGateReport(false, "failed");
      console.error(`Release gate failed at ${step.name}. See ${toPosix(path.relative(rootDir, reportPath))}`);
      process.exit(1);
    }
  }

  await writeGateReport(true, "passed");
  console.log(JSON.stringify({
    ok: true,
    report: toPosix(path.relative(rootDir, reportPath)),
    steps: results.length,
  }, null, 2));
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
