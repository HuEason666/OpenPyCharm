/**
 * Tool window layout: left/right stripes with icon buttons, the islands grid
 * (left | editor | right / bottom) and drag-resize gap handles. Geometry
 * mirrors the OpenIDEA shell: 6px island gaps, 10px radii, track sizes driven
 * by CSS variables written from the layout store.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../../ui/icons";
import { PopupMenu, type MenuItem } from "../../ui/PopupMenu";
import { useToolWindows, type ToolWindowDef } from "./store";
import { useOverlay } from "../overlays";
import { executeAction } from "../../platform/actions";
import { useSettings } from "../../platform/settings";
import { ErrorBoundary } from "../ErrorBoundary";
import styles from "./ToolWindows.module.css";

export function registerToolWindow(def: ToolWindowDef): void {
  useToolWindows.getState().register(def);
}

export function ToolWindowLayout({ editorArea }: { editorArea: React.ReactNode }) {
  const defs = useToolWindows((s) => s.defs);
  const visible = useToolWindows((s) => s.visible);
  const sizes = useToolWindows((s) => s.sizes);
  const focused = useToolWindows((s) => s.focused);
  const gridRef = useRef<HTMLDivElement | null>(null);

  // Write track sizes as CSS variables.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    grid.style.setProperty("--tw-left", visible.left ? `${sizes.left}px` : "0px");
    grid.style.setProperty("--gap-left", visible.left ? "var(--island-gap)" : "0px");
    grid.style.setProperty("--tw-right", visible.right ? `${sizes.right}px` : "0px");
    grid.style.setProperty("--gap-right", visible.right ? "var(--island-gap)" : "0px");
    grid.style.setProperty("--tw-bottom", visible.bottom ? `${sizes.bottom}px` : "0px");
    grid.style.setProperty("--gap-bottom", visible.bottom ? "var(--island-gap)" : "0px");
  }, [visible, sizes]);

  const defsList = [...defs.values()];
  const primaryDefs = defsList.filter((d) => d.anchor === "left" || d.anchor === "right");
  const bottomDefs = defsList.filter((d) => d.anchor === "bottom");

  const startDrag = useCallback(
    (anchor: "left" | "right" | "bottom", e: React.PointerEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startX = e.clientX;
      const start = useToolWindows.getState().sizes[anchor];
      const sign = anchor === "left" ? 1 : anchor === "right" ? -1 : 1;
      const horizontal = anchor !== "bottom";
      const onMove = (ev: PointerEvent) => {
        const delta = horizontal ? (ev.clientX - startX) * sign : (ev.clientY - startY) * sign;
        useToolWindows.getState().setSize(anchor, start + delta);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [],
  );

  const renderStripeButton = (def: ToolWindowDef) => {
    const active = visible[def.anchor] === def.id;
    return (
      <button
        key={def.id}
        type="button"
        className={styles.stripeButton}
        data-active={active}
        title={`${def.title} (${def.id})`}
        aria-label={def.title}
        onClick={() => useToolWindows.getState().activate(def.id)}
      >
        <Icon name={def.icon} size={18} />
      </button>
    );
  };

  const renderToolWindow = (id: string | null) => {
    if (!id) return null;
    const def = defs.get(id);
    if (!def) return null;
    const Body = def.component;
    const HeaderActions = def.headerActions;
    return (
      <>
        <div className={styles.header}>
          <span className={styles.headerTitle}>{def.title}</span>
          {HeaderActions ? <HeaderActions /> : null}
        </div>
        <div className={styles.body} data-tool-window={def.id}>
          <ErrorBoundary>
            <Body />
          </ErrorBoundary>
        </div>
      </>
    );
  };

  const leftPrimary = primaryDefs.filter((d) => d.anchor === "left");
  const rightPrimary = primaryDefs.filter((d) => d.anchor === "right");

  return (
    <div className={styles.frame}>
      <nav className={styles.stripe} role="toolbar" aria-orientation="vertical" data-stripe-side="left">
        {leftPrimary.map(renderStripeButton)}
        <div className={styles.spacer} />
        {bottomDefs.map(renderStripeButton)}
        <GearButton />
      </nav>

      <div className={styles.grid} ref={gridRef}>
        {visible.left ? (
          <div className={`${styles.island} ${styles.islandLeft}`} data-focused={focused === visible.left}>
            {renderToolWindow(visible.left)}
          </div>
        ) : null}
        {visible.left ? <div className={`${styles.gapHandle} ${styles.gapLeft}`} onPointerDown={(e) => startDrag("left", e)} /> : null}

        <div className={`${styles.island} ${styles.islandEditor}`}>{editorArea}</div>

        {visible.right ? (
          <div className={`${styles.gapHandle} ${styles.gapRight}`} onPointerDown={(e) => startDrag("right", e)} />
        ) : null}
        {visible.right ? (
          <div className={`${styles.island} ${styles.islandRight}`} data-focused={focused === visible.right}>
            {renderToolWindow(visible.right)}
          </div>
        ) : null}

        {visible.bottom ? (
          <div className={`${styles.gapHandle} ${styles.gapBottom}`} onPointerDown={(e) => startDrag("bottom", e)} />
        ) : null}
        {visible.bottom ? (
          <div className={`${styles.island} ${styles.islandBottom}`} data-focused={focused === visible.bottom}>
            {renderToolWindow(visible.bottom)}
          </div>
        ) : null}
      </div>

      {rightPrimary.length ? (
        <nav className={styles.stripe} role="toolbar" aria-orientation="vertical" data-stripe-side="right">
          {rightPrimary.map(renderStripeButton)}
        </nav>
      ) : null}
    </div>
  );
}

/** Gear at the very bottom of the left stripe (PyCharm's customize button). */
function GearButton() {
  const [popup, setPopup] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const theme = useSettings((s) => s.settings.theme);

  return (
    <>
      <button
        type="button"
        className={styles.stripeButton}
        title="自定义 OpenPyCharm"
        aria-label="Customize OpenPyCharm"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setPopup({
            x: rect.left,
            y: rect.top - 8 - 4 * 24,
            items: [
              { type: "item", label: "设置…", hint: "Ctrl+Alt+S", icon: "settings", onSelect: () => useOverlay.getState().open({ type: "settings" }) },
              { type: "separator" },
              {
                type: "item",
                label: theme === "dark" ? "浅色主题" : "深色主题",
                icon: theme === "dark" ? "sun" : "moon",
                onSelect: () => void executeAction("view.toggleTheme"),
              },
              { type: "separator" },
              { type: "item", label: "关于", onSelect: () => useOverlay.getState().open({ type: "about" }) },
            ],
          });
        }}
      >
        <Icon name="settings" size={18} />
      </button>
      {popup ? <PopupMenu x={popup.x} y={popup.y} items={popup.items} onClose={() => setPopup(null)} /> : null}
    </>
  );
}
