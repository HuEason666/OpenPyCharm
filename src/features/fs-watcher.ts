/**
 * File-system watching glue: one backend watcher per open project. On change
 * events we refresh the project tree, nudge the Git status and reload open
 * documents that were changed externally (only clean ones — dirty buffers are
 * never clobbered).
 *
 * Two guards keep this from feeding back on itself:
 *  - VCS/meta directories (.git etc.) are ignored entirely — `git status`
 *    refreshes .git/index as a side effect, which would otherwise re-trigger
 *    the watcher in a loop (the tree "flickers");
 *  - bursts are coalesced on a short trailing timer.
 */
import { ipc, listenFsChange } from "../platform/ipc";
import { useProject } from "../platform/project";
import { useDocs } from "../editor/docs";
import { editorViewFor } from "../editor/EditorArea";
import { refreshTreeAll } from "./project-tree/ProjectView";
import { useGit } from "./git/store";

let currentRoot: string | null = null;
let watchId: number | null = null;

function pathKey(p: string): string {
  return p.replace(/\//g, "\\").toLowerCase();
}

/** Events under these directories never reach the UI (prevents feedback loops). */
function isNoise(path: string): boolean {
  const k = pathKey(path);
  const segments = k.split("\\");
  return segments.some((s) =>
    s === ".git" || s === ".hg" || s === ".svn" || s === ".idea" ||
    s === "node_modules" || s === "__pycache__" || s === ".mypy_cache" ||
    s === ".pytest_cache" || s === ".ruff_cache",
  );
}

// --- change coalescing (trailing edge) ---

let pendingPaths = new Set<string>();
let flushTimer: number | null = null;

function scheduleChange(paths: string[]): void {
  for (const p of paths) pendingPaths.add(p);
  if (flushTimer !== null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    const batch = [...pendingPaths];
    pendingPaths = new Set();
    void handleChange(batch);
  }, 350);
}

async function handleChange(paths: string[]): Promise<void> {
  const root = useProject.getState().root;
  if (!root) return;
  const relevant = paths.filter((p) => !isNoise(p));
  if (!relevant.length) return;

  refreshTreeAll();
  void useGit.getState().refresh();

  const affected = new Set(relevant.map(pathKey));
  const docs = useDocs.getState();
  for (const doc of docs.docs) {
    if (doc.dirty || !affected.has(pathKey(doc.path))) continue;
    try {
      const file = await ipc.fsReadText(doc.path);
      const view = editorViewFor(doc.id);
      if (view && view.state.doc.toString() !== file.text) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: file.text },
        });
        docs.markSaved(doc.id, file.text);
      }
    } catch {
      // The file was deleted or became unreadable externally; leave the buffer.
    }
  }
}

/** Installs the watcher lifecycle + change listener once, at boot. */
export function installFsWatcher(): void {
  void listenFsChange((e) => scheduleChange(e.paths));

  useProject.subscribe((s) => {
    const root = s.root;
    if (root === currentRoot) return;
    currentRoot = root;
    if (watchId !== null) {
      const id = watchId;
      watchId = null;
      void ipc.watchStop(id).catch(() => {});
    }
    if (root) {
      void ipc
        .watchStart(root)
        .then((id) => {
          watchId = id;
        })
        .catch((e) => console.error("watchStart failed", e));
    }
  });
}
