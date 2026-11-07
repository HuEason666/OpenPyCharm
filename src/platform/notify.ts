/**
 * Toast notifications — transient messages shown in the lower-right corner.
 * Master switch lives in 设置 › 通知 (settings.notificationsEnabled); callers
 * that should respect it check before pushing. The host component is mounted
 * in the Workbench and renders every queued toast regardless of source.
 */
import { create } from "zustand";
import { useSettings } from "./settings";

export type ToastKind = "info" | "success" | "error";

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

interface NotifyState {
  toasts: Toast[];
  push: (kind: ToastKind, text: string, ttlMs?: number) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;
const MAX_VISIBLE = 5;

export const useNotify = create<NotifyState>()((set, get) => ({
  toasts: [],
  push: (kind, text, ttlMs = 4500) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }].slice(-MAX_VISIBLE) }));
    window.setTimeout(() => get().dismiss(id), ttlMs);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Imperative helper so non-React modules (stores, listeners) can notify. */
export function notify(kind: ToastKind, text: string, ttlMs?: number): void {
  useNotify.getState().push(kind, text, ttlMs);
}

/** Whether the user allows notifications (设置 › 通知 master switch). */
export function notificationsAllowed(): boolean {
  return useSettings.getState().settings.notificationsEnabled !== false;
}
