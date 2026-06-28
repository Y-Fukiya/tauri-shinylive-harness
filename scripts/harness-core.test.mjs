import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseHarnessToml, rootDir } from "./harness-core.mjs";
import { validateClinicalDataPack } from "./clinical-data-pack-validator.mjs";
import { buildReleaseSmokePlan, renderReleaseSmokeMarkdown } from "./release-smoke-plan.mjs";
import { verifyReleaseArtifacts } from "./release-verifier.mjs";
import { auditTauriSecurity } from "./tauri-security-audit.mjs";
import { createReproducibilityReport } from "./reproducibility-report.mjs";
import { runCdiscPreflight } from "./cdisc-preflight.mjs";
import { exportReportPdfs } from "./pdf-report-exporter.mjs";
import { generateEvidenceIndex, writeReviewSignoff } from "./review-evidence.mjs";
import { createTemplatePackage } from "./template-package.mjs";
import { scanPhiPii } from "./phi-pii-guard.mjs";
import { verifyOfflineBundle } from "./offline-verify.mjs";

const invalidClinicalFixtureIds = [
  "missing-required-column",
  "invalid-controlled-term",
  "duplicate-subject",
  "impossible-date-order",
  "ae-without-subject",
  "lab-without-visit",
  "exposure-negative-dose",
  "malformed-csv",
];

const updateCsv = async (filePath, updater) => {
  const text = await readFile(filePath, "utf8");
  await writeFile(filePath, updater(text));
};

const removeCsvColumn = (text, column) => {
  const lines = text.trimEnd().split(/\r?\n/);
  const headers = lines[0].split(",");
  const columnIndex = headers.indexOf(column);
  assert.notEqual(columnIndex, -1, `Expected fixture source column ${column}`);
  return `${lines
    .map((line) => line.split(",").filter((_, index) => index !== columnIndex).join(","))
    .join("\n")}\n`;
};

const applyFixtureMutation = async (dataDir, mutation) => {
  const filePath = path.join(dataDir, mutation.file);
  if (mutation.type === "removeColumn") {
    await updateCsv(filePath, (text) => removeCsvColumn(text, mutation.column));
    return;
  }
  if (mutation.type === "replaceText") {
    await updateCsv(filePath, (text) => {
      assert.match(text, new RegExp(mutation.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      return text.replace(mutation.search, mutation.replace);
    });
    return;
  }
  if (mutation.type === "duplicateFirstDataRow") {
    await updateCsv(filePath, (text) => {
      const lines = text.trimEnd().split(/\r?\n/);
      assert.equal(lines.length > 1, true);
      return `${lines.concat(lines[1]).join("\n")}\n`;
    });
    return;
  }
  if (mutation.type === "writeFile") {
    await writeFile(filePath, mutation.contents);
    return;
  }
  throw new Error(`Unknown fixture mutation type: ${mutation.type}`);
};

const applyFixtureMutations = async (dataDir, mutations = []) => {
  for (const mutation of mutations) {
    await applyFixtureMutation(dataDir, mutation);
  }
};

test("parseHarnessToml preserves quoted commas and hashes inside arrays", () => {
  const config = parseHarnessToml(`
[project]
name = "demo"
version = "1.2.3"
portal_title = "Demo Portal"
bundle_name = "Demo Bundle"

[distribution]
artifact_name = "demo"
mac_bundles = ["app"]
windows_bundles = ["nsis"]

[[apps]]
id = "demo-app"
title = "Demo App"
kind = "shinylive-r"
source = "shinylive-src/demo-app"
output = "apps/demo-app"
path = "/apps/demo-app/index.html"
smoke_text = ["Hello, world", "second", "hash # inside", "escaped \\"quote\\"",]
header_probes = ["index.html", "shinylive/webr/R.wasm",]
`);

  assert.deepEqual(config.apps[0].smokeText, [
    "Hello, world",
    "second",
    "hash # inside",
    'escaped "quote"',
  ]);
});

test("data pack aggregate hash is independent of repository placement", async () => {
  const registryResult = await validateClinicalDataPack({
    dataDir: path.join(rootDir, "data-packs", "clinical-demo-subject-profile-v1"),
    dataPackId: "clinical-demo-subject-profile-v1",
    writeOutputs: false,
  });
  const appResult = await validateClinicalDataPack({
    dataDir: path.join(rootDir, "shinylive-src", "subject-profile-reference", "data"),
    dataPackId: "clinical-demo-subject-profile-v1",
    writeOutputs: false,
  });

  assert.equal(registryResult.ok, true);
  assert.equal(appResult.ok, true);
  assert.equal(registryResult.dataPack.sha256, appResult.dataPack.sha256);
});

for (const fixtureId of invalidClinicalFixtureIds) {
  test(`clinical data invalid fixture fails as expected: ${fixtureId}`, async () => {
    const fixtureRoot = path.join(rootDir, "fixtures", "invalid-data-packs", fixtureId);
    const fixture = JSON.parse(await readFile(path.join(fixtureRoot, "fixture.json"), "utf8"));
    const expected = JSON.parse(await readFile(path.join(fixtureRoot, "expected.json"), "utf8"));
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), `harness-${fixtureId}-fixture-`));
    const tempPack = path.join(tempRoot, fixture.baseDataPack);

    try {
      await cp(path.join(rootDir, "data-packs", fixture.baseDataPack), tempPack, {
        recursive: true,
      });
      await applyFixtureMutations(tempPack, fixture.mutations);

      const result = await validateClinicalDataPack({
        dataDir: tempPack,
        dataPackId: fixture.baseDataPack,
        writeOutputs: false,
      });
      const codes = new Set(result.issues.map((issue) => issue.code));
      const severities = new Set(result.issues.map((issue) => issue.severity));

      assert.equal(result.ok, expected.expectedOk);
      for (const code of expected.expectedCodes) {
        assert.equal(codes.has(code), true, `Expected issue code ${code}`);
      }
      for (const severity of expected.expectedSeverities ?? []) {
        assert.equal(severities.has(severity), true, `Expected issue severity ${severity}`);
      }
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
}

test("clinical data validator accepts documented CSV dialect features", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-csv-dialect-test-"));
  const tempPack = path.join(tempRoot, "clinical-demo-subject-profile-v1");

  try {
    await cp(path.join(rootDir, "data-packs", "clinical-demo-subject-profile-v1"), tempPack, {
      recursive: true,
    });
    const demographicsPath = path.join(tempPack, "demographics.csv");
    await updateCsv(demographicsPath, (text) =>
      text
        .replace("SUBJ-001,SITE-203,Active,F,54,Asian,", "SUBJ-001,SITE-203,Active,F,54,\"Asian, synthetic\",")
        .replace(",Europe,61.0,", ",\"Europe\nSynthetic\",61.0,"),
    );

    const result = await validateClinicalDataPack({
      dataDir: tempPack,
      dataPackId: "clinical-demo-subject-profile-v1",
      writeOutputs: false,
    });

    assert.equal(result.ok, true);
    assert.equal(result.summary.errorCount, 0);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("clinical data validator catches controlled term and visit reference failures", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-data-pack-test-"));
  const tempPack = path.join(tempRoot, "clinical-demo-subject-profile-v1");

  try {
    await cp(path.join(rootDir, "data-packs", "clinical-demo-subject-profile-v1"), tempPack, {
      recursive: true,
    });

    const aePath = path.join(tempPack, "adverse_events.csv");
    const aeCsv = await readFile(aePath, "utf8");
    await writeFile(aePath, aeCsv.replace(",Mild,", ",Extreme,"));

    const labsPath = path.join(tempPack, "labs.csv");
    const labsCsv = await readFile(labsPath, "utf8");
    await writeFile(labsPath, labsCsv.replace(",Baseline,1,", ",Unscheduled,1,"));

    const result = await validateClinicalDataPack({
      dataDir: tempPack,
      dataPackId: "clinical-demo-subject-profile-v1",
      writeOutputs: false,
    });
    const codes = new Set(result.issues.map((issue) => issue.code));

    assert.equal(result.ok, false);
    assert.equal(result.summary.issuesByCode["invalid-controlled-term"].count, 1);
    assert.equal(result.summary.issuesBySubject["SUBJ-001"].count >= 1, true);
    assert.equal(codes.has("invalid-controlled-term"), true);
    assert.equal(codes.has("unknown-visit-reference"), true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("clinical data validator catches cross-domain timeline inconsistencies", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-cross-domain-test-"));
  const tempPack = path.join(tempRoot, "clinical-demo-subject-profile-v1");

  try {
    await cp(path.join(rootDir, "data-packs", "clinical-demo-subject-profile-v1"), tempPack, {
      recursive: true,
    });

    const aePath = path.join(tempPack, "adverse_events.csv");
    const aeCsv = await readFile(aePath, "utf8");
    await writeFile(
      aePath,
      aeCsv
        .replace(
          "SUBJ-001,AE-001,Headache,Nervous system disorders,9,11,Mild,N,Possible,Resolved",
          "SUBJ-001,AE-001,Headache,Nervous system disorders,-5,11,Mild,N,Possible,Resolved",
        )
        .replace(
          "SUBJ-002,AE-004,Fatigue,General disorders,18,22,Mild,N,Unrelated,Resolved",
          "SUBJ-002,AE-004,Fatigue,General disorders,18,22,Mild,N,Possible,Resolved",
        ),
    );

    const labsPath = path.join(tempPack, "labs.csv");
    const labsCsv = await readFile(labsPath, "utf8");
    await writeFile(labsPath, labsCsv.replaceAll(",ALT,", ",AST,"));

    const medsPath = path.join(tempPack, "concomitant_meds.csv");
    const medsCsv = await readFile(medsPath, "utf8");
    await writeFile(medsPath, medsCsv.replace("SUBJ-001,Ondansetron,Nausea,18,22,N", "SUBJ-001,Ondansetron,Vertigo,18,22,N"));

    const exposurePath = path.join(tempPack, "exposure.csv");
    const exposureCsv = await readFile(exposurePath, "utf8");
    await writeFile(
      exposurePath,
      exposureCsv.replace("SUBJ-001,2,29,56,100,Completed,97", "SUBJ-001,2,20,56,100,Completed,97"),
    );

    const result = await validateClinicalDataPack({
      dataDir: tempPack,
      dataPackId: "clinical-demo-subject-profile-v1",
      writeOutputs: false,
    });
    const codes = new Set(result.issues.map((issue) => issue.code));

    assert.equal(result.ok, false);
    assert.equal(codes.has("ae-before-first-exposure"), true);
    assert.equal(codes.has("related-ae-without-active-exposure"), true);
    assert.equal(codes.has("lab-ae-without-supporting-lab"), true);
    assert.equal(codes.has("medication-indication-without-ae"), true);
    assert.equal(codes.has("overlapping-exposure-interval"), true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("release smoke plan captures platform install, offline, and app smoke evidence", () => {
  const plan = buildReleaseSmokePlan({
    config: {
      project: { bundleName: "Demo Harness", version: "1.0.0" },
      distribution: { artifactName: "demo-harness", releaseChannel: "internal" },
      apps: [
        {
          id: "subject-profile-reference",
          title: "Subject Profile",
          smokeText: ["SUBJ-001 AE count: 3", "Data pack hash"],
          domProbes: ["#overview_lab_trend img"],
        },
      ],
    },
    context: {
      releaseTag: "v1.0.0",
      gitCommit: "abc123",
      gitBranch: "main",
      platform: "Windows 11 x64",
    },
    platform: "windows",
  });
  const markdown = renderReleaseSmokeMarkdown(plan);

  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.platform, "windows");
  assert.equal(plan.apps[0].smokeText.length, 2);
  assert.match(markdown, /Install the NSIS setup executable/);
  assert.match(markdown, /Disable network access/);
  assert.match(markdown, /\/__harness\/integrity/);
  assert.match(markdown, /SUBJ-001 AE count: 3/);
});

test("verifyReleaseArtifacts validates checksums and required validation-pack evidence", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-release-verify-test-"));
  const releaseRoot = path.join(tempRoot, "release");
  const validationRoot = path.join(releaseRoot, "validation-pack");
  const evidenceRoot = path.join(validationRoot, "evidence");

  try {
    await mkdir(evidenceRoot, { recursive: true });
    const files = new Map([
      ["RELEASE_NOTES.md", "# Demo\n\nNot for clinical decision making.\n"],
      ["release-summary.json", "{}\n"],
      ["validation-pack.zip", "zip-placeholder\n"],
      ["validation-pack/release-smoke-plan.json", JSON.stringify({ schemaVersion: 1, apps: [] }, null, 2)],
      ["validation-pack/release-smoke-test.md", "# Smoke\n"],
      ["validation-pack/evidence-index.json", "{}\n"],
      ["validation-pack/evidence/static-verification.json", "{}\n"],
      ["validation-pack/evidence/e2e-diagnostics.json", "{}\n"],
      ["validation-pack/evidence/bundle-integrity.json", "{}\n"],
      ["validation-pack/evidence/tauri-security-audit.json", "{}\n"],
      ["validation-pack/evidence/phi-pii-scan.json", "{}\n"],
      ["validation-pack/evidence/reproducibility.json", "{}\n"],
      ["validation-pack/evidence/offline-verification.json", "{}\n"],
      ["validation-pack/evidence/harness-config-validation.json", "{}\n"],
      ["validation-pack/evidence/clinical-data-pack-validation.json", "{}\n"],
      ["validation-pack/evidence/clinical-data-dictionary.md", "# Dictionary\n"],
      ["validation-pack/evidence/cdisc-bridge-preflight.json", "{}\n"],
      ["validation-pack/evidence/pdf-report-export-manifest.json", "{}\n"],
      ["validation-pack/evidence/review-signoff.json", "{}\n"],
      ["validation-pack/evidence/review-signoff-history.jsonl", "{}\n"],
      ["validation-pack/evidence/evidence-index.html", "<!doctype html>\n"],
      ["validation-pack/evidence/portal-manifest.json", "{}\n"],
      ["validation-pack/evidence/harness-bundle-manifest.json", "{}\n"],
      ["validation-pack/evidence/release-summary.json", "{}\n"],
    ]);

    for (const [relativePath, contents] of files) {
      const targetPath = path.join(releaseRoot, relativePath);
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, contents);
    }

    const checksumLines = [];
    for (const relativePath of files.keys()) {
      const targetPath = path.join(releaseRoot, relativePath);
      const data = await readFile(targetPath);
      const { createHash } = await import("node:crypto");
      checksumLines.push(`${createHash("sha256").update(data).digest("hex")}  ${relativePath}`);
    }
    await writeFile(path.join(releaseRoot, "SHA256SUMS"), `${checksumLines.join("\n")}\n`);

    const result = await verifyReleaseArtifacts({
      releaseRoot,
      reportPath: path.join(tempRoot, "release-artifact-verification.json"),
      writeReport: true,
    });

    assert.equal(result.ok, true);
    assert.equal(result.summary.errorCount, 0);
    assert.equal(result.summary.checksumCount, files.size);
    assert.equal(result.releaseSmokePlan.schemaVersion, 1);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("auditTauriSecurity passes the current local-first Tauri configuration", async () => {
  const result = await auditTauriSecurity({ writeReport: false });

  assert.equal(result.ok, true);
  assert.equal(result.summary.errorCount, 0);
  assert.equal(result.checks.some((check) => check.id === "capabilities-minimal" && check.ok), true);
  assert.equal(result.checks.some((check) => check.id === "localhost-navigation-only" && check.ok), true);
});

test("createReproducibilityReport records pinned runtimes and source hashes", async () => {
  const result = await createReproducibilityReport({ writeReport: false, includeAssetHashes: false });

  assert.equal(result.ok, true);
  assert.equal(result.pins.node, "24.0.0");
  assert.equal(result.pins.rustToolchain.channel, "1.93.1");
  assert.equal(result.files.some((file) => file.path === "package-lock.json" && file.sha256), true);
});

test("CDISC preflight covers the synthetic schema without claiming submission readiness", async () => {
  const result = await runCdiscPreflight({ writeOutputs: false, pinnacleCli: null });
  const errorCount = result.issues.filter((issue) => issue.severity === "error").length;
  const codes = new Set(result.issues.map((issue) => issue.code));

  assert.equal(result.ok, true);
  assert.equal(errorCount, 0);
  assert.equal(result.submissionReady, false);
  assert.equal(result.coverage.missingDomains.length, 0);
  assert.equal(codes.has("demo-bridge-not-submission-ready"), true);
});

test("PDF report exporter creates companion PDFs from exported HTML manifest", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-pdf-export-test-"));

  try {
    const htmlPath = path.join(tempRoot, "subject-snapshot.html");
    const manifestPath = path.join(tempRoot, "report-export-manifest.json");
    const outputRoot = path.join(tempRoot, "pdf");
    await writeFile(
      htmlPath,
      "<!doctype html><html><body><h1>Subject Snapshot</h1><p>Not for clinical decision making.</p><table><tr><td>SUBJ-001</td></tr></table></body></html>",
    );
    await writeFile(
      manifestPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          generatedAt: "2026-01-01T00:00:00.000Z",
          project: { name: "demo", version: "1.0.0" },
          clinicalUseLimitation: "Synthetic demo only.",
          appResults: [
            {
              appId: "subject-profile-reference",
              reports: [
                {
                  templateId: "subject-snapshot",
                  title: "Subject Snapshot",
                  subjectId: "SUBJ-001",
                  path: htmlPath,
                  sha256: "source-hash",
                },
              ],
            },
          ],
        },
        null,
        2,
      ),
    );

    const result = await exportReportPdfs({
      reportManifestPath: manifestPath,
      outputRoot,
      reportPath: path.join(tempRoot, "pdf-report-export-manifest.json"),
      markdownPath: path.join(tempRoot, "pdf-report-index.md"),
      writeOutputs: true,
    });
    const pdfPath = result.appResults[0].reports[0].absolutePath;
    const pdf = await readFile(pdfPath, "utf8");

    assert.equal(result.ok, true);
    assert.equal(result.summary.pdfCount, 1);
    assert.match(pdf, /^%PDF-1\.4/);
    assert.match(pdf, /PDF role: companion artifact/);
    assert.equal(result.appResults[0].reports[0].path.endsWith(".pdf"), true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("PHI guard fails suspicious headers and values", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-phi-guard-test-"));

  try {
    await writeFile(
      path.join(tempRoot, "bad.csv"),
      "subject_id,patient_name,email\nSUBJ-001,Example Person,person@example.com\n",
    );
    const result = await scanPhiPii({
      scanRoots: [tempRoot],
      reportPath: path.join(tempRoot, "phi-pii-scan.json"),
      writeReport: true,
    });
    const codes = new Set(result.issues.map((issue) => issue.code));

    assert.equal(result.ok, false);
    assert.equal(codes.has("phi-pii-column"), true);
    assert.equal(codes.has("email-like-value"), true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("offline verifier fails external URLs in bundled text assets", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-offline-verify-test-"));

  try {
    await mkdir(path.join(tempRoot, "portal"), { recursive: true });
    await writeFile(path.join(tempRoot, "portal", "index.html"), '<script src="https://cdn.example.test/app.js"></script>');
    const result = await verifyOfflineBundle({
      targetRoot: tempRoot,
      reportPath: path.join(tempRoot, "offline-verification.json"),
      writeReport: true,
    });

    assert.equal(result.ok, false);
    assert.equal(result.issues[0].code, "external-url-reference");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("review signoff and evidence index persist reviewer workflow evidence", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-review-evidence-test-"));

  try {
    const evidenceFile = path.join(tempRoot, "clinical-data-pack-validation.json");
    await writeFile(evidenceFile, "{}\n");
    const signoff = await writeReviewSignoff({
      status: "approved",
      reviewer: "QA Reviewer",
      role: "Validation",
      decision: "approved-for-demo",
      notes: "Synthetic demo evidence reviewed.",
      reportPath: path.join(tempRoot, "review-signoff.json"),
      historyPath: path.join(tempRoot, "review-signoff-history.jsonl"),
      appendHistory: true,
    });
    const index = await generateEvidenceIndex({
      signoffPath: path.join(tempRoot, "review-signoff.json"),
      jsonPath: path.join(tempRoot, "evidence-index.json"),
      htmlPath: path.join(tempRoot, "evidence-index.html"),
      markdownPath: path.join(tempRoot, "evidence-index.md"),
      sources: [
        {
          id: "clinical-data",
          label: "Clinical data validation",
          category: "validation",
          path: evidenceFile,
          required: true,
        },
      ],
    });
    const history = await readFile(path.join(tempRoot, "review-signoff-history.jsonl"), "utf8");

    assert.equal(signoff.current.status, "approved");
    assert.match(history, /QA Reviewer/);
    assert.equal(index.ok, true);
    assert.equal(index.summary.presentRequiredCount, 1);
    assert.equal(index.evidence[0].sha256.length, 64);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("template package creates a reusable starter manifest", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "harness-template-package-test-"));

  try {
    const result = await createTemplatePackage({
      outputRoot: tempRoot,
      includePaths: ["package.json", "harness.toml", "schemas/cdisc-mapping.schema.json"],
      reportPath: path.join(tempRoot, "template-package-manifest.json"),
      writeReport: true,
    });

    assert.equal(result.ok, true);
    assert.equal(result.summary.includedFileCount, 4);
    assert.equal(result.files.some((file) => file.path === "package.json"), true);
    assert.equal(result.npmPackage.bin, "tauri-shinylive-harness");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
