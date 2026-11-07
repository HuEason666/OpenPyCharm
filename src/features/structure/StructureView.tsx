/**
 * Structure tool window: Python outline (classes, methods, functions) parsed
 * from the live CodeMirror syntax tree. No backend involvement.
 */
import { useEffect, useMemo, useState } from "react";
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { Icon } from "../../ui/icons";
import { useDocs } from "../../editor/docs";
import { editorViewFor } from "../../editor/EditorArea";
import { onEditorUpdate } from "../../editor/viewEvents";
import { revealInEditor } from "../../editor/reveal";
import styles from "./StructureView.module.css";

type SymbolKind = "class" | "method" | "function";

interface SymbolRow {
  name: string;
  kind: SymbolKind;
  line: number;
  col: number;
  depth: number;
  from: number;
  to: number;
}

function collectSymbols(state: EditorState): SymbolRow[] {
  const rows: SymbolRow[] = [];
  let depth = 0;
  let classDepth = 0;
  syntaxTree(state).iterate({
    enter(ref) {
      if (ref.name === "ClassDefinition") {
        const name = ref.node.getChild("VariableName");
        if (!name) return;
        rows.push({
          name: state.sliceDoc(name.from, name.to),
          kind: "class",
          line: state.doc.lineAt(ref.from).number,
          col: ref.from - state.doc.lineAt(ref.from).from + 1,
          depth,
          from: ref.from,
          to: ref.to,
        });
        depth += 1;
        classDepth += 1;
      } else if (ref.name === "FunctionDefinition") {
        const name = ref.node.getChild("VariableName");
        if (!name) return;
        rows.push({
          name: state.sliceDoc(name.from, name.to),
          kind: classDepth > 0 ? "method" : "function",
          line: state.doc.lineAt(ref.from).number,
          col: ref.from - state.doc.lineAt(ref.from).from + 1,
          depth,
          from: ref.from,
          to: ref.to,
        });
        depth += 1;
      }
    },
    leave(ref) {
      if (ref.name === "ClassDefinition") {
        depth -= 1;
        classDepth -= 1;
      } else if (ref.name === "FunctionDefinition") {
        depth -= 1;
      }
    },
  });
  return rows;
}

export function StructureView() {
  const activeId = useDocs((s) => s.activeId);
  const docs = useDocs((s) => s.docs);
  const [, force] = useState(0);

  useEffect(() => onEditorUpdate(() => force((n) => n + 1)), []);

  const doc = docs.find((d) => d.id === activeId) ?? null;
  const view = activeId ? editorViewFor(activeId) : null;

  const { rows, caret } = useMemo(() => {
    if (!view) return { rows: [], caret: -1 };
    return { rows: collectSymbols(view.state), caret: view.state.selection.main.head };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, activeId, doc?.caret.line, doc?.caret.col]);

  if (!doc) return <div className={styles.empty}>No file is open</div>;
  if (doc.language !== "python") return <div className={styles.empty}>Structure is available for Python files</div>;
  if (!rows.length) return <div className={styles.empty}>No classes or functions in this file</div>;

  return (
    <div className={styles.tree} role="tree">
      {rows.map((row) => {
        const active = caret >= row.from && caret <= row.to;
        return (
          <div
            key={`${row.from}:${row.name}`}
            role="treeitem"
            className={styles.row}
            data-active={active || undefined}
            style={{ paddingLeft: 8 + row.depth * 14 }}
            onClick={() => revealInEditor(doc.id, row.line, row.col)}
            title={`${row.name} — line ${row.line}`}
          >
            <Icon name={row.kind} size={14} />
            <span className={styles.name}>{row.name}</span>
            <span className={styles.line}>{row.line}</span>
          </div>
        );
      })}
    </div>
  );
}
