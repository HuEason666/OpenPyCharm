/**
 * Terminal tool window: xterm.js over a ConPTY session from the backend.
 * Multiple sessions; "Local" tabs with a + button, like the reference IDE.
 */
import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Icon } from "../../ui/icons";
import { ipc, listenTermExit, listenTermOut } from "../../platform/ipc";
import { useProject } from "../../platform/project";
import { useSettings } from "../../platform/settings";
import styles from "./TerminalView.module.css";

/** Shell from 设置 › 工具 › 终端; empty string lets the backend pick COMSPEC. */
function useShellSetting(): string | null {
  const shell = useSettings.getState().settings.terminalShell;
  return shell && shell.trim() ? shell.trim() : null;
}

interface TermSession {
  id: number;
  name: string;
}

interface TerminalState {
  sessions: TermSession[];
  activeId: number | null;
}

let seq = 0;

const sessions: TermSession[] = [];
const terms = new Map<number, Terminal>();
const fitAddons = new Map<number, FitAddon>();
let activeId: number | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

export function useTerminalStore(): TerminalState {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return { sessions: [...sessions], activeId };
}

export function setActiveTerminal(id: number): void {
  activeId = id;
  notify();
}

export async function newTerminal(): Promise<number> {
  const root = useProject.getState().root;
  const shell = useShellSetting();
  const handle = await ipc.termSpawn({ shell, cwd: root, rows: 30, cols: 120 });
  seq += 1;
  const session: TermSession = { id: handle.id, name: `Local ${seq}` };
  sessions.push(session);
  activeId = handle.id;
  notify();
  return handle.id;
}

/** 工具 › Python 控制台：用项目解释器起一个交互式 REPL 会话。 */
export async function newPythonConsole(python: string): Promise<number> {
  const root = useProject.getState().root;
  const handle = await ipc.termSpawn({ shell: python, cwd: root, rows: 30, cols: 120 });
  seq += 1;
  const session: TermSession = { id: handle.id, name: `Python ${seq}` };
  sessions.push(session);
  activeId = handle.id;
  notify();
  return handle.id;
}

/** Guard so concurrent auto-boot (StrictMode double-mount) creates one session. */
let bootPromise: Promise<unknown> | null = null;

export function ensureTerminal(): Promise<unknown> {
  if (!bootPromise) {
    bootPromise = newTerminal().finally(() => {
      bootPromise = null;
    });
  }
  return bootPromise;
}

export async function killTerminal(id: number): Promise<void> {
  const idx = sessions.findIndex((s) => s.id === id);
  if (idx >= 0) sessions.splice(idx, 1);
  terms.get(id)?.dispose();
  terms.delete(id);
  fitAddons.delete(id);
  try {
    await ipc.termKill(id);
  } catch {
    // already gone
  }
  if (activeId === id) activeId = sessions[sessions.length - 1]?.id ?? null;
  notify();
}

/** Install global backend → xterm piping once. Returns a disposer. */
export function installTerminalPiping(): () => void {
  const un1 = listenTermOut((e) => {
    const term = terms.get(e.id);
    if (!term) return;
    const bytes = Uint8Array.from(atob(e.data), (c) => c.charCodeAt(0));
    term.write(bytes);
  });
  const un2 = listenTermExit((e) => {
    const term = terms.get(e.id);
    if (term) {
      term.write("\r\n\x1b[90m[Process exited]\x1b[0m\r\n");
    }
  });
  return () => {
    void un1.then((un) => un());
    void un2.then((un) => un());
  };
}

export function TerminalView() {
  const { sessions: list, activeId: active } = useTerminalStore();
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!list.length && !cancelled) {
        await ensureTerminal();
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mount the active xterm instance into the host.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || active === null) return;
    let term = terms.get(active);
    if (!term) {
      term = new Terminal({
        fontFamily: "var(--font-mono)",
        fontSize: 13,
        convertEol: false,
        cursorBlink: true,
        theme: {
          background: "#191a1c",
          foreground: "#d1d3d9",
          cursor: "#ced0d6",
          selectionBackground: "#214283",
          black: "#000000",
          red: "#f57e84",
          green: "#6aab73",
          yellow: "#d59637",
          blue: "#548af7",
          magenta: "#c77dbb",
          cyan: "#2aacb8",
          white: "#dfe1e5",
          brightBlack: "#8c8f95",
          brightRed: "#fa6675",
          brightGreen: "#73bd79",
          brightYellow: "#f2c55c",
          brightBlue: "#71a1fe",
          brightMagenta: "#e26fd2",
          brightCyan: "#56a8f5",
          brightWhite: "#ffffff",
        },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(host);
      terms.set(active, term);
      fitAddons.set(active, fit);
      term.onData((data) => {
        const b64 = btoa(
          Array.from(new TextEncoder().encode(data))
            .map((b) => String.fromCharCode(b))
            .join(""),
        );
        void ipc.termWrite(active, b64);
      });
      fit.fit();
    } else {
      host.appendChild(term.element!);
      fitAddons.get(active)?.fit();
    }
    const ro = new ResizeObserver(() => {
      const t = terms.get(active);
      const fit = fitAddons.get(active);
      if (t && fit && host.clientWidth > 0) {
        fit.fit();
        void ipc.termResize(active, t.rows, t.cols).catch(() => {});
      }
    });
    ro.observe(host);
    term.focus();
    return () => {
      ro.disconnect();
      if (term && term.element && term.element.parentNode === host) {
        host.removeChild(term.element);
      }
    };
  }, [active]);

  return (
    <div className={styles.term}>
      <div className={styles.tabsRow}>
        {list.map((s) => (
          <button
            key={s.id}
            type="button"
            className={styles.termTab}
            data-active={s.id === active}
            onClick={() => setActiveTerminal(s.id)}
          >
            {s.name}
          </button>
        ))}
        <button
          type="button"
          className={styles.iconButton}
          title="New Terminal (Ctrl+Shift+T)"
          onClick={() => void newTerminal()}
        >
          <Icon name="plus" size={14} />
        </button>
        {list.length ? (
          <button
            type="button"
            className={styles.iconButton}
            title="Kill Terminal"
            disabled={active === null}
            onClick={() => active !== null && void killTerminal(active)}
          >
            <Icon name="trash" size={14} />
          </button>
        ) : null}
      </div>
      <div className={styles.host} ref={hostRef} />
    </div>
  );
}
