#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { appendAudit, exists, readConfig, reportsRoot, rootDir } from "./harness-core.mjs";

const runCapture = (command, args, options = {}) =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      ...options,
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({ ok: false, command, args, stdout, stderr: error.message, code: null });
    });
    child.on("exit", (code) => {
      resolve({ ok: code === 0, command, args, stdout, stderr, code });
    });
  });

const present = (name) => Boolean(process.env[name]);

const redactOutput = (value) =>
  value
    .replace(/(Token:\s*)\S+/gi, "$1<redacted>")
    .replace(/\bgh[opsu]_[A-Za-z0-9_]+\b/g, "<redacted>")
    .replace(/\bgithub_pat_[A-Za-z0-9_]+\b/g, "<redacted>");

const summarizeCommand = (result) => ({
  ok: result.ok,
  command: [result.command, ...result.args].join(" "),
  code: result.code,
  stdout: redactOutput(result.stdout).slice(0, 4000),
  stderr: redactOutput(result.stderr).slice(0, 4000),
});

const extractIdentities = (securityOutput) =>
  securityOutput
    .split(/\r?\n/)
    .map((line) => line.match(/\)\s+[A-F0-9]{40}\s+"([^"]+)"/)?.[1])
    .filter(Boolean);

const config = await readConfig();
const apiKeyPathExists = present("APPLE_API_KEY_PATH")
  ? await exists(process.env.APPLE_API_KEY_PATH)
  : false;
const apple = {
  localSigningIdentity: present("APPLE_SIGNING_IDENTITY"),
  certificateP12: present("APPLE_CERTIFICATE"),
  certificatePassword: present("APPLE_CERTIFICATE_PASSWORD"),
  keychainPassword: present("KEYCHAIN_PASSWORD"),
  apiKeyPathExists,
  appStoreConnectApi: present("APPLE_API_ISSUER") && present("APPLE_API_KEY") && apiKeyPathExists,
  appleIdNotary:
    present("APPLE_ID") && present("APPLE_PASSWORD") && present("APPLE_TEAM_ID"),
};

const commands = {
  codesign: summarizeCommand(await runCapture("xcrun", ["-f", "codesign"])),
  securityIdentities: summarizeCommand(await runCapture("security", ["find-identity", "-v", "-p", "codesigning"])),
  notarytool: summarizeCommand(await runCapture("xcrun", ["-f", "notarytool"])),
  stapler: summarizeCommand(await runCapture("xcrun", ["-f", "stapler"])),
  ghAuth: summarizeCommand(await runCapture("gh", ["auth", "status"])),
};

const identities = extractIdentities(commands.securityIdentities.stdout);
const localIdentityInstalled =
  !apple.localSigningIdentity ||
  identities.some(
    (identity) =>
      identity === process.env.APPLE_SIGNING_IDENTITY ||
      identity.includes(process.env.APPLE_SIGNING_IDENTITY) ||
      process.env.APPLE_SIGNING_IDENTITY.includes(identity),
  );
const signingReady =
  (apple.localSigningIdentity && localIdentityInstalled) ||
  (apple.certificateP12 && apple.certificatePassword && apple.keychainPassword);
const notarizationReady = apple.appStoreConnectApi || apple.appleIdNotary;
const githubReady = commands.ghAuth.ok || present("GITHUB_TOKEN");
const toolingReady = commands.codesign.ok && commands.notarytool.ok && commands.stapler.ok;

const issues = [];
if (config.phase3.signingRequired && !signingReady) {
  issues.push("Missing signing input: set APPLE_SIGNING_IDENTITY locally or APPLE_CERTIFICATE + APPLE_CERTIFICATE_PASSWORD + KEYCHAIN_PASSWORD in CI.");
}
if (apple.localSigningIdentity && !localIdentityInstalled) {
  issues.push("APPLE_SIGNING_IDENTITY is set but was not found in `security find-identity -v -p codesigning`.");
}
if (config.phase3.notarizationRequired && !notarizationReady) {
  issues.push("Missing notarization credentials: set App Store Connect API variables or APPLE_ID + APPLE_PASSWORD + APPLE_TEAM_ID.");
}
if (present("APPLE_API_KEY_PATH") && !apiKeyPathExists) {
  issues.push("APPLE_API_KEY_PATH is set but the private key file does not exist.");
}
if (!githubReady) {
  issues.push("GitHub release automation is not ready: gh auth status failed and GITHUB_TOKEN is absent.");
}
if (!toolingReady) {
  issues.push("macOS signing/notarization tooling is incomplete. Check codesign, xcrun notarytool, and xcrun stapler.");
}

const report = {
  schemaVersion: 1,
  ok: issues.length === 0,
  checkedAt: new Date().toISOString(),
  project: config.project,
  distribution: config.distribution,
  phase3: config.phase3,
  signingReady,
  notarizationReady,
  githubReady,
  toolingReady,
  appleEnvironment: apple,
  detectedSigningIdentities: identities,
  commands,
  issues,
};

await mkdir(reportsRoot, { recursive: true });
await writeFile(path.join(reportsRoot, "phase3-preflight.json"), `${JSON.stringify(report, null, 2)}\n`);
await mkdir(path.join(rootDir, "docs", "generated"), { recursive: true });
await writeFile(
  path.join(rootDir, "docs", "generated", "phase3-readiness.md"),
  [
    "# Phase 3 Readiness",
    "",
    `Checked: ${report.checkedAt}`,
    "",
    "| Area | Ready |",
    "| --- | --- |",
    `| Signing | ${signingReady} |`,
    `| Notarization | ${notarizationReady} |`,
    `| GitHub release | ${githubReady} |`,
    `| macOS tooling | ${toolingReady} |`,
    "",
    "## Issues",
    "",
    ...(issues.length > 0 ? issues.map((issue) => `- ${issue}`) : ["- None"]),
    "",
    "## Detected Signing Identities",
    "",
    ...(identities.length > 0 ? identities.map((identity) => `- ${identity}`) : ["- None"]),
    "",
  ].join("\n"),
);
await appendAudit("phase3-preflight", report.ok ? "ok" : "blocked", {
  signingReady,
  notarizationReady,
  githubReady,
  toolingReady,
  issueCount: issues.length,
});

if (!report.ok && !process.argv.includes("--allow-missing-credentials")) {
  console.error(issues.join("\n"));
  process.exit(1);
}

console.log(JSON.stringify(report, null, 2));
