/** Builds a run configuration for the active document and starts it. */
import { useDocs } from "../../editor/docs";
import { useProject } from "../../platform/project";
import { usePython } from "./store";
import { useRun } from "../run/store";
import { useToolWindows } from "../../workbench/toolwindows/store";
import { pathBase } from "../../platform/paths";

export async function runFile(path?: string | null): Promise<void> {
  const project = useProject.getState();
  const docs = useDocs.getState();
  const target = path ?? docs.activeId;
  if (!project.root || !target) return;
  const doc = docs.docs.find((d) => d.id === target);
  const file = doc?.path ?? target;
  if (!file.toLowerCase().endsWith(".py")) return;

  const python = usePython.getState().selected;
  const exe = python?.path ?? "python";

  await useRun.getState().start(pathBase(file), {
    exe,
    args: [file],
    cwd: project.root,
  });
  useToolWindows.getState().show("run");
}

export async function runActiveFile(): Promise<void> {
  await runFile();
}
