"use client";

// ProposeDrawer — the joint proposal runs in a right pop-out: the officers' REAL
// reasoning streams while they work, then the proposed changes appear to review
// and Accept / Dismiss in place.
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Chip, Confidence } from "@/components/ui";
import { PulseDots } from "@/components/alive";
import { streamStructured } from "@/components/alive";

type Advisor = { key: string; name: string; short: string; accent: string };
type Change = { label: string; kind: string; proposed_value: string };
type Result = {
  proposal_id: string;
  proposal: { title: string; rationale: string; conf_level: number; conf_label: string; proposed_by: string; changes: Change[] };
};

export default function ProposeDrawer({ open, onClose, target, advisors, onDone }: {
  open: boolean;
  onClose: () => void;
  target: { kind: "product" | "gtm"; id: string; name?: string };
  advisors: Advisor[];
  onDone: () => void;
}) {
  const supabase = createClient();
  const [thinking, setThinking] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const traceRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const run = useCallback(async () => {
    setBusy(true); setThinking(""); setResult(null); setError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const idKey = target.kind === "product" ? "product_id" : "gtm_record_id";
      const res = await streamStructured<Result>({
        fnName: "agent-propose",
        token: sess.session?.access_token,
        body: { agent_keys: advisors.map((a) => a.key), agent_key: advisors[0]?.key, [idKey]: target.id },
        onThinking: (s) => setThinking((p) => p + s),
      });
      setResult(res);
    } catch (e) { setError(e instanceof Error ? e.message : "Proposal failed."); }
    finally { setBusy(false); }
  }, [supabase, target.kind, target.id, advisors]);

  // Kick off once per open.
  useEffect(() => {
    if (!open) { started.current = false; setThinking(""); setResult(null); setError(null); setBusy(false); return; }
    if (started.current) return; started.current = true; run();
  }, [open, run]);
  useEffect(() => { traceRef.current?.scrollTo({ top: traceRef.current.scrollHeight }); }, [thinking]);

  async function accept() {
    if (!result) return; setActing(true); setError(null);
    const { error } = await supabase.rpc("accept_proposal", { p_proposal: result.proposal_id, p_ratifier: "web" });
    if (error) { setError(error.message); setActing(false); return; }
    onDone(); onClose();
  }
  async function dismiss() {
    if (!result) return; setActing(true);
    await supabase.from("proposals").update({ status: "dismissed" }).eq("id", result.proposal_id);
    onDone(); onClose();
  }

  if (!open) return null;
  const names = advisors.map((a) => a.name.split(" ").slice(-1)[0]).join(" + ");
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(11,12,14,0.32)", zIndex: 50 }} />
      <aside style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: 560, maxWidth: "96vw", background: "var(--panel)", borderLeft: "1px solid var(--border)", boxShadow: "var(--shadow-md)", zIndex: 51, display: "flex", flexDirection: "column" }}>
        <div className="row-between" style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", alignItems: "center", gap: 8 }}>
          <div className="row gap-2" style={{ alignItems: "center", minWidth: 0 }}>
            <div style={{ display: "flex" }}>
              {advisors.map((e, i) => (
                <span key={e.key} style={{ width: 28, height: 28, borderRadius: "50%", background: e.accent, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 10.5, border: "2px solid var(--panel)", marginLeft: i ? -8 : 0 }}>{e.short}</span>
              ))}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 660 }}>Joint proposal</div>
              <div className="t-sub t-muted" style={{ fontSize: 12 }}>{names} · {target.name}</div>
            </div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
          {error && <div className="banner banner-error" style={{ marginBottom: 12 }}>{error}</div>}

          {/* reasoning trace */}
          {(busy || thinking) && (
            <div style={{ marginBottom: result ? 16 : 0 }}>
              <div className="t-label" style={{ color: "var(--ac)", marginBottom: 6 }}>{result ? "How they got here" : <>{names} are working<PulseDots /></>}</div>
              <div ref={traceRef} style={{ fontSize: 11.5, lineHeight: 1.5, fontStyle: "italic", whiteSpace: "pre-wrap", color: "var(--tm)", borderLeft: "2px solid var(--border)", paddingLeft: 10, maxHeight: result ? 140 : 320, overflowY: "auto" }}>
                {thinking || "Thinking it through…"}
              </div>
            </div>
          )}

          {/* the proposal */}
          {result && (
            <div className="reveal-up">
              <div className="row-between" style={{ gap: 12, marginBottom: 8, alignItems: "flex-start" }}>
                <div style={{ fontSize: 15.5, fontWeight: 660, lineHeight: 1.35 }}>{result.proposal.title}</div>
                <Confidence label={result.proposal.conf_label} level={result.proposal.conf_level} />
              </div>
              {result.proposal.rationale && <p className="t-body" style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 14 }}>{result.proposal.rationale}</p>}

              <div className="t-label" style={{ color: "var(--tm)", marginBottom: 6 }}>Proposed changes</div>
              <div className="stack-2" style={{ marginBottom: 16 }}>
                {result.proposal.changes.length === 0 && <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No concrete field changes — see the rationale.</div>}
                {result.proposal.changes.map((c, i) => (
                  <div key={i} className="card card-pad" style={{ padding: "10px 12px" }}>
                    <div className="row gap-2" style={{ marginBottom: 4, alignItems: "center" }}>
                      <Chip tone={c.kind === "add" ? "green" : "accent"}>{c.kind === "add" ? "New field" : "Update"}</Chip>
                      <span style={{ fontSize: 13, fontWeight: 620 }}>{c.label}</span>
                    </div>
                    <div className="t-sub" style={{ fontSize: 12.5, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{c.proposed_value}</div>
                  </div>
                ))}
              </div>

              <div className="row gap-2">
                <button className="btn btn-success" disabled={acting} onClick={accept}>{acting ? "Accepting…" : "Accept"}</button>
                <button className="btn btn-secondary" disabled={acting} onClick={dismiss} style={{ color: "var(--rd-text)" }}>Dismiss</button>
                <button className="btn btn-secondary" disabled={acting || busy} onClick={run}>Re-run</button>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
