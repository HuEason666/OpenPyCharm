/**
 * Python semantic highlight layer over the lezer tree: `self`/`cls` and
 * parameter names get their dedicated Islands tokens (the plain tag mapping
 * can't distinguish them).
 */
import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";
import { ViewPlugin, Decoration, type DecorationSet, type ViewUpdate } from "@codemirror/view";

function build(view: ViewUpdate["view"]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== "VariableName") return;
        const text = view.state.sliceDoc(node.from, node.to);
        if (text === "self" || text === "cls") {
          builder.add(node.from, node.to, Decoration.mark({ class: "cm-sem-self" }));
          return;
        }
        const parent = node.node.parent;
        if (parent && (parent.name === "parameters" || parent.name === "ParameterList")) {
          builder.add(node.from, node.to, Decoration.mark({ class: "cm-sem-param" }));
        }
      },
    });
  }
  return builder.finish();
}

export const pythonSemantics = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: ViewUpdate["view"]) {
      this.decorations = build(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = build(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
