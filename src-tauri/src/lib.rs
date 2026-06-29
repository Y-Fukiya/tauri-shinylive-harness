use std::path::PathBuf;

use harness_server::{start, ServerConfig};
use tauri::Manager;
use url::Url;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let asset_root = resolve_asset_root(app)?;
            let server = tauri::async_runtime::block_on(start(ServerConfig { asset_root }))?;
            let portal_url = Url::parse(&server.portal_url)?;

            println!(
                "harness localhost server listening on {}:{}",
                server.bind_address, server.port
            );

            let window = app
                .get_webview_window("main")
                .expect("main window must exist");
            window.navigate(portal_url)?;
            window.show()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn resolve_asset_root(app: &tauri::App) -> Result<PathBuf, Box<dyn std::error::Error>> {
    if cfg!(debug_assertions) {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        if let Some(project_root) = manifest_dir.parent() {
            let dev_dist = project_root.join("dist");
            if dev_dist.exists() {
                return Ok(dev_dist);
            }
        }
    }

    let resource_dir = app.path().resource_dir()?;
    let bundled_up_dist = resource_dir.join("_up_").join("dist");
    if bundled_up_dist.exists() {
        return Ok(bundled_up_dist);
    }

    let bundled_dist = resource_dir.join("dist");
    if bundled_dist.exists() {
        return Ok(bundled_dist);
    }

    Ok(resource_dir)
}
