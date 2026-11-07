/**
 * Python language server (pyright) lifecycle and per-editor plugin wiring.
 * Edges: Rust bridge ↔ framed JSON-RPC ↔ @codemirror/lsp-client.
 */
import type { EditorView } from "@codemirror/view";
import { Compartment } from "@codemirror/state";
import { LSPClient, WorkspaceMapping, languageServerExtensions, type Transport } from "@codemirror/lsp-client";
import { create } from "zustand";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { ipc, listenLspExit, listenLspMessage } from "./ipc";
import { useSettings } from "./settings";
import { editorViewFor, ensureBackgroundView } from "../editor/EditorArea";
import { revealInEditor } from "../editor/reveal";

export type LspStatus = "stopped" | "starting" | "ready" | "error";

interface LspState {
  status: LspStatus;
  server: string | null;
  message: string | null;
}

export const useLsp = create<LspState>()(() => ({
  status: "stopped",
  server: null,
  message: null,
}));

interface RegisteredView {
  view: EditorView;
  compartment: Compartment;
  language: string;
}

let client: LSPClient | null = null;
let sessionId: number | null = null;
let unlistenMessage: UnlistenFn | null = null;
let unlistenExit: UnlistenFn | null = null;
let activeRoot: string | null = null;
const handlers = new Set<(value: string) => void>();
const views = new Map<string, RegisteredView>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The reference list builds its workspace mapping before the request; files
// opened only while resolving references aren't in that snapshot. They also
// haven't been edited since the request, so map their positions directly.
{
  const proto = WorkspaceMapping.prototype as unknown as {
    mapPosition: (uri: string, pos: { line: number; character: number }, assoc?: number, mode?: number) => number | null;
    startDocs?: Map<string, unknown>;
    client?: LSPClient;
  };
  const original = proto.mapPosition;
  proto.mapPosition = function (uri, pos, assoc = 1, mode) {
    if (this.startDocs && !this.startDocs.has(uri)) {
      const file = this.client?.workspace.getFile(uri);
      if (!file) return null;
      const line = file.doc.line(Math.min(Math.max(1, pos.line + 1), file.doc.lines));
      return line.from + Math.min(Math.max(0, pos.character), line.length);
    }
    return original.call(this, uri, pos, assoc, mode);
  };
}

export function pathToUri(path: string): string {
  let normalized = path.replace(/\\/g, "/");
  if (/^[A-Za-z]:/.test(normalized)) normalized = normalized[0].toLowerCase() + normalized.slice(1);
  const prefixed = normalized.startsWith("/") ? normalized : `/${normalized}`;
  let encoded = encodeURI(prefixed).replace(/#/g, "%23").replace(/\?/g, "%3F");
  // pyright normalizes Windows drive URIs to file:///e%3A/...; match it so
  // publishDiagnostics URIs find the open workspace file.
  if (/^\/[a-z]:/.test(encoded)) encoded = encoded.replace(/^\/[a-z]:/, (m) => `${m.slice(0, 2)}%3A`);
  return `file://${encoded}`;
}

export function uriToPath(uri: string): string {
  let path = uri.replace(/^file:\/\//, "");
  try {
    path = decodeURIComponent(path);
  } catch {
    // Keep the raw value if it isn't valid percent-encoding.
  }
  if (/^\/[A-Za-z]:/.test(path)) path = path[1].toUpperCase() + path.slice(2);
  return path.replace(/\//g, "\\");
}

function applyPlugin(docId: string, entry: RegisteredView): void {
  const extension =
    client && entry.language === "python" ? client.plugin(pathToUri(docId), "python") : [];
  try {
    entry.view.dispatch({ effects: entry.compartment.reconfigure(extension) });
  } catch {
    // The view may already be destroyed during teardown.
  }
}

export function registerLspView(
  docId: string,
  language: string,
  view: EditorView,
  compartment: Compartment,
): void {
  const entry: RegisteredView = { view, compartment, language };
  views.set(docId, entry);
  if (client && language === "python") applyPlugin(docId, entry);
}

export function unregisterLspView(docId: string): void {
  const entry = views.get(docId);
  views.delete(docId);
  if (!entry) return;
  try {
    entry.view.dispatch({ effects: entry.compartment.reconfigure([]) });
  } catch {
    // ignore
  }
}

function cleanup(): void {
  for (const [docId, entry] of views) applyPlugin(docId, { ...entry, language: "text" });
  client?.disconnect();
  client = null;
  handlers.clear();
  unlistenMessage?.();
  unlistenMessage = null;
  unlistenExit?.();
  unlistenExit = null;
  if (sessionId !== null) {
    void ipc.bridgeStop(sessionId).catch(() => {});
    sessionId = null;
  }
  activeRoot = null;
}

export function stopLsp(): void {
  cleanup();
  useLsp.setState({ status: "stopped", server: null, message: null });
}

/** Stop and start again — used after the interpreter or 排除目录 change. */
export async function restartLsp(root: string, python: string | null): Promise<void> {
  stopLsp();
  await startLsp(root, python);
}

/** Pyright `python.analysis.exclude` globs from 设置 › 项目结构. */
function pyrightExcludeGlobs(root: string | null): string[] {
  if (!root) return [];
  const excluded = useSettings.getState().settings.excludedDirs?.[root] ?? [];
  return excluded
    .map((rel) => rel.replace(/\\/g, "/").replace(/\/+$/, ""))
    .filter(Boolean)
    .map((rel) => `**/${rel}/**`);
}

export function getLspClient(): LSPClient | null {
  return client;
}

export async function startLsp(root: string, python: string | null): Promise<void> {
  // A reload or remount can request the same project twice; keep the in-flight
  // server instead of killing and respawning it.
  if (activeRoot === root && (client || useLsp.getState().status === "starting")) return;
  cleanup();
  activeRoot = root;
  useLsp.setState({ status: "starting", server: null, message: null });
  try {
    const session = await ipc.lspStart(root, python);
    sessionId = session.id;
    unlistenMessage = await listenLspMessage((e) => {
      if (e.id !== session.id) return;
      for (const handler of handlers) handler(e.message);
    });
    unlistenExit = await listenLspExit((e) => {
      if (e.id !== session.id || !client) return;
      client.disconnect();
      client = null;
      useLsp.setState({ status: "error", message: "Language server exited unexpectedly" });
    });

    const lsp = new LSPClient({
      rootUri: pathToUri(root),
      initializationOptions: {
        settings: {
          python: {
            pythonPath: python ?? undefined,
            analysis: { exclude: pyrightExcludeGlobs(root) },
          },
        },
      },
      extensions: languageServerExtensions(),
      timeout: 15000,
    });

    // Cross-file navigation: open the target through the workbench.
    const workspace = lsp.workspace;
    workspace.displayFile = async (uri) => {
      const path = uriToPath(uri);
      revealInEditor(path, 1, 1, undefined, true);
      for (let i = 0; i < 150; i++) {
        const file = workspace.getFile(uri);
        if (file) return file.getView() ?? editorViewFor(path);
        await sleep(20);
      }
      return editorViewFor(path);
    };
    workspace.requestFile = async (uri) => {
      let file = workspace.getFile(uri);
      if (file) return file;
      const path = uriToPath(uri);
      // Open in the background: don't switch the active tab or the reference
      // panel would be attached to a detached editor.
      await ensureBackgroundView(path);
      for (let i = 0; i < 150; i++) {
        file = workspace.getFile(uri);
        if (file) return file;
        await sleep(20);
      }
      return null;
    };

    const transport: Transport = {
      send(message) {
        if (sessionId !== null) {
          void ipc.bridgeSend(sessionId, message).catch((e) => console.error("lsp send failed", e));
        }
      },
      subscribe(handler) {
        handlers.add(handler);
      },
      unsubscribe(handler) {
        handlers.delete(handler);
      },
    };

    lsp.connect(transport);
    await lsp.initializing;
    client = lsp;
    useLsp.setState({ status: "ready", server: session.server });
    for (const [docId, entry] of views) {
      if (entry.language === "python") applyPlugin(docId, entry);
    }
  } catch (e) {
    cleanup();
    useLsp.setState({ status: "error", server: null, message: String(e) });
    console.error("LSP start failed", e);
  }
}

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__opcLsp = {
    status: () => useLsp.getState().status,
    client: () => client,
    files: () => client?.workspace.files.map((f) => f.uri) ?? [],
    capabilities: () => client?.serverCapabilities ?? null,
    uri: (path: string) => pathToUri(path),
    path: (uri: string) => uriToPath(uri),
  };
}
