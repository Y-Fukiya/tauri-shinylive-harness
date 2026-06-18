import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseHarnessToml, rootDir } from "./harness-core.mjs";
import { validateClinicalDataPack } from "./clinical-data-pack-validator.mjs";

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
    assert.equal(codes.has("invalid-controlled-term"), true);
    assert.equal(codes.has("unknown-visit-reference"), true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
