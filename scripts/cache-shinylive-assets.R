if (!requireNamespace("shinylive", quietly = TRUE)) {
  stop("shinylive is not installed. Run renv::restore first.", call. = FALSE)
}

assets_version <- shinylive::assets_version()
assets_dir <- normalizePath(".shinylive-cache", mustWork = FALSE)
asset_root <- file.path(assets_dir, paste0("shinylive-", assets_version))

required_relative <- c(
  "export_template/index.html",
  "shinylive/shinylive.js",
  "shinylive/shinylive.css",
  "shinylive/webr/R.wasm"
)

required <- file.path(asset_root, required_relative)
missing <- required[!file.exists(required)]
if (length(missing) > 0) {
  if (dir.exists(asset_root)) {
    unlink(asset_root, recursive = TRUE, force = TRUE)
  }
  shinylive::assets_ensure(version = assets_version, dir = assets_dir)
}

required <- file.path(asset_root, required_relative)
missing <- required[!file.exists(required)]
if (length(missing) > 0) {
  stop("Shinylive repo cache is missing required files: ", paste(missing, collapse = ", "), call. = FALSE)
}

cat("Prepared Shinylive export assets:", asset_root, "\n")
