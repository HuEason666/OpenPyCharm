/** Fan-out for editor state changes; lets panels (structure, breadcrumbs) stay live. */
type Listener = () => void;
const listeners = new Set<Listener>();

export function onEditorUpdate(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function emitEditorUpdate(): void {
  for (const fn of listeners) fn();
}
