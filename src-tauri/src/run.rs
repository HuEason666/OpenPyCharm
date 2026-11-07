//! Run tool backend: spawn a process (usually `python file.py`), stream its
//! output to the frontend as events, allow stdin writes and hard stops.

use crate::{next_id, AppState, RunHandle};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufReader, Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use tauri::{command, AppHandle, Emitter, State};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChunkEvent {
    pub id: u64,
    pub stream: String, // "stdout" | "stderr" | "system"
    pub text: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExitEvent {
    pub id: u64,
    pub code: Option<i32>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RunStartArgs {
    pub exe: String,
    pub args: Vec<String>,
    pub cwd: String,
    pub env: Option<HashMap<String, String>>,
}

fn emit_chunk(app: &AppHandle, id: u64, stream: &str, text: &str) {
    let _ = app.emit(
        "run://chunk",
        ChunkEvent {
            id,
            stream: stream.into(),
            text: text.into(),
        },
    );
}

fn spawn_reader(app: AppHandle, id: u64, stream: &'static str, rd: impl Read + Send + 'static) {
    std::thread::spawn(move || {
        let mut reader = BufReader::new(rd);
        let mut buf = Vec::new();
        // Read in chunks; emit partial lines as they come (progress bars etc.).
        let mut byte_buf = [0u8; 8192];
        loop {
            match reader.read(&mut byte_buf) {
                Ok(0) => break,
                Ok(n) => {
                    buf.extend_from_slice(&byte_buf[..n]);
                    // Emit at line boundaries when possible, else on buffer growth.
                    while let Some(pos) = buf.iter().rposition(|&b| b == b'\n') {
                        let chunk: Vec<u8> = buf.drain(..=pos).collect();
                        emit_chunk(
                            &app,
                            id,
                            stream,
                            &String::from_utf8_lossy(&chunk),
                        );
                    }
                    if buf.len() > 16 * 1024 {
                        let chunk: Vec<u8> = buf.drain(..).collect();
                        emit_chunk(&app, id, stream, &String::from_utf8_lossy(&chunk));
                    }
                }
                Err(_) => break,
            }
        }
        if !buf.is_empty() {
            emit_chunk(&app, id, stream, &String::from_utf8_lossy(&buf));
        }
    });
}

#[command]
pub fn run_start(
    app: AppHandle,
    state: State<'_, AppState>,
    args: RunStartArgs,
) -> Result<RunHandle, String> {
    let id = next_id();
    let mut cmd = Command::new(&args.exe);
    cmd.args(&args.args)
        .current_dir(&args.cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env_remove("PYTHONUNBUFFERED");
    cmd.env("PYTHONUNBUFFERED", "1").env("PYTHONIOENCODING", "utf-8");
    if let Some(env) = &args.env {
        for (k, v) in env {
            cmd.env(k, v);
        }
    }
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child: Child = cmd.spawn().map_err(|e| format!("Failed to start: {e}"))?;
    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");
    let stdin = child.stdin.take().expect("stdin piped");
    register_stdin(id, stdin);
    let pid = child.id();

    state.runs.lock().unwrap().insert(id, pid);

    let app2 = app.clone();
    std::thread::spawn(move || {
        // Wait for exit, then notify.
        let code = {
            let mut c = child;
            loop {
                match c.try_wait() {
                    Ok(Some(status)) => break status.code(),
                    Ok(None) => std::thread::sleep(std::time::Duration::from_millis(60)),
                    Err(_) => break None,
                }
            }
        };
        let _ = app2.emit(
            "run://exit",
            ExitEvent {
                id,
                code,
            },
        );
    });

    spawn_reader(app.clone(), id, "stdout", stdout);
    spawn_reader(app.clone(), id, "stderr", stderr);

    Ok(RunHandle { id })
}

#[command]
pub fn run_stop(app: AppHandle, state: State<'_, AppState>, id: u64) -> Result<(), String> {
    let pid = state.runs.lock().unwrap().remove(&id);
    match pid {
        Some(pid) => {
            #[cfg(target_os = "windows")]
            {
                // Kill the whole tree (python may have children).
                let _ = Command::new("taskkill")
                    .args(["/PID", &pid.to_string(), "/T", "/F"])
                    .creation_flags(CREATE_NO_WINDOW)
                    .output();
            }
            #[cfg(not(target_os = "windows"))]
            {
                unsafe {
                    libc_kill(pid as i32, 15);
                }
            }
            let _ = app; // events will arrive via the wait thread
            Ok(())
        }
        None => Err("no such run".into()),
    }
}

#[cfg(not(target_os = "windows"))]
extern "C" {
    fn libc_kill(pid: i32, sig: i32) -> i32;
}

#[command]
pub fn run_write_stdin(_state: State<'_, AppState>, id: u64, text: String) -> Result<(), String> {
    if let Some(writer) = STDINS.lock().unwrap().get_mut(&id) {
        writer
            .write_all(text.as_bytes())
            .and_then(|_| writer.flush())
            .map_err(|e| e.to_string())
    } else {
        Err("no such run".into())
    }
}

/// stdin writers for running processes, keyed by run id.
pub static STDINS: std::sync::LazyLock<Arc<std::sync::Mutex<HashMap<u64, std::process::ChildStdin>>>> =
    std::sync::LazyLock::new(|| Arc::new(std::sync::Mutex::new(HashMap::new())));

/// Registers the stdin writer at spawn time.
pub fn register_stdin(id: u64, stdin: std::process::ChildStdin) {
    STDINS.lock().unwrap().insert(id, stdin);
}
