/**
 * Project state: the open project root, its display bits, and recents.
 * `null` root ⇒ the Welcome screen is shown.
 */
import { create } from "zustand";
import { ipc } from "./ipc";
import { useSettings } from "./settings";
import { pathBase } from "./paths";

interface ProjectState {
  root: string | null;
  name: string | null;
  /** Monotonic token bumped on open/close; features use it to reset. */
  generation: number;
  open: (path: string) => Promise<void>;
  close: () => Promise<void>;
  refreshRecents: () => Promise<void>;
  recents: string[];
}

export const useProject = create<ProjectState>()((set, get) => ({
  root: null,
  name: null,
  generation: 0,
  recents: [],
  open: async (path) => {
    const stat = await ipc.fsStat(path);
    if (!stat.exists || stat.kind !== "dir") return;
    if (useSettings.getState().settings.recordRecents !== false) {
      try {
        await ipc.addRecentProject(path);
      } catch {
        // Non-fatal.
      }
    }
    set((s) => ({
      root: path,
      name: pathBase(path),
      generation: s.generation + 1,
    }));
    await get().refreshRecents();
  },
  close: async () => {
    set((s) => ({ root: null, name: null, generation: s.generation + 1 }));
  },
  refreshRecents: async () => {
    try {
      const recents = await ipc.recentProjects();
      set({ recents: recents.map((r) => r.path) });
    } catch {
      // Non-fatal.
    }
  },
}));
