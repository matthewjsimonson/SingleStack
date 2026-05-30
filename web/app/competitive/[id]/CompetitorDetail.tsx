"use client";

// Per-competitor drill-down: their details, their specific sources (external:
// site/LinkedIn/YouTube/support docs; internal: transcripts/CRM/SME docs), their
// battlecard, and signals about them. An agent will monitor these sources and
// suggest updates; the user can also author their own. Source mgmt is inline.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { PageHeader, Section, Chip, Banner, BackLink, Empty, Confidence } from "@/components/ui";
import SourceManager from "@/components/SourceManager";

type Competitor = { id: string; name: string; relationship: string; website: string | null; notes: string | null };
type Card = { id: string; kind: string; title: string; detail: string | null };
type Signal = { id: string; title: string; why: string | null; conf_label: string | null; conf_level: number | null; observed_at: string | null; metadata: { competitor_id?: string } | null };

const KINDS = [["win", "Why we win", "gn"], ["lose", "Why we lose", "am-text"], ["objection", "Objections", "border-strong"], ["trap", "Traps to set", "vl"]] as const;

export default function CompetitorDetail({ competitorId }: { competitorId: string }) {
  const supabase = createClient();
  const [comp, setComp] = useState<Competitor | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", detail: "" });
  const [editNotes, setEditNotes] = useState(false);
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    const { data: c } = await supabase.from("competitors").select("id, name, relationship, website, notes").eq("id", competitorId).maybeSingle();
    if (!c) { setNotFound(true); setLoading(false); return; }
    const [{ data: cds }, { data: sigs }] = await Promise.all([
      supabase.from("battlecard_items").select("id, kind, title, detail").eq("competitor_id", competitorId).order("position").order("created_at"),
      supabase.from("signals").select("id, title, why, conf_label, conf_level, observed_at, metadata").order("observed_at", { ascending: false, nullsFirst: false }),
    ]);
    setComp(c); setNotes(c.notes ?? ""); setCards(cds ?? []);
    setSignals((sigs ?? []).filter((s) => s.metadata?.competitor_id === competitorId));
    setLoading(false);
  }, [supabase, competitorId]);
  useEffect(() => { load(); }, [load]);

  async function addCard(kind: string) {
    if (!form.title.trim()) return;
    const orgId = await getOrgId(); if (!orgId) return;
    const { error } = await supabase.from("battlecard_items").insert({ org_id: orgId, competitor_id: competitorId, kind, title: form.title.trim(), detail: form.detail.trim() || null });
    if (error) setError(error.message); else { setAdding(null); setForm({ title: "", detail: "" }); load(); }
  }
  async function removeCard(id: string) { setError(null); await supabase.from("battlecard_items").delete().eq("id", id); load(); }
  async function saveNotes() { setError(null); await supabase.from("competitors").update({ notes }).eq("id", competitorId); setEditNotes(false); load(); }

  if (loading) return <div className="t-sub t-muted">Loading…</div>;
  if (notFound || !comp) return <Empty title="Competitor not found" />;

  return (
    <div>
      <BackLink href="/competitive" label="Competitive intel" />
      <div className="row gap-2" style={{ marginBottom: 6 }}><Chip tone={comp.relationship === "direct" ? "accent" : "violet"}>{comp.relationship}</Chip></div>
      <h1 className="t-page" style={{ marginBottom: "var(--sp-5)" }}>{comp.name}</h1>
      <Banner>{error}</Banner>

      {/* Notes */}
      <Section label="Overview" action={!editNotes ? <button className="btn btn-secondary btn-sm" onClick={() => setEditNotes(true)}>Edit</button> : undefined}>
        {editNotes ? (
          <div className="card card-pad">
            <textarea className="textarea" rows={3} autoFocus value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What this competitor is, how they position, where they're strong/weak." style={{ marginBottom: 8 }} />
            <div className="row gap-2"><button className="btn btn-sm" onClick={saveNotes}>Save</button><button className="btn btn-secondary btn-sm" onClick={() => { setEditNotes(false); setNotes(comp.notes ?? ""); }}>Cancel</button></div>
          </div>
        ) : (
          <div className="card card-pad t-body" style={{ lineHeight: 1.6 }}>{comp.notes || <span className="t-muted">No overview yet. Click Edit to add one.</span>}</div>
        )}
      </Section>

      {/* This competitor's sources (inline, scoped to them) */}
      <SourceManager scope={{ competitorId }} title={`${comp.name} sources`} />

      {/* Agent monitoring note */}
      <div className="card card-pad" style={{ marginBottom: "var(--sp-5)", background: "var(--vl-fill)", borderColor: "var(--vl)" }}>
        <div className="row gap-2"><Chip tone="violet">Agent</Chip><span className="t-sub" style={{ fontSize: 12.5, color: "var(--vl-text)" }}>Once sources are connected, an agent monitors them and suggests battlecard updates here. You can always author your own.</span></div>
      </div>

      {/* Battlecard for this competitor */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-4)" }}>
        {KINDS.map(([kind, label, tone]) => (
          <Section key={kind} label={label} action={adding !== kind ? <button className="btn btn-secondary btn-sm" onClick={() => { setAdding(kind); setForm({ title: "", detail: "" }); }}>+ Add</button> : undefined}>
            {adding === kind && (
              <div className="card card-pad" style={{ marginBottom: "var(--sp-3)" }}>
                <input className="input" autoFocus placeholder="Point" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} style={{ marginBottom: 8 }} />
                <textarea className="textarea" rows={2} placeholder="Detail (optional)" value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })} style={{ marginBottom: 8 }} />
                <div className="row gap-2"><button className="btn btn-sm" onClick={() => addCard(kind)}>Add</button><button className="btn btn-secondary btn-sm" onClick={() => setAdding(null)}>Cancel</button></div>
              </div>
            )}
            <div className="stack-3">
              {cards.filter((c) => c.kind === kind).map((c) => (
                <div key={c.id} className="card card-pad" style={{ borderLeft: `2px solid var(--${tone})` }}>
                  <div className="row-between"><span style={{ fontSize: 13.5, fontWeight: 620 }}>{c.title}</span><button className="t-muted" onClick={() => removeCard(c.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15 }}>×</button></div>
                  {c.detail && <div className="t-sub" style={{ fontSize: 12.5, marginTop: 3 }}>{c.detail}</div>}
                </div>
              ))}
              {cards.filter((c) => c.kind === kind).length === 0 && adding !== kind && <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>None yet.</div>}
            </div>
          </Section>
        ))}
      </div>

      {/* Signals about this competitor */}
      <Section label="Signals">
        {signals.length === 0 ? <div className="t-sub t-muted">No signals on this competitor yet. Once their sources are monitored, intel lands here.</div> : (
          <div className="stack-3">
            {signals.map((s) => (
              <div key={s.id} className="card card-pad">
                <div className="row-between" style={{ marginBottom: 4 }}><span style={{ fontSize: 14, fontWeight: 620 }}>{s.title}</span><Confidence label={s.conf_label} level={s.conf_level} /></div>
                {s.why && <p className="t-sub" style={{ lineHeight: 1.5 }}>{s.why}</p>}
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
