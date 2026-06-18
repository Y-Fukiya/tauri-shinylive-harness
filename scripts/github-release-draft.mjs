#!/usr/bin/env node
import { readdir } from "node:fs/promises";
import path from "node:path";

import { appendAudit, exists, readConfig, rootDir, runCommand } from "./harness-core.mjs";

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

const entries = await readdir(releaseRoot);
const assets = entries
  .filter((entry) =>
    [".zip", ".dmg", ".json", ".md", "SHA256SUMS"].some((suffix) => entry.endsWith(suffix) || entry === suffix),
  )
  .filter((entry) => entry !== "validation-pack")
  .map((entry) => path.join("release", entry));

if (assets.length === 0) {
  throw new Error("No release assets found.");
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
  path.join("release", "RELEASE_NOTES.md"),
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
