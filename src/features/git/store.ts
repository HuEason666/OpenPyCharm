/** Git state: repository info, working-tree changes, recent commits. */
import { create } from "zustand";
import { ipc, type GitCommit, type GitEntry, type GitInfo } from "../../platform/ipc";
import { useProject } from "../../platform/project";
import { useSettings } from "../../platform/settings";

export type StatusKind = "modified" | "added" | "deleted" | "untracked" | "conflict" | "renamed";

export function statusKind(e: GitEntry): StatusKind {
  const x = e.index;
  const y = e.worktree;
  if (x === "U" || y === "U") return "conflict";
  if (x === "?" || y === "?") return "untracked";
  if (x === "R" || y === "R") return "renamed";
  if (x === "A" || y === "A") return "added";
  if (x === "D" || y === "D") return "deleted";
  return "modified";
}

export function isStaged(e: GitEntry): boolean {
  return e.index !== " " && e.index !== "?";
}

export function statusLetter(e: GitEntry, staged = false): string {
  if (staged) return e.index === " " ? "M" : e.index;
  if (e.index === "?") return "U";
  return e.worktree === " " ? e.index : e.worktree;
}

interface GitState {
  info: GitInfo | null;
  entries: GitEntry[];
  log: GitCommit[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  refreshLog: () => Promise<void>;
  stage: (paths: string[]) => Promise<void>;
  unstage: (paths: string[]) => Promise<void>;
  commit: (message: string) => Promise<string>;
  push: () => Promise<string>;
  pull: () => Promise<string>;
}

export const useGit = create<GitState>()((set, get) => ({
  info: null,
  entries: [],
  log: [],
  loading: false,
  error: null,
  refresh: async () => {
    const root = useProject.getState().root;
    if (!root) {
      set({ info: null, entries: [], log: [], error: null });
      return;
    }
    set({ loading: true });
    try {
      const info = await ipc.gitInfo(root);
      if (!info.repo) {
        set({ info, entries: [], log: [], loading: false, error: null });
        return;
      }
      const gr = info.root ?? root;
      const entries = await ipc.gitStatus(gr);
      set({ info, entries, loading: false, error: null });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },
  refreshLog: async () => {
    const info = get().info;
    if (!info?.repo || !info.root) {
      set({ log: [] });
      return;
    }
    try {
      const log = await ipc.gitLog(info.root, 40);
      set({ log });
    } catch {
      set({ log: [] });
    }
  },
  stage: async (paths) => {
    const info = get().info;
    if (!info?.root || !paths.length) return;
    await ipc.gitStage(info.root, paths);
    await get().refresh();
  },
  unstage: async (paths) => {
    const info = get().info;
    if (!info?.root || !paths.length) return;
    await ipc.gitUnstage(info.root, paths);
    await get().refresh();
  },
  commit: async (message) => {
    const info = get().info;
    if (!info?.root) throw new Error("Not a Git repository");
    const result = await ipc.gitCommit(info.root, message);
    await get().refresh();
    await get().refreshLog();
    return result;
  },
  push: async () => {
    const info = get().info;
    if (!info?.root) throw new Error("Not a Git repository");
    const result = await ipc.gitPush(info.root);
    await get().refresh();
    await get().refreshLog();
    return result || "Pushed";
  },
  pull: async () => {
    const info = get().info;
    if (!info?.root) throw new Error("Not a Git repository");
    const result = await ipc.gitPull(info.root);
    await get().refresh();
    await get().refreshLog();
    return result || "Up to date";
  },
}));

let pollTimer: number | null = null;
let lastPoll = 0;

/**
 * Refresh on project switch and then keep the branch/status strip current.
 * Respects 设置 › 版本控制: `gitEnabled === false` pauses polling (manual
 * refresh still works), and `gitPollMs` controls the interval.
 */
export function startGitPolling(): void {
  void useGit.getState().refresh();
  lastPoll = Date.now();
  if (pollTimer !== null) return;
  pollTimer = window.setInterval(() => {
    const settings = useSettings.getState().settings;
    if (settings.gitEnabled === false) return;
    const interval = Math.max(1000, settings.gitPollMs ?? 4000);
    if (Date.now() - lastPoll < interval) return;
    lastPoll = Date.now();
    if (useProject.getState().root) void useGit.getState().refresh();
  }, 500);
}

export function stopGitPolling(): void {
  if (pollTimer !== null) window.clearInterval(pollTimer);
  pollTimer = null;
}
