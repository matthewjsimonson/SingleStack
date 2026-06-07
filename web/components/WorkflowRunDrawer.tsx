"use client";

// WorkflowRunDrawer — runs an authored workflow in a side panel: the officers'
// real reasoning streams step by step, then the aggregated artifact (sections +
// recommendations) reveals. Mirrors the play run drawer; output is a draft
// artifact (agent_artifacts) you can review.
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Chip } from "@/components/ui";
import { PulseDots, streamStructured } from "@/components/alive";
import { Markdown } from "@/components/Markdown";

type Section = { title: string; body: string; evidence?: string[] };
type Artifact = { title?: string; payload: { headline?: string; sections?: Section[]; recommendations?: string[]; confidence?: string } };
type Result = { artifact: Artifact; officer?: string };

export default function WorkflowRunDrawer({ open, onClose, workflow, target, onRan }: {
  open: boolean;
  onClose: () => void;
  workflow: { id: string; name: string } | null;
  target?: { type: "product" | "gtm"; id: string; name?: string } | null;
  onRan?: () => void;
}) {
  const supabase = createClient();
  const [thinking, setThinking] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const traceRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const run = useCallback(async () => {
    if (!workflow) return;
    setBusy(true); setThinking(""); setResult(null); setError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const res = await streamStructured<Result>({
        fnName: "run-workflow",
        token: sess.session?.access_token,
        body: { workflow_id: workflow.id, ...(target ? { target_type: target.type, target_id: target.id } : {}) },
        onThinking: (s) => setThinking((p) => p + s),
      });
      setResult(res); onRan?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Workflow run failed."); }
    finally { setBusy(false); }
  }, [supabase, workflow, target, onRan]);

  useEffect(() => {
    if (!open) { started.current = false; setThinking(""); setResult(null); setError(null); setBusy(false); return; }
    if (started.current) return; started.current = true; run();
  }, [open, run]);
  useEffect(() => { traceRef.current?.scrollTo({ top: traceRef.current.scrollHeight }); }, [thinking]);

  if (!open || !workflow) return null;
  const p = result?.artifact?.payload;
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(11,12,14,0.32)", zIndex: 50 }} />
      <aside style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: 600, maxWidth: "96vw", background: "var(--panel)", borderLeft: "1px solid var(--border)", boxShadow: "var(--shadow-md)", zIndex: 51, display: "flex", flexDirection: "column" }}>
        <div className="row-between" style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", alignItems: "center" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 660 }}>{workflow.name}</div>
            <div className="t-sub t-muted" style={{ fontSize: 12 }}>{target?.name ? `Focused on ${target.name} · ` : ""}{result?.officer || "Running workflow…"}</div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
          {error && <div className="banner banner-error" style={{ marginBottom: 12 }}>{error}</div>}

          {(busy || thinking) && (
            <div style={{ marginBottom: result ? 16 : 0 }}>
              <div className="t-label" style={{ color: "var(--ac)", marginBottom: 6 }}>{busy ? <>Working through the steps<PulseDots /></> : "How it ran"}</div>
              <div ref={traceRef} style={{ fontSize: 11.5, lineHeight: 1.5, fontStyle: "italic", whiteSpace: "pre-wrap", color: "var(--tm)", borderLeft: "2px solid var(--border)", paddingLeft: 10, maxHeight: busy ? 340 : 140, overflowY: "auto" }}>
                {thinking || "Reading the signals…"}
              </div>
            </div>
          )}

          {p && (
            <div className="reveal-up">
              {p.headline && <div style={{ fontSize: 16, fontWeight: 680, lineHeight: 1.35, marginBottom: 6 }}>{p.headline}</div>}
              {p.confidence && <div className="t-sub t-muted" style={{ fontSize: 12, marginBottom: 14 }}>{p.confidence}</div>}

              {(p.sections ?? []).map((s, i) => (
                <div key={i} className="card card-pad" style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 660, marginBottom: 6 }}>{s.title}</div>
                  <Markdown className="t-body" style={{ fontSize: 13, lineHeight: 1.6 }} text={s.body} />
                  {(s.evidence?.length ?? 0) > 0 && (
                    <div className="row gap-2" style={{ flexWrap: "wrap", marginTop: 8 }}>{s.evidence!.map((e, j) => <Chip key={j}>{e}</Chip>)}</div>
                  )}
                </div>
              ))}

              {(p.recommendations ?? []).length > 0 && (
                <div className="card card-pad" style={{ background: "var(--panel-2)" }}>
                  <div className="t-label" style={{ marginBottom: 6 }}>Recommendations</div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>{p.recommendations!.map((r, i) => <li key={i} className="t-sub" style={{ fontSize: 12.5, lineHeight: 1.6 }}>{r}</li>)}</ul>
                </div>
              )}

              <div className="row gap-2" style={{ marginTop: 14 }}>
                <button className="btn btn-secondary btn-sm" disabled={busy} onClick={run}>Re-run</button>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
