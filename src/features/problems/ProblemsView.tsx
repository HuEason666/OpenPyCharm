/**
 * Problems tool window: aggregates @codemirror/lint diagnostics (fed by the
 * Python language server) across all open editors, grouped per file. Clicking
 * an entry opens the file at the problem's position.
 */
import { useEffect, useState } from "react";
import { Icon } from "../../ui/icons";
import { forEachDiagnostic, type Diagnostic } from "@codemirror/lint";
import { useDocs, type Doc } from "../../editor/docs";
import { editorViewFor } from "../../editor/EditorArea";
import { revealInEditor } from "../../editor/reveal";
import { useLsp } from "../../platform/lsp";
import { pathRelative } from "../../platform/paths";
import { useProject } from "../../platform/project";
import styles from "./ProblemsView.module.css";

interface Row {
  doc: Doc;
  diag: Diagnostic;
  line: number;
  col: number;
}

function collect(): Row[] {
  const rows: Row[] = [];
  for (const doc of useDocs.getState().docs) {
    const view = editorViewFor(doc.id);
    if (!view) continue;
    forEachDiagnostic(view.state, (diag) => {
      const line = view.state.doc.lineAt(diag.from);
      rows.push({ doc, diag, line: line.number, col: diag.from - line.from + 1 });
    });
  }
  return rows;
}

function SeverityIcon({ severity }: { severity: Diagnostic["severity"] }) {
  const name = severity === "error" ? "error" : severity === "warning" ? "warning" : "info";
  return (
    <span className={styles.summaryIcon}>
      <Icon name={name} size={14} />
    </span>
  );
}

export function ProblemsView() {
  const docs = useDocs((s) => s.docs);
  const activeId = useDocs((s) => s.activeId);
  const lspStatus = useLsp((s) => s.status);
  const lspServer = useLsp((s) => s.server);
  // Diagnostics live in editor state; poll cheaply while visible.
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => tick((n) => n + 1), 700);
    return () => window.clearInterval(timer);
  }, []);

  const rows = collect();
  const errors = rows.filter((r) => r.diag.severity === "error").length;
  const warnings = rows.filter((r) => r.diag.severity === "warning").length;
  const root = useProject.getState().root;

  return (
    <div className={styles.problems}>
      <div className={styles.summary}>
        <span>
          <SeverityIcon severity="error" />
          {errors} error{errors === 1 ? "" : "s"}
        </span>
        <span>
          <SeverityIcon severity="warning" />
          {warnings} warning{warnings === 1 ? "" : "s"}
        </span>
        {lspStatus !== "ready" ? (
          <span className={styles.offline}>
            {lspStatus === "starting"
              ? "Starting language server…"
              : lspServer
                ? `Language server: ${lspServer}`
                : "Language server unavailable — install basedpyright for code analysis"}
          </span>
        ) : null}
      </div>
      {!rows.length ? (
        <div className={styles.empty}>
          {docs.length ? "No problems detected" : "Open a file to see its problems"}
        </div>
      ) : null}
      {rows.map((row, i) => {
        const showFile = i === 0 || rows[i - 1].doc.id !== row.doc.id;
        return (
          <div key={`${row.doc.id}:${row.diag.from}:${i}`}>
            {showFile ? (
              <div
                className={styles.fileRow}
                onClick={() => revealInEditor(row.doc.path, row.line, row.col)}
              >
                <Icon name={row.doc.name.toLowerCase().endsWith(".py") ? "file-python" : "file"} size={16} />
                <span>{row.doc.name}</span>
                <span className={styles.filePath}>{root ? pathRelative(root, row.doc.path) : row.doc.path}</span>
              </div>
            ) : null}
            <div
              className={styles.problemRow}
              onClick={() => revealInEditor(row.doc.id, row.line, row.col)}
              title={row.diag.message}
            >
              <SeverityIcon severity={row.diag.severity} />
              <span className={styles.problemText}>{row.diag.message}</span>
              <span className={styles.problemPos}>
                {row.line}:{row.col}
              </span>
            </div>
          </div>
        );
      })}
      {/* keep activeId referenced: problems refresh when tabs change */}
      <span hidden>{activeId ?? ""}</span>
    </div>
  );
}
