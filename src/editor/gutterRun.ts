/**
 * Gutter run marker: a ▶ next to the `if __name__ == "__main__":` guard (the
 * module's entry point), clicking it runs that file — PyCharm's gutter action.
 */
import { gutter, GutterMarker, type EditorView as GV } from "@codemirror/view";
import { StateField, type Extension } from "@codemirror/state";
import { iconMarkupOrFallback } from "../ui/icons";

const MAIN_GUARD = /^if\s+__name__\s*==\s*["']__main__["']\s*:/;

/** Rescans for the main guard line on every change (files are small; O(lines)). */
const mainLineField = StateField.define<number | null>({
  create: (state) => {
    for (let i = 1; i <= state.doc.lines; i++) {
      if (MAIN_GUARD.test(state.doc.line(i).text)) return i;
    }
    return null;
  },
  update: (value, tr) => {
    if (!tr.docChanged) return value;
    for (let i = 1; i <= tr.state.doc.lines; i++) {
      if (MAIN_GUARD.test(tr.state.doc.line(i).text)) return i;
    }
    return null;
  },
});

export function gutterRun(getPath: () => string | null): Extension {
  const marker = new (class extends GutterMarker {
    toDOM(): HTMLElement {
      const el = document.createElement("span");
      el.className = "cm-gutter-run";
      el.title = "Run this file (Shift+F10)";
      el.innerHTML = iconMarkupOrFallback("gutter-run", 14) ?? "▶";
      el.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        void import("../features/python/runCurrent").then((m) => m.runFile(getPath()));
      });
      return el;
    }
  })();

  return [
    mainLineField,
    gutter({
      class: "cm-run-gutter",
      // `line` is a BlockInfo (no line number); derive it from the block start.
      lineMarker: (view: GV, line) =>
        view.state.field(mainLineField) === view.state.doc.lineAt(line.from).number ? marker : null,
      initialSpacer: () => marker,
    }),
  ];
}
