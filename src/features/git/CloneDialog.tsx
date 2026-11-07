/** Clone a Git repository from the welcome page, then open it as a project. */
import { useEffect, useRef, useState } from "react";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { Icon } from "../../ui/icons";
import { ipc } from "../../platform/ipc";
import { useProject } from "../../platform/project";
import { pathDir, pathJoin } from "../../platform/paths";
import styles from "./CloneDialog.module.css";

function repoName(url: string): string {
  const cleaned = url.trim().replace(/[\\/]+$/, "").split(/[?#]/)[0];
  const last = cleaned.slice(Math.max(cleaned.lastIndexOf("/"), cleaned.lastIndexOf(":")) + 1);
  return last.replace(/\.git$/i, "");
}

export function CloneDialog({ onClose }: { onClose: () => void }) {
  const recents = useProject((s) => s.recents);
  const [url, setUrl] = useState("");
  const [parent, setParent] = useState(recents[0] ? pathDir(recents[0]) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => urlRef.current?.focus(), []);

  const name = repoName(url);
  const target = parent && name ? pathJoin(parent, name) : "";

  const browse = async () => {
    const dir = await dialogOpen({ directory: true, multiple: false, title: "选择克隆位置" });
    if (typeof dir === "string") setParent(dir);
  };

  const clone = async () => {
    if (!url.trim() || !parent.trim()) {
      setError("请填写仓库地址和克隆位置");
      return;
    }
    if (!name) {
      setError("无法从仓库地址推断仓库名");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await ipc.gitClone(url.trim(), target);
      onClose();
      await useProject.getState().open(target);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className={styles.backdrop} onPointerDown={busy ? undefined : onClose} />
      <div className={styles.dialog} onKeyDown={(e) => e.stopPropagation()}>
        <div className={styles.title}>克隆仓库</div>
        <label className={styles.label}>仓库地址</label>
        <input
          ref={urlRef}
          className={styles.input}
          value={url}
          placeholder="https://github.com/user/repo.git"
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void clone();
          }}
        />
        <label className={styles.label}>克隆到</label>
        <div className={styles.row}>
          <input
            className={styles.input}
            value={parent}
            placeholder="选择父目录"
            onChange={(e) => setParent(e.target.value)}
          />
          <button type="button" className={styles.browse} onClick={() => void browse()} disabled={busy}>
            浏览…
          </button>
        </div>
        {target ? (
          <div className={styles.hint}>
            <Icon name="folder" size={12} /> {target}
          </div>
        ) : null}
        {error ? <div className={styles.error}>{error}</div> : null}
        <div className={styles.buttons}>
          <button type="button" className={styles.button} onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            type="button"
            className={styles.button}
            data-primary="true"
            onClick={() => void clone()}
            disabled={busy || !url.trim() || !parent.trim()}
          >
            {busy ? "克隆中…" : "克隆"}
          </button>
        </div>
      </div>
    </>
  );
}
