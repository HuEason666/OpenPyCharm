//! Framed JSON-RPC child-process bridge (Content-Length headers), shared by
//! the Python language server and the debug adapter. Messages are forwarded
//! to the frontend as `<kind>://message` events.

use crate::next_id;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{command, AppHandle, Emitter, State};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

struct Session {
    kind: String,
    child: Child,
    stdin: ChildStdin,
}

#[derive(Clone)]
pub struct BridgeState {
    sessions: Arc<Mutex<HashMap<u64, Session>>>,
}

impl BridgeState {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Kill every running process of a kind (e.g. a previous language server
    /// left over after a webview reload). Only one session per kind is kept.
    pub fn stop_kind(&self, kind: &str) {
        let ids: Vec<u64> = {
            let map = self.sessions.lock().unwrap();
            map.iter()
                .filter(|(_, s)| s.kind == kind)
                .map(|(id, _)| *id)
                .collect()
        };
        for id in ids {
            let session = self.sessions.lock().unwrap().remove(&id);
            if let Some(mut session) = session {
                let _ = session.child.kill();
                let _ = session.child.wait();
            }
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BridgeMessage {
    id: u64,
    message: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BridgeExit {
    id: u64,
}

fn read_frames(app: AppHandle, id: u64, kind: String, stdout: impl Read + Send + 'static) {
    let mut reader = BufReader::new(stdout);
    let event = format!("{kind}://message");
    loop {
        let mut length: Option<usize> = None;
        loop {
            let mut line = String::new();
            match reader.read_line(&mut line) {
                Ok(0) => break,
                Ok(_) => {}
                Err(_) => break,
            }
            let header = line.trim_end_matches(['\r', '\n']);
            if header.is_empty() {
                break;
            }
            if let Some(v) = header.strip_prefix("Content-Length:") {
                length = v.trim().parse().ok();
            }
        }
        let Some(len) = length else {
            // EOF or a malformed frame; stop reading.
            let _ = app.emit(&format!("{kind}://exit"), BridgeExit { id });
            return;
        };
        let mut body = vec![0u8; len];
        if reader.read_exact(&mut body).is_err() {
            let _ = app.emit(&format!("{kind}://exit"), BridgeExit { id });
            return;
        }
        let message = String::from_utf8_lossy(&body).into_owned();
        let _ = app.emit(&event, BridgeMessage { id, message });
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnArgs {
    pub kind: String, // "lsp" | "dap"
    pub program: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    /// Directory to prepend to PATH (the selected interpreter's bin dir).
    pub path_prepend: Option<String>,
}

#[command]
pub fn bridge_spawn(
    app: AppHandle,
    state: State<'_, BridgeState>,
    args: SpawnArgs,
) -> Result<u64, String> {
    if args.kind != "lsp" && args.kind != "dap" {
        return Err("unsupported bridge kind".into());
    }
    let mut cmd = Command::new(&args.program);
    cmd.args(&args.args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(cwd) = &args.cwd {
        cmd.current_dir(cwd);
    }
    if let Some(dir) = &args.path_prepend {
        let sep = if cfg!(windows) { ';' } else { ':' };
        let old = std::env::var("PATH").unwrap_or_default();
        cmd.env("PATH", format!("{dir}{sep}{old}"));
    }
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start {}: {e}", args.program))?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;
    let stdin = child.stdin.take().ok_or("no stdin")?;
    let id = next_id();
    state
        .sessions
        .lock()
        .unwrap()
        .insert(id, Session { kind: args.kind.clone(), child, stdin });

    let kind = args.kind.clone();
    let log_kind = kind.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            eprintln!("[{log_kind}:{id}] {line}");
        }
    });
    let app_out = app.clone();
    let kind_out = kind.clone();
    let sessions = state.sessions.clone();
    std::thread::spawn(move || {
        read_frames(app_out, id, kind_out, stdout);
        sessions.lock().unwrap().remove(&id);
    });
    Ok(id)
}

#[command]
pub fn bridge_send(state: State<'_, BridgeState>, id: u64, message: String) -> Result<(), String> {
    let mut map = state.sessions.lock().unwrap();
    let session = map.get_mut(&id).ok_or("no such process")?;
    let frame = format!("Content-Length: {}\r\n\r\n{}", message.as_bytes().len(), message);
    session
        .stdin
        .write_all(frame.as_bytes())
        .and_then(|_| session.stdin.flush())
        .map_err(|e| e.to_string())
}

#[command]
pub fn bridge_stop(state: State<'_, BridgeState>, id: u64) -> Result<(), String> {
    let session = state.sessions.lock().unwrap().remove(&id);
    if let Some(mut session) = session {
        let _ = session.child.kill();
        let _ = session.child.wait();
    }
    Ok(())
}
