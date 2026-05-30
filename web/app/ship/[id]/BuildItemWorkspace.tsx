"use client";

// Build-item workspace — a build item is not a title + description. It's a
// sectioned Why / What / How / Proof body (stored as initiative_fields, the same
// pattern records use) plus a GATED pipeline rail. Filled fields show; the rest
// live under a quiet "+N recommended" toggle, so the page is substance, not a
// wall of empty inputs. AI drafting fields as proposals is the next slice — the
// human structure comes first.
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { PageHeader, Section, Chip, Banner, BackLink, Spinner } from "@/components/ui";
import { BUILD_ITEM_TEMPLATE, BUILD_STAGE_GATES } from "@/lib/templates";

type Item = {
  id: string; title: string; description: string | null; kind: string | null;
  build_stage: string | null; priority: string | null; prototype_url: string | null;
};
type Field = { id: string; field_key: string; label: string; value: string | null; section: string | null; position: number };
type Signal = { id: string; title: string };

const STAGES = ["spec", "prototype", "build", "test", "shipped"] as const;
const STAGE_LABEL: Record<string, string> = { spec: "Spec", prototype: "Prototype", build: "Build", test: "Test", shipped: "Shipped" };

export default function BuildItemWorkspace({ id }: { id: string }) {
  const supabase = createClient();
  const [item, setItem] = useState<Item | null>(null);
  const [fields, setFields] = useState<Field[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // field_key being edited
  const [draft, setDraft] = useState("");
  const [openRec, setOpenRec] = useState<Record<string, boolean>>({}); // section -> recommended panel open

  const load = useCallback(async () => {
    const [{ data: it, error: itErr }, { data: fs }, { data: links }] = await Promise.all([
      supabase.from("initiatives").select("id, title, description, kind, build_stage, priority, prototype_url").eq("id", id).single(),
      supabase.from("initiative_fields").select("id, field_key, label, value, section, position").eq("initiative_id", id).order("position"),
      supabase.from("initiative_signals").select("signal_id").eq("initiative_id", id),
    ]);
    if (itErr) setError(itErr.message);
    setItem(it ?? null);
    setFields(fs ?? []);
    const ids = (links ?? []).map((l: { signal_id: string }) => l.signal_id);
    if (ids.length) {
      const { data: sigs } = await supabase.from("signals").select("id, title").in("id", ids);
      setSignals(sigs ?? []);
    } else setSignals([]);
    setLoading(false);
  }, [supabase, id]);
  useEffect(() => { load(); }, [load]);

  const valueOf = (key: string) => fields.find((f) => f.field_key === key)?.value ?? null;
  const isFilled = (key: string) => {
    const v = valueOf(key);
    return v !== null && v.trim() !== "";
  };

  async function saveField(sectionName: string, key: string, label: string, value: string) {
    setError(null);
    try {
      const v = value.trim();
      const existing = fields.find((f) => f.field_key === key);
      if (existing) {
        await supabase.from("initiative_fields").update({ value: v || null }).eq("id", existing.id);
      } else {
        const orgId = await getOrgId();
        if (!orgId) throw new Error("Could not resolve your organization.");
        await supabase.from("initiative_fields").insert({
          org_id: orgId, initiative_id: id, field_key: key, label, value: v || null,
          section: sectionName, position: fields.length,
        });
      }
      setEditing(null); setDraft("");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save."); }
  }

  // Gate: leaving `stage` requires these keys filled.
  const unmetFor = (stage: string) => (BUILD_STAGE_GATES[stage] ?? []).filter((k) => !isFilled(k));

  async function moveStage(dir: 1 | -1) {
    if (!item) return;
    const cur = item.build_stage ?? "spec";
    const idx = STAGES.indexOf(cur as (typeof STAGES)[number]);
    if (idx < 0) return;
    if (dir === 1) {
      const missing = unmetFor(cur);
      if (missing.length) { setError(`Fill these before advancing past ${STAGE_LABEL[cur]}: ${missing.map((k) => labelFor(k)).join(", ")}`); return; }
    }
    const next = STAGES[Math.min(STAGES.length - 1, Math.max(0, idx + dir))];
    setError(null);
    await supabase.from("initiatives").update({ build_stage: next }).eq("id", id);
    await load();
  }

  function labelFor(key: string): string {
    for (const s of BUILD_ITEM_TEMPLATE) { const f = s.fields.find((x) => x.key === key); if (f) return f.label; }
    return key;
  }

  if (loading) return <Spinner label="Loading build item…" />;
  if (!item) return <Banner>Build item not found.</Banner>;

  const stage = item.build_stage ?? "spec";

  return (
    <div>
      <BackLink href="/ship" label="Ship" />
      <PageHeader
        title={item.title}
        meta={item.description || "A build item — the reasoning to build from, and the evidence behind it."}
        actions={<>{item.kind && <Chip tone="accent">{item.kind}</Chip>}{item.priority && <Chip>{item.priority}</Chip>}</>}
      />
      <Banner>{error}</Banner>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 300px", gap: "var(--sp-6)", alignItems: "start" }}>
        {/* LEFT: the structured Why / What / How / Proof body */}
        <div style={{ display: "grid", gap: "var(--sp-6)" }}>
          {BUILD_ITEM_TEMPLATE.map((sec) => {
            const filled = sec.fields.filter((f) => isFilled(f.key));
            const empty = sec.fields.filter((f) => !isFilled(f.key));
            const recOpen = !!openRec[sec.section];
            return (
              <Section key={sec.section} label={sec.section}>
                <div className="t-sub t-muted" style={{ marginBottom: "var(--sp-3)" }}>{sec.blurb}</div>
                {filled.length === 0 && !recOpen && (
                  <p className="t-muted" style={{ margin: "0 0 var(--sp-3)" }}>Nothing captured yet.</p>
                )}
                {filled.map((f) => (
                  <div key={f.key} className="card card-pad" style={{ marginBottom: "var(--sp-3)" }}>
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                      <span className="t-label">{f.label}</span>
                      {editing !== f.key && (
                        <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(f.key); setDraft(valueOf(f.key) ?? ""); }}>Edit</button>
                      )}
                    </div>
                    {editing === f.key ? (
                      <>
                        <textarea className="textarea" rows={3} autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={f.placeholder} />
                        <div className="row gap-2" style={{ marginTop: 6 }}>
                          <button className="btn" onClick={() => saveField(sec.section, f.key, f.label, draft)}>Save</button>
                          <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(null); setDraft(""); }}>Cancel</button>
                        </div>
                      </>
                    ) : (
                      <p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{valueOf(f.key)}</p>
                    )}
                  </div>
                ))}

                {empty.length > 0 && (
                  <button className="btn btn-secondary btn-sm" onClick={() => setOpenRec({ ...openRec, [sec.section]: !recOpen })}>
                    {recOpen ? "Hide" : `+ ${empty.length} recommended`}
                  </button>
                )}
                {recOpen && empty.map((f) => (
                  <div key={f.key} className="card card-pad" style={{ marginTop: "var(--sp-3)", borderStyle: "dashed" }}>
                    <span className="t-label">{f.label}</span>
                    <textarea
                      className="textarea" rows={2} placeholder={f.placeholder}
                      value={editing === f.key ? draft : ""}
                      onFocus={() => { setEditing(f.key); setDraft(valueOf(f.key) ?? ""); }}
                      onChange={(e) => setDraft(e.target.value)}
                    />
                    {editing === f.key && (
                      <div className="row gap-2" style={{ marginTop: 6 }}>
                        <button className="btn" onClick={() => saveField(sec.section, f.key, f.label, draft)}>Save</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(null); setDraft(""); }}>Cancel</button>
                      </div>
                    )}
                  </div>
                ))}
              </Section>
            );
          })}
        </div>

        {/* RIGHT: the gated pipeline rail + evidence */}
        <div style={{ display: "grid", gap: "var(--sp-4)", position: "sticky", top: "var(--sp-4)" }}>
          <Section label="Pipeline">
            <div className="t-sub t-muted" style={{ marginBottom: "var(--sp-3)" }}>Gates block a stage until its fields are filled.</div>
            <div style={{ display: "grid", gap: 6 }}>
              {STAGES.map((s) => (
                <div key={s} className="row gap-2" style={{ alignItems: "center" }}>
                  <span aria-hidden style={{ width: 8, height: 8, borderRadius: 99, background: s === stage ? "var(--accent)" : "var(--border)" }} />
                  <span style={{ fontWeight: s === stage ? 600 : 400 }}>{STAGE_LABEL[s]}</span>
                </div>
              ))}
            </div>
            <div className="row gap-2" style={{ marginTop: "var(--sp-3)" }}>
              <button className="btn btn-secondary btn-sm" onClick={() => moveStage(-1)} disabled={stage === "spec"}>← Back</button>
              <button className="btn" onClick={() => moveStage(1)} disabled={stage === "shipped"}>Advance →</button>
            </div>
            {unmetFor(stage).length > 0 && stage !== "shipped" && (
              <p className="t-muted" style={{ marginTop: "var(--sp-2)", fontSize: 12 }}>
                To advance: {unmetFor(stage).map(labelFor).join(", ")}
              </p>
            )}
          </Section>

          <Section label="Evidence">
            <div className="t-sub t-muted" style={{ marginBottom: "var(--sp-3)" }}>Signals driving this item.</div>
            {signals.length === 0 ? (
              <p className="t-muted" style={{ margin: 0 }}>No signals cited yet.</p>
            ) : (
              <div className="row gap-2" style={{ flexWrap: "wrap" }}>
                {signals.map((s) => <Chip key={s.id} tone="violet">{s.title}</Chip>)}
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
