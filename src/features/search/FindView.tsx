/**
 * Find in Files tool window: query bar with case/regex toggles and results
 * grouped per file. Clicking a match opens the file at that position.
 */
import { useEffect } from "react";
import { useFind } from "./store";
import { revealInEditor } from "../../editor/reveal";
import { fileIconName, Icon } from "../../ui/icons";
import { pathRelative } from "../../platform/paths";
import { useProject } from "../../platform/project";
import styles from "./FindView.module.css";

export function FindView() {
  const query = useFind((s) => s.query);
  const setQuery = useFind((s) => s.setQuery);
  const caseSensitive = useFind((s) => s.caseSensitive);
  const regexMode = useFind((s) => s.regexMode);
  const toggleCase = useFind((s) => s.toggleCase);
  const toggleRegex = useFind((s) => s.toggleRegex);
  const outcome = useFind((s) => s.outcome);
  const searching = useFind((s) => s.searching);
  const error = useFind((s) => s.error);
  const run = useFind((s) => s.run);

  return (
    <div className={styles.find}>
      <div className={styles.queryRow}>
        <input
          className={styles.queryInput}
          value={query}
          autoFocus
          placeholder="Search in project…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void run();
          }}
        />
        <button type="button" className={styles.optionButton} data-on={caseSensitive} title="Match case" onClick={toggleCase}>
          <Icon name="case" size={16} />
        </button>
        <button type="button" className={styles.optionButton} data-on={regexMode} title="Regex" onClick={toggleRegex}>
          <Icon name="regex" size={16} />
        </button>
      </div>
      <div className={styles.results}>
        {error ? <div className={styles.empty}>{error}</div> : null}
        {!error && !outcome && !searching ? (
          <div className={styles.empty}>Type a query and press Enter to search the project</div>
        ) : null}
        {searching ? <div className={styles.empty}>Searching…</div> : null}
        {outcome ? (
          <>
            <div className={styles.summary}>
              {outcome.results.length} file{outcome.results.length === 1 ? "" : "s"} with matches
              {outcome.truncated ? " (results truncated)" : ""}
            </div>
            {outcome.results.map((file) => {
              const root = useProject.getState().root;
              return (
                <div className={styles.fileGroup} key={file.path}>
                  <div
                    className={styles.fileRow}
                    onClick={() => revealInEditor(file.path, file.matches[0]?.line ?? 1, (file.matches[0]?.col ?? 0) + 1)}
                  >
                    <Icon name={fileIconName(file.path)} size={16} />
                    <span>{file.path.split(/[\\/]/).pop()}</span>
                    <span className={styles.filePath}>{root ? pathRelative(root, file.path) : file.path}</span>
                  </div>
                  {file.matches.slice(0, 100).map((m, i) => (
                    <div
                      key={i}
                      className={styles.matchRow}
                      onClick={() => revealInEditor(file.path, m.line, m.col + 1, m.len)}
                    >
                      <span className={styles.matchLineNo}>{m.line}</span>
                      <span className={styles.matchText}>
                        {m.text.slice(Math.max(0, m.col - 40), m.col)}
                        <mark>{m.text.slice(m.col, m.col + m.len)}</mark>
                        {m.text.slice(m.col + m.len, m.col + m.len + 80)}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Focus the find query when the tool window opens. */
export function useFindAutoFocus() {
  useEffect(() => {
    const input = document.querySelector<HTMLInputElement>('input[class*="queryInput"]');
    input?.focus();
  }, []);
}
