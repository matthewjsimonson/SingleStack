"use client";

// Structured field editor. Key behavior: the LIST shows only FILLED fields,
// grouped into section panels. Recommended-but-unfilled fields never clutter
// the list — they live in a persistent banner ("+N recommended") that opens an
// inline fill panel. You fill what you want; only filled fields join the list.
// Filling a field that already has an (empty) row updates it; otherwise inserts.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Section, Banner } from "@/components/ui";
import { templateFor } from "@/lib/templates";

type Field = { id: string; field_key: string; label: string; value: string | null; section: string | null; position: number };
type Target = { kind: "product" | "gtm"; id: string };

const UNGROUPED = "Details";
const fk = (t: Target) => (t.kind === "product" ? "product_id" : "gtm_record_id");

function guides(kind: "product" | "gtm") {
  const sectionBlurb: Record<string, string> = {};
  const fieldHint: Record<string, string> = {};
  for (const s of templateFor(kind)) {
    sectionBlurb[s.section] = s.blurb;
    for (const f of s.fields) if (f.placeholder) fieldHint[f.label.toLowerCase()] = f.placeholder;
  }
  return { sectionBlurb, fieldHint };
}

export default function SectionedFields({ target }: { target: Target }) {
  const supabase = createClient();
  const [fields, setFields] = useState<Field[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  // recommended fill panel: open + per-field drafts keyed by template key
  const [panelOpen, setPanelOpen] = useState(false);
  const [recDrafts, setRecDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // ad-hoc field add within a section
  const [addingIn, setAddingIn] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [newVal, setNewVal] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("record_fields").select("id, field_key, label, value, section, position")
      .eq(fk(target), target.id).order("position");
    setFields(data ?? []);
    setLoading(false);
  }, [supabase, target]);

  useEffect(() => { load(); }, [load]);

  async function save(id: string) {
    setError(null);
    const { error } = await supabase.from("record_fields").update({ value: draft }).eq("id", id);
    if (error) setError(error.message);
    setEditing(null);
    await load();
  }

  // Save the recommended fields the user filled in the panel. For each filled
  // draft: update the existing row if one exists for that key, else insert.
  async function saveRecommended(missing: { section: string; fields: { key: string; label: string }[] }[]) {
    setSaving(true); setError(null);
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization.");
      const byKey = new Map(fields.map((f) => [f.field_key, f]));
      const inserts: Record<string, unknown>[] = [];
      const updates: { id: string; value: string }[] = [];
      let pos = fields.length;
      for (const s of missing) {
        for (const f of s.fields) {
          const v = (recDrafts[f.key] ?? "").trim();
          if (!v) continue; // only persist what was actually filled
          const existing = byKey.get(f.key);
          if (existing) updates.push({ id: existing.id, value: v });
          else inserts.push({ org_id: orgId, [fk(target)]: target.id, field_key: f.key, label: f.label, section: s.section, value: v, position: pos++ });
        }
      }
      if (inserts.length) { const { error } = await supabase.from("record_fields").insert(inserts); if (error) throw error; }
      for (const u of updates) { const { error } = await supabase.from("record_fields").update({ value: u.value }).eq("id", u.id); if (error) throw error; }
      setPanelOpen(false); setRecDrafts({});
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save."); }
    finally { setSaving(false); }
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
        section: sectionName === UNGROUPED ? null : sectionName, value: newVal.trim() || null, position: fields.length,
      });
      if (error) throw error;
      setAddingIn(null); setNewLabel(""); setNewVal("");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not add field."); }
  }

  if (loading) return <div className="t-sub t-muted">Loading…</div>;

  const { sectionBlurb, fieldHint } = guides(target.kind);

  // Only FILLED fields appear in the list.
  const filledFields = fields.filter((f) => f.value && f.value.trim());
  const filledKeys = new Set(filledFields.map((f) => f.field_key));

  // group filled fields by section, preserving template order then first-seen
  const order: string[] = [];
  const bySection: Record<string, Field[]> = {};
  for (const f of filledFields) {
    const s = f.section || UNGROUPED;
    if (!bySection[s]) { bySection[s] = []; order.push(s); }
    bySection[s].push(f);
  }

  // Recommended = template fields not yet filled (regardless of empty rows).
  const missing = templateFor(target.kind)
    .map((s) => ({ section: s.section, blurb: sectionBlurb[s.section], fields: s.fields.filter((f) => !filledKeys.has(f.key)) }))
    .filter((s) => s.fields.length > 0);
  const missingCount = missing.reduce((n, s) => n + s.fields.length, 0);
  const totalTemplate = templateFor(target.kind).reduce((n, s) => n + s.fields.length, 0);
  const filledTemplate = totalTemplate - missingCount;
  const pct = totalTemplate ? Math.round((filledTemplate / totalTemplate) * 100) : 0;

  return (
    <div>
      <Banner>{error}</Banner>

      {/* Persistent recommended-structure banner. Empty fields never enter the
          list — they're represented here until filled via the panel. */}
      {missingCount > 0 && (
        <div className="card card-pad" style={{ marginBottom: "var(--sp-5)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <CompletionRing pct={pct} big />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14.5, fontWeight: 640 }}>{missingCount} recommended field{missingCount === 1 ? "" : "s"} to capture</div>
              <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>
                {filledTemplate} of {totalTemplate} captured across {missing.map((m) => m.section).join(", ")}. A complete record makes your agents sharper.
              </div>
            </div>
            <button className="btn btn-accent btn-sm" onClick={() => setPanelOpen((v) => !v)} style={{ flexShrink: 0 }}>
              {panelOpen ? "Hide" : `+ ${missingCount} recommended`}
            </button>
          </div>

          {/* fill panel — type values; only filled ones persist into the list */}
          {panelOpen && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
              {missing.map((s) => (
                <div key={s.section} style={{ marginBottom: 16 }}>
                  <div className="t-label" style={{ marginBottom: 8 }}>{s.section}</div>
                  <div className="stack-3">
                    {s.fields.map((f) => {
                      const hint = fieldHint[f.label.toLowerCase()];
                      return (
                        <div key={f.key}>
                          <div className="t-h2" style={{ fontSize: 13, fontWeight: 620, marginBottom: 4 }}>{f.label}</div>
                          <textarea className="textarea" rows={2} placeholder={hint} value={recDrafts[f.key] ?? ""}
                            onChange={(e) => setRecDrafts({ ...recDrafts, [f.key]: e.target.value })} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              <div className="row gap-2">
                <button className="btn" disabled={saving} onClick={() => saveRecommended(missing)}>{saving ? "Saving…" : "Save filled fields"}</button>
                <button className="btn btn-secondary" onClick={() => { setPanelOpen(false); setRecDrafts({}); }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* The list — filled fields only, grouped by section */}
      {filledFields.length === 0 && !panelOpen ? (
        <div className="empty">
          <div className="t-body" style={{ fontWeight: 600, marginBottom: 6 }}>Nothing captured yet</div>
          <div className="t-sub" style={{ maxWidth: 460, marginInline: "auto" }}>Use “+ recommended” above to fill in the structured fields for this {target.kind === "product" ? "product" : "GTM record"}.</div>
        </div>
      ) : (
        order.map((sName) => {
          const items = bySection[sName];
          return (
            <section className="section" key={sName}>
              <div className="section-head" style={{ alignItems: "flex-start" }}>
                <div>
                  <div className="row gap-2"><span className="t-h2" style={{ fontSize: 14.5 }}>{sName}</span><span className="chip">{items.length}</span></div>
                  {sectionBlurb[sName] && <div className="t-sub t-muted" style={{ fontSize: 12.5, marginTop: 2 }}>{sectionBlurb[sName]}</div>}
                </div>
                {addingIn !== sName && <button className="btn btn-secondary btn-sm" onClick={() => { setAddingIn(sName); setNewLabel(""); setNewVal(""); }}>+ Field</button>}
              </div>
              <div className="card" style={{ overflow: "hidden" }}>
                {items.map((f, i) => (
                  <div key={f.id} style={{ padding: "14px 18px", borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                    <div className="row-between" style={{ marginBottom: 5 }}>
                      <div className="row gap-2"><Check done /><span className="t-h2" style={{ fontSize: 13, fontWeight: 620 }}>{f.label}</span></div>
                      {editing !== f.id && <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(f.id); setDraft(f.value ?? ""); }}>Edit</button>}
                    </div>
                    {editing === f.id ? (
                      <div style={{ marginLeft: 26 }}>
                        <textarea className="textarea" rows={3} autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} style={{ marginBottom: 8 }} />
                        <div className="row gap-2"><button className="btn btn-sm" onClick={() => save(f.id)}>Save</button><button className="btn btn-secondary btn-sm" onClick={() => setEditing(null)}>Cancel</button></div>
                      </div>
                    ) : (
                      <div className="t-body" style={{ lineHeight: 1.6, whiteSpace: "pre-wrap", marginLeft: 26 }}>{f.value}</div>
                    )}
                  </div>
                ))}
                {addingIn === sName && (
                  <div style={{ padding: "12px 18px", borderTop: "1px solid var(--border)" }}>
                    <div className="row gap-2" style={{ marginBottom: 8 }}>
                      <input className="input" autoFocus placeholder="Field label" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} style={{ flex: 1 }} />
                    </div>
                    <textarea className="textarea" rows={2} placeholder="Value" value={newVal} onChange={(e) => setNewVal(e.target.value)} style={{ marginBottom: 8 }} />
                    <div className="row gap-2"><button className="btn btn-sm" onClick={() => addField(sName)}>Add</button><button className="btn btn-secondary btn-sm" onClick={() => setAddingIn(null)}>Cancel</button></div>
                  </div>
                )}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

function Check({ done }: { done: boolean }) {
  return (
    <span style={{ width: 18, height: 18, borderRadius: 999, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", background: done ? "var(--gn)" : "transparent", border: done ? "none" : "1.5px solid var(--border-strong)", color: "#fff", fontSize: 11, fontWeight: 800 }}>{done ? "✓" : ""}</span>
  );
}

function CompletionRing({ pct, big }: { pct: number; big?: boolean }) {
  const size = big ? 52 : 18;
  const sw = big ? 4 : 2.5;
  const cx = size / 2, r = cx - sw;
  const c = 2 * Math.PI * r, off = c - (pct / 100) * c;
  const color = pct === 100 ? "var(--gn)" : pct > 0 ? "var(--ac)" : "var(--border-strong)";
  return (
    <span style={{ position: "relative", width: size, height: size, flexShrink: 0, display: "inline-block" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--fill-2)" strokeWidth={sw} />
        <circle cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth={sw} strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" />
      </svg>
      {big && <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "var(--tp)" }}>{pct}%</span>}
    </span>
  );
}
