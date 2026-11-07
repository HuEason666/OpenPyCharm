/**
 * Settings — the single source of truth for user preferences, persisted via
 * the backend into the OS config directory. The schema lives here.
 */
import { create } from "zustand";
import { ipc } from "./ipc";

export type ThemeId = "dark" | "light";
export type MainMenuMode = "hamburger" | "merged";

export interface Settings {
  theme: ThemeId;
  fontSize: number; // editor font size, px
  /** Accent color override (hex); null/undefined = theme default. */
  accent?: string | null;
  /** Whole-UI zoom in percent (100 = default). */
  uiScale?: number;
  /** UI font size in px (base 13). */
  uiFontSize?: number;
  /** UI font family override; null = Inter Variable. */
  uiFontFamily?: string | null;
  /** Compact UI mode (data-compact in tokens.css). */
  compact?: boolean;
  /** Save all dirty editors when the window loses focus. */
  autosaveOnBlur?: boolean;
  /** Reopen the most recent project at startup. */
  reopenLastProject?: boolean;
  /** Shell executable for new terminal sessions; null = system default (COMSPEC). */
  terminalShell?: string | null;
  /** 主菜单形态：汉堡菜单按钮 / 合并菜单（常驻标题）。 */
  mainMenuMode?: MainMenuMode;
  /** Master switch for toast notifications. */
  notificationsEnabled?: boolean;
  /** Show a toast when a run session exits. */
  notifyRunFinish?: boolean;
  /** Git integration on/off (branch strip, status polling, VCS coloring). */
  gitEnabled?: boolean;
  /** Git working-tree poll interval in ms (min 1000). */
  gitPollMs?: number;
  /** Preferred Python formatter; "auto" tries ruff → black → autopep8. */
  formatter?: "auto" | "ruff" | "black" | "autopep8";
  /** Whether opening a project records it in the recents list. */
  recordRecents?: boolean;
  /** Per-project excluded directories: projectRoot → relative dir paths. */
  excludedDirs?: Record<string, string[]>;
  /** 省电模式：禁用语言服务（不启动 pyright、无诊断与补全）。 */
  powerSave?: boolean;
  /** 智能体：OpenAI 兼容接口配置。 */
  aiEndpoint?: string;
  aiApiKey?: string;
  aiModel?: string;
  interpreter: Record<string, string>; // projectRoot → python path
  recents: string[];
  runConfigOrder?: string[];
  [key: string]: unknown;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  fontSize: 13,
  accent: null,
  uiScale: 100,
  uiFontSize: 13,
  uiFontFamily: null,
  compact: false,
  autosaveOnBlur: true,
  reopenLastProject: false,
  terminalShell: null,
  mainMenuMode: "hamburger",
  notificationsEnabled: true,
  notifyRunFinish: true,
  gitEnabled: true,
  gitPollMs: 4000,
  formatter: "auto",
  recordRecents: true,
  excludedDirs: {},
  powerSave: false,
  aiEndpoint: "https://api.openai.com/v1",
  aiApiKey: "",
  aiModel: "gpt-4o-mini",
  interpreter: {},
  recents: [],
};

interface SettingsState {
  settings: Settings;
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<Settings>) => Promise<void>;
  setProjectInterpreter: (root: string, path: string) => Promise<void>;
}

export const useSettings = create<SettingsState>()((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  load: async () => {
    try {
      const raw = (await ipc.settingsGet()) as Partial<Settings> | null;
      const merged: Settings = { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
      if (!merged.interpreter) merged.interpreter = {};
      if (!merged.recents) merged.recents = [];
      if (!merged.excludedDirs) merged.excludedDirs = {};
      set({ settings: merged, loaded: true });
    } catch {
      set({ settings: DEFAULT_SETTINGS, loaded: true });
    }
  },
  update: async (patch) => {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    try {
      await ipc.settingsSet(next);
    } catch {
      // Non-fatal: keep the in-memory value.
    }
  },
  setProjectInterpreter: async (root, path) => {
    const next = { ...get().settings, interpreter: { ...get().settings.interpreter, [root]: path } };
    set({ settings: next });
    try {
      await ipc.settingsSet(next);
    } catch {
      // Non-fatal.
    }
  },
}));
