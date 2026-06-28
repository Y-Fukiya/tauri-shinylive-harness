#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { exists, listFiles, readConfig, reportsRoot, rootDir, toPosix, writeJson } from "./harness-core.mjs";

const blockedKeyPatterns = [
  /\bemail\b/i,
  /\bphone\b/i,
  /\bssn\b/i,
  /\bmrn\b/i,
  /\bmedical[_ -]?record[_ -]?number\b/i,
  /\bpatient[_ -]?name\b/i,
  /\bfirst[_ -]?name\b/i,
  /\blast[_ -]?name\b/i,
  /\baddress\b/i,
  /\bzip\b/i,
  /\bdob\b/i,
  /\bbirth[_ -]?date\b/i,
  /\bsite[_ -]?name\b/i,
  /\binvestigator[_ -]?name\b/i,
];

const valuePatterns = [
  { code: "email-like-value", pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i },
  { code: "ssn-like-value", pattern: /\b\d{3}-\d{2}-\d{4}\b/ },
  { code: "phone-like-value", pattern: /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/ },
];

const defaultScanRoots = null;
const textExtensions = new Set([".csv", ".json", ".ndjson", ".jsonl", ".txt", ".md"]);

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

const looksBlockedKey = (key) => blockedKeyPatterns.some((pattern) => pattern.test(key));

const splitCsvLine = (line) => {
  const fields = [];
  let current = "";
  let inQuote = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && inQuote && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (char === "," && !inQuote) {
      fields.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  fields.push(current.trim());
  return fields;
};

const collectJsonKeys = (value, keys = []) => {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectJsonKeys(item, keys);
    }
    return keys;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      keys.push(key);
      collectJsonKeys(child, keys);
    }
  }
  return keys;
};

const scanCsv = (relativePath, contents, issues) => {
  const [headerLine = "", ...rows] = contents.replace(/^\uFEFF/, "").split(/\r?\n/);
  const headers = splitCsvLine(headerLine);
  for (const [index, header] of headers.entries()) {
    if (looksBlockedKey(header)) {
      issues.push(issue("error", "phi-pii-column", "CSV header looks like PHI/PII.", {
        path: relativePath,
        column: header,
        columnIndex: index,
      }));
    }
  }

  for (const [rowIndex, row] of rows.entries()) {
    if (!row.trim()) {
      continue;
    }
    for (const [columnIndex, value] of splitCsvLine(row).entries()) {
      for (const { code, pattern } of valuePatterns) {
        if (pattern.test(value)) {
          issues.push(issue("error", code, "CSV value looks like PHI/PII.", {
            path: relativePath,
            row: rowIndex + 2,
            column: headers[columnIndex] ?? columnIndex,
          }));
        }
      }
    }
  }
};

const scanJson = (relativePath, contents, issues) => {
  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return;
  }
  for (const key of collectJsonKeys(parsed)) {
    if (looksBlockedKey(key)) {
      issues.push(issue("error", "phi-pii-json-key", "JSON key looks like PHI/PII.", {
        path: relativePath,
        key,
      }));
    }
  }
  for (const { code, pattern } of valuePatterns) {
    if (pattern.test(contents)) {
      issues.push(issue("error", code, "JSON content contains a value that looks like PHI/PII.", {
        path: relativePath,
      }));
    }
  }
};

const scanTextValues = (relativePath, contents, issues) => {
  for (const { code, pattern } of valuePatterns) {
    if (pattern.test(contents)) {
      issues.push(issue("error", code, "Text content contains a value that looks like PHI/PII.", {
        path: relativePath,
      }));
    }
  }
};

const configuredScanRoots = async () => {
  const roots = new Set(["data"]);
  try {
    const config = await readConfig();
    for (const app of config.apps ?? []) {
      if (app.dataPackSource) {
        roots.add(app.dataPackSource);
      }
      for (const dataPath of app.dataPaths ?? []) {
        roots.add(path.dirname(dataPath));
      }
    }
  } catch {
    // Fall back to generic roots when config is unavailable.
  }
  return [...roots].sort();
};

export const scanPhiPii = async ({
  scanRoots = defaultScanRoots,
  reportPath = path.join(reportsRoot, "phi-pii-scan.json"),
  writeReport = true,
} = {}) => {
  const issues = [];
  const scannedFiles = [];
  const effectiveScanRoots = scanRoots ?? (await configuredScanRoots());

  for (const scanRoot of effectiveScanRoots) {
    const absoluteRoot = path.resolve(rootDir, scanRoot);
    if (!(await exists(absoluteRoot))) {
      continue;
    }
    for (const file of await listFiles(absoluteRoot)) {
      const absolutePath = path.join(absoluteRoot, file);
      const metadata = await stat(absolutePath);
      if (metadata.size > 2_000_000) {
        continue;
      }
      const extension = path.extname(file).toLowerCase();
      if (!textExtensions.has(extension)) {
        continue;
      }
      const relativePath = toPosix(path.relative(rootDir, absolutePath));
      const contents = await readFile(absolutePath, "utf8");
      scannedFiles.push(relativePath);
      if (extension === ".csv") {
        scanCsv(relativePath, contents, issues);
      } else if (extension === ".json" || extension === ".jsonl" || extension === ".ndjson") {
        scanJson(relativePath, contents, issues);
      } else {
        scanTextValues(relativePath, contents, issues);
      }
    }
  }

  const result = {
    schemaVersion: 1,
    ok: issues.filter((item) => item.severity === "error").length === 0,
    checkedAt: new Date().toISOString(),
    dataClassification: "synthetic",
    regulatedUse: false,
    scanRoots: effectiveScanRoots.map(toPosix),
    scannedFileCount: scannedFiles.length,
    scannedFiles,
    issues,
  };

  if (writeReport) {
    await writeJson(reportPath, result);
  }
  return result;
};

const runCli = async () => {
  const options = parseOptions(process.argv.slice(2));
  const scanRoots = options.path
    ? [options.path]
  : options._.length
      ? options._
      : defaultScanRoots;
  const reportPath = options.report ? path.resolve(options.report) : path.join(reportsRoot, "phi-pii-scan.json");
  const result = await scanPhiPii({ scanRoots, reportPath });
  console.log(JSON.stringify({
    ok: result.ok,
    report: toPosix(path.relative(rootDir, reportPath)),
    scannedFiles: result.scannedFileCount,
    issues: result.issues.length,
  }, null, 2));
  if (!result.ok) {
    throw new Error(`PHI/PII guard failed. See ${toPosix(path.relative(rootDir, reportPath))}`);
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
