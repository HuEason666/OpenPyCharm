/**
 * Navigation history (IDEA's Back/Forward): a bounded stack of document
 * positions. Jumps record the position they leave from; back/forward replay
 * entries without recording again.
 */
import { EditorSelection } from "@codemirror/state";
import { useDocs } from "./docs";
import { editorViewFor } from "./EditorArea";

export interface NavEntry {
  id: string;
  line: number;
  col: number;
}

const MAX_ENTRIES = 100;
const stack: NavEntry[] = [];
let index = -1;
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

export function subscribeNavigation(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function positionNow(): NavEntry | null {
  const id = useDocs.getState().activeId;
  if (!id) return null;
  const view = editorViewFor(id);
  if (!view) return null;
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  return { id, line: line.number, col: head - line.from + 1 };
}

/** Record the caret position about to be left; called before a navigation. */
export function recordCurrentPosition(): void {
  const entry = positionNow();
  if (entry) pushEntry(entry);
}

/** Push a destination onto the history (dedupes consecutive identical entries). */
export function pushEntry(entry: NavEntry): void {
  const current = stack[index];
  if (current && current.id === entry.id && current.line === entry.line && current.col === entry.col) return;
  stack.splice(index + 1);
  stack.push(entry);
  if (stack.length > MAX_ENTRIES) stack.shift();
  index = stack.length - 1;
  notify();
}

function gotoEntry(entry: NavEntry): void {
  const docs = useDocs.getState();
  const apply = () => {
    const view = editorViewFor(entry.id);
    if (!view) return;
    const doc = view.state.doc;
    const line = doc.line(Math.min(Math.max(1, entry.line), doc.lines));
    const pos = Math.min(line.from + Math.max(0, entry.col - 1), line.to);
    view.dispatch({ selection: EditorSelection.cursor(pos), scrollIntoView: true });
    view.focus();
  };
  const existing = docs.docs.find((d) => d.id === entry.id);
  if (existing) {
    docs.setActive(entry.id);
    requestAnimationFrame(apply);
  } else {
    void docs.openDoc(entry.id).then(() => requestAnimationFrame(apply));
  }
}

export function navigateBack(): void {
  if (index <= 0) return;
  index -= 1;
  gotoEntry(stack[index]);
  notify();
}

export function navigateForward(): void {
  if (index >= stack.length - 1) return;
  index += 1;
  gotoEntry(stack[index]);
  notify();
}

export function canNavigateBack(): boolean {
  return index > 0;
}

export function canNavigateForward(): boolean {
  return index >= 0 && index < stack.length - 1;
}

/** Most recent positions (newest first) — 导航 › 最近的位置. */
export function recentEntries(limit = 20): NavEntry[] {
  return [...stack].reverse().slice(0, limit);
}
