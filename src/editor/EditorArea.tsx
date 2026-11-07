/**
 * Editor area: Islands pill tabs + one CodeMirror view per open document.
 * Views stay alive (detached) while their tab is open so cursor, history and
 * unsaved edits survive tab switches.
 */
import { useEffect, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { Compartment } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Icon, fileIconName } from "../ui/icons";
import { PopupMenu } from "../ui/PopupMenu";
import { ipc } from "../platform/ipc";
import { useDocs, type Doc } from "./docs";
import { baseExtensions } from "./setup";
import { setActiveView } from "./activeView";
import { setDocTextProvider } from "./docs";
import { registerLspView, unregisterLspView } from "../platform/lsp";
import { breakpointExtension, debugLineExtension } from "../features/debug/breakpoints";
import { takeReveal, applyReveal } from "./reveal";
import { emitEditorUpdate } from "./viewEvents";
import { Breadcrumbs } from "./Breadcrumbs";
import styles from "./EditorArea.module.css";

const views = new Map<string, EditorView>();

export function editorViewFor(id: string): EditorView | null {
  return views.get(id) ?? null;
}

/**
 * Create (but don't attach) an editor for a document opened in the background
 * by the language server, so reference lists and hovers can map positions.
 */
export async function ensureBackgroundView(path: string): Promise<EditorView | null> {
  const existing = views.get(path);
  if (existing) return existing;
  let doc = useDocs.getState().docs.find((d) => d.id === path);
  if (!doc) {
    await useDocs.getState().openDocBackground(path);
    doc = useDocs.getState().docs.find((d) => d.id === path);
  }
  if (!doc) return null;
  let view = views.get(path);
  if (!view) {
    view = createView(doc);
    views.set(path, view);
  }
  return view;
}

export default function EditorArea() {
  const docs = useDocs((s) => s.docs);
  const activeId = useDocs((s) => s.activeId);
  const setActive = useDocs((s) => s.setActive);
  const closeDoc = useDocs((s) => s.closeDoc);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef<string | null>(null);

  // Register the live-text provider used by Save.
  useEffect(() => {
    setDocTextProvider((id) => {
      const view = views.get(id);
      return view ? view.state.doc.toString() : null;
    });
  }, []);

  // Mount/unmount views as the active tab changes.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (mountedRef.current === activeId) return;
    if (mountedRef.current) {
      const prev = views.get(mountedRef.current);
      if (prev && prev.dom.parentNode === host) host.removeChild(prev.dom);
    }
    mountedRef.current = null;
    if (!activeId) return;
    let view = views.get(activeId);
    if (!view) {
      const doc = docs.find((d) => d.id === activeId);
      if (!doc) return;
      view = createView(doc);
      views.set(activeId, view);
    }
    host.appendChild(view.dom);
    mountedRef.current = activeId;
    setActiveView(view);
    view.requestMeasure();
    const reveal = takeReveal(activeId);
    if (reveal) applyReveal(view, reveal);
    emitEditorUpdate();
  }, [activeId, docs]);

  // Destroy views when their doc closes.
  useEffect(() => {
    for (const [id, view] of views) {
      if (!docs.some((d) => d.id === id)) {
        if (mountedRef.current === id) {
          view.dom.parentNode?.removeChild(view.dom);
          mountedRef.current = null;
        }
        unregisterLspView(id);
        view.destroy();
        views.delete(id);
      }
    }
    emitEditorUpdate();
  }, [docs]);

  const activeDoc = docs.find((d) => d.id === activeId) ?? null;
  const moveDoc = useDocs((s) => s.moveDoc);
  const closeOthers = useDocs((s) => s.closeOthers);
  const closeAll = useDocs((s) => s.closeAll);
  const dragRef = useRef<{ id: string; index: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; doc: Doc } | null>(null);
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number } | null>(null);

  return (
    <div className={styles.area}>
      <div className={styles.tabstrip} role="tablist">
        {docs.map((doc, index) => (
          <div
            key={doc.id}
            role="tab"
            aria-selected={doc.id === activeId}
            data-active={doc.id === activeId}
            className={styles.tab}
            title={doc.path}
            draggable
            onDragStart={(e) => {
              dragRef.current = { id: doc.id, index };
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", doc.id);
            }}
            onDragOver={(e) => {
              if (dragRef.current?.id !== doc.id) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              const drag = dragRef.current;
              dragRef.current = null;
              if (drag && drag.id !== doc.id) moveDoc(drag.id, index);
            }}
            onDragEnd={() => {
              dragRef.current = null;
            }}
            onClick={() => setActive(doc.id)}
            onAuxClick={(e) => {
              if (e.button === 1) closeDoc(doc.id);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, doc });
            }}
          >
            <Icon name={fileIconName(doc.name)} size={16} />
            <span className={styles.tabName}>{doc.name}</span>
            {doc.dirty ? <span className={styles.dirtyDot} /> : null}
            <button
              type="button"
              className={styles.tabClose}
              data-active={doc.id === activeId}
              aria-label={`Close ${doc.name}`}
              onClick={(e) => {
                e.stopPropagation();
                closeDoc(doc.id);
              }}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        ))}
        <div className={styles.tabsRight}>
          <button type="button" className={styles.tabBarBtn} disabled title="垂直拆分（即将推出）">
            <Icon name="split" size={14} />
          </button>
          <button
            type="button"
            className={styles.tabBarBtn}
            title="更多操作"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setRowMenu({ x: rect.right - 200, y: rect.bottom + 4 });
            }}
          >
            <Icon name="more" size={14} />
          </button>
        </div>
      </div>
      {rowMenu ? (
        <PopupMenu
          x={rowMenu.x}
          y={rowMenu.y}
          items={[
            { type: "item", label: "关闭标签", hint: "Ctrl+F4", disabled: !activeId, onSelect: () => activeId && closeDoc(activeId) },
            { type: "item", label: "关闭其他标签", disabled: !activeId, onSelect: () => activeId && closeOthers(activeId) },
            { type: "item", label: "关闭所有标签", disabled: !docs.length, onSelect: () => closeAll() },
          ]}
          onClose={() => setRowMenu(null)}
        />
      ) : null}
      {menu ? (
        <PopupMenu
          x={menu.x}
          y={menu.y}
          items={[
            { type: "item", label: "Close", hint: "Ctrl+F4", onSelect: () => closeDoc(menu.doc.id) },
            { type: "item", label: "Close Others", onSelect: () => closeOthers(menu.doc.id) },
            { type: "item", label: "Close All", onSelect: () => closeAll() },
            { type: "separator" },
            {
              type: "item",
              label: "Copy Path",
              icon: "copy",
              onSelect: () => void navigator.clipboard.writeText(menu.doc.path).catch(() => {}),
            },
            {
              type: "item",
              label: "Show in Explorer",
              icon: "external-link",
              onSelect: () => void ipc.fsRevealInShell(menu.doc.path).catch(() => {}),
            },
          ]}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {activeId && activeDoc ? (
        <>
          <Breadcrumbs docId={activeId} name={activeDoc.name} />
          <div className={styles.editorHost} ref={hostRef} />
        </>
      ) : (
        <div className={styles.empty}>No files are open</div>
      )}
    </div>
  );
}

function createView(doc: { id: string; saved: string; language: Parameters<typeof baseExtensions>[0] }): EditorView {
  const docId = doc.id;
  const lspCompartment = new Compartment();
  const view = new EditorView({
    state: EditorState.create({
      doc: doc.saved,
      extensions: [
        ...baseExtensions(doc.language, {
          path: () => docId,
          onUpdate: (update) => {
            const docs = useDocs.getState();
            if (update.docChanged) docs.markDirty(docId, update.state.doc.toString());
            const head = update.state.selection.main.head;
            const line = update.state.doc.lineAt(head);
            docs.setCaret(docId, line.number, head - line.from + 1);
            emitEditorUpdate();
          },
        }),
        lspCompartment.of([]),
        breakpointExtension(docId),
        debugLineExtension(),
      ],
    }),
    parent: document.createElement("div"),
  });
  registerLspView(docId, doc.language, view, lspCompartment);
  view.dom.addEventListener("focusin", () => {
    setActiveView(view);
    useDocs.getState().setEditorFocused(true);
  });
  view.dom.addEventListener("focusout", () => {
    useDocs.getState().setEditorFocused(false);
  });
  return view;
}
