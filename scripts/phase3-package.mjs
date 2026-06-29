#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { cp, mkdir, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  appendAudit,
  distRoot,
  exists,
  listFiles,
  readConfig,
  reportsRoot,
  rootDir,
  runCommand,
  sha256File,
  toPosix,
} from "./harness-core.mjs";
import { buildReleaseSmokePlan, renderReleaseSmokeMarkdown } from "./release-smoke-plan.mjs";

const releaseRoot = path.join(rootDir, "release");
const macosBundleRoot = path.join(rootDir, "src-tauri", "target", "release", "bundle", "macos");
const dmgRoot = path.join(rootDir, "src-tauri", "target", "release", "bundle", "dmg");
const windowsReleaseRoot = path.join(rootDir, "src-tauri", "target", "release");
const nsisRoot = path.join(windowsReleaseRoot, "bundle", "nsis");
const msiRoot = path.join(windowsReleaseRoot, "bundle", "msi");
const execFileAsync = promisify(execFile);
const clinicalUseLimitation =
  "This harness and its bundled synthetic demo apps are for technical evaluation only. They are not validated medical devices and are not for clinical decision making unless an organization completes its own regulated validation and approval.";

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

const options = parseOptions(process.argv.slice(2));
const targetPlatform =
  options.platform ??
  process.env.HARNESS_TARGET_PLATFORM ??
  (process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : process.platform);

const findFirst = async (directory, predicate) => {
  if (!(await exists(directory))) {
    return null;
  }
  for (const entry of await readdir(directory)) {
    const fullPath = path.join(directory, entry);
    if (predicate(entry, fullPath)) {
      return fullPath;
    }
  }
  return null;
};

const findAll = async (directory, predicate, relative = "") => {
  if (!(await exists(directory))) {
    return [];
  }
  const current = path.join(directory, relative);
  const entries = await readdir(current, { withFileTypes: true });
  const matches = [];
  for (const entry of entries) {
    const nextRelative = path.join(relative, entry.name);
    const fullPath = path.join(directory, nextRelative);
    if (entry.isDirectory()) {
      matches.push(...(await findAll(directory, predicate, nextRelative)));
      continue;
    }
    if (entry.isFile() && predicate(entry.name, fullPath)) {
      matches.push(fullPath);
    }
  }
  return matches.sort();
};

const sha256Text = (value) => createHash("sha256").update(value).digest("hex");

const gitValue = async (args) => {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd: rootDir });
    return stdout.trim() || "not available";
  } catch {
    return "not available";
  }
};

const commandText = async (command, args) => {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { cwd: rootDir, timeout: 15000 });
    return `${stdout}${stderr}`.trim() || "not available";
  } catch {
    return "not available";
  }
};

const releaseContext = async (config) => ({
  releaseTag: process.env.RELEASE_TAG ?? `v${config.project.version}`,
  gitCommit: process.env.GITHUB_SHA ?? (await gitValue(["rev-parse", "HEAD"])),
  gitExactTag: await gitValue(["describe", "--tags", "--exact-match"]),
  gitBranch: process.env.GITHUB_REF_NAME ?? (await gitValue(["branch", "--show-current"])),
  generatedBy: process.env.GITHUB_ACTOR ?? os.userInfo().username,
  host: os.hostname(),
  platform: `${os.platform()} ${os.release()} ${os.arch()}`,
});

const writeReleaseNotes = async (config, assets, platform = "macos") => {
  const staticReportPath = path.join(reportsRoot, "static-verification.json");
  const e2eReportPath = path.join(reportsRoot, "e2e-diagnostics.json");
  const staticReport = (await exists(staticReportPath))
    ? JSON.parse(await readFile(staticReportPath, "utf8"))
    : null;
  const e2eReport = (await exists(e2eReportPath))
    ? JSON.parse(await readFile(e2eReportPath, "utf8"))
    : null;
  const dataValidationPath = path.join(reportsRoot, "clinical-data-pack-validation.json");
  const dataValidationReport = (await exists(dataValidationPath))
    ? JSON.parse(await readFile(dataValidationPath, "utf8"))
    : null;
  const configValidationPath = path.join(reportsRoot, "harness-config-validation.json");
  const configValidationReport = (await exists(configValidationPath))
    ? JSON.parse(await readFile(configValidationPath, "utf8"))
    : null;
  const bundleIntegrityPath = path.join(reportsRoot, "bundle-integrity.json");
  const bundleIntegrityReport = (await exists(bundleIntegrityPath))
    ? JSON.parse(await readFile(bundleIntegrityPath, "utf8"))
    : null;

  const notes = [
    `# ${config.project.bundleName} ${config.project.version}`,
    "",
    `Platform: ${platform}`,
    `Channel: ${config.distribution.releaseChannel}`,
    "",
    "## Clinical Use Limitation",
    "",
    clinicalUseLimitation,
    "",
    "## Verification",
    "",
    `- Static verification: ${staticReport?.ok ?? "not available"}`,
    `- Harness config validation: ${configValidationReport?.ok ?? "not available"}`,
    `- Runtime bundle integrity: ${bundleIntegrityReport?.ok ?? e2eReport?.bundleIntegrity?.ok ?? "not available"}`,
    `- E2E verification: ${e2eReport?.ok ?? "not available"}`,
    `- Clinical data validation: ${dataValidationReport?.ok ?? "not available"}`,
    `- External HTTP(S) requests observed: ${e2eReport?.externalRequests?.length ?? "not available"}`,
    `- Screenshot evidence files: ${e2eReport?.screenshots?.length ?? "not available"}`,
    "",
    "## Assets",
    "",
    "| Asset | SHA-256 |",
    "| --- | --- |",
    ...assets.map((asset) => `| ${asset.name} | ${asset.sha256} |`),
    "",
    "## Phase 3 Notes",
    "",
    platform === "windows"
      ? "Windows code signing requires a code-signing certificate and signing command or certificate thumbprint. If this release was built without those credentials, treat it as an internal unsigned release candidate."
      : "Developer ID signing and notarization require Apple credentials. If this release was built without those credentials, treat it as an internal unsigned release candidate.",
    "",
  ].join("\n");

  await writeFile(path.join(releaseRoot, "RELEASE_NOTES.md"), notes);
};

const copyIfExists = async (source, destination) => {
  if (await exists(source)) {
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true, force: true });
  }
};

const copyReportEvidence = async (evidenceRoot) => {
  const manifestPath = path.join(reportsRoot, "report-export-manifest.json");
  const reportSourceRoot = path.join(reportsRoot, "exported");
  const reportEvidenceRoot = path.join(evidenceRoot, "reports");
  if (!(await exists(manifestPath)) || !(await exists(reportSourceRoot))) {
    return;
  }

  await copyIfExists(path.join(reportSourceRoot, "index.html"), path.join(reportEvidenceRoot, "index.html"));
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const reportPaths = new Set(
    (manifest.appResults ?? [])
      .flatMap((appResult) => appResult.reports ?? [])
      .map((report) => report.path)
      .filter((reportPath) => typeof reportPath === "string" && reportPath.startsWith("reports/exported/"))
      .map((reportPath) => reportPath.slice("reports/exported/".length)),
  );

  for (const reportPath of [...reportPaths].sort()) {
    await copyIfExists(path.join(reportSourceRoot, reportPath), path.join(reportEvidenceRoot, reportPath));
  }
};

const notarizeIfConfigured = async (artifactPath) => {
  if (process.env.APPLE_API_ISSUER && process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_PATH) {
    await runCommand("xcrun", [
      "notarytool",
      "submit",
      artifactPath,
      "--key",
      process.env.APPLE_API_KEY_PATH,
      "--key-id",
      process.env.APPLE_API_KEY,
      "--issuer",
      process.env.APPLE_API_ISSUER,
      "--wait",
    ]);
    await runCommand("xcrun", ["stapler", "staple", artifactPath]);
    return;
  }

  if (process.env.APPLE_ID && process.env.APPLE_PASSWORD && process.env.APPLE_TEAM_ID) {
    await runCommand("xcrun", [
      "notarytool",
      "submit",
      artifactPath,
      "--apple-id",
      process.env.APPLE_ID,
      "--password",
      process.env.APPLE_PASSWORD,
      "--team-id",
      process.env.APPLE_TEAM_ID,
      "--wait",
    ]);
    await runCommand("xcrun", ["stapler", "staple", artifactPath]);
  }
};

const createDmgFromAppBundle = async (config, appBundle, destination) => {
  const stagingRoot = path.join(releaseRoot, "dmg-staging");
  await rm(stagingRoot, { recursive: true, force: true });
  await mkdir(stagingRoot, { recursive: true });
  await cp(appBundle, path.join(stagingRoot, path.basename(appBundle)), {
    recursive: true,
    force: true,
  });
  try {
    await symlink("/Applications", path.join(stagingRoot, "Applications"));
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw error;
    }
  }

  try {
    await rm(destination, { force: true });
    await runCommand("hdiutil", [
      "create",
      "-volname",
      config.project.bundleName,
      "-srcfolder",
      stagingRoot,
      "-ov",
      "-format",
      "UDZO",
      destination,
    ]);
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }

  if (process.env.APPLE_SIGNING_IDENTITY) {
    await runCommand("codesign", ["--force", "--sign", process.env.APPLE_SIGNING_IDENTITY, destination]);
  }
  await notarizeIfConfigured(destination);
};

const createValidationPack = async (config, assets, platform = "macos") => {
  const validationRoot = path.join(releaseRoot, "validation-pack");
  const evidenceRoot = path.join(validationRoot, "evidence");
  const context = await releaseContext(config);
  const releaseSummary = {
    schemaVersion: 1,
    project: config.project.name,
    version: config.project.version,
    gitCommit: context.gitCommit,
    gitTag: context.gitExactTag,
    builtAt: new Date().toISOString(),
    platform,
    node: process.version,
    npm: await commandText("npm", ["--version"]),
    r: await commandText("Rscript", ["--version"]),
    rustc: await commandText("rustc", ["--version"]),
    cargo: await commandText("cargo", ["--version"]),
    tauriCli: await commandText("tauri", ["--version"]),
    dataClassification: "synthetic",
    regulatedUse: false,
    submissionReady: false,
    artifactSha256: assets.map((asset) => ({ path: asset.name, sha256: asset.sha256 })),
  };
  await rm(validationRoot, { recursive: true, force: true });
  await mkdir(evidenceRoot, { recursive: true });
  await writeFile(path.join(releaseRoot, "release-summary.json"), `${JSON.stringify(releaseSummary, null, 2)}\n`);
  await writeFile(path.join(evidenceRoot, "release-summary.json"), `${JSON.stringify(releaseSummary, null, 2)}\n`);

  await copyIfExists(path.join(releaseRoot, "release-summary.json"), path.join(evidenceRoot, "release-summary.json"));
  await copyIfExists(path.join(reportsRoot, "harness-config-validation.json"), path.join(evidenceRoot, "harness-config-validation.json"));
  await copyIfExists(path.join(reportsRoot, "static-verification.json"), path.join(evidenceRoot, "static-verification.json"));
  await copyIfExists(path.join(reportsRoot, "bundle-integrity.json"), path.join(evidenceRoot, "bundle-integrity.json"));
  await copyIfExists(path.join(reportsRoot, "tauri-security-audit.json"), path.join(evidenceRoot, "tauri-security-audit.json"));
  await copyIfExists(path.join(reportsRoot, "phi-pii-scan.json"), path.join(evidenceRoot, "phi-pii-scan.json"));
  await copyIfExists(path.join(reportsRoot, "reproducibility.json"), path.join(evidenceRoot, "reproducibility.json"));
  await copyIfExists(path.join(reportsRoot, "e2e-diagnostics.json"), path.join(evidenceRoot, "e2e-diagnostics.json"));
  await copyIfExists(path.join(reportsRoot, "offline-verification.json"), path.join(evidenceRoot, "offline-verification.json"));
  await copyIfExists(path.join(reportsRoot, "clinical-data-pack-validation.json"), path.join(evidenceRoot, "clinical-data-pack-validation.json"));
  await copyIfExists(path.join(reportsRoot, "cdisc-bridge-preflight.json"), path.join(evidenceRoot, "cdisc-bridge-preflight.json"));
  await copyIfExists(path.join(reportsRoot, "report-export-manifest.json"), path.join(evidenceRoot, "report-export-manifest.json"));
  await copyIfExists(path.join(reportsRoot, "pdf-report-export-manifest.json"), path.join(evidenceRoot, "pdf-report-export-manifest.json"));
  await copyIfExists(path.join(reportsRoot, "review-workflow.json"), path.join(evidenceRoot, "review-workflow.json"));
  await copyIfExists(path.join(reportsRoot, "review-signoff.json"), path.join(evidenceRoot, "review-signoff.json"));
  await copyIfExists(path.join(reportsRoot, "review-signoff-history.jsonl"), path.join(evidenceRoot, "review-signoff-history.jsonl"));
  await copyIfExists(path.join(reportsRoot, "evidence-index.json"), path.join(evidenceRoot, "evidence-index.json"));
  await copyIfExists(path.join(reportsRoot, "evidence-index.html"), path.join(evidenceRoot, "evidence-index.html"));
  await copyIfExists(path.join(reportsRoot, "exported-pdf"), path.join(evidenceRoot, "reports-pdf"));
  await copyReportEvidence(evidenceRoot);
  await copyIfExists(path.join(reportsRoot, "screenshots"), path.join(evidenceRoot, "screenshots"));
  await copyIfExists(path.join(reportsRoot, "phase3-preflight.json"), path.join(evidenceRoot, "phase3-preflight.json"));
  await copyIfExists(path.join(distRoot, "manifest.json"), path.join(evidenceRoot, "portal-manifest.json"));
  await copyIfExists(path.join(distRoot, "harness-bundle-manifest.json"), path.join(evidenceRoot, "harness-bundle-manifest.json"));
  await copyIfExists(path.join(distRoot, "checksums", "SHA256SUMS"), path.join(evidenceRoot, "dist-SHA256SUMS"));
  await copyIfExists(path.join(distRoot, "reports", "sbom.json"), path.join(evidenceRoot, "sbom.json"));
  await copyIfExists(path.join(distRoot, "reports", "licenses.md"), path.join(evidenceRoot, "licenses.md"));
  await copyIfExists(path.join(rootDir, "docs", "generated", "clinical-data-dictionary.md"), path.join(evidenceRoot, "clinical-data-dictionary.md"));
  await copyIfExists(path.join(rootDir, "docs", "generated", "verification-procedure.md"), path.join(evidenceRoot, "verification-procedure.md"));
  await copyIfExists(path.join(rootDir, "docs", "generated", "report-export-index.md"), path.join(evidenceRoot, "report-export-index.md"));
  await copyIfExists(path.join(rootDir, "docs", "generated", "pdf-report-index.md"), path.join(evidenceRoot, "pdf-report-index.md"));
  await copyIfExists(path.join(rootDir, "docs", "generated", "cdisc-bridge-preflight.md"), path.join(evidenceRoot, "cdisc-bridge-preflight.md"));
  await copyIfExists(path.join(rootDir, "docs", "generated", "evidence-index.md"), path.join(evidenceRoot, "evidence-index.md"));
  await copyIfExists(path.join(rootDir, "docs", "generated", "phase3-readiness.md"), path.join(evidenceRoot, "phase3-readiness.md"));
  await copyIfExists(path.join(rootDir, "docs", "phase3-distribution.md"), path.join(evidenceRoot, "phase3-distribution.md"));
  await copyIfExists(path.join(rootDir, "docs", "validation-approval-template.md"), path.join(evidenceRoot, "validation-approval-template.md"));
  const checklistName = platform === "windows" ? "manual-clean-windows-checklist.md" : "manual-clean-macos-checklist.md";
  await copyIfExists(path.join(rootDir, "docs", checklistName), path.join(validationRoot, checklistName));
  const releaseSmokePlan = buildReleaseSmokePlan({ config, context, platform });
  await writeFile(
    path.join(validationRoot, "release-smoke-plan.json"),
    `${JSON.stringify(releaseSmokePlan, null, 2)}\n`,
  );
  await writeFile(path.join(validationRoot, "release-smoke-test.md"), renderReleaseSmokeMarkdown(releaseSmokePlan));

  const evidenceFiles = (await listFiles(validationRoot)).sort();
  const evidence = [];
  for (const file of evidenceFiles) {
    const fullPath = path.join(validationRoot, file);
    const metadata = await stat(fullPath);
    evidence.push({
      path: toPosix(file),
      size: metadata.size,
      sha256: await sha256File(fullPath),
    });
  }

  await writeFile(
    path.join(validationRoot, "evidence-index.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        project: config.project,
        distribution: config.distribution,
        context,
        evidence,
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    path.join(validationRoot, "validation-summary.md"),
    [
      `# Validation Summary: ${config.project.bundleName}`,
      "",
      `Version: ${config.project.version}`,
      `Generated: ${new Date().toISOString()}`,
      `Release tag: ${context.releaseTag}`,
      `Current Git exact tag: ${context.gitExactTag}`,
      `Git commit: ${context.gitCommit}`,
      `Git branch/ref: ${context.gitBranch}`,
      `Generated by: ${context.generatedBy}`,
      `Target platform: ${platform}`,
      `Environment: ${context.platform} on ${context.host}`,
      "",
      "## Scope",
      "",
      `This pack contains automated Phase 2/3 readiness evidence for the ${platform} local-first Shinylive desktop harness. It is not a substitute for organization-specific clinical validation approval.`,
      "",
      "## Clinical Use Limitation",
      "",
      clinicalUseLimitation,
      "",
      "## Automated Checks",
      "",
      "- Harness configuration validation",
      "- Static bundle hash verification",
      "- Runtime bundle integrity endpoint verification",
      "- Tauri security hardening audit for capabilities, CSP, navigation, resources, and localhost binding",
      "- Reproducibility evidence for pinned Node, Rust, R, lockfiles, and Shinylive/dist asset hashes",
      "- Playwright portal/app verification with external HTTP(S) request audit",
      "- Clinical data pack validation with data dictionary",
      "- CDISC bridge preflight with explicit non-submission-ready status and Pinnacle 21 handoff readiness",
      "- Exported subject reports with data pack hash, generated timestamp, and reviewer sign-off fields",
      "- PDF companion reports for validation and demo review packets",
      "- Review workflow status template for reviewer, reviewed_at, decision, and notes",
      "- Persistent reviewer sign-off state, sign-off history, and human-readable evidence index",
      "- Screenshot evidence for the portal and verified apps",
      "- Release asset checksum inventory",
      "- Release artifact smoke test plan with platform install, offline, app, and evidence checks",
      `- Manual clean ${platform === "windows" ? "Windows" : "macOS"} checklist included`,
      "",
      "## Reviewer Sign-Off",
      "",
      "| Field | Value |",
      "| --- | --- |",
      "| Reviewer |  |",
      "| Role |  |",
      "| Review date |  |",
      "| Decision |  |",
      "| Notes |  |",
      "",
      "## Included Evidence",
      "",
      ...evidence.map((item) => `- ${item.path} (${item.sha256})`),
      "",
      "## Release Assets",
      "",
      ...assets.map((asset) => `- ${asset.name} (${asset.sha256})`),
      "",
    ].join("\n"),
  );
};

const createZip = async (source, destination) => {
  if (process.platform === "win32") {
    await runCommand("powershell", [
      "-NoProfile",
      "-Command",
      "& { param([string]$Source, [string]$Destination) Compress-Archive -LiteralPath $Source -DestinationPath $Destination -Force }",
      source,
      destination,
    ]);
    return;
  }

  await rm(destination, { force: true });
  await runCommand("zip", ["-r", "-X", destination, path.basename(source)], {
    cwd: path.dirname(source),
  });
};

const copyReleaseEvidence = async () => {
  await copyIfExists(path.join(distRoot, "harness-bundle-manifest.json"), path.join(releaseRoot, "harness-bundle-manifest.json"));
  await copyIfExists(path.join(distRoot, "checksums", "SHA256SUMS"), path.join(releaseRoot, "dist-SHA256SUMS"));
  await copyIfExists(path.join(distRoot, "reports", "sbom.json"), path.join(releaseRoot, "sbom.json"));
  await copyIfExists(path.join(distRoot, "reports", "licenses.md"), path.join(releaseRoot, "licenses.md"));
};

const collectReleaseAssets = async () => {
  const assetFiles = (await listFiles(releaseRoot))
    .filter((file) => file !== "SHA256SUMS")
    .filter((file) => !file.startsWith(`validation-pack${path.sep}`))
    .sort();
  const assets = [];
  for (const file of assetFiles) {
    const fullPath = path.join(releaseRoot, file);
    assets.push({
      name: toPosix(file),
      sha256: await sha256File(fullPath),
    });
  }
  return assets;
};

const writeFinalChecksums = async () => {
  const finalFiles = (await listFiles(releaseRoot))
    .filter((file) => file !== "SHA256SUMS")
    .sort();
  const entries = [];
  for (const file of finalFiles) {
    entries.push({
      path: toPosix(file),
      sha256: await sha256File(path.join(releaseRoot, file)),
    });
  }
  const checksumLines = entries.map((entry) => `${entry.sha256}  ${entry.path}`);
  await writeFile(path.join(releaseRoot, "SHA256SUMS"), `${checksumLines.join("\n")}\n`);
  return { finalFiles, checksumLines, entries };
};

const refreshReleaseSummaryWithFinalChecksums = async () => {
  const summaryPath = path.join(releaseRoot, "release-summary.json");
  if (!(await exists(summaryPath))) {
    return { finalFiles: [], checksumLines: [], entries: [] };
  }

  const firstPass = await writeFinalChecksums();
  const releaseSummary = JSON.parse(await readFile(summaryPath, "utf8"));
  releaseSummary.finalChecksumManifest = {
    path: "SHA256SUMS",
    generatedAt: new Date().toISOString(),
    preSummaryReleaseFingerprint: sha256Text(firstPass.checksumLines.join("\n")),
    authoritative: true,
    note: "SHA256SUMS is the authoritative final release checksum manifest. finalReleaseChecksums excludes release-summary.json to avoid self-referential checksum drift.",
  };
  releaseSummary.finalReleaseChecksums = firstPass.entries.filter((entry) => entry.path !== "release-summary.json");
  await writeFile(summaryPath, `${JSON.stringify(releaseSummary, null, 2)}\n`);
  return writeFinalChecksums();
};

const packageWindows = async (config) => {
  await rm(releaseRoot, { recursive: true, force: true });
  await mkdir(releaseRoot, { recursive: true });

  const portableExe = await findFirst(
    windowsReleaseRoot,
    (name) => name.endsWith(".exe") && !name.toLowerCase().includes("setup"),
  );
  if (portableExe) {
    await cp(
      portableExe,
      path.join(releaseRoot, `${config.distribution.artifactName}-${config.project.version}-windows-portable.exe`),
    );
  }

  const nsisInstallers = await findAll(nsisRoot, (name) => name.endsWith(".exe"));
  const msiInstallers = await findAll(msiRoot, (name) => name.endsWith(".msi"));
  if (config.distribution.windowsBundles.includes("nsis") && nsisInstallers.length === 0) {
    throw new Error("No Windows NSIS installer found. Run npm run tauri:build:windows:no-sign first.");
  }
  if (config.distribution.windowsBundles.includes("msi") && msiInstallers.length === 0) {
    throw new Error("No Windows MSI installer found. Run npm run tauri:build:windows:msi first.");
  }

  for (const [index, installer] of nsisInstallers.entries()) {
    const suffix = nsisInstallers.length > 1 ? `-${index + 1}` : "";
    await cp(
      installer,
      path.join(releaseRoot, `${config.distribution.artifactName}-${config.project.version}-windows-nsis${suffix}-setup.exe`),
    );
  }
  for (const [index, installer] of msiInstallers.entries()) {
    const suffix = msiInstallers.length > 1 ? `-${index + 1}` : "";
    await cp(
      installer,
      path.join(releaseRoot, `${config.distribution.artifactName}-${config.project.version}-windows${suffix}.msi`),
    );
  }

  await copyReleaseEvidence();

  const assets = await collectReleaseAssets();
  await createValidationPack(config, assets, "windows");
  await createZip(path.join(releaseRoot, "validation-pack"), path.join(releaseRoot, "validation-pack.zip"));

  const releaseNoteAssets = await collectReleaseAssets();
  await writeReleaseNotes(config, releaseNoteAssets, "windows");

  const { finalFiles, checksumLines } = await refreshReleaseSummaryWithFinalChecksums();
  await appendAudit("phase3-package", "ok", {
    platform: "windows",
    releaseRoot,
    releaseFingerprint: sha256Text(checksumLines.join("\n")),
    assetCount: finalFiles.length,
  });

  console.log(`Windows release package written to ${releaseRoot}`);
};

const config = await readConfig();
if (targetPlatform === "windows") {
  await packageWindows(config);
  process.exit(0);
}

await rm(releaseRoot, { recursive: true, force: true });
await mkdir(releaseRoot, { recursive: true });

const appBundle = await findFirst(macosBundleRoot, (name) => name.endsWith(".app"));
if (!appBundle) {
  throw new Error("No macOS .app bundle found. Run npm run build:harness first.");
}

const appZip = path.join(releaseRoot, `${config.distribution.artifactName}-${config.project.version}-macos-app.zip`);
await runCommand("ditto", ["-c", "-k", "--norsrc", "--keepParent", appBundle, appZip], {
  env: { ...process.env, COPYFILE_DISABLE: "1" },
});

const pkgPath = path.join(releaseRoot, `${config.distribution.artifactName}-${config.project.version}.pkg`);
const pkgArgs = [
  "--component",
  appBundle,
  "--install-location",
  "/Applications",
];
if (config.distribution.macBundles.includes("pkg") && config.phase3.signingRequired && !process.env.APPLE_INSTALLER_SIGNING_IDENTITY) {
  throw new Error("APPLE_INSTALLER_SIGNING_IDENTITY is required to build signed pkg artifacts.");
}
if (process.env.APPLE_INSTALLER_SIGNING_IDENTITY) {
  pkgArgs.push("--sign", process.env.APPLE_INSTALLER_SIGNING_IDENTITY);
}
pkgArgs.push(pkgPath);
await runCommand("pkgbuild", pkgArgs);
if (config.distribution.macBundles.includes("pkg")) {
  await notarizeIfConfigured(pkgPath);
}

const dmg = await findFirst(
  dmgRoot,
  (name) => name.endsWith(".dmg") && name.includes(config.project.version),
);
const releaseDmg = path.join(releaseRoot, `${config.distribution.artifactName}-${config.project.version}.dmg`);
if (dmg) {
  await cp(dmg, releaseDmg);
} else {
  await createDmgFromAppBundle(config, appBundle, releaseDmg);
}

await copyIfExists(path.join(distRoot, "harness-bundle-manifest.json"), path.join(releaseRoot, "harness-bundle-manifest.json"));
await copyIfExists(path.join(distRoot, "checksums", "SHA256SUMS"), path.join(releaseRoot, "dist-SHA256SUMS"));
await copyIfExists(path.join(distRoot, "reports", "sbom.json"), path.join(releaseRoot, "sbom.json"));
await copyIfExists(path.join(distRoot, "reports", "licenses.md"), path.join(releaseRoot, "licenses.md"));

const assetFiles = (await listFiles(releaseRoot))
  .filter((file) => file !== "SHA256SUMS")
  .filter((file) => !file.startsWith(`validation-pack${path.sep}`))
  .sort();
const assets = [];
for (const file of assetFiles) {
  const fullPath = path.join(releaseRoot, file);
  assets.push({
    name: toPosix(file),
    sha256: await sha256File(fullPath),
  });
}

await createValidationPack(config, assets, "macos");
await createZip(path.join(releaseRoot, "validation-pack"), path.join(releaseRoot, "validation-pack.zip"));

const releaseNoteAssetFiles = (await listFiles(releaseRoot))
  .filter((file) => !["RELEASE_NOTES.md", "SHA256SUMS"].includes(file))
  .filter((file) => !file.startsWith(`validation-pack${path.sep}`))
  .sort();
const releaseNoteAssets = [];
for (const file of releaseNoteAssetFiles) {
  const fullPath = path.join(releaseRoot, file);
  releaseNoteAssets.push({
    name: toPosix(file),
    sha256: await sha256File(fullPath),
  });
}
await writeReleaseNotes(config, releaseNoteAssets, "macos");

const { finalFiles, checksumLines } = await refreshReleaseSummaryWithFinalChecksums();

await appendAudit("phase3-package", "ok", {
  platform: "macos",
  releaseRoot,
  releaseFingerprint: sha256Text(checksumLines.join("\n")),
  assetCount: finalFiles.length,
});

console.log(`Release package written to ${releaseRoot}`);
