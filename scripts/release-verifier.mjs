#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { exists, listFiles, reportsRoot, rootDir, sha256File, toPosix, writeJson } from "./harness-core.mjs";

export const requiredReleaseFiles = [
  "SHA256SUMS",
  "RELEASE_NOTES.md",
  "release-summary.json",
  "validation-pack.zip",
  "validation-pack/evidence-index.json",
  "validation-pack/validation-summary.md",
  "validation-pack/release-smoke-plan.json",
  "validation-pack/release-smoke-test.md",
  "validation-pack/evidence/static-verification.json",
  "validation-pack/evidence/e2e-diagnostics.json",
  "validation-pack/evidence/bundle-integrity.json",
  "validation-pack/evidence/tauri-security-audit.json",
  "validation-pack/evidence/phi-pii-scan.json",
  "validation-pack/evidence/reproducibility.json",
  "validation-pack/evidence/offline-verification.json",
  "validation-pack/evidence/harness-config-validation.json",
  "validation-pack/evidence/clinical-data-pack-validation.json",
  "validation-pack/evidence/clinical-data-dictionary.md",
  "validation-pack/evidence/cdisc-bridge-preflight.json",
  "validation-pack/evidence/pdf-report-export-manifest.json",
  "validation-pack/evidence/review-signoff.json",
  "validation-pack/evidence/review-signoff-history.jsonl",
  "validation-pack/evidence/evidence-index.html",
  "validation-pack/evidence/sbom.json",
  "validation-pack/evidence/licenses.md",
  "validation-pack/evidence/portal-manifest.json",
  "validation-pack/evidence/harness-bundle-manifest.json",
  "validation-pack/evidence/release-summary.json",
  "sbom.json",
  "licenses.md",
];

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

const issue = (severity, code, message, details = {}) => ({ severity, code, message, details });

const parseChecksums = (text) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
      if (!match) {
        return { valid: false, line };
      }
      return {
        valid: true,
        sha256: match[1].toLowerCase(),
        path: toPosix(match[2]),
      };
    });

const parseReleaseNotesHashRows = (text) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => line.match(/^\|\s*`?([^`|]+?)`?\s*\|\s*`?([a-f0-9]{64})`?\s*\|$/i))
    .filter(Boolean)
    .map((match) => ({
      path: toPosix(match[1].trim()),
      sha256: match[2].toLowerCase(),
    }))
    .filter((entry) => entry.path !== "---" && entry.path.toLowerCase() !== "asset");

const safeReleasePath = (releaseRoot, relativePath) => {
  const resolved = path.resolve(releaseRoot, relativePath);
  const root = path.resolve(releaseRoot);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Release checksum path escapes release root: ${relativePath}`);
  }
  return resolved;
};

const safeChildPath = (rootDirectory, relativePath, label) => {
  const resolved = path.resolve(rootDirectory, relativePath);
  const root = path.resolve(rootDirectory);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${label} path escapes root: ${relativePath}`);
  }
  return resolved;
};

export const selfReferentialFinalChecksumEntries = new Set([
  "release-summary.json",
  "validation-pack.zip",
  "validation-pack/evidence/release-summary.json",
  "validation-pack/evidence-index.json",
]);

export const verifyReleaseArtifacts = async ({
  releaseRoot = path.join(rootDir, "release"),
  reportPath = path.join(reportsRoot, "release-artifact-verification.json"),
  writeReport = true,
} = {}) => {
  const checkedAt = new Date().toISOString();
  const issues = [];
  const files = [];
  const resolvedReleaseRoot = path.resolve(releaseRoot);

  if (!(await exists(resolvedReleaseRoot))) {
    issues.push(issue("error", "missing-release-root", "Release directory does not exist.", { releaseRoot }));
  }

  for (const requiredFile of requiredReleaseFiles) {
    const targetPath = path.join(resolvedReleaseRoot, requiredFile);
    if (!(await exists(targetPath))) {
      issues.push(issue("error", "missing-required-release-file", "Required release evidence file is missing.", { path: requiredFile }));
      continue;
    }
    const metadata = await stat(targetPath);
    files.push({
      path: requiredFile,
      size: metadata.size,
      sha256: metadata.isFile() ? await sha256File(targetPath) : null,
    });
  }

  const checksumPath = path.join(resolvedReleaseRoot, "SHA256SUMS");
  const checksumEntries = (await exists(checksumPath)) ? parseChecksums(await readFile(checksumPath, "utf8")) : [];
  const validChecksumPaths = new Set(checksumEntries.filter((entry) => entry.valid).map((entry) => entry.path));
  for (const entry of checksumEntries) {
    if (!entry.valid) {
      issues.push(issue("error", "invalid-checksum-line", "SHA256SUMS contains an invalid line.", { line: entry.line }));
      continue;
    }
    let targetPath;
    try {
      targetPath = safeReleasePath(resolvedReleaseRoot, entry.path);
    } catch (error) {
      issues.push(issue("error", "checksum-path-escape", error instanceof Error ? error.message : String(error), { path: entry.path }));
      continue;
    }
    if (!(await exists(targetPath))) {
      issues.push(issue("error", "checksum-target-missing", "SHA256SUMS references a missing file.", { path: entry.path }));
      continue;
    }
    const actual = await sha256File(targetPath);
    if (actual !== entry.sha256) {
      issues.push(issue("error", "checksum-mismatch", "SHA256SUMS hash does not match the release file.", { path: entry.path, expected: entry.sha256, actual }));
    }
  }

  if (await exists(resolvedReleaseRoot)) {
    const actualReleaseFiles = (await listFiles(resolvedReleaseRoot))
      .map(toPosix)
      .filter((file) => file !== "SHA256SUMS")
      .sort();
    for (const file of actualReleaseFiles) {
      if (!validChecksumPaths.has(file)) {
        issues.push(issue("error", "release-file-missing-checksum", "Release file is not listed in SHA256SUMS.", { path: file }));
      }
    }
  }

  const releaseNotesPath = path.join(resolvedReleaseRoot, "RELEASE_NOTES.md");
  if (await exists(releaseNotesPath)) {
    const releaseNoteHashRows = parseReleaseNotesHashRows(await readFile(releaseNotesPath, "utf8"));
    for (const row of releaseNoteHashRows) {
      let targetPath;
      try {
        targetPath = safeReleasePath(resolvedReleaseRoot, row.path);
      } catch (error) {
        issues.push(issue("error", "release-notes-hash-table-path-escape", error instanceof Error ? error.message : String(error), { path: row.path }));
        continue;
      }
      if (!(await exists(targetPath))) {
        issues.push(issue("error", "release-notes-hash-table-target-missing", "RELEASE_NOTES.md SHA-256 table references a missing release file.", { path: row.path }));
        continue;
      }
      const actual = await sha256File(targetPath);
      if (actual !== row.sha256) {
        issues.push(issue("error", "release-notes-hash-table-mismatch", "RELEASE_NOTES.md SHA-256 table does not match the final release file.", { path: row.path, expected: row.sha256, actual }));
      }
    }
  }

  const releaseSummaryPath = path.join(resolvedReleaseRoot, "release-summary.json");
  let releaseSummary = null;
  if (await exists(releaseSummaryPath)) {
    try {
      releaseSummary = JSON.parse(await readFile(releaseSummaryPath, "utf8"));
      if (releaseSummary.finalReleaseChecksums !== undefined) {
        if (!Array.isArray(releaseSummary.finalReleaseChecksums)) {
          issues.push(issue("error", "release-summary-final-checksum-list", "release-summary.json finalReleaseChecksums must be an array."));
        } else {
          for (const entry of releaseSummary.finalReleaseChecksums) {
            if (!entry || typeof entry.path !== "string" || typeof entry.sha256 !== "string") {
              issues.push(issue("error", "release-summary-final-checksum-entry", "release-summary.json finalReleaseChecksums entries must include path and sha256.", { entry }));
              continue;
            }
            const entryPath = toPosix(entry.path);
            if (selfReferentialFinalChecksumEntries.has(entryPath)) {
              issues.push(issue("error", "release-summary-final-checksum-self-referential-entry", "release-summary.json finalReleaseChecksums must not include self-referential release evidence.", { path: entryPath }));
              continue;
            }
            let targetPath;
            try {
              targetPath = safeReleasePath(resolvedReleaseRoot, entryPath);
            } catch (error) {
              issues.push(issue("error", "release-summary-final-checksum-path-escape", error instanceof Error ? error.message : String(error), { path: entryPath }));
              continue;
            }
            if (!(await exists(targetPath))) {
              issues.push(issue("error", "release-summary-final-checksum-target-missing", "release-summary.json finalReleaseChecksums references a missing release file.", { path: entryPath }));
              continue;
            }
            const actual = await sha256File(targetPath);
            if (actual !== entry.sha256.toLowerCase()) {
              issues.push(issue("error", "release-summary-final-checksum-mismatch", "release-summary.json finalReleaseChecksums hash does not match the release file.", { path: entryPath, expected: entry.sha256.toLowerCase(), actual }));
            }
          }
        }
      }
    } catch (error) {
      issues.push(issue("error", "release-summary-json", "release-summary.json is not valid JSON.", {
        message: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  const validationRoot = path.join(resolvedReleaseRoot, "validation-pack");
  const evidenceIndexPath = path.join(validationRoot, "evidence-index.json");
  let validationPackEvidenceIndex = null;
  if (await exists(evidenceIndexPath)) {
    try {
      validationPackEvidenceIndex = JSON.parse(await readFile(evidenceIndexPath, "utf8"));
      if (validationPackEvidenceIndex.schemaVersion !== 1) {
        issues.push(issue("error", "validation-pack-evidence-index-schema", "validation-pack/evidence-index.json must declare schemaVersion: 1."));
      }
      if (!Array.isArray(validationPackEvidenceIndex.evidence)) {
        issues.push(issue("error", "validation-pack-evidence-index-evidence", "validation-pack/evidence-index.json must include an evidence array."));
      } else {
        for (const entry of validationPackEvidenceIndex.evidence) {
          if (!entry || typeof entry.path !== "string") {
            issues.push(issue("error", "validation-pack-evidence-index-entry", "Evidence index entry must include a path.", { entry }));
            continue;
          }
          let targetPath;
          try {
            targetPath = safeChildPath(validationRoot, entry.path, "Validation pack evidence index");
          } catch (error) {
            issues.push(issue("error", "validation-pack-evidence-index-path-escape", error instanceof Error ? error.message : String(error), { path: entry.path }));
            continue;
          }
          if (!(await exists(targetPath))) {
            issues.push(issue("error", "validation-pack-evidence-index-target-missing", "validation-pack/evidence-index.json references a missing file.", { path: entry.path }));
            continue;
          }
          const metadata = await stat(targetPath);
          if (typeof entry.size === "number" && metadata.size !== entry.size) {
            issues.push(issue("error", "validation-pack-evidence-index-size-mismatch", "validation-pack/evidence-index.json size does not match the evidence file.", { path: entry.path, expected: entry.size, actual: metadata.size }));
          }
          if (typeof entry.sha256 === "string") {
            const actual = await sha256File(targetPath);
            if (actual !== entry.sha256.toLowerCase()) {
              issues.push(issue("error", "validation-pack-evidence-index-hash-mismatch", "validation-pack/evidence-index.json hash does not match the evidence file.", { path: entry.path, expected: entry.sha256.toLowerCase(), actual }));
            }
          }
        }
      }
    } catch (error) {
      issues.push(issue("error", "validation-pack-evidence-index-json", "validation-pack/evidence-index.json is not valid JSON.", {
        message: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  const smokePlanPath = path.join(resolvedReleaseRoot, "validation-pack", "release-smoke-plan.json");
  let releaseSmokePlan = null;
  if (await exists(smokePlanPath)) {
    try {
      releaseSmokePlan = JSON.parse(await readFile(smokePlanPath, "utf8"));
      if (releaseSmokePlan.schemaVersion !== 1) {
        issues.push(issue("error", "invalid-release-smoke-plan-schema", "release-smoke-plan.json must declare schemaVersion: 1."));
      }
      if (!Array.isArray(releaseSmokePlan.apps)) {
        issues.push(issue("error", "invalid-release-smoke-plan-apps", "release-smoke-plan.json must include an apps array."));
      }
    } catch (error) {
      issues.push(issue("error", "invalid-release-smoke-plan-json", "release-smoke-plan.json is not valid JSON.", {
        message: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  const errorCount = issues.filter((item) => item.severity === "error").length;
  const warningCount = issues.filter((item) => item.severity === "warning").length;
  const result = {
    schemaVersion: 1,
    ok: errorCount === 0,
    checkedAt,
    releaseRoot: toPosix(path.relative(rootDir, resolvedReleaseRoot)) || ".",
    summary: {
      errorCount,
      warningCount,
      requiredFileCount: requiredReleaseFiles.length,
      presentRequiredFileCount: files.length,
      checksumCount: checksumEntries.filter((entry) => entry.valid).length,
    },
    files,
    checksumEntries,
    releaseSummary,
    validationPackEvidenceIndex,
    releaseSmokePlan,
    issues,
  };

  if (writeReport) {
    await writeJson(reportPath, result);
  }

  return result;
};

const runCli = async () => {
  const options = parseOptions(process.argv.slice(2));
  const releaseRoot = options.release ? path.resolve(options.release) : path.join(rootDir, "release");
  const reportPath = options.report ? path.resolve(options.report) : path.join(reportsRoot, "release-artifact-verification.json");
  const result = await verifyReleaseArtifacts({ releaseRoot, reportPath });
  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        report: toPosix(path.relative(rootDir, reportPath)),
        releaseRoot: result.releaseRoot,
        errors: result.summary.errorCount,
        warnings: result.summary.warningCount,
        checksums: result.summary.checksumCount,
      },
      null,
      2,
    ),
  );
  if (!result.ok) {
    throw new Error(`Release artifact verification failed. See ${toPosix(path.relative(rootDir, reportPath))}`);
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
