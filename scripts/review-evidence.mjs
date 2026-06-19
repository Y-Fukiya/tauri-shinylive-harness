#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { appendAudit, exists, readConfig, reportsRoot, rootDir, sha256File, toPosix, writeJson } from "./harness-core.mjs";

const defaultSignoffPath = path.join(reportsRoot, "review-signoff.json");
const defaultHistoryPath = path.join(reportsRoot, "review-signoff-history.jsonl");
const defaultEvidenceJsonPath = path.join(reportsRoot, "evidence-index.json");
const defaultEvidenceHtmlPath = path.join(reportsRoot, "evidence-index.html");
const defaultEvidenceMarkdownPath = path.join(rootDir, "docs", "generated", "evidence-index.md");
const clinicalUseLimitation =
  "Synthetic demo and technical evaluation only. Not for clinical decision making.";

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

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const repoRelative = (targetPath) => {
  if (!targetPath) {
    return null;
  }
  const resolved = path.resolve(targetPath);
  const root = path.resolve(rootDir);
  return resolved.startsWith(root) ? toPosix(path.relative(rootDir, resolved)) : resolved;
};

const defaultReviewer = () => process.env.HARNESS_REVIEWER || "";

const signoffId = (record) =>
  createHash("sha256")
    .update(`${record.createdAt}\0${record.status}\0${record.reviewer}\0${record.decision}\0${record.notes}`)
    .digest("hex")
    .slice(0, 16);

const readJsonIfExists = async (targetPath) => {
  if (!(await exists(targetPath))) {
    return null;
  }
  return JSON.parse(await readFile(targetPath, "utf8"));
};

const readHistory = async (historyPath) => {
  if (!(await exists(historyPath))) {
    return [];
  }
  const text = await readFile(historyPath, "utf8");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
};

export const writeReviewSignoff = async ({
  status = "pending-review",
  reviewer = defaultReviewer(),
  role = "",
  decision = "not-reviewed",
  notes = "",
  releaseTag = process.env.RELEASE_TAG ?? "",
  reportPath = defaultSignoffPath,
  historyPath = defaultHistoryPath,
  appendHistory = true,
  force = true,
} = {}) => {
  const existing = await readJsonIfExists(reportPath);
  if (existing && !force) {
    return existing;
  }

  const createdAt = new Date().toISOString();
  const current = {
    schemaVersion: 1,
    id: "",
    createdAt,
    status,
    reviewer,
    role,
    reviewedAt: status === "pending-review" ? "" : createdAt,
    decision,
    notes,
    releaseTag,
    clinicalUseLimitation,
    requiredEvidence: [
      "reports/report-export-manifest.json",
      "reports/pdf-report-export-manifest.json",
      "reports/cdisc-bridge-preflight.json",
      "reports/clinical-data-pack-validation.json",
      "reports/evidence-index.html",
      "release/validation-pack/evidence-index.json",
    ],
  };
  current.id = signoffId(current);
  const history = appendHistory ? [...(await readHistory(historyPath)), current] : await readHistory(historyPath);
  const result = {
    schemaVersion: 1,
    generatedAt: createdAt,
    current,
    historyCount: history.length,
    history: history.slice(-25),
  };

  await writeJson(reportPath, result);
  await mkdir(path.dirname(historyPath), { recursive: true });
  if (appendHistory) {
    await appendFile(historyPath, `${JSON.stringify(current)}\n`);
  } else if (!(await exists(historyPath))) {
    await writeFile(historyPath, "");
  }
  await appendAudit("review-signoff", "ok", {
    status,
    decision,
    reviewer: reviewer ? "set" : "empty",
    report: repoRelative(reportPath),
  });
  return result;
};

const defaultEvidenceSources = () => [
  { id: "harness-config", label: "Harness config validation", category: "validation", path: path.join(reportsRoot, "harness-config-validation.json"), required: true },
  { id: "clinical-data", label: "Clinical data pack validation", category: "validation", path: path.join(reportsRoot, "clinical-data-pack-validation.json"), required: true },
  { id: "clinical-dictionary", label: "Clinical data dictionary", category: "validation", path: path.join(rootDir, "docs", "generated", "clinical-data-dictionary.md"), required: true },
  { id: "cdisc-preflight", label: "CDISC bridge preflight", category: "clinical-bridge", path: path.join(reportsRoot, "cdisc-bridge-preflight.json"), required: true },
  { id: "report-manifest", label: "HTML report export manifest", category: "reports", path: path.join(reportsRoot, "report-export-manifest.json"), required: true },
  { id: "pdf-report-manifest", label: "PDF companion report manifest", category: "reports", path: path.join(reportsRoot, "pdf-report-export-manifest.json"), required: true },
  { id: "review-workflow", label: "Report review workflow", category: "review", path: path.join(reportsRoot, "review-workflow.json"), required: true },
  { id: "review-signoff", label: "Review sign-off state", category: "review", path: defaultSignoffPath, required: true },
  { id: "review-signoff-history", label: "Review sign-off history", category: "review", path: defaultHistoryPath, required: true },
  { id: "tauri-security", label: "Tauri security hardening audit", category: "security", path: path.join(reportsRoot, "tauri-security-audit.json"), required: true },
  { id: "reproducibility", label: "Reproducibility report", category: "release", path: path.join(reportsRoot, "reproducibility.json"), required: true },
  { id: "bundle-integrity", label: "Bundle integrity report", category: "release", path: path.join(reportsRoot, "bundle-integrity.json"), required: true },
  { id: "static-verification", label: "Static verification report", category: "release", path: path.join(reportsRoot, "static-verification.json"), required: true },
  { id: "e2e-diagnostics", label: "E2E diagnostics", category: "release", path: path.join(reportsRoot, "e2e-diagnostics.json"), required: true },
  { id: "phase3-preflight", label: "Phase 3 credential preflight", category: "release", path: path.join(reportsRoot, "phase3-preflight.json"), required: false },
  { id: "release-verification", label: "Release artifact verification", category: "release", path: path.join(reportsRoot, "release-artifact-verification.json"), required: false },
];

const evidenceRow = async (source) => {
  const present = await exists(source.path);
  if (!present) {
    return {
      ...source,
      path: repoRelative(source.path),
      present,
      size: null,
      sha256: null,
    };
  }
  const metadata = await stat(source.path);
  return {
    ...source,
    path: repoRelative(source.path),
    present,
    size: metadata.size,
    sha256: metadata.isFile() ? await sha256File(source.path) : null,
  };
};

const renderHtml = (result) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Validation Evidence Index</title>
  <style>
    body { color: #17212b; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 28px; }
    main { margin: 0 auto; max-width: 1160px; }
    h1 { font-size: 30px; margin: 0 0 8px; }
    h2 { font-size: 20px; margin: 26px 0 10px; }
    p { color: #526b79; margin: 0 0 10px; }
    .warning { background: #fff7ed; border: 1px solid #f0c997; border-radius: 8px; color: #77420f; font-weight: 800; margin: 16px 0; padding: 12px; }
    .summary { display: grid; gap: 10px; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 18px 0; }
    .metric { border: 1px solid #d7dee3; border-radius: 8px; padding: 12px; }
    .metric span { color: #526b79; display: block; font-size: 12px; font-weight: 800; text-transform: uppercase; }
    .metric strong { display: block; font-size: 22px; margin-top: 4px; }
    table { border-collapse: collapse; font-size: 13px; width: 100%; }
    th, td { border-bottom: 1px solid #e7edf1; padding: 8px 9px; text-align: left; vertical-align: top; }
    th { background: #f7fafb; color: #405968; font-size: 12px; text-transform: uppercase; }
    code { overflow-wrap: anywhere; }
    @media (max-width: 860px) { body { padding: 14px; } .summary { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
<main>
  <h1>Validation Evidence Index</h1>
  <p>Generated: ${escapeHtml(result.generatedAt)}</p>
  <p>Project: ${escapeHtml(result.project.name)} ${escapeHtml(result.project.version)}</p>
  <div class="warning">${escapeHtml(clinicalUseLimitation)}</div>
  <section class="summary">
    <div class="metric"><span>Status</span><strong>${result.ok ? "OK" : "Incomplete"}</strong></div>
    <div class="metric"><span>Required</span><strong>${result.summary.presentRequiredCount}/${result.summary.requiredCount}</strong></div>
    <div class="metric"><span>Evidence</span><strong>${result.summary.presentCount}/${result.summary.totalCount}</strong></div>
    <div class="metric"><span>Sign-off</span><strong>${escapeHtml(result.signoff?.current?.status ?? "n/a")}</strong></div>
  </section>
  <h2>Reviewer Sign-Off</h2>
  <table>
    <tbody>
      <tr><th>Reviewer</th><td>${escapeHtml(result.signoff?.current?.reviewer ?? "")}</td></tr>
      <tr><th>Role</th><td>${escapeHtml(result.signoff?.current?.role ?? "")}</td></tr>
      <tr><th>Decision</th><td>${escapeHtml(result.signoff?.current?.decision ?? "")}</td></tr>
      <tr><th>Reviewed At</th><td>${escapeHtml(result.signoff?.current?.reviewedAt ?? "")}</td></tr>
      <tr><th>Notes</th><td>${escapeHtml(result.signoff?.current?.notes ?? "")}</td></tr>
    </tbody>
  </table>
  <h2>Evidence Files</h2>
  <table>
    <thead><tr><th>Category</th><th>Evidence</th><th>Required</th><th>Present</th><th>Path</th><th>SHA-256</th></tr></thead>
    <tbody>
      ${result.evidence
        .map(
          (item) =>
            `<tr><td>${escapeHtml(item.category)}</td><td>${escapeHtml(item.label)}</td><td>${item.required ? "yes" : "no"}</td><td>${item.present ? "yes" : "no"}</td><td><code>${escapeHtml(item.path)}</code></td><td><code>${escapeHtml(item.sha256 ?? "")}</code></td></tr>`,
        )
        .join("")}
    </tbody>
  </table>
</main>
</body>
</html>`;

const renderMarkdown = (result) => [
  "# Validation Evidence Index",
  "",
  `Generated: ${result.generatedAt}`,
  `Project: ${result.project.name} ${result.project.version}`,
  `Status: ${result.ok ? "OK" : "Incomplete"}`,
  "",
  clinicalUseLimitation,
  "",
  "## Reviewer Sign-Off",
  "",
  "| Field | Value |",
  "| --- | --- |",
  `| Status | ${result.signoff?.current?.status ?? ""} |`,
  `| Reviewer | ${result.signoff?.current?.reviewer ?? ""} |`,
  `| Role | ${result.signoff?.current?.role ?? ""} |`,
  `| Decision | ${result.signoff?.current?.decision ?? ""} |`,
  `| Reviewed at | ${result.signoff?.current?.reviewedAt ?? ""} |`,
  `| Notes | ${result.signoff?.current?.notes ?? ""} |`,
  "",
  "## Evidence Files",
  "",
  "| Category | Evidence | Required | Present | Path | SHA-256 |",
  "| --- | --- | --- | --- | --- | --- |",
  ...result.evidence.map(
    (item) =>
      `| ${item.category} | ${item.label} | ${item.required ? "yes" : "no"} | ${item.present ? "yes" : "no"} | ${item.path} | ${item.sha256 ?? ""} |`,
  ),
  "",
].join("\n");

export const generateEvidenceIndex = async ({
  jsonPath = defaultEvidenceJsonPath,
  htmlPath = defaultEvidenceHtmlPath,
  markdownPath = defaultEvidenceMarkdownPath,
  signoffPath = defaultSignoffPath,
  sources = defaultEvidenceSources(),
} = {}) => {
  const generatedAt = new Date().toISOString();
  const config = await readConfig();
  const evidence = [];
  for (const source of sources) {
    evidence.push(await evidenceRow(source));
  }
  const signoff = await readJsonIfExists(signoffPath);
  const required = evidence.filter((item) => item.required);
  const missingRequired = required.filter((item) => !item.present);
  const result = {
    schemaVersion: 1,
    ok: missingRequired.length === 0,
    generatedAt,
    project: config.project,
    clinicalUseLimitation,
    signoff,
    summary: {
      totalCount: evidence.length,
      presentCount: evidence.filter((item) => item.present).length,
      requiredCount: required.length,
      presentRequiredCount: required.length - missingRequired.length,
      missingRequiredCount: missingRequired.length,
    },
    evidence,
    missingRequired: missingRequired.map((item) => item.id),
  };

  await writeJson(jsonPath, result);
  await mkdir(path.dirname(htmlPath), { recursive: true });
  await writeFile(htmlPath, renderHtml(result));
  await mkdir(path.dirname(markdownPath), { recursive: true });
  await writeFile(markdownPath, `${renderMarkdown(result)}\n`);
  await appendAudit("evidence-index", result.ok ? "ok" : "incomplete", {
    report: repoRelative(jsonPath),
    missingRequired: result.summary.missingRequiredCount,
  });

  return result;
};

const runCli = async () => {
  const command = process.argv[2] ?? "index";
  const options = parseOptions(process.argv.slice(3));
  if (command === "signoff") {
    const result = await writeReviewSignoff({
      status: options.status === true ? "pending-review" : options.status ?? "pending-review",
      reviewer: options.reviewer === true ? defaultReviewer() : options.reviewer ?? defaultReviewer(),
      role: options.role === true ? "" : options.role ?? "",
      decision: options.decision === true ? "not-reviewed" : options.decision ?? "not-reviewed",
      notes: options.notes === true ? "" : options.notes ?? "",
      releaseTag: options["release-tag"] === true ? "" : options["release-tag"] ?? process.env.RELEASE_TAG ?? "",
      appendHistory: !options["no-history"],
      force: true,
    });
    console.log(JSON.stringify({ ok: true, report: repoRelative(defaultSignoffPath), status: result.current.status }, null, 2));
    return;
  }
  if (command !== "index") {
    throw new Error("Usage: node scripts/review-evidence.mjs signoff|index");
  }
  const result = await generateEvidenceIndex();
  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        report: repoRelative(defaultEvidenceJsonPath),
        html: repoRelative(defaultEvidenceHtmlPath),
        missingRequired: result.summary.missingRequiredCount,
      },
      null,
      2,
    ),
  );
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
