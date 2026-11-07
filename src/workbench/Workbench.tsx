/**
 * Workbench: the window shell — title bar always visible; when a project is
 * open, the tool window layout with the editor island and status bar, else
 * the Welcome screen. Layout restores per project.
 */
import { useEffect } from "react";
import { TitleBar } from "./TitleBar";
import { StatusBar } from "./StatusBar";
import { OverlayHost } from "./OverlayHost";
import { Toasts } from "./Toasts";
import { ToolWindowLayout } from "./toolwindows/ToolWindows";
import { restoreLayout } from "./toolwindows/store";
import { useProject } from "../platform/project";
import { useSettings } from "../platform/settings";
import { useDocs } from "../editor/docs";
import { Welcome } from "./Welcome";
import EditorArea from "../editor/EditorArea";

export function Workbench() {
  const generation = useProject((s) => s.generation);
  const root = useProject((s) => s.root);

  useEffect(() => {
    restoreLayout(root);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation]);

  // Autosave like PyCharm: save everything when the window loses focus.
  // Can be turned off in 设置 › 系统设置.
  const autosave = useSettings((s) => s.settings.autosaveOnBlur);
  useEffect(() => {
    if (autosave === false) return;
    const onBlur = () => void useDocs.getState().saveAll();
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [autosave]);

  return (
    <>
      <TitleBar />
      {root ? (
        <>
          <ToolWindowLayout editorArea={<EditorArea />} />
          <StatusBar />
        </>
      ) : (
        <Welcome />
      )}
      <OverlayHost />
      <Toasts />
    </>
  );
}
