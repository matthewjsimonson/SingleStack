"use client";

// ProposeDrawer — the right pop-out for a record's proposals.
//   mode="run"    → the officers draft a NEW proposal: their real reasoning streams,
//                   then it lands in the waiting list below.
//   mode="review" → just review what's already waiting.
// Every waiting proposal can be Accepted (applied), Rejected (kept as rejected), or
// Hidden (the record is deleted outright).
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Chip, Confidence } from "@/components/ui";
import { PulseDots, streamStructured } from "@/components/alive";

type Advisor = { key: string; name: string; short: string; accent: string };
type Change = { label: string; kind: "add" | "update"; proposed_value: string };
type Pending = {
  id: string; title: string; rationale: string | null; conf_label: string | null;
  conf_level: number | null; proposed_by: string; created_at: string; changes: Change[];
};

export default function ProposeDrawer({ open, onClose, mode, target, advisors, onDone }: {
  open: boolean;
  onClose: () => void;
  mode: "run" | "review";
  target: { kind: "product" | "gtm"; id: string; name?: string };
  advisors: Advisor[];
  onDone: () => void;
}) {
  const supabase = createClient();
  const [thinking, setThinking] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set()); // proposals drafted in THIS session (run mode shows only these)
  const traceRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const idKey = target.kind === "product" ? "product_id" : "gtm_record_id";

  const loadPending = useCallback(async () => {
    const { data } = await supabase
      .from("proposals")
      .select("id, title, rationale, conf_label, conf_level, proposed_by, created_at, proposal_changes ( change_kind, label, proposed_value, record_field_id, record_fields ( label ) )")
      .eq(idKey, target.id).eq("status", "pending").order("created_at", { ascending: false });
    // deno-lint-ignore no-explicit-any
    const list: Pending[] = (data ?? []).map((p: any) => ({
      id: p.id, title: p.title, rationale: p.rationale, conf_label: p.conf_label, conf_level: p.conf_level, proposed_by: p.proposed_by, created_at: p.created_at,
      // deno-lint-ignore no-explicit-any
      changes: (p.proposal_changes ?? []).map((c: any) => ({ label: c.label ?? c.record_fields?.label ?? "Field", kind: c.change_kind === "add_field" ? "add" : "update", proposed_value: c.proposed_value })),
    }));
    setPending(list); setLoaded(true);
  }, [supabase, idKey, target.id]);

  const run = useCallback(async () => {
    setBusy(true); setThinking(""); setError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const res = await streamStructured<{ proposal_id?: string }>({
        fnName: "agent-propose",
        token: sess.session?.access_token,
        body: { agent_keys: advisors.map((a) => a.key), agent_key: advisors[0]?.key, [idKey]: target.id },
        onThinking: (s) => setThinking((p) => p + s),
      });
      if (res?.proposal_id) setFreshIds((prev) => new Set(prev).add(res.proposal_id as string));
      await loadPending();
    } catch (e) { setError(e instanceof Error ? e.message : "Proposal failed."); }
    finally { setBusy(false); }
  }, [supabase, advisors, idKey, target.id, loadPending]);

  // On open: load what's waiting, and (run mode) kick off a fresh proposal once.
  useEffect(() => {
    if (!open) { started.current = false; setThinking(""); setBusy(false); setError(null); setPending([]); setLoaded(false); setFreshIds(new Set()); return; }
    loadPending();
    if (mode === "run" && !started.current) { started.current = true; run(); }
  }, [open, mode, loadPending, run]);
  useEffect(() => { traceRef.current?.scrollTo({ top: traceRef.current.scrollHeight }); }, [thinking]);

  async function accept(id: string) {
    setActing(id); setError(null); setNotice(null);
    const { data: result, error } = await supabase.rpc("accept_proposal", { p_proposal: id, p_ratifier: "web" });
    if (error) { setError(error.message); setActing(null); return; }
    if (result === "conflicted") setNotice("The record changed since this was drafted, so nothing was applied — it's flagged as conflicted. Re-run against the current value.");
    await loadPending(); onDone(); setActing(null);
  }
  async function reject(id: string) {
    setActing(id); setError(null);
    const { error } = await supabase.from("proposals").update({ status: "rejected" }).eq("id", id);
    if (error) { setError(error.message); setActing(null); return; }
    await loadPending(); onDone(); setActing(null);
  }
  async function hide(id: string) {
    setActing(id); setError(null);
    const { error } = await supabase.from("proposals").delete().eq("id", id); // hide = remove the record
    if (error) { setError(error.message); setActing(null); return; }
    await loadPending(); onDone(); setActing(null);
  }

  if (!open) return null;
  const names = advisors.map((a) => a.name.split(" ").slice(-1)[0]).join(" + ");
  const shown = mode === "run" ? pending.filter((p) => freshIds.has(p.id)) : pending; // run = only this session's drafts
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
              <div style={{ fontSize: 15, fontWeight: 660 }}>{mode === "run" ? "Joint proposal" : "Proposals waiting"}</div>
              <div className="t-sub t-muted" style={{ fontSize: 12 }}>{names} · {target.name}</div>
            </div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
          {error && <div className="banner banner-error" style={{ marginBottom: 12 }}>{error}</div>}
          {notice && <div className="banner" style={{ background: "var(--am-fill)", color: "var(--am-text)", marginBottom: 12 }}>{notice}</div>}

          {/* live reasoning while a new proposal is drafted */}
          {(busy || (mode === "run" && thinking)) && (
            <div style={{ marginBottom: 16 }}>
              <div className="t-label" style={{ color: "var(--ac)", marginBottom: 6 }}>{busy ? <>{names} are working<PulseDots /></> : "How they got here"}</div>
              <div ref={traceRef} style={{ fontSize: 11.5, lineHeight: 1.5, fontStyle: "italic", whiteSpace: "pre-wrap", color: "var(--tm)", borderLeft: "2px solid var(--border)", paddingLeft: 10, maxHeight: busy ? 300 : 120, overflowY: "auto" }}>
                {thinking || "Thinking it through…"}
              </div>
            </div>
          )}

          {/* run mode shows only what this session drafted; review mode shows the queue */}
          {loaded && shown.length === 0 && !busy && (
            <div className="t-sub t-muted" style={{ fontSize: 13 }}>{mode === "run" ? "No proposal drafted yet — use ✦ New proposal below." : "Nothing waiting on this record. Run a joint proposal to draft one."}</div>
          )}

          <div className="stack-3">
            {shown.map((p) => (
              <div key={p.id} className="card card-pad reveal-up" style={{ borderLeft: "2px solid var(--vl)" }}>
                <div className="row-between" style={{ gap: 12, marginBottom: 8, alignItems: "flex-start" }}>
                  <div style={{ fontSize: 15, fontWeight: 660, lineHeight: 1.35 }}>{p.title}</div>
                  <Confidence label={p.conf_label} level={p.conf_level} />
                </div>
                {p.rationale && <p className="t-sub" style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>{p.rationale}</p>}

                {p.changes.length > 0 && (
                  <div className="stack-2" style={{ marginBottom: 12 }}>
                    {p.changes.map((c, i) => (
                      <div key={i} style={{ borderLeft: "2px solid var(--border)", paddingLeft: 10 }}>
                        <div className="row gap-2" style={{ marginBottom: 2, alignItems: "center" }}>
                          <Chip tone={c.kind === "add" ? "green" : "accent"}>{c.kind === "add" ? "New field" : "Update"}</Chip>
                          <span style={{ fontSize: 12.5, fontWeight: 620 }}>{c.label}</span>
                        </div>
                        <div className="t-sub" style={{ fontSize: 12, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{c.proposed_value}</div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="row gap-2" style={{ alignItems: "center" }}>
                  <button className="btn btn-success btn-sm" disabled={acting === p.id} onClick={() => accept(p.id)}>{acting === p.id ? "…" : "Accept"}</button>
                  <button className="btn btn-secondary btn-sm" disabled={acting === p.id} onClick={() => reject(p.id)} style={{ color: "var(--rd-text)" }}>Reject</button>
                  <button className="btn btn-secondary btn-sm" disabled={acting === p.id} onClick={() => hide(p.id)} title="Delete this proposal entirely">Hide</button>
                  <span className="t-mono-xs" style={{ marginLeft: "auto" }}>{p.proposed_by}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* footer — draft another proposal any time */}
        <div className="row gap-2" style={{ padding: "12px 20px", borderTop: "1px solid var(--border)" }}>
          <button className="btn btn-accent btn-sm" disabled={busy} onClick={run}>{busy ? "Working…" : "✦ New proposal"}</button>
        </div>
      </aside>
    </>
  );
}
