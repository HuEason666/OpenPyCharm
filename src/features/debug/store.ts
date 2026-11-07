/**
 * Debug session state: debugpy adapter lifecycle (DAP), breakpoints, stack
 * frames, scopes/variables and console output.
 */
import { create } from "zustand";
import { message } from "@tauri-apps/plugin-dialog";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { ipc, listenDapExit, listenDapMessage } from "../../platform/ipc";
import { useProject } from "../../platform/project";
import { usePython } from "../python/store";
import { editorViewFor } from "../../editor/EditorArea";
import { revealInEditor } from "../../editor/reveal";
import { DapClient, type DapFrame, type DapScope, type DapThread, type DapVariable } from "./dap";
import {
  allBreakpoints,
  getBreakpoints,
  onBreakpointsChange,
  showDebugLine,
  toggleBreakpoint,
} from "./breakpoints";

export type DebugStatus = "idle" | "starting" | "running" | "paused" | "exited" | "error";

interface DebugState {
  status: DebugStatus;
  program: string | null;
  error: string | null;
  output: string[];
  threads: DapThread[];
  frames: DapFrame[];
  selectedFrame: number | null;
  scopes: DapScope[];
  variables: Record<number, DapVariable[]>;
  expanded: number[];
  start: (program: string) => Promise<void>;
  stop: () => Promise<void>;
  resume: () => void;
  pause: () => void;
  stepOver: () => void;
  stepInto: () => void;
  stepOut: () => void;
  selectFrame: (frameId: number) => void;
  toggleVariable: (ref: number) => void;
  evaluate: (expression: string) => Promise<string>;
  clearOutput: () => void;
}

let sessionId: number | null = null;
let client: DapClient | null = null;
let unlistenMessage: UnlistenFn | null = null;
let unlistenExit: UnlistenFn | null = null;
let offBreakpoints: (() => void) | null = null;
let activeThreadId: number | null = null;
let currentLine: { path: string; line: number } | null = null;

const dirname = (path: string): string => {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index > 0 ? path.slice(0, index) : ".";
};

function clearLine(): void {
  if (currentLine) showDebugLine(editorViewFor(currentLine.path), null);
  currentLine = null;
}

function showFrameLine(frame: DapFrame): void {
  const path = frame.source?.path;
  if (!path) return;
  clearLine();
  currentLine = { path, line: frame.line };
  revealInEditor(path, frame.line, frame.column || 1);
  setTimeout(() => showDebugLine(editorViewFor(path), frame.line), 80);
}

async function sendBreakpointsFor(path: string): Promise<void> {
  if (!client) return;
  const lines = [...getBreakpoints(path)].sort((a, b) => a - b);
  try {
    await client.request("setBreakpoints", {
      source: { path },
      breakpoints: lines.map((line) => ({ line })),
      sourceModified: false,
    });
  } catch {
    // The session may be shutting down.
  }
}

async function refreshAllBreakpoints(): Promise<void> {
  const paths = new Set(allBreakpoints().map((b) => b.path));
  for (const path of paths) await sendBreakpointsFor(path);
}

function teardown(): void {
  unlistenMessage?.();
  unlistenMessage = null;
  unlistenExit?.();
  unlistenExit = null;
  offBreakpoints?.();
  offBreakpoints = null;
  client?.dispose();
  client = null;
  if (sessionId !== null) {
    void ipc.bridgeStop(sessionId).catch(() => {});
    sessionId = null;
  }
  activeThreadId = null;
  clearLine();
}

export const useDebug = create<DebugState>()((set, get) => {
  const append = (text: string) => {
    if (!text) return;
    set((s) => ({ output: [...s.output, text].slice(-4000) }));
  };

  const loadScopes = async (frame: DapFrame): Promise<void> => {
    const dap = client;
    if (!dap) return;
    try {
      const response = await dap.request<{ scopes: DapScope[] }>("scopes", { frameId: frame.id });
      if (client !== dap) return;
      const scopes = response.scopes ?? [];
      const variables: Record<number, DapVariable[]> = {};
      for (const scope of scopes) {
        if (!scope.variablesReference) continue;
        try {
          const vars = await dap.request<{ variables: DapVariable[] }>("variables", {
            variablesReference: scope.variablesReference,
          });
          variables[scope.variablesReference] = vars.variables ?? [];
        } catch {
          variables[scope.variablesReference] = [];
        }
      }
      if (client !== dap) return;
      set({
        scopes,
        variables,
        expanded: scopes.map((s) => s.variablesReference).filter((r) => r > 0),
      });
    } catch {
      if (client === dap) set({ scopes: [], variables: {}, expanded: [] });
    }
  };

  const selectFrame = (frameId: number): void => {
    const frame = get().frames.find((f) => f.id === frameId);
    if (!frame) return;
    set({ selectedFrame: frameId, scopes: [], variables: {}, expanded: [] });
    showFrameLine(frame);
    void loadScopes(frame);
  };

  const registerHandlers = (dap: DapClient): void => {
    dap.on("initialized", () => {
      void (async () => {
        await refreshAllBreakpoints();
        try {
          await dap.request("configurationDone", {});
        } catch {
          // adapter will report a launch error
        }
      })();
    });
    dap.on("stopped", (body) => {
      const stopped = body as { threadId?: number };
      activeThreadId = stopped.threadId ?? null;
      void (async () => {
        if (!client) return;
        set({ status: "paused" });
        try {
          const threads = await dap.request<{ threads: DapThread[] }>("threads", {});
          if (client !== dap) return;
          set({ threads: threads.threads ?? [] });
          activeThreadId = stopped.threadId ?? threads.threads?.[0]?.id ?? null;
          if (activeThreadId === null) return;
          const stack = await dap.request<{ stackFrames: DapFrame[] }>("stackTrace", {
            threadId: activeThreadId,
            startFrame: 0,
            levels: 50,
          });
          if (client !== dap) return;
          const frames = stack.stackFrames ?? [];
          set({ frames });
          if (frames[0]) selectFrame(frames[0].id);
        } catch (e) {
          append(`[debug] ${String(e)}\n`);
        }
      })();
    });
    dap.on("continued", () => {
      set({ status: "running", frames: [], scopes: [], variables: {}, selectedFrame: null });
      clearLine();
    });
    dap.on("output", (body) => {
      const output = body as { category?: string; output?: string };
      if (output.category === "telemetry") return;
      append(output.output ?? "");
    });
    const finished = () => {
      if (get().status === "exited") return;
      teardown();
      set({ status: "exited", frames: [], scopes: [], variables: {}, selectedFrame: null });
    };
    dap.on("terminated", finished);
    dap.on("exited", finished);
  };

  return {
    status: "idle",
    program: null,
    error: null,
    output: [],
    threads: [],
    frames: [],
    selectedFrame: null,
    scopes: [],
    variables: {},
    expanded: [],

    start: async (program) => {
      const root = useProject.getState().root;
      if (!root) return;
      if (["starting", "running", "paused"].includes(get().status)) await get().stop();
      const python = usePython.getState().selected?.path ?? "python";
      set({
        status: "starting",
        program,
        error: null,
        output: [],
        threads: [],
        frames: [],
        selectedFrame: null,
        scopes: [],
        variables: {},
        expanded: [],
      });
      clearLine();

      const hasDebugpy = await ipc.pythonHasModule(python, "debugpy").catch(() => false);
      if (!hasDebugpy) {
        const text = `debugpy is not installed for:\n${python}\n\nInstall it with:\n${python} -m pip install debugpy`;
        set({ status: "error", error: text });
        await message(text, { title: "Debug", kind: "error" });
        return;
      }

      try {
        sessionId = await ipc.bridgeSpawn({
          kind: "dap",
          program: python,
          args: ["-m", "debugpy.adapter"],
          cwd: root,
          pathPrepend: dirname(python),
        });
      } catch (e) {
        set({ status: "error", error: String(e) });
        await message(String(e), { title: "Debug", kind: "error" });
        return;
      }

      const dap = new DapClient((text) => {
        if (sessionId !== null) void ipc.bridgeSend(sessionId, text).catch(() => {});
      });
      client = dap;
      registerHandlers(dap);
      unlistenMessage = await listenDapMessage((e) => {
        if (e.id === sessionId) dap.handle(e.message);
      });
      unlistenExit = await listenDapExit((e) => {
        if (e.id !== sessionId) return;
        teardown();
        set({ status: "exited" });
      });
      offBreakpoints = onBreakpointsChange((path) => {
        void sendBreakpointsFor(path);
      });

      try {
        await dap.request("initialize", {
          clientID: "openpycharm",
          adapterID: "python",
          linesStartAt1: true,
          columnsStartAt1: true,
          pathFormat: "path",
        });
        const launch = dap.request("launch", {
          name: "OpenPyCharm",
          type: "python",
          request: "launch",
          program,
          cwd: root,
          args: [],
          console: "internalConsole",
          justMyCode: true,
          python,
        });
        void launch
          .then(() => {
            if (get().status === "starting") set({ status: "running" });
          })
          .catch((e) => {
            set({ status: "error", error: String(e) });
            append(`[debug] ${String(e)}\n`);
          });
      } catch (e) {
        teardown();
        set({ status: "error", error: String(e) });
        await message(String(e), { title: "Debug", kind: "error" });
      }
    },

    stop: async () => {
      const dap = client;
      if (dap) {
        if (["starting", "running", "paused"].includes(get().status)) {
          try {
            await dap.request("disconnect", { terminateDebuggee: true });
          } catch {
            // already gone
          }
        }
      }
      teardown();
      set({ status: "exited", frames: [], scopes: [], variables: {}, selectedFrame: null });
    },

    resume: () => {
      if (!client || activeThreadId === null) return;
      set({ status: "running" });
      clearLine();
      void client.request("continue", { threadId: activeThreadId }).catch(() => {});
    },
    pause: () => {
      if (!client || activeThreadId === null) return;
      void client.request("pause", { threadId: activeThreadId }).catch(() => {});
    },
    stepOver: () => {
      if (!client || activeThreadId === null) return;
      set({ status: "running" });
      clearLine();
      void client.request("next", { threadId: activeThreadId }).catch(() => {});
    },
    stepInto: () => {
      if (!client || activeThreadId === null) return;
      set({ status: "running" });
      clearLine();
      void client.request("stepIn", { threadId: activeThreadId }).catch(() => {});
    },
    stepOut: () => {
      if (!client || activeThreadId === null) return;
      set({ status: "running" });
      clearLine();
      void client.request("stepOut", { threadId: activeThreadId }).catch(() => {});
    },
    selectFrame,
    toggleVariable: (ref) => {
      if (!client || !ref) return;
      if (get().variables[ref]) {
        set((s) => ({
          expanded: s.expanded.includes(ref) ? s.expanded.filter((r) => r !== ref) : [...s.expanded, ref],
        }));
        return;
      }
      const dap = client;
      void dap
        .request<{ variables: DapVariable[] }>("variables", { variablesReference: ref })
        .then((response) => {
          if (client !== dap) return;
          set((s) => ({
            variables: { ...s.variables, [ref]: response.variables ?? [] },
            expanded: [...s.expanded, ref],
          }));
        })
        .catch(() => {});
    },
    evaluate: async (expression) => {
      const dap = client;
      if (!dap) return "";
      const frameId = get().selectedFrame ?? undefined;
      try {
        const response = await dap.request<{ result: string }>("evaluate", {
          expression,
          frameId,
          context: "repl",
        });
        const result = response.result ?? "";
        append(`> ${expression}\n${result}\n`);
        return result;
      } catch (e) {
        append(`> ${expression}\n${String(e)}\n`);
        return String(e);
      }
    },
    clearOutput: () => set({ output: [] }),
  };
});

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__opcDebug = {
    status: () => useDebug.getState().status,
    frames: () => useDebug.getState().frames,
    scopes: () => useDebug.getState().scopes,
    variables: () => useDebug.getState().variables,
    output: () => useDebug.getState().output.join(""),
    toggleBreakpoint: (path: string, line: number) => toggleBreakpoint(path, line),
    breakpoints: () => allBreakpoints(),
    start: (program: string) => useDebug.getState().start(program),
    resume: () => useDebug.getState().resume(),
    stepOver: () => useDebug.getState().stepOver(),
    stop: () => useDebug.getState().stop(),
  };
}
