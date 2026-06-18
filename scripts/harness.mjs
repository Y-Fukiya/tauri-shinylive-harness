#!/usr/bin/env node
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  clinicalDomains,
  validateClinicalDataPack,
  validateConfiguredDataPacks,
} from "./clinical-data-pack-validator.mjs";
import {
  appendAudit,
  appToManifest,
  configPath,
  exists,
  prepareDist,
  readConfig,
  rootDir,
  runCommand,
  validateHarnessConfig,
  verifyBundleArtifacts,
  writeJson,
} from "./harness-core.mjs";
import { exportReports } from "./report-exporter.mjs";

const command = process.argv[2] ?? "help";
const args = process.argv.slice(3);

const usage = `Usage:
  node scripts/harness.mjs new <directory> [--name name] [--portal-title "Title"] [--bundle-name "Bundle"]
  node scripts/harness.mjs add-app <id> [--title "Title"] [--template subject-profile]
  node scripts/harness.mjs add-data-pack <app-id> <data-dir> [--id data-pack-id] [--copy]
  node scripts/harness.mjs validate-config
  node scripts/harness.mjs validate-data [app-id] [--data-dir dir] [--id data-pack-id]
  node scripts/harness.mjs list
  node scripts/harness.mjs doctor
  node scripts/harness.mjs export [app-id]
  node scripts/harness.mjs export-reports [--app app-id] [--subject subject-id] [--all-subjects]
  node scripts/harness.mjs prepare
  node scripts/harness.mjs verify-static
  node scripts/harness.mjs verify [--app app-id]
  node scripts/harness.mjs build

Phase 2 commands are intentionally local-first: they generate static assets,
manifests, checksums, verification reports, and a Tauri app without requiring
Apple signing credentials.`;

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

const tomlString = (value) => `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const tomlArray = (values) => `[${values.map(tomlString).join(", ")}]`;

const slugify = (value) =>
  String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "shinylive-harness";

const titleize = (value) =>
  String(value)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const jsonFile = async (targetPath) => JSON.parse(await readFile(targetPath, "utf8"));

const writeJsonFile = async (targetPath, value) => {
  await writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`);
};

const replaceInFile = async (targetPath, replacements) => {
  if (!(await exists(targetPath))) {
    return;
  }
  let contents = await readFile(targetPath, "utf8");
  for (const [pattern, value] of replacements) {
    contents = contents.replace(pattern, value);
  }
  await writeFile(targetPath, contents);
};

const appendAppToConfig = async (app) => {
  const block = [
    "",
    "[[apps]]",
    `id = ${tomlString(app.id)}`,
    `title = ${tomlString(app.title)}`,
    `description = ${tomlString(app.description)}`,
    `kind = ${tomlString(app.kind)}`,
    `source = ${tomlString(app.source)}`,
    `output = ${tomlString(app.output)}`,
    `path = ${tomlString(app.path)}`,
    "offline_required = true",
    `smoke_text = ${tomlArray(app.smokeText)}`,
    ...(app.domProbes?.length ? [`dom_probes = ${tomlArray(app.domProbes)}`] : []),
    ...(app.reportTemplates?.length ? [`report_templates = ${tomlArray(app.reportTemplates)}`] : []),
    ...(app.dataPack ? [`data_pack = ${tomlString(app.dataPack)}`] : []),
    ...(app.dataPackSource ? [`data_pack_source = ${tomlString(app.dataPackSource)}`] : []),
    ...(app.dataPaths?.length ? [`data_paths = ${tomlArray(app.dataPaths)}`] : []),
    `header_probes = ${tomlArray(app.headerProbes ?? ["index.html", "harness-boot.js", "shinylive/webr/R.wasm"])}`,
    "",
  ].join("\n");

  await writeFile(configPath, `${await readFile(configPath, "utf8")}${block}`);
};

const appBlock = (app) =>
  [
    "",
    "[[apps]]",
    `id = ${tomlString(app.id)}`,
    `title = ${tomlString(app.title)}`,
    `description = ${tomlString(app.description)}`,
    `kind = ${tomlString(app.kind)}`,
    `source = ${tomlString(app.source)}`,
    `output = ${tomlString(app.output)}`,
    `path = ${tomlString(app.path)}`,
    `offline_required = ${app.offlineRequired ? "true" : "false"}`,
    `smoke_text = ${tomlArray(app.smokeText ?? [])}`,
    ...(app.domProbes?.length ? [`dom_probes = ${tomlArray(app.domProbes)}`] : []),
    ...(app.reportTemplates?.length ? [`report_templates = ${tomlArray(app.reportTemplates)}`] : []),
    ...(app.dataPack ? [`data_pack = ${tomlString(app.dataPack)}`] : []),
    ...(app.dataPackSource ? [`data_pack_source = ${tomlString(app.dataPackSource)}`] : []),
    ...(app.dataPaths?.length ? [`data_paths = ${tomlArray(app.dataPaths)}`] : []),
    `header_probes = ${tomlArray(app.headerProbes ?? ["index.html", "harness-boot.js", "shinylive/webr/R.wasm"])}`,
  ].join("\n");

const serializeHarnessToml = (config) =>
  [
    "[project]",
    `name = ${tomlString(config.project.name)}`,
    `version = ${tomlString(config.project.version)}`,
    `portal_title = ${tomlString(config.project.portalTitle)}`,
    `portal_subtitle = ${tomlString(config.project.portalSubtitle)}`,
    `bundle_name = ${tomlString(config.project.bundleName)}`,
    "",
    "[distribution]",
    `artifact_name = ${tomlString(config.distribution.artifactName)}`,
    `release_channel = ${tomlString(config.distribution.releaseChannel)}`,
    `release_draft = ${config.distribution.releaseDraft ? "true" : "false"}`,
    `require_offline = ${config.distribution.requireOffline ? "true" : "false"}`,
    `mac_bundles = ${tomlArray(config.distribution.macBundles)}`,
    `windows_bundles = ${tomlArray(config.distribution.windowsBundles)}`,
    `github_repo = ${tomlString(config.distribution.githubRepo)}`,
    "",
    "[phase3]",
    `signing_required = ${config.phase3.signingRequired ? "true" : "false"}`,
    `notarization_required = ${config.phase3.notarizationRequired ? "true" : "false"}`,
    `validation_pack_required = ${config.phase3.validationPackRequired ? "true" : "false"}`,
    `release_draft_default = ${config.phase3.releaseDraftDefault ? "true" : "false"}`,
    ...config.apps.map(appBlock),
    "",
  ].join("\n");

const writeHarnessConfig = async (config) => {
  await writeFile(configPath, serializeHarnessToml(config));
};

const createSourceApp = async (app, baseDir = rootDir) => {
  const sourceDir = path.join(baseDir, app.source);
  const dataDir = path.join(sourceDir, "data");
  const wwwDir = path.join(sourceDir, "www");

  if (await exists(sourceDir)) {
    return;
  }

  await mkdir(dataDir, { recursive: true });
  await mkdir(wwwDir, { recursive: true });
  await writeFile(
    path.join(dataDir, "sample.csv"),
    "subject_id,value\nSUBJ-001,1\nSUBJ-002,2\n",
  );
  await writeFile(
    path.join(wwwDir, "harness-diagnostics.js"),
    `window.addEventListener("load", () => {
  const publish = (extra) => {
    const details = extra || {};
    const payload = {
      type: "shinylive-harness-diagnostics",
      appId: ${JSON.stringify(app.id)},
      timestamp: new Date().toISOString(),
      location: window.location.href,
      crossOriginIsolated: window.crossOriginIsolated,
      sharedArrayBufferAvailable: typeof SharedArrayBuffer !== "undefined",
      serviceWorkerAvailable: "serviceWorker" in navigator,
      userAgent: navigator.userAgent,
      shinyliveExportPresent: true,
      ...details,
    };
    window.parent?.postMessage(payload, window.location.origin);
    if (window.top && window.top !== window.parent) {
      window.top.postMessage(payload, window.location.origin);
    }
  };

  if (window.Shiny) {
    window.Shiny.addCustomMessageHandler("harness-diagnostics", publish);
  }
  publish({ loadStatus: "loaded" });
});
`,
  );
  await writeFile(
    path.join(sourceDir, "app.R"),
    `library(shiny)

sample_data <- read.csv("data/sample.csv")

ui <- fluidPage(
  tags$head(tags$script(src = "harness-diagnostics.js")),
  h1(${JSON.stringify(app.title)}),
  strong(textOutput("r_smoke", inline = TRUE)),
  tableOutput("sample_table")
)

server <- function(input, output, session) {
  output$r_smoke <- renderText(1 + 1)
  output$sample_table <- renderTable(sample_data)
  observe({
    session$sendCustomMessage(
      "harness-diagnostics",
      list(sampleDataLoaded = TRUE, rSmokeResult = as.character(1 + 1))
    )
  })
}

shinyApp(ui, server)
`,
  );
};

const templateEntries = [
  ".github",
  "crates",
  "data-packs",
  "docs",
  "schemas",
  "scripts",
  "src",
  "src-tauri",
  "templates",
  "AGENTS.md",
  ".gitignore",
  "index.html",
  "package-lock.json",
  "package.json",
  "tsconfig.json",
  "vite.config.ts",
];
const templateExcludedSegments = new Set([
  ".git",
  ".r-lib",
  ".shinylive-cache",
  "dist",
  "node_modules",
  "release",
  "reports",
  "target",
]);
const duplicateCopyPattern = / \d+(?=(\.[^/.]+)?$)/;

const shouldCopyTemplatePath = (sourcePath) => {
  const relativePath = path.relative(rootDir, sourcePath);
  if (!relativePath) {
    return true;
  }
  const segments = relativePath.split(path.sep);
  if (segments.some((segment) => templateExcludedSegments.has(segment))) {
    return false;
  }
  if (segments.some((segment) => duplicateCopyPattern.test(segment))) {
    return false;
  }
  return path.basename(relativePath) !== ".DS_Store";
};

const createNewHarnessToml = ({ projectName, projectTitle, bundleName, artifactName, githubRepo }) => `[project]
name = ${tomlString(projectName)}
version = "0.1.0"
portal_title = ${tomlString(projectTitle)}
portal_subtitle = "Localhost runtime harness"
bundle_name = ${tomlString(bundleName)}

[distribution]
artifact_name = ${tomlString(artifactName)}
release_channel = "internal"
release_draft = true
require_offline = true
mac_bundles = ["app", "dmg", "pkg"]
windows_bundles = ["nsis"]
github_repo = ${tomlString(githubRepo)}

[phase3]
signing_required = true
notarization_required = true
validation_pack_required = true
release_draft_default = true

[[apps]]
id = "subject-safety-mini"
title = "Subject Safety Mini Dashboard"
description = "Clinical smoke app for validating Shinylive/webR runtime requirements."
kind = "shinylive-r"
source = "shinylive-src/subject-safety-mini"
output = "apps/subject-safety-mini"
path = "/apps/subject-safety-mini/index.html"
offline_required = true
smoke_text = ["Subject Safety Mini Dashboard", "R smoke result", "SUBJ-001"]
header_probes = ["index.html", "harness-boot.js", "shinylive/webr/R.wasm"]
`;

const createNewHarnessReadme = ({ projectTitle }) => `# ${projectTitle}

Generated by Tauri Shinylive Harness.

## Quickstart

\`\`\`sh
npm ci
npm run validate:config
npm run export
npm run verify
npm run build:release-local
\`\`\`

Add another app:

\`\`\`sh
npm run harness -- add-app lab-trends-mini --title "Lab Trends Mini"
npm run validate:config
npm run verify
\`\`\`
`;

const copyTemplate = async (target) => {
  for (const entry of templateEntries) {
    const source = path.join(rootDir, entry);
    if (!(await exists(source))) {
      continue;
    }
    await cp(source, path.join(target, entry), {
      recursive: true,
      force: true,
      filter: shouldCopyTemplatePath,
    });
  }
};

const updateGeneratedPackage = async (target, { projectName }) => {
  const packagePath = path.join(target, "package.json");
  const packageJson = await jsonFile(packagePath);
  packageJson.name = projectName;
  packageJson.version = "0.1.0";
  packageJson.private = true;
  await writeJsonFile(packagePath, packageJson);

  const packageLockPath = path.join(target, "package-lock.json");
  if (await exists(packageLockPath)) {
    const packageLock = await jsonFile(packageLockPath);
    packageLock.name = projectName;
    packageLock.version = "0.1.0";
    if (packageLock.packages?.[""]) {
      packageLock.packages[""].name = projectName;
      packageLock.packages[""].version = "0.1.0";
    }
    await writeJsonFile(packageLockPath, packageLock);
  }
};

const updateGeneratedTauriConfig = async (target, { projectName, bundleName }) => {
  const tauriConfigPath = path.join(target, "src-tauri", "tauri.conf.json");
  const tauriConfig = await jsonFile(tauriConfigPath);
  tauriConfig.productName = bundleName;
  tauriConfig.version = "0.1.0";
  tauriConfig.identifier = `com.local.${slugify(projectName)}`;
  if (tauriConfig.app?.windows?.[0]) {
    tauriConfig.app.windows[0].title = bundleName;
  }
  await writeJsonFile(tauriConfigPath, tauriConfig);

  await replaceInFile(path.join(target, "src-tauri", "Cargo.toml"), [
    [/^version = ".*"$/m, 'version = "0.1.0"'],
  ]);
  await replaceInFile(path.join(target, "crates", "harness-server", "Cargo.toml"), [
    [/^version = ".*"$/m, 'version = "0.1.0"'],
  ]);
  await replaceInFile(path.join(target, "crates", "harness-server", "Cargo.lock"), [
    [/(name = "harness-server"\nversion = )".*"/, '$1"0.1.0"'],
  ]);
  await replaceInFile(path.join(target, "src-tauri", "Cargo.lock"), [
    [/(name = "harness-server"\nversion = )".*"/, '$1"0.1.0"'],
    [/(name = "tauri-shinylive-harness"\nversion = )".*"/, '$1"0.1.0"'],
  ]);
};

const clinicalDataPathsForSource = (source) => [
  path.join(source, "data", "clinical-demo-data-pack.json"),
  ...Object.values(clinicalDomains).map((domain) => path.join(source, "data", domain.file)),
].map(toPosixLocal);

const dataPackRegistryPathForId = (dataPackId) => toPosixLocal(path.join("data-packs", dataPackId));

function toPosixLocal(value) {
  return value.split(path.sep).join("/");
}

const updateDataPackMetadata = async (dataDir, { id, description }) => {
  const metadataPath = path.join(dataDir, "clinical-demo-data-pack.json");
  const metadata = await jsonFile(metadataPath);
  if (id) {
    metadata.id = id;
  }
  if (description) {
    metadata.description = description;
  }
  await writeJsonFile(metadataPath, metadata);
};

const subjectProfileTemplateSource = async () => {
  const template = path.join(rootDir, "templates", "apps", "subject-profile-reference");
  if (await exists(template)) {
    return template;
  }
  return path.join(rootDir, "shinylive-src", "subject-profile-reference");
};

const createSubjectProfileTemplateApp = async (app) => {
  const sourceDir = path.join(rootDir, app.source);
  if (await exists(sourceDir)) {
    throw new Error(`App source already exists: ${app.source}`);
  }

  await cp(await subjectProfileTemplateSource(), sourceDir, {
    recursive: true,
    force: true,
    filter: shouldCopyTemplatePath,
  });

  await replaceInFile(path.join(sourceDir, "app.R"), [
    [/data_pack_id <- ".*"/, `data_pack_id <- "${app.dataPack}"`],
    [/"Subject Profile Reference App"/g, JSON.stringify(app.title)],
  ]);
  await replaceInFile(path.join(sourceDir, "www", "harness-diagnostics.js"), [
    [/appId: ".*"/, `appId: "${app.id}"`],
    [/candidate\.id === ".*"/, `candidate.id === "${app.id}"`],
  ]);

  await updateDataPackMetadata(path.join(sourceDir, "data"), {
    id: app.dataPack,
    description: `Synthetic clinical subject profile data for ${app.title}.`,
  });

  const registryDir = path.join(rootDir, app.dataPackSource);
  await mkdir(path.dirname(registryDir), { recursive: true });
  await cp(path.join(sourceDir, "data"), registryDir, {
    recursive: true,
    force: true,
    filter: shouldCopyTemplatePath,
  });
};

const createNewHarness = async (values) => {
  const options = parseOptions(values);
  const targetDirectory = options._[0];
  if (!targetDirectory) {
    throw new Error("new requires a target directory.");
  }
  const target = path.resolve(process.cwd(), targetDirectory);
  const existingEntries = (await exists(target)) ? await readdir(target) : [];
  if (existingEntries.length > 0 && !options.force) {
    throw new Error(`Target directory is not empty: ${target}. Pass --force to overwrite template files.`);
  }

  const projectName = slugify(options.name ?? path.basename(target));
  const projectTitle = options["portal-title"] ?? `${titleize(projectName)} Portal`;
  const bundleName = options["bundle-name"] ?? projectTitle;
  const artifactName = options["artifact-name"] ?? projectName;
  const githubRepo = options["github-repo"] ?? "";
  const sampleApp = {
    id: "subject-safety-mini",
    title: "Subject Safety Mini Dashboard",
    description: "Clinical smoke app for validating Shinylive/webR runtime requirements.",
    kind: "shinylive-r",
    source: "shinylive-src/subject-safety-mini",
    output: "apps/subject-safety-mini",
    path: "/apps/subject-safety-mini/index.html",
    offlineRequired: true,
    smokeText: ["Subject Safety Mini Dashboard", "R smoke result", "SUBJ-001"],
  };

  await mkdir(path.join(target, "scripts"), { recursive: true });
  await mkdir(path.join(target, "shinylive-src"), { recursive: true });
  await mkdir(path.join(target, "apps"), { recursive: true });
  await copyTemplate(target);
  await writeFile(
    path.join(target, "harness.toml"),
    createNewHarnessToml({ projectName, projectTitle, bundleName, artifactName, githubRepo }),
  );
  await writeFile(
    path.join(target, "README.md"),
    createNewHarnessReadme({ projectTitle }),
  );
  await updateGeneratedPackage(target, { projectName });
  await updateGeneratedTauriConfig(target, { projectName, bundleName });
  await createSourceApp(sampleApp, target);
  await appendAudit("new", "ok", { target });
};

const addApp = async (values) => {
  const options = parseOptions(values);
  const id = options._[0];
  if (!id) {
    throw new Error("add-app requires an app id.");
  }

  const config = await readConfig();
  if (config.apps.some((app) => app.id === id)) {
    throw new Error(`App already exists: ${id}`);
  }

  const template = options.template ?? "basic";
  const title = options.title ?? id.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const app = {
    id,
    title,
    description: options.description ?? "Generated Shinylive app.",
    kind: options.kind ?? "shinylive-r",
    source: options.source ?? `shinylive-src/${id}`,
    output: options.output ?? `apps/${id}`,
    path: `/apps/${id}/index.html`,
    headerProbes: ["index.html", "harness-boot.js", "shinylive/webr/R.wasm"],
    smokeText: [title, "2", "SUBJ-001"],
  };

  if (template === "subject-profile") {
    app.description =
      options.description ??
      "Synthetic subject profile reference app with overview, timeline, labs, adverse events, meds, exposure, and data pack traceability.";
    app.dataPack = options["data-pack"] ?? `${id}-clinical-demo-data-v1`;
    app.dataPackSource = dataPackRegistryPathForId(app.dataPack);
    app.dataPaths = clinicalDataPathsForSource(app.source);
    app.domProbes = [
      "#overview_lab_trend img",
      "#exposure_ae_timeline img",
      '#data_pack_hash_value[data-harness-status="resolved"]',
      "#snapshot_report_table table",
      "#safety_review_table table",
      "#listing_visits table",
    ];
    app.reportTemplates = ["subject-snapshot", "safety-review", "data-listing"];
    app.smokeText = [title, "SUBJ-001 AE count: 3", "Data pack hash"];
    await createSubjectProfileTemplateApp(app);
  } else if (template === "basic") {
    await createSourceApp(app);
  } else {
    throw new Error(`Unknown app template: ${template}`);
  }

  await appendAppToConfig(app);
  await appendAudit("add-app", "ok", { id });
};

const addDataPack = async (values) => {
  const options = parseOptions(values);
  const appId = options.app ?? options._[0];
  const sourceDataDir = options["data-dir"] ?? options._[1];
  if (!appId || !sourceDataDir) {
    throw new Error("add-data-pack requires an app id and data directory.");
  }

  const config = await readConfig();
  const app = config.apps.find((candidate) => candidate.id === appId);
  if (!app) {
    throw new Error(`No app matched: ${appId}`);
  }

  const resolvedSourceDataDir = path.resolve(process.cwd(), sourceDataDir);
  const validation = await validateClinicalDataPack({
    appId,
    dataDir: resolvedSourceDataDir,
    dataPackId: options.id ?? null,
    writeOutputs: false,
  });
  if (!validation.ok) {
    throw new Error(`Data pack validation failed for ${sourceDataDir}`);
  }

  const effectiveDataPackId = options.id ?? validation.dataPack.id;
  let materializedSourceDataDir = resolvedSourceDataDir;
  if (options.copy) {
    const registryDestination = path.join(rootDir, dataPackRegistryPathForId(effectiveDataPackId));
    await mkdir(path.dirname(registryDestination), { recursive: true });
    if (path.resolve(registryDestination) !== path.resolve(resolvedSourceDataDir)) {
      await cp(resolvedSourceDataDir, registryDestination, {
        recursive: true,
        force: true,
        filter: shouldCopyTemplatePath,
      });
    }
    if (options.id) {
      await updateDataPackMetadata(registryDestination, { id: options.id });
    }
    materializedSourceDataDir = registryDestination;
    app.dataPackSource = dataPackRegistryPathForId(effectiveDataPackId);
  } else if (
    path.resolve(resolvedSourceDataDir) === path.join(rootDir, "data-packs") ||
    path.resolve(resolvedSourceDataDir).startsWith(`${path.join(rootDir, "data-packs")}${path.sep}`)
  ) {
    app.dataPackSource = toPosixLocal(path.relative(rootDir, resolvedSourceDataDir));
  }

  const destination = path.join(rootDir, app.source, "data");
  if (path.resolve(destination) !== path.resolve(materializedSourceDataDir)) {
    await mkdir(destination, { recursive: true });
    await cp(materializedSourceDataDir, destination, {
      recursive: true,
      force: true,
      filter: shouldCopyTemplatePath,
    });
  }

  if (options.id) {
    await updateDataPackMetadata(destination, { id: options.id });
  }

  app.dataPack = effectiveDataPackId;
  app.dataPaths = clinicalDataPathsForSource(app.source);
  await writeHarnessConfig(config);
  await validateConfiguredDataPacks({ appId });
  await appendAudit("add-data-pack", "ok", {
    appId,
    dataPack: app.dataPack,
    dataPackSource: app.dataPackSource || null,
    copiedToRegistry: Boolean(options.copy),
  });
};

const validateConfig = async () => {
  const result = await validateHarnessConfig();
  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        report: "reports/harness-config-validation.json",
        errors: result.summary.errorCount,
        warnings: result.summary.warningCount,
      },
      null,
      2,
    ),
  );
  await appendAudit("validate-config", result.ok ? "ok" : "failed", result);
  if (!result.ok) {
    throw new Error("Harness config validation failed.");
  }
};

const validateData = async (values) => {
  const options = parseOptions(values);
  const appId = options.app ?? options._[0] ?? null;
  const reportPath = options.report ? path.resolve(options.report) : undefined;
  const dictionaryPath = options.dictionary ? path.resolve(options.dictionary) : undefined;

  let result;
  if (options["data-dir"]) {
    result = await validateClinicalDataPack({
      appId,
      dataDir: path.resolve(process.cwd(), options["data-dir"]),
      dataPackId: options.id ?? null,
      reportPath,
      dictionaryPath,
    });
    if (!result.ok) {
      throw new Error("Clinical data pack validation failed.");
    }
  } else {
    result = await validateConfiguredDataPacks({ appId, reportPath, dictionaryPath });
  }

  await appendAudit("validate-data", result.ok ? "ok" : "failed", result);
};

const listApps = async () => {
  const config = await readConfig();
  console.log(
    config.apps
      .map((app) => `${app.id}\t${app.kind}\t${app.title}\t${app.path}`)
      .join("\n"),
  );
};

const doctor = async () => {
  const config = await readConfig();
  const checks = [];
  const pushCheck = async (name, ok, detail = "") => {
    checks.push({ name, ok, detail });
  };

  await pushCheck("harness.toml", await exists(configPath), path.relative(rootDir, configPath));
  await pushCheck("package.json", await exists(path.join(rootDir, "package.json")), "npm scripts");
  await pushCheck("src-tauri/tauri.conf.json", await exists(path.join(rootDir, "src-tauri", "tauri.conf.json")), "Tauri config");
  await pushCheck("schemas/harness.schema.json", await exists(path.join(rootDir, "schemas", "harness.schema.json")), "harness config contract");
  await pushCheck("schemas/clinical-data-pack.schema.json", await exists(path.join(rootDir, "schemas", "clinical-data-pack.schema.json")), "clinical data contract");
  await pushCheck("templates/apps/subject-profile-reference", await exists(path.join(rootDir, "templates", "apps", "subject-profile-reference")), "subject profile template");
  await pushCheck("templates/reports", await exists(path.join(rootDir, "templates", "reports")), "report template registry");
  await pushCheck("configured apps", config.apps.length > 0, `${config.apps.length} app(s)`);

  const ids = new Set();
  for (const app of config.apps) {
    const duplicate = ids.has(app.id);
    ids.add(app.id);
    await pushCheck(`app:${app.id}:unique`, !duplicate);
    await pushCheck(`app:${app.id}:source`, await exists(path.join(rootDir, app.source)), app.source);
    await pushCheck(`app:${app.id}:app.R`, await exists(path.join(rootDir, app.source, "app.R")), path.join(app.source, "app.R"));
    if (app.dataPack) {
      await pushCheck(`app:${app.id}:data-pack`, app.dataPaths.length > 0, app.dataPack);
    }
    if (app.dataPackSource) {
      await pushCheck(`app:${app.id}:data-pack-source`, await exists(path.join(rootDir, app.dataPackSource)), app.dataPackSource);
    }
    for (const dataPath of app.dataPaths) {
      await pushCheck(`app:${app.id}:data:${dataPath}`, await exists(path.join(rootDir, dataPath)), dataPath);
    }
    for (const reportTemplate of app.reportTemplates) {
      await pushCheck(
        `app:${app.id}:report-template:${reportTemplate}`,
        await exists(path.join(rootDir, "templates", "reports", reportTemplate, "template.json")),
        `templates/reports/${reportTemplate}/template.json`,
      );
    }
  }

  const validation = await validateHarnessConfig(config);
  await pushCheck(
    "harness-config-validation",
    validation.ok,
    `${validation.summary.errorCount} error(s), ${validation.summary.warningCount} warning(s)`,
  );

  const ok = checks.every((check) => check.ok);
  for (const check of checks) {
    console.log(`${check.ok ? "ok" : "fail"}\t${check.name}${check.detail ? `\t${check.detail}` : ""}`);
  }
  await appendAudit("doctor", ok ? "ok" : "failed", { checks });
  if (!ok) {
    throw new Error("Harness doctor found issues.");
  }
};

const exportApp = async (app) => {
  await runCommand("Rscript", ["scripts/export-shinylive.R"], {
    env: {
      ...process.env,
      HARNESS_APP_ID: app.id,
      HARNESS_APP_TITLE: app.title,
      HARNESS_APP_DESCRIPTION: app.description,
      HARNESS_APP_KIND: app.kind,
      HARNESS_APP_ENGINE: app.kind === "shinylive-python" ? "python" : "r",
      HARNESS_APP_SOURCE: app.source,
      HARNESS_APP_OUTPUT: app.output,
      HARNESS_APP_PATH: app.path,
      HARNESS_APP_OFFLINE_REQUIRED: String(app.offlineRequired),
      HARNESS_APP_SMOKE_TEXT: JSON.stringify(app.smokeText),
      HARNESS_APP_HEADER_PROBES: JSON.stringify(app.headerProbes),
    },
  });
  await writeJson(path.join(rootDir, app.output, "harness-app.json"), await appToManifest(app));
};

const exportApps = async (appId) => {
  const config = await readConfig();
  const apps = appId ? config.apps.filter((app) => app.id === appId) : config.apps;
  if (apps.length === 0) {
    throw new Error(`No app matched: ${appId}`);
  }
  for (const app of apps) {
    await exportApp(app);
  }
  await appendAudit("export", "ok", { apps: apps.map((app) => app.id) });
};

const buildPortalAndPrepare = async () => {
  await runCommand("npm", ["run", "build:portal"]);
  await prepareDist();
  await appendAudit("prepare", "ok");
};

const verifyAll = async (values = []) => {
  const options = parseOptions(values);
  const appId = options.app ?? options._[0] ?? null;
  const config = await readConfig();
  const selectedApp = appId ? config.apps.find((app) => app.id === appId) : null;
  if (appId && !selectedApp) {
    throw new Error(`No app matched: ${appId}`);
  }
  const configValidation = await validateHarnessConfig(config);
  await appendAudit("validate-config", configValidation.ok ? "ok" : "failed", configValidation);
  if (!configValidation.ok) {
    throw new Error("Harness config validation failed.");
  }
  if (!appId || selectedApp?.dataPack) {
    await validateConfiguredDataPacks({ appId });
  }
  await exportApps();
  await exportReports({ appId });
  await buildPortalAndPrepare();
  await runCommand("npm", ["run", "check"]);
  await runCommand("cargo", ["test", "--manifest-path", "crates/harness-server/Cargo.toml"]);
  await verifyBundleArtifacts();
  await runCommand("node", ["scripts/e2e-verify.mjs", ...(appId ? ["--app", appId] : [])]);
  await appendAudit("verify", "ok", { appId });
};

try {
  switch (command) {
    case "help":
    case "--help":
    case "-h":
      console.log(usage);
      break;
    case "new":
      await createNewHarness(args);
      break;
    case "add-app":
      await addApp(args);
      break;
    case "add-data-pack":
      await addDataPack(args);
      break;
    case "validate-config":
      await validateConfig();
      break;
    case "validate-data":
      await validateData(args);
      break;
    case "list":
      await listApps();
      break;
    case "doctor":
      await doctor();
      break;
    case "export":
      await exportApps(args[0]);
      break;
    case "export-reports": {
      const options = parseOptions(args);
      await exportReports({
        appId: options.app ?? options._[0] ?? null,
        subjectId: options.subject ?? null,
        allSubjects: Boolean(options["all-subjects"]),
      });
      break;
    }
    case "prepare":
      await buildPortalAndPrepare();
      break;
    case "verify-static":
      await verifyBundleArtifacts();
      break;
    case "verify":
      await verifyAll(args);
      break;
    case "build":
      await verifyAll(args);
      await runCommand("npm", ["run", "tauri:build"]);
      await appendAudit("build", "ok");
      break;
    default:
      throw new Error(`Unknown command: ${command}\n\n${usage}`);
  }
} catch (error) {
  await appendAudit(command, "failed", { message: error instanceof Error ? error.message : String(error) });
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
