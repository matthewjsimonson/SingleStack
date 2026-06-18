"use client";

// A small client error boundary so a runtime throw in a heavy surface (e.g. the
// TipTap editor) degrades to a readable, reportable message instead of white-
// screening the whole app. Surfaces error.message so we can diagnose fast.
import React from "react";

type Props = { children: React.ReactNode; label?: string };
type State = { error: Error | null };

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", error, info?.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="card card-pad" style={{ borderLeft: "3px solid var(--rd-text, #b23a48)" }}>
          <div className="t-h2" style={{ fontSize: 15, marginBottom: 6 }}>This area hit an error</div>
          <div className="t-sub" style={{ color: "var(--ts)", marginBottom: 10 }}>
            {this.props.label ?? "Something went wrong rendering this screen. The details below help us fix it."}
          </div>
          <pre style={{ fontSize: 12, whiteSpace: "pre-wrap", color: "var(--tm)", background: "var(--fill)", padding: 10, borderRadius: 6, overflowX: "auto", margin: 0 }}>
            {this.state.error.message}
          </pre>
          <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => this.setState({ error: null })}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}
