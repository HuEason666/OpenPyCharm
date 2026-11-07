/** Keeps a panel crash from taking down the whole workbench, and shows the stack. */
import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <pre
          style={{
            margin: 0,
            padding: 12,
            height: "100%",
            overflow: "auto",
            whiteSpace: "pre-wrap",
            color: "var(--danger)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
          }}
        >
          {String(this.state.error.stack ?? this.state.error.message)}
        </pre>
      );
    }
    return this.props.children;
  }
}
