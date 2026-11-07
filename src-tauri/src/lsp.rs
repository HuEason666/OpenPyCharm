//! Locates the bundled pyright language server and starts it through the
//! framed bridge. The server script ships in devDependencies (npm install -D
//! pyright); OPENPYCHARM_PYRIGHT can point at a different entry point.

use crate::bridge::{bridge_spawn, BridgeState, SpawnArgs};
use serde::Serialize;
use std::path::Path;
use tauri::{command, AppHandle, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspSession {
    pub id: u64,
    pub server: String,
}

fn find_langserver() -> Option<String> {
    if let Ok(path) = std::env::var("OPENPYCHARM_PYRIGHT") {
        if Path::new(&path).is_file() {
            return Some(path);
        }
    }
    let exe = std::env::current_exe().ok()?;
    for ancestor in exe.ancestors().take(6) {
        let candidate = ancestor
            .join("node_modules")
            .join("pyright")
            .join("langserver.index.js");
        if candidate.is_file() {
            return Some(candidate.to_string_lossy().into_owned());
        }
    }
    None
}

#[command]
pub fn lsp_start(
    app: AppHandle,
    state: State<'_, BridgeState>,
    root: String,
    python: Option<String>,
) -> Result<LspSession, String> {
    let script = find_langserver()
        .ok_or("pyright not found. Install it in the app directory: npm install -D pyright")?;
    let path_prepend = python
        .as_deref()
        .and_then(|p| Path::new(p).parent().map(|d| d.to_string_lossy().into_owned()));
    // A page reload drops the JS session id; kill any server still attached.
    state.stop_kind("lsp");
    let id = bridge_spawn(
        app,
        state,
        SpawnArgs {
            kind: "lsp".into(),
            program: "node".into(),
            args: vec![script, "--stdio".into()],
            cwd: Some(root),
            path_prepend,
        },
    )?;
    Ok(LspSession {
        id,
        server: "pyright".into(),
    })
}
