#!/usr/bin/env node
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

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

const writeReleaseNotes = async (config, assets) => {
  const staticReportPath = path.join(reportsRoot, "static-verification.json");
  const e2eReportPath = path.join(reportsRoot, "e2e-diagnostics.json");
  const staticReport = (await exists(staticReportPath))
    ? JSON.parse(await readFile(staticReportPath, "utf8"))
    : null;
  const e2eReport = (await exists(e2eReportPath))
    ? JSON.parse(await readFile(e2eReportPath, "utf8"))
    : null;

  const notes = [
    `# ${config.project.bundleName} ${config.project.version}`,
    "",
    `Channel: ${config.distribution.releaseChannel}`,
    "",
    "## Verification",
    "",
    `- Static verification: ${staticReport?.ok ?? "not available"}`,
    `- E2E verification: ${e2eReport?.ok ?? "not available"}`,
    `- External HTTP(S) requests observed: ${e2eReport?.externalRequests?.length ?? "not available"}`,
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

const createValidationPack = async (config, assets) => {
  const validationRoot = path.join(releaseRoot, "validation-pack");
  const evidenceRoot = path.join(validationRoot, "evidence");
  await mkdir(evidenceRoot, { recursive: true });

  await copyIfExists(path.join(reportsRoot, "static-verification.json"), path.join(evidenceRoot, "static-verification.json"));
  await copyIfExists(path.join(reportsRoot, "e2e-diagnostics.json"), path.join(evidenceRoot, "e2e-diagnostics.json"));
  await copyIfExists(path.join(reportsRoot, "phase3-preflight.json"), path.join(evidenceRoot, "phase3-preflight.json"));
  await copyIfExists(path.join(distRoot, "harness-bundle-manifest.json"), path.join(evidenceRoot, "harness-bundle-manifest.json"));
  await copyIfExists(path.join(distRoot, "checksums", "SHA256SUMS"), path.join(evidenceRoot, "dist-SHA256SUMS"));
  await copyIfExists(path.join(distRoot, "reports", "sbom.json"), path.join(evidenceRoot, "sbom.json"));
  await copyIfExists(path.join(distRoot, "reports", "licenses.md"), path.join(evidenceRoot, "licenses.md"));
  await copyIfExists(path.join(rootDir, "docs", "generated", "verification-procedure.md"), path.join(evidenceRoot, "verification-procedure.md"));
  await copyIfExists(path.join(rootDir, "docs", "generated", "phase3-readiness.md"), path.join(evidenceRoot, "phase3-readiness.md"));
  await copyIfExists(path.join(rootDir, "docs", "phase3-distribution.md"), path.join(evidenceRoot, "phase3-distribution.md"));
  await copyIfExists(path.join(rootDir, "docs", "validation-approval-template.md"), path.join(evidenceRoot, "validation-approval-template.md"));

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
      "",
      "## Scope",
      "",
      "This pack contains automated Phase 2/3 readiness evidence for the local-first Shinylive desktop harness. It is not a substitute for organization-specific clinical validation approval.",
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

const dmg = await findFirst(dmgRoot, (name) => name.endsWith(".dmg"));
if (dmg) {
  await cp(dmg, path.join(releaseRoot, `${config.distribution.artifactName}-${config.project.version}.dmg`));
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
