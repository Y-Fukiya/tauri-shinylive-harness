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
      ["validation-pack.zip", "zip-placeholder\n"],
      ["validation-pack/release-smoke-plan.json", JSON.stringify({ schemaVersion: 1, apps: [] }, null, 2)],
      ["validation-pack/release-smoke-test.md", "# Smoke\n"],
      ["validation-pack/evidence-index.json", "{}\n"],
      ["validation-pack/evidence/static-verification.json", "{}\n"],
      ["validation-pack/evidence/e2e-diagnostics.json", "{}\n"],
      ["validation-pack/evidence/bundle-integrity.json", "{}\n"],
      ["validation-pack/evidence/tauri-security-audit.json", "{}\n"],
      ["validation-pack/evidence/reproducibility.json", "{}\n"],
      ["validation-pack/evidence/harness-config-validation.json", "{}\n"],
      ["validation-pack/evidence/clinical-data-pack-validation.json", "{}\n"],
      ["validation-pack/evidence/clinical-data-dictionary.md", "# Dictionary\n"],
      ["validation-pack/evidence/portal-manifest.json", "{}\n"],
      ["validation-pack/evidence/harness-bundle-manifest.json", "{}\n"],
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
  assert.equal(result.pins.node, "24");
  assert.equal(result.pins.rustToolchain.channel, "1.93.1");
  assert.equal(result.files.some((file) => file.path === "package-lock.json" && file.sha256), true);
});
