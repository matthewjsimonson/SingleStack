"use client";

// Structured, visually-grouped field editor. Fields are grouped by their
// `section` into panels (Overview, Technical, Personas, …) instead of a flat
// list. Each panel shows a completeness ring; empty records can scaffold the
// type's template in one click. Inline-edit any value; add fields/sections.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Section, Banner } from "@/components/ui";
import { templateFor } from "@/lib/templates";

type Field = { id: string; field_key: string; label: string; value: string | null; section: string | null; position: number };
type Target = { kind: "product" | "gtm"; id: string };

const UNGROUPED = "Details";
const fk = (t: Target) => (t.kind === "product" ? "product_id" : "gtm_record_id");

export default function SectionedFields({ target }: { target: Target }) {
  const supabase = createClient();
  const [fields, setFields] = useState<Field[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [scaffolding, setScaffolding] = useState(false);

  // add field within a section
  const [addingIn, setAddingIn] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("record_fields").select("id, field_key, label, value, section, position")
      .eq(fk(target), target.id).order("position");
    setFields(data ?? []);
    setLoading(false);
  }, [supabase, target]);

  useEffect(() => { load(); }, [load]);

  async function scaffold() {
    setScaffolding(true); setError(null);
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization.");
      const rows: Record<string, unknown>[] = [];
      let pos = 0;
      for (const s of templateFor(target.kind)) {
        for (const f of s.fields) {
          rows.push({ org_id: orgId, [fk(target)]: target.id, field_key: f.key, label: f.label, section: s.section, value: null, position: pos++ });
        }
      }
      const { error } = await supabase.from("record_fields").insert(rows);
      if (error) throw error;
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not scaffold."); }
    finally { setScaffolding(false); }
  }

  async function save(id: string) {
    setError(null);
    const { error } = await supabase.from("record_fields").update({ value: draft }).eq("id", id);
    if (error) setError(error.message);
    setEditing(null);
    await load();
  }

  async function addField(sectionName: string) {
    setError(null);
    const label = newLabel.trim();
    if (!label) return;
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization.");
      const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `field_${Date.now()}`;
      const { error } = await supabase.from("record_fields").insert({
        org_id: orgId, [fk(target)]: target.id, field_key: key, label,
        section: sectionName === UNGROUPED ? null : sectionName, value: null, position: fields.length,
      });
      if (error) throw error;
      setAddingIn(null); setNewLabel("");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not add field."); }
  }

  if (loading) return <div className="t-sub t-muted">Loading…</div>;

  // group by section, preserving first-seen order
  const order: string[] = [];
  const bySection: Record<string, Field[]> = {};
  for (const f of fields) {
    const s = f.section || UNGROUPED;
    if (!bySection[s]) { bySection[s] = []; order.push(s); }
    bySection[s].push(f);
  }

  if (fields.length === 0) {
    return (
      <Section label="Content">
        <Banner>{error}</Banner>
        <div className="empty">
          <div className="t-body" style={{ fontWeight: 600, marginBottom: 6 }}>Set up this record</div>
          <div className="t-sub" style={{ maxWidth: 460, marginInline: "auto", marginBottom: 16 }}>
            Scaffold a structured starting point for a {target.kind === "product" ? "product" : "GTM"} record — sections and prompts you can fill in and tailor.
          </div>
          <button className="btn" onClick={scaffold} disabled={scaffolding}>{scaffolding ? "Setting up…" : "Scaffold structure"}</button>
        </div>
      </Section>
    );
  }

  return (
    <div>
      <Banner>{error}</Banner>
      {order.map((sName) => {
        const items = bySection[sName];
        const filled = items.filter((f) => f.value && f.value.trim()).length;
        const pct = Math.round((filled / items.length) * 100);
        return (
          <section className="section" key={sName}>
            <div className="section-head">
              <div className="row gap-2">
                <span className="t-label">{sName}</span>
                <CompletionRing pct={pct} />
                <span className="t-sub t-muted" style={{ fontSize: 12 }}>{filled}/{items.length}</span>
              </div>
              {addingIn !== sName && <button className="btn btn-secondary btn-sm" onClick={() => { setAddingIn(sName); setNewLabel(""); }}>+ Field</button>}
            </div>

            <div className="card" style={{ overflow: "hidden" }}>
              {items.map((f, i) => (
                <div key={f.id} style={{ padding: "14px 18px", borderTop: i === 0 ? "none" : "1px solid var(--border)", background: f.value ? "transparent" : "var(--panel-2)" }}>
                  <div className="row-between" style={{ marginBottom: 5 }}>
                    <span className="t-label" style={{ color: f.value ? "var(--tm)" : "var(--ac-text)" }}>{f.label}</span>
                    {editing !== f.id && <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(f.id); setDraft(f.value ?? ""); }}>{f.value ? "Edit" : "Fill in"}</button>}
                  </div>
                  {editing === f.id ? (
                    <div>
                      <textarea className="textarea" rows={3} autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} style={{ marginBottom: 8 }} />
                      <div className="row gap-2">
                        <button className="btn btn-sm" onClick={() => save(f.id)}>Save</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => setEditing(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="t-body" style={{ lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                      {f.value || <span className="t-muted" style={{ fontStyle: "italic" }}>Empty</span>}
                    </div>
                  )}
                </div>
              ))}
              {addingIn === sName && (
                <div style={{ padding: "12px 18px", borderTop: "1px solid var(--border)" }}>
                  <div className="row gap-2">
                    <input className="input" autoFocus placeholder="New field label" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} style={{ flex: 1 }} />
                    <button className="btn btn-sm" onClick={() => addField(sName)}>Add</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setAddingIn(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// Small SVG completion ring — a visual, not a static icon.
function CompletionRing({ pct }: { pct: number }) {
  const r = 7, c = 2 * Math.PI * r, off = c - (pct / 100) * c;
  const color = pct === 100 ? "var(--gn)" : pct > 0 ? "var(--ac)" : "var(--border-strong)";
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" style={{ transform: "rotate(-90deg)" }}>
      <circle cx="9" cy="9" r={r} fill="none" stroke="var(--fill-2)" strokeWidth="2.5" />
      <circle cx="9" cy="9" r={r} fill="none" stroke={color} strokeWidth="2.5" strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" />
    </svg>
  );
}
