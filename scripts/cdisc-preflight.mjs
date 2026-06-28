#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { clinicalDomains, controlledTerminology } from "./clinical-data-pack-validator.mjs";
import {
  appendAudit,
  exists,
  readConfig,
  reportsRoot,
  rootDir,
  sha256File,
  toPosix,
  writeJson,
} from "./harness-core.mjs";

const defaultMappingPath = path.join(rootDir, "mappings", "cdisc-demo-mapping.json");
const defaultSchemaPath = path.join(rootDir, "schemas", "cdisc-mapping.schema.json");
const defaultReportPath = path.join(reportsRoot, "cdisc-bridge-preflight.json");
const defaultMarkdownPath = path.join(rootDir, "docs", "generated", "cdisc-bridge-preflight.md");

const expectedTargetDomains = {
  demographics: "DM",
  visits: "SV",
  labs: "LB",
  vitals: "VS",
  adverse_events: "AE",
  concomitant_meds: "CM",
  exposure: "EX",
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

const issue = (severity, code, message, details = {}) => ({ severity, code, message, details });

const relative = (targetPath) => {
  if (!targetPath) {
    return null;
  }
  return toPosix(path.relative(rootDir, path.resolve(targetPath))) || ".";
};

const readJson = async (targetPath) => JSON.parse(await readFile(targetPath, "utf8"));

const summarizeIssues = (issues) => {
  const bySeverity = {};
  const byCode = {};
  for (const item of issues) {
    bySeverity[item.severity] = (bySeverity[item.severity] ?? 0) + 1;
    byCode[item.code] = byCode[item.code] ?? {
      count: 0,
      severity: item.severity,
      message: item.message,
    };
    byCode[item.code].count += 1;
  }
  return { bySeverity, byCode };
};

const validateMappingShape = (mapping, issues) => {
  if (mapping.schemaVersion !== 1) {
    issues.push(issue("error", "invalid-mapping-schema-version", "CDISC mapping must declare schemaVersion: 1."));
  }
  if (mapping.sourceSchema !== "tauri-shinylive-harness.synthetic-clinical-v1") {
    issues.push(issue("error", "invalid-source-schema", "CDISC mapping sourceSchema does not match this harness."));
  }
  if (!mapping.targetStandard || mapping.targetStandard.name !== "SDTM bridge") {
    issues.push(issue("error", "invalid-target-standard", "CDISC mapping targetStandard.name must be SDTM bridge."));
  }
  if (!mapping.domains || typeof mapping.domains !== "object" || Array.isArray(mapping.domains)) {
    issues.push(issue("error", "missing-mapping-domains", "CDISC mapping must include a domains object."));
  }
};

const evaluateCoverage = (mapping, issues) => {
  const missingDomains = [];
  const missingColumns = [];
  const targetMismatches = [];
  const controlledTermColumns = [];
  const localCtGaps = [];

  for (const [domainName, spec] of Object.entries(clinicalDomains)) {
    const mappedDomain = mapping.domains?.[domainName];
    if (!mappedDomain) {
      missingDomains.push(domainName);
      issues.push(issue("error", "missing-domain-mapping", "A synthetic domain has no CDISC bridge mapping.", { domain: domainName }));
      continue;
    }

    const expectedTarget = expectedTargetDomains[domainName];
    if (expectedTarget && mappedDomain.targetDomain !== expectedTarget) {
      targetMismatches.push({ domain: domainName, expected: expectedTarget, actual: mappedDomain.targetDomain });
      issues.push(issue("error", "target-domain-mismatch", "A CDISC bridge target domain does not match the expected demo subset.", {
        domain: domainName,
        expected: expectedTarget,
        actual: mappedDomain.targetDomain,
      }));
    }

    for (const column of spec.requiredColumns) {
      const mappedColumn = mappedDomain.columns?.[column];
      if (!mappedColumn) {
        missingColumns.push({ domain: domainName, column });
        issues.push(issue("error", "missing-column-mapping", "A required synthetic column has no CDISC bridge mapping.", {
          domain: domainName,
          column,
        }));
        continue;
      }
      if (mappedColumn.relationship === "controlled-term") {
        controlledTermColumns.push({
          domain: domainName,
          column,
          target: mappedColumn.target,
          localTerminology: Boolean(controlledTerminology[domainName]?.[column]),
        });
        if (!controlledTerminology[domainName]?.[column]) {
          localCtGaps.push({ domain: domainName, column, target: mappedColumn.target });
          issues.push(issue("warning", "controlled-term-not-localized", "A mapped controlled term does not yet have a local codelist.", {
            domain: domainName,
            column,
            target: mappedColumn.target,
          }));
        }
      }
    }
  }

  for (const [domainName, columns] of Object.entries(controlledTerminology)) {
    for (const column of Object.keys(columns)) {
      const mappedColumn = mapping.domains?.[domainName]?.columns?.[column];
      if (mappedColumn && mappedColumn.relationship !== "controlled-term") {
        issues.push(issue("warning", "local-ct-not-marked-controlled", "A locally validated controlled term is not marked controlled-term in the CDISC bridge.", {
          domain: domainName,
          column,
          target: mappedColumn.target,
          relationship: mappedColumn.relationship,
        }));
      }
    }
  }

  return {
    expectedDomainCount: Object.keys(clinicalDomains).length,
    mappedDomainCount: Object.keys(mapping.domains ?? {}).length,
    missingDomains,
    missingColumns,
    targetMismatches,
    requiredColumnCount: Object.values(clinicalDomains).reduce((total, spec) => total + spec.requiredColumns.length, 0),
    mappedRequiredColumnCount:
      Object.entries(clinicalDomains).reduce((total, [domainName, spec]) => {
        const mappedColumns = mapping.domains?.[domainName]?.columns ?? {};
        return total + spec.requiredColumns.filter((column) => mappedColumns[column]).length;
      }, 0),
    controlledTerminology: {
      locallyValidatedColumnCount: Object.values(controlledTerminology).reduce(
        (total, domainTerms) => total + Object.keys(domainTerms).length,
        0,
      ),
      mappedControlledTermColumnCount: controlledTermColumns.length,
      localCtGaps,
      columns: controlledTermColumns,
    },
  };
};

const evaluatePinnacle21 = async ({ pinnacleCli, pinnacleConfig }, issues) => {
  const executable = pinnacleCli ?? process.env.PINNACLE21_CLI ?? process.env.P21_CLI ?? "";
  const configPath = pinnacleConfig ?? process.env.PINNACLE21_CONFIG ?? "";
  const result = {
    configured: Boolean(executable),
    executable: executable || null,
    config: configPath || null,
    runMode: "not-executed",
    note: "Preflight records handoff readiness only. It does not execute external validation by default.",
  };

  if (!executable) {
    issues.push(issue("warning", "pinnacle21-cli-not-configured", "Pinnacle 21 CLI is not configured for handoff validation.", {
      expectedEnv: ["PINNACLE21_CLI", "P21_CLI"],
    }));
    return result;
  }

  if (!(await exists(executable))) {
    issues.push(issue("error", "pinnacle21-cli-missing", "Configured Pinnacle 21 CLI path does not exist.", { executable }));
    return result;
  }

  result.executableSha256 = await sha256File(executable);
  if (configPath && !(await exists(configPath))) {
    issues.push(issue("error", "pinnacle21-config-missing", "Configured Pinnacle 21 config path does not exist.", { config: configPath }));
  }
  if (configPath && (await exists(configPath))) {
    result.configSha256 = await sha256File(configPath);
  }
  return result;
};

const markdownReport = (result) => [
  `# CDISC Bridge Preflight`,
  "",
  `Generated: ${result.checkedAt}`,
  `Project: ${result.project.name} ${result.project.version}`,
  `Mapping: \`${result.mapping.path}\``,
  `Schema: \`${result.schema.path}\``,
  "",
  "## Status",
  "",
  `- Preflight OK: ${result.ok ? "yes" : "no"}`,
  `- Submission ready: ${result.submissionReady ? "yes" : "no"}`,
  `- Target standard: ${result.targetStandard.name} ${result.targetStandard.version}`,
  `- Pinnacle 21 CLI configured: ${result.pinnacle21.configured ? "yes" : "no"}`,
  "",
  "## Coverage",
  "",
  `- Domains mapped: ${result.coverage.mappedDomainCount}/${result.coverage.expectedDomainCount}`,
  `- Required columns mapped: ${result.coverage.mappedRequiredColumnCount}/${result.coverage.requiredColumnCount}`,
  `- Local controlled terminology columns: ${result.coverage.controlledTerminology.locallyValidatedColumnCount}`,
  `- Mapped controlled-term columns: ${result.coverage.controlledTerminology.mappedControlledTermColumnCount}`,
  "",
  "## Limitations",
  "",
  ...result.limitations.map((item) => `- ${item}`),
  "",
  "## Issues",
  "",
  "| Severity | Code | Message |",
  "| --- | --- | --- |",
  ...result.issues.map((item) => `| ${item.severity} | ${item.code} | ${item.message} |`),
  "",
].join("\n");

export const runCdiscPreflight = async ({
  mappingPath = defaultMappingPath,
  schemaPath = defaultSchemaPath,
  reportPath = defaultReportPath,
  markdownPath = defaultMarkdownPath,
  pinnacleCli = undefined,
  pinnacleConfig = undefined,
  writeOutputs = true,
} = {}) => {
  const checkedAt = new Date().toISOString();
  const issues = [
    issue(
      "warning",
      "demo-bridge-not-submission-ready",
      "This mapping is a synthetic-data bridge for demos and is not a submission-ready SDTM/ADaM implementation.",
    ),
    issue("warning", "define-xml-not-generated", "define.xml generation is outside the current harness scope."),
    issue("warning", "adam-layer-not-generated", "ADaM dataset import/export is outside the current harness scope."),
    issue("warning", "full-cdisc-ct-package-not-bundled", "A full CDISC controlled terminology package is not bundled."),
  ];

  const config = await readConfig();
  if (!(await exists(mappingPath))) {
    issues.push(issue("error", "mapping-file-missing", "CDISC mapping file is missing.", { path: relative(mappingPath) }));
  }
  if (!(await exists(schemaPath))) {
    issues.push(issue("error", "mapping-schema-missing", "CDISC mapping schema file is missing.", { path: relative(schemaPath) }));
  }

  const mapping = (await exists(mappingPath)) ? await readJson(mappingPath) : {};
  const schema = (await exists(schemaPath)) ? await readJson(schemaPath) : {};
  validateMappingShape(mapping, issues);
  const coverage = evaluateCoverage(mapping, issues);
  const pinnacle21 = await evaluatePinnacle21({ pinnacleCli, pinnacleConfig }, issues);
  const summary = summarizeIssues(issues);
  const errorCount = issues.filter((item) => item.severity === "error").length;

  const result = {
    schemaVersion: 1,
    ok: errorCount === 0,
    submissionReady: false,
    checkedAt,
    project: config.project,
    mapping: {
      path: relative(mappingPath),
      sha256: (await exists(mappingPath)) ? await sha256File(mappingPath) : null,
    },
    schema: {
      path: relative(schemaPath),
      id: schema.$id ?? null,
      sha256: (await exists(schemaPath)) ? await sha256File(schemaPath) : null,
    },
    sourceSchema: mapping.sourceSchema ?? null,
    targetStandard: mapping.targetStandard ?? { name: "unknown", version: "unknown", note: "" },
    controlledTerminology: {
      source: "local-demo",
      cdiscCtVersion: "demo-subset",
      lastReviewed: "2026-06-28",
      notFullCdiscCtPackage: true,
    },
    coverage,
    pinnacle21,
    limitations: [
      "Synthetic clinical schema is the source of truth for this demo harness.",
      "SDTM mapping is descriptive and requires formal review before regulated use.",
      "ADaM import/export is not implemented.",
      "define.xml generation is not implemented.",
      "External Pinnacle 21 validation is a handoff point, not an embedded validation result.",
    ],
    summary,
    issues,
  };

  if (writeOutputs) {
    await writeJson(reportPath, result);
    await mkdir(path.dirname(markdownPath), { recursive: true });
    await writeFile(markdownPath, `${markdownReport(result)}\n`);
    await appendAudit("cdisc-preflight", result.ok ? "ok" : "failed", {
      report: relative(reportPath),
      errors: errorCount,
      warnings: issues.filter((item) => item.severity === "warning").length,
      submissionReady: result.submissionReady,
    });
  }

  return result;
};

const runCli = async () => {
  const options = parseOptions(process.argv.slice(2));
  const result = await runCdiscPreflight({
    mappingPath: options.mapping ? path.resolve(options.mapping) : defaultMappingPath,
    schemaPath: options.schema ? path.resolve(options.schema) : defaultSchemaPath,
    reportPath: options.report ? path.resolve(options.report) : defaultReportPath,
    markdownPath: options.markdown ? path.resolve(options.markdown) : defaultMarkdownPath,
    pinnacleCli: options["pinnacle21-cli"] === true ? undefined : options["pinnacle21-cli"],
    pinnacleConfig: options["pinnacle21-config"] === true ? undefined : options["pinnacle21-config"],
  });
  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        submissionReady: result.submissionReady,
        report: relative(options.report ? path.resolve(options.report) : defaultReportPath),
        errors: result.summary.bySeverity.error ?? 0,
        warnings: result.summary.bySeverity.warning ?? 0,
      },
      null,
      2,
    ),
  );
  if (!result.ok) {
    throw new Error("CDISC bridge preflight failed.");
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
