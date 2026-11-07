/**
 * Breakpoint store, gutter and current-execution-line decoration.
 * The gutter markers are recomputed from the store on every view update, so a
 * no-op transaction is enough to repaint after an external change.
 */
import {
  Prec,
  RangeSet,
  StateEffect,
  StateField,
  type Extension,
  type Range,
} from "@codemirror/state";
import { Decoration, EditorView, GutterMarker, gutter, type DecorationSet } from "@codemirror/view";

const byFile = new Map<string, Set<number>>();
const listeners = new Set<(path: string) => void>();

export function getBreakpoints(path: string): Set<number> {
  return byFile.get(path) ?? new Set();
}

export function allBreakpoints(): Array<{ path: string; line: number }> {
  const out: Array<{ path: string; line: number }> = [];
  for (const [path, lines] of byFile) {
    for (const line of [...lines].sort((a, b) => a - b)) out.push({ path, line });
  }
  return out;
}

export function onBreakpointsChange(fn: (path: string) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function notify(path: string): void {
  for (const fn of listeners) fn(path);
}

export function toggleBreakpoint(path: string, line: number): void {
  let set = byFile.get(path);
  if (!set) {
    set = new Set();
    byFile.set(path, set);
  }
  if (set.has(line)) set.delete(line);
  else set.add(line);
  if (!set.size) byFile.delete(path);
  notify(path);
}

export function removeBreakpoint(path: string, line: number): void {
  const set = byFile.get(path);
  if (!set?.has(line)) return;
  set.delete(line);
  if (!set.size) byFile.delete(path);
  notify(path);
}

export function clearBreakpointsFor(path: string): void {
  if (!byFile.delete(path)) return;
  notify(path);
}

class BreakpointMarker extends GutterMarker {
  toDOM(): Node {
    const dot = document.createElement("div");
    dot.className = "cm-breakpoint-dot";
    return dot;
  }
}

const breakpointMarker = new BreakpointMarker();

class SpacerMarker extends GutterMarker {
  toDOM(): Node {
    const dot = document.createElement("div");
    dot.className = "cm-breakpoint-spacer";
    return dot;
  }
}

/** Gutter with click-to-toggle breakpoints for one document. */
export function breakpointExtension(path: string): Extension {
  return Prec.high(
    gutter({
      class: "cm-breakpoint-gutter",
      initialSpacer: () => new SpacerMarker(),
      markers: (view) => {
        const ranges: Range<GutterMarker>[] = [];
        for (const lineNumber of getBreakpoints(path)) {
          if (lineNumber < 1 || lineNumber > view.state.doc.lines) continue;
          const from = view.state.doc.line(lineNumber).from;
          ranges.push(breakpointMarker.range(from));
        }
        return RangeSet.of(ranges, true);
      },
      domEventHandlers: {
        mousedown(view, line, event) {
          if ((event as MouseEvent).button !== 0) return false;
          toggleBreakpoint(path, view.state.doc.lineAt(line.from).number);
          view.dispatch({});
          return true;
        },
      },
    }),
  );
}

/** Repaint a gutter after the breakpoint store changed externally. */
export function refreshBreakpointGutter(view: EditorView | null): void {
  view?.dispatch({});
}

const setDebugLine = StateEffect.define<number | null>();

const debugLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const effect of tr.effects) {
      if (!effect.is(setDebugLine)) continue;
      if (effect.value === null) return Decoration.none;
      const line = tr.state.doc.line(Math.min(Math.max(1, effect.value), tr.state.doc.lines));
      return Decoration.set([Decoration.line({ class: "cm-debug-line" }).range(line.from)]);
    }
    return deco.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function debugLineExtension(): Extension {
  return debugLineField;
}

export function showDebugLine(view: EditorView | null, line: number | null): void {
  view?.dispatch({ effects: setDebugLine.of(line) });
}
