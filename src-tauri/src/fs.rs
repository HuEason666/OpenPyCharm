//! File-system commands: directory listings, text IO, create/rename/delete.
//! All paths arrive absolute from the frontend (the "project root" concept
//! lives entirely in the UI layer).

use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::command;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub kind: String, // "dir" | "file" | "symlink"
    pub size: u64,
    pub mtime_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFile {
    pub text: String,
    pub size: u64,
}

fn mtime_ms(p: &Path) -> u64 {
    p.metadata()
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn entry(p: &Path) -> Option<DirEntry> {
    let meta = fs::symlink_metadata(p).ok()?;
    let kind = if meta.is_symlink() {
        "symlink"
    } else if meta.is_dir() {
        "dir"
    } else {
        "file"
    };
    Some(DirEntry {
        name: p.file_name()?.to_string_lossy().into_owned(),
        path: p.to_string_lossy().into_owned(),
        kind: kind.into(),
        size: if meta.is_dir() { 0 } else { meta.len() },
        mtime_ms: mtime_ms(p),
    })
}

#[command]
pub fn fs_read_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let dir = PathBuf::from(&path);
    let rd = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    let mut out: Vec<DirEntry> = rd.filter_map(|e| entry(&e.ok()?.path())).collect();
    // Directories first, then case-insensitive name order (IDE tree convention).
    out.sort_by(|a, b| {
        let ka = if a.kind == "dir" { 0 } else { 1 };
        let kb = if b.kind == "dir" { 0 } else { 1 };
        ka.cmp(&kb)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(out)
}

#[command]
pub fn fs_read_text(path: String, max_bytes: Option<u64>) -> Result<TextFile, String> {
    let p = PathBuf::from(&path);
    let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
    let limit = max_bytes.unwrap_or(8 * 1024 * 1024);
    if meta.len() > limit {
        return Err(format!(
            "File is too large to open ({} bytes; limit {})",
            meta.len(),
            limit
        ));
    }
    let bytes = fs::read(&p).map_err(|e| e.to_string())?;
    // Strip BOM; the editor writes UTF-8 back without it.
    let bytes = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        &bytes[3..]
    } else {
        &bytes[..]
    };
    let text = String::from_utf8_lossy(bytes).into_owned();
    Ok(TextFile {
        text,
        size: meta.len(),
    })
}

#[command]
pub fn fs_write_text(path: String, text: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut f = fs::File::create(&p).map_err(|e| e.to_string())?;
    f.write_all(text.as_bytes()).map_err(|e| e.to_string())
}

#[command]
pub fn fs_create_file(path: String, contents: Option<String>) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if p.exists() {
        return Err(format!("'{}' already exists", p.display()));
    }
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::File::create(&p)
        .and_then(|mut f| f.write_all(contents.unwrap_or_default().as_bytes()))
        .map_err(|e| e.to_string())
}

#[command]
pub fn fs_create_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[command]
pub fn fs_rename(from: String, to: String) -> Result<(), String> {
    let to_path = PathBuf::from(&to);
    if to_path.exists() {
        return Err(format!("'{}' already exists", to_path.display()));
    }
    fs::rename(&from, &to).map_err(|e| e.to_string())
}

#[command]
pub fn fs_delete(path: String, recursive: Option<bool>) -> Result<(), String> {
    let p = PathBuf::from(&path);
    let recursive = recursive.unwrap_or(false);
    if p.is_dir() {
        if recursive {
            fs::remove_dir_all(&p).map_err(|e| e.to_string())
        } else {
            fs::remove_dir(&p).map_err(|e| e.to_string())
        }
    } else {
        fs::remove_file(&p).map_err(|e| e.to_string())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatInfo {
    pub exists: bool,
    pub kind: String,
    pub size: u64,
    pub mtime_ms: u64,
}

#[command]
pub fn fs_stat(path: String) -> StatInfo {
    match fs::metadata(&path) {
        Ok(m) => StatInfo {
            exists: true,
            kind: if m.is_dir() { "dir" } else { "file" }.into(),
            size: m.len(),
            mtime_ms: mtime_ms(Path::new(&path)),
        },
        Err(_) => StatInfo {
            exists: false,
            kind: "none".into(),
            size: 0,
            mtime_ms: 0,
        },
    }
}

#[command]
pub fn fs_exists(path: String) -> bool {
    Path::new(&path).exists()
}

/// Open a path (directory or file) in the OS file manager / default handler.
#[command]
pub fn fs_reveal_in_shell(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        let p = PathBuf::from(&path);
        if p.is_dir() {
            Command::new("explorer")
                .arg(&path)
                .spawn()
                .map_err(|e| e.to_string())?;
        } else {
            Command::new("explorer")
                .arg(format!("/select,{}", path))
                .spawn()
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    Err("unsupported".into())
}

/// List files under `root` (up to `limit`), skipping VCS/dependency dirs.
/// Used by Search Everywhere / Go to File.
#[command]
pub fn find_files(root: String, pattern: Option<String>, limit: Option<usize>) -> Result<Vec<String>, String> {
    let root = PathBuf::from(&root);
    if !root.is_dir() {
        return Err(format!("'{}' is not a directory", root.display()));
    }
    let limit = limit.unwrap_or(2000).min(5000);
    let needle = pattern.unwrap_or_default().to_lowercase();
    let mut out: Vec<String> = Vec::new();
    let walker = walkdir::WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            if e.file_type().is_dir() {
                if let Some(name) = e.file_name().to_str() {
                    return !crate::search::skip_dirs_public().contains(&name);
                }
            }
            true
        })
        .filter_map(|e| e.ok());
    for dent in walker {
        if !dent.file_type().is_file() {
            continue;
        }
        let path = dent.path().to_string_lossy().into_owned();
        if needle.is_empty() {
            out.push(path);
        } else {
            let rel = path
                .strip_prefix(root.to_string_lossy().as_ref())
                .unwrap_or(&path)
                .to_lowercase()
                .replace('\\', "/");
            if rel.contains(&needle) {
                out.push(path);
            }
        }
        if out.len() >= limit {
            break;
        }
    }
    Ok(out)
}

/// Create (or reuse) a scratch file under the OS temp dir — 文件 › 新建临时文件.
/// Returns the absolute path; the file starts empty.
#[command]
pub fn fs_create_scratch(ext: Option<String>) -> Result<String, String> {
    let dir = std::env::temp_dir().join("OpenPyCharmScratches");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let ext = ext.unwrap_or_else(|| "py".into());
    let ext = ext.trim_start_matches('.');
    for n in 1..1000 {
        let path = dir.join(format!("scratch_{n}.{ext}"));
        if !path.exists() {
            std::fs::File::create(&path).map_err(|e| e.to_string())?;
            return Ok(path.to_string_lossy().into_owned());
        }
    }
    Err("No free scratch slot (scratch_1..999 all exist)".into())
}

/// The user's home directory (新建项目 default location base).
#[command]
pub fn fs_user_home() -> String {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_default()
}
