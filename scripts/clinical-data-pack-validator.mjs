#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  exists,
  readConfig,
  reportsRoot,
  rootDir,
  sha256File,
  toPosix,
  writeJson,
} from "./harness-core.mjs";

export const clinicalDomains = {
  demographics: {
    file: "demographics.csv",
    requiredColumns: [
      "subject_id",
      "site_id",
      "arm",
      "sex",
      "age",
      "race",
      "ethnicity",
      "region",
      "consent_date",
      "first_dose_date",
      "last_contact_date",
      "study_status",
    ],
  },
  visits: {
    file: "visits.csv",
    requiredColumns: ["subject_id", "visit", "visit_day", "visit_date", "visit_status", "disposition"],
  },
  labs: {
    file: "labs.csv",
    requiredColumns: ["subject_id", "visit", "visit_day", "lab_test", "lab_value", "unit", "low", "high", "flag"],
  },
  vitals: {
    file: "vitals.csv",
    requiredColumns: [
      "subject_id",
      "visit",
      "visit_day",
      "systolic_bp",
      "diastolic_bp",
      "heart_rate",
      "temperature_c",
      "weight_kg",
    ],
  },
  adverse_events: {
    file: "adverse_events.csv",
    requiredColumns: [
      "subject_id",
      "ae_id",
      "ae_term",
      "system_organ_class",
      "start_day",
      "end_day",
      "severity",
      "serious",
      "related",
      "outcome",
    ],
  },
  concomitant_meds: {
    file: "concomitant_meds.csv",
    requiredColumns: ["subject_id", "medication", "indication", "start_day", "end_day", "ongoing"],
  },
  exposure: {
    file: "exposure.csv",
    requiredColumns: [
      "subject_id",
      "cycle",
      "start_day",
      "end_day",
      "dose_mg",
      "dose_status",
      "dose_intensity_pct",
    ],
  },
};

const metadataFile = "clinical-demo-data-pack.json";

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
  const records = rows.slice(1).map((row, rowIndex) => {
    const record = { __row: rowIndex + 2 };
    for (let index = 0; index < headers.length; index += 1) {
      record[headers[index]] = row[index] ?? "";
    }
    return record;
  });

  return { headers, records };
};

const isBlank = (value) => value === undefined || value === null || String(value).trim() === "";

const asNumber = (value) => {
  if (isBlank(value)) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const isIsoDate = (value) => {
  if (isBlank(value)) {
    return false;
  }
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return false;
  }
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text;
};

const compareDate = (left, right) =>
  new Date(`${left}T00:00:00Z`).getTime() - new Date(`${right}T00:00:00Z`).getTime();

const inferType = (values) => {
  const nonBlank = values.filter((value) => !isBlank(value));
  if (nonBlank.length === 0) {
    return "empty";
  }
  if (nonBlank.every((value) => isIsoDate(value))) {
    return "date";
  }
  if (nonBlank.every((value) => /^-?\d+$/.test(String(value)))) {
    return "integer";
  }
  if (nonBlank.every((value) => asNumber(value) !== null)) {
    return "number";
  }
  if (nonBlank.every((value) => ["Y", "N", "true", "false", "TRUE", "FALSE"].includes(String(value)))) {
    return "boolean";
  }
  return "string";
};

const addIssue = (issues, severity, code, message, details = {}) => {
  issues.push({ severity, code, message, details });
};

const getDataDirForApp = (app) => {
  const manifestPath = app.dataPaths.find((candidate) => candidate.endsWith(metadataFile));
  if (manifestPath) {
    return path.dirname(path.join(rootDir, manifestPath));
  }
  return path.join(rootDir, app.source, "data");
};

const relativeToRoot = (targetPath) => toPosix(path.relative(rootDir, targetPath));

const createDataDictionaryMarkdown = (result) => {
  const lines = [
    `# Clinical Data Dictionary: ${result.dataPack.id}`,
    "",
    `Generated: ${result.checkedAt}`,
    `Synthetic: ${result.dataPack.synthetic}`,
    `Aggregate SHA-256: ${result.dataPack.sha256}`,
    "",
  ];

  for (const domain of result.domains) {
    lines.push(`## ${domain.name}`, "");
    lines.push(`File: \`${domain.file.path}\``);
    lines.push(`Rows: ${domain.rowCount}`);
    lines.push("");
    lines.push("| Column | Required | Inferred Type | Non-blank | Missing |");
    lines.push("| --- | --- | --- | ---: | ---: |");
    for (const column of domain.columns) {
      lines.push(
        `| ${column.name} | ${column.required ? "yes" : "no"} | ${column.inferredType} | ${column.nonBlankCount} | ${column.missingCount} |`,
      );
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
};

export const validateClinicalDataPack = async ({
  app = null,
  appId = app?.id ?? null,
  dataDir,
  dataPackId = app?.dataPack ?? null,
  reportPath = path.join(reportsRoot, "clinical-data-pack-validation.json"),
  dictionaryPath = path.join(rootDir, "docs", "generated", "clinical-data-dictionary.md"),
  writeOutputs = true,
} = {}) => {
  if (!dataDir) {
    if (!app) {
      throw new Error("validateClinicalDataPack requires dataDir or app.");
    }
    dataDir = getDataDirForApp(app);
  }

  const resolvedDataDir = path.resolve(dataDir);
  const issues = [];
  const domains = [];
  const metadataPath = path.join(resolvedDataDir, metadataFile);
  let metadata = {};

  if (!(await exists(metadataPath))) {
    addIssue(issues, "error", "missing-metadata", `Missing ${metadataFile}`, {
      path: relativeToRoot(metadataPath),
    });
  } else {
    try {
      metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    } catch (error) {
      addIssue(issues, "error", "invalid-metadata-json", `${metadataFile} is not valid JSON`, {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const effectiveDataPackId = dataPackId || metadata.id || path.basename(resolvedDataDir);
  if (metadata.id && dataPackId && metadata.id !== dataPackId) {
    addIssue(issues, "warning", "metadata-id-mismatch", "Data pack id differs from app configuration.", {
      metadataId: metadata.id,
      appDataPackId: dataPackId,
    });
  }
  if (metadata.synthetic !== true) {
    addIssue(issues, "error", "metadata-synthetic-required", "clinical-demo-data-pack.json must declare synthetic: true.");
  }
  if (!metadata.id || !/^[a-z0-9][a-z0-9._-]*$/.test(metadata.id)) {
    addIssue(issues, "error", "metadata-id-invalid", "clinical-demo-data-pack.json must include a valid id.");
  }
  if (!metadata.version) {
    addIssue(issues, "error", "metadata-version-required", "clinical-demo-data-pack.json must include version.");
  }
  if (!metadata.description) {
    addIssue(issues, "error", "metadata-description-required", "clinical-demo-data-pack.json must include description.");
  }
  if (!metadata.primarySubject) {
    addIssue(issues, "error", "metadata-primary-subject-required", "clinical-demo-data-pack.json must include primarySubject.");
  }
  if (!Array.isArray(metadata.domains)) {
    addIssue(issues, "error", "metadata-domains-required", "clinical-demo-data-pack.json must include domains.");
  } else {
    for (const domainName of Object.keys(clinicalDomains)) {
      if (!metadata.domains.includes(domainName)) {
        addIssue(issues, "error", "metadata-domain-missing", `clinical-demo-data-pack.json domains is missing ${domainName}.`, {
          domain: domainName,
        });
      }
    }
  }

  const csvByDomain = new Map();
  for (const [domainName, domainSpec] of Object.entries(clinicalDomains)) {
    const filePath = path.join(resolvedDataDir, domainSpec.file);
    if (!(await exists(filePath))) {
      addIssue(issues, "error", "missing-domain-file", `Missing required domain file: ${domainSpec.file}`, {
        domain: domainName,
        path: relativeToRoot(filePath),
      });
      continue;
    }

    const csv = await readCsv(filePath);
    csvByDomain.set(domainName, csv);
    for (const column of domainSpec.requiredColumns) {
      if (!csv.headers.includes(column)) {
        addIssue(issues, "error", "missing-required-column", `${domainSpec.file} is missing required column ${column}.`, {
          domain: domainName,
          column,
        });
      }
    }

    const metadataStat = await stat(filePath);
    domains.push({
      name: domainName,
      rowCount: csv.records.length,
      file: {
        path: relativeToRoot(filePath),
        size: metadataStat.size,
        sha256: await sha256File(filePath),
      },
      columns: csv.headers.map((column) => {
        const values = csv.records.map((record) => record[column]);
        return {
          name: column,
          required: domainSpec.requiredColumns.includes(column),
          inferredType: inferType(values),
          nonBlankCount: values.filter((value) => !isBlank(value)).length,
          missingCount: values.filter((value) => isBlank(value)).length,
        };
      }),
    });
  }

  const demographics = csvByDomain.get("demographics")?.records ?? [];
  const subjectIds = new Set();
  for (const record of demographics) {
    if (isBlank(record.subject_id)) {
      addIssue(issues, "error", "blank-subject-id", "Demographics contains a blank subject_id.", {
        row: record.__row,
      });
      continue;
    }
    if (subjectIds.has(record.subject_id)) {
      addIssue(issues, "error", "duplicate-subject-id", `Duplicate subject_id: ${record.subject_id}`, {
        row: record.__row,
      });
    }
    subjectIds.add(record.subject_id);

    for (const dateColumn of ["consent_date", "first_dose_date", "last_contact_date"]) {
      if (!isIsoDate(record[dateColumn])) {
        addIssue(issues, "error", "invalid-date", `${dateColumn} must be YYYY-MM-DD.`, {
          domain: "demographics",
          row: record.__row,
          subject_id: record.subject_id,
          value: record[dateColumn],
        });
      }
    }
    if (
      isIsoDate(record.consent_date) &&
      isIsoDate(record.first_dose_date) &&
      compareDate(record.first_dose_date, record.consent_date) < 0
    ) {
      addIssue(issues, "error", "first-dose-before-consent", "first_dose_date cannot be before consent_date.", {
        row: record.__row,
        subject_id: record.subject_id,
      });
    }
    if (
      isIsoDate(record.consent_date) &&
      isIsoDate(record.last_contact_date) &&
      compareDate(record.last_contact_date, record.consent_date) < 0
    ) {
      addIssue(issues, "error", "last-contact-before-consent", "last_contact_date cannot be before consent_date.", {
        row: record.__row,
        subject_id: record.subject_id,
      });
    }
  }

  if (metadata.primarySubject && !subjectIds.has(metadata.primarySubject)) {
    addIssue(issues, "error", "missing-primary-subject", "primarySubject is not present in demographics.", {
      primarySubject: metadata.primarySubject,
    });
  }

  for (const [domainName, csv] of csvByDomain.entries()) {
    if (domainName === "demographics") {
      continue;
    }
    for (const record of csv.records) {
      if (!subjectIds.has(record.subject_id)) {
        addIssue(issues, "error", "unknown-subject-reference", `${domainName} references an unknown subject_id.`, {
          domain: domainName,
          row: record.__row,
          subject_id: record.subject_id,
        });
      }
    }
  }

  for (const record of csvByDomain.get("visits")?.records ?? []) {
    if (asNumber(record.visit_day) === null) {
      addIssue(issues, "error", "invalid-visit-day", "visits.visit_day must be numeric.", {
        row: record.__row,
        subject_id: record.subject_id,
        value: record.visit_day,
      });
    }
    if (!isIsoDate(record.visit_date)) {
      addIssue(issues, "error", "invalid-visit-date", "visits.visit_date must be YYYY-MM-DD.", {
        row: record.__row,
        subject_id: record.subject_id,
        value: record.visit_date,
      });
    }
  }

  for (const domainName of ["labs", "vitals"]) {
    for (const record of csvByDomain.get(domainName)?.records ?? []) {
      if (asNumber(record.visit_day) === null) {
        addIssue(issues, "error", "invalid-visit-day", `${domainName}.visit_day must be numeric.`, {
          domain: domainName,
          row: record.__row,
          subject_id: record.subject_id,
          value: record.visit_day,
        });
      }
    }
  }

  for (const record of csvByDomain.get("adverse_events")?.records ?? []) {
    const start = asNumber(record.start_day);
    const end = asNumber(record.end_day);
    if (start === null) {
      addIssue(issues, "error", "invalid-ae-start-day", "AE start_day must be numeric.", {
        row: record.__row,
        ae_id: record.ae_id,
        value: record.start_day,
      });
    }
    if (!isBlank(record.end_day) && end === null) {
      addIssue(issues, "error", "invalid-ae-end-day", "AE end_day must be numeric or blank.", {
        row: record.__row,
        ae_id: record.ae_id,
        value: record.end_day,
      });
    }
    if (start !== null && end !== null && end < start) {
      addIssue(issues, "error", "ae-end-before-start", "AE end_day cannot be before start_day.", {
        row: record.__row,
        ae_id: record.ae_id,
      });
    }
  }

  for (const domainName of ["concomitant_meds", "exposure"]) {
    for (const record of csvByDomain.get(domainName)?.records ?? []) {
      const start = asNumber(record.start_day);
      const end = asNumber(record.end_day);
      if (start === null) {
        addIssue(issues, "error", "invalid-start-day", `${domainName}.start_day must be numeric.`, {
          domain: domainName,
          row: record.__row,
          subject_id: record.subject_id,
          value: record.start_day,
        });
      }
      if (!isBlank(record.end_day) && end === null) {
        addIssue(issues, "error", "invalid-end-day", `${domainName}.end_day must be numeric or blank.`, {
          domain: domainName,
          row: record.__row,
          subject_id: record.subject_id,
          value: record.end_day,
        });
      }
      if (start !== null && end !== null && end < start) {
        addIssue(issues, "error", "end-before-start", `${domainName}.end_day cannot be before start_day.`, {
          domain: domainName,
          row: record.__row,
          subject_id: record.subject_id,
        });
      }
    }
  }

  const files = [];
  if (await exists(metadataPath)) {
    const metadataStat = await stat(metadataPath);
    files.push({
      path: relativeToRoot(metadataPath),
      size: metadataStat.size,
      sha256: await sha256File(metadataPath),
    });
  }
  for (const domain of domains) {
    files.push(domain.file);
  }

  const aggregateSource = files
    .map((file) => `${file.path}\0${file.size}\0${file.sha256}`)
    .join("\n");
  const aggregateHash = createHash("sha256").update(aggregateSource).digest("hex");
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;

  const result = {
    schemaVersion: 1,
    ok: errorCount === 0,
    checkedAt: new Date().toISOString(),
    appId,
    dataDir: relativeToRoot(resolvedDataDir),
    schema: "schemas/clinical-data-pack.schema.json",
    dataPack: {
      id: effectiveDataPackId,
      metadataId: metadata.id ?? null,
      version: metadata.version ?? null,
      synthetic: metadata.synthetic === true,
      primarySubject: metadata.primarySubject ?? null,
      sha256: aggregateHash,
      fileCount: files.length,
      files,
    },
    summary: {
      subjectCount: demographics.length,
      domainCount: domains.length,
      errorCount,
      warningCount,
    },
    domains,
    issues,
  };

  if (writeOutputs) {
    await writeJson(reportPath, result);
    await mkdir(path.dirname(dictionaryPath), { recursive: true });
    await writeFile(dictionaryPath, createDataDictionaryMarkdown(result));
  }

  return result;
};

export const validateConfiguredDataPacks = async ({
  appId = null,
  reportPath = path.join(reportsRoot, "clinical-data-pack-validation.json"),
  dictionaryPath = path.join(rootDir, "docs", "generated", "clinical-data-dictionary.md"),
} = {}) => {
  const config = await readConfig();
  const apps = config.apps.filter((app) => app.dataPack && (!appId || app.id === appId));
  if (appId && apps.length === 0) {
    throw new Error(`No configured data pack found for app: ${appId}`);
  }

  const results = [];
  for (const app of apps) {
    results.push(
      await validateClinicalDataPack({
        app,
        appId: app.id,
        writeOutputs: false,
      }),
    );
  }

  const result = {
    schemaVersion: 1,
    ok: results.every((item) => item.ok),
    checkedAt: new Date().toISOString(),
    appId,
    resultCount: results.length,
    results,
  };

  await writeJson(reportPath, result);
  if (results.length === 1) {
    await mkdir(path.dirname(dictionaryPath), { recursive: true });
    await writeFile(dictionaryPath, createDataDictionaryMarkdown(results[0]));
  } else if (results.length > 1) {
    await mkdir(path.dirname(dictionaryPath), { recursive: true });
    await writeFile(
      dictionaryPath,
      results
        .map((item) => createDataDictionaryMarkdown(item).trimEnd())
        .join("\n\n---\n\n")
        .concat("\n"),
    );
  }

  if (!result.ok) {
    const errors = results
      .flatMap((item) => item.issues.map((issue) => `${item.appId ?? item.dataPack.id}: ${issue.code}: ${issue.message}`))
      .join("\n");
    throw new Error(`Clinical data pack validation failed:\n${errors}`);
  }

  return result;
};

const runCli = async () => {
  const options = parseOptions(process.argv.slice(2));
  const appId = options.app ?? options._[0] ?? null;
  const dataDir = options["data-dir"] ?? null;
  const dataPackId = options.id ?? null;
  const reportPath = options.report ? path.resolve(options.report) : path.join(reportsRoot, "clinical-data-pack-validation.json");
  const dictionaryPath = options.dictionary
    ? path.resolve(options.dictionary)
    : path.join(rootDir, "docs", "generated", "clinical-data-dictionary.md");

  let result;
  if (dataDir) {
    result = await validateClinicalDataPack({
      appId,
      dataDir: path.resolve(dataDir),
      dataPackId,
      reportPath,
      dictionaryPath,
    });
    if (!result.ok) {
      throw new Error(`Clinical data pack validation failed. See ${toPosix(path.relative(rootDir, reportPath))}`);
    }
  } else {
    result = await validateConfiguredDataPacks({ appId, reportPath, dictionaryPath });
  }

  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        report: toPosix(path.relative(rootDir, reportPath)),
        dictionary: toPosix(path.relative(rootDir, dictionaryPath)),
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
