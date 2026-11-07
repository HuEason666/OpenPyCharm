//! App settings persistence. The settings payload is an opaque JSON object
//! owned by the frontend (theme, font size, run configs, interpreter choice…);
//! the backend only stores/loads it atomically in the OS config directory.

use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use tauri::{command, Manager};

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|_| "no config dir".to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

#[command]
pub fn settings_get(app: tauri::AppHandle) -> Value {
    match settings_path(&app).and_then(|p| fs::read_to_string(p).map_err(|e| e.to_string())) {
        Ok(text) => serde_json::from_str(&text).unwrap_or(Value::Null),
        Err(_) => Value::Null,
    }
}

#[command]
pub fn settings_set(app: tauri::AppHandle, value: Value) -> Result<(), String> {
    let path = settings_path(&app)?;
    let tmp = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}
