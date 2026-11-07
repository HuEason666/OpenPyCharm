/** Lower-right toast host; click a card to dismiss it early. */
import { useNotify } from "../platform/notify";
import styles from "./Toasts.module.css";

export function Toasts() {
  const toasts = useNotify((s) => s.toasts);
  if (!toasts.length) return null;
  return (
    <div className={styles.host} role="status">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={styles.toast}
          data-kind={t.kind}
          title="点击关闭"
          onClick={() => useNotify.getState().dismiss(t.id)}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
