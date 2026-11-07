//! Python interpreter discovery ("SDKs" in JetBrains terms).
//! Finds candidate interpreters: project virtual environments, conda
//! installations (base + every env), the `py` launcher, PEP-514 registry
//! entries and `python`/`python3` on PATH.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::command;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PythonSdk {
    pub path: String,
    pub version: String,
    pub kind: String, // "system" | "py-launcher" | "venv"
    pub name: String,
}

fn python_version(exe: &str) -> Option<String> {
    let out = Command::new(exe)
        .arg("--version")
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .output()
        .ok()?;
    let mut s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        s = String::from_utf8_lossy(&out.stderr).trim().to_string();
    }
    // "Python 3.14.7" / "Python 3.12.4 (tags/...)" → keep up to 3 components.
    let v = s
        .strip_prefix("Python ")
        .unwrap_or(&s)
        .split_whitespace()
        .next()?
        .to_string();
    Some(v)
}

fn sdk_named(exe: PathBuf, kind: &str, label: Option<&str>) -> Option<PythonSdk> {
    let exe = exe.canonicalize().ok()?;
    // canonicalize yields \\?\C:\... verbatim paths on Windows; strip the
    // prefix so UI / pyright / saved settings see a normal path.
    let cleaned = {
        let s = exe.to_string_lossy();
        if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
            format!(r"\\{rest}")
        } else if let Some(rest) = s.strip_prefix(r"\\?\") {
            rest.to_string()
        } else {
            s.into_owned()
        }
    };
    let version = python_version(&cleaned)?;
    let name = match (label, version.is_empty()) {
        (Some(l), false) => format!("Python {version} ({l})"),
        (Some(l), true) => format!("Python ({l})"),
        (None, false) => format!("Python {version} ({kind})"),
        (None, true) => format!("Python ({kind})"),
    };
    Some(PythonSdk {
        path: cleaned,
        version,
        kind: kind.into(),
        name,
    })
}

fn sdk(exe: PathBuf, kind: &str) -> Option<PythonSdk> {
    sdk_named(exe, kind, None)
}

fn push_sdk(s: Option<PythonSdk>, out: &mut Vec<PythonSdk>, seen: &mut Vec<String>) {
    if let Some(s) = s {
        if !seen.contains(&s.path) {
            seen.push(s.path.clone());
            out.push(s);
        }
    }
}

fn which(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var("PATH").ok()?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Fire-and-forget external command runner for project setup (venv creation).
fn run_simple(program: &str, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new(program);
    cmd.args(args);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x0800_0000);
    let out = cmd.output().map_err(|e| format!("Failed to run {program}: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(if err.is_empty() {
            format!("{program} exited with an error")
        } else {
            err
        })
    }
}

/// Locate a `uv` executable: PATH first, then the conda base's Scripts dir
/// (derived from a conda launcher on PATH), then uv's default installer spot.
#[command]
pub fn uv_detect() -> Option<String> {
    for name in ["uv.exe", "uv"] {
        if let Some(p) = which(name) {
            return Some(p.to_string_lossy().into_owned());
        }
    }
    for name in ["conda.exe", "conda.bat", "conda"] {
        if let Some(p) = which(name) {
            if let Some(base) = conda_base_from_conda_path(&p) {
                let uv = base.join("Scripts").join("uv.exe");
                if uv.is_file() {
                    return Some(uv.to_string_lossy().into_owned());
                }
                break;
            }
        }
    }
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)?;
    let p = home.join(".local").join("bin").join("uv.exe");
    if p.is_file() {
        return Some(p.to_string_lossy().into_owned());
    }
    None
}

/// Create a virtual environment with the given interpreter (`python -m venv`).
#[command]
pub fn python_create_venv(python: String, dir: String) -> Result<(), String> {
    run_simple(&python, &["-m", "venv", &dir]).map(|_| ())
}

/// Create a virtual environment with uv (`uv venv <dir>`).
#[command]
pub fn uv_create_venv(uv: String, dir: String) -> Result<(), String> {
    run_simple(&uv, &["venv", &dir]).map(|_| ())
}

/// Create a fresh conda environment at an arbitrary prefix:
/// `<base python> -m conda create --yes -p <dir> python[=<version>]`.
/// Running through the base interpreter avoids cmd.exe .bat quoting issues.
#[command]
pub fn conda_create_env(
    python: String,
    env_dir: String,
    version: Option<String>,
) -> Result<(), String> {
    let mut args: Vec<String> = vec![
        "-m".into(),
        "conda".into(),
        "create".into(),
        "--yes".into(),
        "-p".into(),
        env_dir,
    ];
    match version.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
        Some(v) => args.push(format!("python={v}")),
        None => args.push("python".into()),
    }
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_simple(&python, &arg_refs).map(|_| ())
}

/// python executable relative to a conda base/env root (at the root, not in
/// Scripts — conda environments always have python at `<root>/python.exe`).
#[cfg(target_os = "windows")]
fn rel_python(root: &Path) -> PathBuf {
    root.join("python.exe")
}

#[cfg(not(target_os = "windows"))]
fn rel_python(root: &Path) -> PathBuf {
    root.join("bin").join("python")
}

/// Derive a conda base from a `conda` executable found on PATH:
/// `<base>\condabin\conda.bat`, `<base>\Scripts\conda.exe`, `<base>/bin/conda`.
fn conda_base_from_conda_path(conda: &Path) -> Option<PathBuf> {
    let dir = conda.parent()?;
    let name = dir.file_name()?.to_str()?;
    let base = if name.eq_ignore_ascii_case("condabin")
        || name.eq_ignore_ascii_case("scripts")
        || name.eq_ignore_ascii_case("bin")
    {
        dir.parent()?
    } else {
        return None;
    };
    if rel_python(base).is_file() {
        Some(base.to_path_buf())
    } else {
        None
    }
}

/// Ask conda itself for its base directory (slow path, only used when the
/// executable layout doesn't reveal the base directly). `.bat` files need cmd.
#[cfg(target_os = "windows")]
fn conda_info_base(conda: &Path) -> Option<PathBuf> {
    let is_bat = conda
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("bat"))
        .unwrap_or(false);
    let mut cmd = if is_bat {
        let mut c = Command::new("cmd");
        c.args(["/C", &conda.to_string_lossy(), "info", "--base"]);
        c
    } else {
        let mut c = Command::new(conda);
        c.args(["info", "--base"]);
        c
    };
    cmd.creation_flags(0x0800_0000);
    let out = cmd.output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let base = text.trim();
    if base.is_empty() {
        return None;
    }
    let base = PathBuf::from(base);
    rel_python(&base).is_file().then_some(base)
}

#[cfg(not(target_os = "windows"))]
fn conda_info_base(conda: &Path) -> Option<PathBuf> {
    let out = Command::new(conda).args(["info", "--base"]).output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let base = text.trim();
    if base.is_empty() {
        return None;
    }
    let base = PathBuf::from(base);
    rel_python(&base).is_file().then_some(base)
}

/// Standard Anaconda/Miniconda install locations. Custom installers don't
/// always register or sit on PATH, so check the usual suspects too.
fn well_known_conda_bases() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from);
    if let Some(home) = &home {
        dirs.push(home.join("anaconda3"));
        dirs.push(home.join("miniconda3"));
        dirs.push(home.join("AppData").join("Local").join("Continuum").join("anaconda3"));
        dirs.push(home.join("AppData").join("Local").join("Continuum").join("miniconda3"));
    }
    if let Some(pd) = std::env::var_os("ProgramData").map(PathBuf::from) {
        dirs.push(pd.join("Anaconda3"));
        dirs.push(pd.join("Miniconda3"));
    }
    #[cfg(not(target_os = "windows"))]
    {
        dirs.push(PathBuf::from("/opt/anaconda3"));
        dirs.push(PathBuf::from("/opt/miniconda3"));
        dirs.push(PathBuf::from("/usr/local/anaconda3"));
        dirs.push(PathBuf::from("/usr/local/miniconda3"));
    }
    dirs
}

/// Base interpreter + every conda env (`<base>\envs\*` and the user-level
/// `~/.conda/envs/*` directory conda uses for out-of-base environments).
fn push_conda_install(base: &Path, out: &mut Vec<PythonSdk>, seen: &mut Vec<String>) {
    let base_py = rel_python(base);
    if base_py.is_file() {
        push_sdk(sdk_named(base_py, "conda", Some("conda base")), out, seen);
    }
    let mut env_roots = vec![base.join("envs")];
    if let Some(home) = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
    {
        env_roots.push(home.join(".conda").join("envs"));
    }
    for root in env_roots {
        let Ok(entries) = std::fs::read_dir(&root) else {
            continue;
        };
        let mut envs: Vec<PathBuf> = entries.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
        envs.sort();
        for env in envs {
            if !rel_python(&env).is_file() {
                continue;
            }
            let name = env
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            push_sdk(
                sdk_named(rel_python(&env), "conda-env", Some(&format!("conda · {name}"))),
                out,
                seen,
            );
        }
    }
}

/// PEP 514 registrations (PythonCore, ContinuumAnalytics, uv-managed, …).
/// Every installer writes `...\InstallPath` whose default value is the
/// directory containing python.exe.
#[cfg(target_os = "windows")]
fn registry_install_dirs() -> Vec<PathBuf> {
    // reg.exe /s queries are pricey; scan once per process.
    static CACHE: std::sync::OnceLock<Vec<PathBuf>> = std::sync::OnceLock::new();
    return CACHE
        .get_or_init(|| {
            let mut dirs = Vec::new();
            for hive in ["HKCU\\Software\\Python", "HKLM\\Software\\Python"] {
                let Ok(out) = Command::new("reg")
                    .args(["query", hive, "/s", "/f", "InstallPath", "/k"])
                    .creation_flags(0x0800_0000)
                    .output()
                else {
                    continue;
                };
                let text = String::from_utf8_lossy(&out.stdout);
                for line in text.lines() {
                    let key = line.trim();
                    if !key.starts_with("HKEY") || !key.contains("InstallPath") {
                        continue;
                    }
                    let Ok(o2) = Command::new("reg")
                        .args(["query", key, "/ve"])
                        .creation_flags(0x0800_0000)
                        .output()
                    else {
                        continue;
                    };
                    let t2 = String::from_utf8_lossy(&o2.stdout);
                    for l2 in t2.lines() {
                        if let Some(i) = l2.find("REG_SZ") {
                            let dir = l2[i + "REG_SZ".len()..].trim();
                            if !dir.is_empty() {
                                dirs.push(PathBuf::from(dir));
                            }
                        }
                    }
                }
            }
            dirs
        })
        .clone();
}

#[cfg(not(target_os = "windows"))]
fn registry_install_dirs() -> Vec<PathBuf> {
    Vec::new()
}

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// True when the interpreter can import `module` (used to detect debugpy).
#[command]
pub fn python_has_module(python: String, module: String) -> bool {
    let mut cmd = Command::new(&python);
    cmd.args([
        "-c",
        "import importlib.util,sys;sys.exit(0 if importlib.util.find_spec(sys.argv[1]) else 1)",
        &module,
    ]);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x0800_0000);
    cmd.output().map(|o| o.status.success()).unwrap_or(false)
}

/// Discover Python interpreters, most specific first.
/// `project_root` is scanned for local virtual environments.
#[command]
pub fn sdk_detect(project_root: Option<String>) -> Vec<PythonSdk> {
    let mut out: Vec<PythonSdk> = Vec::new();
    let mut seen: Vec<String> = Vec::new();

    // 1) Project virtual environments.
    if let Some(root) = &project_root {
        let root = PathBuf::from(root);
        for dir in [".venv", "venv", "env"] {
            #[cfg(target_os = "windows")]
            let exe = root.join(dir).join("Scripts").join("python.exe");
            #[cfg(not(target_os = "windows"))]
            let exe = root.join(dir).join("bin").join("python");
            push_sdk(sdk(exe, "venv"), &mut out, &mut seen);
        }
    }

    // 2) Conda installations (base + envs). Anaconda/Miniconda do not add
    //    themselves to PATH by default, so derive the base from a `conda`
    //    executable on PATH, check well-known locations, and let each pass
    //    through `sdk_named`'s version probe to prove it's a real interpreter.
    let mut bases: Vec<PathBuf> = Vec::new();
    for name in ["conda.exe", "conda.bat", "conda"] {
        if let Some(p) = which(name) {
            if let Some(base) = conda_base_from_conda_path(&p) {
                bases.push(base);
                break;
            }
        }
    }
    for dir in well_known_conda_bases() {
        if rel_python(&dir).is_file() {
            bases.push(dir);
        }
    }
    bases.sort();
    bases.dedup();
    for base in &bases {
        push_conda_install(base, &mut out, &mut seen);
    }
    // Slow fallback: ask conda directly when neither shortcut found a base.
    if bases.is_empty() {
        for name in ["conda.exe", "conda.bat", "conda"] {
            if let Some(p) = which(name) {
                if let Some(base) = conda_info_base(&p) {
                    push_conda_install(&base, &mut out, &mut seen);
                    break;
                }
            }
        }
    }

    // 3) The py launcher's default interpreter.
    #[cfg(target_os = "windows")]
    {
        if let Some(py) = which("py.exe") {
            if let Ok(outp) = Command::new(&py)
                .args(["-c", "import sys; print(sys.executable)"])
                .creation_flags(0x0800_0000)
                .output()
            {
                let exe = String::from_utf8_lossy(&outp.stdout).trim().to_string();
                if !exe.is_empty() {
                    push_sdk(sdk(PathBuf::from(exe), "py-launcher"), &mut out, &mut seen);
                }
            }
        }
    }

    // 4) PEP 514 registry entries (PythonCore, ContinuumAnalytics, uv, …).
    for dir in registry_install_dirs() {
        push_sdk(sdk(dir.join("python.exe"), "registry"), &mut out, &mut seen);
    }

    // 5) PATH lookups.
    for name in ["python.exe", "python3.exe", "python", "python3"] {
        if let Some(p) = which(name) {
            let kind = if p.to_string_lossy().contains("venv") {
                "venv"
            } else {
                "system"
            };
            push_sdk(sdk(p, kind), &mut out, &mut seen);
        }
    }

    out
}
