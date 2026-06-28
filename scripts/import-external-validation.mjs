#!/usr/bin/env node
import { cp, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { exists, listFiles, reportsRoot, rootDir, sha256File, toPosix, writeJson } from "./harness-core.mjs";

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

const options = parseOptions(process.argv.slice(2));
const type = options.type === true ? "" : options.type ?? "";
const input = options.input === true ? "" : options.input ?? "";
const study = options.study === true ? "" : options.study ?? "";

if (!type || !input || !study) {
  throw new Error("Usage: node scripts/import-external-validation.mjs --type pinnacle21 --input ./p21-output --study STUDY001");
}

const source = path.resolve(input);
if (!(await exists(source))) {
  throw new Error(`External validation input does not exist: ${source}`);
}

const destinationRoot = path.join(reportsRoot, "external-validation", type, study);
await mkdir(destinationRoot, { recursive: true });

const sourceMetadata = await stat(source);
if (sourceMetadata.isDirectory()) {
  await cp(source, destinationRoot, { recursive: true, force: true });
} else {
  await cp(source, path.join(destinationRoot, path.basename(source)), { force: true });
}

const files = [];
for (const file of (await listFiles(destinationRoot)).sort()) {
  const targetPath = path.join(destinationRoot, file);
  const metadata = await stat(targetPath);
  files.push({
    path: toPosix(path.join("reports", "external-validation", type, study, file)),
    size: metadata.size,
    sha256: await sha256File(targetPath),
  });
}

const summary = {
  schemaVersion: 1,
  importedAt: new Date().toISOString(),
  type,
  study,
  source: path.isAbsolute(input) ? input : toPosix(input),
  boundary: "Imported external validation evidence is archived for review. The harness does not certify the external validator result.",
  files,
};

const summaryPath = path.join(reportsRoot, "external-validation", `${type}-summary.json`);
const markdownPath = path.join(reportsRoot, "external-validation", `${type}-summary.md`);
await writeJson(summaryPath, summary);
await mkdir(path.dirname(markdownPath), { recursive: true });
await import("node:fs/promises").then(({ writeFile }) =>
  writeFile(
    markdownPath,
    [
      `# External Validation Summary: ${type}`,
      "",
      `Imported: ${summary.importedAt}`,
      `Study: ${study}`,
      "",
      summary.boundary,
      "",
      "| File | SHA-256 |",
      "| --- | --- |",
      ...files.map((file) => `| ${file.path} | ${file.sha256} |`),
      "",
    ].join("\n"),
  ),
);

console.log(JSON.stringify({ ok: true, report: toPosix(path.relative(rootDir, summaryPath)), files: files.length }, null, 2));
