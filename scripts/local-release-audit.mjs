#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  appendAudit,
  exists,
  listFiles,
  readConfig,
  reportsRoot,
  rootDir,
  sha256File,
  toPosix,
} from "./harness-core.mjs";

const releaseRoot = path.join(rootDir, "release");
const docsGeneratedRoot = path.join(rootDir, "docs", "generated");
const macosBundleRoot = path.join(rootDir, "src-tauri", "target", "release", "bundle", "macos");
const clinicalDisclaimerPattern = /not for clinical decision making/i;

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
      resolve({ ok: false, command, args, code: null, stdout, stderr: error.message });
    });
    child.on("exit", (code) => {
      resolve({ ok: code === 0, command, args, code, stdout, stderr });
    });
  });

const summarizeCommand = (result) => ({
  ok: result.ok,
  command: [result.command, ...result.args].join(" "),
  code: result.code,
  stdout: result.stdout.slice(0, 4000),
  stderr: result.stderr.slice(0, 4000),
});

const readTextIfExists = async (targetPath) =>
  (await exists(targetPath)) ? readFile(targetPath, "utf8") : "";

const findMacAppBundle = async () => {
  if (!(await exists(macosBundleRoot))) {
    return null;
  }
  const entries = await readdir(macosBundleRoot, { withFileTypes: true });
  const bundle = entries.find((entry) => entry.isDirectory() && entry.name.endsWith(".app"));
  return bundle ? path.join(macosBundleRoot, bundle.name) : null;
};

const releaseFiles = async () => ((await exists(releaseRoot)) ? (await listFiles(releaseRoot)).sort() : []);

const verifyReleaseChecksums = async () => {
  const checksumPath = path.join(releaseRoot, "SHA256SUMS");
  if (!(await exists(checksumPath))) {
    return { ok: false, path: toPosix(path.relative(rootDir, checksumPath)), entries: [], issue: "missing" };
  }

  const lines = (await readFile(checksumPath, "utf8"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const entries = [];
  for (const line of lines) {
    const match = line.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (!match) {
      entries.push({ path: null, ok: false, expectedSha256: null, actualSha256: null, issue: "parse-error", line });
      continue;
    }

    const relativePath = match[2];
    const targetPath = path.join(releaseRoot, relativePath);
    const targetExists = await exists(targetPath);
    const actualSha256 = targetExists ? await sha256File(targetPath) : null;
    entries.push({
      path: toPosix(relativePath),
      ok: targetExists && actualSha256 === match[1].toLowerCase(),
      exists: targetExists,
      expectedSha256: match[1].toLowerCase(),
      actualSha256,
      issue: targetExists ? null : "missing-file",
    });
  }

  return {
    ok: entries.length > 0 && entries.every((entry) => entry.ok),
    path: toPosix(path.relative(rootDir, checksumPath)),
    entries,
  };
};

const artifactStatus = (files, predicate, label) => {
  const matches = files.filter(predicate).map(toPosix);
  return { label, ok: matches.length > 0, matches };
};

const buildMarkdown = (report) => [
  "# Local Release Audit",
  "",
  `Platform: ${report.platform}`,
  `Checked: ${report.checkedAt}`,
  `Host: ${report.host.platform} on ${report.host.name}`,
  `Version: ${report.project.version}`,
  "",
  "## Status",
  "",
  `- Internal release candidate ready: ${report.internalDistributionReady}`,
  `- External distribution ready: ${report.externalDistributionReady}`,
  `- Manual clean install verified: ${report.manualCleanInstallVerified}`,
  `- Status: ${report.status}`,
  "",
  "## Clinical Use Limitation",
  "",
  `- Portal source includes disclaimer: ${report.clinicalUseLimitation.portal}`,
  `- Release notes include disclaimer: ${report.clinicalUseLimitation.releaseNotes}`,
  `- Validation summary includes disclaimer: ${report.clinicalUseLimitation.validationSummary}`,
  "",
  "## Artifacts",
  "",
  "| Artifact | Present | Matches |",
  "| --- | --- | --- |",
  ...report.artifacts.map((artifact) => `| ${artifact.label} | ${artifact.ok} | ${artifact.matches.join("<br>") || "n/a"} |`),
  "",
  "## Checksums",
  "",
  `- SHA256SUMS verified: ${report.checksums.ok}`,
  `- Entries checked: ${report.checksums.entries.length}`,
  "",
  "## Signing And Platform Checks",
  "",
  ...Object.entries(report.signing.commands).map(
    ([name, result]) => `- ${name}: ${result.ok} (${result.command})`,
  ),
  "",
  "## Internal Blocking Items",
  "",
  ...(report.internalBlockingItems.length > 0 ? report.internalBlockingItems.map((issue) => `- ${issue}`) : ["- None"]),
  "",
  "## External Distribution Blocking Items",
  "",
  ...(report.externalBlockingItems.length > 0 ? report.externalBlockingItems.map((issue) => `- ${issue}`) : ["- None"]),
  "",
  "## Manual Clean Install Sign-Off",
  "",
  "- Tester:",
  "- Machine/VM:",
  "- OS version:",
  "- Network disabled during offline test:",
  "- Gatekeeper/SmartScreen result:",
  "- Portal health OK:",
  "- Runtime integrity OK:",
  "- Each configured app launched:",
  "- External HTTP(S) requests observed:",
  "- Decision:",
  "- Signature/date:",
  "",
];

const options = parseOptions(process.argv.slice(2));
const platform =
  options.platform ??
  process.env.HARNESS_TARGET_PLATFORM ??
  (process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : process.platform);
const config = await readConfig();
const files = await releaseFiles();
const checksumReport = await verifyReleaseChecksums();
const releaseNotes = await readTextIfExists(path.join(releaseRoot, "RELEASE_NOTES.md"));
const releaseSummaryText = await readTextIfExists(path.join(releaseRoot, "release-summary.json"));
let releaseSummary = null;
try {
  releaseSummary = releaseSummaryText ? JSON.parse(releaseSummaryText) : null;
} catch {
  releaseSummary = null;
}
const releaseType = releaseSummary?.releaseType ?? "unknown";
const internalRelease = releaseType === "unsigned-internal-candidate";
const validationSummary = await readTextIfExists(path.join(releaseRoot, "validation-pack", "validation-summary.md"));
const portalSource = await readTextIfExists(path.join(rootDir, "src", "App.tsx"));
const clinicalUseLimitation = {
  phrase: "not for clinical decision making",
  portal: clinicalDisclaimerPattern.test(portalSource),
  releaseNotes: clinicalDisclaimerPattern.test(releaseNotes),
  validationSummary: clinicalDisclaimerPattern.test(validationSummary),
};
const releaseNotesArtifact = artifactStatus(files, (file) => file === "RELEASE_NOTES.md", "Release notes");
const validationPackArtifact = artifactStatus(files, (file) => file === "validation-pack.zip", "Validation pack zip");
const checksumsArtifact = artifactStatus(files, (file) => file === "SHA256SUMS", "Release checksums");

const internalBlockingItems = [];
const externalBlockingItems = [];
let artifacts = [];
let signing = { ok: false, commands: {}, notes: [] };
let hostCompatible = true;

if (platform === "windows") {
  hostCompatible = process.platform === "win32";
  const windowsArtifacts = [
    artifactStatus(files, (file) => /windows-nsis.*setup\.exe$/i.test(file), "Windows NSIS installer"),
  ];
  if (config.distribution.windowsBundles.includes("msi")) {
    windowsArtifacts.push(artifactStatus(files, (file) => /\.msi$/i.test(file), "Windows MSI installer"));
  }
  artifacts = [...windowsArtifacts, releaseNotesArtifact, validationPackArtifact, checksumsArtifact];

  if (hostCompatible) {
    const installer = files.find((file) => /windows-nsis.*setup\.exe$/i.test(file));
    signing.commands.signtool = summarizeCommand(await runCapture("where", ["signtool"]));
    if (installer) {
      signing.commands.signtoolVerify = summarizeCommand(
        await runCapture("signtool", ["verify", "/pa", "/v", path.join(releaseRoot, installer)]),
      );
      signing.commands.authenticode = summarizeCommand(
        await runCapture("powershell", [
          "-NoProfile",
          "-Command",
          "Get-AuthenticodeSignature -FilePath $args[0] | ConvertTo-Json -Compress",
          path.join(releaseRoot, installer),
        ]),
      );
    }
    signing.ok = Boolean(signing.commands.signtoolVerify?.ok);
  } else {
    signing.notes.push("Windows signing verification requires a Windows host with signtool or PowerShell Authenticode checks.");
    externalBlockingItems.push("Clean Windows install and Authenticode verification require a Windows machine or VM.");
  }
} else if (platform === "macos") {
  hostCompatible = process.platform === "darwin";
  const macArtifacts = [];
  if (config.distribution.macBundles.includes("app")) {
    macArtifacts.push(artifactStatus(files, (file) => /macos-app\.zip$/i.test(file), "macOS app zip"));
  }
  if (config.distribution.macBundles.includes("dmg")) {
    macArtifacts.push(artifactStatus(files, (file) => /\.dmg$/i.test(file), "macOS DMG"));
  }
  if (config.distribution.macBundles.includes("pkg") && !internalRelease) {
    macArtifacts.push(artifactStatus(files, (file) => /\.pkg$/i.test(file), "macOS pkg"));
  }
  artifacts = [...macArtifacts, releaseNotesArtifact, validationPackArtifact, checksumsArtifact];

  if (hostCompatible) {
    const appBundle = await findMacAppBundle();
    const dmg = files.find((file) => /\.dmg$/i.test(file));
    const pkg = files.find((file) => /\.pkg$/i.test(file));
    if (appBundle) {
      signing.commands.codesignVerify = summarizeCommand(
        await runCapture("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appBundle]),
      );
      signing.commands.codesignDetails = summarizeCommand(
        await runCapture("codesign", ["-dv", "--verbose=4", appBundle]),
      );
      signing.commands.spctlExecute = summarizeCommand(
        await runCapture("spctl", ["--assess", "--type", "execute", "--verbose=4", appBundle]),
      );
    }
    if (dmg) {
      signing.commands.spctlDmg = summarizeCommand(
        await runCapture("spctl", [
          "--assess",
          "--type",
          "open",
          "--context",
          "context:primary-signature",
          "--verbose=4",
          path.join(releaseRoot, dmg),
        ]),
      );
      signing.commands.staplerDmg = summarizeCommand(
        await runCapture("xcrun", ["stapler", "validate", path.join(releaseRoot, dmg)]),
      );
    }
    if (pkg) {
      signing.commands.pkgSignature = summarizeCommand(
        await runCapture("pkgutil", ["--check-signature", path.join(releaseRoot, pkg)]),
      );
      signing.commands.spctlPkgInstall = summarizeCommand(
        await runCapture("spctl", ["--assess", "--type", "install", "--verbose=4", path.join(releaseRoot, pkg)]),
      );
      signing.commands.staplerPkg = summarizeCommand(
        await runCapture("xcrun", ["stapler", "validate", path.join(releaseRoot, pkg)]),
      );
    }
    signing.ok = Boolean(
      signing.commands.codesignVerify?.ok &&
        signing.commands.spctlExecute?.ok &&
        (!dmg || (signing.commands.spctlDmg?.ok && signing.commands.staplerDmg?.ok)) &&
        (!pkg || (
          signing.commands.pkgSignature?.ok &&
          signing.commands.spctlPkgInstall?.ok &&
          signing.commands.staplerPkg?.ok
        )),
    );
  } else {
    signing.notes.push("macOS signing and Gatekeeper verification require a macOS host.");
    externalBlockingItems.push("Clean macOS install and Gatekeeper verification require a macOS machine or VM.");
  }
} else {
  hostCompatible = false;
  artifacts = [releaseNotesArtifact, validationPackArtifact, checksumsArtifact];
  internalBlockingItems.push(`Unsupported local release audit platform: ${platform}.`);
}

if (!checksumReport.ok) {
  internalBlockingItems.push("Release checksums are missing or do not match release/SHA256SUMS.");
}
for (const artifact of artifacts) {
  if (!artifact.ok) {
    internalBlockingItems.push(`Missing release artifact: ${artifact.label}.`);
  }
}
for (const [key, present] of Object.entries(clinicalUseLimitation)) {
  if (key !== "phrase" && !present) {
    internalBlockingItems.push(`Clinical use limitation is missing from ${key}.`);
  }
}
if (!signing.ok) {
  externalBlockingItems.push(
    platform === "windows"
      ? "Windows Authenticode verification is not complete for external distribution."
      : "macOS signing and Gatekeeper verification is not complete for external distribution.",
  );
}

const requiredArtifactsReady = artifacts.every((artifact) => artifact.ok);
const disclaimerReady =
  clinicalUseLimitation.portal &&
  clinicalUseLimitation.releaseNotes &&
  clinicalUseLimitation.validationSummary;
const internalDistributionReady = requiredArtifactsReady && checksumReport.ok && disclaimerReady;
const externalDistributionReady = internalDistributionReady && hostCompatible && signing.ok;
const issues = internalRelease
  ? [...internalBlockingItems]
  : [...internalBlockingItems, ...externalBlockingItems];
const status = externalDistributionReady
  ? "external-ready"
  : internalDistributionReady
    ? "internal-unsigned-ready"
    : "blocked";
const report = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  platform,
  hostCompatible,
  host: {
    name: os.hostname(),
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
  },
  project: config.project,
  distribution: config.distribution,
  releaseType,
  clinicalUseLimitation,
  artifacts,
  checksums: checksumReport,
  signing,
  internalDistributionReady,
  externalDistributionReady,
  manualCleanInstallVerified: false,
  manualCleanInstallRequired: true,
  status,
  issues,
  internalBlockingItems,
  externalBlockingItems,
};

await mkdir(reportsRoot, { recursive: true });
await mkdir(docsGeneratedRoot, { recursive: true });
await writeFile(path.join(reportsRoot, `local-release-audit-${platform}.json`), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(path.join(reportsRoot, "local-release-audit.json"), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(path.join(docsGeneratedRoot, `local-release-audit-${platform}.md`), `${buildMarkdown(report).join("\n")}\n`);
await writeFile(path.join(docsGeneratedRoot, "local-release-audit.md"), `${buildMarkdown(report).join("\n")}\n`);
await appendAudit("local-release-audit", status, {
  platform,
  internalDistributionReady,
  externalDistributionReady,
  issueCount: issues.length,
});

console.log(JSON.stringify(report, null, 2));

if (options.strict && !externalDistributionReady) {
  process.exit(1);
}
