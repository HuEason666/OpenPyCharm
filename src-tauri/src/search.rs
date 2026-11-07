//! Find-in-Files: walk a project root and collect text matches.
//! Skips VCS/build/dependency directories, binary-looking files and oversized
//! files; supports case-insensitive substring or regex matching.

use regex::RegexBuilder;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::command;
use walkdir::WalkDir;

const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_MATCHES: usize = 2000;
const MAX_FILES_WITH_MATCHES: usize = 300;

const SKIP_DIRS: &[&str] = &[
    ".git", ".hg", ".svn", "node_modules", "__pycache__", ".venv", "venv", "env",
    ".tox", ".mypy_cache", ".pytest_cache", ".ruff_cache", "target", "dist",
    "build", ".idea", ".vscode", "site-packages", ".eggs", "coverage",
];

/// Skip-list shared with `find_files` (fs.rs).
pub fn skip_dirs_public() -> &'static [&'static str] {
    SKIP_DIRS
}

const BINARY_EXTS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "tif", "tiff", "avif",
    "zip", "tar", "gz", "tgz", "bz2", "xz", "zst", "7z", "rar", "jar", "war",
    "whl", "egg", "dll", "exe", "so", "dylib", "a", "lib", "o", "obj", "class",
    "pyc", "pyo", "bin", "dat", "db", "sqlite", "sqlite3", "pdf", "woff",
    "woff2", "ttf", "otf", "eot", "mp3", "mp4", "avi", "mov", "mkv", "wav",
    "wasm", "lock", "pyd",
];

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub line: usize, // 1-based
    pub col: usize,  // 0-based, char offset in line
    pub len: usize,
    pub text: String, // the whole line (trimmed of trailing \r)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchFileResult {
    pub path: String,
    pub matches: Vec<SearchMatch>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOutcome {
    pub results: Vec<SearchFileResult>,
    pub truncated: bool,
    pub searched_files: usize,
}

struct Matcher {
    regex: Option<regex::Regex>,
    needle: String,
    case_sensitive: bool,
}

impl Matcher {
    fn find_in(&self, line: &str) -> Vec<(usize, usize)> {
        let mut out = Vec::new();
        if let Some(re) = &self.regex {
            for m in re.find_iter(line).take(64) {
                out.push((m.start(), m.end() - m.start()));
            }
        } else if self.needle.is_empty() {
            return out;
        } else if self.case_sensitive {
            let hay = line;
            let mut from = 0;
            while let Some(i) = hay[from..].find(&self.needle) {
                let at = from + i;
                out.push((at, self.needle.len()));
                from = at + self.needle.len().max(1);
            }
        } else {
            let hay = line.to_lowercase();
            let needle = self.needle.to_lowercase();
            let mut from = 0;
            while let Some(i) = hay[from..].find(&needle) {
                let at = from + i;
                out.push((at, needle.len()));
                from = at + needle.len().max(1);
            }
        }
        out
    }
}

fn is_binary(path: &Path, bytes: &[u8]) -> bool {
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        if BINARY_EXTS.contains(&ext.to_lowercase().as_str()) {
            return true;
        }
    }
    // NUL byte in the first 4 KB ⇒ treat as binary (ripgrep convention).
    bytes.iter().take(4096).any(|&b| b == 0)
}

#[command]
pub fn search_in_files(
    root: String,
    query: String,
    case_sensitive: Option<bool>,
    regex_mode: Option<bool>,
    file_glob: Option<String>,
) -> Result<SearchOutcome, String> {
    let case_sensitive = case_sensitive.unwrap_or(false);
    let regex_mode = regex_mode.unwrap_or(false);

    let regex = if regex_mode {
        Some(
            RegexBuilder::new(&query)
                .case_insensitive(!case_sensitive)
                .size_limit(10 * (1 << 20))
                .build()
                .map_err(|e| format!("Invalid regular expression: {e}"))?,
        )
    } else {
        None
    };

    let matcher = Matcher {
        regex,
        needle: query,
        case_sensitive,
    };

    let glob_re = file_glob.as_deref().and_then(|g| {
        // Very small glob → regex: only supports * and ?.
        let mut pat = String::from("(?i)^");
        for c in g.chars() {
            match c {
                '*' => pat.push_str(".*"),
                '?' => pat.push('.'),
                c => {
                    if "\\.+()[]{}|^$".contains(c) {
                        pat.push('\\');
                    }
                    pat.push(c);
                }
            }
        }
        pat.push('$');
        regex::Regex::new(&pat).ok()
    });

    let root = PathBuf::from(root);
    if !root.is_dir() {
        return Err(format!("'{}' is not a directory", root.display()));
    }

    let mut results: Vec<SearchFileResult> = Vec::new();
    let mut total_matches = 0usize;
    let mut searched_files = 0usize;
    let mut truncated = false;

    let walker = WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            if e.file_type().is_dir() {
                if let Some(name) = e.file_name().to_str() {
                    return !SKIP_DIRS.contains(&name);
                }
            }
            true
        })
        .filter_map(|e| e.ok());

    for dent in walker {
        if !dent.file_type().is_file() {
            continue;
        }
        let path = dent.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if let Some(gr) = &glob_re {
            if !gr.is_match(name) {
                continue;
            }
        }
        let Ok(meta) = dent.metadata() else { continue };
        if meta.len() > MAX_FILE_BYTES {
            continue;
        }
        let Ok(bytes) = fs::read(path) else { continue };
        if is_binary(path, &bytes) {
            continue;
        }
        searched_files += 1;
        let text = String::from_utf8_lossy(&bytes);
        let mut file_matches: Vec<SearchMatch> = Vec::new();
        for (i, line) in text.lines().enumerate() {
            for (col, len) in matcher.find_in(line) {
                file_matches.push(SearchMatch {
                    line: i + 1,
                    col,
                    len,
                    text: line.trim_end_matches('\r').to_string(),
                });
                total_matches += 1;
                if total_matches >= MAX_MATCHES {
                    truncated = true;
                    break;
                }
            }
            if truncated {
                break;
            }
        }
        if !file_matches.is_empty() {
            results.push(SearchFileResult {
                path: path.to_string_lossy().into_owned(),
                matches: file_matches,
            });
            if results.len() >= MAX_FILES_WITH_MATCHES {
                truncated = true;
                break;
            }
        }
        if truncated {
            break;
        }
    }

    Ok(SearchOutcome {
        results,
        truncated,
        searched_files,
    })
}
