#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
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
const envPathExists = async (name) => {
  if (!present(name)) {
    return false;
  }
  const configuredPath = process.env[name];
  const resolvedPath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.join(rootDir, configuredPath);
  return exists(resolvedPath);
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

const options = parseOptions(process.argv.slice(2));
const targetPlatform =
  options.platform ??
  process.env.HARNESS_TARGET_PLATFORM ??
  (process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : process.platform);
const config = await readConfig();

if (targetPlatform === "windows") {
  const certificatePathExists = await envPathExists("WINDOWS_CERTIFICATE_PATH");
  const windows = {
    certificatePfx: present("WINDOWS_CERTIFICATE"),
    certificatePath: present("WINDOWS_CERTIFICATE_PATH"),
    certificatePathExists,
    certificatePassword: present("WINDOWS_CERTIFICATE_PASSWORD"),
    certificateThumbprint: present("WINDOWS_CERTIFICATE_THUMBPRINT"),
    signCommand: present("WINDOWS_SIGN_COMMAND"),
    timestampUrl: present("WINDOWS_TIMESTAMP_URL"),
  };
  const commands = {
    powershell: summarizeCommand(await runCapture("powershell", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"])),
    signtool: summarizeCommand(await runCapture("where", ["signtool"])),
    ghAuth: summarizeCommand(await runCapture("gh", ["auth", "status"])),
  };
  const signingReady =
    windows.signCommand ||
    windows.certificateThumbprint ||
    (windows.certificatePfx && windows.certificatePassword);
  const githubReady = commands.ghAuth.ok || present("GITHUB_TOKEN");
  const toolingReady = commands.powershell.ok;
  const issues = [];

  if (config.phase3.signingRequired && !signingReady) {
    issues.push("Missing Windows signing input: set WINDOWS_CERTIFICATE_THUMBPRINT after importing a PFX certificate, or provide WINDOWS_SIGN_COMMAND. CI may also set WINDOWS_CERTIFICATE + WINDOWS_CERTIFICATE_PASSWORD so the workflow can import the PFX first.");
  }
  if (windows.certificatePath && !windows.certificatePathExists) {
    issues.push("WINDOWS_CERTIFICATE_PATH is set but the PFX file does not exist.");
  }
  if (windows.certificatePathExists && windows.certificatePassword && !windows.certificateThumbprint && !windows.signCommand) {
    issues.push("WINDOWS_CERTIFICATE_PATH exists, but Tauri still needs WINDOWS_CERTIFICATE_THUMBPRINT after import, or WINDOWS_SIGN_COMMAND.");
  }
  if (signingReady && !commands.signtool.ok && !windows.signCommand) {
    issues.push("Windows signing is configured but signtool was not found. Install Windows SDK or provide WINDOWS_SIGN_COMMAND.");
  }
  if (!githubReady) {
    issues.push("GitHub release automation is not ready: gh auth status failed and GITHUB_TOKEN is absent.");
  }
  if (!toolingReady) {
    issues.push("Windows package tooling is incomplete. Check PowerShell availability.");
  }

  const report = {
    schemaVersion: 1,
    platform: "windows",
    ok: issues.length === 0,
    checkedAt: new Date().toISOString(),
    project: config.project,
    distribution: config.distribution,
    phase3: config.phase3,
    signingReady,
    notarizationReady: null,
    githubReady,
    toolingReady,
    windowsEnvironment: windows,
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
      `Platform: Windows`,
      `Checked: ${report.checkedAt}`,
      `Host: ${os.hostname()}`,
      "",
      "| Area | Ready |",
      "| --- | --- |",
      `| Signing | ${signingReady} |`,
      "| Notarization | n/a |",
      `| GitHub release | ${githubReady} |`,
      `| Windows tooling | ${toolingReady} |`,
      "",
      "## Issues",
      "",
      ...(issues.length > 0 ? issues.map((issue) => `- ${issue}`) : ["- None"]),
      "",
    ].join("\n"),
  );
  await appendAudit("phase3-preflight", report.ok ? "ok" : "blocked", {
    platform: "windows",
    signingReady,
    githubReady,
    toolingReady,
    issueCount: issues.length,
  });

  if (!report.ok && !options["allow-missing-credentials"]) {
    console.error(issues.join("\n"));
    process.exit(1);
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

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
  pkgbuild: summarizeCommand(await runCapture("xcrun", ["-f", "pkgbuild"])),
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
const installerSigningReady =
  !config.distribution.macBundles.includes("pkg") ||
  present("APPLE_INSTALLER_SIGNING_IDENTITY");
const notarizationReady = apple.appStoreConnectApi || apple.appleIdNotary;
const githubReady = commands.ghAuth.ok || present("GITHUB_TOKEN");
const toolingReady =
  commands.codesign.ok && commands.notarytool.ok && commands.stapler.ok && commands.pkgbuild.ok;

const issues = [];
if (config.phase3.signingRequired && !signingReady) {
  issues.push("Missing signing input: set APPLE_SIGNING_IDENTITY locally or APPLE_CERTIFICATE + APPLE_CERTIFICATE_PASSWORD + KEYCHAIN_PASSWORD in CI.");
}
if (apple.localSigningIdentity && !localIdentityInstalled) {
  issues.push("APPLE_SIGNING_IDENTITY is set but was not found in `security find-identity -v -p codesigning`.");
}
if (config.phase3.signingRequired && config.distribution.macBundles.includes("pkg") && !installerSigningReady) {
  issues.push("APPLE_INSTALLER_SIGNING_IDENTITY is required when mac_bundles includes pkg and signing_required is true.");
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
  issues.push("macOS signing/notarization/package tooling is incomplete. Check codesign, xcrun notarytool, xcrun stapler, and xcrun pkgbuild.");
}

const report = {
  schemaVersion: 1,
  platform: "macos",
  ok: issues.length === 0,
  checkedAt: new Date().toISOString(),
  project: config.project,
  distribution: config.distribution,
  phase3: config.phase3,
  signingReady,
  installerSigningReady,
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
    "Platform: macOS",
    `Checked: ${report.checkedAt}`,
    "",
    "| Area | Ready |",
    "| --- | --- |",
    `| Signing | ${signingReady} |`,
    `| Installer package signing | ${installerSigningReady} |`,
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
  installerSigningReady,
  notarizationReady,
  githubReady,
  toolingReady,
  issueCount: issues.length,
});

if (!report.ok && !options["allow-missing-credentials"]) {
  console.error(issues.join("\n"));
  process.exit(1);
}

console.log(JSON.stringify(report, null, 2));
