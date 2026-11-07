/**
 * App root: settings boot, appearance, feature activation, then the Workbench
 * (which itself shows Welcome until a project is open).
 */
import { useEffect, useState } from "react";
import { useSettings } from "./platform/settings";
import { applyAppearance } from "./platform/theme";
import { activateWorkbench } from "./workbench/activate";
import { Workbench } from "./workbench/Workbench";
import { ErrorBoundary } from "./workbench/ErrorBoundary";
import { useProject } from "./platform/project";

export default function App() {
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    (async () => {
      await useSettings.getState().load();
      const settings = useSettings.getState().settings;
      applyAppearance(settings);
      // Keep every appearance token in sync with settings changes.
      useSettings.subscribe((s) => applyAppearance(s.settings));
      activateWorkbench();
      setBooted(true);
      // 第二窗口（文件 › 在新窗口中打开）通过 ?project= 传递要打开的项目。
      const urlProject = new URLSearchParams(window.location.search).get("project");
      if (urlProject) {
        void useProject.getState().open(urlProject);
      } else if (settings.reopenLastProject && settings.recents.length) {
        void useProject.getState().open(settings.recents[0]);
      }
    })();
  }, []);

  if (!booted) return null;
  return (
    <ErrorBoundary>
      <Workbench />
    </ErrorBoundary>
  );
}
