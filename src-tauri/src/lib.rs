//! OpenPyCharm — an open-source Python IDE inspired by JetBrains PyCharm.
//!
//! Tauri glue: registers the command handlers and background state. Command
//! implementations live in the sibling modules (`fs`, `search`, `python`,
//! `run`, `term`, `settings`, `app`).

mod app;
mod bridge;
mod db;
mod format;
mod fs;
mod git;
mod ai;
mod lsp;
mod python;
mod run;
mod search;
mod settings;
mod term;
mod watch;

use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::AtomicU64;
use std::sync::Mutex;

/// Monotonic ids for spawned processes and terminals.
pub static NEXT_ID: AtomicU64 = AtomicU64::new(1);

pub fn next_id() -> u64 {
    NEXT_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

/// Handle to a spawned process (a Run session).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunHandle {
    pub id: u64,
}

/// Handle to a PTY-backed terminal session.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TermHandle {
    pub id: u64,
}

pub struct AppState {
    /// run_id → child pid (dropped/killed on stop)
    pub runs: Mutex<HashMap<u64, u32>>,
}

impl AppState {
    fn new() -> Self {
        Self {
            runs: Mutex::new(HashMap::new()),
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new())
        .manage(term::TermState::new())
        .manage(bridge::BridgeState::new())
        .manage(watch::WatchState::new())
        .invoke_handler(tauri::generate_handler![
            // fs
            fs::fs_read_dir,
            fs::fs_read_text,
            fs::fs_write_text,
            fs::fs_create_file,
            fs::fs_create_dir,
            fs::fs_rename,
            fs::fs_delete,
            fs::fs_stat,
            fs::fs_exists,
            fs::fs_reveal_in_shell,
            fs::find_files,
            fs::fs_create_scratch,
            fs::fs_user_home,
            // search
            search::search_in_files,
            // git
            git::git_info,
            git::git_status,
            git::git_diff,
            git::git_show,
            git::git_log,
            git::git_stage,
            git::git_restore,
            git::git_init,
            git::git_unstage,
            git::git_commit,
            git::git_push,
            git::git_pull,
            git::git_clone,
            // python
            python::sdk_detect,
            python::python_has_module,
            python::uv_detect,
            python::python_create_venv,
            python::uv_create_venv,
            python::conda_create_env,
            format::python_format,
            format::python_organize_imports,
            // ai agent
            ai::ai_chat,
            ai::ai_image_data_url,
            // database
            db::db_tables,
            db::db_query,
            db::db_mysql_databases,
            db::db_mysql_tables,
            db::db_mysql_query,
            db::db_pg_databases,
            db::db_pg_tables,
            db::db_pg_query,
            // run
            run::run_start,
            run::run_stop,
            run::run_write_stdin,
            // terminal
            term::term_spawn,
            term::term_write,
            term::term_resize,
            term::term_kill,
            term::term_default_shell,
            // language server & debugger bridge
            bridge::bridge_spawn,
            bridge::bridge_send,
            bridge::bridge_stop,
            lsp::lsp_start,
            // file watching
            watch::watch_start,
            watch::watch_stop,
            // settings & app
            settings::settings_get,
            settings::settings_set,
            app::app_info,
            app::recent_projects,
            app::add_recent_project,
            app::remove_recent_project,
            app::open_path_in_shell,
        ])
        .run(tauri::generate_context!())
        .expect("error while running OpenPyCharm");
}
