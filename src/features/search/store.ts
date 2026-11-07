/**
 * Find in Files tool window state.
 */
import { create } from "zustand";
import { ipc, type SearchOutcome } from "../../platform/ipc";
import { useProject } from "../../platform/project";

interface FindState {
  query: string;
  caseSensitive: boolean;
  regexMode: boolean;
  searching: boolean;
  outcome: SearchOutcome | null;
  error: string | null;
  setQuery: (q: string) => void;
  toggleCase: () => void;
  toggleRegex: () => void;
  run: () => Promise<void>;
}

export const useFind = create<FindState>()((set, get) => ({
  query: "",
  caseSensitive: false,
  regexMode: false,
  searching: false,
  outcome: null,
  error: null,
  setQuery: (q) => set({ query: q }),
  toggleCase: () => set((s) => ({ caseSensitive: !s.caseSensitive })),
  toggleRegex: () => set((s) => ({ regexMode: !s.regexMode })),
  run: async () => {
    const { query, caseSensitive, regexMode } = get();
    const root = useProject.getState().root;
    if (!root || !query) {
      set({ outcome: null, error: null });
      return;
    }
    set({ searching: true, error: null });
    try {
      const outcome = await ipc.searchInFiles(root, query, { caseSensitive, regexMode });
      set({ outcome, searching: false });
    } catch (e) {
      set({ error: String(e), searching: false, outcome: null });
    }
  },
}));
