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

// Build lookups from the type's template so the editor can show the section's
// guidance blurb and each field's prompt as prescriptive helper text.
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

  // Add only the recommended sections/fields this record is MISSING, so an
  // existing (pre-template) record can adopt the fuller structure without
  // duplicating what it already has.
  async function addMissing(missing: { section: string; fields: { key: string; label: string }[] }[]) {
    setScaffolding(true); setError(null);
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization.");
      const existingKeys = new Set(fields.map((f) => f.field_key));
      let pos = fields.length;
      const rows: Record<string, unknown>[] = [];
      for (const s of missing) {
        for (const f of s.fields) {
          if (existingKeys.has(f.key)) continue;
          rows.push({ org_id: orgId, [fk(target)]: target.id, field_key: f.key, label: f.label, section: s.section, value: null, position: pos++ });
        }
      }
      if (rows.length) {
        const { error } = await supabase.from("record_fields").insert(rows);
        if (error) throw error;
      }
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not add sections."); }
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

  // What recommended structure is this record MISSING? (so existing records can
  // adopt the fuller template without duplicating what they have)
  const existingKeys = new Set(fields.map((f) => f.field_key));
  const missing = templateFor(target.kind)
    .map((s) => ({ section: s.section, fields: s.fields.filter((f) => !existingKeys.has(f.key)) }))
    .filter((s) => s.fields.length > 0);
  const missingFieldCount = missing.reduce((n, s) => n + s.fields.length, 0);

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

  const { sectionBlurb, fieldHint } = guides(target.kind);
  const totalFilled = fields.filter((f) => f.value && f.value.trim()).length;
  const toGo = fields.length - totalFilled;
  const overallPct = fields.length ? Math.round((totalFilled / fields.length) * 100) : 0;

  return (
    <div>
      <Banner>{error}</Banner>

      {/* Persistent progress guide — stays until the record is 100% complete.
          Shows fields left to fill, and (if recommended structure is missing)
          an inline button to add it WITHOUT collapsing the guide. */}
      <div className="card card-pad" style={{ marginBottom: "var(--sp-5)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <CompletionRing pct={overallPct} big />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14.5, fontWeight: 640 }}>
              {overallPct === 100 ? "Record complete ✓" : `${toGo} field${toGo === 1 ? "" : "s"} left to fill`}
            </div>
            <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>
              {totalFilled} of {fields.length} filled across {order.length} section{order.length === 1 ? "" : "s"}. A complete record makes your agents sharper.
            </div>
          </div>
          {missingFieldCount > 0 && (
            <button className="btn btn-accent btn-sm" disabled={scaffolding} onClick={() => addMissing(missing)} style={{ flexShrink: 0 }}>
              {scaffolding ? "Adding…" : `+ ${missingFieldCount} recommended`}
            </button>
          )}
        </div>
        {missingFieldCount > 0 && (
          <div className="t-sub" style={{ fontSize: 12, color: "var(--ac-text)", marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
            Recommended structure available: {missing.map((m) => m.section).join(", ")}.
          </div>
        )}
      </div>

      {order.map((sName) => {
        const items = bySection[sName];
        const filled = items.filter((f) => f.value && f.value.trim()).length;
        const pct = Math.round((filled / items.length) * 100);
        const blurb = sectionBlurb[sName];
        return (
          <section className="section" key={sName}>
            <div className="section-head" style={{ alignItems: "flex-start" }}>
              <div>
                <div className="row gap-2">
                  <span className="t-h2" style={{ fontSize: 14.5 }}>{sName}</span>
                  <span className="chip" style={{ background: pct === 100 ? "var(--gn-fill)" : "var(--fill)", color: pct === 100 ? "var(--gn-text)" : "var(--ts)" }}>{filled}/{items.length}</span>
                </div>
                {blurb && <div className="t-sub t-muted" style={{ fontSize: 12.5, marginTop: 2 }}>{blurb}</div>}
              </div>
              {addingIn !== sName && <button className="btn btn-secondary btn-sm" onClick={() => { setAddingIn(sName); setNewLabel(""); }}>+ Field</button>}
            </div>

            <div className="card" style={{ overflow: "hidden" }}>
              {items.map((f, i) => {
                const done = !!(f.value && f.value.trim());
                const hint = fieldHint[f.label.toLowerCase()];
                return (
                  <div key={f.id} style={{ padding: "14px 18px", borderTop: i === 0 ? "none" : "1px solid var(--border)", background: done ? "transparent" : "var(--panel-2)" }}>
                    <div className="row-between" style={{ marginBottom: done ? 5 : 2 }}>
                      <div className="row gap-2">
                        {/* checklist check — a visual, not a list bullet */}
                        <Check done={done} />
                        <span className="t-h2" style={{ fontSize: 13, fontWeight: 620 }}>{f.label}</span>
                      </div>
                      {editing !== f.id && <button className={`btn btn-sm ${done ? "btn-secondary" : ""}`} onClick={() => { setEditing(f.id); setDraft(f.value ?? ""); }}>{done ? "Edit" : "Fill in"}</button>}
                    </div>
                    {editing === f.id ? (
                      <div style={{ marginLeft: 26 }}>
                        {hint && <div className="t-sub t-muted" style={{ fontSize: 12, marginBottom: 6 }}>{hint}</div>}
                        <textarea className="textarea" rows={3} autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={hint} style={{ marginBottom: 8 }} />
                        <div className="row gap-2">
                          <button className="btn btn-sm" onClick={() => save(f.id)}>Save</button>
                          <button className="btn btn-secondary btn-sm" onClick={() => setEditing(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="t-body" style={{ lineHeight: 1.6, whiteSpace: "pre-wrap", marginLeft: 26 }}>
                        {done ? f.value : <span className="t-sub t-muted">{hint || "Not filled in yet."}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
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

// Checklist check mark — filled green when done, hollow when not.
function Check({ done }: { done: boolean }) {
  return (
    <span style={{
      width: 18, height: 18, borderRadius: 999, flexShrink: 0,
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      background: done ? "var(--gn)" : "transparent",
      border: done ? "none" : "1.5px solid var(--border-strong)",
      color: "#fff", fontSize: 11, fontWeight: 800,
    }}>{done ? "✓" : ""}</span>
  );
}

// SVG completion ring — a visual, not a static icon. `big` renders a larger
// ring with the percentage label inside, for the record progress header.
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
      {big && (
        <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "var(--tp)" }}>{pct}%</span>
      )}
    </span>
  );
}
