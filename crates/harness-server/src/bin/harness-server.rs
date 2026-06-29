use std::{env, path::PathBuf};

use harness_server::{start, ServerConfig};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let asset_root = env::args().nth(1).unwrap_or_else(|| "dist".to_string());
    let server = start(ServerConfig {
        asset_root: PathBuf::from(asset_root),
    })
    .await?;

    println!("{}", server.portal_url);
    std::future::pending::<()>().await;

    Ok(())
}
