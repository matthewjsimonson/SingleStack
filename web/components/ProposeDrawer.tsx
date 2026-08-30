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
import AgentActivity from "@/components/AgentActivity";
import { emptyActivity, type Activity } from "@/lib/agentStream";

type Advisor = { key: string; name: string; short: string; accent: string };
type Change = {
  id: string;                          // proposal_changes.id — so HITL edits can persist
  label: string; kind: "add" | "update" | "metric"; proposed_value: string;
  // Identity + drift detection: which field this targets, the value it was drafted
  // against (old_value), and the field's CURRENT value — so the queue can flag a
  // change that's stale (the record moved) or that collides with a sibling.
  // A metric reading (kind "metric") carries none of these — it's an upsert by
  // period with no drift concept — and proposed_value holds a read-only display.
  fieldIdent: string | null; oldValue: string | null; currentValue: string | null;
};

const monthLabel = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString(undefined, { month: "short", year: "numeric" });
type Pending = {
  id: string; title: string; rationale: string | null; conf_label: string | null;
  conf_level: number | null; proposed_by: string; created_at: string; changes: Change[];
};

// Relative "drafted Xh ago" — full timestamp on hover. (Client-only Date use.)
function ago(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

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
  const [activity, setActivity] = useState<Activity>(emptyActivity());
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({}); // change.id -> HITL-edited value
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set()); // proposals drafted in THIS session (run mode shows only these)
  const started = useRef(false);

  const idKey = target.kind === "product" ? "product_id" : "gtm_record_id";

  const loadPending = useCallback(async () => {
    const { data } = await supabase
      .from("proposals")
      .select("id, title, rationale, conf_label, conf_level, proposed_by, created_at, proposal_changes ( id, change_kind, label, proposed_value, record_field_id, field_key, old_value, metric_period, metric_value, metric_origin, metric_source_label, record_fields ( label, value, metric_unit ) )")
      .eq(idKey, target.id).eq("status", "pending").order("created_at", { ascending: false });
    // deno-lint-ignore no-explicit-any
    const list: Pending[] = (data ?? []).map((p: any) => ({
      id: p.id, title: p.title, rationale: p.rationale, conf_label: p.conf_label, conf_level: p.conf_level, proposed_by: p.proposed_by, created_at: p.created_at,
      // deno-lint-ignore no-explicit-any
      changes: (p.proposal_changes ?? []).map((c: any) => {
        if (c.change_kind === "metric_reading") {
          const u = c.record_fields?.metric_unit && c.record_fields.metric_unit !== "NPS" ? c.record_fields.metric_unit : "";
          const src = c.metric_source_label ? ` · ${c.metric_source_label}` : "";
          const manual = c.metric_origin === "manual" ? " (manual)" : "";
          return {
            id: c.id, label: c.record_fields?.label ?? "Metric", kind: "metric" as const,
            proposed_value: `${c.metric_value}${u} · ${monthLabel(c.metric_period)}${src}${manual}`,
            fieldIdent: null, oldValue: null, currentValue: null,
          };
        }
        return {
          id: c.id,
          label: c.label ?? c.record_fields?.label ?? "Field",
          kind: (c.change_kind === "add_field" ? "add" : "update") as "add" | "update",
          proposed_value: c.proposed_value,
          // A field's identity: the existing field id (update) or add:<key> (new field).
          fieldIdent: c.record_field_id ?? (c.field_key ? `add:${c.field_key}` : null),
          oldValue: c.old_value ?? null,
          currentValue: c.record_fields?.value ?? null,
        };
      }),
    }));
    setPending(list); setLoaded(true);
  }, [supabase, idKey, target.id]);

  const run = useCallback(async () => {
    setBusy(true); setThinking(""); setActivity(emptyActivity()); setError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const res = await streamStructured<{ proposal_id?: string }>({
        fnName: "agent-propose",
        token: sess.session?.access_token,
        body: { agent_keys: advisors.map((a) => a.key), agent_key: advisors[0]?.key, [idKey]: target.id },
        onThinking: (s) => setThinking((p) => p + s),
        onActivity: setActivity,
      });
      if (res?.proposal_id) setFreshIds((prev) => new Set(prev).add(res.proposal_id as string));
      await loadPending();
    } catch (e) { setError(e instanceof Error ? e.message : "Proposal failed."); }
    finally { setBusy(false); }
  }, [supabase, advisors, idKey, target.id, loadPending]);

  // On open: load what's waiting, and (run mode) kick off a fresh proposal once.
  useEffect(() => {
    if (!open) { started.current = false; setThinking(""); setActivity(emptyActivity()); setBusy(false); setError(null); setPending([]); setLoaded(false); setFreshIds(new Set()); setEdits({}); setConfirmClear(false); return; }
    loadPending();
    if (mode === "run" && !started.current) { started.current = true; run(); }
  }, [open, mode, loadPending, run]);

  async function accept(id: string) {
    setActing(id); setError(null); setNotice(null);
    // Persist any HITL edits to this proposal's changes FIRST, so accept applies the
    // edited values — a proposal that wasn't 100% right becomes a good update.
    const p = pending.find((x) => x.id === id);
    const dirty = (p?.changes ?? []).filter((c) => edits[c.id] !== undefined && edits[c.id] !== c.proposed_value);
    for (const c of dirty) {
      const { error: uErr } = await supabase.from("proposal_changes").update({ proposed_value: edits[c.id] }).eq("id", c.id);
      if (uErr) { setError(uErr.message); setActing(null); return; }
    }
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
  // Bulk clear — DELETE every pending proposal on this record. Deletion (like Hide)
  // is a clean removal: it is NOT a rejection and does NOT feed the learn loop (that
  // loop learns only from the Signals → Review queue / intel_updates, never from
  // record proposals). So this clears the queue without teaching the agents anything.
  async function clearAll() {
    setActing("__all__"); setError(null);
    const ids = pending.map((p) => p.id);
    if (ids.length) {
      const { error } = await supabase.from("proposals").delete().in("id", ids);
      if (error) { setError(error.message); setActing(null); return; }
    }
    setConfirmClear(false); await loadPending(); onDone(); setActing(null);
  }

  if (!open) return null;
  const names = advisors.map((a) => a.name.split(" ").slice(-1)[0]).join(" + ");
  const shown = mode === "run" ? pending.filter((p) => freshIds.has(p.id)) : pending; // run = only this session's drafts
  // Conflict awareness, computed across ALL pending proposals on this record:
  //  • overlap — two+ pending proposals edit the SAME field; accepting one makes the
  //    other(s) conflict on accept (the DB refuses the loser). Warn before that.
  //  • stale  — an update drafted against a value the field no longer holds (a human
  //    edit or an already-accepted proposal moved it); accepting it will be refused.
  const identCount = new Map<string, number>();
  for (const p of pending) for (const c of p.changes) if (c.fieldIdent) identCount.set(c.fieldIdent, (identCount.get(c.fieldIdent) ?? 0) + 1);
  const isOverlap = (c: Change) => !!c.fieldIdent && (identCount.get(c.fieldIdent) ?? 0) > 1;
  const isStale = (c: Change) => c.kind === "update" && (c.currentValue ?? "").trim() !== (c.oldValue ?? "").trim();
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

          {/* What the officers are actually doing, step by step, as it happens. */}
          {(busy || (mode === "run" && (activity.steps.length > 0 || thinking))) && (
            <div style={{ marginBottom: 16 }}>
              <div className="t-label" style={{ color: "var(--ac)", marginBottom: 8 }}>{busy ? <>{names} are working<PulseDots /></> : "How they got here"}</div>
              <AgentActivity activity={activity} busy={busy} who={names} />
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
                {/* When it was drafted — relative, full date on hover. */}
                <div className="t-mono-xs t-muted" style={{ marginBottom: p.rationale ? 6 : 10 }} title={new Date(p.created_at).toLocaleString()}>Drafted {ago(p.created_at)}</div>
                {p.rationale && <p className="t-sub" style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>{p.rationale}</p>}

                {/* Conflict awareness BEFORE you accept: stale (record moved) or
                    overlapping a sibling on the same field. */}
                {p.changes.some(isStale) && (
                  <div className="banner" style={{ background: "var(--am-fill)", color: "var(--am-text)", marginBottom: 10, fontSize: 12 }}>
                    ⚠ The record changed since this was drafted — accepting will be refused (conflicted). Reject it and re-draft against the current value.
                  </div>
                )}
                {!p.changes.some(isStale) && p.changes.some(isOverlap) && (
                  <div className="banner" style={{ marginBottom: 10, fontSize: 12 }}>
                    ⚠ Another pending proposal also edits a field below — accept only ONE; the other will then conflict and be refused. Compare them before deciding.
                  </div>
                )}

                {p.changes.length > 0 && (
                  <div className="stack-2" style={{ marginBottom: 12 }}>
                    {p.changes.map((c, i) => (
                      <div key={i} style={{ borderLeft: `2px solid ${isStale(c) ? "var(--am-text)" : isOverlap(c) ? "var(--vl)" : "var(--border)"}`, paddingLeft: 10 }}>
                        <div className="row gap-2" style={{ marginBottom: 2, alignItems: "center", flexWrap: "wrap" }}>
                          <Chip tone={c.kind === "add" ? "green" : c.kind === "metric" ? "violet" : "accent"}>{c.kind === "add" ? "New field" : c.kind === "metric" ? "Metric reading" : "Update"}</Chip>
                          <span style={{ fontSize: 12.5, fontWeight: 620 }}>{c.label}</span>
                          {isStale(c) && <Chip tone="amber">field moved since drafted</Chip>}
                          {!isStale(c) && isOverlap(c) && <Chip tone="violet">also in another proposal</Chip>}
                          {edits[c.id] !== undefined && edits[c.id] !== c.proposed_value && <Chip tone="accent">edited</Chip>}
                        </div>
                        {/* A metric reading is a sourced number (value lives in metric_value,
                            not proposed_value) — show it read-only, not as an editable field. */}
                        {c.kind === "metric" ? (
                          <div className="t-mono" style={{ fontSize: 13, fontWeight: 600 }}>{c.proposed_value}</div>
                        ) : (
                          /* Editable before accepting — a not-quite-right proposal can be
                             made into a good update by hand, then accepted. */
                          <textarea className="textarea" disabled={acting === p.id}
                            rows={Math.max(2, Math.min(10, Math.ceil((edits[c.id] ?? c.proposed_value ?? "").length / 80)))}
                            value={edits[c.id] ?? c.proposed_value ?? ""}
                            onChange={(e) => setEdits((m) => ({ ...m, [c.id]: e.target.value }))}
                            style={{ fontSize: 12, lineHeight: 1.5 }} />
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="row gap-2" style={{ alignItems: "center" }}>
                  <button className="btn btn-success btn-sm" disabled={acting === p.id} onClick={() => accept(p.id)}
                    title="Apply this proposal to the record — including any edits you made above">{acting === p.id ? "…" : (p.changes.some((c) => edits[c.id] !== undefined && edits[c.id] !== c.proposed_value) ? "Accept with edits" : "Accept")}</button>
                  <button className="btn btn-secondary btn-sm" disabled={acting === p.id} onClick={() => reject(p.id)} style={{ color: "var(--rd-text)" }}>Reject</button>
                  <button className="btn btn-secondary btn-sm" disabled={acting === p.id} onClick={() => hide(p.id)} title="Delete this proposal entirely">Hide</button>
                  <span className="t-mono-xs" style={{ marginLeft: "auto" }}>{p.proposed_by}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* footer — draft another proposal, or clear the whole queue (review mode) */}
        <div className="row gap-2" style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", alignItems: "center" }}>
          <button className="btn btn-accent btn-sm" disabled={busy} onClick={run}>{busy ? "Working…" : "✦ New proposal"}</button>
          {mode === "review" && pending.length > 0 && (
            confirmClear ? (
              <span className="row gap-2" style={{ marginLeft: "auto", alignItems: "center" }}>
                <span className="t-mono-xs t-muted">Delete {pending.length} pending? Records &amp; learning untouched.</span>
                <button className="btn btn-sm" disabled={acting === "__all__"} onClick={clearAll} style={{ color: "var(--rd-text)" }}>{acting === "__all__" ? "Clearing…" : "Confirm"}</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setConfirmClear(false)}>Cancel</button>
              </span>
            ) : (
              <button className="btn btn-secondary btn-sm" style={{ marginLeft: "auto" }} onClick={() => setConfirmClear(true)}
                title="Delete every pending proposal on this record. A clean removal — not a rejection, and it does not feed the agents' learn loop.">⌫ Clear all pending</button>
            )
          )}
        </div>
      </aside>
    </>
  );
}
