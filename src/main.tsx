import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./styles/tokens.css";
import "./styles/global.css";
import "./app.css";
import App from "./App";
import { installKeyboardDispatcher } from "./platform/keymap";
import { installRunListeners } from "./features/run/store";
import { installTerminalPiping } from "./features/terminal/TerminalView";
import { installFsWatcher } from "./features/fs-watcher";

installKeyboardDispatcher();
installRunListeners();
installTerminalPiping();
installFsWatcher();

// Surfacing runtime errors on the window title (visible via automation);
// console remains the primary channel in DevTools.
window.addEventListener("error", (e) => {
  document.title = `ERR: ${e.message}`.slice(0, 120);
});
window.addEventListener("unhandledrejection", (e) => {
  document.title = `REJ: ${String(e.reason)}`.slice(0, 120);
});

createRoot(document.getElementById("root")!).render(<App />);
