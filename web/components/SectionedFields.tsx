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
import MetricField from "@/components/MetricField";

type Field = { id: string; field_key: string; label: string; value: string | null; section: string | null; position: number; field_kind?: string; metric_unit?: string | null };
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
  const [newKind, setNewKind] = useState<"narrative" | "metric">("narrative");
  const [newUnit, setNewUnit] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("record_fields").select("id, field_key, label, value, section, position, field_kind, metric_unit")
      .eq(fk(target), target.id).order("position");
    setFields(data ?? []);
    setLoading(false);
  }, [supabase, target]);

  useEffect(() => { load(); }, [load]);

  // Surface the REAL cause. Supabase throws a PostgrestError object (not an Error
  // instance), so `e instanceof Error` was hiding everything behind "Could not
  // save". Pull message + code + details/hint so failures are diagnosable.
  function errText(e: unknown, fallback: string): string {
    if (e && typeof e === "object") {
      const o = e as { message?: string; code?: string; details?: string; hint?: string };
      const parts = [o.message, o.details, o.hint].filter(Boolean);
      if (parts.length) return `${parts.join(" — ")}${o.code ? ` [${o.code}]` : ""}`;
    }
    return e instanceof Error ? e.message : fallback;
  }

  async function save(id: string) {
    setError(null);
    const { error } = await supabase.from("record_fields").update({ value: draft }).eq("id", id);
    if (error) { setError(errText(error, "Could not save.")); return; }
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
      // Decide insert-vs-update against the DB's CURRENT state, not possibly-stale
      // client state. A row can already exist for a field_key (e.g. filled in an
      // earlier session) and (product_id, field_key) is uniquely constrained —
      // re-querying avoids a duplicate-key INSERT. (Can't use upsert: the unique
      // index is partial, which ON CONFLICT can't target.)
      const { data: live } = await supabase.from("record_fields")
        .select("id, field_key").eq(fk(target), target.id);
      const byKey = new Map((live ?? []).map((f) => [f.field_key, f.id]));
      const inserts: Record<string, unknown>[] = [];
      const updates: { id: string; value: string }[] = [];
      let pos = (live ?? []).length;
      for (const s of missing) {
        for (const f of s.fields) {
          const v = (recDrafts[f.key] ?? "").trim();
          if (!v) continue; // only persist what was actually filled
          const existingId = byKey.get(f.key);
          if (existingId) updates.push({ id: existingId, value: v });
          else inserts.push({ org_id: orgId, [fk(target)]: target.id, field_key: f.key, label: f.label, section: s.section, value: v, position: pos++ });
        }
      }
      if (inserts.length) { const { error } = await supabase.from("record_fields").insert(inserts); if (error) throw error; }
      for (const u of updates) { const { error } = await supabase.from("record_fields").update({ value: u.value }).eq("id", u.id); if (error) throw error; }
      setPanelOpen(false); setRecDrafts({});
      await load();
    } catch (e) { setError(errText(e, "Could not save.")); }
    finally { setSaving(false); }
  }

  async function addField(sectionName: string) {
    setError(null);
    const label = newLabel.trim();
    if (!label) return;
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization.");
      let key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `field_${Date.now()}`;
      // (product_id, field_key) is unique. If a row with this derived key already
      // exists (e.g. re-adding a label that matches an existing field), suffix the
      // key so the add doesn't collide — the label can repeat, the key can't.
      const { data: live } = await supabase.from("record_fields")
        .select("field_key").eq(fk(target), target.id);
      const taken = new Set((live ?? []).map((f) => f.field_key));
      if (taken.has(key)) key = `${key}_${Date.now().toString(36)}`;
      const { error } = await supabase.from("record_fields").insert({
        org_id: orgId, [fk(target)]: target.id, field_key: key, label,
        section: sectionName === UNGROUPED ? null : sectionName,
        field_kind: newKind,
        metric_unit: newKind === "metric" ? (newUnit.trim() || null) : null,
        // a metric field carries no prose value — its data lives in record_metrics
        value: newKind === "metric" ? null : (newVal.trim() || null),
        position: (live ?? []).length,
      });
      if (error) throw error;
      setAddingIn(null); setNewLabel(""); setNewVal(""); setNewKind("narrative"); setNewUnit("");
      await load();
    } catch (e) { setError(errText(e, "Could not add field.")); }
  }

  if (loading) return <div className="t-sub t-muted">Loading…</div>;

  const { sectionBlurb, fieldHint } = guides(target.kind);

  // Filled narrative fields appear in the list; metric fields ALWAYS appear once
  // they exist (their data lives in record_metrics, not in value).
  const isMetric = (f: Field) => f.field_kind === "metric";
  const filledFields = fields.filter((f) => isMetric(f) || (f.value && f.value.trim()));
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
                      <div className="row gap-2">
                        <Check done={isMetric(f) ? undefined : true} />
                        <span className="t-h2" style={{ fontSize: 13, fontWeight: 620 }}>{f.label}</span>
                        {isMetric(f) && <span className="chip" style={{ fontSize: 10 }}>metric</span>}
                      </div>
                      {!isMetric(f) && editing !== f.id && <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(f.id); setDraft(f.value ?? ""); }}>Edit</button>}
                    </div>
                    {isMetric(f) ? (
                      <MetricField fieldId={f.id} unit={f.metric_unit} />
                    ) : editing === f.id ? (
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
                    <div className="row gap-2" style={{ marginBottom: 8, flexWrap: "wrap" }}>
                      <input className="input" autoFocus placeholder="Field label" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} style={{ flex: "1 1 200px" }} />
                      <select className="select" value={newKind} onChange={(e) => setNewKind(e.target.value as "narrative" | "metric")} style={{ flex: "0 0 150px" }}>
                        <option value="narrative">Narrative (text)</option>
                        <option value="metric">Metric (number, MoM)</option>
                      </select>
                      {newKind === "metric" && <input className="input" placeholder="Unit (NPS, %, $)" value={newUnit} onChange={(e) => setNewUnit(e.target.value)} style={{ flex: "0 0 120px" }} />}
                    </div>
                    {newKind === "narrative"
                      ? <textarea className="textarea" rows={2} placeholder="Value" value={newVal} onChange={(e) => setNewVal(e.target.value)} style={{ marginBottom: 8 }} />
                      : <div className="t-sub t-muted" style={{ fontSize: 12, marginBottom: 8 }}>A metric field tracks a sourced number month-over-month. You'll add readings (with their source) after creating it.</div>}
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

function Check({ done }: { done?: boolean }) {
  // done === true → filled check; undefined → neutral (metric field, no done state)
  const filled = done === true;
  return (
    <span style={{ width: 18, height: 18, borderRadius: 999, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", background: filled ? "var(--gn)" : "transparent", border: filled ? "none" : "1.5px solid var(--border-strong)", color: "#fff", fontSize: 11, fontWeight: 800 }}>{filled ? "✓" : ""}</span>
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
