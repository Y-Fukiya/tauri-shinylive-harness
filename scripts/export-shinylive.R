local_lib <- normalizePath(".r-lib", mustWork = FALSE)
dir.create(local_lib, recursive = TRUE, showWarnings = FALSE)
.libPaths(c(local_lib, .libPaths()))

if (!requireNamespace("shinylive", quietly = TRUE)) {
  install.packages("shinylive", repos = "https://cloud.r-project.org", lib = local_lib)
}

source_dir <- "shinylive-src/subject-safety-mini"
output_dir <- "apps/subject-safety-mini"
assets_version <- shinylive::assets_version()
assets_dir <- normalizePath(".shinylive-cache", mustWork = FALSE)
asset_root <- file.path(assets_dir, paste0("shinylive-", assets_version))
template_dir <- file.path(asset_root, "export_template")

if (!dir.exists(template_dir)) {
  if (dir.exists(asset_root)) {
    unlink(asset_root, recursive = TRUE)
  }
  shinylive::assets_download(version = assets_version, dir = assets_dir)
}

if (!dir.exists(template_dir)) {
  stop("Shinylive export template was not downloaded: ", template_dir)
}

if (dir.exists(output_dir)) {
  unlink(output_dir, recursive = TRUE)
}

shinylive::export(source_dir, output_dir, template_dir = template_dir)

app_manifest <- '{
  "id": "subject-safety-mini",
  "title": "Subject Safety Mini Dashboard",
  "path": "/apps/subject-safety-mini/index.html",
  "description": "Clinical smoke app for validating Shinylive/webR runtime requirements.",
  "kind": "shinylive-r",
  "offlineRequired": true
}
'
writeLines(app_manifest, file.path(output_dir, "harness-app.json"))

index_path <- file.path(output_dir, "index.html")
index_html <- paste(readLines(index_path, warn = FALSE), collapse = "\n")
default_boot_script <- paste(c(
  '    <script type="module">',
  '      import { runExportedApp } from "./shinylive/shinylive.js";',
  '      runExportedApp({',
  '        id: "root",',
  '        appEngine: "r",',
  '        relPath: "",',
  '      });',
  '    </script>'
), collapse = "\n")

harness_boot_script <- '    <script src="./harness-boot.js" type="module"></script>'
harness_boot_js <- c(
  'const statusStyle = "font: 14px/1.5 system-ui, -apple-system, BlinkMacSystemFont, \'Segoe UI\', sans-serif; padding: 24px; color: #243041;";',
  'const reloadKey = "shinylive-controller-reload";',
  'const root = () => document.getElementById("root");',
  '',
  'const renderBootMessage = (message) => {',
  '  const target = root();',
  '  if (!target) return;',
  '  target.textContent = "";',
  '  const wrapper = document.createElement("div");',
  '  wrapper.setAttribute("style", statusStyle);',
  '  wrapper.textContent = message;',
  '  target.appendChild(wrapper);',
  '};',
  '',
  'const renderBootError = (error) => {',
  '  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);',
  '  const target = root();',
  '  if (target) {',
  '    target.textContent = "";',
  '    const pre = document.createElement("pre");',
  '    pre.setAttribute("style", `${statusStyle}; white-space: pre-wrap`);',
  '    pre.textContent = `Shinylive boot failed\\n\\n${message}`;',
  '    target.appendChild(pre);',
  '  }',
  '  console.error("[shinylive] boot failed", error);',
  '};',
  '',
  'const withTimeout = (promise, timeoutMs, message) => Promise.race([',
  '  promise,',
  '  new Promise((_, reject) => setTimeout(() => reject(new Error(message)), timeoutMs)),',
  ']);',
  '',
  'const waitForServiceWorkerController = async () => {',
  '  if (!("serviceWorker" in navigator)) return;',
  '  await withTimeout(navigator.serviceWorker.ready, 15000, "Timed out waiting for Shinylive ServiceWorker.");',
  '  if (!navigator.serviceWorker.controller) {',
  '    if (sessionStorage.getItem(reloadKey) !== "1") {',
  '      sessionStorage.setItem(reloadKey, "1");',
  '      window.location.reload();',
  '      await new Promise(() => {});',
  '    }',
  '    throw new Error("ServiceWorker controller was not found after reload.");',
  '  }',
  '  sessionStorage.removeItem(reloadKey);',
  '};',
  '',
  'try {',
  '  renderBootMessage("Starting Shinylive...");',
  '  await waitForServiceWorkerController();',
  '  const { runExportedApp } = await import("./shinylive/shinylive.js");',
  '  await runExportedApp({',
  '    id: "root",',
  '    appEngine: "r",',
  '    relPath: "",',
  '  });',
  '} catch (error) {',
  '  renderBootError(error);',
  '}'
)

patched_index_html <- sub(default_boot_script, harness_boot_script, index_html, fixed = TRUE)
if (identical(index_html, patched_index_html)) {
  stop("Could not patch exported Shinylive boot script in ", index_path)
}
writeLines(strsplit(patched_index_html, "\n", fixed = TRUE)[[1]], index_path)
writeLines(harness_boot_js, file.path(output_dir, "harness-boot.js"))
