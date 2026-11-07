/**
 * Tool window layout store — a lean version of IDEA's tool window model:
 * one visible window per anchor (left/right/bottom), size tracks per anchor,
 * activation toggles visibility (hide on second activate = IDEA behavior).
 * Layout persists per project root in localStorage.
 */
import { create } from "zustand";
import type { JSX } from "react";
import { useProject } from "../../platform/project";

export type Anchor = "left" | "right" | "bottom";

export interface ToolWindowDef {
  id: string;
  title: string;
  icon: string;
  anchor: Anchor;
  order?: number;
  component: () => JSX.Element;
  /** Extra actions rendered in the tool window header (right side). */
  headerActions?: () => JSX.Element;
}

export interface LayoutState {
  visible: Record<Anchor, string | null>;
  sizes: Record<Anchor, number>;
  focused: string | null;
  register: (def: ToolWindowDef) => void;
  defs: Map<string, ToolWindowDef>;
  activate: (id: string) => void;
  show: (id: string) => void;
  hide: (id: string) => void;
  hideAll: () => void;
  hideActive: () => void;
  setFocused: (id: string | null) => void;
  setSize: (anchor: Anchor, px: number) => void;
}

const DEFAULT_SIZES: Record<Anchor, number> = { left: 240, right: 300, bottom: 280 };
const MIN_SIZES: Record<Anchor, number> = { left: 140, right: 160, bottom: 90 };

function storageKey(root: string | null): string {
  return `openpycharm.layout.v1:${root ?? "none"}`;
}

function loadPersisted(root: string | null): { visible?: Partial<Record<Anchor, string | null>>; sizes?: Partial<Record<Anchor, number>> } {
  try {
    const raw = localStorage.getItem(storageKey(root));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function persist(state: LayoutState, root: string | null): void {
  try {
    localStorage.setItem(
      storageKey(root),
      JSON.stringify({ visible: state.visible, sizes: state.sizes }),
    );
  } catch {
    // ignore quota errors
  }
}

export const useToolWindows = create<LayoutState>()((set, get) => ({
  defs: new Map(),
  visible: { left: "project", right: null, bottom: null },
  sizes: { ...DEFAULT_SIZES },
  focused: null,
  register: (def) => {
    set((s) => {
      const defs = new Map(s.defs);
      defs.set(def.id, def);
      return { defs };
    });
  },
  activate: (id) => {
    const { defs, visible } = get();
    const def = defs.get(id);
    if (!def) return;
    const anchor = def.anchor;
    if (visible[anchor] === id && get().focused === id) {
      get().hide(id);
    } else {
      get().show(id);
      set({ focused: id });
    }
  },
  show: (id) => {
    const { defs } = get();
    const def = defs.get(id);
    if (!def) return;
    set((s) => {
      const visible = { ...s.visible, [def.anchor]: id };
      return { visible, focused: id };
    });
    persist(get(), useProject.getState().root);
  },
  hide: (id) => {
    const { defs } = get();
    const def = defs.get(id);
    if (!def) return;
    set((s) => {
      const visible = { ...s.visible };
      if (visible[def.anchor] === id) visible[def.anchor] = null;
      const focused = s.focused === id ? null : s.focused;
      return { visible, focused };
    });
    persist(get(), useProject.getState().root);
  },
  hideAll: () => {
    set({ visible: { left: null, right: null, bottom: null }, focused: null });
    persist(get(), useProject.getState().root);
  },
  hideActive: () => {
    const focused = get().focused;
    if (focused) get().hide(focused);
  },
  setFocused: (id) => set({ focused: id }),
  setSize: (anchor, px) => {
    set((s) => {
      const sizes = { ...s.sizes, [anchor]: Math.max(MIN_SIZES[anchor], Math.round(px)) };
      return { sizes };
    });
    persist(get(), useProject.getState().root);
  },
}));

/** Restore the persisted layout when a project opens. */
export function restoreLayout(root: string | null): void {
  const saved = loadPersisted(root);
  const visible: Record<Anchor, string | null> = {
    left: saved.visible?.left ?? (root ? "project" : null),
    right: saved.visible?.right ?? null,
    bottom: saved.visible?.bottom ?? null,
  };
  const sizes = { ...DEFAULT_SIZES, ...(saved.sizes ?? {}) };
  zenSnapshot = null;
  useToolWindows.setState({ visible, sizes, focused: null });
}

// --- 禅模式（视图 › 外观）：隐藏全部工具窗口，再次执行恢复原布局 ---

let zenSnapshot: Record<Anchor, string | null> | null = null;

export function toggleZenMode(): void {
  const st = useToolWindows.getState();
  const anyVisible = Object.values(st.visible).some(Boolean);
  if (anyVisible) {
    zenSnapshot = { ...st.visible };
    st.hideAll();
  } else {
    const visible: Record<Anchor, string | null> =
      zenSnapshot ?? { left: useProject.getState().root ? "project" : null, right: null, bottom: null };
    zenSnapshot = null;
    useToolWindows.setState({ visible, focused: null });
    persist(useToolWindows.getState(), useProject.getState().root);
  }
}
