use std::{collections::BTreeMap, fs, path::Path};

use harness_server::{start, ServerConfig};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};

struct HttpResponse {
    status: u16,
    headers: BTreeMap<String, String>,
    body: Vec<u8>,
}

fn sha256_text(value: &str) -> String {
    let digest = Sha256::digest(value.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn write_asset(root: &Path, relative: &str, contents: &str) {
    let target = root.join(relative);
    fs::create_dir_all(target.parent().unwrap()).unwrap();
    fs::write(target, contents).unwrap();
}

fn bundle_manifest(portal_html: &str, manifest_json: &str) -> String {
    serde_json::json!({
        "schemaVersion": 1,
        "assets": [
            {
                "path": "portal/index.html",
                "size": portal_html.len(),
                "sha256": sha256_text(portal_html)
            },
            {
                "path": "manifest.json",
                "size": manifest_json.len(),
                "sha256": sha256_text(manifest_json)
            }
        ]
    })
    .to_string()
}

#[cfg(unix)]
fn try_symlink_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(source, destination)
}

#[cfg(windows)]
fn try_symlink_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_file(source, destination)
}

async fn http_get(port: u16, path: &str, extra_headers: &[(&str, &str)]) -> HttpResponse {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    let mut request = format!(
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n"
    );
    for (name, value) in extra_headers {
        request.push_str(&format!("{name}: {value}\r\n"));
    }
    request.push_str("\r\n");
    stream.write_all(request.as_bytes()).await.unwrap();

    let mut bytes = Vec::new();
    stream.read_to_end(&mut bytes).await.unwrap();
    let split = bytes
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .unwrap();
    let head = String::from_utf8_lossy(&bytes[..split]);
    let mut lines = head.split("\r\n");
    let status = lines
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse::<u16>().ok())
        .unwrap();
    let headers = lines
        .filter_map(|line| {
            let (name, value) = line.split_once(": ")?;
            Some((name.to_ascii_lowercase(), value.to_string()))
        })
        .collect();

    HttpResponse {
        status,
        headers,
        body: bytes[split + 4..].to_vec(),
    }
}

#[tokio::test]
async fn serves_static_assets_with_security_boundaries() {
    std::env::remove_var("HARNESS_DEBUG_HEALTH");
    let temp_root = std::env::temp_dir().join(format!(
        "harness-http-security-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&temp_root);
    let root = temp_root.join("dist");
    fs::create_dir_all(&root).unwrap();

    let portal_html = "<!doctype html><html><body>hello harness</body></html>";
    let manifest_json = r#"{"apps":[{"id":"demo"}]}"#;
    write_asset(&root, "portal/index.html", portal_html);
    write_asset(&root, "manifest.json", manifest_json);
    write_asset(
        &root,
        "harness-bundle-manifest.json",
        &bundle_manifest(portal_html, manifest_json),
    );

    let outside_secret = temp_root.join("secret.txt");
    fs::write(&outside_secret, "secret").unwrap();
    let symlink_path = root.join("portal").join("leak.txt");
    let symlink_created = try_symlink_file(&outside_secret, &symlink_path).is_ok();

    let server = start(ServerConfig {
        asset_root: root.clone(),
    })
    .await
    .unwrap();

    let health = http_get(server.port, "/__harness/health", &[]).await;
    assert_eq!(health.status, 200);
    let health_json: Value = serde_json::from_slice(&health.body).unwrap();
    assert_eq!(health_json["ok"], true);
    assert_eq!(health_json["assetRootKind"], "bundled-static-root");
    assert!(health_json.get("assetRoot").is_none());

    let html = http_get(server.port, "/portal/index.html", &[]).await;
    assert_eq!(html.status, 200);
    assert_eq!(
        html.headers.get("cross-origin-opener-policy").map(String::as_str),
        Some("same-origin")
    );
    assert_eq!(
        html.headers.get("cross-origin-embedder-policy").map(String::as_str),
        Some("require-corp")
    );
    assert!(html.headers.contains_key("content-security-policy"));
    assert_eq!(
        html.headers.get("x-content-type-options").map(String::as_str),
        Some("nosniff")
    );

    let range = http_get(server.port, "/portal/index.html", &[("Range", "bytes=0-15")]).await;
    assert_eq!(range.status, 206);
    let expected_content_range = format!("bytes 0-15/{}", portal_html.len());
    assert_eq!(
        range.headers.get("content-range").map(String::as_str),
        Some(expected_content_range.as_str())
    );
    assert_eq!(
        range.headers.get("cache-control").map(String::as_str),
        Some("no-store")
    );

    let invalid_range =
        http_get(server.port, "/portal/index.html", &[("Range", "bytes=99999-100000")]).await;
    assert_eq!(invalid_range.status, 416);

    let traversal = http_get(server.port, "/apps/%2e%2e/secret", &[]).await;
    assert!(matches!(traversal.status, 400 | 403 | 404));

    if symlink_created {
        let symlink = http_get(server.port, "/portal/leak.txt", &[]).await;
        assert_eq!(symlink.status, 403);
    }

    let integrity = http_get(server.port, "/__harness/integrity", &[]).await;
    assert_eq!(integrity.status, 200);
    let integrity_json: Value = serde_json::from_slice(&integrity.body).unwrap();
    assert_eq!(integrity_json["ok"], true);

    write_asset(&root, "portal/index.html", "tampered");
    let tampered_integrity = http_get(server.port, "/__harness/integrity", &[]).await;
    let tampered_json: Value = serde_json::from_slice(&tampered_integrity.body).unwrap();
    assert_eq!(tampered_json["ok"], false);

    let _ = fs::remove_dir_all(&temp_root);
}
