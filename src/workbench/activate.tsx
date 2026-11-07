/**
 * Feature activation: registers tool windows and all actions once at boot.
 * Every menu item, keymap binding and Search Everywhere entry resolves to an
 * action registered here.
 */
import { registerToolWindow } from "./toolwindows/ToolWindows";
import { useActions } from "../platform/actions";
import { ProjectView } from "../features/project-tree/ProjectView";
import { StructureView } from "../features/structure/StructureView";
import { ProblemsView } from "../features/problems/ProblemsView";
import { RunOutput, RunHeaderActions } from "../features/run/RunView";
import { DebugView } from "../features/debug/DebugView";
import { debugActiveFile } from "../features/debug/debugCurrent";
import { useDebug } from "../features/debug/store";
import { TerminalView, newTerminal } from "../features/terminal/TerminalView";
import { FindView } from "../features/search/FindView";
import { GitView } from "../features/git/GitView";
import { AgentView } from "../features/agent/AgentView";
import { DatabaseView } from "../features/db/DatabaseView";
import { startGitPolling, useGit } from "../features/git/store";
import { useToolWindows } from "./toolwindows/store";
import { toggleZenMode } from "./toolwindows/store";
import { useOverlay } from "./overlays";
import { useProject } from "../platform/project";
import { useDocs } from "../editor/docs";
import { usePython } from "../features/python/store";
import { runActiveFile } from "../features/python/runCurrent";
import { formatActiveFile, organizeImportsActiveFile, cleanupActiveFile } from "../features/python/formatCurrent";
import { openFolderDialog } from "../features/openProject";
import { ipc } from "../platform/ipc";
import { useSettings, type Settings } from "../platform/settings";
import { applyTheme, currentTheme, applyAppearance } from "../platform/theme";
import { startLsp, stopLsp, restartLsp } from "../platform/lsp";
import { showQuickDoc, showErrorDescription } from "../platform/quickInfo";
import { notify } from "../platform/notify";
import { revealInTree, refreshTreeAll } from "../features/project-tree/ProjectView";
import * as ed from "../editor/commands";
import { activeView } from "../editor/activeView";
import { canNavigateBack, canNavigateForward, navigateBack, navigateForward } from "../editor/navigation";
import { closeSearchPanel } from "@codemirror/search";

export function activateWorkbench(): void {
  registerToolWindow({
    id: "project",
    title: "项目",
    icon: "toolwindow-project",
    anchor: "left",
    component: () => <ProjectView />,
  });
  registerToolWindow({
    id: "run",
    title: "运行",
    icon: "toolwindow-run",
    anchor: "bottom",
    component: () => <RunOutput />,
    headerActions: () => <RunHeaderActions />,
  });
  registerToolWindow({
    id: "terminal",
    title: "终端",
    icon: "toolwindow-terminal",
    anchor: "bottom",
    component: () => <TerminalView />,
  });
  registerToolWindow({
    id: "find",
    title: "在文件中查找",
    icon: "toolwindow-find",
    anchor: "bottom",
    component: () => <FindView />,
  });
  registerToolWindow({
    id: "structure",
    title: "结构",
    icon: "toolwindow-structure",
    anchor: "right",
    component: () => <StructureView />,
  });
  registerToolWindow({
    id: "git",
    title: "Git",
    icon: "toolwindow-git",
    anchor: "bottom",
    component: () => <GitView />,
  });
  registerToolWindow({
    id: "debug",
    title: "调试",
    icon: "toolwindow-debug",
    anchor: "bottom",
    component: () => <DebugView />,
  });
  registerToolWindow({
    id: "problems",
    title: "问题",
    icon: "toolwindow-problems",
    anchor: "bottom",
    component: () => <ProblemsView />,
  });
  registerToolWindow({
    id: "agent",
    title: "智能体",
    icon: "toolwindow-agents",
    anchor: "right",
    component: () => <AgentView />,
  });
  registerToolWindow({
    id: "database",
    title: "数据库",
    icon: "toolwindow-database",
    anchor: "right",
    component: () => <DatabaseView />,
  });

  const whenProject = (ctx: { projectRoot: string | null }) => !!ctx.projectRoot;
  const whenDoc = (ctx: { activeDoc: string | null }) => !!ctx.activeDoc;
  const whenPaused = () => useDebug.getState().status === "paused";
  const whenDebugging = () => ["starting", "running", "paused"].includes(useDebug.getState().status);

  const toggleBp = (): void => {
    const docs = useDocs.getState();
    const id = docs.activeId;
    if (!id) return;
    void import("../features/debug/breakpoints").then(({ toggleBreakpoint }) => {
      const doc = docs.docs.find((d) => d.id === id);
      toggleBreakpoint(id, doc?.caret.line ?? 1);
    });
  };

  useActions.getState().registerAll([
    // Files
    { id: "file.open", title: "Open Folder…", run: () => void openFolderDialog() },
    {
      id: "file.new",
      title: "New File…",
      when: whenProject,
      run: () => {
        const root = useProject.getState().root;
        if (root) useOverlay.getState().open({ type: "newFile", dir: root });
      },
    },
    { id: "file.saveAll", title: "Save All", when: whenDoc, run: () => useDocs.getState().saveAll() },
    { id: "file.settings", title: "Settings…", run: () => useOverlay.getState().open({ type: "settings" }) },
    // Navigate
    { id: "navigate.searchEverywhere", title: "Search Everywhere", run: () => useOverlay.getState().open({ type: "searchEverywhere" }) },
    { id: "navigate.gotoFile", title: "Go to File…", run: () => useOverlay.getState().open({ type: "searchEverywhere", tab: "files" }) },
    { id: "navigate.gotoClass", title: "Go to File…", run: () => useOverlay.getState().open({ type: "searchEverywhere", tab: "files" }) },
    { id: "navigate.gotoLine", title: "Go to Line:Column…", when: whenDoc, run: () => useOverlay.getState().open({ type: "gotoLine" }) },
    { id: "navigate.recentFiles", title: "Recent Files", run: () => useOverlay.getState().open({ type: "searchEverywhere" }) },
    { id: "navigate.findAction", title: "Find Action…", run: () => useOverlay.getState().open({ type: "searchEverywhere", tab: "actions" }) },
    {
      id: "navigate.fileStructure",
      title: "File Structure",
      when: whenDoc,
      run: () => useToolWindows.getState().show("structure"),
    },
    {
      id: "navigate.back",
      title: "Back",
      when: () => canNavigateBack(),
      run: () => navigateBack(),
    },
    {
      id: "navigate.forward",
      title: "Forward",
      when: () => canNavigateForward(),
      run: () => navigateForward(),
    },
    // Find
    { id: "find.inFile", title: "Find", when: whenDoc, run: () => ed.findInFile() },
    { id: "find.replaceInFile", title: "Replace", when: whenDoc, run: () => ed.replaceInFile() },
    {
      id: "find.inPath",
      title: "Find in Files",
      when: whenProject,
      run: () => useToolWindows.getState().show("find"),
    },
    // Editor
    {
      id: "editor.closeTab",
      title: "Close Tab",
      when: whenDoc,
      run: () => {
        const id = useDocs.getState().activeId;
        if (id) useDocs.getState().closeDoc(id);
      },
    },
    {
      id: "editor.nextTab",
      title: "Select Next Tab",
      when: whenDoc,
      run: () => cycleTab(1),
    },
    {
      id: "editor.prevTab",
      title: "Select Previous Tab",
      when: whenDoc,
      run: () => cycleTab(-1),
    },
    {
      id: "editor.undo",
      title: "Undo",
      when: whenDoc,
      run: () => {
        const view = activeView();
        if (view) ed.undo(view);
      },
    },
    {
      id: "editor.redo",
      title: "Redo",
      when: whenDoc,
      run: () => {
        const view = activeView();
        if (view) ed.redo(view);
      },
    },
    {
      id: "editor.escape",
      title: "Escape",
      run: () => {
        // Overlay → editor search panel → active tool window.
        if (useOverlay.getState().current) {
          useOverlay.getState().close();
          return;
        }
        const view = activeView();
        if (view && view.dom.querySelector(".cm-panels")) {
          closeSearchPanel(view);
          return;
        }
        useToolWindows.getState().hideActive();
      },
    },
    { id: "editor.selectAll", title: "Select All", when: whenDoc, run: () => { const v = activeView(); if (v) ed.selectAll(v); } },
    {
      id: "editor.copyPath",
      title: "Copy Path",
      when: whenDoc,
      run: () => {
        const id = useDocs.getState().activeId;
        if (id) void navigator.clipboard.writeText(id).catch(() => {});
      },
    },
    {
      id: "editor.closeOthersTab",
      title: "Close Other Tabs",
      when: whenDoc,
      run: () => {
        const id = useDocs.getState().activeId;
        if (id) useDocs.getState().closeOthers(id);
      },
    },
    {
      id: "editor.closeAllTabs",
      title: "Close All Tabs",
      when: whenDoc,
      run: () => useDocs.getState().closeAll(),
    },
    {
      id: "file.reloadFromDisk",
      title: "Reload All from Disk",
      when: whenDoc,
      run: () => void reloadCleanDocsFromDisk(),
    },
    {
      id: "view.toggleFullscreen",
      title: "Toggle Full Screen",
      run: () => {
        void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
          const w = getCurrentWindow();
          const fs = await w.isFullscreen().catch(() => false);
          await w.setFullscreen(!fs).catch(() => {});
        });
      },
    },
    // Code
    { id: "code.commentLine", title: "Comment with Line Comment", when: whenDoc, run: () => ed.commentLine() },
    { id: "code.blockComment", title: "Comment with Block Comment", when: whenDoc, run: () => { const v = activeView(); if (v) ed.toggleBlockComment(v); } },
    { id: "code.duplicateLine", title: "Duplicate Line or Selection", when: whenDoc, run: () => ed.duplicateLine() },
    { id: "code.deleteLine", title: "Delete Line", when: whenDoc, run: () => ed.deleteLine() },
    { id: "code.moveLineUp", title: "Move Line Up", when: whenDoc, run: () => ed.moveLineUp() },
    { id: "code.moveLineDown", title: "Move Line Down", when: whenDoc, run: () => ed.moveLineDown() },
    { id: "code.reformat", title: "Reformat Code", when: whenDoc, run: () => void formatActiveFile() },
    { id: "code.autoIndent", title: "Auto-Indent Lines", when: whenDoc, run: () => { const v = activeView(); if (v) ed.indentSelection(v); } },
    { id: "code.selectExpand", title: "Extend Selection", when: whenDoc, run: () => ed.extendSelection() },
    { id: "code.selectShrink", title: "Shrink Selection", when: whenDoc, run: () => ed.shrinkSelection() },
    { id: "code.foldToggle", title: "Fold / Unfold", when: whenDoc, run: () => { const v = activeView(); if (v) ed.foldCode(v); } },
    { id: "code.unfoldToggle", title: "Unfold", when: whenDoc, run: () => { const v = activeView(); if (v) ed.unfoldCode(v); } },
    { id: "code.foldAll", title: "Fold All", when: whenDoc, run: () => { const v = activeView(); if (v) ed.foldAll(v); } },
    { id: "code.unfoldAll", title: "Unfold All", when: whenDoc, run: () => { const v = activeView(); if (v) ed.unfoldAll(v); } },
    { id: "code.parameterInfo", title: "Parameter Info", when: whenDoc, run: () => { const v = activeView(); if (v) void import("@codemirror/lsp-client").then(({ showSignatureHelp }) => showSignatureHelp(v)); } },
    { id: "refactor.rename", title: "Rename…", when: whenDoc, run: () => { const v = activeView(); if (v) void import("../platform/lspRename").then(({ renameSymbolCommand }) => renameSymbolCommand(v)); } },
    // Navigate: declaration/definition through the language server (Ctrl+B)
    {
      id: "navigate.declaration",
      title: "Go to Declaration or Usages",
      when: whenDoc,
      run: () => {
        const view = activeView();
        if (view) void import("@codemirror/lsp-client").then(({ jumpToDeclaration }) => jumpToDeclaration(view));
      },
    },
    {
      id: "navigate.implementation",
      title: "Go to Type Declaration",
      when: whenDoc,
      run: () => {
        const view = activeView();
        if (view) void import("@codemirror/lsp-client").then(({ jumpToTypeDefinition }) => jumpToTypeDefinition(view));
      },
    },
    { id: "navigate.nextError", title: "Next Highlighted Error", when: whenDoc, run: () => ed.nextError() },
    { id: "navigate.prevError", title: "Previous Highlighted Error", when: whenDoc, run: () => ed.prevError() },
    {
      id: "navigate.filePath",
      title: "File Path",
      when: whenDoc,
      run: () => {
        const id = useDocs.getState().activeId;
        if (id) void ipc.fsRevealInShell(id).catch(() => {});
      },
    },
    // Tool windows
    { id: "toolwindow.project", title: "Project Tool Window", when: whenProject, run: () => useToolWindows.getState().activate("project") },
    { id: "toolwindow.run", title: "Run Tool Window", when: whenProject, run: () => useToolWindows.getState().activate("run") },
    { id: "toolwindow.terminal", title: "Terminal Tool Window", when: whenProject, run: () => useToolWindows.getState().activate("terminal") },
    { id: "toolwindow.find", title: "Find Tool Window", when: whenProject, run: () => useToolWindows.getState().activate("find") },
    { id: "toolwindow.structure", title: "Structure Tool Window", when: whenDoc, run: () => useToolWindows.getState().activate("structure") },
    { id: "toolwindow.git", title: "Git Tool Window", when: whenProject, run: () => useToolWindows.getState().activate("git") },
    { id: "toolwindow.debug", title: "Debug Tool Window", when: whenProject, run: () => useToolWindows.getState().activate("debug") },
    { id: "toolwindow.problems", title: "Problems Tool Window", when: whenProject, run: () => useToolWindows.getState().activate("problems") },
    { id: "toolwindow.agent", title: "Agent Tool Window", run: () => useToolWindows.getState().activate("agent") },
    { id: "toolwindow.database", title: "Database Tool Window", run: () => useToolWindows.getState().activate("database") },
    { id: "toolwindow.hideAll", title: "Hide All Tool Windows", run: () => useToolWindows.getState().hideAll() },
    { id: "toolwindow.hideActive", title: "Hide Active Tool Window", run: () => useToolWindows.getState().hideActive() },
    { id: "toolwindow.maximize", title: "Maximize Tool Window", run: () => {} },
    // VCS
    {
      id: "vcs.commit",
      title: "Commit…",
      when: whenProject,
      run: () => {
        useToolWindows.getState().show("git");
      },
    },
    {
      id: "vcs.push",
      title: "Push…",
      when: whenProject,
      run: () => {
        useToolWindows.getState().show("git");
        void useGit
          .getState()
          .push()
          .then((msg) => console.log(msg))
          .catch((e) => console.error("push failed", e));
      },
    },
    {
      id: "vcs.pull",
      title: "Pull",
      when: whenProject,
      run: () => {
        useToolWindows.getState().show("git");
        void useGit
          .getState()
          .pull()
          .then((msg) => console.log(msg))
          .catch((e) => console.error("pull failed", e));
      },
    },
    // Run
    { id: "run.run", title: "Run current file", when: whenProject, run: () => void runActiveFile() },
    { id: "run.debug", title: "Debug current file", when: whenProject, run: () => void debugActiveFile() },
    { id: "run.runContext", title: "Run with context", when: whenProject, run: () => void runActiveFile() },
    { id: "run.chooseConfig", title: "Run…", when: whenProject, run: () => useOverlay.getState().open({ type: "runConfigPicker" }) },
    { id: "run.stop", title: "Stop", run: () => void stopActiveRun() },
    // Debug session controls
    { id: "debug.resume", title: "Resume Program", when: whenPaused, run: () => useDebug.getState().resume() },
    { id: "debug.pause", title: "Pause Program", when: whenDebugging, run: () => useDebug.getState().pause() },
    {
      id: "debug.toggleLineBreakpoint",
      title: "Toggle Line Breakpoint",
      when: whenDoc,
      run: () => {
        const docs = useDocs.getState();
        const id = docs.activeId;
        if (!id) return;
        void import("../features/debug/breakpoints").then(({ toggleBreakpoint }) => {
          const doc = docs.docs.find((d) => d.id === id);
          toggleBreakpoint(id, doc?.caret.line ?? 1);
        });
      },
    },
    { id: "debug.stepOver", title: "Step Over", when: whenPaused, run: () => useDebug.getState().stepOver() },
    { id: "debug.stepInto", title: "Step Into", when: whenPaused, run: () => useDebug.getState().stepInto() },
    { id: "debug.stepOut", title: "Step Out", when: whenPaused, run: () => useDebug.getState().stepOut() },
    { id: "debug.stop", title: "Stop Debugger", when: whenDebugging, run: () => void useDebug.getState().stop() },
    // Terminal
    { id: "terminal.new", title: "New Terminal", when: whenProject, run: () => void newTerminal() },
    // View
    {
      id: "view.toggleTheme",
      title: "Toggle Theme",
      run: () => {
        const next = currentTheme() === "dark" ? "light" : "dark";
        applyTheme(next);
        void useSettings.getState().update({ theme: next });
      },
    },
    // Tools
    {
      id: "tools.revealInShell",
      title: "Open in Explorer",
      when: whenProject,
      run: () => {
        const root = useProject.getState().root;
        if (root) void ipc.fsRevealInShell(root).catch(() => {});
      },
    },
    // Help
    { id: "help.about", title: "About", run: () => useOverlay.getState().open({ type: "about" }) },

    // ---- 文件：新建项目 / 临时文件 / 新窗口 / 重命名 / 属性 / 缓存 / 设置导入导出 ----
    { id: "file.newProject", title: "New Project…", run: () => useOverlay.getState().open({ type: "newProject" }) },
    {
      id: "file.newScratch",
      title: "New Scratch File…",
      run: async () => {
        try {
          const path = await ipc.fsCreateScratch("py");
          void useDocs.getState().openDoc(path, "");
        } catch (e) {
          console.error(e);
        }
      },
    },
    {
      id: "file.openInNewWindow",
      title: "Open in New Window…",
      run: async () => {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const dir = await open({ directory: true, title: "在新窗口中打开" });
        if (typeof dir !== "string") return;
        const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        const existing = await WebviewWindow.getByLabel("editor");
        if (existing) {
          await existing.setFocus();
          await existing.emit("opc:open-project", dir);
          return;
        }
        const win = new WebviewWindow("editor", {
          url: `index.html?project=${encodeURIComponent(dir)}`,
          title: "OpenPyCharm",
          width: 1360,
          height: 900,
        });
        win.once("tauri://error", (e) => console.error("open in new window failed", e));
      },
    },
    { id: "file.renameProject", title: "Rename Project…", when: whenProject, run: () => useOverlay.getState().open({ type: "renameProject" }) },
    { id: "file.properties", title: "File Properties…", when: whenProject, run: () => useOverlay.getState().open({ type: "fileProperties" }) },
    {
      id: "file.clearCaches",
      title: "Invalidate Caches…",
      run: async () => {
        const { ask } = await import("@tauri-apps/plugin-dialog");
        const yes = await ask("清除本地缓存（窗口布局等）并重启 IDE？设置与最近项目会保留。", {
          title: "清除缓存",
          kind: "warning",
        });
        if (!yes) return;
        for (const key of [...localStorage.keys()]) {
          if (key.startsWith("openpycharm.")) localStorage.removeItem(key);
        }
        window.location.reload();
      },
    },
    {
      id: "file.exportSettings",
      title: "Export Settings…",
      run: async () => {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const path = await save({
          title: "导出设置",
          defaultPath: "openpycharm-settings.json",
          filters: [{ name: "JSON", extensions: ["json"] }],
        });
        if (!path) return;
        await ipc.fsWriteText(path, JSON.stringify(useSettings.getState().settings, null, 2));
        notify("success", "设置已导出");
      },
    },
    {
      id: "file.importSettings",
      title: "Import Settings…",
      run: async () => {
        const { open, message } = await import("@tauri-apps/plugin-dialog");
        const sel = await open({
          title: "导入设置",
          multiple: false,
          filters: [{ name: "JSON", extensions: ["json"] }],
        });
        if (typeof sel !== "string") return;
        try {
          const raw = await ipc.fsReadText(sel);
          const parsed = JSON.parse(raw.text) as Partial<Settings>;
          if (!parsed || typeof parsed !== "object" || parsed.theme === undefined) {
            throw new Error("不是有效的 OpenPyCharm 设置文件（缺少 theme 字段）");
          }
          await ipc.settingsSet({ ...useSettings.getState().settings, ...parsed });
          await useSettings.getState().load();
          applyAppearance(useSettings.getState().settings);
          notify("success", "设置已导入");
        } catch (e) {
          await message(String(e), { title: "导入设置", kind: "error" });
        }
      },
    },

    // ---- 视图：省电模式 / 禅模式 / 重设字号 / 通知设置 ----
    {
      id: "view.powerSave",
      title: "Power Save Mode",
      run: async () => {
        const next = useSettings.getState().settings.powerSave !== true;
        await useSettings.getState().update({ powerSave: next });
        notify("info", next ? "省电模式已开启：语言服务已停用" : "省电模式已关闭：语言服务已恢复");
      },
    },
    { id: "view.zenMode", title: "Toggle Zen Mode", run: () => toggleZenMode() },
    {
      id: "view.resetFontSize",
      title: "Reset Font Size in All Editors",
      run: () => void useSettings.getState().update({ fontSize: 13 }),
    },
    {
      id: "view.notifications",
      title: "Notification Settings",
      run: () => useOverlay.getState().open({ type: "settings", page: "appearance.notifications" }),
    },

    // ---- 导航：选择位置 / 最近的位置 / 方法跳转 ----
    {
      id: "navigate.selectLocation",
      title: "Select In…",
      when: whenDoc,
      run: () => {
        const id = useDocs.getState().activeId;
        if (!id) return;
        useToolWindows.getState().show("project");
        revealInTree(id);
      },
    },
    { id: "navigate.recentLocations", title: "Recent Locations…", when: whenDoc, run: () => useOverlay.getState().open({ type: "recentLocations" }) },
    { id: "navigate.nextMethod", title: "Next Method", when: whenDoc, run: () => ed.gotoNextMethod() },
    { id: "navigate.prevMethod", title: "Previous Method", when: whenDoc, run: () => ed.gotoPrevMethod() },

    // ---- 代码：补全 / 快速文档 / 错误描述 / 导入优化 / 清理 / 检查 ----
    { id: "code.triggerCompletion", title: "Basic Completion", when: whenDoc, run: () => ed.triggerCompletion() },
    { id: "code.typeCompletion", title: "Type Completion", when: whenDoc, run: () => ed.triggerCompletion() },
    { id: "code.quickDoc", title: "Quick Documentation", when: whenDoc, run: () => void showQuickDoc("快速文档") },
    { id: "code.typeInfo", title: "Expression Type", when: whenDoc, run: () => void showQuickDoc("表达式类型信息") },
    { id: "code.errorDescription", title: "Error Description", when: whenDoc, run: () => showErrorDescription() },
    { id: "code.organizeImports", title: "Optimize Imports", when: whenDoc, run: () => void organizeImportsActiveFile() },
    { id: "code.cleanup", title: "Code Cleanup…", when: whenDoc, run: () => void cleanupActiveFile() },
    { id: "code.inspectCode", title: "Inspect Code…", when: whenProject, run: () => useToolWindows.getState().show("problems") },
    { id: "code.moveStatementUp", title: "Move Statement Up", when: whenDoc, run: () => ed.moveLineUp() },
    { id: "code.moveStatementDown", title: "Move Statement Down", when: whenDoc, run: () => ed.moveLineDown() },
    { id: "code.sortLines", title: "Sort Lines", when: whenDoc, run: () => ed.sortLines() },
    { id: "code.reverseLines", title: "Reverse Lines", when: whenDoc, run: () => ed.reverseLines() },

    // ---- 重构：移动 / 复制 / 安全删除（重命名已有）----
    { id: "refactor.move", title: "Move…", when: whenDoc, run: () => { const id = useDocs.getState().activeId; if (id) useOverlay.getState().open({ type: "moveFile", path: id }); } },
    { id: "refactor.copy", title: "Copy…", when: whenDoc, run: () => { const id = useDocs.getState().activeId; if (id) useOverlay.getState().open({ type: "copyFile", path: id }); } },
    {
      id: "refactor.safeDelete",
      title: "Safe Delete…",
      when: whenDoc,
      run: async () => {
        const docs = useDocs.getState();
        const id = docs.activeId;
        if (!id) return;
        const { ask } = await import("@tauri-apps/plugin-dialog");
        const yes = await ask(`确定安全删除 "${id}" 吗？`, { title: "安全删除", kind: "warning" });
        if (!yes) return;
        docs.closeDoc(id);
        await ipc.fsDelete(id, false);
        refreshTreeAll();
      },
    },

    // ---- 运行：调试上下文 / 运行任何内容 / 断点查看 ----
    { id: "run.debugContext", title: "Debug Context Configuration", when: whenProject, run: () => void debugActiveFile() },
    { id: "run.runAnything", title: "Run Anything…", run: () => useOverlay.getState().open({ type: "searchEverywhere" }) },
    { id: "debug.toggleTempBreakpoint", title: "Toggle Temporary Line Breakpoint", when: whenDoc, run: () => toggleBp() },
    { id: "debug.viewBreakpoints", title: "View Breakpoints…", when: whenProject, run: () => useOverlay.getState().open({ type: "breakpointsViewer" }) },

    // ---- Git：版本控制集成开关 / 还原 ----
    {
      id: "vcs.toggleIntegration",
      title: "Enable Version Control Integration…",
      when: whenProject,
      run: async () => {
        const s = useSettings.getState();
        const next = s.settings.gitEnabled === false;
        await s.update({ gitEnabled: next });
        if (next) void useGit.getState().refresh();
        notify("info", next ? "Git 集成已启用" : "Git 集成已停用（可在设置 › 版本控制 中恢复）");
      },
    },
    {
      id: "vcs.rollback",
      title: "Rollback…",
      when: whenDoc,
      run: async () => {
        const root = useProject.getState().root;
        const docs = useDocs.getState();
        const id = docs.activeId;
        if (!root || !id) return;
        const { ask } = await import("@tauri-apps/plugin-dialog");
        const yes = await ask(`放弃对 "${id}" 的全部本地修改并从 Git 恢复？此操作不可撤销。`, {
          title: "还原",
          kind: "warning",
        });
        if (!yes) return;
        try {
          await ipc.gitRestore(root, [id]);
          // 从磁盘重新打开，丢弃未保存缓冲。
          docs.closeDoc(id);
          await docs.openDoc(id);
          void useGit.getState().refresh();
          notify("success", "已从 Git 还原");
        } catch (e) {
          notify("error", `还原失败：${String(e)}`);
        }
      },
    },

    // ---- 工具：Python 控制台 ----
    {
      id: "tools.pythonConsole",
      title: "Python Console…",
      when: whenProject,
      run: async () => {
        const python = usePython.getState().selected?.path ?? "python";
        const { newPythonConsole } = await import("../features/terminal/TerminalView");
        await newPythonConsole(python);
        useToolWindows.getState().show("terminal");
      },
    },

    // ---- 帮助：检查更新 ----
    {
      id: "help.checkUpdates",
      title: "Check for Updates…",
      run: async () => {
        const { message } = await import("@tauri-apps/plugin-dialog");
        const info = await ipc.appInfo();
        await message(
          `OpenPyCharm ${info.version}（${info.os} ${info.osVersion}）\n\n这是本地构建的演示 IDE，暂无自动更新通道。`,
          { title: "检查更新" },
        );
      },
    },
  ]);

  // Warm up interpreter detection on project open.
  useProject.subscribe((s) => {
    if (s.root) {
      void usePython.getState().detect();
      void useGit.getState().refresh();
    }
  });
  startGitPolling();

  // One pyright session per open project; stopped when the project closes.
  // 省电模式 (powerSave) suppresses the language server entirely.
  let lspRoot: string | null = null;
  const syncLanguageServer = () => {
    const root = useProject.getState().root;
    if (root === lspRoot) return;
    lspRoot = root;
    if (!root || useSettings.getState().settings.powerSave === true) {
      stopLsp();
      return;
    }
    void (async () => {
      if (!usePython.getState().sdks.length) await usePython.getState().detect();
      await startLsp(root, usePython.getState().selected?.path ?? null);
    })();
  };
  useProject.subscribe(syncLanguageServer);
  syncLanguageServer();
  useSettings.subscribe((s, prev) => {
    if (s.settings.powerSave === prev.settings.powerSave) return;
    if (s.settings.powerSave === true) {
      stopLsp();
    } else {
      const root = useProject.getState().root;
      if (root) void restartLsp(root, usePython.getState().selected?.path ?? null);
    }
  });
}

async function stopActiveRun(): Promise<void> {
  const { useDebug } = await import("../features/debug/store");
  if (["starting", "running", "paused"].includes(useDebug.getState().status)) {
    await useDebug.getState().stop();
    return;
  }
  const { useRun } = await import("../features/run/store");
  await useRun.getState().stop();
}

function cycleTab(dir: 1 | -1): void {
  const docs = useDocs.getState();
  if (!docs.activeId || docs.docs.length < 2) return;
  const idx = docs.docs.findIndex((d) => d.id === docs.activeId);
  const next = (idx + dir + docs.docs.length) % docs.docs.length;
  docs.setActive(docs.docs[next].id);
}

/** "从磁盘全部重新加载": refresh clean documents from disk (dirty ones keep edits). */
async function reloadCleanDocsFromDisk(): Promise<void> {
  const { editorViewFor } = await import("../editor/EditorArea");
  const docs = useDocs.getState();
  for (const doc of docs.docs) {
    if (doc.dirty) continue;
    try {
      const f = await ipc.fsReadText(doc.path);
      const view = editorViewFor(doc.id);
      if (view && view.state.doc.toString() !== f.text) {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: f.text } });
        docs.markSaved(doc.id, f.text);
      }
    } catch {
      // File deleted externally — leave the buffer as-is.
    }
  }
}
