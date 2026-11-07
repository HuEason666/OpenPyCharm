/**
 * Git tool window: working-tree changes with stage/unstage + commit, and a
 * recent-commits log. Diffs open in a side-by-side MergeView dialog.
 */
import { useEffect, useState } from "react";
import { message } from "@tauri-apps/plugin-dialog";
import { Icon } from "../../ui/icons";
import { useProject } from "../../platform/project";
import { useOverlay } from "../../workbench/overlays";
import { pathBase } from "../../platform/paths";
import { isStaged, statusKind, statusLetter, useGit, type StatusKind } from "./store";
import styles from "./GitView.module.css";

function relDir(relPath: string): string {
  const idx = relPath.lastIndexOf("/");
  return idx > 0 ? relPath.slice(0, idx) : "";
}

function ChangeRow({
  relPath,
  path,
  kind,
  letter,
  staged,
  onAction,
  actionTitle,
  onOpen,
}: {
  relPath: string;
  path: string;
  kind: StatusKind;
  letter: string;
  staged: boolean;
  onAction: () => void;
  actionTitle: string;
  onOpen: () => void;
}) {
  return (
    <div className={styles.row} data-kind={kind} onClick={onOpen} title={relPath}>
      <span className={styles.letter}>{letter}</span>
      <span className={styles.name}>{pathBase(path)}</span>
      <span className={styles.path}>{relDir(relPath)}</span>
      <button
        type="button"
        className={styles.rowAction}
        title={actionTitle}
        onClick={(e) => {
          e.stopPropagation();
          onAction();
        }}
      >
        {staged ? "−" : "+"}
      </button>
    </div>
  );
}

export function GitView() {
  const info = useGit((s) => s.info);
  const entries = useGit((s) => s.entries);
  const loading = useGit((s) => s.loading);
  const error = useGit((s) => s.error);
  const log = useGit((s) => s.log);
  const refresh = useGit((s) => s.refresh);
  const refreshLog = useGit((s) => s.refreshLog);
  const stage = useGit((s) => s.stage);
  const unstage = useGit((s) => s.unstage);
  const commit = useGit((s) => s.commit);
  const open = useOverlay((s) => s.open);
  const root = useProject((s) => s.root);

  const [tab, setTab] = useState<"changes" | "log">("changes");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void refresh();
  }, [root, refresh]);

  useEffect(() => {
    if (tab === "log") void refreshLog();
  }, [tab, refreshLog]);

  const stagedRows = entries.filter((e) => isStaged(e));
  const unstagedRows = entries.filter((e) => e.worktree !== " " && e.worktree !== "?" || e.index === "?");

  const openDiff = (path: string, relPath: string, staged: boolean) =>
    open({ type: "diff", path, relPath, staged });

  const doCommit = async () => {
    if (!text.trim() || !stagedRows.length) return;
    setBusy(true);
    try {
      await commit(text.trim());
      setText("");
    } catch (e) {
      await message(String(e), { title: "Commit failed", kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  if (!root) return <div className={styles.empty}>No project open</div>;
  if (info && !info.repo) {
    return (
      <div className={styles.empty}>
        Not a Git repository.
        <br />
        Run <code>git init</code> in the project root, then refresh.
        <button type="button" className={styles.emptyButton} onClick={() => void refresh()}>
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div className={styles.git}>
      <div className={styles.toolbar}>
        <button type="button" className={styles.tab} data-active={tab === "changes"} onClick={() => setTab("changes")}>
          Changes
          {entries.length ? <span className={styles.badge}>{entries.length}</span> : null}
        </button>
        <button type="button" className={styles.tab} data-active={tab === "log"} onClick={() => setTab("log")}>
          Log
        </button>
        <span className={styles.branch}>
          <Icon name="branch" size={14} />
          {info?.branch ?? "…"}
          {info?.ahead ? <span className={styles.count}>↑{info.ahead}</span> : null}
          {info?.behind ? <span className={styles.count}>↓{info.behind}</span> : null}
        </span>
        <button
          type="button"
          className={styles.iconButton}
          title="Refresh"
          onClick={() => {
            void refresh();
            void refreshLog();
          }}
        >
          <Icon name="refresh" size={14} />
        </button>
      </div>

      {error ? <div className={styles.error}>{error}</div> : null}

      {tab === "changes" ? (
        <div className={styles.body}>
          <div className={styles.commitBox}>
            <textarea
              className={styles.message}
              placeholder="Commit message"
              value={text}
              rows={2}
              onChange={(e) => setText(e.target.value)}
            />
            <button
              type="button"
              className={styles.commitButton}
              disabled={busy || !text.trim() || !stagedRows.length}
              title={stagedRows.length ? "Commit staged changes" : "Stage changes first"}
              onClick={() => void doCommit()}
            >
              {busy ? "Committing…" : "Commit"}
            </button>
          </div>

          {loading && !entries.length ? <div className={styles.hint}>Reading git status…</div> : null}

          <div className={styles.section}>
            <div className={styles.sectionTitle}>Staged ({stagedRows.length})</div>
            {stagedRows.length ? (
              stagedRows.map((e) => (
                <ChangeRow
                  key={`staged:${e.path}`}
                  relPath={e.relPath}
                  path={e.path}
                  kind={statusKind(e)}
                  letter={statusLetter(e, true)}
                  staged
                  actionTitle="Unstage"
                  onOpen={() => openDiff(e.path, e.relPath, true)}
                  onAction={() => void unstage([e.path])}
                />
              ))
            ) : (
              <div className={styles.hint}>No staged changes</div>
            )}
          </div>

          <div className={styles.section}>
            <div className={styles.sectionTitle}>Changes ({unstagedRows.length})</div>
            {unstagedRows.length ? (
              unstagedRows.map((e) => (
                <ChangeRow
                  key={`unstaged:${e.path}`}
                  relPath={e.relPath}
                  path={e.path}
                  kind={statusKind(e)}
                  letter={statusLetter(e)}
                  staged={false}
                  actionTitle="Stage"
                  onOpen={() => openDiff(e.path, e.relPath, false)}
                  onAction={() => void stage([e.path])}
                />
              ))
            ) : (
              <div className={styles.hint}>Working tree is clean</div>
            )}
          </div>
        </div>
      ) : (
        <div className={styles.body}>
          {log.length ? (
            log.map((c) => (
              <div
                key={c.hash}
                className={styles.logRow}
                title={`${c.hash}\n${c.author} <${c.email}>\n${new Date(c.time * 1000).toLocaleString()}`}
                onClick={() => void navigator.clipboard.writeText(c.hash).catch(() => {})}
              >
                <span className={styles.hash}>{c.shortHash}</span>
                <span className={styles.subject}>{c.subject}</span>
                <span className={styles.logMeta}>{c.author}</span>
                <span className={styles.logMeta}>{new Date(c.time * 1000).toLocaleDateString()}</span>
              </div>
            ))
          ) : (
            <div className={styles.hint}>No commits yet</div>
          )}
        </div>
      )}
    </div>
  );
}
