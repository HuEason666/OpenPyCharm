/**
 * Indent guides for every visible line (PyCharm style), with the caret
 * line's own guides drawn in the brighter "active" color. Zero-width widgets
 * so lines never shift horizontally.
 */
import { indentUnit } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

class GuideWidget extends WidgetType {
  constructor(readonly active: boolean) {
    super();
  }

  eq(other: GuideWidget) {
    return other.active === this.active;
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = this.active ? "cm-indent-guide cm-indent-guide-active" : "cm-indent-guide";
    return span;
  }

  ignoreEvent() {
    return true;
  }
}

const guide = Decoration.widget({ widget: new GuideWidget(false), side: -1 });
const guideActive = Decoration.widget({ widget: new GuideWidget(true), side: -1 });

function indentWidth(text: string, unitLen: number): number {
  let col = 0;
  for (const ch of text) {
    if (ch === " ") col += 1;
    else if (ch === "\t") col += unitLen;
    else break;
  }
  return col;
}

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { state } = view;
  const unit = Math.max(1, state.facet(indentUnit).length);
  // Guides on the caret line use the active color up to its own indent.
  const caretLines = new Set(state.selection.ranges.map((r) => state.doc.lineAt(r.head).number));
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = state.doc.lineAt(pos);
      pos = line.to + 1;
      const col = indentWidth(line.text, unit);
      const active = caretLines.has(line.number);
      for (let g = unit; g < col; g += unit) {
        builder.add(line.from + g, line.from + g, active ? guideActive : guide);
      }
    }
  }
  return builder.finish();
}

export const indentGuides = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = build(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = build(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
