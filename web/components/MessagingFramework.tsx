"use client";

// MessagingFramework — the GTM record's messaging & narrative framework, now FIRST
// CLASS: each section is a record_field in the "Messaging" section, so it gets the
// full record experience — Sweep (proposes into the review queue), hand-edit (the
// human-ratify channel), and the SAME officer advisors + Propose + review queue the
// rest of the record uses (RecordAdvisors). Guided as a PMA messaging house +
// strategic narrative (lib/messagingFramework.ts). Upstream of content & campaigns.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Section, Banner, Modal } from "@/components/ui";
import { Markdown } from "@/components/Markdown";
import RecordAdvisors from "@/components/RecordAdvisors";
import { MESSAGING_FRAMEWORK, type FrameworkSection } from "@/lib/messagingFramework";

type Field = { id: string; field_key: string; label: string; value: string | null };
type Agent = { id: string; key: string; name: string; role: string | null };

export default function MessagingFramework({ gtmId, recordName }: { gtmId: string; recordName?: string }) {
  const supabase = createClient();
  const [fields, setFields] = useState<Field[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [proposals, setProposals] = useState<{ proposed_by: string; status: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewNonce, setReviewNonce] = useState(0); // bump to open the review drawer

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [openGuidance, setOpenGuidance] = useState<Set<string>>(new Set());

  // Sweep with AI — one optional source + Focus, proposes the WHOLE framework into the review queue.
  const [swp, setSwp] = useState(false);
  const [src, setSrc] = useState({ mode: "paste" as "paste" | "url", content: "", url: "", guidance: "" });
  const [building, setBuilding] = useState(false);
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sel = () => supabase.from("record_fields").select("id, field_key, label, value").eq("gtm_record_id", gtmId).eq("section", "Messaging").order("position");
    const [{ data: ff }, { data: ags }, { data: props }] = await Promise.all([
      sel(),
      supabase.from("agents").select("id, key, name, role").eq("is_active", true).order("name"),
      supabase.from("proposals").select("proposed_by, status").eq("gtm_record_id", gtmId),
    ]);
    // Ensure every framework section exists as a field (create empty rows for any missing).
    const have = new Set((ff ?? []).map((f) => f.field_key));
    const missing = MESSAGING_FRAMEWORK.filter((s) => !have.has(s.key));
    if (missing.length) {
      await supabase.rpc("human_add_fields", { p_rows: missing.map((s, i) => ({ gtm_record_id: gtmId, field_key: s.key, label: s.label, value: "", section: "Messaging", position: (ff?.length ?? 0) + i, field_kind: "narrative" })) });
      const { data: ff2 } = await sel();
      setFields(ff2 ?? []);
    } else {
      setFields(ff ?? []);
    }
    setAgents(ags ?? []);
    setProposals(props ?? []);
    setLoading(false);
  }, [supabase, gtmId]);
  useEffect(() => { load(); }, [load]);

  // Estimated progress while the sweep runs (client-side; the call returns once).
  useEffect(() => {
    if (!building) { setProgress(0); setElapsed(0); return; }
    const started = Date.now();
    const id = setInterval(() => {
      const s = (Date.now() - started) / 1000;
      setElapsed(s);
      setProgress(Math.min(96, 96 * (1 - Math.exp(-s / 14))));
    }, 200);
    return () => clearInterval(id);
  }, [building]);

  const fieldFor = (k: string) => fields.find((f) => f.field_key === k);
  const complete = MESSAGING_FRAMEWORK.filter((s) => (fieldFor(s.key)?.value ?? "").trim()).length;
  const pending = proposals.filter((p) => p.status === "pending");
  const pendingByName = pending.reduce<Record<string, number>>((a, p) => { a[p.proposed_by] = (a[p.proposed_by] ?? 0) + 1; return a; }, {});
  const refresh = useCallback(() => { load(); }, [load]);

  async function saveEdit(s: FrameworkSection) {
    const f = fieldFor(s.key);
    if (!f) return;
    setError(null);
    try {
      const { error } = await supabase.rpc("human_set_field_value", { p_field: f.id, p_value: draft });
      if (error) throw error;
      setEditingKey(null); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save."); }
  }

  async function build() {
    setBuilding(true); setError(null); setNotice(null);
    try {
      const b: Record<string, unknown> = { gtm_record_id: gtmId };
      if (src.mode === "url" && src.url.trim()) b.url = src.url.trim();
      else if (src.content.trim()) b.content = src.content.trim();
      if (src.guidance.trim()) b.guidance = src.guidance.trim();
      const { data, error } = await supabase.functions.invoke("messaging-framework", { body: b });
      if (error) {
        const resp = (error as { context?: Response }).context;
        if (resp && (resp.status === 546 || resp.status === 504)) throw new Error("The sweep ran past the server time limit — it usually completes on a retry.");
        throw error;
      }
      if (data?.error) throw new Error(data.error);
      // Complete: ALWAYS close the modal and confirm — it must never sit silently.
      setSwp(false); setSrc({ mode: src.mode, content: "", url: "", guidance: "" });
      await load();
      if (!data?.changes_saved) {
        setNotice("✓ Sweep complete — your framework is already current; nothing to propose.");
      } else {
        setNotice(`✓ Sweep complete — proposed ${data.changes_saved} change${data.changes_saved === 1 ? "" : "s"} into your review queue below.`);
        setReviewNonce((n) => n + 1); // open the proposal in the review drawer
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Sweep failed."); }
    finally { setBuilding(false); }
  }

  if (loading) return <div className="t-sub t-muted">Loading…</div>;

  return (
    <Section label="Messaging framework">
      <Banner>{error}</Banner>

      {/* Header: completeness + Sweep */}
      <div className="card card-pad row-between" style={{ marginBottom: "var(--sp-4)", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 640, fontSize: 13.5 }}>Your messaging &amp; narrative framework <span className="t-mono-xs t-muted" style={{ fontWeight: 400 }}>— {complete}/{MESSAGING_FRAMEWORK.length} complete</span></div>
          <div className="t-sub t-muted" style={{ fontSize: 12.5, marginTop: 2 }}>The PMA-style messaging house + strategic narrative — the upstream source of truth your content &amp; campaigns derive from. Edit a section by hand, sweep the whole thing with AI, or have your officers propose changes — every change lands in your review queue.</div>
        </div>
        <button className="btn btn-sm" onClick={() => { setNotice(null); setSwp(true); }} disabled={building} style={{ background: "var(--ac)", color: "#fff", flexShrink: 0 }}>✦ Sweep with AI</button>
      </div>

      {notice && <div className="banner" style={{ marginBottom: "var(--sp-3)" }}>{notice}</div>}

      {/* The same officer advisors + Propose + review queue as the record */}
      <RecordAdvisors target={{ kind: "gtm", id: gtmId }} recordName={recordName} agents={agents} pendingByName={pendingByName} onRan={refresh} openReviewNonce={reviewNonce} />

      {/* Framework sections */}
      <div className="stack-3">
        {MESSAGING_FRAMEWORK.map((s) => {
          const val = fieldFor(s.key)?.value ?? "";
          const guideOpen = openGuidance.has(s.key);
          return (
            <div key={s.key} className="card card-pad">
              <div className="row-between" style={{ alignItems: "baseline", marginBottom: 6 }}>
                <span className="t-label">{s.label}{!val.trim() && <span className="t-muted" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}> · empty</span>}</span>
                <span className="row gap-2">
                  <button className="btn btn-secondary btn-sm" onClick={() => setOpenGuidance((p) => { const n = new Set(p); n.has(s.key) ? n.delete(s.key) : n.add(s.key); return n; })}>{guideOpen ? "Hide guide" : "Guide"}</button>
                  {editingKey !== s.key && <button className="btn btn-secondary btn-sm" onClick={() => { setEditingKey(s.key); setDraft(val); }}>Edit</button>}
                </span>
              </div>

              {guideOpen && (
                <div className="card card-pad" style={{ background: "var(--panel-2)", marginBottom: 10 }}>
                  <div className="t-sub" style={{ fontSize: 12.5, lineHeight: 1.5 }}>{s.guidance}</div>
                  <div className="t-mono-xs t-muted" style={{ marginTop: 8, lineHeight: 1.5 }}>Shape: {s.example}</div>
                </div>
              )}

              {editingKey === s.key ? (
                <div>
                  <textarea className="textarea" rows={6} autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={s.example} style={{ marginBottom: 8 }} />
                  <div className="row gap-2">
                    <button className="btn btn-sm" onClick={() => saveEdit(s)}>Save</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setEditingKey(null)}>Cancel</button>
                  </div>
                </div>
              ) : val.trim() ? (
                <Markdown className="t-body" style={{ lineHeight: 1.6 }} text={val} />
              ) : (
                <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Empty — open the guide, write it by hand, or sweep the framework with AI.</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Sweep with AI — one optional source + Focus, proposes the whole framework */}
      <Modal open={swp} onClose={() => setSwp(false)} title="Sweep the messaging framework with AI" width={620}>
        <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>Re-evaluates <strong>every</strong> section and proposes a full, on-message framework — positioning, narrative, value prop, pillars, persona messaging, tone, proof, elevator pitch — grounded in your product &amp; GTM records and competitive evidence. Add an optional source (e.g. a messaging brief) for extra grounding. It lands in your <strong>review queue</strong>; nothing is applied until you accept it.</div>
        <div className="t-label" style={{ marginBottom: 6 }}>Optional source <span className="t-muted" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— extra grounding; not required</span></div>
        <div className="row gap-2" style={{ marginBottom: 10 }}>
          <button type="button" className={`btn btn-sm ${src.mode === "paste" ? "" : "btn-secondary"}`} onClick={() => setSrc({ ...src, mode: "paste" })}>Paste text</button>
          <button type="button" className={`btn btn-sm ${src.mode === "url" ? "" : "btn-secondary"}`} onClick={() => setSrc({ ...src, mode: "url" })}>From a URL</button>
        </div>
        {src.mode === "paste"
          ? <label className="field"><span className="t-label">Source content <span className="t-muted" style={{ fontWeight: 400 }}>— optional</span></span><textarea className="textarea" rows={6} value={src.content} onChange={(e) => setSrc({ ...src, content: e.target.value })} placeholder="Optional — paste a messaging brief, positioning doc, narrative… or leave blank to build from your records." /></label>
          : <label className="field"><span className="t-label">Public URL <span className="t-muted" style={{ fontWeight: 400 }}>— optional</span></span><input className="input" value={src.url} onChange={(e) => setSrc({ ...src, url: e.target.value })} placeholder="https://yourcompany.com/about" /></label>}
        <label className="field"><span className="t-label">Focus <span className="t-muted" style={{ fontWeight: 400 }}>— optional</span></span><input className="input" value={src.guidance} onChange={(e) => setSrc({ ...src, guidance: e.target.value })} placeholder="e.g. lead the narrative on governed AI; sharpen the pillars" /></label>

        {building && (
          <div className="card card-pad" style={{ margin: "12px 0", borderLeft: "3px solid var(--ac)" }}>
            <div className="row-between" style={{ alignItems: "baseline", marginBottom: 8 }}>
              <span className="t-label" style={{ color: "var(--tm)" }}>Sweeping the messaging framework…</span>
              <span className="t-mono-xs t-muted">{elapsed < 40 ? `~${Math.max(1, Math.ceil(40 - elapsed))}s left` : "Wrapping up…"}</span>
            </div>
            <div style={{ height: 6, borderRadius: 99, background: "var(--fill)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${progress}%`, background: "var(--ac)", borderRadius: 99, transition: "width 0.2s linear" }} />
            </div>
          </div>
        )}

        {error && <div className="banner banner-error" style={{ marginTop: 12 }}>{error}</div>}

        <div className="row gap-2" style={{ marginTop: 12 }}>
          <button className="btn" disabled={building} onClick={build}>{building ? "Sweeping…" : "✦ Sweep the framework → review queue"}</button>
          <button className="btn btn-secondary" disabled={building} onClick={() => setSwp(false)}>Close</button>
        </div>
      </Modal>
    </Section>
  );
}
