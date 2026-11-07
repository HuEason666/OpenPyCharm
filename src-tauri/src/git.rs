//! Git integration through the system `git` CLI (no libgit2 dependency).
//! Commands are read-mostly; stage/unstage/commit are the only writes.

use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;
use tauri::command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn git(root: &str, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(root).arg("-c").arg("core.quotepath=false");
    cmd.args(args);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let out = cmd.output().map_err(|e| format!("Failed to run git: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(if err.is_empty() {
            "git command failed".into()
        } else {
            err
        })
    }
}

fn toplevel(root: &str) -> Option<String> {
    git(root, &["rev-parse", "--show-toplevel"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn rel_path(repo_root: &str, path: &str) -> Result<String, String> {
    let root = PathBuf::from(repo_root);
    let rel = PathBuf::from(path)
        .strip_prefix(&root)
        .map_err(|_| format!("'{path}' is outside the repository"))?
        .to_string_lossy()
        .replace('\\', "/");
    if rel.is_empty() {
        return Err("empty repository path".into());
    }
    Ok(rel)
}

/// `git init` in a freshly created project directory (新建项目 › 创建 Git 仓库).
/// Prefers `main` as the initial branch; falls back for older git versions.
#[command]
pub fn git_init(path: String) -> Result<(), String> {
    if git(&path, &["init", "-b", "main"]).is_err() {
        git(&path, &["init"])?;
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    pub repo: bool,
    pub root: Option<String>,
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
}

#[command]
pub fn git_info(root: String) -> GitInfo {
    let Some(top) = toplevel(&root) else {
        return GitInfo {
            repo: false,
            root: None,
            branch: None,
            upstream: None,
            ahead: 0,
            behind: 0,
        };
    };
    let branch = git(&top, &["rev-parse", "--abbrev-ref", "HEAD"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let upstream = git(
        &top,
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    )
    .ok()
    .map(|s| s.trim().to_string())
    .filter(|s| !s.is_empty());
    let (mut ahead, mut behind) = (0u32, 0u32);
    if upstream.is_some() {
        if let Ok(s) = git(&top, &["rev-list", "--left-right", "--count", "@{u}...HEAD"]) {
            let mut it = s.split_whitespace();
            behind = it.next().and_then(|x| x.parse().ok()).unwrap_or(0);
            ahead = it.next().and_then(|x| x.parse().ok()).unwrap_or(0);
        }
    }
    GitInfo {
        repo: true,
        root: Some(top),
        branch,
        upstream,
        ahead,
        behind,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitEntry {
    pub path: String,
    pub rel_path: String,
    pub index: String,
    pub worktree: String,
}

#[command]
pub fn git_status(root: String) -> Result<Vec<GitEntry>, String> {
    let top = toplevel(&root).ok_or("Not a Git repository")?;
    let out = git(
        &top,
        &["status", "--porcelain", "-z", "--untracked-files=all"],
    )?;
    let mut entries: Vec<GitEntry> = Vec::new();
    let mut tokens = out.split('\0').filter(|s| !s.is_empty());
    while let Some(tok) = tokens.next() {
        if tok.len() < 4 {
            continue;
        }
        let index = tok.as_bytes()[0] as char;
        let worktree = tok.as_bytes()[1] as char;
        let rel = &tok[3..];
        // Rename/copy entries carry the original path as an extra NUL token.
        if index == 'R' || index == 'C' || worktree == 'R' || worktree == 'C' {
            let _ = tokens.next();
        }
        let path = PathBuf::from(&top)
            .join(rel.replace('/', std::path::MAIN_SEPARATOR_STR))
            .to_string_lossy()
            .into_owned();
        entries.push(GitEntry {
            path,
            rel_path: rel.to_string(),
            index: index.to_string(),
            worktree: worktree.to_string(),
        });
    }
    entries.sort_by(|a, b| a.rel_path.to_lowercase().cmp(&b.rel_path.to_lowercase()));
    Ok(entries)
}

#[command]
pub fn git_diff(root: String, path: String, staged: bool) -> Result<String, String> {
    let top = toplevel(&root).ok_or("Not a Git repository")?;
    let rel = rel_path(&top, &path)?;
    if staged {
        return git(&top, &["diff", "--cached", "--no-color", "--", &rel]);
    }
    let tracked = git(&top, &["ls-files", "--error-unmatch", "--", &rel]).is_ok();
    if !tracked {
        let text = std::fs::read_to_string(&path).unwrap_or_default();
        let lines: Vec<&str> = text.lines().collect();
        let mut out = format!(
            "diff --git a/{rel} b/{rel}\nnew file\n--- /dev/null\n+++ b/{rel}\n@@ -0,0 +1,{} @@\n",
            lines.len()
        );
        for line in lines {
            out.push('+');
            out.push_str(line);
            out.push('\n');
        }
        return Ok(out);
    }
    git(&top, &["diff", "--no-color", "--", &rel])
}

/// File content from HEAD or the index (used by the side-by-side diff view).
#[command]
pub fn git_show(root: String, path: String, source: String) -> String {
    let Some(top) = toplevel(&root) else {
        return String::new();
    };
    let Ok(rel) = rel_path(&top, &path) else {
        return String::new();
    };
    let spec = if source == "index" {
        format!(":{rel}")
    } else {
        format!("HEAD:{rel}")
    };
    git(&top, &["show", &spec]).unwrap_or_default()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub hash: String,
    pub short_hash: String,
    pub author: String,
    pub email: String,
    pub time: i64,
    pub subject: String,
}

#[command]
pub fn git_log(root: String, limit: Option<u32>) -> Vec<GitCommit> {
    let Some(top) = toplevel(&root) else {
        return Vec::new();
    };
    let n = limit.unwrap_or(30).clamp(1, 200);
    let n_arg = format!("-n{n}");
    let Ok(out) = git(
        &top,
        &[
            "log",
            n_arg.as_str(),
            "--pretty=format:%H\u{1f}%h\u{1f}%an\u{1f}%ae\u{1f}%at\u{1f}%s\u{1e}",
        ],
    ) else {
        return Vec::new();
    };
    out.split('\u{1e}')
        .filter(|rec| !rec.trim().is_empty())
        .filter_map(|rec| {
            let mut it = rec.trim_start_matches('\n').split('\u{1f}');
            let hash = it.next()?.to_string();
            let short_hash = it.next()?.to_string();
            let author = it.next()?.to_string();
            let email = it.next()?.to_string();
            let time = it.next()?.parse().ok()?;
            let subject = it.next()?.to_string();
            Some(GitCommit {
                hash,
                short_hash,
                author,
                email,
                time,
                subject,
            })
        })
        .collect()
}

#[command]
pub fn git_stage(root: String, paths: Vec<String>) -> Result<(), String> {
    let top = toplevel(&root).ok_or("Not a Git repository")?;
    let mut rels: Vec<String> = Vec::new();
    for p in &paths {
        rels.push(rel_path(&top, p)?);
    }
    if rels.is_empty() {
        return Ok(());
    }
    let mut args: Vec<&str> = vec!["add", "--"];
    for r in &rels {
        args.push(r);
    }
    git(&top, &args)?;
    Ok(())
}

/// Discard worktree changes of the given files (PyCharm "Rollback"): restore
/// from HEAD when the paths exist there, otherwise from the index.
#[command]
pub fn git_restore(root: String, paths: Vec<String>) -> Result<(), String> {
    let top = toplevel(&root).ok_or("Not a Git repository")?;
    let mut rels: Vec<String> = Vec::new();
    for p in &paths {
        rels.push(rel_path(&top, p)?);
    }
    if rels.is_empty() {
        return Ok(());
    }
    let mut args: Vec<&str> = vec!["checkout", "HEAD", "--"];
    for r in &rels {
        args.push(r);
    }
    if git(&top, &args).is_err() {
        // Paths unknown to HEAD (e.g. staged new files): restore from index.
        let mut fallback: Vec<&str> = vec!["checkout", "--"];
        for r in &rels {
            fallback.push(r);
        }
        git(&top, &fallback)?;
    }
    Ok(())
}

#[command]
pub fn git_unstage(root: String, paths: Vec<String>) -> Result<(), String> {
    let top = toplevel(&root).ok_or("Not a Git repository")?;
    let mut rels: Vec<String> = Vec::new();
    for p in &paths {
        rels.push(rel_path(&top, p)?);
    }
    if rels.is_empty() {
        return Ok(());
    }
    let mut args: Vec<&str> = vec!["reset", "-q", "HEAD", "--"];
    for r in &rels {
        args.push(r);
    }
    if git(&top, &args).is_err() {
        // No HEAD yet (fresh repo): drop the entries from the index instead.
        let mut fallback: Vec<&str> = vec!["rm", "--cached", "-q", "-r", "--"];
        for r in &rels {
            fallback.push(r);
        }
        git(&top, &fallback)?;
    }
    Ok(())
}

#[command]
pub fn git_commit(root: String, message: String) -> Result<String, String> {
    let top = toplevel(&root).ok_or("Not a Git repository")?;
    if message.trim().is_empty() {
        return Err("Commit message is empty".into());
    }
    let out = git(&top, &["commit", "-m", message.as_str()])?;
    Ok(out.trim().to_string())
}

#[command]
pub fn git_push(root: String) -> Result<String, String> {
    let top = toplevel(&root).ok_or("Not a Git repository")?;
    push_pull(&top, &["push"])
}

#[command]
pub fn git_pull(root: String) -> Result<String, String> {
    let top = toplevel(&root).ok_or("Not a Git repository")?;
    push_pull(&top, &["pull", "--no-edit"])
}

/// Network operations: disable credential prompts (they would hang a headless
/// process); credential helpers (Windows manager) still work.
fn push_pull(top: &str, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(top).args(args);
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    cmd.env("GCM_INTERACTIVE", "Never");
    cmd.env("GIT_ASKPASS", "echo");
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let out = cmd.output().map_err(|e| format!("Failed to run git: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(if err.is_empty() { "git command failed".into() } else { err })
    }
}

#[command]
pub fn git_clone(url: String, dir: String) -> Result<String, String> {
    if url.trim().is_empty() || dir.trim().is_empty() {
        return Err("Repository URL and destination are required".into());
    }
    if let Some(parent) = PathBuf::from(&dir).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut cmd = Command::new("git");
    cmd.args(["clone", "--", &url, &dir]);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let out = cmd.output().map_err(|e| format!("Failed to run git: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(if err.is_empty() {
            "git clone failed".into()
        } else {
            err
        })
    }
}
