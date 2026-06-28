#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import { reportsRoot, rootDir, runCommand, toPosix, writeJson } from "./harness-core.mjs";

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

const normalizePlatform = (value) => {
  const platform = value || process.env.HARNESS_TARGET_PLATFORM || (process.platform === "win32" ? "windows" : "macos");
  if (!["macos", "windows"].includes(platform)) {
    throw new Error(`Unsupported release gate platform: ${platform}`);
  }
  return platform;
};

const buildSteps = ({ platform, internal }) => {
  const preflightStep = internal
    ? {
        name: `phase3:preflight:${platform}:internal`,
        command: "node",
        args: ["scripts/phase3-preflight.mjs", "--platform", platform, "--allow-missing-credentials"],
      }
    : {
        name: `phase3:preflight:${platform}:strict`,
        command: "node",
        args: ["scripts/phase3-preflight.mjs", "--platform", platform],
      };
  const tauriBuildStep = platform === "windows"
    ? {
        name: internal ? "tauri:build:windows:no-sign" : "tauri:build:windows",
        command: "npm",
        args: ["run", internal ? "tauri:build:windows:no-sign" : "tauri:build:windows"],
      }
    : {
        name: internal ? "tauri:build:app:no-sign" : "tauri:build:app",
        command: "npm",
        args: ["run", internal ? "tauri:build:app:no-sign" : "tauri:build:app"],
      };
  const packageStep = platform === "windows"
    ? { name: "phase3:package:windows", command: "npm", args: ["run", "phase3:package:windows"] }
    : { name: "phase3:package:macos", command: "npm", args: ["run", "phase3:package:macos"] };

  return [
  { name: "doctor:tooling", command: "npm", args: ["run", "doctor:tooling"] },
  { name: "check", command: "npm", args: ["run", "check"] },
  { name: "test:unit", command: "npm", args: ["run", "test:unit"] },
  { name: "test:rust", command: "npm", args: ["run", "test:rust"] },
  { name: "validate:config:strict", command: "npm", args: ["run", "validate:config", "--", "--strict"] },
  { name: "validate:data:strict", command: "npm", args: ["run", "validate:data", "--", "--strict"] },
  { name: "guard:phi", command: "npm", args: ["run", "guard:phi"] },
  { name: "export", command: "npm", args: ["run", "export"], env: { HARNESS_RELEASE_MODE: "true" } },
  { name: "build:all", command: "npm", args: ["run", "build:all"], env: { HARNESS_RELEASE_MODE: "true" } },
  { name: "verify:static:strict", command: "npm", args: ["run", "verify:static", "--", "--strict"] },
  { name: "audit:tauri-security", command: "npm", args: ["run", "audit:tauri-security"] },
  { name: "audit:reproducibility:strict", command: "npm", args: ["run", "audit:reproducibility:strict"] },
  {
    name: "clinical:cdisc-preflight:demo",
    command: "npm",
    args: ["run", "clinical:cdisc-preflight", "--", "--mode", "demo"],
  },
  { name: "export:reports", command: "npm", args: ["run", "export:reports"] },
  { name: "export:report-pdfs", command: "npm", args: ["run", "export:report-pdfs"] },
  { name: "verify:offline", command: "npm", args: ["run", "verify:offline"] },
  { name: "verify:e2e", command: "npm", args: ["run", "verify:e2e"] },
  {
    name: "review:signoff:pending-review",
    command: "npm",
    args: ["run", "review:signoff", "--", "--status", "pending-review", "--decision", "not-reviewed"],
  },
  { name: "evidence:index", command: "npm", args: ["run", "evidence:index"] },
  preflightStep,
  tauriBuildStep,
  packageStep,
  { name: "doctor:artifacts", command: "npm", args: ["run", "doctor:artifacts"] },
  { name: "verify:release", command: "npm", args: ["run", "verify:release"] },
  ];
};

const buildReport = ({ ok, status, startedAt, results, platform, internal }) => ({
  schemaVersion: 1,
  ok,
  status,
  startedAt,
  completedAt: new Date().toISOString(),
  project: "tauri-shinylive-harness",
  platform,
  releaseType: internal ? "unsigned-internal-candidate" : "signed-release-candidate",
  regulatedUse: false,
  submissionReady: false,
  results,
});

const runCli = async () => {
  const options = parseOptions(process.argv.slice(2));
  const platform = normalizePlatform(options.platform === true ? undefined : options.platform);
  const internal = options.internal === true;
  const steps = buildSteps({ platform, internal });
  const startedAt = new Date().toISOString();
  const results = [];
  const reportPath = path.join(reportsRoot, "release-gate.json");
  const writeGateReport = async (ok, status) => {
    await writeJson(reportPath, buildReport({ ok, status, startedAt, results, platform, internal }));
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
    platform,
    releaseType: internal ? "unsigned-internal-candidate" : "signed-release-candidate",
    steps: results.length,
  }, null, 2));
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
