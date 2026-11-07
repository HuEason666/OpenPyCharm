/**
 * Side-by-side diff (CodeMirror MergeView): HEAD/index on the left, index or
 * working tree on the right, both read-only.
 */
import { useEffect, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { MergeView } from "@codemirror/merge";
import { Icon } from "../../ui/icons";
import { baseExtensions } from "../../editor/setup";
import { languageForPath } from "../../editor/docs";
import { ipc } from "../../platform/ipc";
import { useProject } from "../../platform/project";
import styles from "./DiffDialog.module.css";

function createMerge(parent: HTMLElement, left: string, right: string, path: string): MergeView {
  const language = languageForPath(path);
  const readOnly = [EditorState.readOnly.of(true), EditorView.editable.of(false)];
  return new MergeView({
    a: { doc: left, extensions: [...baseExtensions(language), ...readOnly] },
    b: { doc: right, extensions: [...baseExtensions(language), ...readOnly] },
    parent,
    highlightChanges: true,
    gutter: true,
    collapseUnchanged: { margin: 3, minSize: 8 },
  });
}

export function DiffDialog({
  path,
  relPath,
  staged,
  onClose,
}: {
  path: string;
  relPath: string;
  staged: boolean;
  onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let merge: MergeView | null = null;
    let cancelled = false;
    void (async () => {
      const root = useProject.getState().root;
      if (!root || !hostRef.current) return;
      try {
        const [left, right] = staged
          ? await Promise.all([ipc.gitShow(root, path, "head"), ipc.gitShow(root, path, "index")])
          : await Promise.all([
              ipc.gitShow(root, path, "index"),
              ipc
                .fsReadText(path)
                .then((f) => f.text)
                .catch(() => ""),
            ]);
        if (cancelled || !hostRef.current) return;
        merge = createMerge(hostRef.current, left, right, path);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
      merge?.destroy();
    };
  }, [path, staged]);

  return (
    <>
      <div className={styles.backdrop} onPointerDown={onClose} />
      <div className={styles.panel}>
        <div className={styles.header}>
          <Icon name="commit" size={16} />
          <span className={styles.title}>{relPath}</span>
          <span className={styles.meta}>{staged ? "Staged changes" : "Working tree changes"}</span>
          <button type="button" className={styles.close} aria-label="Close diff" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className={styles.body}>
          {error ? <div className={styles.error}>{error}</div> : <div ref={hostRef} className={styles.host} />}
        </div>
      </div>
    </>
  );
}
