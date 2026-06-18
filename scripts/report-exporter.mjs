#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  appendAudit,
  appToManifest,
  exists,
  readConfig,
  reportsRoot,
  rootDir,
  sha256File,
  toPosix,
  writeJson,
} from "./harness-core.mjs";

const clinicalUseLimitation =
  "Synthetic demo and technical evaluation only. Not for clinical decision making.";
const reportTemplatesRoot = path.join(rootDir, "templates", "reports");
const reportExportRoot = path.join(reportsRoot, "exported");

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

const parseCsvLine = (line) => {
  const values = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
};

const readCsv = async (targetPath) => {
  const text = await readFile(targetPath, "utf8");
  const rows = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map(parseCsvLine);
  const headers = rows[0] ?? [];
  return rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const slug = (value) =>
  String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "report";

const firstOrNa = (values) => {
  const value = Array.isArray(values) ? values[0] : values;
  return value === undefined || value === null || value === "" ? "n/a" : value;
};

const numeric = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const maxSeverity = (aes) => {
  const rank = new Map([
    ["Mild", 1],
    ["Moderate", 2],
    ["Severe", 3],
  ]);
  let best = "n/a";
  let bestRank = 0;
  for (const row of aes) {
    const nextRank = rank.get(row.severity) ?? 0;
    if (nextRank > bestRank) {
      best = row.severity;
      bestRank = nextRank;
    }
  }
  return best;
};

const relatedAeCount = (aes) =>
  aes.filter((row) => ["Possible", "Probable", "Related"].includes(row.related)).length;

const abnormalLabs = (labs) => labs.filter((row) => row.flag && row.flag !== "Normal");

const rowsForSubject = (rows, subjectId) => rows.filter((row) => row.subject_id === subjectId);

const table = (headers, rows) => {
  const headerHtml = headers.map((header) => `<th>${escapeHtml(header.label)}</th>`).join("");
  const rowsHtml = rows.length
    ? rows
        .map(
          (row) =>
            `<tr>${headers
              .map((header) => `<td>${escapeHtml(row[header.key] ?? "")}</td>`)
              .join("")}</tr>`,
        )
        .join("")
    : `<tr><td colspan="${headers.length}">No records</td></tr>`;
  return `<table><thead><tr>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>`;
};

const keyValueTable = (rows) =>
  table(
    [
      { key: "section", label: "Section" },
      { key: "item", label: "Item" },
      { key: "value", label: "Value" },
    ],
    rows,
  );

const kpiGrid = (items) =>
  `<div class="kpi-grid">${items
    .map(
      (item) =>
        `<div class="kpi"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></div>`,
    )
    .join("")}</div>`;

const reportShell = ({ title, subtitle, context, body }) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; --ink: #17212b; --muted: #526b79; --line: #d7dee3; --soft: #f5f7f8; --accent: #145f67; --warn-bg: #fff7ed; --warn: #77420f; }
    * { box-sizing: border-box; }
    body { background: var(--soft); color: var(--ink); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.45; margin: 0; padding: 28px; }
    main { background: #fff; border: 1px solid var(--line); border-radius: 8px; margin: 0 auto; max-width: 1120px; padding: 28px; }
    header { border-bottom: 1px solid #edf1f3; display: flex; gap: 18px; justify-content: space-between; margin-bottom: 18px; padding-bottom: 16px; }
    h1 { font-size: 30px; line-height: 1.15; margin: 4px 0 6px; }
    h2 { font-size: 20px; margin: 24px 0 10px; }
    p { margin: 0 0 10px; }
    .eyebrow { color: var(--muted); font-size: 12px; font-weight: 800; letter-spacing: 0; text-transform: uppercase; }
    .meta { color: var(--muted); font-size: 12px; font-weight: 700; min-width: 280px; text-align: right; }
    .meta div { margin-bottom: 4px; overflow-wrap: anywhere; }
    .warning { background: var(--warn-bg); border: 1px solid #f0c997; border-radius: 8px; color: var(--warn); font-size: 13px; font-weight: 800; margin: 14px 0; padding: 11px 12px; }
    .narrative { background: #f2f7f4; border: 1px solid #bfd9cb; border-radius: 8px; color: #17392d; font-weight: 700; margin: 14px 0; padding: 12px; }
    .kpi-grid { display: grid; gap: 10px; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 16px 0; }
    .kpi { background: #f7fafb; border: 1px solid var(--line); border-radius: 8px; padding: 12px; }
    .kpi span { color: var(--muted); display: block; font-size: 12px; font-weight: 800; margin-bottom: 6px; }
    .kpi strong { color: #101820; display: block; font-size: 20px; line-height: 1.15; overflow-wrap: anywhere; }
    table { border-collapse: collapse; font-size: 13px; margin: 10px 0 18px; width: 100%; }
    th, td { border-bottom: 1px solid #edf1f3; padding: 8px 9px; text-align: left; vertical-align: top; }
    th { background: #f7fafb; color: #405968; font-size: 12px; text-transform: uppercase; }
    .listing-grid { display: grid; gap: 16px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .panel { border: 1px solid #edf1f3; border-radius: 8px; padding: 12px; }
    .signoff { margin-top: 24px; }
    code { background: #f8eff3; border-radius: 4px; padding: 2px 4px; overflow-wrap: anywhere; }
    @media (max-width: 860px) { body { padding: 12px; } header { flex-direction: column; } .meta { text-align: left; } .kpi-grid, .listing-grid { grid-template-columns: 1fr; } }
    @media print { body { background: #fff; padding: 0; } main { border: 0; border-radius: 0; max-width: none; } .panel, .kpi { break-inside: avoid; } }
  </style>
</head>
<body>
<main>
  <header>
    <div>
      <div class="eyebrow">Clinical Shinylive Harness Report</div>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(subtitle)}</p>
    </div>
    <div class="meta">
      <div>App: ${escapeHtml(context.appId)} ${escapeHtml(context.appVersion)}</div>
      <div>Subject: ${escapeHtml(context.subjectId)}</div>
      <div>Data pack: ${escapeHtml(context.dataPackId)}</div>
      <div>Data hash: <code>${escapeHtml(context.dataPackSha256)}</code></div>
      <div>Generated: ${escapeHtml(context.generatedAt)}</div>
    </div>
  </header>
  <div class="warning">${escapeHtml(clinicalUseLimitation)}</div>
  ${body}
  <section class="signoff">
    <h2>Reviewer Sign-Off</h2>
    ${table(
      [
        { key: "field", label: "Field" },
        { key: "value", label: "Value" },
      ],
      [
        { field: "Review status", value: "Pending" },
        { field: "Reviewer", value: "" },
        { field: "Reviewed at", value: "" },
        { field: "Decision", value: "" },
        { field: "Notes", value: "" },
      ],
    )}
  </section>
</main>
</body>
</html>
`;

const dataDirForApp = (app) => {
  const metadataPath = app.dataPaths.find((candidate) => candidate.endsWith("clinical-demo-data-pack.json"));
  if (metadataPath) {
    return path.dirname(path.join(rootDir, metadataPath));
  }
  return path.join(rootDir, app.source, "data");
};

const readClinicalData = async (app) => {
  const dataDir = dataDirForApp(app);
  const metadata = JSON.parse(await readFile(path.join(dataDir, "clinical-demo-data-pack.json"), "utf8"));
  return {
    dataDir,
    metadata,
    demographics: await readCsv(path.join(dataDir, "demographics.csv")),
    visits: await readCsv(path.join(dataDir, "visits.csv")),
    labs: await readCsv(path.join(dataDir, "labs.csv")),
    vitals: await readCsv(path.join(dataDir, "vitals.csv")),
    adverseEvents: await readCsv(path.join(dataDir, "adverse_events.csv")),
    concomitantMeds: await readCsv(path.join(dataDir, "concomitant_meds.csv")),
    exposure: await readCsv(path.join(dataDir, "exposure.csv")),
  };
};

const subjectContext = ({ app, appManifest, data, subjectId }) => {
  const profile = data.demographics.find((row) => row.subject_id === subjectId) ?? {};
  const visits = rowsForSubject(data.visits, subjectId);
  const labs = rowsForSubject(data.labs, subjectId);
  const aes = rowsForSubject(data.adverseEvents, subjectId);
  const meds = rowsForSubject(data.concomitantMeds, subjectId);
  const exposure = rowsForSubject(data.exposure, subjectId);
  const highLabs = abnormalLabs(labs);
  const generatedAt = new Date().toISOString();
  return {
    app,
    appManifest,
    data,
    subjectId,
    profile,
    visits,
    labs,
    aes,
    meds,
    exposure,
    highLabs,
    generatedAt,
    reportContext: {
      appId: app.id,
      appVersion: appManifest.projectVersion ?? "",
      subjectId,
      dataPackId: appManifest.dataPack?.id ?? data.metadata.id,
      dataPackSha256: appManifest.dataPack?.sha256 ?? "not available",
      generatedAt,
    },
  };
};

const subjectSnapshot = (ctx) => {
  const latestVisit = firstOrNa(ctx.visits.at(-1)?.visit);
  const body = [
    kpiGrid([
      { label: "Subject", value: ctx.subjectId },
      { label: "Arm / status", value: `${firstOrNa(ctx.profile.arm)} / ${firstOrNa(ctx.profile.study_status)}` },
      { label: "AE / SAE", value: `${ctx.aes.length} / ${ctx.aes.filter((row) => row.serious === "Y").length}` },
      { label: "Abnormal labs", value: ctx.highLabs.length },
      { label: "Max severity", value: maxSeverity(ctx.aes) },
      { label: "Dose cycles", value: ctx.exposure.length },
      { label: "Related AEs", value: relatedAeCount(ctx.aes) },
      { label: "Latest visit", value: latestVisit },
    ]),
    `<div class="narrative">${escapeHtml(
      `${ctx.subjectId} is a ${firstOrNa(ctx.profile.age)}-year-old ${firstOrNa(ctx.profile.sex)} subject in the ${firstOrNa(ctx.profile.arm)} arm. The synthetic profile includes ${ctx.exposure.length} exposure cycle(s), ${ctx.aes.length} adverse event(s), ${ctx.aes.filter((row) => row.serious === "Y").length} serious adverse event(s), and ${ctx.highLabs.length} abnormal lab record(s).`,
    )}</div>`,
    keyValueTable([
      { section: "Identity", item: "Subject", value: ctx.subjectId },
      { section: "Identity", item: "Site / Region", value: `${firstOrNa(ctx.profile.site_id)} / ${firstOrNa(ctx.profile.region)}` },
      { section: "Identity", item: "Demographics", value: `${firstOrNa(ctx.profile.sex)} / ${firstOrNa(ctx.profile.age)} years / ${firstOrNa(ctx.profile.race)}` },
      { section: "Study conduct", item: "Current status", value: firstOrNa(ctx.profile.study_status) },
      { section: "Study conduct", item: "Latest visit", value: latestVisit },
      { section: "Exposure", item: "Cycles observed", value: ctx.exposure.length },
      { section: "Exposure", item: "Dose status", value: [...new Set(ctx.exposure.map((row) => row.dose_status))].join(", ") },
      { section: "Safety", item: "AE count", value: ctx.aes.length },
      { section: "Safety", item: "Serious AE count", value: ctx.aes.filter((row) => row.serious === "Y").length },
      { section: "Safety", item: "Maximum severity", value: maxSeverity(ctx.aes) },
      { section: "Laboratory", item: "Abnormal lab records", value: ctx.highLabs.length },
    ]),
  ].join("\n");
  return reportShell({
    title: "Subject Snapshot Report",
    subtitle: "A concise clinical profile summary for walkthroughs and reviewer orientation.",
    context: ctx.reportContext,
    body,
  });
};

const safetyReview = (ctx) => {
  const serious = ctx.aes.filter((row) => row.serious === "Y");
  const related = ctx.aes.filter((row) => ["Possible", "Probable", "Related"].includes(row.related));
  const highAlt = ctx.highLabs.filter((row) => row.lab_test === "ALT");
  const doseModified = ctx.exposure.filter((row) => ["Dose reduced", "Interrupted"].includes(row.dose_status));
  const reviewRows = [
    {
      item: "Serious adverse events",
      finding: `${serious.length} serious event(s)`,
      evidence: serious.length ? serious.map((row) => row.ae_id).join(", ") : "AE listing",
      status: serious.length ? "Medical review" : "No SAE signal",
    },
    {
      item: "Treatment-related adverse events",
      finding: `${related.length} possibly/probably/related event(s)`,
      evidence: related.length ? related.map((row) => row.ae_id).join(", ") : "AE listing",
      status: related.length ? "Causality review" : "No related AE",
    },
    {
      item: "Maximum AE severity",
      finding: maxSeverity(ctx.aes),
      evidence: ctx.aes.length ? ctx.aes.map((row) => `${row.ae_id} ${row.severity}`).join("; ") : "No AE records",
      status: maxSeverity(ctx.aes) === "Severe" ? "Priority review" : "Routine review",
    },
    {
      item: "ALT abnormality",
      finding: highAlt.length ? `${highAlt.length} high ALT record(s)` : "No abnormal ALT records",
      evidence: highAlt.length ? highAlt.map((row) => `${row.visit} ${row.lab_value} ${row.unit}`).join("; ") : "Lab listing",
      status: highAlt.length ? "Lab follow-up" : "No lab flag",
    },
    {
      item: "Dose modification",
      finding: doseModified.length ? doseModified.map((row) => `${row.cycle} ${row.dose_status}`).join("; ") : "No dose reduction/interruption",
      evidence: doseModified.length ? doseModified.map((row) => `Cycle ${row.cycle} ${row.dose_intensity_pct}%`).join("; ") : "Exposure listing",
      status: doseModified.length ? "Dose review" : "No action",
    },
  ];
  const body = [
    kpiGrid([
      { label: "SAE", value: serious.length },
      { label: "Related/Possible", value: related.length },
      { label: "High labs", value: ctx.highLabs.length },
      { label: "Review path", value: serious.length > 0 || ctx.highLabs.length > 0 ? "Follow-up" : "Routine" },
    ]),
    table(
      [
        { key: "item", label: "Review Item" },
        { key: "finding", label: "Finding" },
        { key: "evidence", label: "Evidence" },
        { key: "status", label: "Review Status" },
      ],
      reviewRows,
    ),
  ].join("\n");
  return reportShell({
    title: "Safety Review Worksheet",
    subtitle: "Signal-oriented review items with traceable source evidence.",
    context: ctx.reportContext,
    body,
  });
};

const dataListing = (ctx) => {
  const body = `<div class="listing-grid">
    <section class="panel"><h2>Visits</h2>${table(
      [
        { key: "visit", label: "Visit" },
        { key: "visit_day", label: "Day" },
        { key: "visit_date", label: "Date" },
        { key: "visit_status", label: "Status" },
        { key: "disposition", label: "Disposition" },
      ],
      ctx.visits,
    )}</section>
    <section class="panel"><h2>Exposure</h2>${table(
      [
        { key: "cycle", label: "Cycle" },
        { key: "start_day", label: "Start" },
        { key: "end_day", label: "End" },
        { key: "dose_mg", label: "Dose mg" },
        { key: "dose_status", label: "Status" },
        { key: "dose_intensity_pct", label: "Intensity %" },
      ],
      ctx.exposure,
    )}</section>
    <section class="panel"><h2>Adverse Events</h2>${table(
      [
        { key: "ae_id", label: "AE ID" },
        { key: "ae_term", label: "Term" },
        { key: "start_day", label: "Start" },
        { key: "end_day", label: "End" },
        { key: "severity", label: "Severity" },
        { key: "serious", label: "Serious" },
        { key: "related", label: "Related" },
      ],
      ctx.aes,
    )}</section>
    <section class="panel"><h2>Abnormal Labs</h2>${table(
      [
        { key: "visit", label: "Visit" },
        { key: "visit_day", label: "Day" },
        { key: "lab_test", label: "Test" },
        { key: "lab_value", label: "Value" },
        { key: "unit", label: "Unit" },
        { key: "low", label: "Low" },
        { key: "high", label: "High" },
        { key: "flag", label: "Flag" },
      ],
      ctx.highLabs,
    )}</section>
  </div>`;
  return reportShell({
    title: "Subject Data Listing Pack",
    subtitle: "Compact listings used to explain traceability from source data to visual profile.",
    context: ctx.reportContext,
    body,
  });
};

const renderers = new Map([
  ["subject-snapshot", subjectSnapshot],
  ["safety-review", safetyReview],
  ["data-listing", dataListing],
]);

const writeReport = async (targetPath, contents) => {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, contents);
  const metadata = await stat(targetPath);
  return {
    path: toPosix(path.relative(rootDir, targetPath)),
    size: metadata.size,
    sha256: await sha256File(targetPath),
  };
};

const writeIndex = async ({ config, generatedAt, appResults }) => {
  const rows = appResults.flatMap((appResult) =>
    appResult.reports.map((report) => ({
      app: appResult.appId,
      subject: report.subjectId,
      report: report.title,
      file: report.path,
      hash: report.sha256,
    })),
  );
  const body = [
    `<p>Generated report evidence for ${escapeHtml(config.project.bundleName)} ${escapeHtml(config.project.version)}.</p>`,
    table(
      [
        { key: "app", label: "App" },
        { key: "subject", label: "Subject" },
        { key: "report", label: "Report" },
        { key: "file", label: "File" },
        { key: "hash", label: "SHA-256" },
      ],
      rows,
    ),
  ].join("\n");
  return reportShell({
    title: "Validation Evidence Report Index",
    subtitle: "Generated report files, hashes, and review workflow entry point.",
    context: {
      appId: "all configured report apps",
      appVersion: config.project.version,
      subjectId: "see rows",
      dataPackId: "see app reports",
      dataPackSha256: "see app reports",
      generatedAt,
    },
    body,
  });
};

const markdownIndex = ({ config, generatedAt, appResults }) => [
  `# Report Export Index: ${config.project.bundleName}`,
  "",
  `Generated: ${generatedAt}`,
  `Version: ${config.project.version}`,
  "",
  "## Clinical Use Limitation",
  "",
  clinicalUseLimitation,
  "",
  "## Reports",
  "",
  "| App | Subject | Report | Path | SHA-256 |",
  "| --- | --- | --- | --- | --- |",
  ...appResults.flatMap((appResult) =>
    appResult.reports.map(
      (report) =>
        `| ${appResult.appId} | ${report.subjectId} | ${report.title} | ${report.path} | ${report.sha256} |`,
    ),
  ),
  "",
  "## Reviewer Sign-Off",
  "",
  "| Field | Value |",
  "| --- | --- |",
  "| Review status | Pending |",
  "| Reviewer |  |",
  "| Reviewed at |  |",
  "| Decision |  |",
  "| Notes |  |",
].join("\n");

export const exportReports = async ({ appId = null, subjectId = null, allSubjects = false } = {}) => {
  const config = await readConfig();
  const apps = config.apps.filter((app) => (!appId || app.id === appId) && app.reportTemplates.length > 0);
  if (appId && apps.length === 0) {
    throw new Error(`No report-enabled app matched: ${appId}`);
  }

  await rm(reportExportRoot, { recursive: true, force: true });
  await mkdir(reportExportRoot, { recursive: true });
  const generatedAt = new Date().toISOString();
  const appResults = [];

  for (const app of apps) {
    const appOutputRoot = path.join(reportExportRoot, app.id);
    await rm(appOutputRoot, { recursive: true, force: true });
    await mkdir(appOutputRoot, { recursive: true });
    const data = await readClinicalData(app);
    const appManifest = await appToManifest(app);
    appManifest.projectVersion = config.project.version;
    const subjects = allSubjects
      ? data.demographics.map((row) => row.subject_id)
      : [subjectId ?? data.metadata.primarySubject ?? data.demographics[0]?.subject_id].filter(Boolean);
    const appResult = {
      appId: app.id,
      dataPack: appManifest.dataPack ?? null,
      subjectCount: subjects.length,
      templates: app.reportTemplates,
      reports: [],
    };

    for (const templateId of app.reportTemplates) {
      const templatePath = path.join(reportTemplatesRoot, templateId, "template.json");
      if (!(await exists(templatePath))) {
        throw new Error(`Missing report template: ${toPosix(path.relative(rootDir, templatePath))}`);
      }
      const template = JSON.parse(await readFile(templatePath, "utf8"));
      const renderer = renderers.get(templateId);
      if (!renderer) {
        throw new Error(`No report renderer registered for template: ${templateId}`);
      }
      for (const nextSubjectId of subjects) {
        const ctx = subjectContext({ app, appManifest, data, subjectId: nextSubjectId });
        const fileName = template.defaultFile ?? `${templateId}.html`;
        const targetPath = path.join(appOutputRoot, nextSubjectId, fileName);
        const file = await writeReport(targetPath, renderer(ctx));
        appResult.reports.push({
          templateId,
          title: template.title,
          subjectId: nextSubjectId,
          ...file,
        });
      }
    }
    appResults.push(appResult);
  }

  const exportManifest = {
    schemaVersion: 1,
    generatedAt,
    generatedBy: "tauri-shinylive-harness",
    project: config.project,
    clinicalUseLimitation,
    appResults,
  };
  await writeJson(path.join(reportsRoot, "report-export-manifest.json"), exportManifest);
  await writeJson(path.join(reportsRoot, "review-workflow.json"), {
    schemaVersion: 1,
    generatedAt,
    project: config.project,
    status: "pending-review",
    reviewer: "",
    reviewedAt: "",
    decision: "",
    notes: "",
    requiredEvidence: [
      "report-export-manifest.json",
      "clinical-data-pack-validation.json",
      "e2e-diagnostics.json",
      "bundle-integrity.json",
      "validation-pack/evidence/reports",
    ],
    clinicalUseLimitation,
  });
  await writeFile(path.join(reportExportRoot, "index.html"), await writeIndex({ config, generatedAt, appResults }));
  await mkdir(path.join(rootDir, "docs", "generated"), { recursive: true });
  await writeFile(
    path.join(rootDir, "docs", "generated", "report-export-index.md"),
    `${markdownIndex({ config, generatedAt, appResults })}\n`,
  );
  await appendAudit("export-reports", "ok", {
    appId,
    subjectId,
    allSubjects,
    reportCount: appResults.reduce((total, appResult) => total + appResult.reports.length, 0),
    fingerprint: createHash("sha256").update(JSON.stringify(exportManifest)).digest("hex"),
  });

  return exportManifest;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseOptions(process.argv.slice(2));
  const result = await exportReports({
    appId: options.app ?? options._[0] ?? null,
    subjectId: options.subject ?? null,
    allSubjects: Boolean(options["all-subjects"]),
  });
  console.log(JSON.stringify({ ok: true, apps: result.appResults.length, report: "reports/report-export-manifest.json" }, null, 2));
}
