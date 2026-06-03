"use client";

// GTM workflow — the go-to-market side of an initiative, parallel to the build
// workflow. Stages derive from real work (deriveGtmStage): Brief → In production
// → Launched. Each stage does its own job:
//   Brief         → the launch message + linked GTM record (messaging)
//   In production → the content/campaign tasks being produced
//   Launched      → what's published
// Used inside the cockpit for items with GTM scope, and mirrored by the
// Enablement board.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Chip, Banner, SubTabs } from "@/components/ui";
import { GTM_STAGES, deriveGtmStage } from "@/lib/buildStage";

type Task = { id: string; title: string; stage: string; content_type: string | null; campaign_id: string | null };

const CONTENT_TYPES: [string, string][] = [["blog", "Blog"], ["social", "Social"], ["video", "Video"], ["thought_leadership", "Thought leadership"], ["case_study", "Case study"], ["white_paper", "White paper"], ["testimonial", "Testimonial"]];
const CONTENT_LABEL: Record<string, string> = Object.fromEntries(CONTENT_TYPES);
const TASK_NEXT: Record<string, string> = { backlog: "active", active: "done" };

export default function GtmWorkflow({ initiativeId, gtmRecordId }: { initiativeId: string; gtmRecordId: string | null }) {
  const supabase = createClient();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [brief, setBrief] = useState<{ id: string; value: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("brief");
  const pinned = useState({ v: false })[0];
  const [editingBrief, setEditingBrief] = useState(false);
  const [draft, setDraft] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState("blog");

  const load = useCallback(async () => {
    const [{ data: w }, { data: f }] = await Promise.all([
      supabase.from("initiative_workstreams").select("id, title, stage, content_type, campaign_id").eq("initiative_id", initiativeId).eq("area", "gtm").order("created_at"),
      supabase.from("initiative_fields").select("id, value").eq("initiative_id", initiativeId).eq("field_key", "gtm_brief").maybeSingle(),
    ]);
    setTasks((w ?? []) as Task[]); setBrief((f ?? null) as { id: string; value: string | null } | null); setLoading(false);
  }, [supabase, initiativeId]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="t-sub t-muted">Loading GTM…</div>;
  const stage = deriveGtmStage(tasks);
  if (!pinned.v) { pinned.v = true; setTab(stage); }

  async function saveBrief() {
    setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const { error } = await supabase.from("initiative_fields").upsert(
        { org_id: orgId, initiative_id: initiativeId, field_key: "gtm_brief", label: "GTM brief", section: "GTM", value: draft },
        { onConflict: "initiative_id,field_key" });
      if (error) throw error; setEditingBrief(false); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save the brief."); }
  }
  async function patch(t: Task, st: string) {
    setError(null);
    const { error } = await supabase.from("initiative_workstreams").update({ stage: st }).eq("id", t.id);
    if (error) { setError(error.message); return; } await load();
  }
  async function addTask() {
    if (!newTitle.trim()) return; setError(null);
    const orgId = await getOrgId(); if (!orgId) { setError("Could not resolve your organization."); return; }
    const { error } = await supabase.from("initiative_workstreams").insert({ org_id: orgId, initiative_id: initiativeId, area: "gtm", lifecycle_stage: "launch", title: newTitle.trim(), content_type: newType, stage: "backlog" });
    if (error) { setError(error.message); return; } setNewTitle(""); await load();
  }

  const done = tasks.filter((t) => t.stage === "done");

  return (
    <div>
      <Banner>{error}</Banner>
      <SubTabs tabs={GTM_STAGES.map((s) => ({ key: s.key, label: s.label }))} active={tab} onChange={setTab} />

      {tab === "brief" && (
        <div>
          <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: "var(--sp-3)" }}>The launch message, audience, and channels — and the messaging record it draws on.</div>
          <div className="card card-pad" style={{ marginBottom: "var(--sp-4)" }}>
            <div className="row-between" style={{ marginBottom: 6 }}>
              <span className="t-h2" style={{ fontSize: 13, fontWeight: 620 }}>GTM brief</span>
              {!editingBrief && <button className="btn btn-secondary btn-sm" onClick={() => { setEditingBrief(true); setDraft(brief?.value ?? ""); }}>{brief?.value ? "Edit" : "Add"}</button>}
            </div>
            {editingBrief ? (
              <div>
                <textarea className="textarea" rows={4} autoFocus value={draft} placeholder="Who we're talking to, the core message, and the channels we'll use." onChange={(e) => setDraft(e.target.value)} style={{ marginBottom: 8 }} />
                <div className="row gap-2"><button className="btn btn-sm" onClick={saveBrief}>Save</button><button className="btn btn-secondary btn-sm" onClick={() => setEditingBrief(false)}>Cancel</button></div>
              </div>
            ) : brief?.value ? <div className="t-body" style={{ lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{brief.value}</div>
              : <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Define who we&apos;re talking to, the core message, and the channels.</div>}
          </div>
          {gtmRecordId
            ? <a href={`/gtm/${gtmRecordId}`} className="btn btn-secondary btn-sm">Open the messaging record →</a>
            : <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No messaging record linked. Positioning &amp; value props live in the GTM area.</div>}
        </div>
      )}

      {(tab === "in_production" || tab === "launched") && (
        <div>
          <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: "var(--sp-3)" }}>{tab === "launched" ? "What's published and in market." : "The content and campaign assets being produced."}</div>
          {tab === "launched" ? (
            <div className="card" style={{ overflow: "hidden" }}>
              {done.length === 0 && <div style={{ padding: "14px 18px" }} className="t-sub t-muted">Nothing published yet.</div>}
              {done.map((t, i) => (
                <div key={t.id} className="row-between" style={{ padding: "10px 16px", borderTop: i === 0 ? "none" : "1px solid var(--border)", alignItems: "center" }}>
                  <span className="row gap-2"><Chip tone="violet">{CONTENT_LABEL[t.content_type ?? ""] ?? "Content"}</Chip><span style={{ fontSize: 13.5, fontWeight: 600 }}>{t.title}</span></span>
                  <Chip tone="green">Launched</Chip>
                </div>
              ))}
            </div>
          ) : (
            <div className="card" style={{ overflow: "hidden" }}>
              {tasks.length === 0 && <div style={{ padding: "14px 18px" }} className="t-sub t-muted">No content yet. Add the first asset below.</div>}
              {tasks.map((t, i) => (
                <div key={t.id} className="row-between" style={{ padding: "10px 16px", borderTop: i === 0 ? "none" : "1px solid var(--border)", alignItems: "center", gap: 8 }}>
                  <div className="row gap-2" style={{ minWidth: 0, alignItems: "center" }}>
                    <Chip tone="violet">{CONTENT_LABEL[t.content_type ?? ""] ?? "Content"}</Chip>
                    <span style={{ fontSize: 13.5, fontWeight: 600, textDecoration: t.stage === "done" ? "line-through" : "none", color: t.stage === "done" ? "var(--tm)" : "var(--tp)" }}>{t.title}</span>
                  </div>
                  <div className="row gap-2" style={{ flexShrink: 0 }}>
                    <Chip tone={(t.stage === "done" ? "green" : t.stage === "active" ? "amber" : "default") as "green" | "amber" | "default"}>{t.stage === "backlog" ? "To do" : t.stage === "active" ? "In progress" : "Done"}</Chip>
                    {TASK_NEXT[t.stage] && <button className="btn btn-secondary btn-sm" onClick={() => patch(t, TASK_NEXT[t.stage])}>{t.stage === "backlog" ? "Start" : "Publish"} →</button>}
                    {t.stage === "done" && <button className="btn btn-secondary btn-sm" onClick={() => patch(t, "active")}>Reopen</button>}
                  </div>
                </div>
              ))}
              <div className="row gap-2" style={{ padding: "10px 16px", borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
                <select className="select" value={newType} onChange={(e) => setNewType(e.target.value)} style={{ flex: "0 0 150px" }}>{CONTENT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                <input className="input" placeholder="Add a content asset…" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addTask(); }} style={{ flex: 1, borderColor: "var(--vl)" }} />
                <button className="btn btn-sm" onClick={addTask}>Add</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
