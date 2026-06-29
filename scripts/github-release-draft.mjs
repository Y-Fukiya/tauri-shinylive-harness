#!/usr/bin/env node
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { appendAudit, exists, listFiles, readConfig, removeTree, rootDir, runCommand } from "./harness-core.mjs";

const releaseAssetSuffixes = [".zip", ".dmg", ".pkg", ".json", ".md", ".exe", ".msi", "SHA256SUMS"];

export const isCandidateReleaseAsset = (entry) => {
  const parts = entry.split(path.sep);
  if (parts.includes("validation-pack") || parts.includes("reports")) {
    return false;
  }
  if (parts.includes("docs") && parts.includes("generated")) {
    return false;
  }
  if (!releaseAssetSuffixes.some((suffix) => entry.endsWith(suffix) || entry === suffix)) {
    return false;
  }

  const releaseIndex = parts.indexOf("release");
  if (releaseIndex >= 0) {
    return releaseIndex < parts.length - 1;
  }
  return parts.length === 1;
};

export const selectCandidateReleaseAssets = (releaseFiles, releaseRoot) =>
  releaseFiles
    .filter(isCandidateReleaseAsset)
    .map((entry) => path.join(releaseRoot, entry));

const readIfExists = async (targetPath) => ((await exists(targetPath)) ? readFile(targetPath, "utf8") : null);

const releaseRelative = (releaseRoot, targetPath) => path.relative(releaseRoot, targetPath).split(path.sep).join("/");

const createCombinedReleaseNotes = async ({ config, releaseRoot, releaseFiles, candidateAssets }) => {
  const notesFiles = releaseFiles
    .filter((entry) => path.basename(entry) === "RELEASE_NOTES.md")
    .map((entry) => path.join(releaseRoot, entry))
    .sort();
  const summaryFiles = releaseFiles
    .filter((entry) => path.basename(entry) === "release-summary.json")
    .map((entry) => path.join(releaseRoot, entry))
    .sort();
  const checksumFiles = releaseFiles
    .filter((entry) => path.basename(entry) === "SHA256SUMS")
    .map((entry) => path.join(releaseRoot, entry))
    .sort();
  const validationPacks = releaseFiles
    .filter((entry) => entry.endsWith("validation-pack.zip"))
    .sort();

  const summaries = [];
  for (const summaryFile of summaryFiles) {
    const text = await readIfExists(summaryFile);
    if (!text) {
      continue;
    }
    try {
      summaries.push({ path: releaseRelative(releaseRoot, summaryFile), data: JSON.parse(text) });
    } catch {
      summaries.push({ path: releaseRelative(releaseRoot, summaryFile), data: null });
    }
  }

  const platformLines = summaries.length > 0
    ? summaries.map(({ path: summaryPath, data }) =>
      `- ${data?.platform ?? "unknown"}: ${summaryPath} (${data?.project ?? config.project.name} ${data?.version ?? config.project.version})`)
    : ["- Platform summaries were not available in downloaded artifacts."];

  const assetLines = candidateAssets
    .map((asset) => `- ${releaseRelative(releaseRoot, asset)}`)
    .sort();

  const notesSections = [];
  for (const notesFile of notesFiles) {
    notesSections.push(`## ${releaseRelative(releaseRoot, notesFile)}\n\n${await readFile(notesFile, "utf8")}`);
  }

  const combined = [
    `# ${config.project.bundleName} ${config.project.version}`,
    "",
    "## Intended Use",
    "",
    "Synthetic clinical review and education desktop harness for controlled offline-oriented demos, with integrity checks, PHI/PII guardrails, CDISC handoff preflight, and release evidence artifacts.",
    "",
    "## Limitations",
    "",
    "This harness and bundled demo applications are for technical evaluation, workflow prototyping, training, and synthetic-data demonstration only. They are not validated medical devices, are not clinical decision support tools, and must not be used for diagnosis, treatment, patient management, PHI/PII processing, Part 11 electronic records or signatures, GxP production use, or regulatory submission unless separately validated and approved by the responsible organization.",
    "",
    "## Platforms",
    "",
    ...platformLines,
    "",
    "## Release Assets",
    "",
    ...assetLines,
    "",
    "## Validation Packs",
    "",
    ...(validationPacks.length > 0 ? validationPacks.map((entry) => `- ${entry}`) : ["- No validation-pack.zip artifact found."]),
    "",
    "## Checksums",
    "",
    ...(checksumFiles.length > 0 ? checksumFiles.map((entry) => `- ${entry}`) : ["- No SHA256SUMS manifest found."]),
    "",
    ...notesSections,
    "",
  ].join("\n");

  const combinedPath = path.join(releaseRoot, "RELEASE_NOTES_COMBINED.md");
  await writeFile(combinedPath, combined);
  return combinedPath;
};

const runCli = async () => {
  const options = new Set(process.argv.slice(2));
  const config = await readConfig();
  const releaseRoot = path.join(rootDir, "release");
  const tag = process.env.RELEASE_TAG || `v${config.project.version}`;
  const repo = process.env.GITHUB_REPOSITORY || config.distribution.githubRepo;

  if (!repo) {
    throw new Error("Missing GitHub repo. Set distribution.github_repo in harness.toml or GITHUB_REPOSITORY.");
  }
  if (!(await exists(releaseRoot))) {
    throw new Error("Missing release/ directory. Run npm run phase3:package first.");
  }

  const uploadRoot = path.join(rootDir, ".release-upload");
  await removeTree(uploadRoot);
  await mkdir(uploadRoot, { recursive: true });

  const releaseFiles = (await listFiles(releaseRoot)).sort();
  const candidateAssets = selectCandidateReleaseAssets(releaseFiles, releaseRoot);

  if (candidateAssets.length === 0) {
    throw new Error("No release assets found.");
  }

  const seen = new Set();
  const assets = [];
  for (const asset of candidateAssets) {
    const relative = path.relative(releaseRoot, asset);
    let uploadName = path.basename(asset);
    if (seen.has(uploadName)) {
      uploadName = relative.split(path.sep).join("-");
    }
    seen.add(uploadName);
    const uploadPath = path.join(uploadRoot, uploadName);
    await cp(asset, uploadPath, { force: true });
    assets.push(uploadPath);
  }

  const notesFile = await createCombinedReleaseNotes({ config, releaseRoot, releaseFiles, candidateAssets });

  const args = [
    "release",
    "create",
    tag,
    ...assets,
    "--repo",
    repo,
    "--title",
    `${config.project.bundleName} ${config.project.version}`,
    "--notes-file",
    notesFile,
  ];

  if (!options.has("--publish")) {
    args.push("--draft", "--prerelease");
  }
  if (options.has("--verify-tag")) {
    args.push("--verify-tag");
  }

  await runCommand("gh", args);
  await appendAudit("github-release-draft", "ok", {
    repo,
    tag,
    draft: !options.has("--publish"),
    assetCount: assets.length,
  });
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
