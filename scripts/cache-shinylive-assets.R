if (!requireNamespace("shinylive", quietly = TRUE)) {
  stop("shinylive is not installed. Run renv::restore first.", call. = FALSE)
}

assets_version <- shinylive::assets_version()
assets_dir <- normalizePath(".shinylive-cache", mustWork = FALSE)
asset_root <- file.path(assets_dir, paste0("shinylive-", assets_version))
standard_asset_root <- shinylive::assets_ensure(version = assets_version)

required_relative <- c(
  "shinylive/shinylive.js",
  "shinylive/shinylive.css",
  "shinylive/webr/R.wasm"
)

standard_required <- file.path(standard_asset_root, required_relative)
missing_standard <- standard_required[!file.exists(standard_required)]
if (length(missing_standard) > 0) {
  stop("Shinylive standard asset cache is missing required files: ", paste(missing_standard, collapse = ", "), call. = FALSE)
}

for (relative_path in required_relative) {
  source_path <- file.path(standard_asset_root, relative_path)
  target_path <- file.path(asset_root, relative_path)
  target_dir <- dirname(target_path)
  if (!dir.exists(target_dir)) {
    dir.create(target_dir, recursive = TRUE)
  }
  copied <- file.copy(source_path, target_path, overwrite = TRUE, copy.date = TRUE)
  if (!isTRUE(copied)) {
    stop("Failed to copy Shinylive asset into repository cache: ", target_path, call. = FALSE)
  }
}

required <- file.path(asset_root, required_relative)
missing <- required[!file.exists(required)]
if (length(missing) > 0) {
  stop("Shinylive asset cache is missing required files: ", paste(missing, collapse = ", "), call. = FALSE)
}

cat("Prepared Shinylive assets:", asset_root, "\n")
