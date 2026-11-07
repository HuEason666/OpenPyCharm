/**
 * Keymap: stroke matching on `event.code` (physical keys) + a capture-phase
 * dispatcher that resolves strokes to actions. `"Shift Shift"` = double-tap.
 */
import { create } from "zustand";
import { INTELLIJ_WINDOWS } from "./keymaps/intellij-windows";
import { executeAction, useActions, type ActionContext } from "./actions";
import { useProject } from "./project";
import { useDocs } from "../editor/docs";
import { useRun } from "../features/run/store";

export interface KeymapState {
  preset: string;
  overrides: Record<string, string[]>;
  setPreset: (preset: string) => void;
  setOverride: (actionId: string, strokes: string[] | null) => void;
}

export const useKeymap = create<KeymapState>()((set) => ({
  preset: "intellij-windows",
  overrides: {},
  setPreset: (preset) => set({ preset }),
  setOverride: (actionId, strokes) =>
    set((s) => {
      const next = { ...s.overrides };
      if (strokes === null) delete next[actionId];
      else next[actionId] = strokes;
      return { overrides: next };
    }),
}));

function bindingsFor(actionId: string): string[] {
  const { overrides } = useKeymap.getState();
  return overrides[actionId] ?? INTELLIJ_WINDOWS[actionId] ?? [];
}

/** First binding of an action, for menu hints ("Ctrl+Shift+N"). */
export function shortcutHint(actionId: string): string | null {
  const strokes = bindingsFor(actionId);
  if (!strokes.length) return null;
  return strokes[0].replace("Slash", "/").replace("Quote", "'").replace("Comma", ",");
}

/** Reverse map: stroke → action id. */
export function strokeIndex(): Map<string, string> {
  const map = new Map<string, string>();
  for (const [actionId] of useActions.getState().actions) {
    for (const stroke of bindingsFor(actionId)) {
      if (!map.has(stroke)) map.set(stroke, actionId);
    }
  }
  return map;
}

// --- stroke matching ---

const CODE_NAMES: Record<string, string> = {
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  ArrowDown: "Down",
  Escape: "Escape",
  Enter: "Enter",
  NumpadEnter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Space: "Space",
  Comma: "Comma",
  Period: "Period",
  Slash: "Slash",
  Backslash: "Backslash",
  Quote: "Quote",
  Semicolon: "Semicolon",
  BracketLeft: "BracketLeft",
  BracketRight: "BracketRight",
  Minus: "Minus",
  Equal: "Equal",
  IntlBackslash: "Backslash",
  ContextMenu: "ContextMenu",
};

function keyName(code: string): string | null {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (/^F\d{1,2}$/.test(code)) return code;
  if (code.startsWith("Numpad") && code.length > 6) return code.slice(6);
  return CODE_NAMES[code] ?? null;
}

export function strokeFromEvent(e: KeyboardEvent): string | null {
  const key = keyName(e.code);
  if (!key) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Meta");
  if ((key === "Shift" || key === "Ctrl" || key === "Alt" || key === "Meta") && parts.length <= 1) {
    // Bare modifier press: only meaningful as a double-tap candidate.
    return key;
  }
  parts.push(key);
  return parts.join("+");
}

// --- dispatcher ---

let lastShiftAt = 0;
let doubleShiftArmed = false;

function context(): ActionContext {
  const project = useProject.getState();
  const docs = useDocs.getState();
  const run = useRun.getState();
  return {
    projectRoot: project.root,
    activeDoc: docs.activeId,
    editorFocus: docs.editorFocused,
    toolWindowFocus: !docs.editorFocused,
    runningRun: run.sessions.find((s) => s.status === "running")?.id ?? null,
  };
}

function handleKey(e: KeyboardEvent) {
  // Double-tap Shift → Search Everywhere (no other keys in between).
  if ((e.code === "ShiftLeft" || e.code === "ShiftRight") && !e.ctrlKey && !e.altKey && !e.metaKey) {
    const now = performance.now();
    if (doubleShiftArmed && now - lastShiftAt < 350) {
      doubleShiftArmed = false;
      lastShiftAt = 0;
      e.preventDefault();
      e.stopPropagation();
      void executeAction("navigate.searchEverywhere");
      return;
    }
    lastShiftAt = now;
    doubleShiftArmed = true;
    setTimeout(() => {
      doubleShiftArmed = false;
    }, 400);
    return;
  }
  doubleShiftArmed = false;

  const stroke = strokeFromEvent(e);
  if (!stroke) return;
  const actionId = strokeIndex().get(stroke);
  if (!actionId) return;

  const action = useActions.getState().actions.get(actionId);
  if (!action) return;
  if (action.when && !action.when(context())) return;

  e.preventDefault();
  e.stopPropagation();
  void action.run();
}

/** Installs the global capture-phase key handler. Call once at boot. */
export function installKeyboardDispatcher(): void {
  window.addEventListener("keydown", handleKey, { capture: true });
  window.addEventListener(
    "keydown",
    (e) => {
      // Any non-modifier key press cancels double-shift arming.
      if (e.code !== "ShiftLeft" && e.code !== "ShiftRight") doubleShiftArmed = false;
    },
    { capture: true },
  );
}
