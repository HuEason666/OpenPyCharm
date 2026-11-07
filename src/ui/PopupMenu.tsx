/**
 * Popup menu: fixed-position item list used by the main menu, gear menu and
 * context menus. Supports one level of submenus (`children`, opened on
 * hover). Esc/arrows navigate; click-away dismisses (the root's backdrop
 * cascades the close through the whole submenu chain).
 */
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import styles from "./PopupMenu.module.css";

export type MenuItem =
  | { type: "separator" }
  | {
      type: "item";
      label: string;
      hint?: string | null;
      icon?: string;
      disabled?: boolean;
      danger?: boolean;
      checked?: boolean;
      /** Opens a submenu to the right on hover. */
      children?: MenuItem[];
      onSelect?: () => void;
    };

export interface PopupState {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
  /** Called by the root backdrop / cascade closes so submenus all dismiss. */
  onRequestCloseAll?: () => void;
  /** Submenus render no backdrop of their own. */
  isSub?: boolean;
}

export function PopupMenu({ x, y, items, onClose, onRequestCloseAll, isSub }: PopupState) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(-1);
  const [pos, setPos] = useState({ x, y });
  const [sub, setSub] = useState<{ index: number; x: number; y: number } | null>(null);
  const closeAll = onRequestCloseAll ?? onClose;

  useEffect(() => {
    // Clamp into the viewport once measured.
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (x + rect.width > window.innerWidth - 8) nx = Math.max(8, window.innerWidth - rect.width - 8);
    if (y + rect.height > window.innerHeight - 8) ny = Math.max(8, window.innerHeight - rect.height - 8);
    setPos({ x: nx, y: ny });
  }, [x, y]);

  const enabled = items.map((it, i) => (it.type === "item" && !it.disabled ? i : -1));
  const move = (dir: 1 | -1) => {
    let i = index;
    for (let step = 0; step < items.length; step++) {
      i = (i + dir + items.length) % items.length;
      if (enabled.includes(i)) {
        setIndex(i);
        setSub(null);
        return;
      }
    }
  };

  const openSub = (i: number, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    setSub({ index: i, x: rect.right - 4, y: rect.top - 4 });
  };

  return (
    <>
      {!isSub ? (
        <div
          style={{ position: "fixed", inset: 0, zIndex: "var(--z-popup)" }}
          onPointerDown={closeAll}
          onContextMenu={(e) => {
            e.preventDefault();
            closeAll();
          }}
        />
      ) : null}
      <div
        ref={ref}
        className={styles.menu}
        role="menu"
        style={{ left: pos.x, top: pos.y }}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            move(1);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            move(-1);
          } else if (e.key === "Enter") {
            e.preventDefault();
            const item = items[index];
            if (item?.type === "item" && !item.disabled && !item.children) {
              closeAll();
              item.onSelect?.();
            }
          }
        }}
        autoFocus
      >
        {items.map((item, i) =>
          item.type === "separator" ? (
            <div key={i} className={styles.separator} />
          ) : (
            <div
              key={i}
              role="menuitem"
              aria-disabled={item.disabled}
              aria-haspopup={item.children ? "menu" : undefined}
              className={styles.item}
              data-danger={item.danger || undefined}
              data-hover={index === i || undefined}
              onPointerEnter={(e) => {
                if (item.disabled) {
                  if (sub !== null) setSub(null);
                  return;
                }
                setIndex(i);
                if (item.children) openSub(i, e.currentTarget);
                else if (sub !== null) setSub(null);
              }}
              onClick={(e) => {
                if (item.disabled) return;
                if (item.children) {
                  openSub(i, e.currentTarget as HTMLElement);
                  return;
                }
                closeAll();
                item.onSelect?.();
              }}
            >
              <span className={styles.itemIcon}>
                {item.checked ? <Icon name="check" size={14} /> : item.icon ? <Icon name={item.icon} size={16} /> : null}
              </span>
              <span className={styles.label}>{item.label}</span>
              {item.hint ? <span className={styles.hint}>{item.hint}</span> : null}
              {item.children ? (
                <span className={styles.subArrow}>
                  <Icon name="chevron-right" size={12} />
                </span>
              ) : null}
            </div>
          ),
        )}
      </div>
      {sub !== null && items[sub.index]?.type === "item" ? (
        <PopupMenu
          x={sub.x}
          y={sub.y}
          items={(items[sub.index] as Extract<MenuItem, { type: "item" }>).children ?? []}
          onClose={() => setSub(null)}
          onRequestCloseAll={closeAll}
          isSub
        />
      ) : null}
    </>
  );
}
