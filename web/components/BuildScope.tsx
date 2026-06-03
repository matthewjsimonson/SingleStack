"use client";

// Product Scope of a Build Item (an initiative): the Why / What / How / Proof
// spec it gets built from. Same pattern as records' SectionedFields, but bound
// to initiative_fields (one parent, no metric fields). The LIST shows only
// FILLED fields, grouped into section panels; recommended-but-empty fields live
// in a banner ("+N recommended") that opens an inline fill panel. initiative_fields
// has a full unique index on (initiative_id, field_key), so saves upsert cleanly.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Banner } from "@/components/ui";
import { templateFor, BUILD_TEMPLATE } from "@/lib/templates";

type Field = { id: string; field_key: string; label: string; value: string | null; section: string | null; position: number };

const UNGROUPED = "Details";
// Template section order, used to sort the rendered panels.
const SECTION_ORDER = BUILD_TEMPLATE.map((s) => s.section);

function guides() {
  const sectionBlurb: Record<string, string> = {};
  const fieldHint: Record<string, string> = {};
  for (const s of templateFor("build")) {
    sectionBlurb[s.section] = s.blurb;
    for (const f of s.fields) if (f.placeholder) fieldHint[f.label.toLowerCase()] = f.placeholder;
  }
  return { sectionBlurb, fieldHint };
}

function errText(e: unknown, fallback: string): string {
  if (e && typeof e === "object") {
    const o = e as { message?: string; code?: string; details?: string; hint?: string };
    const parts = [o.message, o.details, o.hint].filter(Boolean);
    if (parts.length) return `${parts.join(" — ")}${o.code ? ` [${o.code}]` : ""}`;
  }
  return e instanceof Error ? e.message : fallback;
}

export default function BuildScope({ initiativeId }: { initiativeId: string }) {
  const supabase = createClient();
  const [fields, setFields] = useState<Field[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const [panelOpen, setPanelOpen] = useState(false);
  const [recDrafts, setRecDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const [addingIn, setAddingIn] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [newVal, setNewVal] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("initiative_fields").select("id, field_key, label, value, section, position")
      .eq("initiative_id", initiativeId).order("position");
    setFields((data ?? []) as Field[]);
    setLoading(false);
  }, [supabase, initiativeId]);

  useEffect(() => { load(); }, [load]);

  async function save(id: string) {
    setError(null);
    const { error } = await supabase.from("initiative_fields").update({ value: draft }).eq("id", id);
    if (error) { setError(errText(error, "Could not save.")); return; }
    setEditing(null);
    await load();
  }

  // Save the recommended fields the user filled. Upsert on the (initiative_id,
  // field_key) unique index updates an existing row or inserts a new one.
  async function saveRecommended(missing: { section: string; fields: { key: string; label: string }[] }[]) {
    setSaving(true); setError(null);
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization.");
      let pos = fields.length;
      const rows: Record<string, unknown>[] = [];
      for (const s of missing) {
        for (const f of s.fields) {
          const v = (recDrafts[f.key] ?? "").trim();
          if (!v) continue; // only persist what was actually filled
          rows.push({ org_id: orgId, initiative_id: initiativeId, field_key: f.key, label: f.label, section: s.section, value: v, position: pos++ });
        }
      }
      if (rows.length === 0) {
        setSaving(false);
        setError("Nothing to save — fill in a value, then Save.");
        return; // keep the panel open so typed text isn't lost
      }
      const { error } = await supabase.from("initiative_fields").upsert(rows, { onConflict: "initiative_id,field_key" });
      if (error) throw error;
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
      // (initiative_id, field_key) is unique. Suffix a derived key that's taken so
      // re-using a label doesn't collide — labels can repeat, keys can't.
      const taken = new Set(fields.map((f) => f.field_key));
      if (taken.has(key)) key = `${key}_${Date.now().toString(36)}`;
      const { error } = await supabase.from("initiative_fields").insert({
        org_id: orgId, initiative_id: initiativeId, field_key: key, label,
        section: sectionName === UNGROUPED ? null : sectionName,
        value: newVal.trim() || null, position: fields.length,
      });
      if (error) throw error;
      setAddingIn(null); setNewLabel(""); setNewVal("");
      await load();
    } catch (e) { setError(errText(e, "Could not add field.")); }
  }

  if (loading) return <div className="t-sub t-muted">Loading scope…</div>;

  const { sectionBlurb, fieldHint } = guides();

  const filledFields = fields.filter((f) => f.value && f.value.trim());
  const filledKeys = new Set(filledFields.map((f) => f.field_key));

  // Group filled fields by section, ordered: template sections first (in template
  // order), then any ad-hoc sections (first-seen), then ungrouped last.
  const bySection: Record<string, Field[]> = {};
  for (const f of filledFields) {
    const s = f.section || UNGROUPED;
    (bySection[s] ??= []).push(f);
  }
  const present = Object.keys(bySection);
  const order = [
    ...SECTION_ORDER.filter((s) => present.includes(s)),
    ...present.filter((s) => !SECTION_ORDER.includes(s) && s !== UNGROUPED),
    ...(present.includes(UNGROUPED) ? [UNGROUPED] : []),
  ];

  // Recommended = template fields not yet filled.
  const missing = templateFor("build")
    .map((s) => ({ section: s.section, blurb: sectionBlurb[s.section], fields: s.fields.filter((f) => !filledKeys.has(f.key)) }))
    .filter((s) => s.fields.length > 0);
  const missingCount = missing.reduce((n, s) => n + s.fields.length, 0);
  const totalTemplate = templateFor("build").reduce((n, s) => n + s.fields.length, 0);
  const pct = totalTemplate ? Math.round(((totalTemplate - missingCount) / totalTemplate) * 100) : 0;

  return (
    <div>
      <Banner>{error}</Banner>

      {/* Recommended-structure banner — empty fields live here until filled. */}
      {missingCount > 0 && (
        <div className="card card-pad" style={{ marginBottom: "var(--sp-5)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <CompletionRing pct={pct} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14.5, fontWeight: 640 }}>{missingCount} recommended scope field{missingCount === 1 ? "" : "s"} to capture</div>
              <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>
                {totalTemplate - missingCount} of {totalTemplate} captured across {missing.map((m) => m.section).join(", ")}. A complete scope is what makes this buildable.
              </div>
            </div>
            <button className="btn btn-accent btn-sm" onClick={() => setPanelOpen((v) => !v)} style={{ flexShrink: 0 }}>
              {panelOpen ? "Hide" : `+ ${missingCount} recommended`}
            </button>
          </div>

          {panelOpen && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
              {missing.map((s) => (
                <div key={s.section} style={{ marginBottom: 16 }}>
                  <div className="t-label" style={{ marginBottom: 8 }}>{s.section}</div>
                  <div className="stack-3">
                    {s.fields.map((f) => (
                      <div key={f.key}>
                        <div className="t-h2" style={{ fontSize: 13, fontWeight: 620, marginBottom: 4 }}>{f.label}</div>
                        <textarea className="textarea" rows={2} placeholder={fieldHint[f.label.toLowerCase()]} value={recDrafts[f.key] ?? ""}
                          onChange={(e) => setRecDrafts({ ...recDrafts, [f.key]: e.target.value })} />
                      </div>
                    ))}
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

      {/* The list — filled fields only, grouped by section. */}
      {filledFields.length === 0 && !panelOpen ? (
        <div className="empty">
          <div className="t-body" style={{ fontWeight: 600, marginBottom: 6 }}>No scope captured yet</div>
          <div className="t-sub" style={{ maxWidth: 460, marginInline: "auto" }}>Use “+ recommended” above to fill in the Why / What / How / Proof — the spec this Build Item gets built from.</div>
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
                        <Check />
                        <span className="t-h2" style={{ fontSize: 13, fontWeight: 620 }}>{f.label}</span>
                      </div>
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
                    <input className="input" autoFocus placeholder="Field label" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} style={{ marginBottom: 8, width: "100%" }} />
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

function Check() {
  return (
    <span style={{ width: 18, height: 18, borderRadius: 999, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "var(--gn)", color: "#fff", fontSize: 11, fontWeight: 800 }}>✓</span>
  );
}

function CompletionRing({ pct }: { pct: number }) {
  const size = 52, sw = 4, cx = size / 2, r = cx - sw;
  const c = 2 * Math.PI * r, off = c - (pct / 100) * c;
  const color = pct === 100 ? "var(--gn)" : pct > 0 ? "var(--ac)" : "var(--border-strong)";
  return (
    <span style={{ position: "relative", width: size, height: size, flexShrink: 0, display: "inline-block" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--fill-2)" strokeWidth={sw} />
        <circle cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth={sw} strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" />
      </svg>
      <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "var(--tp)" }}>{pct}%</span>
    </span>
  );
}
