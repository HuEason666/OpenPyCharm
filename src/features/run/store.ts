/**
 * Run sessions: process lifecycle + captured output chunks.
 */
import { create } from "zustand";
import { ipc, listenRunChunk, listenRunExit, type RunStartArgs } from "../../platform/ipc";
import { useSettings } from "../../platform/settings";
import { notify } from "../../platform/notify";

export interface RunChunk {
  stream: "stdout" | "stderr" | "system";
  text: string;
}

export interface RunSession {
  id: number;
  name: string;
  config: RunStartArgs;
  chunks: RunChunk[];
  status: "running" | "exited";
  exitCode: number | null;
  /**
   * Stable identity of the run target (cwd + script args). Rerunning the same
   * file reuses its session tab (PyCharm behavior) instead of stacking tabs.
   */
  key: string;
}

/** Identity of a run target: same file + same working dir ⇒ same tab. */
function sessionKey(config: RunStartArgs): string {
  return `${config.cwd}|${config.args.join(" ")}`;
}

interface RunState {
  sessions: RunSession[];
  activeId: number | null;
  start: (name: string, config: RunStartArgs) => Promise<void>;
  stop: (id?: number) => Promise<void>;
  appendChunk: (id: number, chunk: RunChunk) => void;
  markExit: (id: number, code: number | null) => void;
  setActive: (id: number) => void;
  clear: (id: number) => void;
}

const MAX_CHUNKS = 5000;

export const useRun = create<RunState>()((set, get) => ({
  sessions: [],
  activeId: null,
  start: async (name, config) => {
    const key = sessionKey(config);
    const existing = get().sessions.find((x) => x.key === key);
    if (existing && existing.status === "running") {
      try {
        await ipc.runStop(existing.id);
      } catch {
        // The process may already be gone; still rerun.
      }
    }
    const put = (session: RunSession) =>
      set((s) => {
        const idx = s.sessions.findIndex((x) => x.key === key);
        if (idx >= 0) {
          // Reuse the existing tab in place so tab order is stable.
          const sessions = [...s.sessions];
          sessions[idx] = session;
          return { sessions, activeId: session.id };
        }
        return { sessions: [...s.sessions, session], activeId: session.id };
      });
    try {
      const handle = await ipc.runStart(config);
      put({
        key,
        id: handle.id,
        name,
        config,
        chunks: [],
        status: "running",
        exitCode: null,
      });
    } catch (e) {
      put({
        key,
        id: -Date.now(),
        name,
        config,
        chunks: [{ stream: "system", text: String(e) }],
        status: "exited",
        exitCode: null,
      });
    }
  },
  stop: async (id) => {
    const target = id ?? get().activeId;
    if (target === null || target < 0) return;
    try {
      await ipc.runStop(target);
    } catch {
      // Session may already be gone.
    }
  },
  appendChunk: (id, chunk) =>
    set((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === id ? { ...x, chunks: [...x.chunks, chunk].slice(-MAX_CHUNKS) } : x,
      ),
    })),
  markExit: (id, code) =>
    set((s) => ({
      sessions: s.sessions.map((x) => (x.id === id ? { ...x, status: "exited", exitCode: code } : x)),
    })),
  setActive: (id) => set({ activeId: id }),
  clear: (id) =>
    set((s) => ({
      sessions: s.sessions.map((x) => (x.id === id ? { ...x, chunks: [] } : x)),
    })),
}));

/** Ids of currently running sessions. */
export function runningRunIds(): Set<number> {
  return new Set(useRun.getState().sessions.filter((s) => s.status === "running").map((s) => s.id));
}

/** Install global listeners once; returns a disposer. */
export function installRunListeners(): () => void {
  const un1P = listenRunChunk((e) => useRun.getState().appendChunk(e.id, { stream: e.stream, text: e.text }));
  const un2P = listenRunExit((e) => {
    const session = useRun.getState().sessions.find((s) => s.id === e.id);
    useRun.getState().markExit(e.id, e.code);
    // Toast on finish unless muted in 设置 › 通知.
    const s = useSettings.getState().settings;
    if (s.notificationsEnabled === false || s.notifyRunFinish === false) return;
    const name = session?.name ?? "Python";
    if ((e.code ?? 0) === 0) notify("success", `「${name}」运行完成`);
    else notify("error", `「${name}」已退出，退出码 ${e.code ?? "—"}`);
  });
  return () => {
    void un1P.then((un) => un());
    void un2P.then((un) => un());
  };
}
