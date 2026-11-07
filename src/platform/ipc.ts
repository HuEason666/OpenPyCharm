/**
 * Thin typed wrapper over Tauri IPC. Command names and payload casing match
 * the Rust side (`camelCase` serde renames).
 */
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen, type UnlistenFn } from "@tauri-apps/api/event";

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await tauriInvoke<T>(cmd, args);
  } catch (e) {
    // Tauri errors arrive as strings from our Rust layer.
    throw new Error(typeof e === "string" ? e : JSON.stringify(e));
  }
}

// --- types shared with the backend ---

export interface DirEntry {
  name: string;
  path: string;
  kind: "dir" | "file" | "symlink";
  size: number;
  mtimeMs: number;
}

export interface TextFile {
  text: string;
  size: number;
}

export interface StatInfo {
  exists: boolean;
  kind: "dir" | "file" | "none";
  size: number;
  mtimeMs: number;
}

export interface PythonSdk {
  path: string;
  version: string;
  kind: "system" | "py-launcher" | "venv" | "conda" | "conda-env" | "registry";
  name: string;
}

export interface GitInfo {
  repo: boolean;
  root: string | null;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
}

export interface GitEntry {
  path: string;
  relPath: string;
  index: string;
  worktree: string;
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  email: string;
  time: number;
  subject: string;
}

export interface LspSession {
  id: number;
  server: string;
}

export interface BridgeSpawnArgs {
  kind: "lsp" | "dap";
  program: string;
  args: string[];
  cwd?: string | null;
  pathPrepend?: string | null;
}

export interface SearchMatch {
  line: number;
  col: number;
  len: number;
  text: string;
}

export interface SearchFileResult {
  path: string;
  matches: SearchMatch[];
}

export interface SearchOutcome {
  results: SearchFileResult[];
  truncated: boolean;
  searchedFiles: number;
}

export interface RunStartArgs {
  exe: string;
  args: string[];
  cwd: string;
  env?: Record<string, string> | null;
}

export interface RunHandle {
  id: number;
}

export interface TermHandle {
  id: number;
}

// --- commands ---

export const ipc = {
  // fs
  fsReadDir: (path: string) => call<DirEntry[]>("fs_read_dir", { path }),
  fsReadText: (path: string, maxBytes?: number) => call<TextFile>("fs_read_text", { path, maxBytes }),
  fsWriteText: (path: string, text: string) => call<void>("fs_write_text", { path, text }),
  fsCreateFile: (path: string, contents?: string) => call<void>("fs_create_file", { path, contents }),
  fsCreateDir: (path: string) => call<void>("fs_create_dir", { path }),
  fsRename: (from: string, to: string) => call<void>("fs_rename", { from, to }),
  fsDelete: (path: string, recursive?: boolean) => call<void>("fs_delete", { path, recursive }),
  fsStat: (path: string) => call<StatInfo>("fs_stat", { path }),
  fsExists: (path: string) => call<boolean>("fs_exists", { path }),
  fsRevealInShell: (path: string) => call<void>("fs_reveal_in_shell", { path }),
  findFiles: (root: string, pattern?: string, limit?: number) =>
    call<string[]>("find_files", { root, pattern: pattern ?? null, limit: limit ?? 2000 }),
  // search
  searchInFiles: (root: string, query: string, opts?: { caseSensitive?: boolean; regexMode?: boolean; fileGlob?: string }) =>
    call<SearchOutcome>("search_in_files", {
      root,
      query,
      caseSensitive: opts?.caseSensitive ?? false,
      regexMode: opts?.regexMode ?? false,
      fileGlob: opts?.fileGlob ?? null,
    }),
  // python
  sdkDetect: (projectRoot?: string | null) => call<PythonSdk[]>("sdk_detect", { projectRoot: projectRoot ?? null }),
  pythonFormat: (python: string, path: string, text: string, formatter?: string | null) =>
    call<string>("python_format", { python, path, text, formatter: formatter ?? null }),
  pythonHasModule: (python: string, module: string) =>
    call<boolean>("python_has_module", { python, module }),
  pythonOrganizeImports: (python: string, path: string, text: string) =>
    call<string>("python_organize_imports", { python, path, text }),
  fsCreateScratch: (ext?: string) => call<string>("fs_create_scratch", { ext: ext ?? null }),
  fsUserHome: () => call<string>("fs_user_home"),
  uvDetect: () => call<string | null>("uv_detect"),
  pythonCreateVenv: (python: string, dir: string) => call<void>("python_create_venv", { python, dir }),
  uvCreateVenv: (uv: string, dir: string) => call<void>("uv_create_venv", { uv, dir }),
  condaCreateEnv: (python: string, dir: string, version?: string | null) =>
    call<void>("conda_create_env", { python, dir, version: version ?? null }),
  aiChat: (
    endpoint: string,
    apiKey: string,
    model: string,
    messages: Array<{
      role: string;
      content:
        | string
        | Array<{ type: string; text?: string; image_url?: { url: string } }>;
    }>,
  ) => call<string>("ai_chat", { endpoint, apiKey, model, messages }),
  aiImageDataUrl: (path: string) => call<string>("ai_image_data_url", { path }),
  dbTables: (path: string) =>
    call<Array<{ name: string; kind: string }>>("db_tables", { path }),
  dbQuery: (path: string, sql: string, limit?: number) =>
    call<{ columns: string[]; rows: Array<Array<unknown>>; truncated: boolean }>("db_query", {
      path,
      sql,
      limit: limit ?? null,
    }),
  dbMysqlDatabases: (conn: { host: string; port: number; user: string; password: string; database: string }) =>
    call<string[]>("db_mysql_databases", { conn }),
  dbMysqlTables: (conn: { host: string; port: number; user: string; password: string; database: string }) =>
    call<Array<{ name: string; kind: string }>>("db_mysql_tables", { conn }),
  dbMysqlQuery: (
    conn: { host: string; port: number; user: string; password: string; database: string },
    sql: string,
    limit?: number,
  ) =>
    call<{ columns: string[]; rows: Array<Array<unknown>>; truncated: boolean }>("db_mysql_query", {
      conn,
      sql,
      limit: limit ?? null,
    }),
  dbPgDatabases: (conn: { host: string; port: number; user: string; password: string; database: string }) =>
    call<string[]>("db_pg_databases", { conn }),
  dbPgTables: (conn: { host: string; port: number; user: string; password: string; database: string }) =>
    call<Array<{ name: string; kind: string }>>("db_pg_tables", { conn }),
  dbPgQuery: (
    conn: { host: string; port: number; user: string; password: string; database: string },
    sql: string,
    limit?: number,
  ) =>
    call<{ columns: string[]; rows: Array<Array<unknown>>; truncated: boolean }>("db_pg_query", {
      conn,
      sql,
      limit: limit ?? null,
    }),
  // git
  gitInfo: (root: string) => call<GitInfo>("git_info", { root }),
  gitStatus: (root: string) => call<GitEntry[]>("git_status", { root }),
  gitDiff: (root: string, path: string, staged: boolean) =>
    call<string>("git_diff", { root, path, staged }),
  gitShow: (root: string, path: string, source: "head" | "index") =>
    call<string>("git_show", { root, path, source }),
  gitLog: (root: string, limit?: number) => call<GitCommit[]>("git_log", { root, limit: limit ?? 30 }),
  gitStage: (root: string, paths: string[]) => call<void>("git_stage", { root, paths }),
  gitRestore: (root: string, paths: string[]) => call<void>("git_restore", { root, paths }),
  gitInit: (path: string) => call<void>("git_init", { path }),
  gitUnstage: (root: string, paths: string[]) => call<void>("git_unstage", { root, paths }),
  gitCommit: (root: string, message: string) => call<string>("git_commit", { root, message }),
  gitPush: (root: string) => call<string>("git_push", { root }),
  gitPull: (root: string) => call<string>("git_pull", { root }),
  gitClone: (url: string, dir: string) => call<string>("git_clone", { url, dir }),
  // language server / debug adapter
  lspStart: (root: string, python?: string | null) =>
    call<LspSession>("lsp_start", { root, python: python ?? null }),
  bridgeSpawn: (args: BridgeSpawnArgs) => call<number>("bridge_spawn", { args }),
  bridgeSend: (id: number, message: string) => call<void>("bridge_send", { id, message }),
  bridgeStop: (id: number) => call<void>("bridge_stop", { id }),
  // file watching
  watchStart: (root: string) => call<number>("watch_start", { args: { root } }),
  watchStop: (id: number) => call<void>("watch_stop", { id }),
  // run
  runStart: (args: RunStartArgs) => call<RunHandle>("run_start", { args }),
  runStop: (id: number) => call<void>("run_stop", { id }),
  runWriteStdin: (id: number, text: string) => call<void>("run_write_stdin", { id, text }),
  // terminal
  termSpawn: (args: { shell?: string | null; cwd?: string | null; rows?: number; cols?: number }) =>
    call<TermHandle>("term_spawn", {
      args: { shell: args.shell ?? null, cwd: args.cwd ?? null, rows: args.rows, cols: args.cols },
    }),
  termWrite: (id: number, base64: string) => call<void>("term_write", { id, data: base64 }),
  termResize: (id: number, rows: number, cols: number) => call<void>("term_resize", { id, rows, cols }),
  termKill: (id: number) => call<void>("term_kill", { id }),
  termDefaultShell: () => call<string>("term_default_shell"),
  // settings & app
  settingsGet: () => call<unknown>("settings_get"),
  settingsSet: (value: unknown) => call<void>("settings_set", { value }),
  appInfo: () => call<{ name: string; version: string; os: string; osVersion: string }>("app_info"),
  recentProjects: () => call<{ path: string }[]>("recent_projects"),
  addRecentProject: (path: string) => call<void>("add_recent_project", { path }),
  removeRecentProject: (path: string) => call<void>("remove_recent_project", { path }),
  openPathInShell: (path: string) => call<void>("open_path_in_shell", { path }),
};

// --- events ---

export interface RunChunkEvent {
  id: number;
  stream: "stdout" | "stderr" | "system";
  text: string;
}

export interface RunExitEvent {
  id: number;
  code: number | null;
}

export interface TermOutEvent {
  id: number;
  data: string; // base64
}

export function listenRunChunk(handler: (e: RunChunkEvent) => void): Promise<UnlistenFn> {
  return tauriListen<RunChunkEvent>("run://chunk", (ev) => handler(ev.payload));
}
export function listenRunExit(handler: (e: RunExitEvent) => void): Promise<UnlistenFn> {
  return tauriListen<RunExitEvent>("run://exit", (ev) => handler(ev.payload));
}
export function listenTermOut(handler: (e: TermOutEvent) => void): Promise<UnlistenFn> {
  return tauriListen<TermOutEvent>("term://out", (ev) => handler(ev.payload));
}
export function listenTermExit(handler: (e: { id: number }) => void): Promise<UnlistenFn> {
  return tauriListen<{ id: number }>("term://exit", (ev) => handler(ev.payload));
}

export interface BridgeMessageEvent {
  id: number;
  message: string;
}

export function listenLspMessage(handler: (e: BridgeMessageEvent) => void): Promise<UnlistenFn> {
  return tauriListen<BridgeMessageEvent>("lsp://message", (ev) => handler(ev.payload));
}

export function listenLspExit(handler: (e: { id: number }) => void): Promise<UnlistenFn> {
  return tauriListen<{ id: number }>("lsp://exit", (ev) => handler(ev.payload));
}

export function listenDapMessage(handler: (e: BridgeMessageEvent) => void): Promise<UnlistenFn> {
  return tauriListen<BridgeMessageEvent>("dap://message", (ev) => handler(ev.payload));
}

export function listenDapExit(handler: (e: { id: number }) => void): Promise<UnlistenFn> {
  return tauriListen<BridgeMessageEvent>("dap://exit", (ev) => handler(ev.payload));
}

export interface FsChangeEvent {
  root: string;
  paths: string[];
}

export function listenFsChange(handler: (e: FsChangeEvent) => void): Promise<UnlistenFn> {
  return tauriListen<FsChangeEvent>("fs://change", (ev) => handler(ev.payload));
}
