"use client";

// Ship = the Build (product) workflow board. Cards are Build Items (initiatives
// with a product/build side), placed in the column of their DERIVED stage
// (deriveBuildStage) — the exact same stage the cockpit shows, so the board and
// the detail never disagree. Stage reflects real work; you don't drag stages
// around. Pure-GTM items live in the GTM area, not here.
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { PageHeader, Chip, Banner, Modal, ConfirmDialog } from "@/components/ui";
import { BUILD_TEMPLATE } from "@/lib/templates";
import { BUILD_STAGES, buildReadiness, deriveBuildStage, type BuildStage } from "@/lib/buildStage";
import { buildAgentBrief, BUILD_KIND_LABEL } from "@/lib/agentBrief";

type Item = { id: string; title: string; kind: string | null; build_state: string | null; release_id: string | null };
type FieldRow = { initiative_id: string; field_key: string; value: string | null };
type LinkRow = { initiative_id: string; kind: string; ref_table: string | null; path: string | null; label: string | null; note: string | null };
type TaskRow = { initiative_id: string | null; stage: string };
type Release = { id: string; name: string; version: string | null };

const SCOPE_KEYS = BUILD_TEMPLATE.flatMap((s) => s.fields.map((f) => f.key));

export default function ShipBoard() {
  const supabase = createClient();
  const [items, setItems] = useState<Item[]>([]);
  const [fields, setFields] = useState<FieldRow[]>([]);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [briefId, setBriefId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: "", kind: "feature" });
  const [delId, setDelId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: it }, { data: fl }, { data: lk }, { data: tk }, { data: rel }] = await Promise.all([
      supabase.from("initiatives").select("id, title, kind, build_state, release_id").is("parent_id", null).in("scope", ["product", "both"]).order("created_at", { ascending: false }),
      supabase.from("initiative_fields").select("initiative_id, field_key, value"),
      supabase.from("build_context_links").select("initiative_id, kind, ref_table, path, label, note").order("position"),
      supabase.from("initiative_workstreams").select("initiative_id, stage").eq("area", "build"),
      supabase.from("releases").select("id, name, version"),
    ]);
    setItems((it ?? []) as Item[]); setFields((fl ?? []) as FieldRow[]); setLinks((lk ?? []) as LinkRow[]); setTasks((tk ?? []) as TaskRow[]); setReleases((rel ?? []) as Release[]);
    setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const derived = useMemo(() => {
    const m = new Map<string, { stage: BuildStage; scopePct: number; readyN: number; ready: boolean }>();
    for (const it of items) {
      const fv = new Map(fields.filter((f) => f.initiative_id === it.id).map((f) => [f.field_key, (f.value ?? "").trim()]));
      const lk = links.filter((l) => l.initiative_id === it.id);
      const bt = tasks.filter((t) => t.initiative_id === it.id);
      const { checks, ready } = buildReadiness(fv, lk);
      const stage = deriveBuildStage({ buildState: it.build_state, ready, buildTasks: bt });
      const filled = SCOPE_KEYS.filter((k) => fv.get(k)).length;
      m.set(it.id, { stage, scopePct: Math.round((filled / SCOPE_KEYS.length) * 100), readyN: checks.filter((c) => c.ok).length, ready });
    }
    return m;
  }, [items, fields, links, tasks]);

  const relLabel = (id: string | null) => { const r = releases.find((x) => x.id === id); return r ? (r.version ? `${r.version} · ${r.name}` : r.name) : null; };

  async function markShipped(it: Item) {
    setError(null);
    const { error } = await supabase.from("initiatives").update({ build_state: "shipped" }).eq("id", it.id);
    if (error) { setError(error.message); return; }
    await load();
  }
  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setError(null);
    const orgId = await getOrgId(); if (!orgId) { setError("Could not resolve your organization."); return; }
    const { error } = await supabase.from("initiatives").insert({ org_id: orgId, lane: "ship", scope: "product", lifecycle: "plan", stage: "active", build_state: "scoped", priority: "high", title: form.title.trim(), kind: form.kind });
    if (error) { setError(error.message); return; }
    setAdding(false); setForm({ title: "", kind: "feature" }); load();
  }

  const briefItem = items.find((i) => i.id === briefId) ?? null;
  const briefText = briefItem ? buildAgentBrief({
    title: briefItem.title, kind: briefItem.kind, releaseLabel: relLabel(briefItem.release_id),
    fields: new Map(fields.filter((f) => f.initiative_id === briefItem.id).map((f) => [f.field_key, (f.value ?? "").trim()])),
    links: links.filter((l) => l.initiative_id === briefItem.id),
  }) : "";

  return (
    <div>
      <PageHeader
        title="Ship"
        meta="The build (product) workflow. Each card sits in the stage its real work puts it in — open one to do that stage's work."
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
          <div className="t-sub" style={{ maxWidth: 480, marginInline: "auto" }}>Build Items arrive from <a href="/strategy" style={{ color: "var(--ac-text)", fontWeight: 600 }}>Product strategy</a> — or create one here. Each is a product feature, module, enhancement, or fix.</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--sp-4)", alignItems: "start" }}>
          {BUILD_STAGES.map((st) => {
            const col = items.filter((it) => derived.get(it.id)!.stage === st.key);
            return (
              <div key={st.key}>
                <div className="t-label" style={{ marginBottom: 2 }}>{st.label} · {col.length}</div>
                <div className="t-sub t-muted" style={{ fontSize: 11, marginBottom: "var(--sp-3)" }}>{st.blurb}</div>
                <div className="stack-3">
                  {col.length === 0 && <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>—</div>}
                  {col.map((it) => {
                    const d = derived.get(it.id)!;
                    return (
                      <div key={it.id} className="card card-pad" style={{ borderLeft: "3px solid var(--ac)" }}>
                        <div className="row gap-2" style={{ marginBottom: 6, flexWrap: "wrap" }}>
                          {it.kind && <Chip>{BUILD_KIND_LABEL[it.kind] ?? it.kind}</Chip>}
                          {relLabel(it.release_id) && <Chip tone="violet">{relLabel(it.release_id)}</Chip>}
                        </div>
                        <a href={`/initiatives/${it.id}?from=ship`} title="Open the Build Item" style={{ display: "block", fontSize: 13.5, fontWeight: 640, marginBottom: 8, color: "var(--tp)", textDecoration: "none" }} onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")} onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}>{it.title}</a>

                        <div className="row-between" style={{ fontSize: 11, color: "var(--tm)", marginBottom: 3 }}><span>Scope</span><span>{d.scopePct}%</span></div>
                        <div style={{ height: 4, borderRadius: 999, background: "var(--fill-2)", marginBottom: 8, overflow: "hidden" }}>
                          <div style={{ width: `${d.scopePct}%`, height: "100%", background: d.scopePct === 100 ? "var(--gn)" : "var(--ac)" }} />
                        </div>
                        {st.key !== "shipped" && <div style={{ fontSize: 11.5, fontWeight: 700, color: d.ready ? "var(--gn-text)" : "var(--tm)", marginBottom: 8 }}>{d.ready ? "✓ Agent-ready" : `Readiness ${d.readyN}/4`}</div>}

                        <div className="row gap-2" style={{ alignItems: "center" }}>
                          {(d.stage === "ready_for_agent" || d.stage === "in_build") && <button className="btn btn-sm" title="Assemble the coding-agent handoff" onClick={() => { setBriefId(it.id); setCopied(false); }}>Agent brief</button>}
                          {d.stage === "in_build" && <button className="btn btn-secondary btn-sm" title="Mark the build shipped" onClick={() => markShipped(it)}>Mark shipped</button>}
                          <div style={{ flex: 1 }} />
                          <button className="btn btn-secondary btn-sm" title="Delete this Build Item" onClick={() => setDelId(it.id)} style={{ color: "var(--rd-text)" }}>✕</button>
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
          <span className="t-sub t-muted" style={{ fontSize: 12.5 }}>The executable handoff: scope, acceptance criteria, and the context bundle.</span>
          <button className="btn btn-sm" onClick={() => { navigator.clipboard?.writeText(briefText); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>{copied ? "Copied ✓" : "Copy"}</button>
        </div>
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 12.5, lineHeight: 1.55, background: "var(--fill-2)", border: "1px solid var(--border)", borderRadius: 8, padding: 14, maxHeight: "55vh", overflowY: "auto", fontFamily: "var(--mono, monospace)" }}>{briefText}</pre>
      </Modal>

      {delId && (
        <ConfirmDialog
          title="Delete Build Item?"
          message="This removes the Build Item and its scope, tasks, and context bundle. This can't be undone."
          confirmLabel="Delete"
          onConfirm={async () => { const id = delId; setDelId(null); setError(null); const { error } = await supabase.from("initiatives").delete().eq("id", id); if (error) setError(error.message); await load(); }}
          onCancel={() => setDelId(null)}
        />
      )}
    </div>
  );
}
