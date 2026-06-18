use std::{
    collections::BTreeMap,
    net::{Ipv4Addr, SocketAddr},
    path::{Path, PathBuf},
    sync::Arc,
};

use axum::{
    body::Body,
    extract::{Query, State},
    http::{
        header::{CONTENT_SECURITY_POLICY, CONTENT_TYPE},
        HeaderMap, HeaderName, HeaderValue, StatusCode, Uri,
    },
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use percent_encoding::percent_decode_str;
use serde::Serialize;
use tokio::{fs, net::TcpListener};

pub const CSP: &str = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; frame-src 'self'; object-src 'none'; base-uri 'self';";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StaticPathError {
    Empty,
    Traversal,
    InvalidEncoding,
    InvalidSegment,
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
        headers: headers_to_map(&security_headers_for(content_type)),
        error: None,
    })
}

async fn static_file(State(state): State<Arc<AppState>>, uri: Uri) -> Response {
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

    let body = match fs::read(&canonical).await {
        Ok(bytes) => bytes,
        Err(_) => return status_response(StatusCode::INTERNAL_SERVER_ERROR, "read failed"),
    };
    let content_type = content_type_for_path(&normalized);
    let mut response = Response::new(Body::from(body));

    *response.status_mut() = StatusCode::OK;
    *response.headers_mut() = security_headers_for(content_type);

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
        content_type_for_path, normalize_request_path, security_headers_for, StaticPathError,
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
}
