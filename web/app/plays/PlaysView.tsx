"use client";

// Plays — the JOB layer config surface. The landing is a GALLERY of plays (tiles);
// opening one drops into a stepped setup workflow:
//   1 Define  — name + the instruction (focus) the officer runs on.
//   2 Agents  — the agent(s) that run it (a chain; each adds a lens, in order).
//   3 Skills  — bespoke play-specific instructions layered onto a specific agent.
//   4 Place   — where the play appears across the product.
// New plays are GUIDED (each step gates the next so setup is complete); an existing
// play is free to navigate (editing shouldn't force a walk). The built-in analyses
// are plays too (seeded by ensureBuiltInPlays); run-play reads the same rows.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { ensureBuiltInPlays } from "@/lib/ensurePlays";
import { ensureTeam } from "@/lib/ensureTeam";
import { Section, Chip, Banner, Empty, AgentBadge } from "@/components/ui";
import { SURFACES, placementStatus } from "@/lib/surfaces";

type Agent = { id: string; key: string; name: string };
type Skill = { id: string; name: string; description: string | null; category: string | null; instructions: string | null };
type Play = { id: string; key: string; label: string; description: string | null; focus: string | null; target_type: string | null };
type PA = { id: string; play_id: string; agent_id: string; position: number };
type PS = { id: string; play_id: string; agent_id: string; skill_id: string | null; name: string | null; instructions: string | null };
type Placement = { play_id: string; surface_key: string };

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
  const [creating, setCreating] = useState(false); // in the new-play wizard (no play id yet)
  const [step, setStep] = useState(0);              // 0 Define · 1 Agents · 2 Skills · 3 Place
  const [guided, setGuided] = useState(false);      // gate steps (new-play setup) vs free nav (editing)
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ label: "", focus: "", description: "" });
  const [descEdit, setDescEdit] = useState<string | null>(null);
  const [descDraft, setDescDraft] = useState("");
  const [focusEdit, setFocusEdit] = useState<string | null>(null);
  const [focusDraft, setFocusDraft] = useState("");
  // bespoke play-skill authoring/editing (per play_skills row)
  const [addingSkillFor, setAddingSkillFor] = useState<string | null>(null);
  const [newSkill, setNewSkill] = useState({ name: "", instructions: "" });
  const [editSkill, setEditSkill] = useState<string | null>(null);
  const [skillDraft, setSkillDraft] = useState({ name: "", instructions: "" });
  const [dragId, setDragId] = useState<string | null>(null); // play_agent row being dragged (chain reorder)

  const load = useCallback(async () => {
    await ensureTeam(supabase);        // the roster must exist before you can chain officers
    await ensureBuiltInPlays(supabase);
    const [{ data: pl }, { data: ag }, { data: sk }, { data: pa }, { data: ps }, { data: as }, { data: pp }] = await Promise.all([
      supabase.from("plays").select("id, key, label, description, focus, target_type").order("created_at"),
      supabase.from("agents").select("id, key, name").eq("is_active", true).order("name"),
      supabase.from("skills").select("id, name, description, category, instructions").order("name"),
      supabase.from("play_agents").select("id, play_id, agent_id, position").order("position"),
      supabase.from("play_skills").select("id, play_id, agent_id, skill_id, name, instructions"),
      supabase.from("agent_skills").select("agent_id, skill_id, is_cornerstone"),
      supabase.from("play_placements").select("play_id, surface_key"),
    ]);
    setPlays(pl ?? []); setPlayAgents(pa ?? []); setPlacements(pp ?? []);
    setAgents(ag ?? []); setSkills(sk ?? []); setPlaySkills(ps ?? []);
    const corner: Record<string, Set<string>> = {};
    for (const r of as ?? []) if (r.is_cornerstone) (corner[r.agent_id] ??= new Set()).add(r.skill_id);
    setCornerstones(corner);
    // The landing is the gallery — keep a selection only if it still exists.
    setActive((cur) => (cur && (pl ?? []).some((p) => p.id === cur) ? cur : null));
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
    const focus = form.focus.trim() || desc || `Run the "${form.label.trim()}" play and report what matters, grounded in the provided context.`;
    const { data, error } = await supabase.from("plays").insert({ org_id: orgId, key, label: form.label.trim(), description: desc || null, focus, target_type: "custom" }).select("id").single();
    if (error) { setError(error.message); return; }
    setForm({ label: "", focus: "", description: "" });
    await load();
    if (data) { setActive(data.id); setCreating(false); setGuided(true); setStep(1); } // continue the guided setup
  }

  async function attachAgent(playId: string, agentId: string) {
    if (!agentId) return;
    setError(null);
    const orgId = await getOrgId();
    const position = playAgents.filter((r) => r.play_id === playId).length; // chain order = attach order
    const { error } = await supabase.from("play_agents").insert({ org_id: orgId, play_id: playId, agent_id: agentId, position });
    if (error && (error as { code?: string }).code !== "23505") setError(error.message);
    await load();
  }
  async function detachAgent(playId: string, agentId: string) {
    setError(null);
    await supabase.from("play_skills").delete().eq("play_id", playId).eq("agent_id", agentId);
    await supabase.from("play_agents").delete().eq("play_id", playId).eq("agent_id", agentId);
    await load();
  }
  // Reorder the chain (drag a row onto another). Persists each row's position so
  // run-play executes officers in the new order.
  async function reorderChain(playId: string, dragRowId: string, dropRowId: string) {
    const rows = playAgents.filter((r) => r.play_id === playId).slice().sort((a, b) => a.position - b.position);
    const from = rows.findIndex((r) => r.id === dragRowId);
    const to = rows.findIndex((r) => r.id === dropRowId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...rows]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved);
    const repositioned = next.map((r, i) => ({ id: r.id, position: i }));
    setPlayAgents((prev) => prev.map((r) => { const u = repositioned.find((x) => x.id === r.id); return u ? { ...r, position: u.position } : r; })); // optimistic
    await Promise.all(repositioned.map((r) => supabase.from("play_agents").update({ position: r.position }).eq("id", r.id)));
    await load();
  }

  // Bespoke play skills — authored inline for one (play, agent). Never touch the library.
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

  // ---- navigation -----------------------------------------------------------
  function openPlay(id: string) { setActive(id); setCreating(false); setGuided(false); setStep(0); setError(null); setFocusEdit(null); setDescEdit(null); setAddingSkillFor(null); setEditSkill(null); }
  function newPlay() { setCreating(true); setActive(null); setGuided(true); setStep(0); setForm({ label: "", focus: "", description: "" }); setError(null); }
  function backToGallery() { setActive(null); setCreating(false); setGuided(false); setStep(0); setError(null); }

  // ---- workflow gating ------------------------------------------------------
  const STEPS = ["Define", "Agents", "Skills", "Place"];
  const done = {
    define: !!(activePlay?.label && activePlay?.focus),
    agents: !!activePlay && agentsOn(activePlay.id).length > 0,
    place: !!activePlay && placements.some((r) => r.play_id === activePlay.id),
  };
  const stepDone = [done.define, done.agents, true, done.place]; // Skills is optional
  // Guided: a step is reachable only once the REQUIRED prior steps are done.
  // Skills (step 2) is optional, so it never blocks Place. Free nav when editing.
  function reachable(i: number) {
    if (!guided) return true;
    if (i <= 0) return true;
    if (i === 1) return done.define;
    return done.define && done.agents; // steps 2 (skills) & 3 (place)
  }
  // Guided footer (Back / Continue / Done). Hidden when editing an existing play.
  function Footer({ i }: { i: number }) {
    if (!guided) return null;
    const canContinue = i === 0 ? done.define : i === 1 ? done.agents : true;
    return (
      <div className="row-between" style={{ marginTop: "var(--sp-4)" }}>
        <button className="btn btn-secondary btn-sm" onClick={() => setStep(Math.max(0, i - 1))} disabled={i === 0}>← Back</button>
        {i === 3
          ? <button className="btn btn-sm" onClick={backToGallery}>Done</button>
          : <button className="btn btn-sm" disabled={!canContinue} onClick={() => setStep(i + 1)} title={canContinue ? "" : "Finish this step first"}>Continue →</button>}
      </div>
    );
  }

  return (
    <div>
      <Banner>{error}</Banner>

      {active === null && !creating ? (
        /* ---------------- GALLERY ---------------- */
        <>
          <div className="row-between" style={{ marginBottom: "var(--sp-4)", alignItems: "flex-end" }}>
            <div>
              <h1 className="t-page">Plays</h1>
              <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>A play is a job: an instruction, the agents that run it, and where it lives. Open one to set it up — or add a new play.</div>
            </div>
            <button className="btn" onClick={newPlay}>+ New play</button>
          </div>
          {plays.length === 0 ? (
            <Empty title="No plays yet" hint="A play deploys agents on a job — author one to attach agents and place it across the product." action={<button className="btn" onClick={newPlay}>+ New play</button>} />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "var(--sp-4)" }}>
              {plays.map((p) => {
                const nAgents = agentsOn(p.id).length;
                const nPlaced = placements.filter((r) => r.play_id === p.id).length;
                return (
                  <button key={p.id} onClick={() => openPlay(p.id)} className="card card-link" style={{ textAlign: "left", padding: 16, display: "flex", flexDirection: "column", gap: 8, minHeight: 124 }}>
                    <span style={{ fontSize: 15, fontWeight: 660, lineHeight: 1.3 }}>{p.label}</span>
                    <span className="t-sub t-muted" style={{ fontSize: 12.5, lineHeight: 1.5, flex: 1, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.description || p.focus || "No instruction yet."}</span>
                    <div className="row gap-2" style={{ flexWrap: "wrap" }}>
                      <Chip tone={nAgents ? "accent" : "default"}>{nAgents} agent{nAgents === 1 ? "" : "s"}</Chip>
                      <Chip tone={nPlaced ? "green" : "default"}>{nPlaced} placement{nPlaced === 1 ? "" : "s"}</Chip>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </>
      ) : (
        /* ---------------- WORKSPACE (stepper) ---------------- */
        <>
          <div className="row-between" style={{ marginBottom: "var(--sp-4)", alignItems: "center" }}>
            <button className="btn btn-secondary btn-sm" onClick={backToGallery}>← All plays</button>
            <span style={{ fontSize: 15, fontWeight: 660 }}>{creating ? "New play" : activePlay?.label}</span>
            <span style={{ width: 76 }} />
          </div>

          {/* stepper box — left→right, current lit, completed checked */}
          <div className="card card-pad" style={{ marginBottom: "var(--sp-4)" }}>
            <div className="row" style={{ alignItems: "center" }}>
              {STEPS.map((label, i) => {
                const isCur = step === i;
                const isDone = !!activePlay && stepDone[i];
                const canGo = reachable(i);
                return (
                  <div key={label} className="row" style={{ alignItems: "center", flex: 1, minWidth: 0 }}>
                    <button onClick={() => canGo && setStep(i)} disabled={!canGo} className="row gap-2"
                      style={{ alignItems: "center", background: "none", border: "none", cursor: canGo ? "pointer" : "default", padding: "4px 6px", opacity: canGo ? 1 : 0.4, minWidth: 0 }}>
                      <span style={{ flexShrink: 0, width: 24, height: 24, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700,
                        background: isCur ? "var(--ac)" : isDone ? "var(--gn)" : "var(--fill-2)", color: isCur || isDone ? "#fff" : "var(--tm)", border: isCur ? "none" : "1px solid var(--border)" }}>
                        {isDone && !isCur ? "✓" : i + 1}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: isCur ? 680 : 600, color: isCur ? "var(--tp)" : "var(--ts)", whiteSpace: "nowrap" }}>{label}</span>
                    </button>
                    {i < STEPS.length - 1 && <div style={{ flex: 1, height: 1, background: "var(--border)", minWidth: 12 }} />}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ---- STEP 0 · DEFINE ---- */}
          {step === 0 && (creating ? (
            <form onSubmit={authorPlay} className="card card-pad">
              <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>Name the play and write its instruction — the single biggest lever on output quality. You&rsquo;ll add agents, skills, and placement next.</div>
              <label className="field"><span className="t-label">Play name</span><input className="input" autoFocus value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Launch readiness review" /></label>
              <label className="field"><span className="t-label">Instruction — what the officer should do</span><textarea className="textarea" rows={5} value={form.focus} onChange={(e) => setForm({ ...form, focus: e.target.value })} placeholder="The analytical instruction this play runs on — be specific about the job, the lens, and what a great output contains." /></label>
              <label className="field"><span className="t-label">Summary <span className="t-muted" style={{ fontWeight: 400 }}>(optional)</span></span><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="A short line for the gallery." /></label>
              <div className="row gap-2"><button className="btn btn-sm" type="submit" disabled={!form.label.trim()}>Create &amp; continue →</button><button className="btn btn-secondary btn-sm" type="button" onClick={backToGallery}>Cancel</button></div>
            </form>
          ) : activePlay && (
            <div className="stack-3">
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
                  <div className="t-body" style={{ fontSize: 13, lineHeight: 1.6 }}>{activePlay.description || <span className="t-muted">No summary.</span>}</div>
                )}
              </div>
              <Footer i={0} />
            </div>
          ))}

          {/* ---- STEP 1 · AGENTS ---- */}
          {step === 1 && activePlay && (() => {
            const chainRows = playAgents.filter((r) => r.play_id === activePlay.id).slice().sort((a, b) => a.position - b.position);
            const onIds = new Set(chainRows.map((r) => r.agent_id));
            const available = agents.filter((a) => !onIds.has(a.id));
            return (
              <div>
                <Section label="Agents on this play">
                  <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 10 }}>Add one or more officers — they run as a <strong>chain</strong>, in order: each sees the prior officers&rsquo; take and adds its lens. <strong>Drag to reorder.</strong> Two to three is the sweet spot.</div>
                  {chainRows.length === 0 && <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 10 }}>No agents yet — add one or more below.</div>}
                  <div className="stack-3">
                    {chainRows.map((pa, idx) => {
                      const ag = agentById(pa.agent_id); if (!ag) return null;
                      const corner = [...(cornerstones[ag.id] ?? new Set())].map((id) => skillById(id)).filter(Boolean) as Skill[];
                      return (
                        <div key={pa.id} draggable
                          onDragStart={() => setDragId(pa.id)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => { if (dragId && dragId !== pa.id) reorderChain(activePlay.id, dragId, pa.id); setDragId(null); }}
                          onDragEnd={() => setDragId(null)}
                          className="card card-pad" style={{ opacity: dragId === pa.id ? 0.5 : 1 }}>
                          <div className="row-between" style={{ marginBottom: 8 }}>
                            <div className="row gap-2" style={{ alignItems: "center" }}>
                              <span title="Drag to reorder" style={{ cursor: "grab", color: "var(--tm)", fontSize: 15, lineHeight: 1 }}>⠿</span>
                              <span className="t-mono-xs t-muted" style={{ flexShrink: 0 }}>{idx + 1}</span>
                              <AgentBadge name={ag.name} />
                            </div>
                            <button className="btn btn-secondary btn-sm" onClick={() => detachAgent(activePlay.id, ag.id)} style={{ color: "var(--rd-text)" }}>Detach</button>
                          </div>
                          <div className="t-label" style={{ color: "var(--tm)", fontSize: 10.5, marginBottom: 4 }}>Cornerstone skills <span className="t-muted" style={{ fontWeight: 400 }}>— always on, from the agent</span></div>
                          <div className="row gap-2" style={{ flexWrap: "wrap" }}>
                            {corner.length ? corner.map((s) => <Chip key={s.id} tone="accent">{s.name}</Chip>) : <span className="t-sub t-muted" style={{ fontSize: 12 }}>none set on this agent</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ marginTop: 14 }}>
                    <div className="t-label" style={{ color: "var(--tm)", marginBottom: 6 }}>Add officers</div>
                    {available.length === 0 ? (
                      <div className="t-sub t-muted" style={{ fontSize: 12 }}>All available agents are on this play.</div>
                    ) : (
                      <div className="row gap-2" style={{ flexWrap: "wrap" }}>
                        {available.map((a) => <button key={a.id} className="btn btn-secondary btn-sm" onClick={() => attachAgent(activePlay.id, a.id)}>+ {a.name}</button>)}
                      </div>
                    )}
                  </div>
                </Section>
                <Footer i={1} />
              </div>
            );
          })()}

          {/* ---- STEP 2 · SKILLS ---- */}
          {step === 2 && activePlay && (
            <div>
              <Section label="Play-specific skills">
                <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 10 }}>Optional. Layer a bespoke instruction onto a <strong>specific agent</strong> for this play — on top of its cornerstones, scoped to this play, never touching the shared library. Skip it if the play&rsquo;s instruction is already sharp.</div>
                {agentsOn(activePlay.id).length === 0 ? (
                  <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Attach an agent first (step 2) to layer skills onto it.</div>
                ) : (
                  <div className="stack-3">
                    {agentsOn(activePlay.id).map((ag) => {
                      const layered = playSkills.filter((r) => r.play_id === activePlay.id && r.agent_id === ag.id);
                      return (
                        <div key={ag.id} className="card card-pad">
                          <div style={{ marginBottom: 8 }}><AgentBadge name={ag.name} /></div>
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
                            {layered.length === 0 && <div className="t-sub t-muted" style={{ fontSize: 12 }}>No play-specific skills on {ag.name} yet.</div>}
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
                )}
              </Section>
              <Footer i={2} />
            </div>
          )}

          {/* ---- STEP 3 · PLACE ---- */}
          {step === 3 && activePlay && (
            <div>
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
              <Footer i={3} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
