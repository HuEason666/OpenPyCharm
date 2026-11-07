/**
 * CodeMirror 6 setup: the JetBrains-Islands editor theme (reads only CSS
 * variables from tokens.css), the syntax highlight style mapped onto the
 * `--syn-*` tokens, and the extension set. Python is the first-class language.
 */
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightSpecialChars, type ViewUpdate } from "@codemirror/view";
import { EditorState, type Extension } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput, syntaxHighlighting, indentUnit, foldGutter, foldKeymap, codeFolding } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { lintGutter } from "@codemirror/lint";
import { jumpToDefinition, showSignatureHelp } from "@codemirror/lsp-client";
import { HighlightStyle, syntaxTree } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import type { LanguageId } from "./docs";
import { pythonSemantics } from "./semantics";
import { indentGuides } from "./indentGuides";
import { gutterRun } from "./gutterRun";

// --- highlight style: lezer tags → --syn-* tokens (Islands color scheme) ---

export const openpycharmHighlight = HighlightStyle.define([
  { tag: t.keyword, color: "var(--syn-keyword)" },
  { tag: [t.controlKeyword, t.moduleKeyword], color: "var(--syn-keyword)" },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: "var(--syn-variable)" },
  { tag: [t.propertyName], color: "var(--syn-property)" },
  { tag: [t.variableName], color: "var(--syn-variable)" },
  { tag: [t.function(t.variableName), t.labelName], color: "var(--syn-function-call)" },
  { tag: [t.definition(t.variableName), t.function(t.definition(t.variableName))], color: "var(--syn-function)" },
  { tag: [t.definition(t.propertyName)], color: "var(--syn-function)" },
  { tag: [t.typeName, t.className, t.namespace], color: "var(--syn-type)" },
  { tag: [t.number, t.integer, t.float], color: "var(--syn-number)" },
  { tag: [t.string, t.special(t.string)], color: "var(--syn-string)" },
  { tag: [t.regexp, t.escape], color: "var(--syn-string)" },
  { tag: [t.docString], color: "var(--syn-docstring)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--syn-comment)", fontStyle: "var(--syn-comment-style, normal)" },
  { tag: [t.meta, t.processingInstruction], color: "var(--syn-annotation)" },
  { tag: [t.annotation], color: "var(--syn-decorator)" },
  { tag: [t.operator, t.operatorKeyword], color: "var(--syn-keyword)" },
  { tag: [t.punctuation, t.separator], color: "var(--syn-punct)" },
  { tag: [t.bracket], color: "var(--syn-punct)" },
  { tag: [t.bool, t.null, t.atom], color: "var(--syn-constant)" },
  { tag: [t.self], color: "var(--syn-self)" },
  { tag: [t.standard(t.variableName)], color: "var(--syn-builtin)" },
  { tag: [t.standard(t.name)], color: "var(--syn-builtin)" },
  { tag: t.invalid, color: "var(--syn-invalid)" },
  { tag: [t.heading], color: "var(--syn-keyword)", fontWeight: "bold" },
  { tag: [t.emphasis], fontStyle: "italic" },
  { tag: [t.strong], fontWeight: "bold" },
  { tag: [t.link, t.url], color: "var(--link)", textDecoration: "underline" },
  { tag: [t.strikethrough], textDecoration: "line-through" },
]);

// --- editor theme ---

export const openpycharmEditorTheme = EditorView.theme({
  "&": {
    color: "var(--fg-editor)",
    backgroundColor: "var(--bg-editor, var(--bg-island))",
    height: "100%",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    fontSize: "var(--fs-code)",
    lineHeight: "var(--lh-code)",
    overflow: "auto",
  },
  ".cm-content": {
    padding: "4px 0 8px 0",
    caretColor: "var(--caret)",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeft: "2px solid var(--caret)",
  },
  ".cm-selectionBackground, ::selection": {
    backgroundColor: "var(--bg-editor-selection) !important",
  },
  ".cm-focused .cm-selectionBackground": {
    backgroundColor: "var(--bg-editor-selection) !important",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--bg-current-line)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--bg-editor, var(--bg-island))",
    color: "var(--fg-line-number)",
    border: "none",
    borderRight: "1px solid var(--border)",
    minWidth: "var(--w-gutter)",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 12px 0 16px",
    minWidth: "24px",
    textAlign: "right",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: "var(--fg)",
  },
  ".cm-foldGutter .cm-gutterElement": {
    padding: "0 2px",
  },
  ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
    backgroundColor: "transparent",
    outline: "1px solid var(--border-strong)",
    color: "inherit",
  },
  ".cm-selectionMatch": {
    backgroundColor: "var(--bg-text-search-result)",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--bg-popup)",
    border: "1px solid var(--border-popup)",
    borderRadius: "var(--radius-popup)",
    boxShadow: "var(--shadow-popup)",
    color: "var(--fg)",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--fs-small)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--bg-selected)",
    color: "var(--fg)",
  },
  ".cm-tooltip-autocomplete ul li": {
    padding: "2px 8px",
  },
  ".cm-panels": {
    backgroundColor: "var(--bg-elev)",
    color: "var(--fg)",
    borderColor: "var(--border)",
  },
  ".cm-searchMatch": {
    backgroundColor: "var(--bg-text-search-result)",
  },
  ".cm-searchMatch-selected": {
    backgroundColor: "var(--bg-text-search-result-current)",
  },
  // Semantic layer (self/cls, parameters)
  ".cm-sem-self": {
    color: "var(--syn-self)",
  },
  ".cm-sem-param": {
    color: "var(--syn-param)",
  },
  // Indent guides (all lines; caret line brighter). Zero-metric widget: the
  // span must not participate in line-box metrics, or indented lines grow and
  // the content desyncs from the gutter.
  ".cm-indent-guide": {
    display: "inline-block",
    width: "0",
    height: "0",
    position: "relative",
    pointerEvents: "none",
  },
  ".cm-indent-guide::after": {
    content: '""',
    position: "absolute",
    left: "-1px",
    bottom: "-0.2em",
    width: "1px",
    height: "calc(1.7em + 0.2em)",
    background: "var(--border-indent-guide)",
  },
  ".cm-indent-guide-active::after": {
    background: "var(--border-indent-guide-active)",
  },
  // __main__ gutter run marker
  ".cm-run-gutter": {
    width: "16px",
  },
  ".cm-gutter-run": {
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--icon-color)",
    opacity: 0.85,
  },
  ".cm-gutter-run:hover": {
    color: "var(--success)",
    opacity: 1,
  },
});

function languageExtension(language: LanguageId, opts: { path?: () => string | null }): Extension {
  switch (language) {
    case "python":
      // Language package + the semantic/insight layers (self/params, gutter run).
      return [python(), pythonSemantics, gutterRun(opts.path ?? (() => null))];
    case "json":
      return json();
    case "markdown":
      return markdown();
    case "yaml":
      return yaml();
    default:
      return [];
  }
}

export function baseExtensions(
  language: LanguageId,
  opts: { onUpdate?: (update: ViewUpdate) => void; path?: () => string | null } = {},
): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    codeFolding(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    syntaxHighlighting(openpycharmHighlight, { fallback: true }),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    lintGutter(),
    indentGuides,
    indentUnit.of("    "), // PEP 8: 4 spaces
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      // IDEA bindings for language-server actions (F12/F2/Shift-F12 come from
      // the LSP client's own extension).
      { key: "Ctrl-b", run: jumpToDefinition },
      { key: "Ctrl-p", run: showSignatureHelp },
      indentWithTab,
    ]),
    languageExtension(language, opts),
    openpycharmEditorTheme,
    EditorView.updateListener.of((update) => {
      if (opts.onUpdate) opts.onUpdate(update);
    }),
  ];
}

/** True when the tree at position is a definition name (used by outline). */
export function isDefinitionName(state: EditorState, pos: number): boolean {
  const node = syntaxTree(state).resolveInner(pos, -1);
  return node.name === "FunctionDefinition" || node.name === "ClassDefinition";
}
