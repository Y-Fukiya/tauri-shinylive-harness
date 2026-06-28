local_lib <- normalizePath(".r-lib", mustWork = FALSE)
.libPaths(c(local_lib, .libPaths()))

if (!requireNamespace("shinylive", quietly = TRUE)) {
  stop("shinylive is not installed. Run renv::restore first.", call. = FALSE)
}

assets_version <- shinylive::assets_version()
assets_dir <- normalizePath(".shinylive-cache", mustWork = FALSE)
asset_root <- file.path(assets_dir, paste0("shinylive-", assets_version))
template_dir <- file.path(asset_root, "export_template")

if (!dir.exists(template_dir)) {
  shinylive::assets_download(version = assets_version, dir = assets_dir)
}

if (!dir.exists(template_dir)) {
  stop("Failed to prepare Shinylive assets: ", template_dir, call. = FALSE)
}

required <- file.path(template_dir, c(
  "shinylive/shinylive.js",
  "shinylive/shinylive.css",
  "shinylive/webr/R.wasm"
))
missing <- required[!file.exists(required)]
if (length(missing) > 0) {
  stop("Shinylive asset cache is missing required files: ", paste(missing, collapse = ", "), call. = FALSE)
}

cat("Prepared Shinylive assets:", template_dir, "\n")
