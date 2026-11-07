//! Terminal tool backend: real PTY sessions (ConPTY on Windows) via
//! `portable-pty`. Output is streamed as base64 chunks; input is raw bytes.

use crate::{next_id, TermHandle};
use base64::Engine;
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{command, AppHandle, Emitter, State};

pub struct TermState {
    pub masters: Mutex<HashMap<u64, Box<dyn portable_pty::MasterPty + Send>>>,
    pub writers: Mutex<HashMap<u64, Box<dyn Write + Send>>>,
    pub killers: Mutex<HashMap<u64, Box<dyn portable_pty::ChildKiller + Send + Sync>>>,
}

impl TermState {
    pub fn new() -> Self {
        Self {
            masters: Mutex::new(HashMap::new()),
            writers: Mutex::new(HashMap::new()),
            killers: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TermOutEvent {
    pub id: u64,
    pub data: String, // base64
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TermExitEvent {
    pub id: u64,
}

fn default_shell() -> String {
    std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".into())
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TermSpawnArgs {
    pub shell: Option<String>,
    pub cwd: Option<String>,
    pub rows: Option<u16>,
    pub cols: Option<u16>,
}

#[command]
pub fn term_default_shell() -> String {
    default_shell()
}

#[command]
pub fn term_spawn(
    app: AppHandle,
    state: State<'_, TermState>,
    args: TermSpawnArgs,
) -> Result<TermHandle, String> {
    let id = next_id();
    let rows = args.rows.unwrap_or(30).max(2);
    let cols = args.cols.unwrap_or(120).max(10);

    let pty_system = NativePtySystem::default();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(args.shell.clone().unwrap_or_else(default_shell));
    if let Some(cwd) = &args.cwd {
        cmd.cwd(cwd);
    }

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {e}"))?;
    drop(pair.slave); // EOF for the child if it closes

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let killer = child.clone_killer();

    // Reader thread: PTY bytes → base64 events.
    let app_out = app.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let _ = app_out.emit(
                        "term://out",
                        TermOutEvent {
                            id,
                            data: base64::engine::general_purpose::STANDARD.encode(&buf[..n]),
                        },
                    );
                }
            }
        }
        let _ = app_out.emit("term://exit", TermExitEvent { id });
    });

    // Waiter thread: notify the frontend when the shell exits.
    let app_wait = app.clone();
    std::thread::spawn(move || {
        let _ = child.wait();
        let _ = app_wait.emit("term://exit", TermExitEvent { id });
    });

    state.masters.lock().unwrap().insert(id, pair.master);
    state.writers.lock().unwrap().insert(id, writer);
    state.killers.lock().unwrap().insert(id, killer);

    Ok(TermHandle { id })
}

#[command]
pub fn term_write(state: State<'_, TermState>, id: u64, data: String) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| e.to_string())?;
    let mut writers = state.writers.lock().unwrap();
    if let Some(writer) = writers.get_mut(&id) {
        writer.write_all(&bytes).map_err(|e| e.to_string())
    } else {
        Err("no such terminal".into())
    }
}

#[command]
pub fn term_resize(state: State<'_, TermState>, id: u64, rows: u16, cols: u16) -> Result<(), String> {
    let masters = state.masters.lock().unwrap();
    if let Some(master) = masters.get(&id) {
        master
            .resize(PtySize {
                rows: rows.max(2),
                cols: cols.max(10),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())
    } else {
        Err("no such terminal".into())
    }
}

#[command]
pub fn term_kill(state: State<'_, TermState>, id: u64) -> Result<(), String> {
    if let Some(mut killer) = state.killers.lock().unwrap().remove(&id) {
        let _ = killer.kill();
    }
    state.masters.lock().unwrap().remove(&id);
    state.writers.lock().unwrap().remove(&id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conpty_spawn_works() {
        let pty_system = NativePtySystem::default();
        let pair = pty_system
            .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
            .expect("openpty failed");
        let mut cmd = CommandBuilder::new(default_shell());
        let mut child = pair.slave.spawn_command(cmd).expect("spawn failed");
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().expect("reader failed");
        let mut buf = [0u8; 256];
        std::thread::sleep(std::time::Duration::from_millis(500));
        let n = reader.read(&mut buf).expect("read failed");
        println!("read {n} bytes: {:?}", String::from_utf8_lossy(&buf[..n]));
        let _ = child.kill();
        assert!(n > 0, "expected prompt output from shell");
    }
}
