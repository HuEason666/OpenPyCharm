/**
 * Search Everywhere (Double Shift / Ctrl+Shift+N / Ctrl+Shift+A): top-center
 * popup with Files and Actions tabs; Up/Down + Enter to run.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, fileIconName } from "../../ui/icons";
import { ipc } from "../../platform/ipc";
import { useProject } from "../../platform/project";
import { useActions } from "../../platform/actions";
import { useOverlay } from "../../workbench/overlays";
import { revealInEditor } from "../../editor/reveal";
import { pathRelative } from "../../platform/paths";
import styles from "./SearchEverywhere.module.css";

type Tab = "all" | "files" | "actions";

export function SearchEverywhere({ initialTab }: { initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab ?? "all");
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const close = useOverlay((s) => s.close);
  const root = useProject((s) => s.root);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!root) return;
    let cancelled = false;
    void ipc
      .findFiles(root, undefined, 3000)
      .then((fs) => {
        if (!cancelled) setFiles(fs);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [root]);

  const actions = useActions((s) => s.actions);

  const fileResults = useMemo(() => {
    const q = query.toLowerCase().replace(/\s+/g, "");
    const list = files.filter((f) => {
      if (f.includes("/target/") || f.includes("\\target\\")) return false;
      return true;
    });
    if (!q) return list.slice(0, 30);
    return list
      .filter((f) => {
        const rel = root ? pathRelative(root, f).replace(/\\/g, "/").toLowerCase() : f.toLowerCase();
        return rel.includes(q) || rel.split("/").pop()!.includes(q);
      })
      .slice(0, 30);
  }, [files, query, root]);

  const actionResults = useMemo(() => {
    const q = query.toLowerCase();
    const all = [...actions.values()];
    if (!q) return all.slice(0, 30);
    return all
      .filter((a) => a.title.toLowerCase().includes(q) || a.id.toLowerCase().includes(q))
      .slice(0, 30);
  }, [actions, query]);

  const showFiles = tab === "all" || tab === "files";
  const showActions = tab === "all" || tab === "actions";

  const flat = useMemo(() => {
    const items: Array<{ kind: "file"; path: string } | { kind: "action"; id: string; title: string }> = [];
    if (showFiles) for (const f of fileResults) items.push({ kind: "file", path: f });
    if (showActions) for (const a of actionResults) items.push({ kind: "action", id: a.id, title: a.title });
    return items;
  }, [showFiles, fileResults, showActions, actionResults]);

  useEffect(() => {
    setIndex(0);
  }, [query, tab]);

  const activate = (i: number) => {
    const item = flat[i];
    if (!item) return;
    close();
    if (item.kind === "file") {
      revealInEditor(item.path);
    } else {
      void import("../../platform/actions").then(({ executeAction }) => executeAction(item.id));
    }
  };

  return (
    <>
      <div className={styles.backdrop} onPointerDown={close} />
      <div className={styles.panel} onKeyDown={(e) => e.stopPropagation()}>
        <div className={styles.tabs}>
          <button type="button" className={styles.tab} data-active={tab === "all"} onClick={() => setTab("all")}>
            All
          </button>
          <button type="button" className={styles.tab} data-active={tab === "files"} onClick={() => setTab("files")}>
            Files
          </button>
          <button type="button" className={styles.tab} data-active={tab === "actions"} onClick={() => setTab("actions")}>
            Actions
          </button>
        </div>
        <input
          ref={inputRef}
          className={styles.input}
          value={query}
          placeholder="Search everywhere…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              close();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, flat.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              activate(index);
            }
          }}
        />
        <div className={styles.list}>
          {showFiles && fileResults.length ? <div className={styles.groupLabel}>Files</div> : null}
          {showFiles
            ? fileResults.map((f) => {
                const i = flat.findIndex((x) => x.kind === "file" && x.path === f);
                const rel = root ? pathRelative(root, f) : f;
                return (
                  <div
                    key={`f:${f}`}
                    className={styles.row}
                    data-selected={i === index}
                    onPointerEnter={() => setIndex(i)}
                    onClick={() => activate(i)}
                  >
                    <Icon name={fileIconName(f)} size={16} />
                    <span>{f.split(/[\\/]/).pop()}</span>
                    <span className={styles.rowPath}>{root ? pathRelative(root, f) : rel}</span>
                  </div>
                );
              })
            : null}
          {showActions && actionResults.length ? <div className={styles.groupLabel}>Actions</div> : null}
          {showActions
            ? actionResults.map((a) => {
                const i = flat.findIndex((x) => x.kind === "action" && x.id === a.id);
                return (
                  <div
                    key={`a:${a.id}`}
                    className={styles.row}
                    data-selected={i === index}
                    onPointerEnter={() => setIndex(i)}
                    onClick={() => activate(i)}
                  >
                    <Icon name={a.icon ?? "more-horizontal"} size={16} />
                    <span>{a.title}</span>
                    <span className={styles.rowHint}>{a.id}</span>
                  </div>
                );
              })
            : null}
          {!flat.length ? <div className={styles.empty}>Nothing found</div> : null}
        </div>
      </div>
    </>
  );
}
