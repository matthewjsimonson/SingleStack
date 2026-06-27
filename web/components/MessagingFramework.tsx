"use client";

// MessagingFramework — the GTM record's messaging & narrative framework: a guided
// PMA "messaging house" + strategic narrative (web/lib/messagingFramework.ts).
// Each section is a gtm_tabs row. You can edit a section by hand, or "Build with AI"
// to draft/complete the WHOLE framework grounded in your product + GTM records and
// competitive — drafts are reviewed and edited before they land. This is the
// upstream source of truth that content & campaigns derive from.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Section, Banner, Modal } from "@/components/ui";
import { Markdown } from "@/components/Markdown";
import { MESSAGING_FRAMEWORK, FRAMEWORK_KEYS, type FrameworkSection } from "@/lib/messagingFramework";

type Tab = { id: string; tab_key: string; label: string; body: { text?: string } | null };
type Draft = { key: string; label: string; proposed_value: string; changed: boolean };

export default function MessagingFramework({ gtmId }: { gtmId: string }) {
  const supabase = createClient();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [openGuidance, setOpenGuidance] = useState<Set<string>>(new Set());

  // Sweep with AI — one optional source + Focus, sweeps the WHOLE framework (mirrors the record Sweep).
  const [swp, setSwp] = useState(false);
  const [src, setSrc] = useState({ mode: "paste" as "paste" | "url", content: "", url: "", guidance: "" });
  const [building, setBuilding] = useState(false);
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  // review
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [summary, setSummary] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [include, setInclude] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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

  const load = useCallback(async () => {
    const { data } = await supabase.from("gtm_tabs").select("id, tab_key, label, body").eq("gtm_record_id", gtmId).order("created_at");
    setTabs(data ?? []);
    setLoading(false);
  }, [supabase, gtmId]);
  useEffect(() => { load(); }, [load]);

  const valueFor = (k: string) => tabs.find((t) => t.tab_key === k)?.body?.text ?? "";
  const custom = tabs.filter((t) => !FRAMEWORK_KEYS.has(t.tab_key));
  const complete = MESSAGING_FRAMEWORK.filter((s) => valueFor(s.key).trim()).length;

  async function upsertSection(key: string, label: string, text: string) {
    const existing = tabs.find((t) => t.tab_key === key);
    if (existing) {
      const { error } = await supabase.from("gtm_tabs").update({ body: { text } }).eq("id", existing.id);
      if (error) throw error;
    } else {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization.");
      const { error } = await supabase.from("gtm_tabs").insert({ org_id: orgId, gtm_record_id: gtmId, tab_key: key, label, body: { text } });
      if (error) throw error;
    }
  }

  async function saveEdit(s: FrameworkSection) {
    setError(null);
    try { await upsertSection(s.key, s.label, draft); setEditingKey(null); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save."); }
  }

  async function build() {
    setBuilding(true); setError(null); setNotice(null);
    try {
      const b: Record<string, unknown> = { gtm_record_id: gtmId };
      if (src.mode === "url" && src.url.trim()) b.url = src.url.trim();
      else if (src.content.trim()) b.content = src.content.trim();
      if (src.guidance.trim()) b.guidance = src.guidance.trim();
      const { data, error } = await supabase.functions.invoke("messaging-framework", { body: b });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const all = (data?.sections ?? []) as Draft[];
      const changed = all.filter((d) => d.changed && d.proposed_value?.trim());
      if (changed.length === 0) { setNotice("Your framework already looks full and on-message — nothing to change right now."); return; }
      setSwp(false);
      setSrc({ mode: src.mode, content: "", url: "", guidance: "" });
      setDrafts(changed);
      setSummary(data?.summary ?? "");
      setEdits(Object.fromEntries(changed.map((d) => [d.key, d.proposed_value])));
      setInclude(new Set(changed.map((d) => d.key)));
    } catch (e) { setError(e instanceof Error ? e.message : "Sweep failed."); }
    finally { setBuilding(false); }
  }

  async function applyDrafts() {
    if (!drafts) return;
    setApplying(true); setError(null);
    try {
      for (const d of drafts) {
        if (!include.has(d.key)) continue;
        await upsertSection(d.key, d.label, edits[d.key] ?? d.proposed_value);
      }
      setDrafts(null); await load();
      setNotice("Messaging framework updated.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not apply."); }
    finally { setApplying(false); }
  }

  if (loading) return <div className="t-sub t-muted">Loading…</div>;

  return (
    <Section label="Messaging framework">
      <Banner>{error}</Banner>

      {/* Header: completeness + AI build */}
      <div className="card card-pad row-between" style={{ marginBottom: "var(--sp-4)", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 640, fontSize: 13.5 }}>Your messaging & narrative framework <span className="t-mono-xs t-muted" style={{ fontWeight: 400 }}>— {complete}/{MESSAGING_FRAMEWORK.length} complete</span></div>
          <div className="t-sub t-muted" style={{ fontSize: 12.5, marginTop: 2 }}>The PMA-style messaging house + strategic narrative — the upstream source of truth your content &amp; campaigns derive from. Edit a section by hand, or sweep the whole thing with AI from your records.</div>
        </div>
        <button className="btn btn-sm" onClick={() => { setNotice(null); setSwp(true); }} disabled={building} style={{ background: "var(--ac)", color: "#fff", flexShrink: 0 }}>✦ Sweep with AI</button>
      </div>

      {notice && <div className="banner" style={{ marginBottom: "var(--sp-3)" }}>{notice}</div>}

      {/* Framework sections */}
      <div className="stack-3">
        {MESSAGING_FRAMEWORK.map((s) => {
          const val = valueFor(s.key);
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
                <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Empty — open the guide, write it by hand, or build the framework with AI.</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Custom (non-framework) sections, preserved */}
      {custom.length > 0 && (
        <div style={{ marginTop: "var(--sp-5)" }}>
          <div className="t-label" style={{ marginBottom: 8 }}>Other sections</div>
          <div className="stack-3">
            {custom.map((t) => (
              <div key={t.id} className="card card-pad">
                <div className="row-between" style={{ alignItems: "baseline", marginBottom: 6 }}>
                  <span className="t-label">{t.label}</span>
                  {editingKey !== t.tab_key && <button className="btn btn-secondary btn-sm" onClick={() => { setEditingKey(t.tab_key); setDraft(t.body?.text ?? ""); }}>Edit</button>}
                </div>
                {editingKey === t.tab_key ? (
                  <div>
                    <textarea className="textarea" rows={5} autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} style={{ marginBottom: 8 }} />
                    <div className="row gap-2">
                      <button className="btn btn-sm" onClick={async () => { setError(null); try { await upsertSection(t.tab_key, t.label, draft); setEditingKey(null); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Could not save."); } }}>Save</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => setEditingKey(null)}>Cancel</button>
                    </div>
                  </div>
                ) : t.body?.text?.trim()
                  ? <Markdown className="t-body" style={{ lineHeight: 1.6 }} text={t.body.text} />
                  : <div className="t-sub t-muted">Empty.</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sweep with AI — one optional source + Focus, sweeps the whole framework */}
      <Modal open={swp} onClose={() => setSwp(false)} title="Sweep the messaging framework with AI" width={620}>
        <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>Re-evaluates <strong>every</strong> section and proposes a full, on-message framework — positioning, narrative, value prop, pillars, persona messaging, tone, proof, elevator pitch — grounded in your product &amp; GTM records and competitive evidence. Add an optional source (e.g. a messaging brief) for extra grounding. Drafts land in a <strong>review</strong> step; nothing is saved until you apply.</div>
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

        <div className="row gap-2" style={{ marginTop: 12 }}>
          <button className="btn" disabled={building} onClick={build}>{building ? "Sweeping…" : "✦ Sweep the framework → review"}</button>
          <button className="btn btn-secondary" disabled={building} onClick={() => setSwp(false)}>Close</button>
        </div>
      </Modal>

      {/* AI review — edit before it lands */}
      <Modal open={drafts !== null} onClose={() => setDrafts(null)} title="Review the AI-swept framework" width={760}>
        <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>{summary || "Drafted from your product & GTM records and competitive evidence."} Edit anything before it lands; uncheck a section to skip it. Nothing is saved until you apply.</div>
        <div className="stack-3" style={{ maxHeight: "56vh", overflowY: "auto", marginBottom: 12 }}>
          {(drafts ?? []).map((d) => (
            <div key={d.key} className="card card-pad" style={{ borderLeft: include.has(d.key) ? "3px solid var(--ac)" : "3px solid var(--border)" }}>
              <label className="row gap-2" style={{ alignItems: "center", marginBottom: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={include.has(d.key)} onChange={() => setInclude((p) => { const n = new Set(p); n.has(d.key) ? n.delete(d.key) : n.add(d.key); return n; })} />
                <span className="t-label">{d.label}</span>
              </label>
              <textarea className="textarea" rows={6} value={edits[d.key] ?? d.proposed_value} onChange={(e) => setEdits((p) => ({ ...p, [d.key]: e.target.value }))} disabled={!include.has(d.key)} />
            </div>
          ))}
        </div>
        <div className="row gap-2">
          <button className="btn" onClick={applyDrafts} disabled={applying || include.size === 0}>{applying ? "Applying…" : `Apply ${include.size} section${include.size === 1 ? "" : "s"}`}</button>
          <button className="btn btn-secondary" onClick={() => setDrafts(null)}>Cancel</button>
        </div>
      </Modal>
    </Section>
  );
}
