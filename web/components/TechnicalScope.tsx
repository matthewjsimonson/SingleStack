"use client";

// Technical Scope of a Build Item — the executable context PACKAGE a coding
// agent needs, NOT a prose spec. Two parts:
//   • Prose (initiative_fields, section "Technical"): the build prompt + test
//     approach. (Prompt-ready acceptance criteria lives in Product Scope's
//     "What"; the readiness gate reads it from there.)
//   • Structure (build_context_links): the files / entities / skills / schema
//     deltas linked to this Build Item.
// When the bundle is complete, the Build Item can move scoped → ready_for_agent.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Banner, Chip } from "@/components/ui";

type Link = { id: string; kind: string; ref_table: string | null; ref_id: string | null; path: string | null; label: string | null; note: string | null; position: number };
type ProseField = { id: string; field_key: string; value: string | null };

// The link kinds, in render order. file_path / skill_ref / schema_delta carry a
// free-text payload; entity_ref is a polymorphic pointer resolved in-app.
const KINDS: { kind: string; label: string; hint: string }[] = [
  { kind: "file_path", label: "Files", hint: "Repo paths the agent reads or edits" },
  { kind: "entity_ref", label: "Entities", hint: "Linked records in the workspace" },
  { kind: "skill_ref", label: "Skills", hint: "Skills the agent should apply" },
  { kind: "schema_delta", label: "Schema deltas", hint: "DB changes this work declares" },
];
// Entity tables the bundle can point at, with their display column.
const ENTITY_TABLES: { table: string; label: string; col: string }[] = [
  { table: "product_records", label: "Product", col: "name" },
  { table: "gtm_records", label: "GTM record", col: "name" },
  { table: "modules", label: "Module", col: "name" },
  { table: "features", label: "Feature", col: "name" },
  { table: "sources", label: "Source", col: "label" },
  { table: "signals", label: "Signal", col: "title" },
];

// build_state, in order. null is treated as the initial "scoped" gate.
const BUILD_STATE_LABEL: Record<string, string> = { scoped: "Scoped", ready_for_agent: "Ready for agent", in_build: "In build", shipped: "Shipped" };

function errText(e: unknown, fallback: string): string {
  if (e && typeof e === "object") {
    const o = e as { message?: string; code?: string; details?: string; hint?: string };
    const parts = [o.message, o.details, o.hint].filter(Boolean);
    if (parts.length) return `${parts.join(" — ")}${o.code ? ` [${o.code}]` : ""}`;
  }
  return e instanceof Error ? e.message : fallback;
}

export default function TechnicalScope({ initiativeId }: { initiativeId: string }) {
  const supabase = createClient();
  const [buildState, setBuildState] = useState<string | null>(null);
  const [links, setLinks] = useState<Link[]>([]);
  const [prose, setProse] = useState<Record<string, ProseField>>({}); // field_key → row
  const [acceptanceFilled, setAcceptanceFilled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // prose editing
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  // add-link form
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState("file_path");
  const [path, setPath] = useState("");
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [refTable, setRefTable] = useState(ENTITY_TABLES[0].table);
  const [refId, setRefId] = useState("");
  const [entityOpts, setEntityOpts] = useState<{ id: string; label: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data: ini }, { data: lk }, { data: fl }] = await Promise.all([
      supabase.from("initiatives").select("build_state").eq("id", initiativeId).maybeSingle(),
      supabase.from("build_context_links").select("id, kind, ref_table, ref_id, path, label, note, position").eq("initiative_id", initiativeId).order("position"),
      supabase.from("initiative_fields").select("id, field_key, value").eq("initiative_id", initiativeId),
    ]);
    setBuildState((ini as { build_state: string | null } | null)?.build_state ?? null);
    setLinks((lk ?? []) as Link[]);
    const byKey: Record<string, ProseField> = {};
    for (const f of (fl ?? []) as ProseField[]) byKey[f.field_key] = f;
    setProse({ build_prompt: byKey.build_prompt, test_approach: byKey.test_approach } as Record<string, ProseField>);
    setAcceptanceFilled(!!byKey.acceptance_criteria?.value?.trim());
    setLoading(false);
  }, [supabase, initiativeId]);

  useEffect(() => { load(); }, [load]);

  // Fetch entity options when the chosen table changes (entity_ref kind).
  useEffect(() => {
    if (kind !== "entity_ref") return;
    const meta = ENTITY_TABLES.find((t) => t.table === refTable);
    if (!meta) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from(meta.table).select(`id, ${meta.col}`).order(meta.col).limit(200);
      if (cancelled) return;
      const rows = (data ?? []) as unknown as Record<string, string>[];
      const opts = rows.map((r) => ({ id: r.id, label: r[meta.col] }));
      setEntityOpts(opts);
      setRefId(opts[0]?.id ?? "");
    })();
    return () => { cancelled = true; };
  }, [supabase, kind, refTable]);

  async function saveProse(field_key: string, fieldLabel: string) {
    setError(null);
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization.");
      const { error } = await supabase.from("initiative_fields").upsert(
        { org_id: orgId, initiative_id: initiativeId, field_key, label: fieldLabel, section: "Technical", value: draft },
        { onConflict: "initiative_id,field_key" },
      );
      if (error) throw error;
      setEditing(null);
      await load();
    } catch (e) { setError(errText(e, "Could not save.")); }
  }

  async function addLink() {
    setError(null); setBusy(true);
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization.");
      const base: Record<string, unknown> = { org_id: orgId, initiative_id: initiativeId, kind, note: note.trim() || null, position: links.length };
      if (kind === "file_path" || kind === "skill_ref") {
        if (!path.trim()) throw new Error(kind === "file_path" ? "Enter a file path." : "Enter a skill name.");
        base.path = path.trim(); base.label = label.trim() || null;
      } else if (kind === "entity_ref") {
        if (!refId) throw new Error("Pick an entity to link.");
        const opt = entityOpts.find((o) => o.id === refId);
        base.ref_table = refTable; base.ref_id = refId; base.label = label.trim() || opt?.label || null;
      } else if (kind === "schema_delta") {
        if (!label.trim() && !note.trim()) throw new Error("Describe the schema change (label or note).");
        base.label = label.trim() || null; base.path = path.trim() || null;
      }
      const { error } = await supabase.from("build_context_links").insert(base);
      if (error) throw error;
      setPath(""); setLabel(""); setNote(""); setAdding(false);
      await load();
    } catch (e) { setError(errText(e, "Could not add to the bundle.")); }
    finally { setBusy(false); }
  }

  async function removeLink(id: string) {
    setError(null);
    const { error } = await supabase.from("build_context_links").delete().eq("id", id);
    if (error) { setError(errText(error, "Could not remove.")); return; }
    await load();
  }

  async function setState(next: string) {
    setError(null);
    const { error } = await supabase.from("initiatives").update({ build_state: next }).eq("id", initiativeId);
    if (error) { setError(errText(error, "Could not update state.")); return; }
    await load();
  }

  if (loading) return <div className="t-sub t-muted">Loading technical scope…</div>;

  // Readiness gate — the four conditions to reach ready_for_agent.
  const hasBundle = links.length > 0;
  const hasSkill = links.some((l) => l.kind === "skill_ref");
  const hasTest = !!prose.test_approach?.value?.trim();
  const checks = [
    { ok: hasBundle, label: "Context bundle has at least one link" },
    { ok: hasSkill, label: "At least one skill referenced" },
    { ok: acceptanceFilled, label: "Acceptance criteria captured", hint: "in Product Scope → What" },
    { ok: hasTest, label: "Test approach defined" },
  ];
  const ready = checks.every((c) => c.ok);
  const state = buildState ?? "scoped";
  const isScoped = state === "scoped";
  const linksByKind = (k: string) => links.filter((l) => l.kind === k);

  return (
    <div>
      <Banner>{error}</Banner>

      {/* Readiness gate */}
      <div className="card card-pad" style={{ marginBottom: "var(--sp-5)" }}>
        <div className="row-between" style={{ alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
          <div className="row gap-2" style={{ alignItems: "center" }}>
            <span className="t-h2" style={{ fontSize: 14.5 }}>Agent readiness</span>
            <Chip tone={state === "ready_for_agent" ? "green" : state === "shipped" ? "green" : state === "in_build" ? "accent" : "amber"}>{BUILD_STATE_LABEL[state] ?? state}</Chip>
          </div>
          {isScoped && <button className="btn btn-sm" disabled={!ready} title={ready ? "Hand off to a coding agent" : "Complete the checklist below first"} onClick={() => setState("ready_for_agent")}>Mark ready for agent →</button>}
          {state === "ready_for_agent" && <button className="btn btn-secondary btn-sm" onClick={() => setState("scoped")}>← Back to scoped</button>}
        </div>
        <div className="stack-2">
          {checks.map((c) => (
            <div key={c.label} className="row gap-2" style={{ alignItems: "center", fontSize: 13 }}>
              <span style={{ width: 18, height: 18, borderRadius: 999, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", background: c.ok ? "var(--gn)" : "transparent", border: c.ok ? "none" : "1.5px solid var(--border-strong)", color: "#fff", fontSize: 11, fontWeight: 800 }}>{c.ok ? "✓" : ""}</span>
              <span style={{ color: c.ok ? "var(--tp)" : "var(--tm)" }}>{c.label}</span>
              {c.hint && <span className="t-mono-xs t-muted">— {c.hint}</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Technical prose — the build prompt + test approach */}
      <div className="card" style={{ overflow: "hidden", marginBottom: "var(--sp-5)" }}>
        {([
          { key: "build_prompt", label: "Build prompt", hint: "The instruction handed to the coding agent — what to build, in its words." },
          { key: "test_approach", label: "Test approach", hint: "How this gets verified — tests, checks, what 'working' looks like." },
        ] as const).map((f, i) => {
          const row = prose[f.key];
          const val = row?.value?.trim();
          return (
            <div key={f.key} style={{ padding: "14px 18px", borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
              <div className="row-between" style={{ marginBottom: 5 }}>
                <div className="row gap-2">
                  <span style={{ width: 18, height: 18, borderRadius: 999, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", background: val ? "var(--gn)" : "transparent", border: val ? "none" : "1.5px solid var(--border-strong)", color: "#fff", fontSize: 11, fontWeight: 800 }}>{val ? "✓" : ""}</span>
                  <span className="t-h2" style={{ fontSize: 13, fontWeight: 620 }}>{f.label}</span>
                </div>
                {editing !== f.key && <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(f.key); setDraft(row?.value ?? ""); }}>{val ? "Edit" : "Add"}</button>}
              </div>
              {editing === f.key ? (
                <div style={{ marginLeft: 26 }}>
                  <textarea className="textarea" rows={3} autoFocus value={draft} placeholder={f.hint} onChange={(e) => setDraft(e.target.value)} style={{ marginBottom: 8 }} />
                  <div className="row gap-2"><button className="btn btn-sm" onClick={() => saveProse(f.key, f.label)}>Save</button><button className="btn btn-secondary btn-sm" onClick={() => setEditing(null)}>Cancel</button></div>
                </div>
              ) : val ? (
                <div className="t-body" style={{ lineHeight: 1.6, whiteSpace: "pre-wrap", marginLeft: 26 }}>{row?.value}</div>
              ) : (
                <div className="t-sub t-muted" style={{ marginLeft: 26, fontSize: 12.5 }}>{f.hint}</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Context bundle */}
      <div className="section-head" style={{ alignItems: "flex-start" }}>
        <div>
          <div className="row gap-2"><span className="t-h2" style={{ fontSize: 14.5 }}>Context bundle</span><span className="chip">{links.length}</span></div>
          <div className="t-sub t-muted" style={{ fontSize: 12.5, marginTop: 2 }}>The files, entities, skills, and schema deltas a coding agent needs to build this.</div>
        </div>
        {!adding && <button className="btn btn-secondary btn-sm" onClick={() => setAdding(true)}>+ Add</button>}
      </div>

      {adding && (
        <div className="card card-pad" style={{ marginBottom: "var(--sp-4)" }}>
          <div className="row gap-2" style={{ marginBottom: 8, flexWrap: "wrap" }}>
            <select className="select" value={kind} onChange={(e) => { setKind(e.target.value); setPath(""); setLabel(""); }} style={{ flex: "0 0 160px" }}>
              {KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
            </select>
            {kind === "entity_ref" ? (
              <>
                <select className="select" value={refTable} onChange={(e) => setRefTable(e.target.value)} style={{ flex: "0 0 150px" }}>
                  {ENTITY_TABLES.map((t) => <option key={t.table} value={t.table}>{t.label}</option>)}
                </select>
                <select className="select" value={refId} onChange={(e) => setRefId(e.target.value)} style={{ flex: "1 1 200px" }}>
                  {entityOpts.length === 0 ? <option value="">None available</option> : entityOpts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </>
            ) : (
              <input className="input" placeholder={kind === "file_path" ? "web/app/.../Thing.tsx" : kind === "skill_ref" ? "singlestack-ui" : "e.g. add initiatives.foo column"} value={kind === "schema_delta" ? label : path} onChange={(e) => (kind === "schema_delta" ? setLabel(e.target.value) : setPath(e.target.value))} style={{ flex: "1 1 220px" }} />
            )}
          </div>
          <div className="row gap-2" style={{ flexWrap: "wrap" }}>
            <input className="input" placeholder="Note — how the agent should use it (optional)" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: "1 1 280px" }} />
            <button className="btn btn-sm" disabled={busy} onClick={addLink}>{busy ? "Adding…" : "Add"}</button>
            <button className="btn btn-secondary btn-sm" onClick={() => { setAdding(false); setPath(""); setLabel(""); setNote(""); }}>Cancel</button>
          </div>
          <div className="t-sub t-muted" style={{ fontSize: 12, marginTop: 6 }}>{KINDS.find((k) => k.kind === kind)?.hint}</div>
        </div>
      )}

      {links.length === 0 && !adding ? (
        <div className="empty">
          <div className="t-body" style={{ fontWeight: 600, marginBottom: 6 }}>Bundle is empty</div>
          <div className="t-sub" style={{ maxWidth: 460, marginInline: "auto" }}>Add the files, entities, skills, and schema deltas an agent needs. A skill reference is required to reach “ready for agent”.</div>
        </div>
      ) : (
        KINDS.filter((k) => linksByKind(k.kind).length > 0).map((k) => (
          <div key={k.kind} style={{ marginBottom: "var(--sp-4)" }}>
            <div className="t-label" style={{ marginBottom: 6 }}>{k.label}</div>
            <div className="card" style={{ overflow: "hidden" }}>
              {linksByKind(k.kind).map((l, i) => {
                const tableLabel = l.ref_table ? ENTITY_TABLES.find((t) => t.table === l.ref_table)?.label ?? l.ref_table : null;
                const primary = l.label || l.path || "(unlabeled)";
                return (
                  <div key={l.id} className="row-between" style={{ padding: "10px 14px", borderTop: i === 0 ? "none" : "1px solid var(--border)", alignItems: "flex-start", gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="row gap-2" style={{ alignItems: "baseline", flexWrap: "wrap" }}>
                        {tableLabel && <Chip>{tableLabel}</Chip>}
                        <span style={{ fontSize: 13, fontWeight: 600, fontFamily: l.kind === "file_path" ? "var(--mono, monospace)" : undefined }}>{primary}</span>
                        {l.label && l.path && l.kind !== "entity_ref" && <span className="t-mono-xs t-muted">{l.path}</span>}
                      </div>
                      {l.note && <div className="t-sub t-muted" style={{ fontSize: 12, marginTop: 3 }}>{l.note}</div>}
                    </div>
                    <button className="btn btn-secondary btn-sm" title="Remove from bundle" onClick={() => removeLink(l.id)} style={{ flexShrink: 0 }}>✕</button>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
