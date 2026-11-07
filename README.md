# OpenPyCharm

**The Python IDE you know, rebuilt in Rust.**

OpenPyCharm 是一个开源的 Python IDE，用 Rust + Tauri + React 构建，交互方式与键位设计对齐 JetBrains PyCharm，UI 设计语言对齐 [openidea](https://github.com/l0ng-ai/openidea)（IntelliJ IDEA 的开源复刻，本项目从中借鉴了设计令牌与图标体系，见 NOTICE）。

> OpenPyCharm 与 JetBrains s.r.o. 无关联；PyCharm 是 JetBrains 的商标。

## 功能（MVP）

- **Islands UI 外壳** — 无边框窗口、**主菜单双形态**（汉堡菜单按钮〔默认〕/ 合并菜单，设置 › 外观可切换；12 个中文菜单 + 二级子菜单 + 快捷键提示 + 置灰项）、标题栏项目 ˅ 与版本控制 ˅ 下拉、标题栏右侧 运行/调试/搜索/自定义 图标、**JetBrains 风格设置窗口**（搜索 + 分类树 + 面包屑 + 确定/取消/应用：主题/强调色/UI 缩放/紧凑模式/字体等即时生效，按键映射页速查全部键位）、工具窗口条带（中文标题）、Islands 圆角岛布局、无边框状态栏（左侧文件路径面包屑）；深/浅主题（JetBrains New UI 设计令牌）
- **项目树** — 懒加载目录、JetBrains 风格文件图标、右键菜单（新建文件/目录、重命名、删除、复制路径、在资源管理器中显示）、Git 状态颜色装饰
- **结构视图与面包屑** — Python 类/方法/函数大纲（Alt+7 / Ctrl+F12），点击跳转；编辑器上方 `文件 › 类 › 函数` 面包屑
- **编辑器** — CodeMirror 6：Python 语法高亮（Islands 配色）、行号、当前行高亮、**全行缩进参考线**（光标行加亮）、括号匹配、自动补全、代码折叠、文件内查找替换；Islands 药丸标签页（拖拽排序、右键 关闭其他/全部、中键关闭、**右侧 拆分/更多 按钮**）；JSON / Markdown / YAML 高亮
- **编辑器洞察** — `self`/`cls` 与参数名语义着色、光标行缩进参考线、`__main__` 入口 gutter 运行按钮（点击即跑）、窗口失焦自动保存
- **代码智能（LSP）** — 内置 pyright：语义补全、跳转定义（F12 / Ctrl+B / Ctrl+Alt+B 类型）、查找引用（Shift+F12）、跨文件重命名（Shift+F6 / F2）、实时诊断
- **Problems 工具窗口** — 全项目诊断汇总（错误/警告计数 + 按文件分组，Alt+6），点击定位到行列
- **格式化** — `Ctrl+Alt+L` 调用项目解释器里的 ruff / black / autopep8（按顺序探测）
- **调试器** — debugpy + DAP：编辑器 gutter 断点、F9 继续、F8/F7/Shift+F8 单步、调用栈、作用域/变量树、表达式求值、执行行高亮
- **Git 集成** — 分支/领先落后状态、项目树变更颜色、暂存/取消暂存、提交、推送/拉取（Ctrl+K 提交 / Ctrl+Shift+K 推送）、提交日志、基于 MergeView 的并排 diff（Alt+9）
- **文件监视** — notify 递归监视项目目录（250ms 去抖）：外部新建/删除自动刷新项目树，打开中的干净文件被外部修改时静默重载（脏缓冲永不被覆盖）
- **PyCharm 键位** — `Double Shift` Search Everywhere、`Ctrl+Shift+N` Go to File、`Ctrl+G` Go to Line、`Ctrl+D`/`Ctrl+Y`/`Ctrl+/`、`Alt+Shift+↑/↓` 移动行、`Shift+F10` 运行、`Alt+1` Project、`Alt+F12` Terminal 等（IntelliJ Windows 键位预设）
- **运行** — 自动发现 Python 解释器（venv / py launcher / PATH，状态栏可切换），一键运行当前文件，Run 工具窗口带 ANSI 彩色输出、stdin 输入、停止/重跑
- **终端** — 基于 ConPTY（portable-pty）的真实终端，xterm.js 渲染，多标签
- **Find in Files** — 项目级全文检索（大小写/正则开关），点击结果直接跳转
- **Search Everywhere** — 文件 + 动作全局搜索浮层

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面框架 | Tauri 2（Rust，MSVC） |
| 后端 | Rust：文件系统 / 搜索 / 进程 / ConPTY 终端 / 设置持久化 |
| 前端 | React 19 + TypeScript + Vite + zustand |
| 编辑器 | CodeMirror 6（@codemirror/lang-python / json / markdown / yaml） |
| 代码智能 | pyright（LSP，`@codemirror/lsp-client`） |
| 调试器 | debugpy（DAP，自定义 Content-Length 帧桥） |
| 版本控制 | 系统 git CLI（状态/提交/日志/diff） |
| 终端 | xterm.js + portable-pty (ConPTY) |
| 字体 | Inter Variable（UI）、JetBrains Mono Variable（代码） |

## 开发

前置要求：Node.js 20+、Rust stable（MSVC 工具链）、WebView2（Win11 自带）。

可选工具（装到项目使用的 Python 解释器里）：

```bash
pip install debugpy     # 调试器
pip install ruff        # 格式化（也支持 black / autopep8）
```

LSP 使用 `devDependencies` 里的 pyright（`npm install` 已包含）。当前从 `node_modules/pyright` 启动、依赖系统 Node；打包发布时需把 Node + pyright 作为 sidecar 资源一并分发。

```bash
npm install

# 开发模式（vite + rust 增量编译）
npx tauri dev

# 生产构建（NSIS 安装包输出至 src-tauri/target/release/bundle/）
npx tauri build

# 生产构建（仅绿色版 exe，不下载 NSIS，适合离线环境）
npx tauri build --no-bundle
# 产物: src-tauri/target/release/openpycharm.exe（约 11 MB）

# 仅前端构建 / 类型检查
npm run build
npm run typecheck
```

> NSIS 安装包打包时需从 GitHub 下载 NSIS 工具链，网络受限时请使用 `--no-bundle` 产出绿色版可执行文件（功能完全一致）。

`fixtures/sample_project/` 是一个用于冒烟测试的示例 Python 项目。

> 若 Rust/Cargo 不在 PATH：`$env:RUSTUP_HOME="E:\SoftWare\rust\rustup"; $env:CARGO_HOME="E:\SoftWare\rust\cargo"; $env:PATH="E:\SoftWare\rust\cargo\bin;$env:PATH"`（按你的安装位置调整）。

## 目录结构

```
├── src/                  # React 前端
│   ├── platform/         # IPC 封装、动作注册表、键位系统、设置、主题
│   ├── editor/           # CodeMirror 集成、文档模型、行命令、跳转
│   ├── workbench/        # TitleBar / 主菜单 / 工具窗口布局 / 状态栏 / 浮层
│   ├── features/         # 项目树、运行、终端、搜索、Python 解释器
│   ├── ui/               # 图标体系（JetBrains expui）与弹层原语
│   └── styles/           # Islands 设计令牌（源自 openidea，Apache-2.0）
├── src-tauri/            # Rust 后端
│   └── src/              # fs / search / python / run / term / settings / app
├── scripts/              # 图标生成等开发脚本
└── .reference/           # openidea 参考克隆（开发用，不入库）
```

## 键位速查（IntelliJ Windows 预设）

| 动作 | 键位 |
|---|---|
| Search Everywhere | `Double Shift` |
| Go to File | `Ctrl+Shift+N` |
| Go to Line:Column | `Ctrl+G` |
| Find Action | `Ctrl+Shift+A` |
| Find / Replace | `Ctrl+F` / `Ctrl+R` |
| Find in Files | `Ctrl+Shift+F` |
| 注释 / 复制行 / 删除行 | `Ctrl+/` / `Ctrl+D` / `Ctrl+Y` |
| 上/下移动行 | `Alt+Shift+↑` / `Alt+Shift+↓` |
| 保存全部 | `Ctrl+S` |
| 设置 | `Ctrl+Alt+S` |
| Project / Debug / Run / Terminal / Structure / Git | `Alt+1` / `Alt+5` / `Alt+4` / `Alt+F12` / `Alt+7` / `Alt+9` |
| 运行 / 调试 / 停止 | `Shift+F10` / `Shift+F9` / `Ctrl+F2` |
| 继续 / 单步跳过 / 单步进入 / 单步跳出 | `F9` / `F8` / `F7` / `Shift+F8` |
| 跳转定义 / 查找引用 / 重命名 | `Ctrl+B` / `Shift+F12` / `Shift+F6` |
| 下一个 / 上一个高亮错误 | `F2` / `Shift+F2` |
| 扩展选区 / 缩小选区 | `Ctrl+W` / `Ctrl+Shift+W` |
| 复制路径 / 块注释 / 自动缩进 | `Ctrl+Shift+C` / `Ctrl+Shift+/` / `Ctrl+Alt+I` |
| Git 提交 / 推送 / 更新项目 | `Ctrl+K` / `Ctrl+Shift+K` / `Ctrl+T` |
| 切换行断点 | `Ctrl+F8` |
| 格式化 | `Ctrl+Alt+L` |
| 后退 / 前进 | `Ctrl+Alt+←` / `Ctrl+Alt+→` |
| 关闭标签 / 切换标签 | `Ctrl+F4` / `Alt+←/→` |
| 隐藏全部工具窗口 | `Ctrl+Shift+F12` |

## Roadmap

- [x] 结构视图（Python 大纲）与面包屑
- [x] 调试器（DAP / debugpy）
- [x] Git 集成（状态装饰、暂存、提交、日志、并排 diff）
- [x] 重命名符号（引用驱动的跨文件重命名）
- [ ] 重构（抽取变量/方法、内联）
- [ ] 测试运行器（pytest）与包管理面板
- [ ] 插件系统（WASM component model，参考 openidea）

## License

Apache-2.0。包含来自 openidea / JetBrains intellij-community 的代码与素材，详见 [NOTICE](NOTICE) 与 [THIRD_PARTY_LICENSES.md](.reference/openidea/THIRD_PARTY_LICENSES.md)。
