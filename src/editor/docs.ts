/**
 * Document model: open files, dirty tracking, save. One CM EditorView per
 * document is managed by the EditorArea; this store holds the logical state.
 */
import { create } from "zustand";
import { ipc } from "../platform/ipc";
import { pathBase } from "../platform/paths";
import { notify } from "../platform/notify";

export type LanguageId = "python" | "text" | "json" | "toml" | "markdown" | "yaml" | "javascript" | "css" | "html" | "vue";

export interface Doc {
  id: string; // absolute path
  path: string;
  name: string;
  language: LanguageId;
  saved: string;
  dirty: boolean;
  /** 1-based caret line/column for the status bar. */
  caret: { line: number; col: number };
}

export function languageForPath(path: string): LanguageId {
  const lower = path.toLowerCase();
  if (lower.endsWith(".py") || lower.endsWith(".pyw") || lower.endsWith(".pyi")) return "python";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".toml")) return "toml";
  if (lower.endsWith(".md")) return "markdown";
  if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "yaml";
  // 前端语言（全栈项目支持）。
  if (lower.endsWith(".ts") || lower.endsWith(".tsx") || lower.endsWith(".js") || lower.endsWith(".jsx") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) return "javascript";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".vue")) return "vue";
  return "text";
}

interface DocsState {
  docs: Doc[];
  activeId: string | null;
  editorFocused: boolean;
  openDoc: (path: string, text?: string) => Promise<void>;
  /** Open a document without changing the active tab (LSP background files). */
  openDocBackground: (path: string) => Promise<void>;
  closeDoc: (id: string) => void;
  closeOthers: (id: string) => void;
  closeAll: () => void;
  /** Reorder tabs by drag: move `id` so it ends up at `toIndex`. */
  moveDoc: (id: string, toIndex: number) => void;
  setActive: (id: string | null) => void;
  markDirty: (id: string, text: string) => void;
  markSaved: (id: string, text: string) => void;
  save: (id: string) => Promise<void>;
  saveAll: () => Promise<void>;
  setEditorFocused: (v: boolean) => void;
  setCaret: (id: string, line: number, col: number) => void;
}

function makeDoc(path: string, content: string): Doc {
  return {
    id: path,
    path,
    name: pathBase(path),
    language: languageForPath(path),
    saved: content,
    dirty: false,
    caret: { line: 1, col: 1 },
  };
}

const opening = new Set<string>();

export const useDocs = create<DocsState>()((set, get) => ({
  docs: [],
  activeId: null,
  editorFocused: false,
  openDoc: async (path, text) => {
    const existing = get().docs.find((d) => d.id === path);
    if (existing) {
      set({ activeId: path });
      return;
    }
    // Double-click fires both click and dblclick; don't append the doc twice.
    if (opening.has(path)) return;
    opening.add(path);
    let content = text;
    if (content === undefined) {
      try {
        const f = await ipc.fsReadText(path);
        content = f.text;
      } catch (e) {
        console.error("openDoc failed", e);
        // 静默失败会让"点击无反应"——用 toast 告知用户原因。
        notify("error", `无法打开 ${pathBase(path)}: ${String(e)}`);
        return;
      } finally {
        opening.delete(path);
      }
    } else {
      opening.delete(path);
    }
    const doc: Doc = makeDoc(path, content);
    set((s) => ({ docs: [...s.docs, doc], activeId: path }));
  },
  openDocBackground: async (path) => {
    if (get().docs.some((d) => d.id === path)) return;
    try {
      const f = await ipc.fsReadText(path);
      const doc = makeDoc(path, f.text);
      set((s) => ({ docs: [...s.docs, doc] }));
    } catch (e) {
      console.error("openDocBackground failed", e);
    }
  },
  closeDoc: (id) => {
    set((s) => {
      const docs = s.docs.filter((d) => d.id !== id);
      let activeId = s.activeId;
      if (activeId === id) {
        const idx = s.docs.findIndex((d) => d.id === id);
        activeId = docs[Math.min(idx, docs.length - 1)]?.id ?? null;
      }
      return { docs, activeId };
    });
  },
  closeOthers: (id) => {
    set((s) => ({ docs: s.docs.filter((d) => d.id === id), activeId: id }));
  },
  closeAll: () => {
    set({ docs: [], activeId: null });
  },
  moveDoc: (id, toIndex) => {
    set((s) => {
      const from = s.docs.findIndex((d) => d.id === id);
      if (from < 0 || toIndex < 0 || toIndex >= s.docs.length || from === toIndex) return s;
      const docs = [...s.docs];
      const [moved] = docs.splice(from, 1);
      docs.splice(toIndex, 0, moved);
      return { docs };
    });
  },
  setActive: (id) => set({ activeId: id }),
  markDirty: (id, text) =>
    set((s) => ({
      docs: s.docs.map((d) => (d.id === id ? { ...d, dirty: text !== d.saved } : d)),
    })),
  markSaved: (id, text) =>
    set((s) => ({
      docs: s.docs.map((d) => (d.id === id ? { ...d, saved: text, dirty: false } : d)),
    })),
  save: async (id) => {
    const doc = get().docs.find((d) => d.id === id);
    if (!doc) return;
    // The EditorArea keeps the live text; ask it to flush before writing.
    const live = getDocText?.(id) ?? doc.saved;
    try {
      await ipc.fsWriteText(doc.path, live);
      get().markSaved(id, live);
    } catch (e) {
      console.error("save failed", e);
    }
  },
  saveAll: async () => {
    for (const d of get().docs) {
      if (d.dirty) await get().save(d.id);
    }
  },
  setEditorFocused: (v) => set({ editorFocused: v }),
  setCaret: (id, line, col) =>
    set((s) => ({
      docs: s.docs.map((d) => (d.id === id ? { ...d, caret: { line, col } } : d)),
    })),
}));

/**
 * Set by the EditorArea: returns the live text of an open document so saving
 * always writes the current buffer, not a stale copy.
 */
export let getDocText: ((id: string) => string | null) | null = null;
export function setDocTextProvider(fn: (id: string) => string | null): void {
  getDocText = fn;
}

if (import.meta.env.DEV) {
  (window as unknown as { __opcDocs?: () => string[] }).__opcDocs = () =>
    useDocs.getState().docs.map((d) => d.id);
}
