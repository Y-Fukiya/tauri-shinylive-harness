#!/usr/bin/env node
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { appendAudit, exists, listFiles, readConfig, rootDir, runCommand } from "./harness-core.mjs";

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
await rm(uploadRoot, { recursive: true, force: true });
await mkdir(uploadRoot, { recursive: true });

const releaseFiles = (await listFiles(releaseRoot)).sort();
const candidateAssets = releaseFiles
  .filter((entry) => !entry.split(path.sep).includes("validation-pack"))
  .filter((entry) =>
    [".zip", ".dmg", ".pkg", ".json", ".md", ".exe", ".msi", "SHA256SUMS"].some(
      (suffix) => entry.endsWith(suffix) || entry === suffix,
    ),
  )
  .map((entry) => path.join(releaseRoot, entry));

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

const notesFile =
  (await exists(path.join(releaseRoot, "RELEASE_NOTES.md")))
    ? path.join(releaseRoot, "RELEASE_NOTES.md")
    : candidateAssets.find((asset) => path.basename(asset) === "RELEASE_NOTES.md");
if (!notesFile) {
  throw new Error("Missing RELEASE_NOTES.md in release artifacts.");
}

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
