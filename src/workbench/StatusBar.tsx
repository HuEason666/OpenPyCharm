/**
 * Status bar: left = file path breadcrumbs; right = Python interpreter, LSP,
 * caret position, line ending, encoding, indent — borderless on the frame,
 * like PyCharm's.
 */
import { useEffect, useState } from "react";
import { Icon } from "../ui/icons";
import { PopupMenu, type MenuItem } from "../ui/PopupMenu";
import { useDocs } from "../editor/docs";
import { useProject } from "../platform/project";
import { usePython } from "../features/python/store";
import { useLsp } from "../platform/lsp";
import styles from "./StatusBar.module.css";

function InterpreterWidget({ onOpenMenu }: { onOpenMenu: (x: number, y: number, items: MenuItem[]) => void }) {
  const sdks = usePython((s) => s.sdks);
  const selected = usePython((s) => s.selected);
  const detect = usePython((s) => s.detect);
  const label = selected?.name ?? "No Python interpreter";

  useEffect(() => {
    void detect();
  }, [detect]);

  return (
    <button
      type="button"
      className={styles.widget}
      title="Python interpreter"
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        onOpenMenu(
          rect.right - 360,
          rect.top - 8 - Math.min(sdks.length + 1, 8) * 24 - 8,
          [
            ...(selected
              ? [
                  {
                    type: "item" as const,
                    label: selected.name,
                    icon: "check",
                    onSelect: () => {},
                  },
                ]
              : []),
            ...sdks
              .filter((s) => s.path !== selected?.path)
              .map((s) => ({
                type: "item" as const,
                label: s.name,
                onSelect: () => void usePython.getState().select(s.path),
              })),
            { type: "separator" as const },
            {
              type: "item" as const,
              label: "Rescan interpreters",
              icon: "refresh",
              onSelect: () => void usePython.getState().detect(true),
            },
          ],
        );
      }}
    >
      <span className={styles.icon}>
        <Icon name="file-python" size={16} />
      </span>
      {label}
    </button>
  );
}

function LspWidget() {
  const status = useLsp((s) => s.status);
  const message = useLsp((s) => s.message);
  if (status !== "error") return null;
  return (
    <div className={styles.widgetContent} title={message ?? "Python language server error"} style={{ color: "var(--danger)" }}>
      <span className={styles.icon}>
        <Icon name="warning" size={14} />
      </span>
      LSP
    </div>
  );
}

/** Left-side file path breadcrumbs: 项目 › … › 目录 › 文件（中段省略）。 */
function FilePathWidget() {
  const docs = useDocs((s) => s.docs);
  const activeId = useDocs((s) => s.activeId);
  const active = docs.find((d) => d.id === activeId);
  const root = useProject((s) => s.root);
  if (!active || !root) return null;
  const rel = active.path.startsWith(root) ? active.path.slice(root.length + 1) : active.path;
  const parts = rel.split(/[\\/]/).filter(Boolean);
  const shown = parts.length > 4 ? [parts[0], "…", ...parts.slice(-3)] : parts;
  return (
    <div className={styles.filePath} title={active.path}>
      {shown.map((seg, i) => {
        const isLast = i === shown.length - 1;
        return (
          <span key={`${seg}:${i}`} className={styles.pathSeg}>
            {i > 0 ? <span className={styles.pathSep}>›</span> : null}
            <span className={styles.pathItem}>
              <Icon name={isLast ? "file-python" : "folder"} size={12} />
              {seg}
            </span>
          </span>
        );
      })}
    </div>
  );
}

export function StatusBar() {
  const docs = useDocs((s) => s.docs);
  const activeId = useDocs((s) => s.activeId);
  const active = docs.find((d) => d.id === activeId);
  const [popup, setPopup] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const openMenu = (x: number, y: number, items: MenuItem[]) => setPopup({ x, y, items });

  return (
    <footer className={styles.statusbar}>
      <FilePathWidget />
      <div className={styles.spacer} />
      <LspWidget />
      <InterpreterWidget onOpenMenu={openMenu} />
      {active ? (
        <>
          <div className={styles.widgetContent}>
            {active.caret.line}:{active.caret.col}
          </div>
          <div className={styles.widgetContent}>LF</div>
          <div className={styles.widgetContent}>UTF-8</div>
          <div className={styles.widgetContent}>4 spaces</div>
        </>
      ) : null}
      {popup ? <PopupMenu x={popup.x} y={popup.y} items={popup.items} onClose={() => setPopup(null)} /> : null}
    </footer>
  );
}
