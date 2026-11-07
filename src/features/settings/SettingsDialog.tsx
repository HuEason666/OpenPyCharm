/**
 * 设置 — JetBrains-style settings window: search + category tree on the left,
 * breadcrumb + page on the right, 确定/取消/应用 at the bottom. All pages are
 * functional: 外观, 系统设置, 通知(toasts), 编辑器›字体, 按键映射, 版本控制›Git,
 * 构建工具(formatter), Python(解释器), 安全(recents), 插件(组件状态),
 * 项目结构(排除目录), 工具›终端.
 */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "../../ui/icons";
import { useSettings, type Settings } from "../../platform/settings";
import { INTELLIJ_WINDOWS } from "../../platform/keymaps/intellij-windows";
import { useActions } from "../../platform/actions";
import { useProject } from "../../platform/project";
import { usePython } from "../python/store";
import { useLsp, restartLsp, type LspStatus } from "../../platform/lsp";
import { useGit } from "../git/store";
import { useDebug } from "../debug/store";
import { notify } from "../../platform/notify";
import { ipc } from "../../platform/ipc";
import styles from "./SettingsDialog.module.css";

type Draft = Partial<Settings>;

interface TreeItem {
  id: string;
  label: string;
  group?: string; // parent label for the breadcrumb
  children?: TreeItem[];
  page?:
    | "placeholder"
    | "look"
    | "system"
    | "notifications"
    | "keymap"
    | "editorFont"
    | "terminal"
    | "git"
    | "buildTools"
    | "python"
    | "security"
    | "plugins"
    | "projectStructure"
    | "agentSettings";
}

const TREE: TreeItem[] = [
  {
    id: "appearance",
    label: "外观与行为",
    children: [
      { id: "appearance.look", label: "外观", group: "外观与行为", page: "look" },
      { id: "appearance.system", label: "系统设置", group: "外观与行为", page: "system" },
      { id: "appearance.notifications", label: "通知", group: "外观与行为", page: "notifications" },
    ],
  },
  { id: "keymap", label: "按键映射", page: "keymap" },
  { id: "editor", label: "编辑器", children: [{ id: "editor.font", label: "字体", group: "编辑器", page: "editorFont" }] },
  { id: "security", label: "安全", page: "security" },
  { id: "plugins", label: "插件", page: "plugins" },
  { id: "vcs", label: "版本控制", children: [{ id: "vcs.git", label: "Git", group: "版本控制", page: "git" }] },
  { id: "projectStructure", label: "项目结构", page: "projectStructure" },
  { id: "build", label: "构建、执行、部署", children: [{ id: "build.tools", label: "构建工具", group: "构建、执行、部署", page: "buildTools" }] },
  { id: "languages", label: "语言和框架", children: [{ id: "lang.python", label: "Python", group: "语言和框架", page: "python" }] },
  { id: "tools", label: "工具", children: [{ id: "tools.terminal", label: "终端", group: "工具", page: "terminal" }, { id: "tools.agent", label: "智能体", group: "工具", page: "agentSettings" }] },
];

const ACCENTS = ["#3871e1", "#21d789", "#b36ae2", "#e08855"];

function flatten(items: TreeItem[], out: TreeItem[] = []): TreeItem[] {
  for (const it of items) {
    out.push(it);
    if (it.children) flatten(it.children, out);
  }
  return out;
}

export function SettingsDialog({ onClose, initialPage }: { onClose: () => void; initialPage?: string }) {
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const [draft, setDraft] = useState<Draft>({});
  const [selected, setSelected] = useState(initialPage ?? "appearance.look");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["appearance", "editor"]));

  const set = (patch: Draft) => setDraft((d) => ({ ...d, ...patch }));
  const dirty = useMemo(() => {
    const keys = new Set([...Object.keys(draft), "theme", "fontSize", "accent", "uiScale", "uiFontSize", "uiFontFamily", "compact", "autosaveOnBlur", "reopenLastProject", "terminalShell"] as (keyof Settings)[]);
    for (const k of keys) {
      if (JSON.stringify(draft[k as string] ?? null) !== JSON.stringify(settings[k as string] ?? null)) return true;
    }
    return false;
  }, [draft, settings]);

  const apply = async () => {
    if (!dirty) return;
    const affectsLsp = draft.excludedDirs !== undefined;
    await update(draft);
    setDraft({});
    // 排除目录变了 → 让 pyright 按新的 exclude 集合重启（省电模式下跳过）。
    if (affectsLsp && useSettings.getState().settings.powerSave !== true) {
      const root = useProject.getState().root;
      if (root) void restartLsp(root, usePython.getState().selected?.path ?? null);
    }
  };

  const item = flatten(TREE).find((t) => t.id === selected) ?? TREE[0];

  return (
    <>
      <div className={styles.backdrop} onPointerDown={onClose} />
      <div className={styles.dialog} onKeyDown={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          设置
          <button type="button" className={styles.headerClose} aria-label="关闭" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className={styles.body}>
          <aside className={styles.sidebar}>
            <div className={styles.searchWrap}>
              <span className={styles.searchIcon}>
                <Icon name="search" size={14} />
              </span>
              <input
                className={styles.search}
                value={query}
                placeholder="搜索设置"
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
            </div>
            <div className={styles.tree}>
              {query.trim() ? (
                flatten(TREE)
                  .filter((t) => t.id !== selected || true)
                  .filter((t) => t.label.toLowerCase().includes(query.trim().toLowerCase()) && t.label !== query)
                  .filter((t) => t.children === undefined || t.page)
                  .map((t) => (
                    <div
                      key={t.id}
                      className={styles.treeRow}
                      data-selected={t.id === selected}
                      onClick={() => {
                        setSelected(t.id);
                        setQuery("");
                      }}
                    >
                      <span>{t.label}</span>
                      {t.group ? <span className={styles.treeMatch}>{t.group}</span> : null}
                    </div>
                  ))
              ) : (
                TREE.map((group) => (
                  <TreeGroup
                    key={group.id}
                    item={group}
                    selected={selected}
                    expanded={expanded}
                    onToggleExpand={(id) =>
                      setExpanded((s) => {
                        const next = new Set(s);
                        if (next.has(id)) next.delete(id);
                        else next.add(id);
                        return next;
                      })
                    }
                    onSelect={setSelected}
                  />
                ))
              )}
            </div>
          </aside>
          <section className={styles.main}>
            <div className={styles.breadcrumbBar}>
              <span className={styles.crumbRoot}>{item.group ?? item.label}</span>
              {item.group ? (
                <>
                  <span className={styles.crumbSep}>›</span>
                  <span className={styles.crumbPage}>{item.label}</span>
                </>
              ) : null}
              <div className={styles.navButtons}>
                <button type="button" className={styles.navButton} disabled title="上一步">
                  <Icon name="arrow-left" size={14} />
                </button>
                <button type="button" className={styles.navButton} disabled title="下一步">
                  <Icon name="arrow-right" size={14} />
                </button>
              </div>
            </div>
            <div className={styles.page} key={item.id}>
              <Page item={item} draft={draft} saved={settings} set={set} />
            </div>
          </section>
        </div>
        <div className={styles.footer}>
          <button
            type="button"
            className={styles.button}
            data-primary="true"
            disabled={!dirty}
            onClick={() => void apply().then(onClose)}
          >
            确定
          </button>
          <button type="button" className={styles.button} onClick={onClose}>
            取消
          </button>
          <button type="button" className={styles.button} disabled={!dirty} onClick={() => void apply()}>
            应用
          </button>
        </div>
      </div>
    </>
  );
}

function TreeGroup({
  item,
  selected,
  expanded,
  onToggleExpand,
  onSelect,
  depth = 0,
}: {
  item: TreeItem;
  selected: string;
  expanded: Set<string>;
  onToggleExpand: (id: string) => void;
  onSelect: (id: string) => void;
  depth?: number;
}) {
  const hasChildren = !!item.children;
  const isOpen = expanded.has(item.id);
  return (
    <>
      <div
        className={styles.treeRow}
        data-selected={item.id === selected}
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={() => (hasChildren ? onToggleExpand(item.id) : onSelect(item.id))}
      >
        <span className={styles.treeChevron}>
          {hasChildren ? <Icon name={isOpen ? "chevron-down" : "chevron-right"} size={12} /> : null}
        </span>
        <span>{item.label}</span>
      </div>
      {hasChildren && isOpen
        ? item.children!.map((child) => (
            <TreeGroup
              key={child.id}
              item={child}
              selected={selected}
              expanded={expanded}
              onToggleExpand={onToggleExpand}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))
        : null}
    </>
  );
}

function Page({
  item,
  draft,
  saved,
  set,
}: {
  item: TreeItem;
  draft: Draft;
  saved: Settings;
  set: (patch: Draft) => void;
}) {
  const val = <K extends keyof Settings>(key: K): Settings[K] => (draft[key as string] ?? saved[key]) as Settings[K];
  switch (item.page) {
    case "look":
      return <LookPage val={val} set={set} />;
    case "system":
      return <SystemPage val={val} set={set} />;
    case "notifications":
      return <NotificationsPage val={val} set={set} />;
    case "editorFont":
      return <EditorFontPage val={val} set={set} />;
    case "keymap":
      return <KeymapPage />;
    case "terminal":
      return <TerminalPage val={val} set={set} />;
    case "git":
      return <GitPage val={val} set={set} />;
    case "buildTools":
      return <BuildToolsPage val={val} set={set} />;
    case "python":
      return <PythonPage />;
    case "security":
      return <SecurityPage val={val} set={set} />;
    case "plugins":
      return <PluginsPage />;
    case "projectStructure":
      return <ProjectStructurePage val={val} set={set} />;
    case "agentSettings":
      return <AgentSettingsPage val={val} set={set} />;
    default:
      return <div className={styles.placeholder}>此分类在此版本中暂不可用。</div>;
  }
}

type Getter = <K extends keyof Settings>(key: K) => Settings[K];
type Setter = (patch: Draft) => void;

function LookPage({ val, set }: { val: Getter; set: Setter }) {
  const theme = val("theme");
  const accent = val("accent") ?? null;
  const hexValid = /^#[0-9a-fA-F]{6}$/.test(accent ?? "");
  return (
    <>
      <div className={styles.row}>
        <div className={styles.rowLabel}>主题:</div>
        <div className={styles.control}>
          <select
            className={styles.select}
            value={theme}
            onChange={(e) => set({ theme: e.target.value as Settings["theme"] })}
          >
            <option value="dark">Islands 深色</option>
            <option value="light">Islands 浅色</option>
          </select>
          <label className={styles.checkRow} style={{ marginBottom: 0 }}>
            <input type="checkbox" className={styles.check} disabled /> 与操作系统同步
          </label>
        </div>
      </div>
      <div className={styles.row}>
        <div className={styles.rowLabel}>编辑器配色方案:</div>
        <div className={styles.control}>
          <select className={styles.select} disabled>
            <option>主题默认</option>
          </select>
        </div>
      </div>
      <div className={styles.row}>
        <div className={styles.rowLabel}>强调色:</div>
        <div className={styles.control}>
          <div className={styles.swatches}>
            <button
              type="button"
              className={`${styles.swatch} ${styles.swatchRainbow}`}
              data-active={!accent}
              title="主题默认"
              onClick={() => set({ accent: null })}
            />
            {ACCENTS.map((c) => (
              <button
                key={c}
                type="button"
                className={styles.swatch}
                style={{ background: c }}
                data-active={accent === c}
                title={c}
                onClick={() => set({ accent: c })}
              />
            ))}
          </div>
          <input
            className={`${styles.input} ${styles.smallInput}`}
            value={accent ?? ""}
            placeholder="#rrggbb"
            onChange={(e) => set({ accent: e.target.value.trim() || null })}
          />
          {accent && !hexValid ? <span className={styles.checkHint}>无效的十六进制颜色</span> : null}
        </div>
      </div>
      <label className={styles.checkRow}>
        <input type="checkbox" className={styles.check} disabled />
        <span className={styles.checkCol}>
          不同的工具窗口背景
          <span className={styles.checkHint}>在深色主题中使用较浅的颜色，在浅色主题中使用较深的颜色作为背景</span>
        </span>
      </label>

      <div className={styles.sectionTitle}>辅助功能</div>
      <div className={styles.row}>
        <div className={styles.rowLabel}>缩放:</div>
        <div className={styles.control}>
          <select
            className={styles.select}
            value={String(val("uiScale") ?? 100)}
            onChange={(e) => set({ uiScale: Number(e.target.value) })}
          >
            {[75, 80, 90, 100, 110, 125, 150, 175, 200].map((p) => (
              <option key={p} value={p}>
                {p}%
              </option>
            ))}
          </select>
          <span className={styles.checkHint}>使用 Alt+Shift+= 或 Alt+Shift+- 更改，使用 Alt+Shift+0 重写为 100%</span>
        </div>
      </div>
      <label className={styles.checkRow}>
        <input
          type="checkbox"
          className={styles.check}
          checked={!!val("uiFontFamily")}
          onChange={(e) => set({ uiFontFamily: e.target.checked ? "Inter" : null })}
        />
        <span className={styles.checkCol}>
          使用自定义字体:
          <span className={styles.control}>
            <input
              className={`${styles.input} ${styles.wideInput}`}
              value={val("uiFontFamily") ?? ""}
              placeholder="Inter"
              disabled={!val("uiFontFamily")}
              onChange={(e) => set({ uiFontFamily: e.target.value || null })}
            />
            <button type="button" className={styles.button} disabled>
              刷新
            </button>
          </span>
          <span className={styles.checkHint}>输入字体家族名称或搜索已安装字体。</span>
        </span>
      </label>
      <div className={styles.row}>
        <div className={styles.rowLabel}>备用字体:</div>
        <div className={styles.control}>
          <input className={styles.input} disabled placeholder="无" />
          <button type="button" className={styles.button} disabled>
            刷新
          </button>
        </div>
      </div>
      <div className={styles.row}>
        <div className={styles.rowLabel}>大小:</div>
        <div className={styles.control}>
          <input
            className={`${styles.input} ${styles.smallInput}`}
            value={String(val("uiFontSize") ?? 13)}
            onChange={(e) => set({ uiFontSize: Number(e.target.value.replace(/[^\d]/g, "")) || 13 })}
          />
        </div>
      </div>
      <label className={styles.checkRow}>
        <input type="checkbox" className={styles.check} disabled /> 使用对比度滚动条
      </label>
      <label className={styles.checkRow}>
        <input type="checkbox" className={styles.check} disabled />
        <span className={styles.checkCol}>
          针对红绿色觉缺陷调整颜色
          <span className={styles.checkHint}>适用于红色和绿色盲</span>
        </span>
      </label>

      <div className={styles.sectionTitle}>UI 选项</div>
      <div className={styles.row}>
        <div className={styles.rowLabel}>主菜单:</div>
        <div className={styles.control}>
          <select
            className={styles.select}
            value={val("mainMenuMode") ?? "hamburger"}
            onChange={(e) => set({ mainMenuMode: e.target.value as Settings["mainMenuMode"] })}
          >
            <option value="hamburger">汉堡菜单按钮</option>
            <option value="merged">合并菜单</option>
          </select>
        </div>
      </div>
      <label className={styles.checkRow}>
        <input
          type="checkbox"
          className={styles.check}
          checked={!!val("compact")}
          onChange={(e) => set({ compact: e.target.checked })}
        />
        <span className={styles.checkCol}>
          紧凑模式
          <span className={styles.checkHint}>UI 元素占用更少的屏幕空间</span>
        </span>
      </label>
      <label className={styles.checkRow}>
        <input type="checkbox" className={styles.check} disabled /> 均衡窗口标题中显示完整路径
      </label>
      <label className={styles.checkRow}>
        <input type="checkbox" className={styles.check} disabled /> 在主工具栏中使用项目颜色
      </label>
      <label className={styles.checkRow} style={{ marginLeft: 128 }}>
        <input type="checkbox" className={styles.check} disabled checked /> 在菜单项中显示图标
      </label>

      <div className={styles.sectionTitle}>抗锯齿</div>
      <div className={styles.row}>
        <div className={styles.rowLabel}>IDE:</div>
        <div className={styles.control}>
          <select className={styles.select} disabled>
            <option>灰度</option>
          </select>
        </div>
      </div>
      <div className={styles.row}>
        <div className={styles.rowLabel}>编辑器:</div>
        <div className={styles.control}>
          <select className={styles.select} disabled>
            <option>灰度</option>
          </select>
        </div>
      </div>

      <div className={styles.sectionTitle}>工具窗口</div>
      <div className={styles.row}>
        <div className={styles.control} style={{ flexDirection: "column", alignItems: "flex-start" }}>
          <label className={styles.checkRow}>
            <input type="checkbox" className={styles.check} disabled checked /> 显示工具窗口栏
          </label>
          <label className={styles.checkRow}>
            <input type="checkbox" className={styles.check} disabled /> 显示工具窗口名称
          </label>
          <label className={styles.checkRow}>
            <input type="checkbox" className={styles.check} disabled checked /> 显示工具窗口边框
          </label>
        </div>
        <div />
      </div>
      <label className={styles.checkRow}>
        <input type="checkbox" className={styles.check} disabled />
        <span className={styles.checkCol}>
          宽屏工具窗口布局
          <span className={styles.checkHint}>侧边工具窗口占据整个高度；底部工具窗口位于两者之间</span>
        </span>
      </label>
    </>
  );
}

function SystemPage({ val, set }: { val: Getter; set: Setter }) {
  return (
    <>
      <label className={styles.checkRow}>
        <input
          type="checkbox"
          className={styles.check}
          checked={val("autosaveOnBlur") !== false}
          onChange={(e) => set({ autosaveOnBlur: e.target.checked })}
        />
        <span className={styles.checkCol}>
          窗口失焦时自动保存所有文件
          <span className={styles.checkHint}>与 PyCharm 的自动保存行为一致；也可以随时按 Ctrl+S 手动保存</span>
        </span>
      </label>
      <label className={styles.checkRow}>
        <input
          type="checkbox"
          className={styles.check}
          checked={!!val("reopenLastProject")}
          onChange={(e) => set({ reopenLastProject: e.target.checked })}
        />
        <span className={styles.checkCol}>
          启动时重新打开最近的项目
          <span className={styles.checkHint}>下次启动时直接打开上一次使用的项目</span>
        </span>
      </label>
      <div className={styles.sectionTitle}>HTTP 代理</div>
      <div className={styles.row}>
        <div className={styles.rowLabel}>代理设置:</div>
        <div className={styles.control}>
          <select className={styles.select} disabled>
            <option>自动检测代理设置</option>
          </select>
        </div>
      </div>
    </>
  );
}

function EditorFontPage({ val, set }: { val: Getter; set: Setter }) {
  return (
    <>
      <div className={styles.row}>
        <div className={styles.rowLabel}>大小:</div>
        <div className={styles.control}>
          <input
            className={`${styles.input} ${styles.smallInput}`}
            value={String(val("fontSize") ?? 13)}
            onChange={(e) => set({ fontSize: Number(e.target.value.replace(/[^\d]/g, "")) || 13 })}
          />
        </div>
      </div>
      <div className={styles.row}>
        <div className={styles.rowLabel}>字体:</div>
        <div className={styles.control}>
          <select className={styles.select} disabled>
            <option>JetBrains Mono Variable</option>
          </select>
        </div>
      </div>
      <label className={styles.checkRow}>
        <input type="checkbox" className={styles.check} disabled /> 启用连字
      </label>
      <div className={styles.hint}>即时生效；行高按字号自动调整。</div>
    </>
  );
}

function TerminalPage({ val, set }: { val: Getter; set: Setter }) {
  const shell = (val("terminalShell") as string | null | undefined) ?? "";
  return (
    <>
      <div className={styles.row}>
        <div className={styles.rowLabel}>应用程序设置:</div>
        <div className={styles.control}>
          <span className={styles.checkHint}>新建终端会话时使用的 Shell；留空使用系统默认 (COMSPEC)。</span>
        </div>
      </div>
      <div className={styles.row}>
        <div className={styles.rowLabel}>Shell 路径:</div>
        <div className={styles.control}>
          <input
            className={`${styles.input} ${styles.wideInput}`}
            style={{ width: 320 }}
            value={shell}
            placeholder="例如 powershell.exe 或 C:\Windows\System32\cmd.exe"
            onChange={(e) => set({ terminalShell: e.target.value.trim() || null })}
          />
        </div>
      </div>
    </>
  );
}

function KeymapPage() {
  const actions = useActions((s) => s.actions);
  const rows = Object.entries(INTELLIJ_WINDOWS).filter(([, strokes]) => strokes.length > 0);
  return (
    <>
      <div className={styles.keymapHint}>预设：IntelliJ (Windows)。在编辑框中输入以搜索。</div>
      {rows.map(([actionId, strokes]) => {
        const action = actions.get(actionId);
        return (
          <div key={actionId} className={styles.kmRow}>
            <span className={styles.kmAction}>{action?.title ?? actionId}</span>
            <span className={styles.kmHint}>{strokes.join("  ·  ")}</span>
          </div>
        );
      })}
    </>
  );
}

// --- 通知 -------------------------------------------------------------------

function NotificationsPage({ val, set }: { val: Getter; set: Setter }) {
  const enabled = val("notificationsEnabled") !== false;
  return (
    <>
      <label className={styles.checkRow}>
        <input
          type="checkbox"
          className={styles.check}
          checked={enabled}
          onChange={(e) => set({ notificationsEnabled: e.target.checked })}
        />
        <span className={styles.checkCol}>
          启用通知
          <span className={styles.checkHint}>在窗口右下角显示气泡通知；点击气泡可立即关闭</span>
        </span>
      </label>
      <div className={styles.sectionTitle}>通知内容</div>
      <label className={styles.checkRow} style={{ opacity: enabled ? 1 : 0.5 }}>
        <input
          type="checkbox"
          className={styles.check}
          disabled={!enabled}
          checked={enabled && val("notifyRunFinish") !== false}
          onChange={(e) => set({ notifyRunFinish: e.target.checked })}
        />
        <span className={styles.checkCol}>
          运行结束时通知
          <span className={styles.checkHint}>运行会话退出后弹出结果：正常完成（绿）或非零退出码（红）</span>
        </span>
      </label>
      <div className={styles.row}>
        <div className={styles.rowLabel}>预览:</div>
        <div className={styles.control}>
          <button type="button" className={styles.button} disabled={!enabled} onClick={() => notify("info", "这是一条测试通知")}>
            发送测试通知
          </button>
          <button
            type="button"
            className={styles.button}
            disabled={!enabled}
            onClick={() => notify("success", "「main.py」运行完成")}
          >
            成功示例
          </button>
          <button
            type="button"
            className={styles.button}
            disabled={!enabled}
            onClick={() => notify("error", "「main.py」已退出，退出码 1")}
          >
            失败示例
          </button>
        </div>
      </div>
    </>
  );
}

// --- 版本控制 › Git -----------------------------------------------------------

function GitPage({ val, set }: { val: Getter; set: Setter }) {
  const info = useGit((s) => s.info);
  const root = useProject((s) => s.root);
  const refresh = useGit((s) => s.refresh);
  const enabled = val("gitEnabled") !== false;
  return (
    <>
      <label className={styles.checkRow}>
        <input
          type="checkbox"
          className={styles.check}
          checked={enabled}
          onChange={(e) => set({ gitEnabled: e.target.checked })}
        />
        <span className={styles.checkCol}>
          启用 Git 集成
          <span className={styles.checkHint}>状态栏分支、项目树颜色标记与提交/推拉功能；关闭后暂停轮询，仍可手动刷新</span>
        </span>
      </label>
      <div className={styles.row}>
        <div className={styles.rowLabel}>刷新间隔:</div>
        <div className={styles.control}>
          <input
            className={`${styles.input} ${styles.smallInput}`}
            value={String(val("gitPollMs") ?? 4000)}
            onChange={(e) => {
              const n = Number(e.target.value.replace(/[^\d]/g, "")) || 0;
              set({ gitPollMs: Math.max(1000, n) });
            }}
          />
          <span className={styles.checkHint}>毫秒（最小 1000）。间隔越大后台开销越小。</span>
        </div>
      </div>
      <div className={styles.sectionTitle}>当前仓库</div>
      {!root ? (
        <div className={styles.hint}>打开项目后显示仓库状态。</div>
      ) : !info?.repo ? (
        <div className={styles.hint}>当前项目不是 Git 仓库。可在欢迎页使用「从版本控制系统获取」克隆。</div>
      ) : (
        <>
          <div className={styles.kmRow}>
            <span className={styles.kmAction}>分支</span>
            <span className={styles.kmHint}>{info.branch ?? "—"}</span>
          </div>
          <div className={styles.kmRow}>
            <span className={styles.kmAction}>上游</span>
            <span className={styles.kmHint}>{info.upstream ?? "未设置"}</span>
          </div>
          <div className={styles.kmRow}>
            <span className={styles.kmAction}>领先 / 落后</span>
            <span className={styles.kmHint}>
              {info.ahead} / {info.behind}
            </span>
          </div>
          <div className={styles.kmRow}>
            <span className={styles.kmAction}>仓库根</span>
            <span className={styles.kmHint}>{info.root ?? root}</span>
          </div>
        </>
      )}
      <div className={styles.row} style={{ marginTop: 12 }}>
        <div className={styles.rowLabel}></div>
        <div className={styles.control}>
          <button type="button" className={styles.button} onClick={() => void refresh()}>
            立即刷新
          </button>
        </div>
      </div>
    </>
  );
}

// --- 构建、执行、部署 › 构建工具 -------------------------------------------------

type ToolCheck = { checking: boolean; tools: Partial<Record<"ruff" | "black" | "autopep8" | "debugpy", boolean>> };

function BuildToolsPage({ val, set }: { val: Getter; set: Setter }) {
  const root = useProject((s) => s.root);
  const python = usePython((s) => s.selected?.path);
  const [check, setCheck] = useState<ToolCheck>({ checking: true, tools: {} });

  useEffect(() => {
    if (!python) {
      setCheck({ checking: false, tools: {} });
      return;
    }
    let alive = true;
    setCheck({ checking: true, tools: {} });
    void (async () => {
      const names = ["ruff", "black", "autopep8", "debugpy"] as const;
      const results = await Promise.all(names.map((n) => ipc.pythonHasModule(python, n).catch(() => false)));
      if (!alive) return;
      const tools: ToolCheck["tools"] = {};
      names.forEach((n, i) => (tools[n] = results[i]));
      setCheck({ checking: false, tools });
    })();
    return () => {
      alive = false;
    };
  }, [python, root]);

  const fmt = val("formatter") ?? "auto";
  const chip = (name: "ruff" | "black" | "autopep8" | "debugpy", label: string) => {
    const ok = check.tools[name];
    return (
      <span key={name} className={styles.chip} data-ok={ok === true ? "true" : "false"}>
        <span className={styles.chipDot} />
        {label} {check.checking ? "…" : ok ? "已安装" : "未安装"}
      </span>
    );
  };
  return (
    <>
      <div className={styles.row}>
        <div className={styles.rowLabel}>格式化工具:</div>
        <div className={styles.control}>
          <select
            className={styles.select}
            value={fmt}
            onChange={(e) => set({ formatter: e.target.value as Settings["formatter"] })}
          >
            <option value="auto">自动检测（ruff → black → autopep8）</option>
            <option value="ruff">Ruff</option>
            <option value="black">Black</option>
            <option value="autopep8">autopep8</option>
          </select>
        </div>
      </div>
      <div className={styles.hint}>作用于「重新设置代码格式」(Ctrl+Alt+Shift+L)。选择未安装的工具会在格式化时明确报错，而不是静默换用其他工具。</div>
      <div className={styles.sectionTitle}>当前解释器中的工具</div>
      <div className={styles.chips}>
        {chip("ruff", "ruff")}
        {chip("black", "black")}
        {chip("autopep8", "autopep8")}
        {chip("debugpy", "debugpy（调试器）")}
      </div>
      {!python ? <div className={styles.hint}>未检测到 Python 解释器。</div> : <div className={styles.hint}>{python}</div>}
    </>
  );
}

// --- 语言和框架 › Python -------------------------------------------------------

const LSP_TONE: Record<LspStatus, { text: string; tone: "ok" | "warn" | "err" }> = {
  stopped: { text: "未启动", tone: "warn" },
  starting: { text: "启动中", tone: "warn" },
  ready: { text: "运行中", tone: "ok" },
  error: { text: "错误", tone: "err" },
};

function PythonPage() {
  const root = useProject((s) => s.root);
  const sdks = usePython((s) => s.sdks);
  const selected = usePython((s) => s.selected);
  const detecting = usePython((s) => s.detecting);
  const detect = usePython((s) => s.detect);
  const lspStatus = useLsp((s) => s.status);
  const lspMessage = useLsp((s) => s.message);

  if (!root) return <div className={styles.placeholder}>打开项目后可为该项目选择 Python 解释器。</div>;
  const lsp = LSP_TONE[lspStatus];
  return (
    <>
      <div className={styles.sectionTitle}>当前项目解释器</div>
      {sdks.length === 0 ? (
        <div className={styles.hint}>{detecting ? "正在扫描解释器…" : "未找到可用的 Python 解释器。"}</div>
      ) : (
        sdks.map((sdk) => (
          <label key={sdk.path} className={styles.checkRow}>
            <input
              type="radio"
              name="python-interpreter"
              className={styles.check}
              checked={selected?.path === sdk.path}
              onChange={() => void usePython.getState().select(sdk.path)}
            />
            <span className={styles.checkCol}>
              {sdk.name}
              <span className={styles.checkHint}>{sdk.path}</span>
            </span>
          </label>
        ))
      )}
      <div className={styles.row} style={{ marginTop: 8 }}>
        <div className={styles.rowLabel}></div>
        <div className={styles.control}>
          <button type="button" className={styles.button} disabled={detecting} onClick={() => void detect(true)}>
            重新扫描
          </button>
        </div>
      </div>
      <div className={styles.sectionTitle}>语言服务</div>
      <div className={styles.kmRow}>
        <span className={styles.kmAction}>pyright 状态</span>
        <span className={styles.badge} data-tone={lsp.tone}>
          {lsp.text}
        </span>
      </div>
      {lspStatus === "error" && lspMessage ? <div className={styles.hint}>{lspMessage}</div> : null}
      <div className={styles.hint}>切换解释器后语言服务会自动重启，立即按新环境解析导入与补全。</div>
    </>
  );
}

// --- 安全 ---------------------------------------------------------------------

function SecurityPage({ val, set }: { val: Getter; set: Setter }) {
  const recents = useProject((s) => s.recents);
  const refreshRecents = useProject((s) => s.refreshRecents);
  const clear = async () => {
    const { ask } = await import("@tauri-apps/plugin-dialog");
    const yes = await ask(`确定清除全部 ${recents.length} 条最近项目记录吗？此操作不可撤销。`, {
      title: "清除最近项目",
      kind: "warning",
    });
    if (!yes) return;
    for (const p of recents) {
      try {
        await ipc.removeRecentProject(p);
      } catch {
        // Ignore single failures.
      }
    }
    await refreshRecents();
    notify("success", "最近项目记录已清除");
  };
  return (
    <>
      <label className={styles.checkRow}>
        <input
          type="checkbox"
          className={styles.check}
          checked={val("recordRecents") !== false}
          onChange={(e) => set({ recordRecents: e.target.checked })}
        />
        <span className={styles.checkCol}>
          记录最近打开的项目
          <span className={styles.checkHint}>关闭后打开项目不会写入最近项目列表</span>
        </span>
      </label>
      <div className={styles.row}>
        <div className={styles.rowLabel}>最近项目:</div>
        <div className={styles.control}>
          <button type="button" className={styles.button} disabled={recents.length === 0} onClick={() => void clear()}>
            清除最近项目（{recents.length}）
          </button>
        </div>
      </div>
      <div className={styles.sectionTitle}>数据说明</div>
      <div className={styles.hint}>
        本 IDE 不收集遥测数据。设置、最近项目与运行配置均只保存在本机用户配置目录中；Git 等外部工具调用不会上传任何内容。
      </div>
    </>
  );
}

// --- 插件 ---------------------------------------------------------------------

type Tone = "ok" | "warn" | "err";

function PluginRow({ name, desc, text, tone }: { name: string; desc: string; text: string; tone: Tone }) {
  return (
    <div className={styles.pluginRow}>
      <div className={styles.pluginInfo}>
        <div className={styles.pluginName}>{name}</div>
        <div className={styles.pluginDesc}>{desc}</div>
      </div>
      <span className={styles.badge} data-tone={tone}>
        {text}
      </span>
    </div>
  );
}

function PluginsPage() {
  const lspStatus = useLsp((s) => s.status);
  const debugStatus = useDebug((s) => s.status);
  const gitEnabled = useSettings((s) => s.settings.gitEnabled);
  const info = useGit((s) => s.info);
  const lsp = LSP_TONE[lspStatus];
  const debugText: Record<string, { text: string; tone: Tone }> = {
    idle: { text: "空闲", tone: "warn" },
    starting: { text: "启动中", tone: "warn" },
    running: { text: "运行中", tone: "ok" },
    paused: { text: "已暂停", tone: "warn" },
    exited: { text: "空闲", tone: "warn" },
    error: { text: "错误", tone: "err" },
  };
  const dbg = debugText[debugStatus] ?? { text: debugStatus, tone: "warn" as Tone };
  return (
    <>
      <div className={styles.hint} style={{ marginBottom: 8 }}>
        内置功能组件及其运行状态（只读）。
      </div>
      <PluginRow name="编辑器内核" desc="CodeMirror 6 — 语法高亮、多光标、代码折叠" text="已启用" tone="ok" />
      <PluginRow name="Python 语言服务" desc="pyright LSP（经 Node 子进程桥接）" text={lsp.text} tone={lsp.tone} />
      <PluginRow name="调试适配器" desc="debugpy — 断点、单步、变量与调用栈" text={dbg.text} tone={dbg.tone} />
      <PluginRow name="集成终端" desc="ConPTY + xterm.js 本地终端" text="已启用" tone="ok" />
      <PluginRow
        name="Git 集成"
        desc="git CLI — 状态标记、暂存、提交、推送/拉取"
        text={gitEnabled === false ? "已禁用" : info?.repo ? `已连接 · ${info.branch ?? ""}` : "未检测到仓库"}
        tone={gitEnabled === false ? "warn" : info?.repo ? "ok" : "warn"}
      />
      <PluginRow name="文件监视" desc="notify — 外部修改自动刷新项目树与缓冲区" text="运行中" tone="ok" />
    </>
  );
}

// --- 工具 › 智能体 ---------------------------------------------------------------

function AgentSettingsPage({ val, set }: { val: Getter; set: Setter }) {
  return (
    <>
      <div className={styles.row}>
        <div className={styles.rowLabel}>API 地址:</div>
        <div className={styles.control}>
          <input
            className={styles.input}
            style={{ width: 340 }}
            value={val("aiEndpoint") ?? ""}
            placeholder="https://api.openai.com/v1"
            onChange={(e) => set({ aiEndpoint: e.target.value })}
          />
        </div>
      </div>
      <div className={styles.row}>
        <div className={styles.rowLabel}>API Key:</div>
        <div className={styles.control}>
          <input
            className={styles.input}
            style={{ width: 340 }}
            type="password"
            value={val("aiApiKey") ?? ""}
            placeholder="sk-…"
            onChange={(e) => set({ aiApiKey: e.target.value })}
          />
        </div>
      </div>
      <div className={styles.row}>
        <div className={styles.rowLabel}>模型:</div>
        <div className={styles.control}>
          <input
            className={styles.input}
            style={{ width: 340 }}
            value={val("aiModel") ?? ""}
            placeholder="gpt-4o-mini"
            onChange={(e) => set({ aiModel: e.target.value })}
          />
        </div>
      </div>
      <div className={styles.sectionTitle}>说明</div>
      <div className={styles.hint}>
        兼容 OpenAI /chat/completions 格式的任意服务商：OpenAI、DeepSeek（https://api.deepseek.com/v1）、Kimi、通义，或本地
        Ollama（http://localhost:11434/v1，Key 随意填）。Key 只保存在本机配置文件中。
      </div>
    </>
  );
}

// --- 项目结构 -------------------------------------------------------------------

function ProjectStructurePage({ val, set }: { val: Getter; set: Setter }) {
  const root = useProject((s) => s.root);
  const [dirs, setDirs] = useState<string[] | null>(null);

  useEffect(() => {
    if (!root) {
      setDirs(null);
      return;
    }
    let alive = true;
    void ipc
      .fsReadDir(root)
      .then((es) => {
        if (alive)
          setDirs(
            es
              .filter((e) => e.kind === "dir" && ![".git", ".hg", ".svn", "__pycache__"].includes(e.name))
              .map((e) => e.name)
              .sort(),
          );
      })
      .catch(() => alive && setDirs([]));
    return () => {
      alive = false;
    };
  }, [root]);

  if (!root) return <div className={styles.placeholder}>打开项目后可管理其目录结构。</div>;
  const all = val("excludedDirs") ?? {};
  const excluded = new Set((all[root] ?? []).map((r) => r.replace(/\\/g, "/").replace(/\/+$/, "")));
  const toggle = (name: string, on: boolean) => {
    const next = new Set(excluded);
    if (on) next.add(name);
    else next.delete(name);
    set({ excludedDirs: { ...all, [root]: [...next].sort() } });
  };
  return (
    <>
      <div className={styles.row}>
        <div className={styles.rowLabel}>内容根:</div>
        <div className={styles.control}>
          <span className={styles.pathBox}>{root}</span>
        </div>
      </div>
      <div className={styles.sectionTitle}>排除的目录（顶层）</div>
      <div className={styles.hint} style={{ marginBottom: 10 }}>
        勾选后目录将从项目树隐藏，pyright 也会跳过对其的分析（应用后自动重启语言服务）。
      </div>
      {dirs === null ? (
        <div className={styles.hint}>读取目录…</div>
      ) : dirs.length === 0 ? (
        <div className={styles.hint}>项目根下没有子目录。</div>
      ) : (
        dirs.map((name) => (
          <label key={name} className={styles.checkRow}>
            <input type="checkbox" className={styles.check} checked={excluded.has(name)} onChange={(e) => toggle(name, e.target.checked)} />
            <span className={styles.checkCol} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Icon name="folder" size={14} />
              {name}
            </span>
          </label>
        ))
      )}
    </>
  );
}
