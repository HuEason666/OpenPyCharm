/**
 * Debug tool window: stepping toolbar, stack frames, scopes/variables tree,
 * breakpoint list and an evaluate console.
 */
import { useEffect, useState } from "react";
import { Icon } from "../../ui/icons";
import { pathBase } from "../../platform/paths";
import { editorViewFor } from "../../editor/EditorArea";
import { revealInEditor } from "../../editor/reveal";
import { useDebug } from "./store";
import {
  allBreakpoints,
  onBreakpointsChange,
  refreshBreakpointGutter,
  removeBreakpoint,
} from "./breakpoints";
import styles from "./DebugView.module.css";

function Toolbar() {
  const status = useDebug((s) => s.status);
  const program = useDebug((s) => s.program);
  const active = ["starting", "running", "paused"].includes(status);
  const paused = status === "paused";
  return (
    <div className={styles.toolbar}>
      <button
        type="button"
        className={styles.iconButton}
        title="Resume (F9)"
        disabled={!paused}
        onClick={() => useDebug.getState().resume()}
      >
        <Icon name="resume" size={16} />
      </button>
      <button
        type="button"
        className={styles.iconButton}
        title="Pause"
        disabled={status !== "running"}
        onClick={() => useDebug.getState().pause()}
      >
        <Icon name="pause" size={16} />
      </button>
      <button
        type="button"
        className={styles.iconButton}
        title="Step Over (F8)"
        disabled={!paused}
        onClick={() => useDebug.getState().stepOver()}
      >
        <Icon name="step-over" size={16} />
      </button>
      <button
        type="button"
        className={styles.iconButton}
        title="Step Into (F7)"
        disabled={!paused}
        onClick={() => useDebug.getState().stepInto()}
      >
        <Icon name="step-into" size={16} />
      </button>
      <button
        type="button"
        className={styles.iconButton}
        title="Step Out (Shift+F8)"
        disabled={!paused}
        onClick={() => useDebug.getState().stepOut()}
      >
        <Icon name="step-out" size={16} />
      </button>
      <button
        type="button"
        className={styles.iconButton}
        title="Stop (Ctrl+F2)"
        disabled={!active}
        onClick={() => void useDebug.getState().stop()}
      >
        <Icon name="stop" size={16} />
      </button>
      <span className={styles.status}>
        {program ? pathBase(program) : "No debug session"} · {status}
      </span>
    </div>
  );
}

function FramesAndVariables() {
  const frames = useDebug((s) => s.frames);
  const selected = useDebug((s) => s.selectedFrame);
  const scopes = useDebug((s) => s.scopes);
  const status = useDebug((s) => s.status);

  if (status !== "paused") {
    return <div className={styles.empty}>{status === "running" ? "Running…" : "Not paused"}</div>;
  }
  if (!frames.length) return <div className={styles.empty}>No stack frames</div>;

  return (
    <div className={styles.split}>
      <div className={styles.frames}>
        {frames.map((frame) => (
          <div
            key={frame.id}
            className={styles.frameRow}
            data-active={frame.id === selected || undefined}
            title={frame.source?.path ?? ""}
            onClick={() => useDebug.getState().selectFrame(frame.id)}
          >
            <Icon name="function" size={14} />
            <span className={styles.frameName}>{frame.name}</span>
            <span className={styles.framePos}>
              {frame.source?.path ? `${pathBase(frame.source.path)}:` : ""}
              {frame.line}
            </span>
          </div>
        ))}
      </div>
      <div className={styles.variables}>
        {scopes.map((scope) => (
          <div key={scope.name} className={styles.scope}>
            <div className={styles.scopeName}>{scope.name}</div>
            <VariableTree reference={scope.variablesReference} depth={0} />
          </div>
        ))}
        {!scopes.length ? <div className={styles.hint}>No variables</div> : null}
      </div>
    </div>
  );
}

function VariableTree({ reference, depth }: { reference: number; depth: number }) {
  const variables = useDebug((s) => s.variables[reference]);
  const expanded = useDebug((s) => s.expanded);
  if (!variables?.length) return null;
  return (
    <>
      {variables.map((variable) => {
        const canExpand = variable.variablesReference > 0;
        const open = canExpand && expanded.includes(variable.variablesReference);
        return (
          <div key={`${reference}:${variable.name}`}>
            <div
              className={styles.varRow}
              style={{ paddingLeft: 10 + depth * 14 }}
              onClick={() => canExpand && useDebug.getState().toggleVariable(variable.variablesReference)}
            >
              <span className={styles.chevron}>
                {canExpand ? <Icon name={open ? "chevron-down" : "chevron-right"} size={12} /> : null}
              </span>
              <span className={styles.varName}>{variable.name}</span>
              <span className={styles.varValue}>{variable.value}</span>
              {variable.type ? <span className={styles.varType}>{variable.type}</span> : null}
            </div>
            {open ? <VariableTree reference={variable.variablesReference} depth={depth + 1} /> : null}
          </div>
        );
      })}
    </>
  );
}

function Breakpoints() {
  const [, force] = useState(0);
  const status = useDebug((s) => s.status);
  useEffect(() => onBreakpointsChange(() => force((n) => n + 1)), []);
  const items = allBreakpoints();
  if (!items.length) {
    return <div className={styles.empty}>Click in the editor gutter to add a breakpoint</div>;
  }
  return (
    <div className={styles.breakpoints}>
      {items.map((bp) => (
        <div key={`${bp.path}:${bp.line}`} className={styles.frameRow} title={bp.path}>
          <Icon name="breakpoint" size={14} />
          <span className={styles.frameName} onClick={() => revealInEditor(bp.path, bp.line, 1)}>
            {pathBase(bp.path)}:{bp.line}
          </span>
          <button
            type="button"
            className={styles.removeButton}
            title="Remove breakpoint"
            onClick={() => {
              removeBreakpoint(bp.path, bp.line);
              refreshBreakpointGutter(editorViewFor(bp.path));
            }}
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
      <div className={styles.hint}>
        {status === "paused" || status === "running" ? "Breakpoints apply immediately" : "Breakpoints apply on the next debug session"}
      </div>
    </div>
  );
}

function Console() {
  const output = useDebug((s) => s.output);
  const status = useDebug((s) => s.status);
  const [expression, setExpression] = useState("");
  return (
    <div className={styles.console}>
      <pre className={styles.output}>{output.join("")}</pre>
      <div className={styles.evalRow}>
        <input
          className={styles.evalInput}
          placeholder={status === "paused" ? "Evaluate expression…" : "Paused state required to evaluate"}
          value={expression}
          disabled={status !== "paused"}
          onChange={(e) => setExpression(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !expression.trim()) return;
            const value = expression;
            setExpression("");
            void useDebug.getState().evaluate(value);
          }}
        />
        <button
          type="button"
          className={styles.clearButton}
          onClick={() => useDebug.getState().clearOutput()}
        >
          Clear
        </button>
      </div>
    </div>
  );
}

export function DebugView() {
  const [tab, setTab] = useState<"debug" | "breakpoints" | "console">("debug");
  const status = useDebug((s) => s.status);
  const frames = useDebug((s) => s.frames);

  useEffect(() => {
    if (status === "paused" && frames.length) setTab("debug");
  }, [status, frames.length]);

  return (
    <div className={styles.debug}>
      <Toolbar />
      <div className={styles.tabs}>
        <button type="button" className={styles.tab} data-active={tab === "debug"} onClick={() => setTab("debug")}>
          Frames & Variables
        </button>
        <button
          type="button"
          className={styles.tab}
          data-active={tab === "breakpoints"}
          onClick={() => setTab("breakpoints")}
        >
          Breakpoints
        </button>
        <button type="button" className={styles.tab} data-active={tab === "console"} onClick={() => setTab("console")}>
          Console
        </button>
      </div>
      <div className={styles.body}>
        {tab === "debug" ? <FramesAndVariables /> : null}
        {tab === "breakpoints" ? <Breakpoints /> : null}
        {tab === "console" ? <Console /> : null}
      </div>
    </div>
  );
}
