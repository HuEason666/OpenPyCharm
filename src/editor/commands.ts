/**
 * PyCharm-style line commands operating on the active CodeMirror view:
 * comment line (Ctrl+/), duplicate (Ctrl+D), delete (Ctrl+Y), move (Alt+Shift+↑/↓),
 * extend/shrink selection (Ctrl+W / Ctrl+Shift+W), error navigation (F2).
 */
import type { EditorView } from "@codemirror/view";
import { EditorSelection, type ChangeSpec } from "@codemirror/state";
import { startCompletion } from "@codemirror/autocomplete";
import { syntaxTree, foldCode, unfoldCode, foldAll, unfoldAll } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { activeView } from "./activeView";
import { openSearchPanel, closeSearchPanel, replaceNext, openSearchPanel as openPanel } from "@codemirror/search";
import { undo, redo, selectAll, toggleBlockComment, indentSelection } from "@codemirror/commands";
import { forEachDiagnostic } from "@codemirror/lint";

function lineRange(view: EditorView, from: number, to: number) {
  const lineFrom = view.state.doc.lineAt(from);
  const lineTo = view.state.doc.lineAt(to);
  return { fromLine: lineFrom, toLine: lineTo };
}

export function commentLine(view: EditorView | null = activeView()): boolean {
  if (!view) return false;
  const { state } = view;
  const changes: ChangeSpec[] = [];
  const seenLines = new Set<number>();
  let allCommented = true;
  for (const range of state.selection.ranges) {
    const { fromLine, toLine } = lineRange(view, range.from, range.to);
    for (let n = fromLine.number; n <= toLine.number; n++) {
      if (seenLines.has(n)) continue;
      seenLines.add(n);
      const line = state.doc.line(n);
      const text = line.text;
      const trimmed = text.trimStart();
      if (trimmed.startsWith("#")) allCommented = false;
    }
  }
  // Decide target: if every selected line already has a `#`, uncomment; else comment.
  for (const n of [...seenLines].sort((a, b) => a - b)) {
    const line = state.doc.line(n);
    const indent = line.text.length - line.text.trimStart().length;
    if (allCommented) {
      const after = line.text.slice(indent);
      if (after.startsWith("#")) {
        const rest = after.startsWith("# ") ? after.slice(2) : after.slice(1);
        changes.push({ from: line.from + indent, to: line.from + indent + (after.startsWith("# ") ? 2 : 1), insert: rest });
      }
    } else {
      changes.push({ from: line.from + indent, insert: "# " });
    }
  }
  if (!changes.length) return false;
  view.dispatch({ changes });
  return true;
}

export function duplicateLine(view: EditorView | null = activeView()): boolean {
  if (!view) return false;
  const { state } = view;
  const trs = state.changeByRange((range) => {
    if (!range.empty) {
      const text = state.sliceDoc(range.from, range.to);
      return { changes: { from: range.to, insert: text }, range: EditorSelection.range(range.from + text.length, range.to + text.length) };
    }
    const line = state.doc.lineAt(range.head);
    const insertText = "\n" + line.text;
    const pos = line.to;
    return {
      changes: { from: pos, insert: insertText },
      range: EditorSelection.cursor(range.head + insertText.length),
    };
  });
  view.dispatch(trs);
  return true;
}

export function deleteLine(view: EditorView | null = activeView()): boolean {
  if (!view) return false;
  const { state } = view;
  const changes: ChangeSpec[] = [];
  const seen = new Set<number>();
  for (const range of state.selection.ranges) {
    const { fromLine, toLine } = lineRange(view, range.from, range.to);
    for (let n = fromLine.number; n <= toLine.number; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      const line = state.doc.line(n);
      if (n === state.doc.lines) {
        // Last line: delete from previous line's end.
        if (n > 1) {
          const prev = state.doc.line(n - 1);
          changes.push({ from: prev.to, to: line.to });
        } else {
          changes.push({ from: line.from, to: line.to, insert: "" });
        }
      } else {
        changes.push({ from: line.from, to: line.to + 1 });
      }
    }
  }
  if (!changes.length) return false;
  view.dispatch({ changes });
  return true;
}

function moveLines(view: EditorView, dir: -1 | 1): boolean {
  const { state } = view;
  const range = state.selection.main;
  const { fromLine, toLine } = lineRange(view, range.from, range.to);
  const targetNum = fromLine.number + dir;
  if (targetNum < 1 || targetNum > state.doc.lines) return false;

  const first = state.doc.line(fromLine.number);
  const last = state.doc.line(toLine.number);
  const block = state.sliceDoc(first.from, last.to);

  if (dir === -1) {
    const above = state.doc.line(targetNum);
    view.dispatch({
      changes: [
        { from: above.from, insert: block + "\n" },
        { from: first.from, to: last.to + (last.number === state.doc.lines ? 0 : 1), insert: "" },
      ],
      selection: EditorSelection.cursor(range.head - (above.to - above.from + 1)),
    });
  } else {
    const below = state.doc.line(targetNum);
    const belowText = state.sliceDoc(below.from, below.to);
    view.dispatch({
      changes: [
        { from: first.from, to: below.to, insert: belowText + "\n" + block },
      ],
      selection: EditorSelection.cursor(range.head + belowText.length + 1),
    });
  }
  return true;
}

export function moveLineUp(view: EditorView | null = activeView()): boolean {
  return view ? moveLines(view, -1) : false;
}
export function moveLineDown(view: EditorView | null = activeView()): boolean {
  return view ? moveLines(view, 1) : false;
}

export function findInFile(): boolean {
  const view = activeView();
  if (!view) return false;
  openSearchPanel(view);
  return true;
}

export function replaceInFile(): boolean {
  const view = activeView();
  if (!view) return false;
  openPanel(view);
  return true;
}

export { closeSearchPanel, replaceNext, undo, redo, selectAll, toggleBlockComment, indentSelection, foldCode, unfoldCode, foldAll, unfoldAll };

// --- selection growth via the syntax tree (Ctrl+W / Ctrl+Shift+W) ---

export function extendSelection(view: EditorView | null = activeView()): boolean {
  if (!view) return false;
  const { state } = view;
  const range = state.selection.main;
  if (range.empty) {
    const word = state.wordAt(range.head);
    if (word && (word.from !== range.from || word.to !== range.to)) {
      view.dispatch({ selection: EditorSelection.range(word.from, word.to), scrollIntoView: true });
      return true;
    }
  }
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(range.from, 1);
  while (node) {
    if (node.from <= range.from && node.to >= range.to && (node.from < range.from || node.to > range.to)) {
      view.dispatch({ selection: EditorSelection.range(node.from, node.to), scrollIntoView: true });
      return true;
    }
    node = node.parent ?? null;
  }
  const line = state.doc.lineAt(range.to);
  if (range.to < line.to) {
    view.dispatch({ selection: EditorSelection.range(range.from, line.to), scrollIntoView: true });
    return true;
  }
  const nextLine = state.doc.line(Math.min(state.doc.lines, line.number + 1));
  view.dispatch({ selection: EditorSelection.range(range.from, nextLine.to), scrollIntoView: true });
  return true;
}

export function shrinkSelection(view: EditorView | null = activeView()): boolean {
  if (!view) return false;
  const { state } = view;
  const range = state.selection.main;
  if (range.empty) return false;
  // Largest syntax node strictly inside the current selection, containing the head.
  let node = syntaxTree(state).resolveInner(range.head, -1);
  while (node && node.parent) {
    const n = node.parent;
    if (n.from >= range.from && n.to <= range.to && (n.from > range.from || n.to < range.to)) {
      node = n;
      break;
    }
    if (n.from < range.from || n.to > range.to) break;
    node = n;
  }
  if (node && (node.from > range.from || node.to < range.to) && node.from >= range.from && node.to <= range.to) {
    view.dispatch({ selection: EditorSelection.range(node.from, node.to), scrollIntoView: true });
    return true;
  }
  // Fallback: drop the last line.
  const line = state.doc.lineAt(range.to);
  if (range.from < line.from) {
    view.dispatch({ selection: EditorSelection.range(range.from, line.from - 1), scrollIntoView: true });
    return true;
  }
  view.dispatch({ selection: EditorSelection.cursor(range.from), scrollIntoView: true });
  return true;
}

// --- next / previous highlighted error (F2 / Shift+F2), wrapping around ---

function jumpError(view: EditorView | null, dir: 1 | -1): boolean {  if (!view) return false;
  const found: number[] = [];
  forEachDiagnostic(view.state, (d) => found.push(d.from));
  if (!found.length) return false;
  found.sort((a, b) => a - b);
  const head = view.state.selection.main.head;
  let target: number | undefined;
  if (dir === 1) {
    target = found.find((p) => p > head) ?? found[0];
  } else {
    for (let i = found.length - 1; i >= 0; i--) {
      if (found[i] < head) {
        target = found[i];
        break;
      }
    }
    target = target ?? found[found.length - 1];
  }
  if (target === undefined) return false;
  view.dispatch({ selection: EditorSelection.cursor(target), scrollIntoView: true });
  return true;
}

export function nextError(view: EditorView | null = activeView()): boolean {
  return jumpError(view, 1);
}
export function prevError(view: EditorView | null = activeView()): boolean {
  return jumpError(view, -1);
}

// --- sort / reverse selected lines (编辑 › 对行排序 / 反转行) ---

function mapSelectedLines(view: EditorView, map: (lines: string[]) => string[]): boolean {
  const { state } = view;
  const range = state.selection.main;
  const fromLine = state.doc.lineAt(range.from);
  const toLine = state.doc.lineAt(range.to);
  const lines: string[] = [];
  for (let n = fromLine.number; n <= toLine.number; n++) lines.push(state.doc.line(n).text);
  const next = map(lines).join("\n");
  if (next === state.sliceDoc(fromLine.from, toLine.to)) return false;
  view.dispatch({
    changes: { from: fromLine.from, to: toLine.to, insert: next },
    selection: EditorSelection.range(fromLine.from, fromLine.from + next.length),
  });
  return true;
}

export function sortLines(view: EditorView | null = activeView()): boolean {
  if (!view) return false;
  return mapSelectedLines(view, (lines) =>
    lines.sort((a, b) => a.trimStart().localeCompare(b.trimStart())),
  );
}

export function reverseLines(view: EditorView | null = activeView()): boolean {
  if (!view) return false;
  return mapSelectedLines(view, (lines) => lines.reverse());
}

// --- jump to the next / previous def/class (导航 › 下一个/上一个方法) ---

function methodLines(state: Parameters<typeof syntaxTree>[0]): number[] {
  const lines: number[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "FunctionDefinition" || node.name === "ClassDefinition") {
        lines.push(state.doc.lineAt(node.from).number);
      }
      return undefined;
    },
  });
  return [...new Set(lines)].sort((a, b) => a - b);
}

export function gotoNextMethod(view: EditorView | null = activeView()): boolean {
  if (!view) return false;
  const cursor = view.state.doc.lineAt(view.state.selection.main.head).number;
  const target = methodLines(view.state).find((n) => n > cursor);
  if (!target) return false;
  const line = view.state.doc.line(target);
  view.dispatch({ selection: EditorSelection.cursor(line.from), scrollIntoView: true });
  return true;
}

export function gotoPrevMethod(view: EditorView | null = activeView()): boolean {
  if (!view) return false;
  const cursor = view.state.doc.lineAt(view.state.selection.main.head).number;
  const target = [...methodLines(view.state)].reverse().find((n) => n < cursor);
  if (!target) return false;
  const line = view.state.doc.line(target);
  view.dispatch({ selection: EditorSelection.cursor(line.from), scrollIntoView: true });
  return true;
}

// --- trigger the (LSP-backed) completion popup manually ---

export function triggerCompletion(view: EditorView | null = activeView()): boolean {
  if (!view) return false;
  void startCompletion(view);
  return true;
}
