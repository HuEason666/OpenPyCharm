/**
 * Cross-file rename. pyright's textDocument/rename only edits files that are
 * already open, so we ask for references (which cover the whole project) and
 * apply the edits ourselves to every referenced file.
 */
import { EditorSelection, type Text } from "@codemirror/state";
import { showDialog, type EditorView } from "@codemirror/view";
import { LSPPlugin } from "@codemirror/lsp-client";
import { message } from "@tauri-apps/plugin-dialog";
import { ensureBackgroundView } from "../editor/EditorArea";
import { getLspClient, uriToPath } from "./lsp";

interface LspPosition {
  line: number;
  character: number;
}

interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

interface LspLocation {
  uri?: string;
  targetUri?: string;
  range?: LspRange;
  targetSelectionRange?: LspRange;
}

function offsetAt(doc: Text, pos: LspPosition): number {
  const line = doc.line(Math.min(Math.max(1, pos.line + 1), doc.lines));
  return line.from + Math.min(Math.max(0, pos.character), line.length);
}

async function applyRename(view: EditorView, from: number, newName: string): Promise<void> {
  const client = getLspClient();
  const plugin = LSPPlugin.get(view);
  if (!client || !plugin) return;
  if (!newName) return;
  if (!/^[\p{L}_][\p{L}\p{N}_]*$/u.test(newName)) {
    await message("Not a valid Python identifier.", { title: "Rename", kind: "error" });
    return;
  }

  client.sync();
  let locations: LspLocation[] = [];
  try {
    locations = await client.request<unknown, LspLocation[]>("textDocument/references", {
      textDocument: { uri: plugin.uri },
      position: plugin.toPosition(from),
      context: { includeDeclaration: true },
    });
  } catch (e) {
    await message(String(e), { title: "Rename failed", kind: "error" });
    return;
  }
  if (!Array.isArray(locations) || !locations.length) return;

  const editsByUri = new Map<string, Array<{ from: number; to: number }>>();
  for (const location of locations) {
    const uri = location.uri ?? location.targetUri;
    const range = location.range ?? location.targetSelectionRange;
    if (!uri || !range) continue;
    await ensureBackgroundView(uriToPath(uri));
    const file = client.workspace.getFile(uri);
    if (!file) continue;
    const doc = file.getView()?.state.doc ?? file.doc;
    const edits = editsByUri.get(uri) ?? [];
    edits.push({ from: offsetAt(doc, range.start), to: offsetAt(doc, range.end) });
    editsByUri.set(uri, edits);
  }

  for (const [uri, edits] of editsByUri) {
    const target = client.workspace.getFile(uri)?.getView();
    if (!target) continue;
    edits.sort((a, b) => b.from - a.from);
    target.dispatch({
      changes: edits.map((e) => ({ from: e.from, to: e.to, insert: newName })),
      userEvent: "rename",
    });
  }

  const end = Math.min(from + newName.length, view.state.doc.length);
  view.dispatch({ selection: EditorSelection.single(Math.min(from, end), end), scrollIntoView: true });
}

export function renameSymbolCommand(view: EditorView): boolean {
  const plugin = LSPPlugin.get(view);
  const word = view.state.wordAt(view.state.selection.main.head);
  if (!plugin || !word) return false;
  const initial = view.state.sliceDoc(word.from, word.to);
  const { close, result } = showDialog(view, {
    label: "New name",
    input: { name: "name", value: initial },
    focus: true,
    submitLabel: "Rename",
    class: "cm-lsp-rename-panel",
  });
  result.then((form) => {
    view.dispatch({ effects: close });
    const field = form?.elements.namedItem("name");
    if (!form || !(field instanceof HTMLInputElement)) return;
    const next = field.value.trim();
    if (!next || next === initial) return;
    void applyRename(view, word.from, next);
  });
  return true;
}
