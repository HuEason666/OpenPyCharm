/**
 * Run tool window: session tabs (name + status dot), ANSI-colored output
 * console (anser), stdin row. Run/Stop header actions are contributed by the
 * tool window registration.
 */
import { useEffect, useMemo, useRef } from "react";
import anser from "anser";
import { Icon } from "../../ui/icons";
import { useRun } from "./store";
import styles from "./RunView.module.css";

export function RunOutput() {
  const sessions = useRun((s) => s.sessions);
  const activeId = useRun((s) => s.activeId);
  const setActive = useRun((s) => s.setActive);
  const outRef = useRef<HTMLDivElement | null>(null);

  const session = sessions.find((s) => s.id === activeId) ?? sessions[sessions.length - 1] ?? null;

  const html = useMemo(() => {
    if (!session) return "";
    const text = session.chunks.map((c) => c.text).join("");
    return anser.ansiToHtml(text, { use_classes: true });
  }, [session]);

  useEffect(() => {
    const el = outRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [html]);

  if (!sessions.length) {
    return <div className={styles.empty}>Press Shift+F10 to run the current file</div>;
  }

  return (
    <div className={styles.run}>
      {sessions.length > 1 ? (
        <div className={styles.tabsRow}>
          {sessions.slice(-8).map((s) => (
            <button
              key={s.id}
              type="button"
              className={styles.runTab}
              data-active={s.id === session?.id}
              data-running={s.status === "running"}
              onClick={() => setActive(s.id)}
            >
              <span className={styles.statusDot} />
              {s.name}
            </button>
          ))}
        </div>
      ) : null}
      <div className={styles.output} ref={outRef} dangerouslySetInnerHTML={{ __html: html }} />
      {session?.status === "running" ? <StdinRow sessionId={session.id} /> : null}
    </div>
  );
}

function StdinRow({ sessionId }: { sessionId: number }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className={styles.stdinRow}>
      <input
        ref={inputRef}
        className={styles.stdinInput}
        placeholder="Type here to send input to the process…"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const value = e.currentTarget.value + "\n";
            e.currentTarget.value = "";
            void import("../../platform/ipc").then(({ ipc }) => ipc.runWriteStdin(sessionId, value));
          }
        }}
      />
    </div>
  );
}

export function RunHeaderActions() {
  const activeId = useRun((s) => s.activeId);
  const running = useRun((s) => s.sessions.find((x) => x.id === s.activeId)?.status === "running");
  return (
    <>
      <button
        type="button"
        className={styles.iconButton}
        title="Rerun (Ctrl+F5)"
        disabled={activeId === null}
        onClick={() => {
          const s = useRun.getState();
          const session = s.sessions.find((x) => x.id === activeId);
          // start() reuses the session tab and stops a still-running process.
          if (session) void s.start(session.name, session.config);
        }}
      >
        <Icon name="rerun" size={16} />
      </button>
      <button
        type="button"
        className={styles.iconButton}
        title="Stop (Ctrl+F2)"
        disabled={!running}
        onClick={() => void useRun.getState().stop()}
      >
        <Icon name={running ? "stop-filled" : "stop"} size={16} />
      </button>
      <button
        type="button"
        className={styles.iconButton}
        title="Clear"
        disabled={activeId === null}
        onClick={() => {
          if (activeId !== null) useRun.getState().clear(activeId);
        }}
      >
        <Icon name="trash" size={16} />
      </button>
    </>
  );
}
