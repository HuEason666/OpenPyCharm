//! Python code formatting through the project interpreter's toolchain.
//! Tries ruff, black and autopep8 in that order (stdin → stdout, no temp files).

use std::io::Write;
use std::process::{Command, Stdio};
use tauri::command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn configure(cmd: &mut Command) {
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
}

fn has_module(python: &str, module: &str) -> bool {
    let script = format!(
        "import importlib.util,sys;sys.exit(0 if importlib.util.find_spec('{module}') else 1)"
    );
    let mut cmd = Command::new(python);
    cmd.args(["-c", &script]);
    configure(&mut cmd);
    matches!(cmd.output(), Ok(out) if out.status.success())
}

fn run_formatter(python: &str, args: &[&str], text: &str) -> Result<String, String> {
    let mut cmd = Command::new(python);
    cmd.args(args);
    configure(&mut cmd);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start formatter: {e}"))?;
    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(text.as_bytes())
            .map_err(|e| format!("Failed to write to formatter: {e}"))?;
    }
    drop(child.stdin.take());
    let out = child
        .wait_with_output()
        .map_err(|e| format!("Formatter failed: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(if err.is_empty() {
            "Formatter exited with an error".into()
        } else {
            err
        })
    }
}

fn format_args<'a>(module: &str, path: &'a str) -> Vec<&'a str> {
    match module {
        "ruff" => vec!["-m", "ruff", "format", "--stdin-filename", path, "-"],
        "black" => vec!["-m", "black", "-q", "--stdin-filename", path, "-"],
        _ => vec!["-m", "autopep8", "-"],
    }
}

/// Organize imports (Ctrl+Alt+O) through ruff's I001 fix. Unlike formatting,
/// this is not auto-detected across tools — ruff is the one that implements it.
#[command]
pub fn python_organize_imports(
    python: String,
    path: String,
    text: String,
) -> Result<String, String> {
    if !has_module(&python, "ruff") {
        return Err(
            "优化导入需要 ruff。请先安装：python -m pip install ruff".to_string(),
        );
    }
    // --exit-zero: residual (non-import) lint findings must not fail the call;
    // the fixed source is on stdout either way.
    run_formatter(
        &python,
        &[
            "-m",
            "ruff",
            "check",
            "--select",
            "I001",
            "--fix",
            "--exit-zero",
            "--stdin-filename",
            &path,
            "-",
        ],
        &text,
    )
}

#[command]
pub fn python_format(
    python: String,
    path: String,
    text: String,
    formatter: Option<String>,
) -> Result<String, String> {
    let pref = formatter.unwrap_or_else(|| "auto".into());
    match pref.as_str() {
        // Explicit choice: fail loudly when the tool is missing so the user
        // learns why nothing happened instead of silently using another tool.
        "ruff" | "black" | "autopep8" => {
            if !has_module(&python, &pref) {
                return Err(format!(
                    "Formatter '{pref}' is not installed for this interpreter.\nInstall it with: {python} -m pip install {pref}"
                ));
            }
            return run_formatter(&python, &format_args(&pref, &path), &text);
        }
        // Auto: ruff → black → autopep8, first one that is installed.
        _ => {
            for module in ["ruff", "black", "autopep8"] {
                if has_module(&python, module) {
                    return run_formatter(&python, &format_args(module, &path), &text);
                }
            }
            Err("No Python formatter found. Install one with: pip install ruff".into())
        }
    }
}
