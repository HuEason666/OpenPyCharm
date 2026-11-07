/**
 * Welcome window (IntelliJ-style): brand + navigation rail, recent projects
 * with search, a Customize page and a Plugins placeholder.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import logo from "../../src-tauri/icons/icon.png";
import { Icon } from "../ui/icons";
import { PopupMenu, type MenuItem } from "../ui/PopupMenu";
import { useProject } from "../platform/project";
import { useSettings } from "../platform/settings";
import { applyTheme } from "../platform/theme";
import { openFolderDialog } from "../features/openProject";
import { ipc } from "../platform/ipc";
import { pathBase } from "../platform/paths";
import { useOverlay } from "./overlays";
import styles from "./Welcome.module.css";

type WelcomePage = "projects" | "customize" | "plugins";

const BADGE_HUES = [262, 330, 20, 190, 145, 45, 275];

function ProjectBadge({ name }: { name: string }) {
  const hash = [...name].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) | 0, 0);
  const hue = BADGE_HUES[Math.abs(hash) % BADGE_HUES.length];
  const parts = name.split(/[\s._-]+/).filter(Boolean);
  const initials = /^[A-Za-z]/.test(name)
    ? parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join("")
    : name.slice(0, 1);
  return (
    <span
      className={styles.badge}
      style={{ background: `linear-gradient(135deg, hsl(${hue} 55% 52%), hsl(${hue + 18} 52% 40%))` }}
      aria-hidden
    >
      {initials || "P"}
    </span>
  );
}

function useAppVersion(): string {
  const [version, setVersion] = useState("");
  useEffect(() => {
    void ipc
      .appInfo()
      .then((info) => setVersion(info.version))
      .catch(() => {});
  }, []);
  return version;
}

function NavItem({
  label,
  page,
  current,
  onSelect,
}: {
  label: string;
  page: WelcomePage;
  current: WelcomePage;
  onSelect: (page: WelcomePage) => void;
}) {
  return (
    <button
      type="button"
      className={styles.navItem}
      data-active={page === current || undefined}
      aria-current={page === current ? "page" : undefined}
      onClick={() => onSelect(page)}
    >
      {label}
    </button>
  );
}

export function Welcome() {
  const [page, setPage] = useState<WelcomePage>("projects");
  const version = useAppVersion();

  return (
    <div className={styles.welcome}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <img className={styles.logo} src={logo} alt="" draggable={false} />
          <div className={styles.brandText}>
            <span className={styles.appName}>OpenPyCharm</span>
            {version ? <span className={styles.version}>{version}</span> : null}
          </div>
        </div>
        <p className={styles.tagline}>受 PyCharm 启发的开源 Python IDE</p>
        <nav className={styles.nav} aria-label="Welcome">
          <NavItem label="Projects" page="projects" current={page} onSelect={setPage} />
          <NavItem label="Customize" page="customize" current={page} onSelect={setPage} />
          <NavItem label="Plugins" page="plugins" current={page} onSelect={setPage} />
        </nav>
        <div className={styles.spacer} />
        <div className={styles.sidebarFooter}>
          <button
            type="button"
            className={styles.gear}
            title="设置"
            aria-label="设置"
            onClick={() => useOverlay.getState().open({ type: "settings" })}
          >
            <Icon name="settings" size={18} />
          </button>
        </div>
      </aside>
      <main className={styles.content}>
        {page === "projects" ? <ProjectsPage /> : null}
        {page === "customize" ? <CustomizePage /> : null}
        {page === "plugins" ? <PluginsPage /> : null}
      </main>
    </div>
  );
}

async function removeRecent(path: string): Promise<void> {
  const yes = await ask(`从最近项目列表移除“${pathBase(path)}”?`, {
    title: "移除最近项目",
    kind: "warning",
  });
  if (!yes) return;
  try {
    await ipc.removeRecentProject(path);
  } finally {
    await useProject.getState().refreshRecents();
  }
}

function ProjectsPage() {
  const recents = useProject((s) => s.recents);
  const refreshRecents = useProject((s) => s.refreshRecents);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [popup, setPopup] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void refreshRecents();
  }, [refreshRecents]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return recents;
    return recents.filter(
      (path) => path.toLowerCase().includes(needle) || pathBase(path).toLowerCase().includes(needle),
    );
  }, [recents, query]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    if (selected > visible.length - 1) setSelected(Math.max(0, visible.length - 1));
  }, [visible.length, selected]);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const menuFor = (path: string): MenuItem[] => [
    { type: "item", label: "打开", icon: "folder-open", onSelect: () => void useProject.getState().open(path) },
    {
      type: "item",
      label: "在资源管理器中显示",
      icon: "external-link",
      onSelect: () => void ipc.fsRevealInShell(path).catch(() => {}),
    },
    {
      type: "item",
      label: "复制路径",
      icon: "copy",
      onSelect: () => void navigator.clipboard.writeText(path).catch(() => {}),
    },
    { type: "separator" },
    { type: "item", label: "从最近项目移除", icon: "close", danger: true, onSelect: () => void removeRecent(path) },
  ];

  const openMore = (event: MouseEvent<HTMLButtonElement>, path: string) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setPopup({ x: rect.right - 210, y: rect.bottom + 2, items: menuFor(path) });
  };

  const openFromKeyboard = () => {
    const path = visible[selected];
    if (path) void useProject.getState().open(path);
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!visible.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((index) => Math.min(index + 1, visible.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      openFromKeyboard();
    }
  };

  const hasQuery = query.trim().length > 0;

  return (
    <div className={styles.projects}>
      <div className={styles.header}>
        <div className={styles.search}>
          <Icon name="search" size={14} />
          <input
            ref={searchRef}
            value={query}
            placeholder="搜索项目"
            aria-label="搜索项目"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                listRef.current?.focus();
              } else if (event.key === "Enter" && query.trim()) {
                event.preventDefault();
                listRef.current?.focus();
              }
            }}
          />
          {query ? (
            <button type="button" className={styles.clearSearch} title="清除" onClick={() => setQuery("")}>
              <Icon name="close" size={12} />
            </button>
          ) : null}
        </div>
        <div className={styles.headerButtons}>
          <button type="button" className={styles.headerButton} onClick={() => void openFolderDialog()}>
            打开
          </button>
          <button
            type="button"
            className={styles.headerButton}
            onClick={() => useOverlay.getState().open({ type: "clone" })}
          >
            克隆仓库
          </button>
          <button type="button" className={styles.headerButton} disabled title="远程开发尚未实现">
            远程开发
          </button>
        </div>
      </div>

      {visible.length ? (
        <div
          ref={listRef}
          className={styles.projectList}
          role="listbox"
          aria-label="最近项目"
          tabIndex={0}
          onKeyDown={onListKeyDown}
        >
          {visible.map((path, index) => (
            <div
              key={path}
              role="option"
              aria-selected={index === selected}
              data-selected={index === selected || undefined}
              className={styles.project}
              title={path}
              onMouseEnter={() => setSelected(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void useProject.getState().open(path)}
              onContextMenu={(event) => {
                event.preventDefault();
                setSelected(index);
                setPopup({ x: event.clientX, y: event.clientY, items: menuFor(path) });
              }}
            >
              <ProjectBadge name={pathBase(path)} />
              <div className={styles.projectText}>
                <span className={styles.projectName}>{pathBase(path)}</span>
                <span className={styles.projectPath}>{path}</span>
              </div>
              <button
                type="button"
                className={styles.more}
                title="项目操作"
                aria-label="项目操作"
                onClick={(event) => openMore(event, path)}
              >
                <Icon name="more-horizontal" size={16} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <Landing filtered={hasQuery} />
      )}

      {popup ? (
        <PopupMenu x={popup.x} y={popup.y} items={popup.items} onClose={() => setPopup(null)} />
      ) : null}
    </div>
  );
}

function Landing({ filtered }: { filtered: boolean }) {
  if (filtered) {
    return <div className={styles.noMatches}>没有匹配的项目</div>;
  }
  return (
    <div className={styles.landing}>
      <img className={styles.landingLogo} src={logo} alt="" />
      <div className={styles.landingTitle}>欢迎使用 OpenPyCharm</div>
      <p className={styles.landingText}>从磁盘打开一个项目，或克隆一个 Git 仓库开始。</p>
      <div className={styles.landingActions}>
        <button type="button" className={styles.landingButton} onClick={() => void openFolderDialog()}>
          <Icon name="folder-open" size={18} />
          打开文件夹
        </button>
        <button
          type="button"
          className={styles.landingButton}
          onClick={() => useOverlay.getState().open({ type: "clone" })}
        >
          <Icon name="branch" size={18} />
          克隆仓库
        </button>
      </div>
    </div>
  );
}

function CustomizePage() {
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const [fontSize, setFontSize] = useState(String(settings.fontSize));

  const chooseTheme = (theme: "dark" | "light") => {
    applyTheme(theme);
    void update({ theme });
  };

  const applyFontSize = () => {
    const size = Math.min(32, Math.max(9, Number(fontSize) || 13));
    setFontSize(String(size));
    void update({ fontSize: size });
  };

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1>Customize</h1>
        <p>调整外观和编辑器字号；更多设置在设置窗口中。</p>
      </div>
      <div className={styles.settingGroup}>
        <div className={styles.settingLabel}>外观</div>
        <div className={styles.choiceRow}>
          <button
            type="button"
            className={styles.choice}
            data-active={settings.theme === "dark" || undefined}
            onClick={() => chooseTheme("dark")}
          >
            深色
          </button>
          <button
            type="button"
            className={styles.choice}
            data-active={settings.theme === "light" || undefined}
            onClick={() => chooseTheme("light")}
          >
            浅色
          </button>
        </div>
      </div>
      <div className={styles.settingGroup}>
        <div className={styles.settingLabel}>编辑器字号</div>
        <div className={styles.sizeRow}>
          <input
            className={styles.sizeInput}
            type="number"
            min={9}
            max={32}
            value={fontSize}
            onChange={(event) => setFontSize(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") applyFontSize();
            }}
          />
          <span className={styles.unit}>px</span>
          <button type="button" className={styles.headerButton} onClick={applyFontSize}>
            应用
          </button>
        </div>
      </div>
      <div className={styles.settingGroup}>
        <div className={styles.settingLabel}>键位</div>
        <div className={styles.settingValue}>IntelliJ Windows</div>
      </div>
      <button
        type="button"
        className={styles.headerButton}
        onClick={() => useOverlay.getState().open({ type: "settings" })}
      >
        打开完整设置…
      </button>
    </div>
  );
}

function PluginsPage() {
  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1>Plugins</h1>
        <p>插件系统计划中（Roadmap）。当前版本已内置编辑器、Python LSP、Git 和调试器。</p>
      </div>
      <div className={styles.settingValue}>插件市场与 WASM 插件宿主将在后续版本提供。</div>
    </div>
  );
}
