/** Debug the active Python file (PyCharm Shift+F9). */
import { message } from "@tauri-apps/plugin-dialog";
import { useDocs } from "../../editor/docs";
import { useToolWindows } from "../../workbench/toolwindows/store";
import { useDebug } from "./store";

export async function debugActiveFile(target?: string | null): Promise<void> {
  const activeId = target ?? useDocs.getState().activeId;
  if (!activeId || !activeId.toLowerCase().endsWith(".py")) {
    await message("Open a Python file to debug.", { title: "Debug" });
    return;
  }
  useToolWindows.getState().show("debug");
  await useDocs.getState().saveAll();
  await useDebug.getState().start(activeId);
}
