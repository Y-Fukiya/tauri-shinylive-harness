use std::{
    collections::BTreeMap,
    io::SeekFrom,
    net::{Ipv4Addr, SocketAddr},
    path::{Path, PathBuf},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use axum::{
    body::Body,
    extract::{Query, State},
    http::{
        header::{
            ACCEPT_RANGES, CACHE_CONTROL, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_SECURITY_POLICY,
            CONTENT_TYPE, RANGE,
        },
        HeaderMap, HeaderName, HeaderValue, StatusCode, Uri,
    },
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::{
    fs,
    io::{AsyncReadExt, AsyncSeekExt},
    net::TcpListener,
};

pub const CSP: &str = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; frame-src 'self'; object-src 'none'; base-uri 'self';";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StaticPathError {
    Empty,
    Traversal,
    InvalidEncoding,
    InvalidSegment,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ByteRange {
    Full,
    Partial { start: u64, end: u64 },
    Unsatisfiable,
}

#[derive(Debug, Clone)]
pub struct ServerConfig {
    pub asset_root: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
pub struct StartedServer {
    pub bind_address: String,
    pub port: u16,
    pub asset_root: PathBuf,
    pub portal_url: String,
}

#[derive(Debug)]
pub enum ServerError {
    Io(std::io::Error),
    MissingAssetRoot(PathBuf),
}

impl std::fmt::Display for ServerError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ServerError::Io(error) => write!(formatter, "{error}"),
            ServerError::MissingAssetRoot(path) => {
                write!(formatter, "asset root does not exist: {}", path.display())
            }
        }
    }
}

impl std::error::Error for ServerError {}

impl From<std::io::Error> for ServerError {
    fn from(error: std::io::Error) -> Self {
        ServerError::Io(error)
    }
}

#[derive(Clone)]
struct AppState {
    asset_root: PathBuf,
    canonical_root: PathBuf,
    bind_address: String,
    port: u16,
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    ok: bool,
    #[serde(rename = "bindAddress")]
    bind_address: String,
    port: u16,
    #[serde(rename = "assetRoot")]
    asset_root: String,
    #[serde(rename = "portalPath")]
    portal_path: String,
    #[serde(rename = "appCount")]
    app_count: usize,
    #[serde(rename = "securityHeaders")]
    security_headers: BTreeMap<String, String>,
}

#[derive(Debug, serde::Deserialize)]
struct HeaderQuery {
    path: String,
}

#[derive(Debug, Deserialize)]
struct BundleManifest {
    assets: Vec<BundleAsset>,
}

#[derive(Debug, Deserialize)]
struct BundleAsset {
    path: String,
    size: u64,
    sha256: String,
}

#[derive(Debug, Serialize)]
struct HeaderProbeResponse {
    ok: bool,
    path: String,
    #[serde(rename = "normalizedPath")]
    normalized_path: Option<String>,
    exists: bool,
    #[serde(rename = "contentType")]
    content_type: Option<&'static str>,
    headers: BTreeMap<String, String>,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
struct IntegrityMismatch {
    path: String,
    #[serde(rename = "expectedSize")]
    expected_size: u64,
    #[serde(rename = "actualSize")]
    actual_size: Option<u64>,
    #[serde(rename = "expectedSha256")]
    expected_sha256: String,
    #[serde(rename = "actualSha256")]
    actual_sha256: Option<String>,
    message: String,
}

#[derive(Debug, Serialize)]
struct IntegrityResponse {
    ok: bool,
    #[serde(rename = "checkedAtUnixMs")]
    checked_at_unix_ms: u128,
    #[serde(rename = "manifestPath")]
    manifest_path: String,
    #[serde(rename = "assetCount")]
    asset_count: usize,
    #[serde(rename = "checkedCount")]
    checked_count: usize,
    missing: Vec<String>,
    mismatched: Vec<IntegrityMismatch>,
    errors: Vec<String>,
}

pub fn content_type_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .as_deref()
    {
        Some("html") => "text/html; charset=utf-8",
        Some("js") | Some("mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("wasm") => "application/wasm",
        Some("data") | Some("rds") | Some("so") => "application/octet-stream",
        Some("tgz") | Some("gz") => "application/gzip",
        Some("csv") => "text/csv; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        _ => "application/octet-stream",
    }
}

pub fn normalize_request_path(path: &str) -> Result<PathBuf, StaticPathError> {
    if path.is_empty() {
        return Err(StaticPathError::Empty);
    }

    if path.contains('\\') || path.contains('\0') {
        return Err(StaticPathError::InvalidSegment);
    }

    let decoded = percent_decode_str(path)
        .decode_utf8()
        .map_err(|_| StaticPathError::InvalidEncoding)?;

    if decoded.contains('\\') || decoded.contains('\0') {
        return Err(StaticPathError::InvalidSegment);
    }

    let mut normalized = PathBuf::new();

    for segment in decoded.split('/') {
        match segment {
            "" | "." => {}
            ".." => return Err(StaticPathError::Traversal),
            _ => normalized.push(segment),
        }
    }

    if normalized.as_os_str().is_empty() {
        return Ok(PathBuf::from("portal/index.html"));
    }

    if decoded.ends_with('/') {
        normalized.push("index.html");
    }

    Ok(normalized)
}

pub fn security_headers_for(content_type: &str) -> HeaderMap {
    let mut headers = HeaderMap::new();

    headers.insert(
        CONTENT_TYPE,
        HeaderValue::from_str(content_type).expect("content type constants are valid headers"),
    );
    headers.insert(
        HeaderName::from_static("cross-origin-opener-policy"),
        HeaderValue::from_static("same-origin"),
    );
    headers.insert(
        HeaderName::from_static("cross-origin-embedder-policy"),
        HeaderValue::from_static("require-corp"),
    );
    headers.insert(
        HeaderName::from_static("cross-origin-resource-policy"),
        HeaderValue::from_static("same-origin"),
    );
    headers.insert(
        HeaderName::from_static("service-worker-allowed"),
        HeaderValue::from_static("/"),
    );
    headers.insert(
        HeaderName::from_static("x-content-type-options"),
        HeaderValue::from_static("nosniff"),
    );

    if content_type.starts_with("text/html") {
        headers.insert(CONTENT_SECURITY_POLICY, HeaderValue::from_static(CSP));
    }

    headers
}

pub fn cache_control_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .as_deref()
    {
        Some("html") | Some("json") => "no-store",
        _ => "public, max-age=31536000, immutable",
    }
}

pub fn static_headers_for(path: &Path, content_type: &str) -> HeaderMap {
    let mut headers = security_headers_for(content_type);
    headers.insert(ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    headers.insert(
        CACHE_CONTROL,
        HeaderValue::from_static(cache_control_for_path(path)),
    );
    headers
}

pub fn parse_range_header(range_header: Option<&str>, file_size: u64) -> ByteRange {
    let Some(header) = range_header else {
        return ByteRange::Full;
    };
    let Some(spec) = header.trim().strip_prefix("bytes=") else {
        return ByteRange::Full;
    };
    if file_size == 0 || spec.contains(',') {
        return ByteRange::Full;
    }
    let Some((start_text, end_text)) = spec.split_once('-') else {
        return ByteRange::Full;
    };

    if start_text.is_empty() {
        let Ok(suffix_length) = end_text.parse::<u64>() else {
            return ByteRange::Full;
        };
        if suffix_length == 0 {
            return ByteRange::Unsatisfiable;
        }
        let start = file_size.saturating_sub(suffix_length);
        return ByteRange::Partial {
            start,
            end: file_size - 1,
        };
    }

    let Ok(start) = start_text.parse::<u64>() else {
        return ByteRange::Full;
    };
    let end = if end_text.is_empty() {
        file_size - 1
    } else {
        match end_text.parse::<u64>() {
            Ok(value) => value.min(file_size - 1),
            Err(_) => return ByteRange::Full,
        }
    };

    if start >= file_size || start > end {
        return ByteRange::Unsatisfiable;
    }

    ByteRange::Partial { start, end }
}

pub async fn start(config: ServerConfig) -> Result<StartedServer, ServerError> {
    if !config.asset_root.exists() {
        return Err(ServerError::MissingAssetRoot(config.asset_root));
    }

    let canonical_root = fs::canonicalize(&config.asset_root).await?;
    let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0))).await?;
    let port = listener.local_addr()?.port();
    let bind_address = Ipv4Addr::LOCALHOST.to_string();
    let state = AppState {
        asset_root: config.asset_root.clone(),
        canonical_root,
        bind_address: bind_address.clone(),
        port,
    };
    let router = router(state);

    tokio::spawn(async move {
        if let Err(error) = axum::serve(listener, router).await {
            eprintln!("harness localhost server stopped: {error}");
        }
    });

    Ok(StartedServer {
        bind_address,
        port,
        asset_root: config.asset_root,
        portal_url: format!("http://127.0.0.1:{port}/portal/index.html"),
    })
}

fn router(state: AppState) -> Router {
    Router::new()
        .route("/__harness/health", get(health))
        .route("/__harness/headers", get(header_probe))
        .route("/__harness/integrity", get(integrity))
        .fallback(static_file)
        .with_state(Arc::new(state))
}

async fn health(State(state): State<Arc<AppState>>) -> Json<HealthResponse> {
    let security_headers = headers_to_map(&security_headers_for("text/html; charset=utf-8"));
    let app_count = count_manifest_apps(&state.asset_root).await.unwrap_or(0);

    Json(HealthResponse {
        ok: true,
        bind_address: state.bind_address.clone(),
        port: state.port,
        asset_root: state.asset_root.display().to_string(),
        portal_path: "/portal/index.html".to_string(),
        app_count,
        security_headers,
    })
}

async fn header_probe(
    State(state): State<Arc<AppState>>,
    Query(query): Query<HeaderQuery>,
) -> Json<HeaderProbeResponse> {
    let normalized = match normalize_request_path(&query.path) {
        Ok(path) => path,
        Err(error) => {
            return Json(HeaderProbeResponse {
                ok: false,
                path: query.path,
                normalized_path: None,
                exists: false,
                content_type: None,
                headers: BTreeMap::new(),
                error: Some(format!("{error:?}")),
            });
        }
    };

    let full_path = state.asset_root.join(&normalized);
    let content_type = content_type_for_path(&normalized);
    let exists = full_path.is_file();

    Json(HeaderProbeResponse {
        ok: exists,
        path: query.path,
        normalized_path: Some(normalized.display().to_string()),
        exists,
        content_type: Some(content_type),
        headers: headers_to_map(&static_headers_for(&normalized, content_type)),
        error: None,
    })
}

async fn integrity(State(state): State<Arc<AppState>>) -> Json<IntegrityResponse> {
    let manifest_path = state.asset_root.join("harness-bundle-manifest.json");
    let checked_at_unix_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();

    let manifest_text = match fs::read_to_string(&manifest_path).await {
        Ok(text) => text,
        Err(error) => {
            return Json(IntegrityResponse {
                ok: false,
                checked_at_unix_ms,
                manifest_path: "harness-bundle-manifest.json".to_string(),
                asset_count: 0,
                checked_count: 0,
                missing: vec!["harness-bundle-manifest.json".to_string()],
                mismatched: Vec::new(),
                errors: vec![format!("manifest read failed: {error}")],
            });
        }
    };

    let manifest: BundleManifest = match serde_json::from_str(&manifest_text) {
        Ok(manifest) => manifest,
        Err(error) => {
            return Json(IntegrityResponse {
                ok: false,
                checked_at_unix_ms,
                manifest_path: "harness-bundle-manifest.json".to_string(),
                asset_count: 0,
                checked_count: 0,
                missing: Vec::new(),
                mismatched: Vec::new(),
                errors: vec![format!("manifest parse failed: {error}")],
            });
        }
    };

    let mut checked_count = 0usize;
    let mut missing = Vec::new();
    let mut mismatched = Vec::new();
    let mut errors = Vec::new();

    for asset in &manifest.assets {
        let request_path = format!("/{}", asset.path.trim_start_matches('/'));
        let normalized = match normalize_request_path(&request_path) {
            Ok(path) => path,
            Err(error) => {
                errors.push(format!("{}: invalid manifest path: {error:?}", asset.path));
                continue;
            }
        };

        let full_path = state.asset_root.join(&normalized);
        let canonical = match fs::canonicalize(&full_path).await {
            Ok(path) => path,
            Err(_) => {
                missing.push(asset.path.clone());
                continue;
            }
        };

        if !canonical.starts_with(&state.canonical_root) {
            errors.push(format!("{}: resolved outside asset root", asset.path));
            continue;
        }

        let metadata = match fs::metadata(&canonical).await {
            Ok(metadata) => metadata,
            Err(error) => {
                errors.push(format!("{}: metadata read failed: {error}", asset.path));
                continue;
            }
        };

        if !metadata.is_file() {
            missing.push(asset.path.clone());
            continue;
        }

        let actual_sha256 = match sha256_file(&canonical).await {
            Ok(hash) => hash,
            Err(error) => {
                errors.push(format!("{}: hash read failed: {error}", asset.path));
                continue;
            }
        };
        checked_count += 1;

        let actual_size = metadata.len();
        if actual_size != asset.size || actual_sha256 != asset.sha256 {
            let message = if actual_size != asset.size && actual_sha256 != asset.sha256 {
                "size and sha256 mismatch"
            } else if actual_size != asset.size {
                "size mismatch"
            } else {
                "sha256 mismatch"
            };
            mismatched.push(IntegrityMismatch {
                path: asset.path.clone(),
                expected_size: asset.size,
                actual_size: Some(actual_size),
                expected_sha256: asset.sha256.clone(),
                actual_sha256: Some(actual_sha256),
                message: message.to_string(),
            });
        }
    }

    Json(IntegrityResponse {
        ok: missing.is_empty() && mismatched.is_empty() && errors.is_empty(),
        checked_at_unix_ms,
        manifest_path: "harness-bundle-manifest.json".to_string(),
        asset_count: manifest.assets.len(),
        checked_count,
        missing,
        mismatched,
        errors,
    })
}

async fn static_file(State(state): State<Arc<AppState>>, headers: HeaderMap, uri: Uri) -> Response {
    let normalized = match normalize_request_path(uri.path()) {
        Ok(path) => path,
        Err(_) => return status_response(StatusCode::BAD_REQUEST, "invalid path"),
    };

    let full_path = state.asset_root.join(&normalized);
    let canonical = match fs::canonicalize(&full_path).await {
        Ok(path) => path,
        Err(_) => return status_response(StatusCode::NOT_FOUND, "not found"),
    };

    if !canonical.starts_with(&state.canonical_root) {
        return status_response(StatusCode::FORBIDDEN, "forbidden");
    }

    let metadata = match fs::metadata(&canonical).await {
        Ok(metadata) => metadata,
        Err(_) => return status_response(StatusCode::NOT_FOUND, "not found"),
    };

    if !metadata.is_file() {
        return status_response(StatusCode::NOT_FOUND, "not found");
    }

    let content_type = content_type_for_path(&normalized);
    let file_size = metadata.len();
    let range_header = headers.get(RANGE).and_then(|value| value.to_str().ok());
    let mut response_headers = static_headers_for(&normalized, content_type);

    let (status, body, content_length, content_range) =
        match parse_range_header(range_header, file_size) {
            ByteRange::Full => {
                let body = match fs::read(&canonical).await {
                    Ok(bytes) => bytes,
                    Err(_) => {
                        return status_response(StatusCode::INTERNAL_SERVER_ERROR, "read failed")
                    }
                };
                (StatusCode::OK, body, file_size, None)
            }
            ByteRange::Partial { start, end } => {
                let length = end - start + 1;
                let mut file = match fs::File::open(&canonical).await {
                    Ok(file) => file,
                    Err(_) => {
                        return status_response(StatusCode::INTERNAL_SERVER_ERROR, "read failed")
                    }
                };
                if file.seek(SeekFrom::Start(start)).await.is_err() {
                    return status_response(StatusCode::INTERNAL_SERVER_ERROR, "read failed");
                }
                let mut body = vec![0u8; length as usize];
                if file.read_exact(&mut body).await.is_err() {
                    return status_response(StatusCode::INTERNAL_SERVER_ERROR, "read failed");
                }
                (
                    StatusCode::PARTIAL_CONTENT,
                    body,
                    length,
                    Some(format!("bytes {start}-{end}/{file_size}")),
                )
            }
            ByteRange::Unsatisfiable => {
                response_headers.insert(
                    CONTENT_RANGE,
                    HeaderValue::from_str(&format!("bytes */{file_size}"))
                        .expect("content range is a valid header"),
                );
                let mut response = Response::new(Body::from("range not satisfiable"));
                *response.status_mut() = StatusCode::RANGE_NOT_SATISFIABLE;
                *response.headers_mut() = response_headers;
                return response;
            }
        };

    response_headers.insert(
        CONTENT_LENGTH,
        HeaderValue::from_str(&content_length.to_string()).expect("content length is valid"),
    );
    if let Some(content_range) = content_range {
        response_headers.insert(
            CONTENT_RANGE,
            HeaderValue::from_str(&content_range).expect("content range is a valid header"),
        );
    }

    let mut response = Response::new(Body::from(body));
    *response.status_mut() = status;
    *response.headers_mut() = response_headers;

    response
}

fn status_response(status: StatusCode, message: &'static str) -> Response {
    (status, message).into_response()
}

fn headers_to_map(headers: &HeaderMap) -> BTreeMap<String, String> {
    headers
        .iter()
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|value| (name.as_str().to_string(), value.to_string()))
        })
        .collect()
}

async fn sha256_file(path: &Path) -> Result<String, std::io::Error> {
    let bytes = fs::read(path).await?;
    let digest = Sha256::digest(&bytes);

    Ok(digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>())
}

async fn count_manifest_apps(asset_root: &Path) -> Result<usize, std::io::Error> {
    let manifest = fs::read_to_string(asset_root.join("manifest.json")).await?;
    let parsed: serde_json::Value = serde_json::from_str(&manifest).unwrap_or_default();

    Ok(parsed
        .get("apps")
        .and_then(|apps| apps.as_array())
        .map_or(0, |apps| apps.len()))
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use http::header::{CONTENT_SECURITY_POLICY, CONTENT_TYPE};

    use super::{
        cache_control_for_path, content_type_for_path, normalize_request_path, parse_range_header,
        security_headers_for, sha256_file, ByteRange, StaticPathError,
    };

    #[test]
    fn maps_required_mime_types() {
        assert_eq!(
            content_type_for_path(Path::new("app/index.html")),
            "text/html; charset=utf-8"
        );
        assert_eq!(
            content_type_for_path(Path::new("assets/app.mjs")),
            "text/javascript; charset=utf-8"
        );
        assert_eq!(
            content_type_for_path(Path::new("webr/webr.wasm")),
            "application/wasm"
        );
        assert_eq!(
            content_type_for_path(Path::new("webr/library.data.gz")),
            "application/gzip"
        );
        assert_eq!(
            content_type_for_path(Path::new("data/subject_safety.csv")),
            "text/csv; charset=utf-8"
        );
    }

    #[test]
    fn normalizes_safe_paths_and_defaults_to_portal() {
        assert_eq!(
            normalize_request_path("/").unwrap(),
            Path::new("portal/index.html")
        );
        assert_eq!(
            normalize_request_path("/portal/index.html").unwrap(),
            Path::new("portal/index.html")
        );
        assert_eq!(
            normalize_request_path("/apps/subject-safety-mini/").unwrap(),
            Path::new("apps/subject-safety-mini/index.html")
        );
    }

    #[test]
    fn rejects_path_traversal_and_backslashes() {
        assert_eq!(
            normalize_request_path("/../secret").unwrap_err(),
            StaticPathError::Traversal
        );
        assert_eq!(
            normalize_request_path("/apps/%2e%2e/secret").unwrap_err(),
            StaticPathError::Traversal
        );
        assert_eq!(
            normalize_request_path("/apps\\secret").unwrap_err(),
            StaticPathError::InvalidSegment
        );
    }

    #[test]
    fn builds_security_headers_for_html() {
        let headers = security_headers_for("text/html; charset=utf-8");

        assert_eq!(
            headers
                .get("Cross-Origin-Opener-Policy")
                .and_then(|v| v.to_str().ok()),
            Some("same-origin")
        );
        assert_eq!(
            headers
                .get("Cross-Origin-Embedder-Policy")
                .and_then(|v| v.to_str().ok()),
            Some("require-corp")
        );
        assert_eq!(
            headers.get(CONTENT_TYPE).and_then(|v| v.to_str().ok()),
            Some("text/html; charset=utf-8")
        );
        assert!(headers.get(CONTENT_SECURITY_POLICY).is_some());
    }

    #[test]
    fn omits_csp_for_non_html_assets() {
        let headers = security_headers_for("application/wasm");

        assert_eq!(
            headers.get(CONTENT_TYPE).and_then(|v| v.to_str().ok()),
            Some("application/wasm")
        );
        assert!(headers.get(CONTENT_SECURITY_POLICY).is_none());
    }

    #[test]
    fn chooses_cache_policy_by_static_asset_type() {
        assert_eq!(
            cache_control_for_path(Path::new("portal/index.html")),
            "no-store"
        );
        assert_eq!(
            cache_control_for_path(Path::new("manifest.json")),
            "no-store"
        );
        assert_eq!(
            cache_control_for_path(Path::new("apps/subject-profile/shinylive/webr/R.wasm")),
            "public, max-age=31536000, immutable"
        );
    }

    #[test]
    fn parses_single_byte_ranges_for_large_runtime_assets() {
        assert_eq!(
            parse_range_header(Some("bytes=10-19"), 100),
            ByteRange::Partial { start: 10, end: 19 }
        );
        assert_eq!(
            parse_range_header(Some("bytes=90-"), 100),
            ByteRange::Partial { start: 90, end: 99 }
        );
        assert_eq!(
            parse_range_header(Some("bytes=-10"), 100),
            ByteRange::Partial { start: 90, end: 99 }
        );
        assert_eq!(
            parse_range_header(Some("bytes=100-120"), 100),
            ByteRange::Unsatisfiable
        );
        assert_eq!(parse_range_header(Some("items=0-10"), 100), ByteRange::Full);
    }

    #[tokio::test]
    async fn computes_sha256_for_integrity_checks() {
        let dir =
            std::env::temp_dir().join(format!("harness-server-sha-test-{}", std::process::id()));
        tokio::fs::create_dir_all(&dir).await.unwrap();
        let file = dir.join("sample.txt");
        tokio::fs::write(&file, b"abc").await.unwrap();

        assert_eq!(
            sha256_file(&file).await.unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );

        let _ = tokio::fs::remove_dir_all(&dir).await;
    }
}
