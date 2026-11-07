/**
 * Overlay host state: one modal-ish overlay at a time (Search Everywhere,
 * Go to Line, Settings, About, input dialogs). Tool windows and menus are not
 * overlays.
 */
import { create } from "zustand";

export type Overlay =
  | { type: "searchEverywhere"; tab?: "all" | "files" | "actions" }
  | { type: "gotoLine" }
  | { type: "settings"; page?: string }
  | { type: "about" }
  | { type: "newFile"; dir: string }
  | { type: "newDir"; dir: string }
  | { type: "rename"; path: string; isDir: boolean }
  | { type: "runConfigPicker"; mode?: "run" | "debug" }
  | { type: "interpreterPicker" }
  | { type: "diff"; path: string; relPath: string; staged: boolean }
  | { type: "clone" }
  | { type: "newProject" }
  | { type: "renameProject" }
  | { type: "fileProperties" }
  | { type: "recentLocations" }
  | { type: "breakpointsViewer" }
  | { type: "moveFile"; path: string }
  | { type: "copyFile"; path: string }
  | { type: "quickInfo"; title: string; text: string };

interface OverlayState {
  current: Overlay | null;
  open: (overlay: Overlay) => void;
  close: () => void;
}

export const useOverlay = create<OverlayState>()((set) => ({
  current: null,
  open: (current) => set({ current }),
  close: () => set({ current: null }),
}));

export function isOverlayOpen(): boolean {
  return useOverlay.getState().current !== null;
}
