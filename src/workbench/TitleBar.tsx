/**
 * Title bar — PyCharm New UI style (对齐参考截图):
 *   [≡ 汉堡] [项目名 ˅] [⎇ 分支 ˅] …drag… [▶ 运行] [⚡ 调试] [🔍] [⚙] [— □ ×]
 * 主菜单形态可切（设置 › 外观 › 主菜单）：汉堡菜单按钮（默认，点 ≡ 弹出 12 个
 * 菜单的树）或合并菜单（常驻 12 个中文标题，悬停切换）。
 */
import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Icon } from "../ui/icons";
import { PopupMenu, type MenuItem } from "../ui/PopupMenu";
import { useProject } from "../platform/project";
import { useDocs } from "../editor/docs";
import { useGit } from "../features/git/store";
import { useSettings } from "../platform/settings";
import { executeAction } from "../platform/actions";
import { useOverlay } from "./overlays";
import { useRun } from "../features/run/store";
import { useDebug } from "../features/debug/store";
import { activeView } from "../editor/activeView";
import { EditorSelection } from "@codemirror/state";
import styles from "./TitleBar.module.css";

async function pasteClipboard(): Promise<void> {
  try {
    const text = await navigator.clipboard.readText();
    const view = activeView();
    if (view && text) {
      view.dispatch(view.state.replaceSelection(text), {
        selection: EditorSelection.cursor(view.state.selection.main.head + text.length),
        scrollIntoView: true,
      });
    }
  } catch {
    // Clipboard unavailable.
  }
}

const off = (label: string, hint?: string): MenuItem => ({ type: "item", label, hint, disabled: true });

interface MenuCtx {
  root: string | null;
  docsOpen: boolean;
  recents: string[];
  runActive: boolean;
  debugActive: boolean;
  debugPaused: boolean;
  powerSave: boolean;
  gitEnabled: boolean;
}

/** The full PyCharm menu tree (中文), mapped onto OpenPyCharm's actions. */
function buildMenus(ctx: MenuCtx): { label: string; items: MenuItem[] }[] {
  const { root, docsOpen, recents, runActive, debugActive, debugPaused, powerSave, gitEnabled } = ctx;
  const dis = (when: boolean) => (when ? undefined : true);

  return [
    {
      label: "文件",
      items: [
        { type: "item", label: "新建项目…", onSelect: () => void executeAction("file.newProject") },
        { type: "separator" },
        { type: "item", label: "新建…", hint: "Alt+Insert", icon: "plus", disabled: dis(!!root), onSelect: () => void executeAction("file.new") },
        { type: "item", label: "新建临时文件…", hint: "Ctrl+Alt+Shift+Insert", onSelect: () => void executeAction("file.newScratch") },
        { type: "item", label: "打开…", icon: "folder", onSelect: () => void executeAction("file.open") },
        { type: "item", label: "在新窗口中打开…", onSelect: () => void executeAction("file.openInNewWindow") },
        {
          type: "item",
          label: "最近打开",
          children: recents.length
            ? recents.slice(0, 10).map(
                (p): MenuItem => ({ type: "item", label: p, icon: "folder", onSelect: () => void useProject.getState().open(p) }),
              )
            : [off("暂无最近项目")],
        },
        { type: "item", label: "关闭项目", disabled: dis(!!root), onSelect: () => void useProject.getState().close() },
        { type: "item", label: "重命名项目…", disabled: dis(!!root), onSelect: () => void executeAction("file.renameProject") },
        { type: "separator" },
        { type: "item", label: "全部保存", hint: "Ctrl+S", disabled: dis(docsOpen), onSelect: () => void executeAction("file.saveAll") },
        { type: "item", label: "从磁盘全部重新加载", disabled: dis(docsOpen), onSelect: () => void executeAction("file.reloadFromDisk") },
        { type: "item", label: "文件属性…", disabled: dis(!!root), onSelect: () => void executeAction("file.properties") },
        { type: "separator" },
        { type: "item", label: "清除缓存…", onSelect: () => void executeAction("file.clearCaches") },
        { type: "separator" },
        {
          type: "item",
          label: "管理 IDE 设置",
          children: [
            { type: "item", label: "导入设置…", onSelect: () => void executeAction("file.importSettings") },
            { type: "item", label: "导出设置…", onSelect: () => void executeAction("file.exportSettings") },
          ],
        },
        { type: "separator" },
        {
          type: "item",
          label: "省电模式",
          icon: powerSave ? "check" : undefined,
          onSelect: () => void executeAction("view.powerSave"),
        },
        { type: "separator" },
        { type: "item", label: "设置…", hint: "Ctrl+Alt+S", icon: "settings", onSelect: () => useOverlay.getState().open({ type: "settings" }) },
        { type: "separator" },
        { type: "item", label: "退出", onSelect: () => void getCurrentWindow().close() },
      ],
    },
    {
      label: "编辑",
      items: [
        { type: "item", label: "撤销", hint: "Ctrl+Z", disabled: dis(docsOpen), onSelect: () => void executeAction("editor.undo") },
        { type: "item", label: "重做", hint: "Ctrl+Shift+Z", disabled: dis(docsOpen), onSelect: () => void executeAction("editor.redo") },
        { type: "separator" },
        { type: "item", label: "剪切", hint: "Ctrl+X", onSelect: () => void document.execCommand("cut") },
        { type: "item", label: "复制", hint: "Ctrl+C", onSelect: () => void document.execCommand("copy") },
        { type: "item", label: "粘贴", hint: "Ctrl+V", onSelect: () => void pasteClipboard() },
        { type: "item", label: "粘贴为纯文本", hint: "Ctrl+Alt+Shift+V", onSelect: () => void pasteClipboard() },
        { type: "item", label: "全选", hint: "Ctrl+A", disabled: dis(docsOpen), onSelect: () => void executeAction("editor.selectAll") },
        { type: "separator" },
        {
          type: "item",
          label: "查找",
          children: [
            { type: "item", label: "查找", hint: "Ctrl+F", disabled: dis(docsOpen), onSelect: () => void executeAction("find.inFile") },
            { type: "item", label: "替换", hint: "Ctrl+R", disabled: dis(docsOpen), onSelect: () => void executeAction("find.replaceInFile") },
            { type: "separator" },
            { type: "item", label: "在文件中查找", hint: "Ctrl+Shift+F", disabled: dis(!!root), onSelect: () => void executeAction("find.inPath") },
          ],
        },
        { type: "separator" },
        { type: "item", label: "复制路径", hint: "Ctrl+Shift+C", disabled: dis(docsOpen), onSelect: () => void executeAction("editor.copyPath") },
        { type: "separator" },
        { type: "item", label: "对行排序", disabled: dis(docsOpen), onSelect: () => void executeAction("code.sortLines") },
        { type: "item", label: "反转行", disabled: dis(docsOpen), onSelect: () => void executeAction("code.reverseLines") },
      ],
    },
    {
      label: "视图",
      items: [
        {
          type: "item",
          label: "工具窗口",
          icon: "layout",
          children: [
            { type: "item", label: "项目", hint: "Alt+1", icon: "toolwindow-project", disabled: dis(!!root), onSelect: () => void executeAction("toolwindow.project") },
            { type: "item", label: "运行", hint: "Alt+4", icon: "toolwindow-run", disabled: dis(!!root), onSelect: () => void executeAction("toolwindow.run") },
            { type: "item", label: "调试", hint: "Alt+5", icon: "toolwindow-debug", disabled: dis(!!root), onSelect: () => void executeAction("toolwindow.debug") },
            { type: "item", label: "问题", hint: "Alt+6", icon: "toolwindow-problems", disabled: dis(!!root), onSelect: () => void executeAction("toolwindow.problems") },
            { type: "item", label: "结构", hint: "Alt+7", icon: "toolwindow-structure", disabled: dis(docsOpen), onSelect: () => void executeAction("toolwindow.structure") },
            { type: "item", label: "在文件中查找", hint: "Alt+3", icon: "toolwindow-find", disabled: dis(!!root), onSelect: () => void executeAction("toolwindow.find") },
            { type: "item", label: "Git", hint: "Alt+9", icon: "toolwindow-git", disabled: dis(!!root), onSelect: () => void executeAction("toolwindow.git") },
            { type: "item", label: "终端", hint: "Alt+F12", icon: "toolwindow-terminal", disabled: dis(!!root), onSelect: () => void executeAction("toolwindow.terminal") },
            { type: "separator" },
            { type: "item", label: "智能体", icon: "toolwindow-agents", onSelect: () => void executeAction("toolwindow.agent") },
            { type: "item", label: "数据库", icon: "toolwindow-database", onSelect: () => void executeAction("toolwindow.database") },
            { type: "separator" },
            { type: "item", label: "隐藏所有工具窗口", hint: "Ctrl+Shift+F12", onSelect: () => void executeAction("toolwindow.hideAll") },
          ],
        },
        {
          type: "item",
          label: "外观",
          children: [
            { type: "item", label: "切换深色主题", icon: "moon", onSelect: () => void executeAction("view.toggleTheme") },
            { type: "item", label: "进入全屏", onSelect: () => void executeAction("view.toggleFullscreen") },
            { type: "item", label: "进入禅模式", hint: "Ctrl+`", onSelect: () => void executeAction("view.zenMode") },
          ],
        },
        { type: "separator" },
        { type: "item", label: "最近的位置", hint: "Ctrl+Shift+E", disabled: dis(docsOpen), onSelect: () => void executeAction("navigate.recentLocations") },
        { type: "item", label: "最近的文件", hint: "Ctrl+E", onSelect: () => useOverlay.getState().open({ type: "searchEverywhere" }) },
        { type: "separator" },
        { type: "item", label: "重设所有编辑器中的字体大小", disabled: dis(docsOpen), onSelect: () => void executeAction("view.resetFontSize") },
        { type: "item", label: "通知", onSelect: () => void executeAction("view.notifications") },
      ],
    },
    {
      label: "导航",
      items: [
        { type: "item", label: "随处搜索", hint: "Shift Shift", icon: "search", onSelect: () => useOverlay.getState().open({ type: "searchEverywhere" }) },
        { type: "item", label: "类…", hint: "Ctrl+N", disabled: dis(docsOpen), onSelect: () => useOverlay.getState().open({ type: "searchEverywhere", tab: "files" }) },
        { type: "item", label: "文件…", hint: "Ctrl+Shift+N", disabled: dis(!!root), onSelect: () => useOverlay.getState().open({ type: "searchEverywhere", tab: "files" }) },
        { type: "item", label: "行/列…", hint: "Ctrl+G", disabled: dis(docsOpen), onSelect: () => useOverlay.getState().open({ type: "gotoLine" }) },
        { type: "separator" },
        { type: "item", label: "后退", hint: "Ctrl+Alt+Left", disabled: dis(docsOpen), onSelect: () => void executeAction("navigate.back") },
        { type: "item", label: "前进", hint: "Ctrl+Alt+Right", disabled: dis(docsOpen), onSelect: () => void executeAction("navigate.forward") },
        { type: "separator" },
        { type: "item", label: "声明或用法", hint: "Ctrl+B", disabled: dis(docsOpen), onSelect: () => void executeAction("navigate.declaration") },
        { type: "item", label: "实现", hint: "Ctrl+Alt+B", disabled: dis(docsOpen), onSelect: () => void executeAction("navigate.implementation") },
        { type: "separator" },
        { type: "item", label: "文件结构", hint: "Ctrl+F12", disabled: dis(docsOpen), onSelect: () => void executeAction("navigate.fileStructure") },
        { type: "item", label: "文件路径", hint: "Ctrl+Alt+F12", disabled: dis(docsOpen), onSelect: () => void executeAction("navigate.filePath") },
        { type: "separator" },
        { type: "item", label: "下一个方法", hint: "Alt+Down", disabled: dis(docsOpen), onSelect: () => void executeAction("navigate.nextMethod") },
        { type: "item", label: "上一个方法", hint: "Alt+Up", disabled: dis(docsOpen), onSelect: () => void executeAction("navigate.prevMethod") },
        { type: "separator" },
        { type: "item", label: "下一个高亮错误", hint: "F2", disabled: dis(docsOpen), onSelect: () => void executeAction("navigate.nextError") },
        { type: "item", label: "上一个高亮错误", hint: "Shift+F2", disabled: dis(docsOpen), onSelect: () => void executeAction("navigate.prevError") },
        { type: "item", label: "选择位置…", hint: "Alt+F1", disabled: dis(docsOpen), onSelect: () => void executeAction("navigate.selectLocation") },
      ],
    },
    {
      label: "代码",
      items: [
        {
          type: "item",
          label: "代码补全",
          children: [
            { type: "item", label: "基本补全", hint: "Ctrl+Space", disabled: dis(docsOpen), onSelect: () => void executeAction("code.triggerCompletion") },
            { type: "item", label: "类型补全", hint: "Ctrl+Shift+Space", disabled: dis(docsOpen), onSelect: () => void executeAction("code.typeCompletion") },
          ],
        },
        { type: "item", label: "参数信息", hint: "Ctrl+P", disabled: dis(docsOpen), onSelect: () => void executeAction("code.parameterInfo") },
        { type: "item", label: "快速文档", hint: "Ctrl+Q", disabled: dis(docsOpen), onSelect: () => void executeAction("code.quickDoc") },
        { type: "item", label: "表达式类型信息", hint: "Ctrl+Shift+P", disabled: dis(docsOpen), onSelect: () => void executeAction("code.typeInfo") },
        { type: "item", label: "错误描述", hint: "Ctrl+F1", disabled: dis(docsOpen), onSelect: () => void executeAction("code.errorDescription") },
        { type: "item", label: "生成…", hint: "Alt+Insert", disabled: dis(docsOpen), onSelect: () => void executeAction("file.new") },
        { type: "separator" },
        { type: "item", label: "重新格式化代码", hint: "Ctrl+Alt+L", disabled: dis(docsOpen), onSelect: () => void executeAction("code.reformat") },
        { type: "item", label: "自动缩进", hint: "Ctrl+Alt+I", disabled: dis(docsOpen), onSelect: () => void executeAction("code.autoIndent") },
        { type: "item", label: "优化导入", hint: "Ctrl+Alt+O", disabled: dis(docsOpen), onSelect: () => void executeAction("code.organizeImports") },
        { type: "item", label: "代码清理…", disabled: dis(docsOpen), onSelect: () => void executeAction("code.cleanup") },
        { type: "separator" },
        { type: "item", label: "使用行注释", hint: "Ctrl+/", disabled: dis(docsOpen), onSelect: () => void executeAction("code.commentLine") },
        { type: "item", label: "使用块注释", hint: "Ctrl+Shift+/", disabled: dis(docsOpen), onSelect: () => void executeAction("code.blockComment") },
        { type: "separator" },
        { type: "item", label: "扩展选区", hint: "Ctrl+W", disabled: dis(docsOpen), onSelect: () => void executeAction("code.selectExpand") },
        { type: "item", label: "缩小选区", hint: "Ctrl+Shift+W", disabled: dis(docsOpen), onSelect: () => void executeAction("code.selectShrink") },
        { type: "item", label: "复制行或选区", hint: "Ctrl+D", disabled: dis(docsOpen), onSelect: () => void executeAction("code.duplicateLine") },
        { type: "item", label: "删除行", hint: "Ctrl+Y", disabled: dis(docsOpen), onSelect: () => void executeAction("code.deleteLine") },
        { type: "item", label: "上移语句", hint: "Ctrl+Shift+Up", disabled: dis(docsOpen), onSelect: () => void executeAction("code.moveStatementUp") },
        { type: "item", label: "下移语句", hint: "Ctrl+Shift+Down", disabled: dis(docsOpen), onSelect: () => void executeAction("code.moveStatementDown") },
        { type: "item", label: "上移行", hint: "Alt+Shift+Up", disabled: dis(docsOpen), onSelect: () => void executeAction("code.moveLineUp") },
        { type: "item", label: "下移行", hint: "Alt+Shift+Down", disabled: dis(docsOpen), onSelect: () => void executeAction("code.moveLineDown") },
        { type: "separator" },
        {
          type: "item",
          label: "折叠",
          children: [
            { type: "item", label: "展开/折叠", disabled: dis(docsOpen), onSelect: () => void executeAction("code.foldToggle") },
            { type: "item", label: "全部展开", disabled: dis(docsOpen), onSelect: () => void executeAction("code.unfoldAll") },
            { type: "item", label: "全部折叠", disabled: dis(docsOpen), onSelect: () => void executeAction("code.foldAll") },
            { type: "item", label: "展开到当前级别", disabled: dis(docsOpen), onSelect: () => void executeAction("code.unfoldToggle") },
          ],
        },
        { type: "separator" },
        { type: "item", label: "检查代码…", disabled: dis(!!root), onSelect: () => void executeAction("code.inspectCode") },
      ],
    },
    {
      label: "重构",
      items: [
        {
          type: "item",
          label: "重构此…",
          hint: "Ctrl+Alt+Shift+T",
          disabled: dis(docsOpen),
          children: [
            { type: "item", label: "重命名…", hint: "Shift+F6", onSelect: () => void executeAction("refactor.rename") },
            { type: "item", label: "移动…", hint: "F6", onSelect: () => void executeAction("refactor.move") },
            { type: "item", label: "复制…", hint: "F5", onSelect: () => void executeAction("refactor.copy") },
            { type: "item", label: "安全删除…", hint: "Alt+Delete", onSelect: () => void executeAction("refactor.safeDelete") },
          ],
        },
        { type: "item", label: "重命名…", hint: "Shift+F6", disabled: dis(docsOpen), onSelect: () => void executeAction("refactor.rename") },
        { type: "separator" },
        { type: "item", label: "移动…", hint: "F6", disabled: dis(docsOpen), onSelect: () => void executeAction("refactor.move") },
        { type: "item", label: "复制…", hint: "F5", disabled: dis(docsOpen), onSelect: () => void executeAction("refactor.copy") },
        { type: "item", label: "安全删除…", hint: "Alt+Delete", disabled: dis(docsOpen), onSelect: () => void executeAction("refactor.safeDelete") },
      ],
    },
    {
      label: "运行",
      items: [
        { type: "item", label: "运行", hint: "Shift+F10", icon: "run", disabled: dis(!!root), onSelect: () => void executeAction("run.run") },
        { type: "item", label: "调试", hint: "Shift+F9", icon: "debug", disabled: dis(!!root), onSelect: () => void executeAction("run.debug") },
        { type: "item", label: "运行上下文配置", hint: "Ctrl+Shift+F10", disabled: dis(!!root), onSelect: () => void executeAction("run.runContext") },
        { type: "item", label: "调试上下文配置", hint: "Alt+Shift+F9", disabled: dis(!!root), onSelect: () => void executeAction("run.debugContext") },
        { type: "item", label: "停止", hint: "Ctrl+F2", icon: "stop", disabled: !runActive && !debugActive, onSelect: () => void executeAction("run.stop") },
        { type: "separator" },
        { type: "item", label: "运行…", hint: "Alt+Shift+F10", disabled: dis(!!root), onSelect: () => useOverlay.getState().open({ type: "runConfigPicker" }) },
        { type: "item", label: "调试…", hint: "Alt+Shift+F9", disabled: dis(!!root), onSelect: () => useOverlay.getState().open({ type: "runConfigPicker", mode: "debug" }) },
        { type: "item", label: "运行任何内容…", hint: "Ctrl Ctrl", onSelect: () => void executeAction("run.runAnything") },
        { type: "separator" },
        { type: "item", label: "恢复程序", hint: "F9", disabled: dis(debugPaused), onSelect: () => void executeAction("debug.resume") },
        { type: "item", label: "暂停程序", disabled: !debugActive || debugPaused, onSelect: () => void executeAction("debug.pause") },
        { type: "item", label: "步过", hint: "F8", disabled: dis(debugPaused), onSelect: () => void executeAction("debug.stepOver") },
        { type: "item", label: "步入", hint: "F7", disabled: dis(debugPaused), onSelect: () => void executeAction("debug.stepInto") },
        { type: "item", label: "步出", hint: "Shift+F8", disabled: dis(debugPaused), onSelect: () => void executeAction("debug.stepOut") },
        { type: "separator" },
        { type: "item", label: "切换行断点", hint: "Ctrl+F8", disabled: dis(docsOpen), onSelect: () => void executeAction("debug.toggleLineBreakpoint") },
        { type: "item", label: "切换临时行断点", hint: "Ctrl+Alt+Shift+F8", disabled: dis(docsOpen), onSelect: () => void executeAction("debug.toggleTempBreakpoint") },
        { type: "item", label: "查看断点…", hint: "Ctrl+Shift+F8", disabled: dis(!!root), onSelect: () => void executeAction("debug.viewBreakpoints") },
      ],
    },
    {
      label: "Git",
      items: [
        {
          type: "item",
          label: gitEnabled ? "停用版本控制集成" : "启用版本控制集成…",
          onSelect: () => void executeAction("vcs.toggleIntegration"),
        },
        { type: "item", label: "克隆仓库…", icon: "folder-github", onSelect: () => useOverlay.getState().open({ type: "clone" }) },
        { type: "separator" },
        { type: "item", label: "提交…", hint: "Ctrl+K", disabled: dis(!!root), onSelect: () => void executeAction("vcs.commit") },
        { type: "item", label: "推送…", hint: "Ctrl+Shift+K", disabled: dis(!!root), onSelect: () => void executeAction("vcs.push") },
        { type: "item", label: "更新项目", hint: "Ctrl+T", disabled: dis(!!root), onSelect: () => void executeAction("vcs.pull") },
        { type: "separator" },
        { type: "item", label: "还原…", hint: "Ctrl+Alt+Z", disabled: dis(docsOpen), onSelect: () => void executeAction("vcs.rollback") },
        { type: "separator" },
        { type: "item", label: "显示 Git 日志", hint: "Alt+9", disabled: dis(!!root), onSelect: () => void executeAction("toolwindow.git") },
      ],
    },
    {
      label: "工具",
      items: [
        { type: "item", label: "打开终端", hint: "Alt+F12", icon: "terminal", disabled: dis(!!root), onSelect: () => void executeAction("toolwindow.terminal") },
        { type: "item", label: "新建终端", hint: "Ctrl+Shift+T", disabled: dis(!!root), onSelect: () => void executeAction("terminal.new") },
        { type: "item", label: "Python 控制台…", disabled: dis(!!root), onSelect: () => void executeAction("tools.pythonConsole") },
        { type: "separator" },
        { type: "item", label: "在资源管理器中显示", disabled: dis(!!root), onSelect: () => void executeAction("tools.revealInShell") },
      ],
    },
    {
      label: "窗口",
      items: [
        { type: "item", label: "最小化", onSelect: () => void getCurrentWindow().minimize() },
        { type: "item", label: "最大化 / 还原", onSelect: () => void getCurrentWindow().toggleMaximize() },
        { type: "item", label: "全屏", onSelect: () => void executeAction("view.toggleFullscreen") },
        { type: "separator" },
        {
          type: "item",
          label: "活动工具窗口",
          children: [
            { type: "item", label: "隐藏活动工具窗口", hint: "Shift+Escape", onSelect: () => void executeAction("toolwindow.hideActive") },
            { type: "item", label: "隐藏所有工具窗口", hint: "Ctrl+Shift+F12", onSelect: () => void executeAction("toolwindow.hideAll") },
          ],
        },
        {
          type: "item",
          label: "编辑器标签",
          children: [
            { type: "item", label: "关闭标签", hint: "Ctrl+F4", disabled: dis(docsOpen), onSelect: () => void executeAction("editor.closeTab") },
            { type: "item", label: "关闭其他标签", disabled: dis(docsOpen), onSelect: () => void executeAction("editor.closeOthersTab") },
            { type: "item", label: "关闭所有标签", disabled: dis(docsOpen), onSelect: () => void executeAction("editor.closeAllTabs") },
            { type: "separator" },
            { type: "item", label: "上一个标签", hint: "Alt+Left", disabled: dis(docsOpen), onSelect: () => void executeAction("editor.prevTab") },
            { type: "item", label: "下一个标签", hint: "Alt+Right", disabled: dis(docsOpen), onSelect: () => void executeAction("editor.nextTab") },
          ],
        },
        { type: "separator" },
        { type: "item", label: "关闭项目", disabled: dis(!!root), onSelect: () => void useProject.getState().close() },
      ],
    },
    {
      label: "帮助",
      items: [
        { type: "item", label: "查找操作…", hint: "Ctrl+Shift+A", onSelect: () => useOverlay.getState().open({ type: "searchEverywhere", tab: "actions" }) },
        { type: "separator" },
        { type: "item", label: "检查更新…", onSelect: () => void executeAction("help.checkUpdates") },
        { type: "item", label: "关于 OpenPyCharm", onSelect: () => useOverlay.getState().open({ type: "about" }) },
      ],
    },
  ];
}

export function TitleBar() {
  const root = useProject((s) => s.root);
  const name = useProject((s) => s.name);
  const recents = useProject((s) => s.recents);
  const docCount = useDocs((s) => s.docs.length);
  const runActive = useRun((s) => s.sessions.some((x) => x.status === "running"));
  const debugStatus = useDebug((s) => s.status);
  const gitInfo = useGit((s) => s.info);
  const menuMode = useSettings((s) => s.settings.mainMenuMode ?? "hamburger");
  const powerSave = useSettings((s) => s.settings.powerSave === true);
  const gitEnabled = useSettings((s) => s.settings.gitEnabled !== false);

  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [popup, setPopup] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const win = useRef<ReturnType<typeof getCurrentWindow> | null>(null);
  const [winMaximized, setWinMaximized] = useState(false);

  useEffect(() => {
    win.current = getCurrentWindow();
    const update = () => void win.current?.isMaximized().then(setWinMaximized).catch(() => {});
    update();
    const t = window.setInterval(update, 800);
    return () => window.clearInterval(t);
  }, []);

  const menus = buildMenus({
    root,
    docsOpen: docCount > 0,
    recents,
    runActive,
    debugActive: ["starting", "running", "paused"].includes(debugStatus),
    debugPaused: debugStatus === "paused",
    powerSave,
    gitEnabled,
  });

  const openAt = (i: number) => {
    const btn = buttonsRef.current[i];
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setOpenIdx(i);
    setPopup({ x: rect.left, y: rect.bottom + 2, items: menus[i].items });
  };

  const openPopup = (e: React.MouseEvent, items: MenuItem[], align: "left" | "right" = "left") => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPopup({ x: align === "left" ? rect.left : rect.right - 240, y: rect.bottom + 4, items });
  };

  const gearItems = (): MenuItem[] => [
    { type: "item", label: "设置…", hint: "Ctrl+Alt+S", icon: "settings", onSelect: () => useOverlay.getState().open({ type: "settings" }) },
    { type: "separator" },
    {
      type: "item",
      label: "切换深色主题",
      icon: "moon",
      onSelect: () => void executeAction("view.toggleTheme"),
    },
    { type: "separator" },
    { type: "item", label: "关于", onSelect: () => useOverlay.getState().open({ type: "about" }) },
  ];

  const projectItems = (): MenuItem[] => [
    { type: "item", label: "打开…", icon: "folder", onSelect: () => void executeAction("file.open") },
    {
      type: "item",
      label: "最近打开",
      children: recents.length
        ? recents.slice(0, 10).map(
            (p): MenuItem => ({ type: "item", label: p, icon: "folder", onSelect: () => void useProject.getState().open(p) }),
          )
        : [off("暂无最近项目")],
    },
    { type: "separator" },
    { type: "item", label: "关闭项目", onSelect: () => void useProject.getState().close() },
  ];

  const vcsItems = (): MenuItem[] => [
    { type: "item", label: "提交…", hint: "Ctrl+K", icon: "commit", onSelect: () => void executeAction("vcs.commit") },
    { type: "item", label: "推送…", hint: "Ctrl+Shift+K", icon: "git-push", onSelect: () => void executeAction("vcs.push") },
    { type: "item", label: "更新项目", hint: "Ctrl+T", icon: "git-pull", onSelect: () => void executeAction("vcs.pull") },
    { type: "separator" },
    { type: "item", label: "显示 Git 日志", hint: "Alt+9", onSelect: () => void executeAction("toolwindow.git") },
  ];

  const menuModeSwitcher = (items: MenuItem[]): MenuItem[] =>
    menuMode === "merged"
      ? items
      : menus.map((m) => ({ type: "item" as const, label: m.label, children: m.items }));

  return (
    <>
      <header className={styles.titlebar} data-welcome={root ? undefined : true}>
        {root && menuMode === "merged" ? (
          <div className={styles.menuBar} role="menubar">
            {menus.map((menu, i) => (
              <button
                key={menu.label}
                ref={(el) => {
                  buttonsRef.current[i] = el;
                }}
                type="button"
                className={styles.menuButton}
                data-open={openIdx === i}
                onClick={() => (openIdx === i ? (setOpenIdx(null), setPopup(null)) : openAt(i))}
                onMouseEnter={() => {
                  if (openIdx !== null && openIdx !== i) openAt(i);
                }}
              >
                {menu.label}
              </button>
            ))}
          </div>
        ) : (
          <button
            type="button"
            className={styles.toolButton}
            aria-label="主菜单"
            title="主菜单"
            onClick={(e) => openPopup(e, menuModeSwitcher([]))}
          >
            <Icon name="main-menu" size={16} />
          </button>
        )}

        {root ? (
          <>
            <button type="button" className={styles.projectWidget} title={name ?? ""} onClick={(e) => openPopup(e, projectItems())}>
              <span className={styles.projectName}>{name}</span>
              <Icon name="chevron-down" size={12} />
            </button>
            {gitInfo?.repo && gitInfo.branch ? (
              <button type="button" className={styles.projectWidget} title="版本控制" onClick={(e) => openPopup(e, vcsItems())}>
                <Icon name="branch" size={14} />
                <span className={styles.projectName}>{gitInfo.branch}</span>
                {gitInfo.ahead || gitInfo.behind ? (
                  <span className={styles.aheadBehind}>
                    {gitInfo.ahead ? `↑${gitInfo.ahead}` : ""} {gitInfo.behind ? `↓${gitInfo.behind}` : ""}
                  </span>
                ) : null}
                <Icon name="chevron-down" size={12} />
              </button>
            ) : null}
          </>
        ) : (
          <span className={styles.welcomeTitle}>欢迎使用 OpenPyCharm</span>
        )}

        <div className={styles.drag} data-tauri-drag-region />
        <div className={styles.right}>
          {root ? (
            <>
              <button type="button" className={styles.toolButton} aria-label="运行" title="运行 (Shift+F10)" onClick={() => void executeAction("run.run")}>
                <Icon name="run" size={16} />
              </button>
              <button type="button" className={styles.toolButton} aria-label="调试" title="调试 (Shift+F9)" onClick={() => void executeAction("run.debug")}>
                <Icon name="debug" size={16} />
              </button>
            </>
          ) : null}
          <button
            type="button"
            className={styles.toolButton}
            aria-label="随处搜索"
            title="随处搜索 (Double Shift)"
            onClick={() => useOverlay.getState().open({ type: "searchEverywhere" })}
          >
            <Icon name="search" size={16} />
          </button>
          <button
            type="button"
            className={styles.toolButton}
            aria-label="自定义 OpenPyCharm"
            title="自定义 OpenPyCharm"
            onClick={(e) => openPopup(e, gearItems(), "right")}
          >
            <Icon name="settings" size={16} />
          </button>
          <button type="button" className={styles.caption} aria-label="Minimize" onClick={() => void win.current?.minimize()}>
            <Icon name="window-minimize" size={16} />
          </button>
          <button
            type="button"
            className={styles.caption}
            aria-label={winMaximized ? "Restore" : "Maximize"}
            onClick={() => void win.current?.toggleMaximize()}
          >
            <Icon name={winMaximized ? "window-restore" : "window-maximize"} size={16} />
          </button>
          <button type="button" className={styles.caption} data-close="true" aria-label="Close" onClick={() => void win.current?.close()}>
            <Icon name="window-close" size={16} />
          </button>
        </div>
      </header>
      {popup ? (
        <PopupMenu
          x={popup.x}
          y={popup.y}
          items={popup.items}
          onClose={() => {
            setOpenIdx(null);
            setPopup(null);
          }}
        />
      ) : null}
    </>
  );
}
