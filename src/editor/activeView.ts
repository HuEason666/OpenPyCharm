/** Registry of the focused CodeMirror view; actions route editor commands here. */
import type { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";

let active: EditorView | null = null;

export function setActiveView(view: EditorView | null): void {
  active = view;
}

export function activeView(): EditorView | null {
  return active;
}

/** The document text of the active view, or null. */
export function activeText(): string | null {
  return active ? active.state.doc.toString() : null;
}

export { EditorSelection };
