/** Small path helpers (path only ever split on "/" — Windows Tauri paths use it). */

export function pathBase(p: string): string {
  const norm = p.replace(/[\\/]+$/, "");
  const i = Math.max(norm.lastIndexOf("/"), norm.lastIndexOf("\\"));
  return i >= 0 ? norm.slice(i + 1) : norm;
}

export function pathDir(p: string): string {
  const norm = p.replace(/[\\/]+$/, "");
  const i = Math.max(norm.lastIndexOf("/"), norm.lastIndexOf("\\"));
  return i > 0 ? norm.slice(0, i) : norm;
}

export function pathJoin(a: string, b: string): string {
  const sep = a.includes("\\") ? "\\" : "/";
  return a.replace(/[\\/]+$/, "") + sep + b.replace(/^[\\/]+/, "");
}

export function pathRelative(root: string, p: string): string {
  const normRoot = root.replace(/[\\/]+$/, "");
  if (p.startsWith(normRoot + "/") || p.startsWith(normRoot + "\\")) {
    return p.slice(normRoot.length + 1);
  }
  return p;
}
