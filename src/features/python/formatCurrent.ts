/** Reformat / clean the active Python buffer (ruff/black/autopep8 via backend). */
import { EditorSelection } from "@codemirror/state";
import { message } from "@tauri-apps/plugin-dialog";
import { activeView } from "../../editor/activeView";
import { useDocs } from "../../editor/docs";
import { usePython } from "./store";
import { useSettings } from "../../platform/settings";
import { ipc } from "../../platform/ipc";

function posForLineCol(text: string, line: number, col: number): number {
  const lines = text.split("\n");
  const target = Math.min(Math.max(1, line), lines.length);
  let offset = 0;
  for (let i = 0; i < target - 1; i++) offset += lines[i].length + 1;
  return offset + Math.min(Math.max(0, col), lines[target - 1].length);
}

/** Replace the active document with `formatted`, keeping the caret near its line. */
async function replaceActiveDoc(
  title: string,
  run: (python: string, path: string, text: string) => Promise<string>,
): Promise<void> {
  const view = activeView();
  const activeId = useDocs.getState().activeId;
  if (!view || !activeId) return;
  const doc = useDocs.getState().docs.find((d) => d.id === activeId);
  if (!doc) return;
  if (doc.language !== "python") {
    await message(`${title} 目前仅支持 Python 文件。`, { title });
    return;
  }

  const head = view.state.selection.main.head;
  const caretLine = view.state.doc.lineAt(head);
  const caret = { line: caretLine.number, col: head - caretLine.from };

  const python = usePython.getState().selected?.path ?? "python";
  try {
    const formatted = await run(python, doc.path, view.state.doc.toString());
    if (formatted === view.state.doc.toString()) return;
    const pos = posForLineCol(formatted, caret.line, caret.col);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: formatted },
      selection: EditorSelection.cursor(pos),
    });
    view.focus();
  } catch (e) {
    await message(String(e), { title, kind: "error" });
  }
}

/** 重新格式化代码 (Ctrl+Alt+L)：尊重 设置 › 构建工具 的格式化器偏好。 */
export async function formatActiveFile(): Promise<void> {
  const formatter = useSettings.getState().settings.formatter ?? "auto";
  await replaceActiveDoc("Reformat Code", (python, path, text) =>
    ipc.pythonFormat(python, path, text, formatter),
  );
}

/** 优化导入 (Ctrl+Alt+O)：ruff I001 自动修复。 */
export async function organizeImportsActiveFile(): Promise<void> {
  await replaceActiveDoc("Optimize Imports", (python, path, text) =>
    ipc.pythonOrganizeImports(python, path, text),
  );
}

/** 代码清理：优化导入 + 重新格式化。 */
export async function cleanupActiveFile(): Promise<void> {
  await organizeImportsActiveFile();
  await formatActiveFile();
}
