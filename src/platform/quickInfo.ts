/**
 * Quick info popups (代码 › 快速文档 / 表达式类型信息 / 错误描述).
 * Quick doc and type info both resolve through the language server's hover;
 * error description reads the diagnostics attached to the active editor.
 */
import { forEachDiagnostic } from "@codemirror/lint";
import { activeView } from "../editor/activeView";
import { useDocs } from "../editor/docs";
import { getLspClient, pathToUri } from "./lsp";
import { useOverlay } from "../workbench/overlays";

type HoverContents = string | { value?: string; kind?: string } | Array<{ value?: string }> | null;

interface HoverResult {
  contents?: HoverContents;
}

function hoverText(result: HoverResult | null): string {
  const contents = result?.contents;
  if (!contents) return "";
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) return contents.map((c) => c.value ?? "").join("\n\n");
  return contents.value ?? "";
}

function openQuickInfo(title: string, text: string): void {
  useOverlay.getState().open({
    type: "quickInfo",
    title,
    text: text.trim() || "（当前光标处没有可用信息）",
  });
}

/** Ctrl+Q / Ctrl+Shift+P — pyright hover shows docs and inferred types. */
export async function showQuickDoc(title: string): Promise<void> {
  const view = activeView();
  const docs = useDocs.getState();
  const docId = docs.activeId;
  const client = getLspClient();
  if (!view || !docId || !client?.connected) {
    openQuickInfo(title, "语言服务未就绪或没有打开的编辑器。");
    return;
  }
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  try {
    const result = await client.request<
      { textDocument: { uri: string }; position: { line: number; character: number } },
      HoverResult | null
    >("textDocument/hover", {
      textDocument: { uri: pathToUri(docId) },
      position: { line: line.number - 1, character: head - line.from },
    });
    openQuickInfo(title, hoverText(result) || "（当前光标处没有可用信息）");
  } catch (e) {
    openQuickInfo(title, `请求失败：${String(e)}`);
  }
}

/** Ctrl+F1 — the diagnostic message nearest to the caret. */
export function showErrorDescription(): void {
  const view = activeView();
  if (!view) return;
  const head = view.state.selection.main.head;
  let best: { dist: number; message: string; severity: string } | null = null;
  forEachDiagnostic(view.state, (d, from, to) => {
    const dist = from > head ? from - head : head > to ? head - to : 0;
    if (!best || dist < best.dist) {
      best = { dist, message: d.message, severity: String(d.severity) };
    }
  });
  if (!best) {
    openQuickInfo("错误描述", "光标附近没有错误或警告。");
    return;
  }
  const b = best as { dist: number; message: string; severity: string };
  openQuickInfo("错误描述", `[${b.severity}] ${b.message}`);
}
