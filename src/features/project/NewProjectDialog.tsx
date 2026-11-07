/**
 * 新建项目 — PyCharm 风格对话框：
 *   左侧项目类型（纯 Python / FastAPI / Flask / Django / Jupyter），
 *   右侧 位置 + Git/欢迎脚本 + 解释器类型（项目 venv / uv / 基础 conda / 自定义环境），
 *   右下角 创建。创建流程：建目录 → git init → 建环境 → 写模板 → 打开项目。
 */
import { useEffect, useState } from "react";
import { Icon } from "../../ui/icons";
import { ipc } from "../../platform/ipc";
import { useProject } from "../../platform/project";
import { usePython } from "../python/store";
import { useSettings } from "../../platform/settings";
import { notify } from "../../platform/notify";
import { pathBase, pathJoin } from "../../platform/paths";
import styles from "./NewProjectDialog.module.css";

type ProjectType = "pure" | "fastapi" | "flask" | "django" | "jupyter";
type EnvType = "venv" | "uv" | "condaNew" | "conda" | "custom";

const TYPES: Array<{ id: ProjectType; label: string }> = [
  { id: "pure", label: "纯 Python" },
  { id: "fastapi", label: "FastAPI" },
  { id: "flask", label: "Flask" },
  { id: "django", label: "Django" },
  { id: "jupyter", label: "Jupyter" },
];

const WELCOME_MAIN = 'print("Hi, OpenPyCharm")\n';

const FASTAPI_MAIN = [
  "from fastapi import FastAPI",
  "",
  'app = FastAPI(title="OpenPyCharm Project")',
  "",
  "",
  '@app.get("/")',
  "def read_root():",
  '    return {"Hello": "OpenPyCharm"}',
  "",
].join("\n");

const FLASK_MAIN = [
  "from flask import Flask",
  "",
  'app = Flask(__name__)',
  "",
  "",
  '@app.route("/")',
  "def hello():",
  '    return "Hello, OpenPyCharm!"',
  "",
  "",
  'if __name__ == "__main__":',
  "    app.run(debug=True)",
  "",
].join("\n");

const NOTEBOOK = JSON.stringify(
  {
    cells: [
      {
        cell_type: "code",
        execution_count: null,
        metadata: {},
        outputs: [],
        source: ['print("Hi, OpenPyCharm")'],
      },
    ],
    metadata: { kernelspec: { display_name: "Python 3", language: "python", name: "python3" } },
    nbformat: 4,
    nbformat_minor: 5,
  },
  null,
  2,
);

function entryFileFor(type: ProjectType): { name: string; text: string } | null {
  switch (type) {
    case "pure":
      return { name: "main.py", text: WELCOME_MAIN };
    case "fastapi":
      return { name: "main.py", text: FASTAPI_MAIN };
    case "flask":
      return { name: "app.py", text: FLASK_MAIN };
    case "jupyter":
      return { name: "analysis.ipynb", text: NOTEBOOK };
    case "django":
      return null;
  }
}

function requirementsFor(type: ProjectType): string | null {
  switch (type) {
    case "fastapi":
      return "fastapi\nuvicorn[standard]\n";
    case "flask":
      return "flask\n";
    case "django":
      return "django\n";
    case "jupyter":
      return "notebook\n";
    default:
      return null;
  }
}

export function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const [ptype, setPtype] = useState<ProjectType>("pure");
  const [location, setLocation] = useState("");
  const [gitInit, setGitInit] = useState(false);
  const [welcomeScript, setWelcomeScript] = useState(true);
  const [envType, setEnvType] = useState<EnvType>("venv");
  const [pyVersion, setPyVersion] = useState("默认");
  const [uvPath, setUvPath] = useState("");
  const [venvPathExplicit, setVenvPathExplicit] = useState<string | null>(null);
  const [customPath, setCustomPath] = useState("");
  const [creating, setCreating] = useState(false);
  const [step, setStep] = useState("");

  // 默认位置：<home>\PycharmProjects\PythonProject（占用时自动追加序号）。
  useEffect(() => {
    void (async () => {
      try {
        const home = await ipc.fsUserHome();
        if (!home) return;
        const base = pathJoin(home, "PycharmProjects");
        for (let n = 0; n < 100; n++) {
          const candidate = pathJoin(base, n === 0 ? "PythonProject" : `PythonProject${n}`);
          if (!(await ipc.fsExists(candidate))) {
            setLocation(candidate);
            return;
          }
        }
      } catch {
        // 保持空输入即可。
      }
    })();
  }, []);

  // uv 路径自动检测。
  useEffect(() => {
    void ipc
      .uvDetect()
      .then((p) => setUvPath(p ?? ""))
      .catch(() => setUvPath(""));
  }, []);

  const venvPath = venvPathExplicit ?? (location ? pathJoin(location, ".venv") : "");
  const setSelectedPython = usePython((s) => s.selected?.path);
  const condaBase = usePython((s) => s.sdks.find((x) => x.kind === "conda") ?? null);

  const browseLocation = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const dir = await open({ directory: true, title: "选择位置" });
    if (typeof dir !== "string") return;
    const name = pathBase(location) || "PythonProject";
    setLocation(pathJoin(dir, name));
  };

  const browseVenv = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const dir = await open({ directory: true, title: "选择环境位置" });
    if (typeof dir !== "string") return;
    setVenvPathExplicit(pathJoin(dir, ".venv"));
  };

  const browseCustom = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const sel = await open({ multiple: false, title: "选择解释器" });
    if (typeof sel !== "string") return;
    setCustomPath(sel);
  };

  const browseUv = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const sel = await open({ multiple: false, title: "选择 uv 可执行文件" });
    if (typeof sel !== "string") return;
    setUvPath(sel);
  };

  const showVenv = envType === "venv" || envType === "uv" || envType === "condaNew";
  const showCondaBase = envType === "conda" || envType === "condaNew";

  const create = async () => {
    if (!location.trim() || creating) return;
    if (envType === "uv" && !uvPath.trim()) {
      notify("error", "未找到 uv：请填写 uv 的路径或改用其他解释器类型");
      return;
    }
    if (envType === "condaNew" && !condaBase) {
      notify("error", "未检测到 conda：请先在设置 › Python 中重新扫描解释器");
      return;
    }
    setCreating(true);
    try {
      setStep("创建目录…");
      await ipc.fsCreateDir(location);

      if (gitInit) {
        setStep("初始化 Git 仓库…");
        await ipc.gitInit(location);
      }

      let interpreter: string | null = null;
      if (envType === "venv") {
        setStep("正在创建虚拟环境（可能需要几十秒）…");
        await ipc.pythonCreateVenv(setSelectedPython ?? "python", venvPath);
        interpreter = pathJoin(pathJoin(venvPath, "Scripts"), "python.exe");
      } else if (envType === "uv") {
        setStep("正在通过 uv 创建环境…");
        await ipc.uvCreateVenv(uvPath.trim(), venvPath);
        interpreter = pathJoin(pathJoin(venvPath, "Scripts"), "python.exe");
      } else if (envType === "condaNew") {
        setStep("正在创建 conda 环境（可能需要几分钟）…");
        await ipc.condaCreateEnv(
          condaBase!.path,
          venvPath,
          pyVersion === "默认" ? null : pyVersion,
        );
        interpreter = pathJoin(pathJoin(venvPath, "Scripts"), "python.exe");
      } else if (envType === "conda") {
        interpreter = condaBase?.path ?? null;
      } else {
        interpreter = customPath.trim() || null;
      }

      setStep("写入项目文件…");
      const entry = entryFileFor(ptype);
      if (entry) {
        await ipc.fsCreateFile(pathJoin(location, entry.name), entry.text);
      } else if (welcomeScript) {
        await ipc.fsCreateFile(pathJoin(location, "main.py"), WELCOME_MAIN);
      }
      const reqs = requirementsFor(ptype);
      if (reqs) await ipc.fsCreateFile(pathJoin(location, "requirements.txt"), reqs);

      setStep("打开项目…");
      await useProject.getState().open(location);
      if (interpreter) {
        await useSettings.getState().setProjectInterpreter(location, interpreter);
      }
      onClose();
    } catch (e) {
      notify("error", `创建项目失败：${String(e)}`);
    } finally {
      setCreating(false);
      setStep("");
    }
  };

  return (
    <>
      <div className={styles.backdrop} onPointerDown={onClose} />
      <div className={styles.dialog} onKeyDown={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.icon}>
            <Icon name="file-python" size={15} />
          </span>
          新建项目
          <button type="button" className={styles.headerClose} aria-label="关闭" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className={styles.body}>
          <aside className={styles.side}>
            {TYPES.map((t) => (
              <div
                key={t.id}
                className={styles.sideRow}
                data-active={ptype === t.id}
                onClick={() => setPtype(t.id)}
              >
                <span className={styles.icon}>
                  <Icon name="file-python" size={14} />
                </span>
                {t.label}
              </div>
            ))}
          </aside>
          <section className={styles.form}>
            <div className={styles.row}>
              <div className={styles.label}>位置(L):</div>
              <div className={styles.inputWrap}>
                <input
                  className={styles.input}
                  value={location}
                  placeholder="项目路径"
                  onChange={(e) => setLocation(e.target.value)}
                />
                <button type="button" className={styles.browseBtn} title="浏览" onClick={() => void browseLocation()}>
                  <Icon name="folder" size={15} />
                </button>
              </div>
            </div>
            <div className={styles.checkRow}>
              <label>
                <input type="checkbox" checked={gitInit} onChange={(e) => setGitInit(e.target.checked)} />
                创建 Git 仓库
              </label>
              <label>
                <input type="checkbox" checked={welcomeScript} onChange={(e) => setWelcomeScript(e.target.checked)} />
                创建欢迎脚本
              </label>
            </div>
            <div className={styles.row}>
              <div className={styles.label}>解释器类型:</div>
              <div className={styles.seg}>
                {(
                  [
                    ["venv", "项目 venv"],
                    ["uv", "uv"],
                    ["condaNew", "新建 conda"],
                    ["conda", "基础 conda"],
                    ["custom", "自定义环境"],
                  ] as Array<[EnvType, string]>
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={styles.segBtn}
                    data-active={envType === id}
                    onClick={() => setEnvType(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {showVenv ? (
              <div className={styles.row}>
                <div className={styles.label}>Python 版本:</div>
                {envType === "condaNew" ? (
                  <select className={styles.select} value={pyVersion} onChange={(e) => setPyVersion(e.target.value)}>
                    {["默认", "3.13", "3.12", "3.11", "3.10", "3.9"].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                ) : (
                  <select className={styles.select} defaultValue="默认">
                    <option>默认</option>
                  </select>
                )}
              </div>
            ) : null}
            {envType === "uv" ? (
              <div className={styles.row}>
                <div className={styles.label}>uv 的路径:</div>
                <div className={styles.inputWrap}>
                  <input
                    className={styles.input}
                    value={uvPath}
                    placeholder="未找到 uv，请填写路径"
                    onChange={(e) => setUvPath(e.target.value)}
                  />
                  <ValidityIcon checkPath={uvPath} mode="exists" />
                  <button type="button" className={styles.browseBtn} title="浏览" onClick={() => void browseUv()}>
                    <Icon name="folder" size={15} />
                  </button>
                </div>
              </div>
            ) : null}
            {showVenv ? (
              <>
                <div className={styles.row}>
                  <div className={styles.label}>位置:</div>
                  <div className={styles.inputWrap}>
                    <input
                      className={styles.input}
                      value={venvPath}
                      placeholder="虚拟环境位置"
                      onChange={(e) => setVenvPathExplicit(e.target.value)}
                    />
                    <ValidityIcon checkPath={venvPath} mode="venvDir" />
                    <button type="button" className={styles.browseBtn} title="浏览" onClick={() => void browseVenv()}>
                      <Icon name="folder" size={15} />
                    </button>
                  </div>
                </div>
                <div className={styles.row}>
                  <div />
                  <div className={styles.hint}>
                    {envType === "uv" ? "uv" : envType === "condaNew" ? "conda" : "venv"} 环境将在项目根中创建:{" "}
                    {venvPath}
                  </div>
                </div>
              </>
            ) : null}
            {showCondaBase ? (
              <div className={styles.row}>
                <div className={styles.label}>基础环境:</div>
                <div className={styles.inputWrap}>
                  {condaBase ? (
                    <span className={styles.hint}>
                      {envType === "condaNew"
                        ? `基于基础 conda 环境（${condaBase.name}）新建独立环境`
                        : `使用基础 conda 环境：${condaBase.name}（${condaBase.path}）`}
                    </span>
                  ) : (
                    <span className={styles.warn}>未检测到 conda，请先在设置 › Python 中重新扫描解释器。</span>
                  )}
                </div>
              </div>
            ) : null}
            {envType === "custom" ? (
              <div className={styles.row}>
                <div className={styles.label}>解释器:</div>
                <div className={styles.inputWrap}>
                  <input
                    className={styles.input}
                    value={customPath}
                    placeholder="python.exe 的完整路径"
                    onChange={(e) => setCustomPath(e.target.value)}
                  />
                  <button type="button" className={styles.browseBtn} title="浏览" onClick={() => void browseCustom()}>
                    <Icon name="folder" size={15} />
                  </button>
                </div>
              </div>
            ) : null}
            {ptype !== "pure" ? (
              <div className={styles.row}>
                <div />
                <div className={styles.hint}>
                  {ptype === "django"
                    ? "将生成 requirements.txt（django）；建议创建后用终端运行 django-admin startproject 初始化。"
                    : "将生成最小可运行的入口文件与 requirements.txt。"}
                </div>
              </div>
            ) : null}
          </section>
        </div>
        <div className={styles.footer}>
          <button
            type="button"
            className={styles.button}
            data-primary="true"
            disabled={!location.trim() || creating}
            onClick={() => void create()}
          >
            {creating ? step || "创建中…" : "创建"}
          </button>
        </div>
      </div>
    </>
  );
}

/** 输入框旁的有效性图标：uv 路径须存在；venv 位置须不是文件（目录可复用/待创建）。 */
function ValidityIcon({ checkPath, mode }: { checkPath: string; mode: "exists" | "venvDir" }) {
  const [state, setState] = useState<"ok" | "bad" | null>(null);
  useEffect(() => {
    if (!checkPath.trim()) {
      setState(null);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        if (mode === "exists") {
          setState((await ipc.fsExists(checkPath)) ? "ok" : "bad");
        } else {
          const st = await ipc.fsStat(checkPath);
          setState(st.kind === "file" ? "bad" : "ok");
        }
      } catch {
        if (alive) setState(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [checkPath, mode]);
  if (!state) return null;
  return (
    <span className={styles.valid} data-ok={state === "ok"}>
      <Icon name={state === "ok" ? "check" : "close"} size={14} />
    </span>
  );
}
