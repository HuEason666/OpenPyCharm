/** Open-folder dialog flow shared by menus, Welcome and keymap actions. */
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { useProject } from "../platform/project";

export async function openFolderDialog(): Promise<void> {
  const selected = await dialogOpen({ directory: true, multiple: false, title: "Open Folder" });
  if (typeof selected === "string") {
    await useProject.getState().open(selected);
  }
}
