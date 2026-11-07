/**
 * Reveal-in-editor: open a document and jump to a line:column (used by Find
 * in Files, Search Everywhere and Go to Line).
 */
import { EditorSelection } from "@codemirror/state";
import { useDocs } from "./docs";
import { editorViewFor } from "./EditorArea";
import { pushEntry, recordCurrentPosition } from "./navigation";

export interface RevealRequest {
  id: string;
  line: number; // 1-based
  col: number; // 1-based
  len?: number;
}

let pending: RevealRequest | null = null;

export function applyReveal(view: import("@codemirror/view").EditorView | null, req: RevealRequest): void {
  if (!view) return;
  const doc = view.state.doc;
  const lineNo = Math.min(Math.max(1, req.line), doc.lines);
  const line = doc.line(lineNo);
  const pos = Math.min(line.from + Math.max(0, req.col - 1), line.to);
  const end = req.len ? Math.min(pos + req.len, line.to) : pos;
  view.dispatch({
    selection: EditorSelection.single(pos, end),
    scrollIntoView: true,
  });
  view.focus();
}

export function revealInEditor(path: string, line = 1, col = 1, len?: number, record = true): void {
  if (record) {
    recordCurrentPosition();
    pushEntry({ id: path, line, col });
  }
  const req: RevealRequest = { id: path, line, col, len };
  const existing = useDocs.getState().docs.find((d) => d.id === path);
  if (existing) {
    useDocs.getState().setActive(path);
    // Wait a tick for the view to mount, then apply.
    requestAnimationFrame(() => applyReveal(editorViewFor(path), req));
  } else {
    pending = req;
    void useDocs.getState().openDoc(path);
  }
}

/** EditorArea calls this after mounting the view for `id` and applies it. */
export function takeReveal(id: string): RevealRequest | null {
  if (pending && pending.id === id) {
    const req = pending;
    pending = null;
    return req;
  }
  return null;
}
