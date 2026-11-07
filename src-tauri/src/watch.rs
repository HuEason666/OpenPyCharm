//! Project file watching (notify): debounced change events emitted to the
//! frontend as `fs://change`. One watcher per project root.

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{command, AppHandle, Emitter, State};

use crate::next_id;

pub struct WatchState {
    pub watchers: Mutex<HashMap<u64, RecommendedWatcher>>,
}

impl WatchState {
    pub fn new() -> Self {
        Self {
            watchers: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FsChangeEvent {
    /// Canonical project root the watcher belongs to.
    pub root: String,
    /// Paths reported by the watcher (may include removed paths).
    pub paths: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchStartArgs {
    pub root: String,
}

#[command]
pub fn watch_start(app: AppHandle, state: State<'_, WatchState>, args: WatchStartArgs) -> Result<u64, String> {
    let id = next_id();
    let root = args.root;
    #[cfg(debug_assertions)]
    eprintln!("[watch] start #{id} for {root}");

    let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();
    let mut watcher = notify::recommended_watcher(tx).map_err(|e| e.to_string())?;
    watcher
        .watch(std::path::Path::new(&root), RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;
    // Keep the watcher alive; drop() unregisters it.
    state.watchers.lock().unwrap().insert(id, watcher);

    let app_emit = app.clone();
    let root_emit = root.clone();
    std::thread::spawn(move || {
        // Debounce: collect events in ~250ms windows, then emit one batch.
        loop {
            let Ok(first) = rx.recv() else { break };
            let mut paths: Vec<String> = match first {
                Ok(ev) => event_paths(&ev),
                Err(_) => Vec::new(),
            };
            let deadline = std::time::Instant::now() + Duration::from_millis(250);
            loop {
                let remaining = deadline.saturating_duration_since(std::time::Instant::now());
                match rx.recv_timeout(remaining.max(Duration::from_millis(1))) {
                    Ok(Ok(ev)) => paths.extend(event_paths(&ev)),
                    Ok(Err(_)) => continue,
                    Err(_) => break, // timeout or channel closed
                }
            }
            paths.sort();
            paths.dedup();
            if paths.is_empty() {
                continue;
            }
            #[cfg(debug_assertions)]
            eprintln!("[watch] emit {} paths", paths.len());
            let _ = app_emit.emit(
                "fs://change",
                FsChangeEvent {
                    root: root_emit.clone(),
                    paths,
                },
            );
        }
    });

    Ok(id)
}

fn event_paths(ev: &notify::Event) -> Vec<String> {
    ev.paths
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

#[command]
pub fn watch_stop(state: State<'_, WatchState>, id: u64) -> Result<(), String> {
    state.watchers.lock().unwrap().remove(&id);
    Ok(())
}
