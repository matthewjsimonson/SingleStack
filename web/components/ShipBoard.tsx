"use client";

// Ship = the Build Item EXECUTION board. Not loose cards in to-do/done — the
// actual Build Items (initiatives with a build side) moving through their
// build_state lifecycle: Scoped → Ready for agent → In build → Shipped. Each
// card carries real signal — scope completeness and agent-readiness — clicks
// into the cockpit (/initiatives/[id]), and can emit an AGENT BRIEF: the
// prompt + acceptance criteria + context bundle assembled into one handoff a
// coding agent (or engineer) executes. That brief is the point of the module.
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { PageHeader, Chip, Banner, Modal } from "@/components/ui";
import { BUILD_TEMPLATE } from "@/lib/templates";

type Item = { id: string; title: string; kind: string | null; build_state: string | null; scope: string; release_id: string | null };
type FieldRow = { initiative_id: string; field_key: string; value: string | null };
type LinkRow = { initiative_id: string; kind: string; ref_table: string | null; path: string | null; label: string | null; note: string | null };
type Release = { id: string; name: string; version: string | null };

const STATES: [string, string][] = [["scoped", "Scoped"], ["ready_for_agent", "Ready for agent"], ["in_build", "In build"], ["shipped", "Shipped"]];
const STATE_ORDER = STATES.map((s) => s[0]);
const KIND_LABEL: Record<string, string> = { bugfix: "Fix", enhancement: "Enhancement", feature: "New Feature", module: "New Module", product: "Product" };
const ENTITY_LABEL: Record<string, string> = { product_records: "Product", gtm_records: "GTM record", modules: "Module", features: "Feature", sources: "Source", signals: "Signal" };
const SCOPE_KEYS = BUILD_TEMPLATE.flatMap((s) => s.fields.map((f) => f.key)); // 12 Why/What/How/Proof keys
const FIELD_LABEL: Record<string, string> = Object.fromEntries(BUILD_TEMPLATE.flatMap((s) => s.fields.map((f) => [f.key, f.label])));

export default function ShipBoard() {
  const supabase = createClient();
  const [items, setItems] = useState<Item[]>([]);
  const [fields, setFields] = useState<FieldRow[]>([]);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [briefId, setBriefId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: "", kind: "feature" });

  const load = useCallback(async () => {
    const [{ data: it }, { data: fl }, { data: lk }, { data: rel }] = await Promise.all([
      supabase.from("initiatives").select("id, title, kind, build_state, scope, release_id").is("parent_id", null).in("scope", ["product", "both"]).order("created_at", { ascending: false }),
      supabase.from("initiative_fields").select("initiative_id, field_key, value"),
      supabase.from("build_context_links").select("initiative_id, kind, ref_table, path, label, note").order("position"),
      supabase.from("releases").select("id, name, version"),
    ]);
    setItems((it ?? []) as Item[]); setFields((fl ?? []) as FieldRow[]); setLinks((lk ?? []) as LinkRow[]); setReleases((rel ?? []) as Release[]);
    setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  // Per-item derived signal — computed once.
  const derived = useMemo(() => {
    const m = new Map<string, { scopePct: number; checks: { ok: boolean; label: string }[]; ready: boolean; readyN: number }>();
    for (const it of items) {
      const fv = new Map(fields.filter((f) => f.initiative_id === it.id).map((f) => [f.field_key, (f.value ?? "").trim()]));
      const lk = links.filter((l) => l.initiative_id === it.id);
      const filled = SCOPE_KEYS.filter((k) => fv.get(k)).length;
      const checks = [
        { ok: lk.length > 0, label: "Context bundle" },
        { ok: lk.some((l) => l.kind === "skill_ref"), label: "Skill referenced" },
        { ok: !!fv.get("acceptance_criteria"), label: "Acceptance criteria" },
        { ok: !!fv.get("test_approach"), label: "Test approach" },
      ];
      const readyN = checks.filter((c) => c.ok).length;
      m.set(it.id, { scopePct: Math.round((filled / SCOPE_KEYS.length) * 100), checks, ready: readyN === checks.length, readyN });
    }
    return m;
  }, [items, fields, links]);

  const relLabel = (id: string | null) => { const r = releases.find((x) => x.id === id); return r ? (r.version ? `${r.version} · ${r.name}` : r.name) : null; };

  async function move(it: Item, dir: number) {
    setError(null);
    const cur = it.build_state ?? "scoped";
    const next = STATE_ORDER[Math.max(0, Math.min(STATE_ORDER.length - 1, STATE_ORDER.indexOf(cur) + dir))];
    if (next === cur) return;
    // Gate: can't enter ready_for_agent until the readiness checklist passes.
    if (next === "ready_for_agent" && !derived.get(it.id)?.ready) { setError(`“${it.title}” isn't agent-ready yet — finish its Technical Scope (open the card).`); return; }
    const { error } = await supabase.from("initiatives").update({ build_state: next }).eq("id", it.id);
    if (error) { setError(error.message); return; }
    await load();
  }

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setError(null);
    const orgId = await getOrgId(); if (!orgId) { setError("Could not resolve your organization."); return; }
    const { error } = await supabase.from("initiatives").insert({ org_id: orgId, lane: "ship", scope: "product", lifecycle: "build", stage: "active", build_state: "scoped", priority: "high", title: form.title.trim(), kind: form.kind });
    if (error) { setError(error.message); return; }
    setAdding(false); setForm({ title: "", kind: "feature" }); load();
  }

  // The agent brief — the executable handoff. Assembled from scope + technical
  // prose + the context bundle into a single copyable markdown package.
  function buildBrief(it: Item): string {
    const fv = new Map(fields.filter((f) => f.initiative_id === it.id).map((f) => [f.field_key, (f.value ?? "").trim()]));
    const lk = links.filter((l) => l.initiative_id === it.id);
    const L: string[] = [];
    L.push(`# [${KIND_LABEL[it.kind ?? ""] ?? "Build Item"}] ${it.title}`);
    const rel = relLabel(it.release_id); if (rel) L.push(`_Release: ${rel}_`);

    L.push(`\n## Product Scope`);
    for (const s of BUILD_TEMPLATE) {
      const present = s.fields.filter((f) => fv.get(f.key));
      if (!present.length) continue;
      L.push(`\n### ${s.section}`);
      for (const f of present) L.push(`**${f.label}**\n${fv.get(f.key)}\n`);
    }

    L.push(`\n## Technical Scope`);
    if (fv.get("build_prompt")) L.push(`**Build prompt**\n${fv.get("build_prompt")}\n`);
    if (fv.get("acceptance_criteria")) L.push(`**Acceptance criteria**\n${fv.get("acceptance_criteria")}\n`);
    if (fv.get("test_approach")) L.push(`**Test approach**\n${fv.get("test_approach")}\n`);

    const group = (k: string) => lk.filter((l) => l.kind === k);
    const files = group("file_path"), ents = group("entity_ref"), skills = group("skill_ref"), deltas = group("schema_delta");
    if (lk.length) {
      L.push(`\n## Context bundle`);
      if (files.length) { L.push(`\n### Files`); for (const f of files) L.push(`- \`${f.path}\`${f.note ? ` — ${f.note}` : ""}`); }
      if (ents.length) { L.push(`\n### Entities`); for (const e of ents) L.push(`- [${ENTITY_LABEL[e.ref_table ?? ""] ?? e.ref_table}] ${e.label ?? ""}${e.note ? ` — ${e.note}` : ""}`); }
      if (skills.length) { L.push(`\n### Skills`); for (const s of skills) L.push(`- ${s.path ?? s.label}${s.note ? ` — ${s.note}` : ""}`); }
      if (deltas.length) { L.push(`\n### Schema deltas`); for (const d of deltas) L.push(`- ${d.label ?? d.path ?? ""}${d.note ? ` — ${d.note}` : ""}`); }
    }
    return L.join("\n");
  }

  const briefItem = items.find((i) => i.id === briefId) ?? null;
  const briefText = briefItem ? buildBrief(briefItem) : "";

  return (
    <div>
      <PageHeader
        title="Ship"
        meta="Build execution — your Build Items moving from scoped to shipped. Open one to scope it; when it's agent-ready, generate its build brief."
        actions={!adding ? <button className="btn" onClick={() => setAdding(true)}>+ Build Item</button> : undefined}
      />
      <Banner>{error}</Banner>

      {adding && (
        <form onSubmit={addItem} className="card card-pad" style={{ marginBottom: "var(--sp-5)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "var(--sp-3)" }}>
            <label className="field"><span className="t-label">What are you building?</span><input className="input" autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Inline agent handoff from Ship" /></label>
            <label className="field"><span className="t-label">Type</span>
              <select className="select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                <option value="feature">New Feature</option><option value="module">New Module</option><option value="enhancement">Enhancement</option><option value="bugfix">Fix</option>
              </select></label>
          </div>
          <div className="row gap-2"><button className="btn btn-sm" type="submit">Create</button><button className="btn btn-secondary btn-sm" type="button" onClick={() => setAdding(false)}>Cancel</button></div>
        </form>
      )}

      {loading ? <div className="t-sub t-muted">Loading…</div> : items.length === 0 && !adding ? (
        <div className="empty">
          <div className="t-body" style={{ fontWeight: 600, marginBottom: 6 }}>No Build Items yet</div>
          <div className="t-sub" style={{ maxWidth: 480, marginInline: "auto" }}>A Build Item is a thing you’re building — a feature, module, enhancement, or fix. Create one, scope it, and ship it.</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--sp-4)", alignItems: "start" }}>
          {STATES.map(([key, label]) => {
            const col = items.filter((it) => (it.build_state ?? "scoped") === key);
            return (
              <div key={key}>
                <div className="t-label" style={{ marginBottom: "var(--sp-3)" }}>{label} · {col.length}</div>
                <div className="stack-3">
                  {col.length === 0 && <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>—</div>}
                  {col.map((it) => {
                    const d = derived.get(it.id)!;
                    const idx = STATE_ORDER.indexOf(it.build_state ?? "scoped");
                    return (
                      <div key={it.id} className="card card-pad" style={{ borderLeft: "3px solid var(--ac)" }}>
                        <div className="row gap-2" style={{ marginBottom: 6, flexWrap: "wrap" }}>
                          {it.kind && <Chip>{KIND_LABEL[it.kind] ?? it.kind}</Chip>}
                          {relLabel(it.release_id) && <Chip tone="violet">{relLabel(it.release_id)}</Chip>}
                        </div>
                        <a href={`/initiatives/${it.id}`} title="Open the Build Item cockpit" style={{ display: "block", fontSize: 13.5, fontWeight: 640, marginBottom: 8, color: "var(--tp)", textDecoration: "none" }} onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")} onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}>{it.title}</a>

                        {/* scope completeness */}
                        <div className="row-between" style={{ fontSize: 11, color: "var(--tm)", marginBottom: 3 }}><span>Scope</span><span>{d.scopePct}%</span></div>
                        <div style={{ height: 4, borderRadius: 999, background: "var(--fill-2)", marginBottom: 8, overflow: "hidden" }}>
                          <div style={{ width: `${d.scopePct}%`, height: "100%", background: d.scopePct === 100 ? "var(--gn)" : "var(--ac)" }} />
                        </div>

                        {/* readiness */}
                        <div className="row gap-2" style={{ alignItems: "center", marginBottom: 8 }}>
                          <span style={{ fontSize: 11.5, fontWeight: 700, color: d.ready ? "var(--gn-text)" : "var(--tm)" }}>{d.ready ? "✓ Agent-ready" : `Readiness ${d.readyN}/4`}</span>
                        </div>

                        <div className="row gap-2" style={{ alignItems: "center" }}>
                          {idx > 0 && <button className="btn btn-secondary btn-sm" title={`Back to ${STATES[idx - 1][1]}`} onClick={() => move(it, -1)}>←</button>}
                          {idx < STATE_ORDER.length - 1 && <button className="btn btn-secondary btn-sm" title={`Advance to ${STATES[idx + 1][1]}`} onClick={() => move(it, 1)}>{STATES[idx + 1][1]} →</button>}
                          <div style={{ flex: 1 }} />
                          {(it.build_state === "ready_for_agent" || it.build_state === "in_build") && <button className="btn btn-sm" title="Assemble the coding-agent handoff" onClick={() => { setBriefId(it.id); setCopied(false); }}>Agent brief</button>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={!!briefItem} onClose={() => setBriefId(null)} title={briefItem ? `Agent brief — ${briefItem.title}` : ""} width={680}>
        <div className="row-between" style={{ marginBottom: 12, alignItems: "center" }}>
          <span className="t-sub t-muted" style={{ fontSize: 12.5 }}>The executable handoff: scope, acceptance criteria, and the context bundle. Hand it to a coding agent.</span>
          <button className="btn btn-sm" onClick={() => { navigator.clipboard?.writeText(briefText); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>{copied ? "Copied ✓" : "Copy"}</button>
        </div>
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 12.5, lineHeight: 1.55, background: "var(--fill-2)", border: "1px solid var(--border)", borderRadius: 8, padding: 14, maxHeight: "55vh", overflowY: "auto", fontFamily: "var(--mono, monospace)" }}>{briefText}</pre>
      </Modal>
    </div>
  );
}
