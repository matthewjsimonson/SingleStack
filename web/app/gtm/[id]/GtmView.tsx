"use client";

// GTM record detail — built out with the go-to-market structure in mind:
//   • Back to parent product + breadcrumb context
//   • Workspace (run agents / fields / proposals)
//   • Messaging tabs (gtm_tabs) — the messaging surfaces: hero, personas,
//     positioning, objections, battlecards — each an editable section
//   • Signals — the evidence backing this record
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import RecordWorkspace from "@/components/RecordWorkspace";
import { Section, Chip, Confidence, Empty, Banner, BackLink } from "@/components/ui";

type Gtm = { id: string; name: string; product_id: string };
type Product = { id: string; name: string };
type Tab = { id: string; tab_key: string; label: string; body: { text?: string } | null };
type Signal = { id: string; title: string; why: string | null; conf_label: string | null; conf_level: number | null; observed_at: string | null };

// Common GTM messaging surfaces, offered as quick-add templates.
const TAB_TEMPLATES = ["Hero", "Personas", "Positioning", "Objections", "Battlecard", "Proof points"];

export default function GtmView({ gtmId }: { gtmId: string }) {
  const supabase = createClient();
  const [gtm, setGtm] = useState<Gtm | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [newTabLabel, setNewTabLabel] = useState("");

  const load = useCallback(async () => {
    const { data: g } = await supabase.from("gtm_records").select("id, name, product_id").eq("id", gtmId).maybeSingle();
    if (!g) { setNotFound(true); setLoading(false); return; }
    const [{ data: p }, { data: t }, { data: sig }] = await Promise.all([
      supabase.from("product_records").select("id, name").eq("id", g.product_id).maybeSingle(),
      supabase.from("gtm_tabs").select("id, tab_key, label, body").eq("gtm_record_id", gtmId).order("created_at"),
      supabase.from("signals").select("id, title, why, conf_label, conf_level, observed_at").eq("gtm_record_id", gtmId).order("observed_at", { ascending: false }),
    ]);
    setGtm(g); setProduct(p); setTabs(t ?? []); setSignals(sig ?? []);
    setActiveTab((cur) => cur ?? (t && t.length ? t[0].id : null));
    setLoading(false);
  }, [supabase, gtmId]);

  useEffect(() => { load(); }, [load]);

  async function addTab(label: string) {
    setError(null);
    const trimmed = label.trim();
    if (!trimmed) return;
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization.");
      const key = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `tab_${Date.now()}`;
      const { data, error } = await supabase.from("gtm_tabs").insert({ org_id: orgId, gtm_record_id: gtmId, tab_key: key, label: trimmed, body: { text: "" } }).select("id").single();
      if (error) throw error;
      setAdding(false); setNewTabLabel("");
      await load();
      setActiveTab(data.id);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not add tab."); }
  }

  async function saveTab(tabId: string) {
    setError(null);
    const { error } = await supabase.from("gtm_tabs").update({ body: { text: draft } }).eq("id", tabId);
    if (error) setError(error.message);
    setEditing(false);
    await load();
  }

  if (loading) return <div className="t-sub t-muted">Loading…</div>;
  if (notFound || !gtm) return <Empty title="GTM record not found" />;

  const current = tabs.find((t) => t.id === activeTab) ?? null;
  const existingLabels = new Set(tabs.map((t) => t.label.toLowerCase()));

  return (
    <div>
      <BackLink href={product ? `/records/${product.id}` : "/gtm"} label={product ? product.name : "GTM records"} />
      <div className="row gap-2" style={{ marginBottom: 6 }}>
        <Chip tone="violet">GTM record</Chip>
        {product && <span className="t-sub t-muted">under {product.name}</span>}
      </div>
      <h1 className="t-page" style={{ marginBottom: "var(--sp-6)" }}>{gtm.name}</h1>

      <Banner>{error}</Banner>

      <RecordWorkspace target={{ kind: "gtm", id: gtmId }} />

      {/* Messaging tabs — the GTM structure */}
      <Section
        label="Messaging"
        action={!adding ? <button className="btn btn-secondary btn-sm" onClick={() => setAdding(true)}>+ Add section</button> : undefined}
      >
        {adding && (
          <div className="card card-pad" style={{ marginBottom: "var(--sp-3)" }}>
            <div className="t-sub" style={{ marginBottom: 8 }}>Add a messaging section:</div>
            <div className="row gap-2" style={{ flexWrap: "wrap", marginBottom: 12 }}>
              {TAB_TEMPLATES.filter((t) => !existingLabels.has(t.toLowerCase())).map((t) => (
                <button key={t} className="btn btn-secondary btn-sm" onClick={() => addTab(t)}>{t}</button>
              ))}
            </div>
            <div className="row gap-2">
              <input className="input" placeholder="Or a custom section name" value={newTabLabel} onChange={(e) => setNewTabLabel(e.target.value)} style={{ flex: 1 }} />
              <button className="btn btn-sm" onClick={() => addTab(newTabLabel)}>Add</button>
              <button className="btn btn-secondary btn-sm" onClick={() => { setAdding(false); setNewTabLabel(""); }}>Cancel</button>
            </div>
          </div>
        )}

        {tabs.length === 0 && !adding ? (
          <div className="t-sub t-muted">No messaging sections yet. Add hero copy, personas, positioning, objections, battlecards — the connective tissue between the product and what a seller says.</div>
        ) : tabs.length > 0 ? (
          <div className="card">
            {/* tab strip */}
            <div className="row" style={{ gap: 4, padding: "8px 8px 0", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
              {tabs.map((t) => {
                const on = t.id === activeTab;
                return (
                  <button key={t.id} onClick={() => { setActiveTab(t.id); setEditing(false); }}
                    style={{ background: "none", border: "none", borderBottom: on ? "2px solid var(--vl)" : "2px solid transparent", color: on ? "var(--tp)" : "var(--ts)", fontWeight: 600, fontSize: 13, padding: "8px 12px", cursor: "pointer", marginBottom: -1 }}>
                    {t.label}
                  </button>
                );
              })}
            </div>
            {/* tab body */}
            <div className="card-pad">
              {current && (editing ? (
                <div>
                  <textarea className="textarea" rows={6} autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} style={{ marginBottom: 10 }} placeholder={`Write the ${current.label.toLowerCase()} content…`} />
                  <div className="row gap-2">
                    <button className="btn btn-sm" onClick={() => saveTab(current.id)}>Save</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="row-between" style={{ marginBottom: 8 }}>
                    <span className="t-label">{current.label}</span>
                    <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(true); setDraft(current.body?.text ?? ""); }}>Edit</button>
                  </div>
                  <div className="t-body" style={{ lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                    {current.body?.text || <span className="t-muted">Empty — click Edit to write this section.</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </Section>

      {/* Signals */}
      <Section label="Signals">
        {signals.length === 0 ? (
          <div className="t-sub t-muted">No signals yet. Signals are the internal &amp; external evidence (observations, data points) that back this record and inform agents.</div>
        ) : (
          <div className="stack-3">
            {signals.map((s) => (
              <div key={s.id} className="card card-pad">
                <div className="row-between" style={{ gap: 12, marginBottom: 5, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 14.5, fontWeight: 620 }}>{s.title}</span>
                  <Confidence label={s.conf_label} level={s.conf_level} />
                </div>
                {s.why && <p className="t-sub" style={{ lineHeight: 1.5 }}>{s.why}</p>}
                {s.observed_at && <div className="t-mono-xs" style={{ marginTop: 6 }}>{new Date(s.observed_at).toLocaleDateString()}</div>}
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
