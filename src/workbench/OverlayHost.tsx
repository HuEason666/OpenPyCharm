/**
 * Overlay host: renders the active overlay (Search Everywhere, Go to Line,
 * input dialogs, Settings, About, run config picker).
 */
import { useEffect, useRef, useState } from "react";
import { useOverlay } from "./overlays";
import { SearchEverywhere } from "../features/search/SearchEverywhere";
import { DiffDialog } from "../features/git/DiffDialog";
import { CloneDialog } from "../features/git/CloneDialog";
import { SettingsDialog } from "../features/settings/SettingsDialog";
import { NewProjectDialog } from "../features/project/NewProjectDialog";
import { ipc } from "../platform/ipc";
import { usePython } from "../features/python/store";
import { useProject } from "../platform/project";
import { useDocs } from "../editor/docs";
import { revealInEditor } from "../editor/reveal";
import { recentEntries, subscribeNavigation } from "../editor/navigation";
import { allBreakpoints, removeBreakpoint, onBreakpointsChange } from "../features/debug/breakpoints";
import { Icon, fileIconName } from "../ui/icons";
import { pathBase, pathJoin } from "../platform/paths";
import { refreshTreeDir, refreshTreeAll } from "../features/project-tree/ProjectView";
import styles from "./OverlayHost.module.css";

export function OverlayHost() {
  const overlay = useOverlay((s) => s.current);
  const close = useOverlay((s) => s.close);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && overlay && overlay.type !== "searchEverywhere") {
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [overlay, close]);

  if (!overlay) return null;

  switch (overlay.type) {
    case "searchEverywhere":
      return <SearchEverywhere initialTab={overlay.tab} />;
    case "gotoLine":
      return <GoToLineDialog onClose={close} />;
    case "newFile":
      return <InputDialog title={`New File in ${pathBase(overlay.dir) || overlay.dir}`} placeholder="file.py" onClose={close}
        onConfirm={async (name) => {
          const p = pathJoin(overlay.dir, name);
          try {
            await ipc.fsCreateFile(p, "");
            refreshTreeDir(overlay.dir);
            void useDocs.getState().openDoc(p, "");
          } catch (e) {
            console.error(e);
          }
        }} />;
    case "newDir":
      return <InputDialog title={`New Directory in ${pathBase(overlay.dir) || overlay.dir}`} placeholder="package" onClose={close}
        onConfirm={async (name) => {
          try {
            await ipc.fsCreateDir(pathJoin(overlay.dir, name));
            refreshTreeDir(overlay.dir);
          } catch (e) {
            console.error(e);
          }
        }} />;
    case "rename":
      return <InputDialog title={`Rename ${pathBase(overlay.path)}`} initial={pathBase(overlay.path)} onClose={close}
        onConfirm={async (name) => {
          const dir = overlay.path.slice(0, Math.max(overlay.path.lastIndexOf("/"), overlay.path.lastIndexOf("\\")));
          try {
            await ipc.fsRename(overlay.path, pathJoin(dir, name));
            refreshTreeDir(dir);
          } catch (e) {
            console.error(e);
          }
        }} />;
    case "settings":
      return <SettingsDialog onClose={close} initialPage={overlay.page} />;
    case "about":
      return <AboutDialog onClose={close} />;
    case "runConfigPicker":
      return <RunConfigPicker onClose={close} />;
    case "interpreterPicker":
      return <InterpreterPicker onClose={close} />;
    case "diff":
      return <DiffDialog path={overlay.path} relPath={overlay.relPath} staged={overlay.staged} onClose={close} />;
    case "clone":
      return <CloneDialog onClose={close} />;
    case "newProject":
      return <NewProjectDialog onClose={close} />;
    case "renameProject":
      return (
        <InputDialog
          title="重命名项目"
          initial={useProject.getState().name ?? ""}
          onClose={close}
          onConfirm={async (name) => {
            const root = useProject.getState().root;
            if (!root) return;
            const dir = root.slice(0, Math.max(root.lastIndexOf("/"), root.lastIndexOf("\\")));
            const target = pathJoin(dir, name);
            if (target === root) return;
            await useProject.getState().close();
            try {
              await ipc.fsRename(root, target);
              await useProject.getState().open(target);
            } catch (e) {
              console.error(e);
              await useProject.getState().open(root).catch(() => {});
            }
          }}
        />
      );
    case "fileProperties":
      return <FilePropertiesDialog onClose={close} />;
    case "recentLocations":
      return <RecentLocationsDialog onClose={close} />;
    case "breakpointsViewer":
      return <BreakpointsViewer onClose={close} />;
    case "quickInfo":
      return <QuickInfoDialog title={overlay.title} text={overlay.text} onClose={close} />;
    case "moveFile":
      return (
        <InputDialog
          title={`移动 ${pathBase(overlay.path)} 到目录…`}
          placeholder="相对于项目根的目录，例如 utils 或 src/tools"
          onClose={close}
          onConfirm={async (relDir) => {
            const root = useProject.getState().root;
            if (!root) return;
            const clean = relDir.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
            const dir = clean ? pathJoin(root, clean) : root;
            const target = pathJoin(dir, pathBase(overlay.path));
            try {
              await ipc.fsRename(overlay.path, target);
              refreshTreeAll();
              if (clean) refreshTreeDir(dir);
              const docs = useDocs.getState();
              if (docs.docs.some((d) => d.id === overlay.path)) {
                docs.closeDoc(overlay.path);
                void docs.openDoc(target);
              }
            } catch (e) {
              console.error(e);
            }
          }}
        />
      );
    case "copyFile":
      return (
        <InputDialog
          title={`复制 ${pathBase(overlay.path)}…`}
          initial={pathBase(overlay.path)}
          onClose={close}
          onConfirm={async (name) => {
            try {
              const src = await ipc.fsReadText(overlay.path);
              const dir = overlay.path.slice(0, Math.max(overlay.path.lastIndexOf("/"), overlay.path.lastIndexOf("\\")));
              const target = pathJoin(dir, name);
              await ipc.fsWriteText(target, src.text);
              refreshTreeDir(dir);
            } catch (e) {
              console.error(e);
            }
          }}
        />
      );
    default:
      return null;
  }
}

function Backdrop({ onClose }: { onClose: () => void }) {
  return <div className={styles.backdrop} onPointerDown={onClose} />;
}

function InputDialog(props: {
  title: string;
  placeholder?: string;
  initial?: string;
  onClose: () => void;
  onConfirm: (value: string) => void | Promise<void>;
}) {
  const [value, setValue] = useState(props.initial ?? "");
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const confirm = async () => {
    const v = value.trim();
    if (!v) return;
    props.onClose();
    await props.onConfirm(v);
  };
  return (
    <>
      <Backdrop onClose={props.onClose} />
      <div className={styles.dialog} onKeyDown={(e) => e.stopPropagation()}>
        <div className={styles.title}>{props.title}</div>
        <input
          ref={inputRef}
          className={styles.input}
          value={value}
          placeholder={props.placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void confirm();
          }}
        />
        <div className={styles.buttons}>
          <button type="button" className={styles.button} onClick={props.onClose}>
            Cancel
          </button>
          <button type="button" className={styles.button} data-primary="true" onClick={() => void confirm()}>
            OK
          </button>
        </div>
      </div>
    </>
  );
}

function GoToLineDialog({ onClose }: { onClose: () => void }) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => inputRef.current?.focus(), []);
  const go = () => {
    const m = /^(\d+)(?:[,:](\d+))?$/.exec(value.trim());
    onClose();
    if (!m) return;
    const activeId = useDocs.getState().activeId;
    if (activeId) revealInEditor(activeId, Number(m[1]), Number(m[2] ?? "1"));
  };
  return (
    <>
      <Backdrop onClose={onClose} />
      <div className={styles.dialog} onKeyDown={(e) => e.stopPropagation()}>
        <div className={styles.title}>Go to Line:Column</div>
        <input
          ref={inputRef}
          className={styles.input}
          value={value}
          placeholder="Line:Column (e.g. 42:8)"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") go();
          }}
        />
        <div className={styles.hint}>Enter a line and optional column, then press Enter</div>
      </div>
    </>
  );
}

function AboutDialog({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<{ name: string; version: string; os: string; osVersion: string } | null>(null);
  useEffect(() => {
    void ipc.appInfo().then(setInfo).catch(() => {});
  }, []);
  return (
    <>
      <Backdrop onClose={onClose} />
      <div className={styles.dialog} onKeyDown={(e) => e.stopPropagation()}>
        <div className={styles.title}>OpenPyCharm</div>
        <div className={styles.muted}>
          An open-source Python IDE inspired by JetBrains PyCharm. UI design language follows the
          openidea project (Apache-2.0).
        </div>
        <div className={styles.muted}>
          {info ? `Version ${info.version} · ${info.os}` : "…"}
        </div>
        <div className={styles.buttons}>
          <button type="button" className={styles.button} data-primary="true" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </>
  );
}

function RunConfigPicker({ onClose, mode = "run" }: { onClose: () => void; mode?: "run" | "debug" }) {
  const docs = useDocs((s) => s.docs);
  const activeId = useDocs((s) => s.activeId);
  const pyFiles = docs.filter((d) => d.language === "python");
  return (
    <>
      <Backdrop onClose={onClose} />
      <div className={styles.dialog} onKeyDown={(e) => e.stopPropagation()}>
        <div className={styles.title}>{mode === "debug" ? "调试…" : "运行…"}</div>
        <div className={styles.list}>
          {pyFiles.length ? (
            pyFiles.map((d) => (
              <div
                key={d.id}
                className={styles.listRow}
                onClick={() => {
                  onClose();
                  if (mode === "debug") {
                    void import("../features/debug/debugCurrent").then(({ debugActiveFile }) => debugActiveFile(d.id));
                  } else {
                    void import("../features/python/runCurrent").then(({ runFile }) => runFile(d.id));
                  }
                }}
              >
                <Icon name={fileIconName(d.name)} size={16} />
                {d.name}
                <span className={styles.muted}>{d.id === activeId ? " (current)" : ""}</span>
              </div>
            ))
          ) : (
            <div className={styles.listRow}>No Python files are open</div>
          )}
        </div>
      </div>
    </>
  );
}

function InterpreterPicker({ onClose }: { onClose: () => void }) {
  const sdks = usePython((s) => s.sdks);
  const selected = usePython((s) => s.selected);
  return (
    <>
      <Backdrop onClose={onClose} />
      <div className={styles.dialog} onKeyDown={(e) => e.stopPropagation()}>
        <div className={styles.title}>Python Interpreter</div>
        <div className={styles.list}>
          {sdks.map((s) => (
            <div
              key={s.path}
              className={styles.listRow}
              onClick={() => {
                void usePython.getState().select(s.path);
                onClose();
              }}
            >
              <Icon name={s.path === selected?.path ? "check" : "file-python"} size={16} />
              {s.name}
              <span className={styles.muted}>{s.path}</span>
            </div>
          ))}
          {!sdks.length ? <div className={styles.listRow}>No Python interpreters found</div> : null}
        </div>
        <div className={styles.buttons}>
          <button
            type="button"
            className={styles.button}
            onClick={() => {
              void usePython.getState().detect(true);
            }}
          >
            Rescan
          </button>
          <button type="button" className={styles.button} data-primary="true" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </>
  );
}

// --- 文件属性 ---------------------------------------------------------------

function FilePropertiesDialog({ onClose }: { onClose: () => void }) {
  const docs = useDocs((s) => s.docs);
  const activeId = useDocs((s) => s.activeId);
  const active = docs.find((d) => d.id === activeId);
  const path = active?.path ?? useProject.getState().root ?? "";
  const [stat, setStat] = useState<{ kind: string; size: number; mtimeMs: number } | null>(null);
  useEffect(() => {
    if (path) void ipc.fsStat(path).then(setStat).catch(() => setStat(null));
  }, [path]);
  const fmtTime = (ms: number) => (ms ? new Date(ms).toLocaleString() : "—");
  const fmtSize = (bytes: number) =>
    bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
  return (
    <>
      <Backdrop onClose={onClose} />
      <div className={styles.dialog} onKeyDown={(e) => e.stopPropagation()}>
        <div className={styles.title}>文件属性</div>
        <div className={styles.list}>
          <div className={styles.listRow}>
            <Icon name={active ? fileIconName(active.name) : "folder"} size={16} />
            {pathBase(path) || path}
          </div>
          <div className={styles.listRow}>
            <span className={styles.muted}>{path || "（无活动文件）"}</span>
          </div>
          {stat ? (
            <>
              <div className={styles.listRow}>
                <span className={styles.muted}>类型：{stat.kind === "dir" ? "文件夹" : stat.kind === "file" ? "文件" : "不存在"}</span>
              </div>
              <div className={styles.listRow}>
                <span className={styles.muted}>大小：{fmtSize(stat.size)}</span>
              </div>
              <div className={styles.listRow}>
                <span className={styles.muted}>修改时间：{fmtTime(stat.mtimeMs)}</span>
              </div>
            </>
          ) : (
            <div className={styles.listRow}>
              <span className={styles.muted}>读取属性失败</span>
            </div>
          )}
        </div>
        <div className={styles.buttons}>
          <button type="button" className={styles.button} data-primary="true" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </>
  );
}

// --- 最近的位置 --------------------------------------------------------------

function RecentLocationsDialog({ onClose }: { onClose: () => void }) {
  const [, force] = useState(0);
  useEffect(() => subscribeNavigation(() => force((n) => n + 1)), []);
  const entries = recentEntries(20);
  const jump = (id: string, line: number, col: number) => {
    onClose();
    void revealInEditor(id, line, col, undefined, true);
  };
  return (
    <>
      <Backdrop onClose={onClose} />
      <div className={styles.dialog} onKeyDown={(e) => e.stopPropagation()}>
        <div className={styles.title}>最近的位置</div>
        <div className={styles.list}>
          {entries.length ? (
            entries.map((e, i) => (
              <div key={`${e.id}:${i}`} className={styles.listRow} onClick={() => jump(e.id, e.line, e.col)}>
                <Icon name={fileIconName(pathBase(e.id))} size={16} />
                {pathBase(e.id)}
                <span className={styles.muted}>:{e.line}:{e.col}</span>
                <span className={styles.muted}>{e.id}</span>
              </div>
            ))
          ) : (
            <div className={styles.listRow}>暂无导航历史</div>
          )}
        </div>
      </div>
    </>
  );
}

// --- 断点查看器 --------------------------------------------------------------

function BreakpointsViewer({ onClose }: { onClose: () => void }) {
  const [tick, setTick] = useState(0);
  useEffect(() => onBreakpointsChange(() => setTick((n) => n + 1)), []);
  const rows = allBreakpoints(); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <Backdrop onClose={onClose} />
      <div className={styles.dialog} onKeyDown={(e) => e.stopPropagation()} key={tick}>
        <div className={styles.title}>断点</div>
        <div className={styles.list}>
          {rows.length ? (
            rows.map((b) => (
              <div
                key={`${b.path}:${b.line}`}
                className={styles.listRow}
                onClick={() => {
                  onClose();
                  void revealInEditor(b.path, b.line, 1, undefined, true);
                }}
              >
                <Icon name="debug" size={14} />
                {pathBase(b.path)}
                <span className={styles.muted}>:{b.line}</span>
                <span className={styles.muted}>{b.path}</span>
                <button
                  type="button"
                  className={styles.button}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeBreakpoint(b.path, b.line);
                    setTick((n) => n + 1);
                  }}
                >
                  移除
                </button>
              </div>
            ))
          ) : (
            <div className={styles.listRow}>没有断点。在编辑器行号旁点击或按 Ctrl+F8 添加。</div>
          )}
        </div>
      </div>
    </>
  );
}

// --- 快速文档 / 类型信息 / 错误描述 -------------------------------------------

function QuickInfoDialog({ title, text, onClose }: { title: string; text: string; onClose: () => void }) {
  return (
    <>
      <Backdrop onClose={onClose} />
      <div className={styles.dialog} onKeyDown={(e) => e.stopPropagation()}>
        <div className={styles.title}>{title}</div>
        <pre className={styles.muted} style={{ whiteSpace: "pre-wrap", maxHeight: 320, overflow: "auto", userSelect: "text" }}>
          {text}
        </pre>
        <div className={styles.buttons}>
          <button type="button" className={styles.button} data-primary="true" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </>
  );
}
