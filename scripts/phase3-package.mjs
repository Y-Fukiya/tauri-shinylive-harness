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

const releaseRoot = path.join(rootDir, "release");
const macosBundleRoot = path.join(rootDir, "src-tauri", "target", "release", "bundle", "macos");
const dmgRoot = path.join(rootDir, "src-tauri", "target", "release", "bundle", "dmg");
const execFileAsync = promisify(execFile);

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

const sha256Text = (value) => createHash("sha256").update(value).digest("hex");

const gitValue = async (args) => {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd: rootDir });
    return stdout.trim() || "not available";
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

const writeReleaseNotes = async (config, assets) => {
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
    `Channel: ${config.distribution.releaseChannel}`,
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
    "Developer ID signing and notarization require Apple credentials. If this release was built without those credentials, treat it as an internal unsigned release candidate.",
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

const createValidationPack = async (config, assets) => {
  const validationRoot = path.join(releaseRoot, "validation-pack");
  const evidenceRoot = path.join(validationRoot, "evidence");
  const context = await releaseContext(config);
  await mkdir(evidenceRoot, { recursive: true });

  await copyIfExists(path.join(reportsRoot, "harness-config-validation.json"), path.join(evidenceRoot, "harness-config-validation.json"));
  await copyIfExists(path.join(reportsRoot, "static-verification.json"), path.join(evidenceRoot, "static-verification.json"));
  await copyIfExists(path.join(reportsRoot, "bundle-integrity.json"), path.join(evidenceRoot, "bundle-integrity.json"));
  await copyIfExists(path.join(reportsRoot, "e2e-diagnostics.json"), path.join(evidenceRoot, "e2e-diagnostics.json"));
  await copyIfExists(path.join(reportsRoot, "clinical-data-pack-validation.json"), path.join(evidenceRoot, "clinical-data-pack-validation.json"));
  await copyIfExists(path.join(reportsRoot, "screenshots"), path.join(evidenceRoot, "screenshots"));
  await copyIfExists(path.join(reportsRoot, "phase3-preflight.json"), path.join(evidenceRoot, "phase3-preflight.json"));
  await copyIfExists(path.join(distRoot, "manifest.json"), path.join(evidenceRoot, "portal-manifest.json"));
  await copyIfExists(path.join(distRoot, "harness-bundle-manifest.json"), path.join(evidenceRoot, "harness-bundle-manifest.json"));
  await copyIfExists(path.join(distRoot, "checksums", "SHA256SUMS"), path.join(evidenceRoot, "dist-SHA256SUMS"));
  await copyIfExists(path.join(distRoot, "reports", "sbom.json"), path.join(evidenceRoot, "sbom.json"));
  await copyIfExists(path.join(distRoot, "reports", "licenses.md"), path.join(evidenceRoot, "licenses.md"));
  await copyIfExists(path.join(rootDir, "docs", "generated", "clinical-data-dictionary.md"), path.join(evidenceRoot, "clinical-data-dictionary.md"));
  await copyIfExists(path.join(rootDir, "docs", "generated", "verification-procedure.md"), path.join(evidenceRoot, "verification-procedure.md"));
  await copyIfExists(path.join(rootDir, "docs", "generated", "phase3-readiness.md"), path.join(evidenceRoot, "phase3-readiness.md"));
  await copyIfExists(path.join(rootDir, "docs", "phase3-distribution.md"), path.join(evidenceRoot, "phase3-distribution.md"));
  await copyIfExists(path.join(rootDir, "docs", "validation-approval-template.md"), path.join(evidenceRoot, "validation-approval-template.md"));
  await copyIfExists(path.join(rootDir, "docs", "manual-clean-macos-checklist.md"), path.join(validationRoot, "manual-clean-macos-checklist.md"));

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
      `Environment: ${context.platform} on ${context.host}`,
      "",
      "## Scope",
      "",
      "This pack contains automated Phase 2/3 readiness evidence for the local-first Shinylive desktop harness. It is not a substitute for organization-specific clinical validation approval.",
      "",
      "## Automated Checks",
      "",
      "- Harness configuration validation",
      "- Static bundle hash verification",
      "- Runtime bundle integrity endpoint verification",
      "- Playwright portal/app verification with external HTTP(S) request audit",
      "- Clinical data pack validation with data dictionary",
      "- Screenshot evidence for the portal and verified apps",
      "- Release asset checksum inventory",
      "- Manual clean macOS checklist included",
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

const config = await readConfig();
await rm(releaseRoot, { recursive: true, force: true });
await mkdir(releaseRoot, { recursive: true });

const appBundle = await findFirst(macosBundleRoot, (name) => name.endsWith(".app"));
if (!appBundle) {
  throw new Error("No macOS .app bundle found. Run npm run build:harness first.");
}

const appZip = path.join(releaseRoot, `${config.distribution.artifactName}-${config.project.version}-macos-app.zip`);
await runCommand("ditto", ["-c", "-k", "--keepParent", appBundle, appZip]);

const pkgPath = path.join(releaseRoot, `${config.distribution.artifactName}-${config.project.version}.pkg`);
const pkgArgs = [
  "--component",
  appBundle,
  "--install-location",
  "/Applications",
];
if (process.env.APPLE_INSTALLER_SIGNING_IDENTITY) {
  pkgArgs.push("--sign", process.env.APPLE_INSTALLER_SIGNING_IDENTITY);
}
pkgArgs.push(pkgPath);
await runCommand("pkgbuild", pkgArgs);

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

await createValidationPack(config, assets);
await runCommand("ditto", [
  "-c",
  "-k",
  "--keepParent",
  path.join(releaseRoot, "validation-pack"),
  path.join(releaseRoot, "validation-pack.zip"),
]);

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
await writeReleaseNotes(config, releaseNoteAssets);

const finalFiles = (await listFiles(releaseRoot))
  .filter((file) => file !== "SHA256SUMS")
  .sort();
const checksumLines = [];
for (const file of finalFiles) {
  checksumLines.push(`${await sha256File(path.join(releaseRoot, file))}  ${toPosix(file)}`);
}
await writeFile(path.join(releaseRoot, "SHA256SUMS"), `${checksumLines.join("\n")}\n`);

await appendAudit("phase3-package", "ok", {
  releaseRoot,
  releaseFingerprint: sha256Text(checksumLines.join("\n")),
  assetCount: finalFiles.length,
});

console.log(`Release package written to ${releaseRoot}`);
