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

export const controlledTerminology = {
  demographics: {
    sex: ["F", "M"],
    study_status: ["On study", "Discontinued", "Completed"],
  },
  visits: {
    visit_status: ["Completed", "Missed", "Planned"],
    disposition: ["Eligible", "Dosed", "On treatment", "Discontinued", "Completed"],
  },
  labs: {
    flag: ["Low", "Normal", "High"],
  },
  adverse_events: {
    severity: ["Mild", "Moderate", "Severe"],
    serious: ["Y", "N"],
    related: ["Unrelated", "Unlikely", "Possible", "Probable", "Related"],
    outcome: ["Resolved", "Resolving", "Ongoing", "Discontinued", "Fatal"],
  },
  concomitant_meds: {
    ongoing: ["Y", "N"],
  },
  exposure: {
    dose_status: ["Completed", "Control", "Dose reduced", "Interrupted", "Not dosed"],
  },
};

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

const parseCsvRows = (text) => {
  const rows = [];
  let row = [];
  let current = "";
  let inQuotes = false;

  const source = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

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
      row.push(current);
      current = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(current);
      if (!(row.length === 1 && row[0] === "")) {
        rows.push(row);
      }
      row = [];
      current = "";
      continue;
    }
    current += char;
  }

  if (inQuotes) {
    throw new Error("CSV contains an unterminated quoted field.");
  }
  if (current !== "" || row.length > 0) {
    row.push(current);
    if (!(row.length === 1 && row[0] === "")) {
      rows.push(row);
    }
  }

  return rows;
};

const readCsv = async (targetPath) => {
  const text = await readFile(targetPath, "utf8");
  const rows = parseCsvRows(text);
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

const incrementSummary = (target, key, issue) => {
  if (!key) {
    return;
  }
  const entry = target[key] ?? {
    count: 0,
    severities: {},
    codes: {},
  };
  entry.count += 1;
  entry.severities[issue.severity] = (entry.severities[issue.severity] ?? 0) + 1;
  entry.codes[issue.code] = (entry.codes[issue.code] ?? 0) + 1;
  target[key] = entry;
};

const summarizeIssues = (issues) => {
  const bySeverity = {};
  const byCode = {};
  const bySubject = {};
  const byDomain = {};

  for (const item of issues) {
    bySeverity[item.severity] = (bySeverity[item.severity] ?? 0) + 1;
    byCode[item.code] = byCode[item.code] ?? {
      count: 0,
      severities: {},
      message: item.message,
    };
    byCode[item.code].count += 1;
    byCode[item.code].severities[item.severity] = (byCode[item.code].severities[item.severity] ?? 0) + 1;
    incrementSummary(bySubject, item.details?.subject_id, item);
    incrementSummary(byDomain, item.details?.domain, item);
  }

  return {
    bySeverity,
    byCode,
    bySubject,
    byDomain,
  };
};

const validateControlledTerminology = (issues, domainName, records) => {
  const domainTerms = controlledTerminology[domainName] ?? {};
  for (const [column, values] of Object.entries(domainTerms)) {
    const allowed = new Set(values);
    for (const record of records) {
      if (!isBlank(record[column]) && !allowed.has(record[column])) {
        addIssue(issues, "error", "invalid-controlled-term", `${domainName}.${column} has an unsupported value.`, {
          domain: domainName,
          column,
          row: record.__row,
          subject_id: record.subject_id,
          value: record[column],
          allowed: values,
        });
      }
    }
  }
};

const getDataDirForApp = (app) => {
  const manifestPath = app.dataPaths.find((candidate) => candidate.endsWith(metadataFile));
  if (manifestPath) {
    return path.dirname(path.join(rootDir, manifestPath));
  }
  return path.join(rootDir, app.source, "data");
};

const relativeToRoot = (targetPath) => toPosix(path.relative(rootDir, targetPath));
const logicalDataPackPath = (targetPath, dataDir) => toPosix(path.relative(dataDir, targetPath));

const visitKey = (record) => `${record.subject_id}\0${record.visit}\0${record.visit_day}`;
const normalizeTerm = (value) => String(value ?? "").trim().toLowerCase();

const treatmentRelatedAeTerms = new Set(["Possible", "Probable", "Related"]);
const backgroundMedicationIndications = new Set([
  "hyperlipidemia",
  "hypertension",
  "diabetes",
  "supplement",
  "prophylaxis",
  "other",
]);
const labLinkedAeTerms = [
  {
    pattern: /alanine aminotransferase|alt/i,
    labTest: "ALT",
  },
  {
    pattern: /aspartate aminotransferase|ast/i,
    labTest: "AST",
  },
  {
    pattern: /hemoglobin|anaemia|anemia/i,
    labTest: "HGB",
  },
];

const recordsBySubject = (records) => {
  const bySubject = new Map();
  for (const record of records) {
    if (isBlank(record.subject_id)) {
      continue;
    }
    const subjectRecords = bySubject.get(record.subject_id) ?? [];
    subjectRecords.push(record);
    bySubject.set(record.subject_id, subjectRecords);
  }
  return bySubject;
};

const activeExposureRecords = (records) =>
  records.filter((record) => {
    const dose = asNumber(record.dose_mg);
    return dose !== null && dose > 0 && !["Control", "Not dosed"].includes(record.dose_status);
  });

const intervalEnd = (record) => {
  const end = asNumber(record.end_day);
  return end === null ? Number.POSITIVE_INFINITY : end;
};

const aeLabMapping = (record) =>
  labLinkedAeTerms.find((mapping) => mapping.pattern.test(record.ae_term ?? "")) ?? null;

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
    lines.push(`Logical path: \`${domain.file.logicalPath ?? domain.file.path}\``);
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

    let csv;
    try {
      csv = await readCsv(filePath);
    } catch (error) {
      addIssue(issues, "error", "invalid-csv", `${domainSpec.file} could not be parsed as CSV.`, {
        domain: domainName,
        path: relativeToRoot(filePath),
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
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
        logicalPath: logicalDataPackPath(filePath, resolvedDataDir),
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
    validateControlledTerminology(issues, domainName, csv.records);
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

  const visitKeys = new Set();
  const visitNamesBySubject = new Map();
  for (const record of csvByDomain.get("visits")?.records ?? []) {
    const visitDay = asNumber(record.visit_day);
    if (visitDay === null) {
      addIssue(issues, "error", "invalid-visit-day", "visits.visit_day must be numeric.", {
        row: record.__row,
        subject_id: record.subject_id,
        value: record.visit_day,
      });
    } else if (!isBlank(record.subject_id) && !isBlank(record.visit)) {
      const key = visitKey(record);
      if (visitKeys.has(key)) {
        addIssue(issues, "error", "duplicate-visit-reference", "visits contains duplicate subject_id + visit + visit_day.", {
          row: record.__row,
          subject_id: record.subject_id,
          visit: record.visit,
          visit_day: record.visit_day,
        });
      }
      visitKeys.add(key);
      const subjectVisits = visitNamesBySubject.get(record.subject_id) ?? new Set();
      subjectVisits.add(record.visit);
      visitNamesBySubject.set(record.subject_id, subjectVisits);
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
      const visitDay = asNumber(record.visit_day);
      if (visitDay === null) {
        addIssue(issues, "error", "invalid-visit-day", `${domainName}.visit_day must be numeric.`, {
          domain: domainName,
          row: record.__row,
          subject_id: record.subject_id,
          value: record.visit_day,
        });
        continue;
      }
      if (!isBlank(record.subject_id) && !isBlank(record.visit)) {
        const subjectVisits = visitNamesBySubject.get(record.subject_id) ?? new Set();
        if (!subjectVisits.has(record.visit)) {
          addIssue(issues, "error", "unknown-visit-reference", `${domainName} references a visit not present in visits.csv.`, {
            domain: domainName,
            row: record.__row,
            subject_id: record.subject_id,
            visit: record.visit,
          });
        } else if (!visitKeys.has(visitKey(record))) {
          addIssue(issues, "error", "visit-day-reference-mismatch", `${domainName} visit_day does not match visits.csv for the referenced visit.`, {
            domain: domainName,
            row: record.__row,
            subject_id: record.subject_id,
            visit: record.visit,
            visit_day: record.visit_day,
          });
        }
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

  const adverseEventsBySubject = recordsBySubject(csvByDomain.get("adverse_events")?.records ?? []);
  const labsBySubject = recordsBySubject(csvByDomain.get("labs")?.records ?? []);
  const exposureBySubject = recordsBySubject(csvByDomain.get("exposure")?.records ?? []);

  for (const [subjectId, exposureRecords] of exposureBySubject.entries()) {
    const ordered = exposureRecords
      .map((record) => ({
        record,
        start: asNumber(record.start_day),
        end: intervalEnd(record),
      }))
      .filter((item) => item.start !== null)
      .sort((left, right) => left.start - right.start || left.end - right.end);

    let previous = null;
    for (const item of ordered) {
      if (previous && item.start <= previous.end) {
        addIssue(issues, "error", "overlapping-exposure-interval", "exposure intervals overlap for a subject.", {
          subject_id: subjectId,
          row: item.record.__row,
          previous_row: previous.record.__row,
          start_day: item.record.start_day,
          previous_end_day: previous.record.end_day,
        });
      }
      if (!previous || item.end > previous.end) {
        previous = item;
      }
    }
  }

  for (const [subjectId, aeRecords] of adverseEventsBySubject.entries()) {
    const subjectActiveExposure = activeExposureRecords(exposureBySubject.get(subjectId) ?? [])
      .map((record) => ({
        record,
        start: asNumber(record.start_day),
        end: intervalEnd(record),
      }))
      .filter((item) => item.start !== null);
    const firstExposureStart =
      subjectActiveExposure.length > 0 ? Math.min(...subjectActiveExposure.map((item) => item.start)) : null;

    for (const record of aeRecords) {
      const start = asNumber(record.start_day);
      const end = intervalEnd(record);
      const isTreatmentRelated = treatmentRelatedAeTerms.has(record.related);

      if (isTreatmentRelated && subjectActiveExposure.length === 0) {
        addIssue(issues, "error", "related-ae-without-active-exposure", "Treatment-related AE has no active exposure record for the subject.", {
          row: record.__row,
          subject_id: subjectId,
          ae_id: record.ae_id,
          related: record.related,
        });
      } else if (isTreatmentRelated && start !== null && firstExposureStart !== null && start < firstExposureStart) {
        addIssue(issues, "error", "ae-before-first-exposure", "Treatment-related AE starts before the subject's first active exposure.", {
          row: record.__row,
          subject_id: subjectId,
          ae_id: record.ae_id,
          start_day: record.start_day,
          first_exposure_start_day: firstExposureStart,
        });
      }

      const labMapping = aeLabMapping(record);
      if (labMapping && start !== null) {
        const supportWindowStart = start - 14;
        const supportWindowEnd = (Number.isFinite(end) ? end : start) + 14;
        const supportingLab = (labsBySubject.get(subjectId) ?? []).find((lab) => {
          const visitDay = asNumber(lab.visit_day);
          return (
            lab.lab_test === labMapping.labTest &&
            visitDay !== null &&
            visitDay >= supportWindowStart &&
            visitDay <= supportWindowEnd
          );
        });
        if (!supportingLab) {
          addIssue(issues, "error", "lab-ae-without-supporting-lab", "Lab-linked AE has no nearby supporting lab record.", {
            row: record.__row,
            subject_id: subjectId,
            ae_id: record.ae_id,
            ae_term: record.ae_term,
            expected_lab_test: labMapping.labTest,
            support_window: [supportWindowStart, supportWindowEnd],
          });
        }
      }
    }
  }

  for (const record of csvByDomain.get("concomitant_meds")?.records ?? []) {
    const indication = normalizeTerm(record.indication);
    if (isBlank(indication) || backgroundMedicationIndications.has(indication)) {
      continue;
    }
    const hasMatchingAe = (adverseEventsBySubject.get(record.subject_id) ?? []).some(
      (aeRecord) => normalizeTerm(aeRecord.ae_term) === indication,
    );
    if (!hasMatchingAe) {
      addIssue(issues, "error", "medication-indication-without-ae", "Concomitant medication indication does not match an AE term for the subject.", {
        row: record.__row,
        subject_id: record.subject_id,
        medication: record.medication,
        indication: record.indication,
      });
    }
  }

  const files = [];
  if (await exists(metadataPath)) {
    const metadataStat = await stat(metadataPath);
    files.push({
      path: relativeToRoot(metadataPath),
      logicalPath: metadataFile,
      size: metadataStat.size,
      sha256: await sha256File(metadataPath),
    });
  }
  for (const domain of domains) {
    files.push(domain.file);
  }

  const aggregateSource = files
    .map((file) => `${file.logicalPath ?? file.path}\0${file.size}\0${file.sha256}`)
    .sort()
    .join("\n");
  const aggregateHash = createHash("sha256").update(aggregateSource).digest("hex");
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  const issueSummary = summarizeIssues(issues);

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
      sourcePath: app?.dataPackSource ?? null,
      sha256: aggregateHash,
      fileCount: files.length,
      files,
    },
    summary: {
      subjectCount: demographics.length,
      domainCount: domains.length,
      errorCount,
      warningCount,
      issuesBySeverity: issueSummary.bySeverity,
      issuesByCode: issueSummary.byCode,
      issuesBySubject: issueSummary.bySubject,
      issuesByDomain: issueSummary.byDomain,
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
    summary: {
      dataPackCount: results.length,
      errorCount: results.reduce((total, item) => total + item.summary.errorCount, 0),
      warningCount: results.reduce((total, item) => total + item.summary.warningCount, 0),
      issueCodeCounts: results.reduce((counts, item) => {
        for (const [code, entry] of Object.entries(item.summary.issuesByCode ?? {})) {
          counts[code] = (counts[code] ?? 0) + entry.count;
        }
        return counts;
      }, {}),
    },
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
