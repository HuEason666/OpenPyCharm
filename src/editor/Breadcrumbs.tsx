/**
 * Breadcrumbs over the editor: file › class › function at the caret, with
 * click-to-jump on every segment (PyCharm's editor breadcrumbs).
 */
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import type { EditorState } from "@codemirror/state";
import { editorViewFor } from "./EditorArea";
import { applyReveal } from "./reveal";
import styles from "./EditorArea.module.css";

interface Crumb {
  label: string;
  line: number;
}

function symbolName(state: EditorState, node: SyntaxNode): string {
  const name = node.getChild("VariableName");
  return name ? state.sliceDoc(name.from, name.to) : "?";
}

export function Breadcrumbs({ docId, name }: { docId: string; name: string }) {
  const view = editorViewFor(docId);
  const crumbs: Crumb[] = [{ label: name, line: 1 }];
  if (view) {
    const state = view.state;
    const pos = state.selection.main.head;
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1);
    const chain: SyntaxNode[] = [];
    for (; node; node = node.parent) {
      if (node.name === "ClassDefinition" || node.name === "FunctionDefinition") chain.unshift(node);
    }
    for (const n of chain) crumbs.push({ label: symbolName(state, n), line: state.doc.lineAt(n.from).number });
  }
  return (
    <div className={styles.breadcrumbs}>
      {crumbs.map((c, i) => (
        <span key={`${c.label}:${i}`} className={styles.crumbWrap}>
          {i ? <span className={styles.crumbSep}>›</span> : null}
          <button
            type="button"
            className={styles.crumb}
            data-last={i === crumbs.length - 1 || undefined}
            onClick={() => applyReveal(view, { id: docId, line: c.line, col: 1 })}
          >
            {c.label}
          </button>
        </span>
      ))}
    </div>
  );
}
