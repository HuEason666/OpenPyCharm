/**
 * Action registry — "everything is an action", modeled on IntelliJ's
 * ActionManager. Menus, the keymap dispatcher, toolbar buttons, context menus
 * and Search Everywhere all resolve through this one registry.
 */
import { create } from "zustand";

export interface ActionContext {
  /** Absolute path of the open project root, or null on the Welcome screen. */
  projectRoot: string | null;
  /** Id of the active document, if any. */
  activeDoc: string | null;
  /** True when the CodeMirror editor has focus. */
  editorFocus: boolean;
  /** True when a tool window body has focus. */
  toolWindowFocus: boolean;
  /** Current run session, if any. */
  runningRun: number | null;
}

export interface Action {
  id: string;
  title: string;
  category?: string;
  icon?: string;
  /** When-clause evaluated against the context; falsy disables the action. */
  when?: (ctx: ActionContext) => boolean;
  run: (arg?: unknown) => void | Promise<void>;
}

interface ActionsState {
  actions: Map<string, Action>;
  register: (action: Action) => () => void;
  registerAll: (actions: Action[]) => () => void;
}

export const useActions = create<ActionsState>()((set) => ({
  actions: new Map(),
  register: (action) => {
    set((s) => {
      const next = new Map(s.actions);
      next.set(action.id, action);
      return { actions: next };
    });
    return () => {
      set((s) => {
        const next = new Map(s.actions);
        next.delete(action.id);
        return { actions: next };
      });
    };
  },
  registerAll: (actions) => {
    set((s) => {
      const next = new Map(s.actions);
      for (const a of actions) next.set(a.id, a);
      return { actions: next };
    });
    return () => {
      set((s) => {
        const next = new Map(s.actions);
        for (const a of actions) next.delete(a.id);
        return { actions: next };
      });
    };
  },
}));

export function getAction(id: string): Action | undefined {
  return useActions.getState().actions.get(id);
}

export async function executeAction(id: string, arg?: unknown): Promise<boolean> {
  const action = useActions.getState().actions.get(id);
  if (!action) return false;
  await action.run(arg);
  return true;
}
