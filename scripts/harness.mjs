#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  appendAudit,
  appToManifest,
  configPath,
  exists,
  prepareDist,
  readConfig,
  rootDir,
  runCommand,
  verifyBundleArtifacts,
  writeJson,
} from "./harness-core.mjs";

const command = process.argv[2] ?? "help";
const args = process.argv.slice(3);

const usage = `Usage:
  node scripts/harness.mjs new <directory>
  node scripts/harness.mjs add-app <id> [--title "Title"]
  node scripts/harness.mjs export [app-id]
  node scripts/harness.mjs prepare
  node scripts/harness.mjs verify-static
  node scripts/harness.mjs verify
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
    `smoke_text = [${app.smokeText.map(tomlString).join(", ")}]`,
    'header_probes = ["index.html", "harness-boot.js", "shinylive/webr/R.wasm"]',
    "",
  ].join("\n");

  await writeFile(configPath, `${await readFile(configPath, "utf8")}${block}`);
};

const createSourceApp = async (app) => {
  const sourceDir = path.join(rootDir, app.source);
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

const createNewHarness = async (targetDirectory) => {
  if (!targetDirectory) {
    throw new Error("new requires a target directory.");
  }
  const target = path.resolve(process.cwd(), targetDirectory);
  await mkdir(path.join(target, "scripts"), { recursive: true });
  await mkdir(path.join(target, "shinylive-src"), { recursive: true });
  await mkdir(path.join(target, "apps"), { recursive: true });
  await writeFile(
    path.join(target, "harness.toml"),
    `[project]
name = "new-shinylive-harness"
version = "0.1.0"
portal_title = "Clinical Shinylive Portal"
portal_subtitle = "Localhost runtime harness"
bundle_name = "Clinical Shinylive Desktop Portal"

[distribution]
artifact_name = "new-shinylive-harness"
release_channel = "internal"
release_draft = true
require_offline = true
`,
  );
  await writeFile(
    path.join(target, "README.md"),
    "# New Shinylive Harness\n\nCopy the Phase 2 harness scripts into this project or run from the template repository.\n",
  );
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

  const app = {
    id,
    title: options.title ?? id.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
    description: options.description ?? "Generated Shinylive app.",
    kind: options.kind ?? "shinylive-r",
    source: options.source ?? `shinylive-src/${id}`,
    output: options.output ?? `apps/${id}`,
    path: `/apps/${id}/index.html`,
    smokeText: [options.title ?? id, "2", "SUBJ-001"],
  };

  await createSourceApp(app);
  await appendAppToConfig(app);
  await appendAudit("add-app", "ok", { id });
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
  await writeJson(path.join(rootDir, app.output, "harness-app.json"), appToManifest(app));
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

const verifyAll = async () => {
  await exportApps();
  await buildPortalAndPrepare();
  await runCommand("npm", ["run", "check"]);
  await runCommand("cargo", ["test", "--manifest-path", "crates/harness-server/Cargo.toml"]);
  await verifyBundleArtifacts();
  await runCommand("node", ["scripts/e2e-verify.mjs"]);
  await appendAudit("verify", "ok");
};

try {
  switch (command) {
    case "help":
    case "--help":
    case "-h":
      console.log(usage);
      break;
    case "new":
      await createNewHarness(args[0]);
      break;
    case "add-app":
      await addApp(args);
      break;
    case "export":
      await exportApps(args[0]);
      break;
    case "prepare":
      await buildPortalAndPrepare();
      break;
    case "verify-static":
      await verifyBundleArtifacts();
      break;
    case "verify":
      await verifyAll();
      break;
    case "build":
      await verifyAll();
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
