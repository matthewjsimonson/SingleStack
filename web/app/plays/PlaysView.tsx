"use client";

// Plays — the JOB layer config surface (Phase 2). Plays render as in-page tabs.
// Each play: a description, one or more attached AGENTS, and play-specific SKILLS
// layered on top of each agent's cornerstone skills (scoped to this play only).
// Author new plays from scratch. No placement/execution yet (Phases 3–4).
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { ensureBuiltInPlays } from "@/lib/ensurePlays";
import { Section, Chip, Banner, Empty, AgentBadge } from "@/components/ui";
import { SURFACES, placementStatus } from "@/lib/surfaces";

type Agent = { id: string; key: string; name: string };
type Skill = { id: string; name: string; description: string | null; category: string | null; instructions: string | null };
type Play = { id: string; key: string; label: string; description: string | null; focus: string | null; target_type: string | null };
type PA = { play_id: string; agent_id: string };
type PS = { id: string; play_id: string; agent_id: string; skill_id: string | null; name: string | null; instructions: string | null };
type Placement = { play_id: string; surface_key: string };

// The built-in analyses are plays too — seed them so this surface is the single
// home for every play (authored + built-in). Built-ins are seeded by
// ensureBuiltInPlays; run-play reads the same rows.

export default function PlaysView() {
  const supabase = createClient();
  const [plays, setPlays] = useState<Play[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [playAgents, setPlayAgents] = useState<PA[]>([]);
  const [playSkills, setPlaySkills] = useState<PS[]>([]);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [cornerstones, setCornerstones] = useState<Record<string, Set<string>>>({}); // agent_id → cornerstone skill_ids
  const [active, setActive] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authoring, setAuthoring] = useState(false);
  const [form, setForm] = useState({ label: "", focus: "", description: "" });
  const [descEdit, setDescEdit] = useState<string | null>(null); // play id whose description is being edited
  const [descDraft, setDescDraft] = useState("");
  const [focusEdit, setFocusEdit] = useState<string | null>(null); // play id whose focus is being edited
  const [focusDraft, setFocusDraft] = useState("");
  // bespoke play-skill authoring/editing (per play_skills row)
  const [addingSkillFor, setAddingSkillFor] = useState<string | null>(null); // agent id we're adding a skill onto
  const [newSkill, setNewSkill] = useState({ name: "", instructions: "" });
  const [editSkill, setEditSkill] = useState<string | null>(null); // play_skills row id being edited
  const [skillDraft, setSkillDraft] = useState({ name: "", instructions: "" });

  const load = useCallback(async () => {
    await ensureBuiltInPlays(supabase); // seed built-in plays (+ competitor placements) once
    const [{ data: pl }, { data: ag }, { data: sk }, { data: pa }, { data: ps }, { data: as }, { data: pp }] = await Promise.all([
      supabase.from("plays").select("id, key, label, description, focus, target_type").order("created_at"),
      supabase.from("agents").select("id, key, name").eq("is_active", true).order("name"),
      supabase.from("skills").select("id, name, description, category, instructions").order("name"),
      supabase.from("play_agents").select("play_id, agent_id"),
      supabase.from("play_skills").select("id, play_id, agent_id, skill_id, name, instructions"),
      supabase.from("agent_skills").select("agent_id, skill_id, is_cornerstone"),
      supabase.from("play_placements").select("play_id, surface_key"),
    ]);
    setPlays(pl ?? []); setPlayAgents(pa ?? []); setPlacements(pp ?? []);
    setAgents(ag ?? []); setSkills(sk ?? []); setPlaySkills(ps ?? []);
    const corner: Record<string, Set<string>> = {};
    for (const r of as ?? []) if (r.is_cornerstone) (corner[r.agent_id] ??= new Set()).add(r.skill_id);
    setCornerstones(corner);
    setActive((cur) => (cur && (pl ?? []).some((p) => p.id === cur) ? cur : ((pl ?? [])[0]?.id ?? null)));
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const skillById = (id: string) => skills.find((s) => s.id === id);
  const agentById = (id: string) => agents.find((a) => a.id === id);
  const activePlay = plays.find((p) => p.id === active) ?? null;
  const agentsOn = (playId: string) => playAgents.filter((r) => r.play_id === playId).map((r) => agentById(r.agent_id)).filter(Boolean) as Agent[];

  async function authorPlay(e: React.FormEvent) {
    e.preventDefault(); if (!form.label.trim()) return;
    setError(null);
    const orgId = await getOrgId(); if (!orgId) { setError("Couldn't resolve your organization."); return; }
    const key = form.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `play_${Date.now()}`;
    const desc = form.description.trim();
    // focus is the analytical INSTRUCTION the officer runs on — the highest-
    // leverage knob (NOT NULL). Take it from the author; fall back to the
    // description, then a sensible default so the play still runs.
    const focus = form.focus.trim() || desc || `Run the "${form.label.trim()}" play and report what matters, grounded in the provided context.`;
    const { data, error } = await supabase.from("plays").insert({ org_id: orgId, key, label: form.label.trim(), description: desc || null, focus, target_type: "custom" }).select("id").single();
    if (error) { setError(error.message); return; }
    setAuthoring(false); setForm({ label: "", focus: "", description: "" });
    await load(); if (data) setActive(data.id);
  }

  async function attachAgent(playId: string, agentId: string) {
    if (!agentId) return;
    setError(null);
    const orgId = await getOrgId();
    const { error } = await supabase.from("play_agents").insert({ org_id: orgId, play_id: playId, agent_id: agentId });
    if (error && (error as { code?: string }).code !== "23505") setError(error.message);
    await load();
  }
  async function detachAgent(playId: string, agentId: string) {
    setError(null);
    await supabase.from("play_skills").delete().eq("play_id", playId).eq("agent_id", agentId);
    await supabase.from("play_agents").delete().eq("play_id", playId).eq("agent_id", agentId);
    await load();
  }
  // Bespoke play skills: authored inline for one (play, agent). Never touch the
  // shared skills library.
  function startAddSkill(agentId: string) { setAddingSkillFor(agentId); setNewSkill({ name: "", instructions: "" }); setEditSkill(null); }
  async function createPlaySkill(playId: string, agentId: string) {
    if (!newSkill.name.trim() && !newSkill.instructions.trim()) return;
    setError(null);
    const orgId = await getOrgId();
    const { error } = await supabase.from("play_skills").insert({ org_id: orgId, play_id: playId, agent_id: agentId, name: newSkill.name.trim() || "Play skill", instructions: newSkill.instructions.trim() || null });
    if (error) setError(error.message); else { setAddingSkillFor(null); await load(); }
  }
  function startEditSkill(r: PS) { setEditSkill(r.id); setSkillDraft({ name: r.name ?? "", instructions: r.instructions ?? "" }); setAddingSkillFor(null); }
  async function savePlaySkill(id: string) {
    setError(null);
    const { error } = await supabase.from("play_skills").update({ name: skillDraft.name.trim() || "Play skill", instructions: skillDraft.instructions.trim() || null }).eq("id", id);
    if (error) setError(error.message); else { setEditSkill(null); await load(); }
  }
  async function removePlaySkill(id: string) { setError(null); await supabase.from("play_skills").delete().eq("id", id); await load(); }

  async function place(playId: string, surfaceKey: string) {
    setError(null);
    const orgId = await getOrgId();
    const { error } = await supabase.from("play_placements").insert({ org_id: orgId, play_id: playId, surface_key: surfaceKey });
    if (error && (error as { code?: string }).code !== "23505") setError(error.message);
    await load();
  }
  async function unplace(playId: string, surfaceKey: string) {
    setError(null);
    await supabase.from("play_placements").delete().eq("play_id", playId).eq("surface_key", surfaceKey);
    await load();
  }

  async function saveDesc(playId: string) {
    setError(null);
    await supabase.from("plays").update({ description: descDraft.trim() || null }).eq("id", playId);
    setDescEdit(null); await load();
  }
  async function saveFocus(playId: string) {
    setError(null);
    const focus = focusDraft.trim();
    if (!focus) { setError("The instruction can't be empty — it's what the officer runs on."); return; }
    const { error } = await supabase.from("plays").update({ focus }).eq("id", playId);
    if (error) setError(error.message); else { setFocusEdit(null); await load(); }
  }

  return (
    <div>
      <div className="row-between" style={{ marginBottom: "var(--sp-4)", alignItems: "center" }}>
        <div className="t-sub t-muted" style={{ fontSize: 12.5, maxWidth: 640 }}>A play is a job: a description, the agents that run it, and play-specific skills layered on top of each agent&rsquo;s cornerstones (scoped to this play).</div>
        {!authoring && <button className="btn btn-sm" onClick={() => setAuthoring(true)}>+ New play</button>}
      </div>
      <Banner>{error}</Banner>

      {authoring && (
        <form onSubmit={authorPlay} className="card card-pad" style={{ marginBottom: "var(--sp-4)" }}>
          <label className="field"><span className="t-label">Play name</span><input className="input" autoFocus value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Launch readiness review" /></label>
          <label className="field"><span className="t-label">Instruction — what the officer should do</span><textarea className="textarea" rows={4} value={form.focus} onChange={(e) => setForm({ ...form, focus: e.target.value })} placeholder="The analytical instruction this play runs on — be specific about the job, the lens, and what a great output contains. This is the biggest lever on quality." /></label>
          <label className="field"><span className="t-label">Summary <span className="t-muted" style={{ fontWeight: 400 }}>(optional)</span></span><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="A short line for the play list." /></label>
          <div className="row gap-2"><button className="btn btn-sm" type="submit">Create play</button><button className="btn btn-secondary btn-sm" type="button" onClick={() => setAuthoring(false)}>Cancel</button></div>
        </form>
      )}

      {plays.length === 0 ? (
        <Empty title="No plays yet" hint="A play deploys agents on a job — author one to attach agents and layer play-specific skills." action={<button className="btn" onClick={() => setAuthoring(true)}>+ New play</button>} />
      ) : (
        <>
          {/* plays-as-tabs (in-page) */}
          <div className="row gap-2" style={{ marginBottom: "var(--sp-5)", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
            {plays.map((p) => (
              <button key={p.id} onClick={() => setActive(p.id)}
                style={{ background: "none", border: "none", borderBottom: active === p.id ? "2px solid var(--ac)" : "2px solid transparent", color: active === p.id ? "var(--tp)" : "var(--ts)", fontWeight: active === p.id ? 680 : 600, fontSize: 13.5, padding: "8px 12px", cursor: "pointer", marginBottom: -1, whiteSpace: "nowrap" }}>
                {p.label}
              </button>
            ))}
          </div>

          {activePlay && (
            <div className="stack-3">
              {/* focus — the instruction the officer runs on (the #1 quality lever) */}
              <div className="card card-pad" style={{ borderColor: "var(--ac)" }}>
                <div className="row-between" style={{ marginBottom: focusEdit === activePlay.id ? 8 : 6 }}>
                  <span className="t-label" style={{ color: "var(--ac)" }}>Instruction — what the officer does</span>
                  {focusEdit !== activePlay.id && <button className="btn btn-secondary btn-sm" onClick={() => { setFocusEdit(activePlay.id); setFocusDraft(activePlay.focus ?? ""); }}>Edit</button>}
                </div>
                {focusEdit === activePlay.id ? (
                  <>
                    <textarea className="textarea" rows={5} autoFocus value={focusDraft} onChange={(e) => setFocusDraft(e.target.value)} placeholder="The analytical instruction this play runs on — the job, the lens, and what a great output contains." style={{ marginBottom: 8 }} />
                    <div className="row gap-2"><button className="btn btn-sm" onClick={() => saveFocus(activePlay.id)}>Save</button><button className="btn btn-secondary btn-sm" onClick={() => setFocusEdit(null)}>Cancel</button></div>
                  </>
                ) : (
                  <div className="t-body" style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{activePlay.focus || <span className="t-muted">No instruction yet — this is the biggest lever on output quality.</span>}</div>
                )}
              </div>

              {/* summary */}
              <div className="card card-pad">
                <div className="row-between" style={{ marginBottom: descEdit === activePlay.id ? 8 : 0 }}>
                  <span className="t-label" style={{ color: "var(--tm)" }}>Summary</span>
                  {descEdit !== activePlay.id && <button className="btn btn-secondary btn-sm" onClick={() => { setDescEdit(activePlay.id); setDescDraft(activePlay.description ?? ""); }}>Edit</button>}
                </div>
                {descEdit === activePlay.id ? (
                  <>
                    <textarea className="textarea" rows={2} autoFocus value={descDraft} onChange={(e) => setDescDraft(e.target.value)} style={{ marginBottom: 8 }} />
                    <div className="row gap-2"><button className="btn btn-sm" onClick={() => saveDesc(activePlay.id)}>Save</button><button className="btn btn-secondary btn-sm" onClick={() => setDescEdit(null)}>Cancel</button></div>
                  </>
                ) : (
                  <div className="t-body" style={{ fontSize: 13, lineHeight: 1.6 }}>{activePlay.description || <span className="t-muted">No description yet.</span>}</div>
                )}
              </div>

              {/* agents on this play + their layered skills */}
              <Section label="Agents on this play">
                <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 10 }}>Each agent runs with its cornerstone skills plus the play-specific skills you layer on below (scoped to this play).</div>
                {agentsOn(activePlay.id).length === 0 && <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 10 }}>No agents attached yet.</div>}
                <div className="stack-3">
                  {agentsOn(activePlay.id).map((ag) => {
                    const corner = [...(cornerstones[ag.id] ?? new Set())].map((id) => skillById(id)).filter(Boolean) as Skill[];
                    const layered = playSkills.filter((r) => r.play_id === activePlay.id && r.agent_id === ag.id);
                    return (
                      <div key={ag.id} className="card card-pad">
                        <div className="row-between" style={{ marginBottom: 8 }}>
                          <AgentBadge name={ag.name} />
                          <button className="btn btn-secondary btn-sm" onClick={() => detachAgent(activePlay.id, ag.id)} style={{ color: "var(--rd-text)" }}>Detach</button>
                        </div>
                        {/* cornerstone skills (read-only here) */}
                        <div className="t-label" style={{ color: "var(--tm)", fontSize: 10.5, marginBottom: 4 }}>Cornerstone skills</div>
                        <div className="row gap-2" style={{ flexWrap: "wrap", marginBottom: 10 }}>
                          {corner.length ? corner.map((s) => <Chip key={s.id} tone="accent">{s.name}</Chip>) : <span className="t-sub t-muted" style={{ fontSize: 12 }}>none set on this agent</span>}
                        </div>
                        {/* play-specific skills — bespoke instructions, authored for THIS (play, agent) */}
                        <div className="t-label" style={{ color: "var(--tm)", fontSize: 10.5, marginBottom: 4 }}>Play-specific skills <span className="t-muted" style={{ fontWeight: 400 }}>— bespoke to this play, not from the library</span></div>
                        <div className="stack-3">
                          {layered.map((r) => {
                            const open = editSkill === r.id;
                            return (
                              <div key={r.id} className="card card-pad" style={{ padding: "10px 12px", background: "var(--panel-2)" }}>
                                {open ? (
                                  <div className="stack-2">
                                    <input className="input" value={skillDraft.name} placeholder="Skill name" onChange={(e) => setSkillDraft({ ...skillDraft, name: e.target.value })} />
                                    <textarea className="textarea" rows={5} value={skillDraft.instructions} placeholder="The bespoke instruction — how this agent applies this skill in this play." onChange={(e) => setSkillDraft({ ...skillDraft, instructions: e.target.value })} />
                                    <div className="row gap-2"><button className="btn btn-sm" onClick={() => savePlaySkill(r.id)}>Save</button><button className="btn btn-secondary btn-sm" onClick={() => setEditSkill(null)}>Cancel</button></div>
                                  </div>
                                ) : (
                                  <>
                                    <div className="row-between" style={{ gap: 10 }}>
                                      <div className="row gap-2" style={{ flexWrap: "wrap" }}>
                                        <span style={{ fontSize: 13.5, fontWeight: 620 }}>{r.name || "Play skill"}</span>
                                        <Chip tone="violet">Play: {activePlay.label}</Chip>
                                      </div>
                                      <div className="row gap-2">
                                        <button className="btn btn-secondary btn-sm" onClick={() => startEditSkill(r)}>Edit</button>
                                        <button className="btn btn-secondary btn-sm" onClick={() => removePlaySkill(r.id)} style={{ color: "var(--rd-text)" }}>Remove</button>
                                      </div>
                                    </div>
                                    {r.instructions && <div className="t-sub" style={{ fontSize: 12.5, lineHeight: 1.55, whiteSpace: "pre-wrap", marginTop: 6 }}>{r.instructions}</div>}
                                  </>
                                )}
                              </div>
                            );
                          })}
                          {layered.length === 0 && <div className="t-sub t-muted" style={{ fontSize: 12 }}>No play-specific skills yet.</div>}
                          {addingSkillFor === ag.id ? (
                            <div className="card card-pad stack-2" style={{ background: "var(--panel-2)" }}>
                              <input className="input" autoFocus value={newSkill.name} placeholder="Skill name (e.g. 'Positioning teardown')" onChange={(e) => setNewSkill({ ...newSkill, name: e.target.value })} />
                              <textarea className="textarea" rows={5} value={newSkill.instructions} placeholder="The bespoke instruction — how this agent applies this skill in this play." onChange={(e) => setNewSkill({ ...newSkill, instructions: e.target.value })} />
                              <div className="row gap-2"><button className="btn btn-sm" onClick={() => createPlaySkill(activePlay.id, ag.id)}>Add skill</button><button className="btn btn-secondary btn-sm" onClick={() => setAddingSkillFor(null)}>Cancel</button></div>
                            </div>
                          ) : (
                            <button className="btn btn-secondary btn-sm" onClick={() => startAddSkill(ag.id)}>+ Add a play-specific skill</button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {/* attach an agent */}
                {(() => {
                  const onIds = new Set(agentsOn(activePlay.id).map((a) => a.id));
                  const available = agents.filter((a) => !onIds.has(a.id));
                  if (available.length === 0) return null;
                  return (
                    <select className="select" defaultValue="" onChange={(e) => { attachAgent(activePlay.id, e.target.value); e.target.value = ""; }} style={{ maxWidth: 320, marginTop: 12 }}>
                      <option value="">+ Attach an agent…</option>
                      {available.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  );
                })()}
              </Section>

              {/* Placement — where this play lives, with suggestions + guardrails */}
              <Section label="Placement">
                <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 10 }}>Where this play appears in the product. <strong>Suggested</strong> surfaces match what the play needs; guardrails block surfaces that can&rsquo;t provide its context.</div>
                {[...new Set(SURFACES.map((s) => s.module))].map((mod) => (
                  <div key={mod} style={{ marginBottom: "var(--sp-3)" }}>
                    <div className="t-label" style={{ color: "var(--tm)", marginBottom: 6 }}>{mod}</div>
                    <div className="stack-3">
                      {SURFACES.filter((s) => s.module === mod).map((surf) => {
                        const placed = placements.some((r) => r.play_id === activePlay.id && r.surface_key === surf.key);
                        const { state, reason } = placementStatus(activePlay.target_type, surf);
                        return (
                          <div key={surf.key} className="card card-pad row-between" style={{ gap: 12, opacity: state === "blocked" && !placed ? 0.6 : 1 }}>
                            <div style={{ minWidth: 0 }}>
                              <div className="row gap-2" style={{ flexWrap: "wrap", alignItems: "center" }}>
                                <span style={{ fontSize: 14, fontWeight: 620 }}>{surf.label}</span>
                                {state === "suggested" && <Chip tone="green">Suggested</Chip>}
                                {state === "blocked" && <Chip tone="amber">Blocked</Chip>}
                                {placed && <Chip tone="accent">Placed</Chip>}
                              </div>
                              <div className="t-sub t-muted" style={{ fontSize: 12.5, marginTop: 2 }}>{surf.description}{state === "blocked" ? ` — ${reason}` : ""}</div>
                            </div>
                            {placed
                              ? <button className="btn btn-secondary btn-sm" onClick={() => unplace(activePlay.id, surf.key)} style={{ color: "var(--rd-text)", flexShrink: 0 }}>Remove</button>
                              : <button className="btn btn-sm" disabled={state === "blocked"} onClick={() => place(activePlay.id, surf.key)} style={{ flexShrink: 0, ...(state === "suggested" ? { background: "var(--gn)", color: "#fff" } : {}) }}>{state === "blocked" ? "Blocked" : "Place"}</button>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </Section>
            </div>
          )}
        </>
      )}
    </div>
  );
}
