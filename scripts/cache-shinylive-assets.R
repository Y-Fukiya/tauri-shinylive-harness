if (!requireNamespace("shinylive", quietly = TRUE)) {
  stop("shinylive is not installed. Run renv::restore first.", call. = FALSE)
}

assets_version <- shinylive::assets_version()
assets_dir <- normalizePath(".shinylive-cache", mustWork = FALSE)
asset_root <- file.path(assets_dir, paste0("shinylive-", assets_version))
template_dir <- file.path(asset_root, "export_template")
standard_asset_root <- shinylive::assets_ensure(version = assets_version)
standard_template_dir <- file.path(standard_asset_root, "export_template")

required_relative <- c(
  "shinylive/shinylive.js",
  "shinylive/shinylive.css",
  "shinylive/webr/R.wasm"
)

if (!dir.exists(template_dir)) {
  if (!dir.exists(standard_template_dir)) {
    stop("Shinylive standard export template is missing: ", standard_template_dir, call. = FALSE)
  }
  if (!dir.exists(asset_root)) {
    dir.create(asset_root, recursive = TRUE)
  }
  copied_template <- file.copy(standard_template_dir, asset_root, recursive = TRUE, copy.date = TRUE)
  if (!isTRUE(copied_template)) {
    stop("Failed to copy Shinylive export template into repository cache: ", template_dir, call. = FALSE)
  }
}

if (!dir.exists(template_dir)) {
  stop("Failed to prepare Shinylive export template: ", template_dir, call. = FALSE)
}

for (relative_path in required_relative) {
  source_path <- file.path(standard_asset_root, relative_path)
  target_path <- file.path(asset_root, relative_path)
  if (!file.exists(source_path)) {
    stop("Shinylive standard asset cache is missing required file: ", source_path, call. = FALSE)
  }
  target_dir <- dirname(target_path)
  if (!dir.exists(target_dir)) {
    dir.create(target_dir, recursive = TRUE)
  }
  copied <- file.copy(source_path, target_path, overwrite = TRUE, copy.date = TRUE)
  if (!isTRUE(copied)) {
    stop("Failed to copy Shinylive runtime asset into repository cache: ", target_path, call. = FALSE)
  }
}

required <- c(file.path(template_dir, "index.html"), file.path(asset_root, required_relative))
missing <- required[!file.exists(required)]
if (length(missing) > 0) {
  stop("Shinylive export cache is missing required files: ", paste(missing, collapse = ", "), call. = FALSE)
}

cat("Prepared Shinylive export template:", template_dir, "\n")
