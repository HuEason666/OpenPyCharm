/**
 * Python SDK state: interpreter discovery + per-project selection.
 */
import { create } from "zustand";
import { ipc, type PythonSdk } from "../../platform/ipc";
import { useProject } from "../../platform/project";
import { useSettings } from "../../platform/settings";

interface PythonState {
  sdks: PythonSdk[];
  selected: PythonSdk | null;
  detecting: boolean;
  detect: (force?: boolean) => Promise<void>;
  select: (path: string) => Promise<void>;
}

export const usePython = create<PythonState>()((set, get) => ({
  sdks: [],
  selected: null,
  detecting: false,
  detect: async (force) => {
    if (get().detecting && !force) return;
    set({ detecting: true });
    try {
      const root = useProject.getState().root;
      const sdks = await ipc.sdkDetect(root);
      const saved = root ? useSettings.getState().settings.interpreter[root] : undefined;
      const selected = sdks.find((s) => s.path === saved) ?? sdks[0] ?? null;
      set({ sdks, selected });
    } catch {
      set({ sdks: [], selected: null });
    } finally {
      set({ detecting: false });
    }
  },
  select: async (path) => {
    const sdk = get().sdks.find((s) => s.path === path) ?? null;
    set({ selected: sdk });
    const root = useProject.getState().root;
    if (root) {
      await useSettings.getState().setProjectInterpreter(root, path);
      // Pyright was spawned with the old interpreter — restart it so new
      // completions/imports resolve against the new environment. 省电模式下
      // 不启动语言服务。Dynamic import keeps this module free of a static
      // lsp.ts dependency.
      if (useSettings.getState().settings.powerSave !== true) {
        const { restartLsp } = await import("../../platform/lsp");
        void restartLsp(root, path).catch(() => {});
      }
    }
  },
}));
