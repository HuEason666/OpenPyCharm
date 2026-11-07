/**
 * Project tool window: lazy-loading file tree (24px rows, JetBrains-style
 * icons) with create/rename/delete context menus and speed-select.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon, fileIconName, folderIconName } from "../../ui/icons";
import { PopupMenu, type MenuItem } from "../../ui/PopupMenu";
import { ipc, type DirEntry } from "../../platform/ipc";
import { useProject } from "../../platform/project";
import { useSettings } from "../../platform/settings";
import { useDocs } from "../../editor/docs";
import { recordCurrentPosition, pushEntry } from "../../editor/navigation";
import { useGit, statusKind, type StatusKind } from "../git/store";
import { useOverlay } from "../../workbench/overlays";
import styles from "./ProjectView.module.css";

interface Row {
  entry: DirEntry;
  depth: number;
  expanded: boolean;
}

const listings = new Map<string, DirEntry[]>();
let expanded = new Set<string>();
let selectedPath: string | null = null;
let refreshTick = 0;
const listeners = new Set<() => void>();

function notify() {
  refreshTick += 1;
  for (const fn of listeners) fn();
}

export function refreshTreeDir(path: string | null): void {
  if (!path) return;
  listings.delete(path);
  notify();
}

export function refreshTreeAll(): void {
  listings.clear();
  notify();
}

export function revealInTree(path: string): void {
  // Expand ancestors of the path and select it.
  const root = useProject.getState().root;
  if (!root) return;
  const norm = path.replace(/\\/g, "/");
  const normRoot = root.replace(/\\/g, "/").replace(/\/$/, "");
  if (!norm.startsWith(normRoot)) return;
  const parts = norm.slice(normRoot.length + 1).split("/").filter(Boolean);
  let dir = normRoot;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = `${dir}/${parts[i]}`;
    expanded.add(dir);
  }
  selectedPath = path;
  refreshTreeAll();
}

function useTreeModel(root: string | null, excludeKey: string): Row[] {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  return useMemo(() => {
    const rows: Row[] = [];
    if (!root) return rows;

    // 设置 › 项目结构: dirs excluded for this project (relative posix paths).
    const excluded = new Set(excludeKey ? excludeKey.split("|") : []);

    const walk = (dir: string, depth: number) => {
      let entries = listings.get(dir);
      if (!entries) {
        entries = [];
        listings.set(dir, entries);
        void ipc
          .fsReadDir(dir)
          .then((es) => {
            listings.set(
              dir,
              es.filter((e) => e.kind !== "symlink" && !["\u002egit", "\u002ehg", "\u002esvn"].includes(e.name)),
            );
            notify();
          })
          .catch(() => listings.delete(dir));
      }
      for (const entry of entries) {
        const rel = entry.path.slice(root.length + 1).replace(/\\/g, "/");
        if (excluded.has(rel)) continue;
        const isExpanded = expanded.has(entry.path);
        rows.push({ entry, depth, expanded: isExpanded });
        if (entry.kind === "dir" && isExpanded) walk(entry.path, depth + 1);
      }
    };
    walk(root, 0);
    return rows;
    // refreshTick nudges recompute when listings change.
  }, [root, refreshTick, excludeKey]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function ProjectView() {
  const root = useProject((s) => s.root);
  const generation = useProject((s) => s.generation);
  const excludedDirs = useSettings((s) => s.settings.excludedDirs);
  const excludeKey = useMemo(() => {
    if (!root) return "";
    return (excludedDirs?.[root] ?? [])
      .map((r) => r.replace(/\\/g, "/").replace(/\/+$/, ""))
      .filter(Boolean)
      .join("|");
  }, [root, excludedDirs]);
  const rows = useTreeModel(root, excludeKey);

  useEffect(() => {
    // New project: reset view state.
    listings.clear();
    expanded = new Set();
    selectedPath = null;
    notify();
  }, [generation]);

  const [popup, setPopup] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const lastClickRef = useRef<{ path: string; time: number } | null>(null);
  const gitEntries = useGit((s) => s.entries);
  const vcs = useMemo(() => {
    const exact = new Map<string, StatusKind>();
    const dirs = new Map<string, StatusKind>();
    for (const e of gitEntries) {
      const p = e.path.replace(/\\/g, "/").toLowerCase();
      const kind = statusKind(e);
      exact.set(p, kind);
      let idx = p.lastIndexOf("/");
      while (idx > 0) {
        const dir = p.slice(0, idx);
        if (dirs.has(dir)) break;
        dirs.set(dir, kind);
        idx = dir.lastIndexOf("/");
      }
    }
    return { exact, dirs };
  }, [gitEntries]);

  const openEntry = useCallback((entry: DirEntry) => {
    if (entry.kind === "file") {
      recordCurrentPosition();
      pushEntry({ id: entry.path, line: 1, col: 1 });
      void useDocs.getState().openDoc(entry.path);
    }
  }, []);

  const toggleDir = useCallback((entry: DirEntry) => {
    if (expanded.has(entry.path)) expanded.delete(entry.path);
    else expanded.add(entry.path);
    notify();
  }, []);

  const contextMenu = useCallback(
    (entry: DirEntry | null, x: number, y: number) => {
      const rootNow = useProject.getState().root;
      if (!rootNow) return;
      const dir = entry ? (entry.kind === "dir" ? entry.path : rootNow) : rootNow;
      const target = entry?.path ?? rootNow;
      setPopup({
        x,
        y,
        items: [
          { type: "item", label: "New File…", icon: "plus", onSelect: () => useOverlay.getState().open({ type: "newFile", dir }) },
          { type: "item", label: "New Directory…", icon: "folder", onSelect: () => useOverlay.getState().open({ type: "newDir", dir }) },
          ...(entry
            ? ([
                { type: "separator" },
                { type: "item", label: "Rename…", icon: "edit", onSelect: () => useOverlay.getState().open({ type: "rename", path: target, isDir: entry.kind === "dir" }) },
                {
                  type: "item",
                  label: "Delete…",
                  icon: "trash",
                  danger: true,
                  onSelect: () => void confirmDelete(target, entry.kind === "dir"),
                },
                { type: "separator" },
                { type: "item", label: "Copy Path", icon: "copy", onSelect: () => void navigator.clipboard.writeText(target).catch(() => {}) },
                { type: "item", label: "Show in Explorer", icon: "external-link", onSelect: () => void ipc.fsRevealInShell(target).catch(() => {}) },
              ] as MenuItem[])
            : []),
        ],
      });
    },
    [],
  );

  if (!root) return <div className={styles.empty}>No project open</div>;

  return (
    <div className={styles.tree} role="tree">
      {rows.map((row) => {
        const { entry, depth } = row;
        const isSelected = selectedPath === entry.path;
        const norm = entry.path.replace(/\\/g, "/").toLowerCase();
        const vcsKind = vcs.exact.get(norm) ?? (entry.kind === "dir" ? vcs.dirs.get(norm) : undefined);
        return (
          <div
            key={entry.path}
            role="treeitem"
            aria-selected={isSelected}
            aria-level={depth + 1}
            className={styles.row}
            data-selected={isSelected || undefined}
            data-vcs={vcsKind}
            style={{ paddingLeft: 8 + depth * 16 }}
            title={entry.path}
            onClick={() => {
              selectedPath = entry.path;
              notify();
              const now = Date.now();
              const last = lastClickRef.current;
              if (entry.kind === "dir") {
                toggleDir(entry);
              } else if (last && last.path === entry.path && now - last.time < 500) {
                openEntry(entry);
              } else if (entry.name.toLowerCase().endsWith(".py")) {
                // Single click on Python files opens them (PyCharm preview behavior).
                openEntry(entry);
              }
              lastClickRef.current = { path: entry.path, time: now };
            }}
            onDoubleClick={() => openEntry(entry)}
            onContextMenu={(e) => {
              e.preventDefault();
              selectedPath = entry.path;
              notify();
              contextMenu(entry, e.clientX, e.clientY);
            }}
          >
            <span className={styles.chevron}>
              {entry.kind === "dir" ? <Icon name={row.expanded ? "chevron-down" : "chevron-right"} size={12} /> : null}
            </span>
            <Icon
              name={entry.kind === "dir" ? folderIconName("plain") : fileIconName(entry.name, entry.path)}
              size={16}
            />
            <span className={styles.name}>{entry.name}</span>
          </div>
        );
      })}
      <div
        className={styles.row}
        style={{ paddingLeft: 8 }}
        onContextMenu={(e) => {
          e.preventDefault();
          contextMenu(null, e.clientX, e.clientY);
        }}
      >
        {/* right-click empty space */}
      </div>
      {popup ? <PopupMenu x={popup.x} y={popup.y} items={popup.items} onClose={() => setPopup(null)} /> : null}
    </div>
  );
}

async function confirmDelete(path: string, isDir: boolean): Promise<void> {
  const { ask } = await import("@tauri-apps/plugin-dialog");
  const yes = await ask(`Delete ${isDir ? "directory" : "file"} "${path}"?`, { title: "Delete", kind: "warning" });
  if (!yes) return;
  try {
    await ipc.fsDelete(path, isDir);
    const parent = path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")));
    refreshTreeDir(parent);
    refreshTreeDir(path);
  } catch (e) {
    console.error("delete failed", e);
  }
}
