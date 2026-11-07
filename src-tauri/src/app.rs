//! App-level commands: info banner, recent projects, opening paths with the OS.

use serde::Serialize;
use std::fs;
use tauri::command;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub os: String,
    pub os_version: String,
}

#[command]
pub fn app_info() -> AppInfo {
    AppInfo {
        name: "OpenPyCharm".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        os: std::env::consts::OS.into(),
        os_version: os_version(),
    }
}

fn os_version() -> String {
    #[cfg(target_os = "windows")]
    {
        // Read the friendly product name from the registry-free source: winver string.
        std::env::var("OS").unwrap_or_else(|_| "Windows".into())
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::consts::OS.into()
    }
}

/// Recents live in the same settings.json the frontend owns (`recents: []`).
fn recents_from_settings(app: &tauri::AppHandle) -> Vec<String> {
    super::settings::settings_get(app.clone())
        .get("recents")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentEntry {
    pub path: String,
}

#[command]
pub fn recent_projects(app: tauri::AppHandle) -> Vec<RecentEntry> {
    recents_from_settings(&app)
        .into_iter()
        .map(|path| RecentEntry { path })
        .collect()
}

#[command]
pub fn add_recent_project(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let mut v = super::settings::settings_get(app.clone());
    if !v.is_object() {
        v = serde_json::json!({});
    }
    let mut recents: Vec<String> = v
        .get("recents")
        .and_then(|a| a.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
        .unwrap_or_default();
    recents.retain(|p| p != &path);
    recents.insert(0, path.clone());
    recents.truncate(12);
    // Drop recents that no longer exist on disk.
    recents.retain(|p| fs::metadata(p).is_ok());
    v["recents"] = serde_json::json!(recents);
    super::settings::settings_set(app, v)
}

#[command]
pub fn remove_recent_project(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let mut v = super::settings::settings_get(app.clone());
    if let Some(arr) = v.get_mut("recents").and_then(|a| a.as_array_mut()) {
        arr.retain(|x| x.as_str() != Some(path.as_str()));
    }
    super::settings::settings_set(app, v)
}

/// Open a path with the OS default handler (via tauri-plugin-opener).
#[command]
pub fn open_path_in_shell(_app: tauri::AppHandle, path: String) -> Result<(), String> {
    tauri_plugin_opener::open_path(path, None::<&str>).map_err(|e| e.to_string())
}
