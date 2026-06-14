"use client";

// Agent detail with tabs: Overview (identity + prompt), Skills (attach reusable
// capabilities), Connections (internal data areas + external MCP), Workflows
// (saved tasks). Everything org-scoped via RLS.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Section, Chip, Banner, BackLink, Empty, Modal } from "@/components/ui";
import { Markdown } from "@/components/Markdown";
import SkillTailorChat from "@/components/SkillTailorChat";
import { CONNECTOR_CATALOG } from "@/lib/connectors";

type Agent = { id: string; key: string; name: string; role: string | null; model: string | null; system_prompt: string | null; is_active: boolean; identity: string | null; mandate: string | null; principles: string | null; voice: string | null };
type Skill = { id: string; key: string; name: string; description: string | null; category: string | null; instructions: string | null; areas: string[]; connectors: string[]; source: string | null; kind: string | null; scope: string | null; parent_id: string | null; agent_id: string | null };
type Connection = { id: string; kind: string; label: string; area: string | null; mcp_url: string | null; status: string; config: { purpose?: string | null } | null; targets: { type?: string; ref: string; label?: string }[] | null; guidance: string | null };
type InitiativeOpt = { id: string; title: string; stage: string | null; scope: string | null };
type WorkstreamOpt = { id: string; title: string; area: string | null; initiative_id: string; initiative_title?: string };
type Alignment = { id: string; role: string; guidance: string | null; initiative_id: string | null; workstream_id: string | null; title: string; kind: "initiative" | "task"; sub: string | null };

type Tab = "overview" | "skills" | "scope" | "workflows";

const INTERNAL_AREAS = [
  { area: "products", label: "Product records" },
  { area: "gtm", label: "GTM records" },
  { area: "signals", label: "Signals" },
  { area: "capabilities", label: "Frontier models & capabilities" },
  { area: "records", label: "All records" },
];

export default function AgentDetail({ agentId }: { agentId: string }) {
  const supabase = createClient();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [attached, setAttached] = useState<Set<string>>(new Set());
  const [cornerstones, setCornerstones] = useState<Set<string>>(new Set());
  const [connections, setConnections] = useState<Connection[]>([]);
  const [agentWorkflows, setAgentWorkflows] = useState<AgentWorkflow[]>([]);
  const [alignments, setAlignments] = useState<Alignment[]>([]);
  const [initiatives, setInitiatives] = useState<InitiativeOpt[]>([]);
  const [workstreams, setWorkstreams] = useState<WorkstreamOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: a } = await supabase.from("agents").select("id, key, name, role, model, system_prompt, is_active, identity, mandate, principles, voice").eq("id", agentId).maybeSingle();
    const [{ data: sk }, { data: as }, { data: cs }, { data: wf }, { data: al }, { data: inits }, { data: ws }] = await Promise.all([
      supabase.from("skills").select("id, key, name, description, category, instructions, areas, connectors, source, kind, scope, parent_id, agent_id").or(`scope.eq.library,and(scope.eq.agent,agent_id.eq.${agentId})`).order("name"),
      supabase.from("agent_skills").select("skill_id, is_cornerstone").eq("agent_id", agentId),
      supabase.from("connections").select("id, kind, label, area, mcp_url, status, config, targets, guidance").eq("agent_id", agentId).order("created_at"),
      supabase.from("workflows").select("id, name, description, agent_id, steps, is_active").order("created_at", { ascending: false }),
      supabase.from("agent_alignments").select("id, role, guidance, initiative_id, workstream_id, initiatives(title, stage), initiative_workstreams(title, area)").eq("agent_id", agentId).order("created_at"),
      supabase.from("initiatives").select("id, title, stage, scope").order("created_at", { ascending: false }).limit(200),
      supabase.from("initiative_workstreams").select("id, title, area, initiative_id").order("created_at", { ascending: false }).limit(400),
    ]);
    setAgent(a); setSkills(sk ?? []);
    setAttached(new Set((as ?? []).map((x) => x.skill_id)));
    setCornerstones(new Set((as ?? []).filter((x) => x.is_cornerstone).map((x) => x.skill_id)));
    setConnections(cs ?? []);
    // Workflows this agent participates in — as owner, or named in any step.
    // deno-lint-ignore no-explicit-any
    setAgentWorkflows(((wf ?? []) as any[]).filter((w) => w.agent_id === agentId || (Array.isArray(w.steps) && w.steps.some((s: any) => s?.agent_id === agentId)))
      .map((w) => ({ id: w.id, name: w.name, description: w.description, is_active: w.is_active, stepCount: Array.isArray(w.steps) ? w.steps.length : 0 })));
    const initById = new Map((inits ?? []).map((i) => [i.id, i.title]));
    // deno-lint-ignore no-explicit-any
    setAlignments(((al ?? []) as any[]).map((r) => r.workstream_id
      ? { id: r.id, role: r.role, guidance: r.guidance, initiative_id: r.initiative_id, workstream_id: r.workstream_id, kind: "task" as const, title: r.initiative_workstreams?.title ?? "Task", sub: r.initiative_workstreams?.area ?? null }
      : { id: r.id, role: r.role, guidance: r.guidance, initiative_id: r.initiative_id, workstream_id: r.workstream_id, kind: "initiative" as const, title: r.initiatives?.title ?? "Initiative", sub: r.initiatives?.stage ?? null }));
    setInitiatives((inits ?? []) as InitiativeOpt[]);
    setWorkstreams(((ws ?? []) as WorkstreamOpt[]).map((w) => ({ ...w, initiative_title: initById.get(w.initiative_id) })));
    setLoading(false);
  }, [supabase, agentId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="t-sub t-muted">Loading…</div>;
  if (!agent) return <Empty title="Agent not found" />;

  const TABS: [Tab, string, number][] = [
    ["overview", "Overview", 0],
    ["skills", "Skills", attached.size],
    ["scope", "Scope", connections.length + alignments.length],
    ["workflows", "Workflows", agentWorkflows.length],
  ];

  return (
    <div>
      <BackLink href="/agents" label="Agents" />
      <div className="row gap-2" style={{ marginBottom: 6 }}>
        <span style={{ width: 30, height: 30, borderRadius: 8, background: "var(--ac)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13 }}>{agent.name.slice(0, 2).toUpperCase()}</span>
        <Chip>{agent.key}</Chip>
        {!agent.is_active && <Chip tone="amber">inactive</Chip>}
      </div>
      <h1 className="t-page" style={{ marginBottom: 2 }}>{agent.name}</h1>
      <div className="t-sub t-muted" style={{ marginBottom: "var(--sp-5)" }}>{agent.role || "Agent"} · <span className="mono" style={{ fontSize: 12 }}>{agent.model}</span></div>

      <Banner>{error}</Banner>

      {/* In-page tab strip — all agent configuration lives here, nowhere else. */}
      <div className="row gap-2" style={{ marginBottom: "var(--sp-5)", borderBottom: "1px solid var(--border)" }}>
        {TABS.map(([k, label, count]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{ background: "none", border: "none", borderBottom: tab === k ? "2px solid var(--ac)" : "2px solid transparent", color: tab === k ? "var(--tp)" : "var(--ts)", fontWeight: tab === k ? 680 : 600, fontSize: 13.5, padding: "8px 14px", cursor: "pointer", marginBottom: -1 }}>
            {label}{count > 0 ? ` · ${count}` : ""}
          </button>
        ))}
      </div>

      {tab === "overview" && <Overview agent={agent} onSaved={load} setError={setError}
        skillsCount={attached.size} areas={connections.filter((c) => c.kind === "internal").map((c) => c.label)} alignCount={alignments.length} hasCornerstone={cornerstones.size > 0}
        cornerstoneSkill={skills.find((s) => attached.has(s.id) && cornerstones.has(s.id)) ?? null} childSkills={skills.filter((s) => attached.has(s.id) && !cornerstones.has(s.id))} tabTo={setTab} />}
      {tab === "skills" && <Skills agentId={agentId} agentName={agent.name} skills={skills} attached={attached} cornerstones={cornerstones} connAreas={connections.filter((c) => c.kind === "internal").map((c) => c.area).filter((a): a is string => !!a)} reload={load} setError={setError} />}
      {tab === "scope" && <Scope agentId={agentId} connections={connections} alignments={alignments} initiatives={initiatives} workstreams={workstreams} reload={load} setError={setError} />}
      {tab === "workflows" && <Workflows workflows={agentWorkflows} />}
    </div>
  );
}

// ---------- Overview ----------
// The cornerstone — staged into four guided windows that COMPOSE the system
// prompt, instead of one blank "base prompt" box. AI can draft all four.
const CORNER_WINDOWS: { key: "identity" | "mandate" | "principles" | "voice"; label: string; hint: string; ph: string }[] = [
  { key: "identity", label: "Identity", hint: "Who this officer is — role, seniority, domain, point of view.", ph: "You are the CPO — a senior product leader who guards the product's truth and reframes the category." },
  { key: "mandate", label: "Mandate", hint: "What they own and are accountable for; what “good” looks like.", ph: "You own the accuracy of the product record and the strength of the product strategy board…" },
  { key: "principles", label: "Operating principles", hint: "How they think and decide — priorities, tradeoffs, the evidence bar.", ph: "Evidence over opinion. Prefer reversible bets. Name the strongest counter-argument before recommending…" },
  { key: "voice", label: "Voice & guardrails", hint: "Tone, and what they must NOT do.", ph: "Direct and concise. Never fabricate; always cite. Defer to a human on anything irreversible." },
];

function composeCornerstone(w: { identity: string; mandate: string; principles: string; voice: string }): string {
  return CORNER_WINDOWS.map(({ key, label }) => {
    const v = w[key].trim();
    return v ? `# ${label}\n${v}` : "";
  }).filter(Boolean).join("\n\n");
}

function Overview({ agent, onSaved, setError, skillsCount, areas, alignCount, hasCornerstone, cornerstoneSkill, childSkills, tabTo }: { agent: Agent; onSaved: () => void; setError: (s: string | null) => void; skillsCount: number; areas: string[]; alignCount: number; hasCornerstone: boolean; cornerstoneSkill: Skill | null; childSkills: Skill[]; tabTo: (t: Tab) => void }) {
  const supabase = createClient();
  const [role, setRole] = useState(agent.role ?? "");
  const [model, setModel] = useState(agent.model ?? "claude-opus-4-8");
  // Seed the windows; if a legacy agent has only a freeform prompt, surface it in
  // Identity so nothing is lost and the human can restructure it.
  const noWindows = !agent.identity && !agent.mandate && !agent.principles && !agent.voice;
  const [w, setW] = useState({
    identity: agent.identity ?? (noWindows ? agent.system_prompt ?? "" : ""),
    mandate: agent.mandate ?? "",
    principles: agent.principles ?? "",
    voice: agent.voice ?? "",
  });
  const [busy, setBusy] = useState(false);
  // Guided AI
  const [aiOpen, setAiOpen] = useState(false);
  const [intent, setIntent] = useState("");
  const [drafting, setDrafting] = useState(false);

  async function save() {
    setBusy(true); setError(null);
    const system_prompt = composeCornerstone(w) || agent.system_prompt || null;
    const { error } = await supabase.from("agents").update({
      role, model, identity: w.identity.trim() || null, mandate: w.mandate.trim() || null,
      principles: w.principles.trim() || null, voice: w.voice.trim() || null, system_prompt,
    }).eq("id", agent.id);
    if (error) setError(error.message); else onSaved();
    setBusy(false);
  }
  async function draftWithAI() {
    if (!intent.trim()) { setError("Describe who this officer should be first."); return; }
    setDrafting(true); setError(null);
    try {
      const { data, error } = await supabase.functions.invoke("draft-cornerstone", { body: { name: agent.name, role: role.trim() || null, intent: intent.trim() } });
      if (error) throw error;
      const d = data?.draft;
      if (!d) throw new Error(data?.error || "No draft returned.");
      setW({ identity: d.identity ?? "", mandate: d.mandate ?? "", principles: d.principles ?? "", voice: d.voice ?? "" });
      setAiOpen(false); setIntent("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not draft the identity."); }
    finally { setDrafting(false); }
  }

  const Dial = ({ label, value, hint, to }: { label: string; value: string; hint: string; to?: Tab }) => (
    <button onClick={() => to && tabTo(to)} disabled={!to} className={to ? "card card-link card-pad" : "card card-pad"} style={{ textAlign: "left", cursor: to ? "pointer" : "default" }}>
      <div className="t-label" style={{ color: "var(--tm)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 660, marginBottom: 2 }}>{value}</div>
      <div className="t-sub t-muted" style={{ fontSize: 11.5 }}>{hint}</div>
    </button>
  );
  const filled = CORNER_WINDOWS.filter((win) => w[win.key].trim()).length;
  return (
    <>
      <Section label="Setup at a glance">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--sp-3)" }}>
          <Dial label="Identity" value={hasCornerstone ? "Cornerstone" : `${filled}/4`} hint={hasCornerstone ? "set on the Skills tab" : "windows filled below"} to={hasCornerstone ? "skills" : undefined} />
          <Dial label="Skills" value={String(skillsCount)} hint={skillsCount ? "playbooks it applies" : "none attached"} to="skills" />
          <Dial label="Access" value={areas.length ? String(areas.length) : "all"} hint={areas.length ? areas.join(", ") : "full foundation"} to="scope" />
          <Dial label="Focus" value={String(alignCount)} hint={alignCount ? "initiatives / tasks" : "no alignment"} to="scope" />
        </div>
      </Section>

      <Section label="Base configuration">
        <div className="card card-pad">
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "var(--sp-3)" }}>
            <label className="field"><span className="t-label">Persona</span>
              <input className="input" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Who this agent is — e.g. Competitor Analyst" /></label>
            <label className="field"><span className="t-label">Model</span>
              <select className="select" value={model} onChange={(e) => setModel(e.target.value)}>
                <option value="claude-opus-4-8">claude-opus-4-8 · most capable</option>
                <option value="claude-sonnet-4-6">claude-sonnet-4-6 · faster, cheaper</option>
                <option value="claude-haiku-4-5">claude-haiku-4-5 · cheapest</option>
              </select></label>
          </div>
        </div>
      </Section>

      {hasCornerstone ? (
        <Section label="Overview" action={<button className="btn btn-secondary btn-sm" onClick={() => tabTo("skills")}>Tailor / edit →</button>}>
          {/* The agent's "resume", derived LIVE from its cornerstone + skills — so it's
              always current and you can read/QA/tailor the agent at a glance. */}
          <div className="card card-pad">
            <div className="t-label" style={{ color: "var(--tm)" }}>Identity</div>
            <div style={{ fontSize: 14.5, fontWeight: 660, marginTop: 2 }}>{agent.name}{agent.role ? ` · ${agent.role}` : ""}</div>
            {cornerstoneSkill?.description && <div className="t-sub" style={{ marginTop: 4, lineHeight: 1.5 }}>{cornerstoneSkill.description}</div>}

            <div className="t-label" style={{ color: "var(--tm)", marginTop: 18 }}>Capabilities <span className="t-mono-xs t-muted">({childSkills.length})</span></div>
            {childSkills.length === 0
              ? <div className="t-sub t-muted" style={{ fontSize: 12.5, marginTop: 4 }}>No skills attached yet — add or create them on the Skills tab.</div>
              : <div className="stack-2" style={{ marginTop: 6 }}>
                  {childSkills.map((s) => (
                    <div key={s.id} className="card card-pad" style={{ borderLeft: "2px solid var(--vl)", padding: "8px 12px" }}>
                      <div style={{ fontSize: 13, fontWeight: 620 }}>{s.name}{s.category ? <span className="t-mono-xs t-muted"> · {s.category}</span> : null}</div>
                      {s.description && <div className="t-sub t-muted" style={{ fontSize: 12, marginTop: 2, lineHeight: 1.4 }}>{s.description}</div>}
                    </div>
                  ))}
                </div>}
            <div className="t-mono-xs t-muted" style={{ marginTop: 12 }}>Derived live from this agent&rsquo;s cornerstone + skills — it stays current as you tailor them.</div>
          </div>
        </Section>
      ) : (
        <Section label="Core identity" action={<button className="btn btn-sm" onClick={() => setAiOpen(true)} style={{ background: "var(--ac)", color: "#fff" }}>✨ Set up with AI</button>}>
          <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>This agent has <strong>no cornerstone skill yet</strong>, so these windows are its fallback identity. The better path: give it a cornerstone on the <strong>Skills</strong> tab (✦ Create / Tailor with AI) — that becomes its single, always-on identity and these windows are retired.</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-3)" }}>
            {CORNER_WINDOWS.map((win) => (
              <label key={win.key} className="field">
                <span className="t-label">{win.label}</span>
                <span className="t-sub t-muted" style={{ fontSize: 11.5, marginBottom: 4 }}>{win.hint}</span>
                <textarea className="textarea" rows={5} value={w[win.key]} onChange={(e) => setW({ ...w, [win.key]: e.target.value })} placeholder={win.ph} />
              </label>
            ))}
          </div>
          <div className="row gap-2" style={{ marginTop: "var(--sp-3)" }}>
            <button className="btn" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save identity"}</button>
          </div>
        </Section>
      )}

      <Modal open={aiOpen} onClose={() => setAiOpen(false)} title="Set up the identity with AI" width={620}>
        <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>Describe who this officer should be in a sentence or two. AI drafts all four windows, grounded in your product truth — you review and edit before saving.</div>
        <label className="field"><span className="t-label">Who should this officer be?</span>
          <textarea className="textarea" rows={4} autoFocus value={intent} onChange={(e) => setIntent(e.target.value)} placeholder={`e.g. A ${agent.name} who guards our positioning, is ruthless about evidence, and translates signals into a sharp product strategy.`} /></label>
        <div className="row gap-2"><button className="btn" disabled={drafting} onClick={draftWithAI} style={{ background: "var(--ac)", color: "#fff" }}>{drafting ? "Drafting all four…" : "✨ Draft the identity"}</button><button className="btn btn-secondary" onClick={() => setAiOpen(false)}>Cancel</button></div>
      </Modal>
    </>
  );
}

// ---------- Skills — cornerstone (identity) + child skills, as a hub-and-spoke ----------
// The CORNERSTONE sits at the center (the agent's identity, always on); CHILD
// skills radiate as clickable spokes. Selecting any node opens an editor with the
// markdown playbook (+ live preview), its areas, and its preferred connectors.
const catTone = (c: string | null) => (c === "product" ? "accent" : c === "gtm" ? "violet" : "default");
const catDot = (c: string | null) => (c === "product" ? "var(--ac)" : c === "gtm" ? "var(--vl)" : c === "research" ? "var(--gn)" : "var(--tm)");
const AREA_KEYS = ["product", "gtm", "competitive", "strategy", "market", "signals", "frontier", "roadmap", "content", "campaigns", "initiatives"];
const CONNECTOR_SUGGESTIONS = CONNECTOR_CATALOG.map((c) => c.name);

// The radial map: cornerstone in the middle, child skills as spokes around it.
// Responsive — positions are percentages inside a square box, so it scales down.
function SkillsGraph({ agentName, cornerstone, childList, selectedId, onSelect, onAddCornerstone }: {
  agentName: string; cornerstone: Skill | null; childList: Skill[]; selectedId: string | null; onSelect: (s: Skill) => void; onAddCornerstone: () => void;
}) {
  const n = childList.length;
  const R = 39; // % radius of the ring
  const pos = (i: number) => { const a = (-90 + (360 * i) / Math.max(n, 1)) * (Math.PI / 180); return { left: 50 + R * Math.cos(a), top: 50 + R * Math.sin(a) }; };
  const shadow = "0 1px 2px rgba(17,20,24,0.08)";
  return (
    <div style={{ position: "relative", width: "100%", maxWidth: 520, aspectRatio: "1 / 1", margin: "0 auto" }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
        {childList.map((_, i) => { const p = pos(i); return <line key={i} x1={50} y1={50} x2={p.left} y2={p.top} stroke="var(--border-strong)" strokeWidth={0.3} />; })}
      </svg>
      {cornerstone ? (
        <button type="button" onClick={() => onSelect(cornerstone)} title={cornerstone.name}
          style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: 138, height: 138, borderRadius: "50%", cursor: "pointer",
            background: "var(--ac-fill)", border: "2px solid var(--ac)", boxShadow: selectedId === cornerstone.id ? "0 0 0 4px var(--ac-fill)" : shadow,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 12, textAlign: "center", gap: 3 }}>
          <span style={{ fontSize: 11.5, color: "var(--ac-text)" }}>★ {agentName}</span>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--tp)", lineHeight: 1.2, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{cornerstone.name}</span>
          <span className="t-mono-xs" style={{ color: "var(--ac-text)" }}>cornerstone</span>
        </button>
      ) : (
        <button type="button" onClick={onAddCornerstone}
          style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: 138, height: 138, borderRadius: "50%", cursor: "pointer",
            background: "var(--panel)", border: "2px dashed var(--border-strong)", color: "var(--ts)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 14, textAlign: "center", gap: 4 }}>
          <span style={{ fontSize: 20, color: "var(--tm)" }}>★</span>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>Set the cornerstone</span>
          <span className="t-mono-xs t-muted">the agent&rsquo;s identity</span>
        </button>
      )}
      {childList.map((s, i) => {
        const p = pos(i); const on = selectedId === s.id;
        return (
          <button key={s.id} type="button" onClick={() => onSelect(s)} title={s.name}
            style={{ position: "absolute", left: `${p.left}%`, top: `${p.top}%`, transform: "translate(-50%,-50%)", width: 108, cursor: "pointer",
              background: "var(--panel)", border: `1.5px solid ${on ? "var(--vl)" : "var(--border)"}`, boxShadow: on ? "0 0 0 3px var(--vl-fill)" : shadow, borderRadius: 10, padding: "8px 9px", textAlign: "left", display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: catDot(s.category), flexShrink: 0 }} /><span style={{ fontSize: 12, fontWeight: 640, color: "var(--tp)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span></span>
            {s.areas?.length ? <span className="t-mono-xs t-muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.areas.join(" · ")}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function Skills({ agentId, agentName, skills, attached, cornerstones, connAreas, reload, setError }: { agentId: string; agentName: string; skills: Skill[]; attached: Set<string>; cornerstones: Set<string>; connAreas: string[]; reload: () => void; setError: (s: string | null) => void }) {
  const supabase = createClient();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", instructions: "", category: "general", cornerstone: false, areas: [] as string[], connectors: [] as string[] });
  const [intent, setIntent] = useState(""); // "describe what you want" → AI draft
  const [drafting, setDrafting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [evolving, setEvolving] = useState(false);
  const [histSkill, setHistSkill] = useState<Skill | null>(null);
  const [createTab, setCreateTab] = useState<"scratch" | "template">("scratch");
  const [selected, setSelected] = useState<string | null>(null); // which node's editor is open
  const [edit, setEdit] = useState({ name: "", description: "", instructions: "", category: "general", areas: [] as string[], connectors: [] as string[] });
  const [preview, setPreview] = useState(false);
  const [connInput, setConnInput] = useState("");
  const [showImprove, setShowImprove] = useState(false);
  const [tailorFor, setTailorFor] = useState<Skill | null>(null); // open the chat-based tailor
  const [improveAsk, setImproveAsk] = useState("");
  const [improving, setImproving] = useState(false);

  async function toggle(skillId: string, on: boolean) {
    setError(null);
    if (on) {
      // Attaching a library TEMPLATE mints a per-agent tailored INSTANCE (its own
      // body + revision history, parent_id -> template). The agent works from the
      // instance, so tailoring it never touches the template or other agents.
      const t = skills.find((s) => s.id === skillId);
      if (!t) { setError("Template not found."); return; }
      const orgId = await getOrgId();
      if (!orgId) { setError("Could not resolve your organization."); return; }
      const isCorner = t.kind === "cornerstone";
      const key = `${t.key}__${Date.now().toString(36)}`;
      const { data: inst, error: insErr } = await supabase.from("skills").insert({
        org_id: orgId, key, name: t.name, description: t.description, instructions: t.instructions,
        category: t.category, areas: isCorner ? [] : t.areas, connectors: t.connectors,
        kind: t.kind ?? "child", scope: "agent", agent_id: agentId, parent_id: t.id, source: "tailored",
      }).select("id").single();
      if (insErr || !inst) { setError(insErr?.message ?? "Could not attach the skill."); return; }
      if (isCorner) await supabase.from("agent_skills").update({ is_cornerstone: false }).eq("agent_id", agentId).eq("is_cornerstone", true);
      await supabase.from("agent_skills").insert({ org_id: orgId, agent_id: agentId, skill_id: inst.id, is_cornerstone: isCorner });
    } else {
      // Detaching deletes the instance (agent-owned; meaningless detached) — its
      // agent_skills row + revisions cascade. A legacy directly-attached template
      // (pre-instances) is only detached, never deleted from the library.
      const s = skills.find((x) => x.id === skillId);
      if (s?.scope === "agent") await supabase.from("skills").delete().eq("id", skillId);
      else await supabase.from("agent_skills").delete().eq("agent_id", agentId).eq("skill_id", skillId);
      if (selected === skillId) setSelected(null);
    }
    reload();
  }
  async function toggleCornerstone(skillId: string, next: boolean) {
    setError(null);
    // Exactly one cornerstone per agent (the identity). Promoting one demotes the
    // current cornerstone — radio behavior, also matching the DB unique index.
    if (next) {
      await supabase.from("agent_skills").update({ is_cornerstone: false }).eq("agent_id", agentId).eq("is_cornerstone", true);
      await supabase.from("agent_skills").update({ is_cornerstone: true }).eq("agent_id", agentId).eq("skill_id", skillId);
    } else {
      await supabase.from("agent_skills").update({ is_cornerstone: false }).eq("agent_id", agentId).eq("skill_id", skillId);
    }
    reload();
  }
  function openEditor(s: Skill) {
    if (selected === s.id) { setSelected(null); return; }
    setSelected(s.id); setPreview(false); setConnInput(""); setShowImprove(false); setImproveAsk("");
    setEdit({ name: s.name, description: s.description ?? "", instructions: s.instructions ?? "", category: s.category ?? "general", areas: s.areas ?? [], connectors: s.connectors ?? [] });
  }
  async function saveSkill(s: Skill) {
    setError(null);
    const isCorner = cornerstones.has(s.id);
    const { error } = await supabase.from("skills").update({
      name: edit.name.trim() || s.name,
      description: edit.description.trim() || null,
      instructions: edit.instructions,
      category: edit.category,
      areas: isCorner ? [] : edit.areas,
      connectors: edit.connectors,
    }).eq("id", s.id);
    if (error) setError(error.message); else { setSelected(null); reload(); }
  }

  // Draft from a plain-English description (AI). Fills the form; the human reviews
  // and edits before Create. Cornerstone vs child changes the grounding the model uses.
  async function draftWithAI() {
    if (!intent.trim()) { setError("Describe what you want this skill to do/be first."); return; }
    setDrafting(true); setError(null);
    try {
      const { data, error } = await supabase.functions.invoke("evolve-skills", {
        body: { agent_id: agentId, mode: "draft", kind: form.cornerstone ? "cornerstone" : "child", intent: intent.trim() },
      });
      if (error) throw error;
      const d = data?.draft;
      if (!d) throw new Error(data?.error || "No draft returned.");
      setForm((f) => ({
        ...f,
        name: f.name.trim() || d.name || "",
        description: d.description || f.description,
        instructions: d.instructions || f.instructions,
        category: d.category || f.category,
        areas: Array.isArray(d.areas) ? d.areas : [],
        connectors: Array.isArray(d.connectors) ? d.connectors : [],
      }));
    } catch (e) { setError(e instanceof Error ? e.message : "Could not draft the skill."); }
    finally { setDrafting(false); }
  }

  // Refine the playbook currently in the editor (AI), per a short instruction.
  async function improveWithAI(s: Skill) {
    if (!edit.instructions.trim()) { setError("Write or draft some instructions first."); return; }
    if (!improveAsk.trim()) { setError("Say what to improve."); return; }
    setImproving(true); setError(null);
    try {
      const { data, error } = await supabase.functions.invoke("evolve-skills", {
        body: { agent_id: agentId, mode: "draft", kind: cornerstones.has(s.id) ? "cornerstone" : "child", intent: improveAsk.trim(), current: edit.instructions, area: edit.areas[0] },
      });
      if (error) throw error;
      const d = data?.draft;
      if (!d) throw new Error(data?.error || "No result returned.");
      setEdit((e) => ({ ...e, instructions: d.instructions || e.instructions }));
      setShowImprove(false); setImproveAsk(""); setPreview(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not improve the skill."); }
    finally { setImproving(false); }
  }

  async function createSkill(e: React.FormEvent) {
    e.preventDefault(); if (!form.name.trim()) return;
    setBusy(true); setError(null);
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization.");
      const key = form.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `skill_${Date.now()}`;
      // Authored on the agent → it's a per-agent INSTANCE (scope=agent), not a
      // library template. parent_id stays null (authored fresh, not from a template).
      const { data, error } = await supabase.from("skills").insert({ org_id: orgId, key, name: form.name.trim(), description: form.description.trim() || null, instructions: form.instructions.trim() || null, category: form.category, areas: form.cornerstone ? [] : form.areas, connectors: form.connectors, kind: form.cornerstone ? "cornerstone" : "child", scope: "agent", agent_id: agentId, source: "tailored" }).select("id").single();
      if (error) throw error;
      // Exactly one cornerstone: if this new skill is the identity, demote the current one first.
      if (form.cornerstone) await supabase.from("agent_skills").update({ is_cornerstone: false }).eq("agent_id", agentId).eq("is_cornerstone", true);
      await supabase.from("agent_skills").insert({ org_id: orgId, agent_id: agentId, skill_id: data.id, is_cornerstone: form.cornerstone });
      setCreating(false); setIntent(""); setForm({ name: "", description: "", instructions: "", category: "general", cornerstone: false, areas: [], connectors: [] });
      reload();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create skill."); }
    finally { setBusy(false); }
  }

  const attachedSkills = skills.filter((s) => attached.has(s.id));
  const cornerstone = attachedSkills.find((s) => cornerstones.has(s.id)) ?? null;
  const childList = attachedSkills.filter((s) => !cornerstones.has(s.id));
  // The picker offers generic library TEMPLATES (never other agents' instances),
  // scoped to what fits this agent: cornerstone templates when setting identity;
  // for child skills, only those whose areas overlap the agent's connected areas
  // (general skills, and the no-connections case, always show).
  const normArea = (a: string) => (a === "products" ? "product" : a);
  const agentAreas = new Set(connAreas.map(normArea));
  // Templates this agent already has a tailored instance of — don't offer them again.
  const attachedParents = new Set(skills.filter((s) => attached.has(s.id) && s.parent_id).map((s) => s.parent_id as string));
  const templates = skills.filter((s) => s.scope === "library" && !attachedParents.has(s.id));
  const library = form.cornerstone
    ? templates.filter((s) => s.kind === "cornerstone")
    : templates.filter((s) => s.kind !== "cornerstone" && (agentAreas.size === 0 || !(s.areas?.length) || s.areas.some((a) => agentAreas.has(a))));
  const selSkill = attachedSkills.find((s) => s.id === selected) ?? null;
  const selIsCorner = selSkill ? cornerstones.has(selSkill.id) : false;
  const openCreate = (asCornerstone: boolean) => { setSelected(null); setForm({ name: "", description: "", instructions: "", category: "general", cornerstone: asCornerstone, areas: [], connectors: [] }); setIntent(""); setCreateTab("scratch"); setCreating(true); };

  const addArea = (a: string) => { if (a && !edit.areas.includes(a)) setEdit((e) => ({ ...e, areas: [...e.areas, a] })); };
  const addConn = (c: string) => { const v = c.trim(); if (v && !edit.connectors.includes(v)) setEdit((e) => ({ ...e, connectors: [...e.connectors, v] })); setConnInput(""); };

  return (
    <Section label="Skills" action={!creating ? (
      <div className="row gap-2">
        {attachedSkills.length > 0 && <button className="btn btn-sm" onClick={() => setEvolving((v) => !v)} style={{ background: "var(--ac)", color: "#fff" }}>Evolve from signals</button>}
        <button className="btn btn-secondary btn-sm" onClick={() => openCreate(false)}>+ New skill</button>
      </div>
    ) : undefined}>
      <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
        An agent has two kinds of skills. <strong style={{ color: "var(--ac-text)" }}>The cornerstone</strong> (one, ★) is its identity — it runs on <em>every</em> job, at the center below. <strong style={{ color: "var(--vl-text)" }}>Child skills</strong> are task/area-specific and build on the cornerstone, radiating as spokes. Click any node to edit it. <span className="t-mono-xs">({cornerstones.size === 1 ? "cornerstone set" : "no cornerstone yet"})</span>
      </div>

      {evolving && <EvolvePanel agentId={agentId} onApplied={reload} onClose={() => setEvolving(false)} setError={setError} />}
      {histSkill && <SkillHistory skill={histSkill} onClose={() => setHistSkill(null)} />}
      {tailorFor && <SkillTailorChat skillId={tailorFor.id} skillName={tailorFor.name} onApplied={reload} onClose={() => setTailorFor(null)} />}

      <Modal open={creating} onClose={() => { setCreating(false); setIntent(""); }} title={form.cornerstone ? "Set the cornerstone" : "New child skill"} width={680}>
        {/* Anthropic-style: build from scratch (AI-assisted) or start from a template. */}
        <div className="row gap-2" style={{ marginBottom: "var(--sp-3)" }}>
          <button type="button" className={`btn btn-sm ${createTab === "scratch" ? "" : "btn-secondary"}`} onClick={() => setCreateTab("scratch")}>From scratch</button>
          <button type="button" className={`btn btn-sm ${createTab === "template" ? "" : "btn-secondary"}`} onClick={() => setCreateTab("template")}>From a template{library.length ? ` · ${library.length}` : ""}</button>
        </div>

        {createTab === "scratch" ? (
          <form onSubmit={createSkill}>
            {/* Kind toggle changes both the grounding AND the setup framing. */}
            <div className="card card-pad" style={{ background: "var(--panel-2)", marginBottom: "var(--sp-3)" }}>
              <label className="row gap-2" style={{ alignItems: "center", marginBottom: 8, cursor: "pointer" }}><input type="checkbox" checked={form.cornerstone} onChange={(e) => setForm({ ...form, cornerstone: e.target.checked })} /><span className="t-sub">{form.cornerstone ? "Cornerstone — the agent’s identity (drafts from your product truth + ICP + role)" : "Child skill — a task/area playbook (drafts from the cornerstone + what you describe)"}</span></label>
              <span className="t-label">Describe what you want — let AI draft it</span>
              <textarea className="textarea" rows={3} value={intent} onChange={(e) => setIntent(e.target.value)} placeholder={form.cornerstone ? "e.g. A CPO who guards the product record's truth, reframes the category, and is ruthless about evidence." : "e.g. Tear down a named competitor and turn it into a battlecard our reps can use."} />
              <div className="row gap-2" style={{ marginTop: 8 }}><button className="btn btn-sm" type="button" onClick={draftWithAI} disabled={drafting} style={{ background: "var(--ac)", color: "#fff" }}>{drafting ? "Drafting…" : "✨ Draft with AI"}</button><span className="t-sub t-muted" style={{ fontSize: 11.5 }}>Fills the fields below — review and edit before creating.</span></div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "var(--sp-3)" }}>
              <label className="field"><span className="t-label">Name</span><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Competitive teardown" /></label>
              <label className="field"><span className="t-label">Category</span>
                <select className="select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  <option value="general">General</option><option value="product">Product</option><option value="gtm">GTM</option><option value="research">Research</option>
                </select></label>
            </div>
            <label className="field"><span className="t-label">Description</span><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What it does" /></label>
            <label className="field"><span className="t-label">Instructions / playbook</span><textarea className="textarea" rows={8} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} placeholder="How the agent should apply this skill, tailored to your company and goals." /></label>
            {!form.cornerstone && (form.areas.length > 0 || form.connectors.length > 0) && (
              <div className="row gap-2" style={{ flexWrap: "wrap", margin: "2px 0 10px", alignItems: "center" }}>
                {form.areas.length > 0 && <><span className="t-mono-xs t-muted">areas:</span>{form.areas.map((a) => <Chip key={a} tone="accent">{a}</Chip>)}</>}
                {form.connectors.length > 0 && <><span className="t-mono-xs t-muted" style={{ marginLeft: 6 }}>connectors:</span>{form.connectors.map((c) => <Chip key={c} tone="violet">{c}</Chip>)}</>}
              </div>
            )}
            <div className="row gap-2"><button className="btn" type="submit" disabled={busy}>{busy ? "Creating…" : "Create skill"}</button><button className="btn btn-secondary" type="button" onClick={() => { setCreating(false); setIntent(""); }}>Cancel</button></div>
          </form>
        ) : (
          <div>
            <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 10 }}>Reusable skills in your library. Attach one as a child skill — then tailor it on the map.</div>
            {library.length === 0
              ? <div className="t-sub t-muted">No templates in your library yet. Build one from scratch.</div>
              : <div className="stack-3">{library.map((s) => (
                  <div key={s.id} className="card card-pad row-between" style={{ gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="row gap-2" style={{ flexWrap: "wrap" }}><span style={{ fontSize: 14, fontWeight: 620 }}>{s.name}</span><Chip tone={catTone(s.category)}>{s.category}</Chip>{s.source === "template" && <Chip tone="green">template</Chip>}{(s.areas ?? []).map((a) => <Chip key={a} tone="accent">{a}</Chip>)}</div>
                      {s.description && <div className="t-sub t-muted" style={{ fontSize: 12.5, marginTop: 2 }}>{s.description}</div>}
                    </div>
                    <button className="btn btn-sm" onClick={async () => { await toggle(s.id, true); setCreating(false); }}>Use</button>
                  </div>
                ))}</div>}
          </div>
        )}
      </Modal>

      {/* The hub-and-spoke map */}
      <div className="card card-pad" style={{ background: "var(--panel-2)", marginBottom: "var(--sp-4)", paddingTop: 18, paddingBottom: 18 }}>
        <SkillsGraph agentName={agentName} cornerstone={cornerstone} childList={childList} selectedId={selected} onSelect={openEditor} onAddCornerstone={() => openCreate(true)} />
        <div className="row gap-2" style={{ justifyContent: "center", marginTop: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => openCreate(false)}>+ Add child skill</button>
          {!cornerstone && <button className="btn btn-secondary btn-sm" onClick={() => openCreate(true)}>★ Set cornerstone</button>}
        </div>
      </div>

      {/* Editor for the selected node — opens as an overlay (no scrolling the page) */}
      <Modal open={!!selSkill} onClose={() => setSelected(null)} title={selIsCorner ? "★ Cornerstone skill" : "Child skill"} width={720}>
        {selSkill && (<>
          <div className="row gap-2" style={{ flexWrap: "wrap", marginBottom: 12 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => toggleCornerstone(selSkill.id, !selIsCorner)} title={selIsCorner ? "Demote to a child skill" : "Make this the agent's cornerstone (identity, always on)"}>{selIsCorner ? "Demote to child" : "☆ Make cornerstone"}</button>
            <button className="btn btn-sm" onClick={() => setTailorFor(selSkill)} style={{ background: "var(--ac)", color: "#fff" }}>✦ Tailor with AI</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setHistSkill(selSkill)}>History</button>
            <button className="btn btn-secondary btn-sm" onClick={() => toggle(selSkill.id, false)} style={{ color: "var(--rd-text)" }}>Detach</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "var(--sp-3)" }}>
            <label className="field"><span className="t-label">Name</span><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
            <label className="field"><span className="t-label">Category</span>
              <select className="select" value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })}>
                <option value="general">General</option><option value="product">Product</option><option value="gtm">GTM</option><option value="research">Research</option>
              </select></label>
          </div>
          <label className="field"><span className="t-label">What it does</span><input className="input" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} placeholder="A one-liner" /></label>

          {/* Areas — child skills only (a cornerstone is general). */}
          {!selIsCorner && (
            <div className="field">
              <span className="t-label">Areas <span className="t-muted" style={{ fontWeight: 400 }}>— where this skill is relevant</span></span>
              <div className="row gap-2" style={{ flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
                {edit.areas.map((a) => <button key={a} type="button" className="chip chip-accent" onClick={() => setEdit((e) => ({ ...e, areas: e.areas.filter((x) => x !== a) }))} title="Remove">{a} ✕</button>)}
                {edit.areas.length === 0 && <span className="t-mono-xs t-muted">none yet</span>}
              </div>
              <select className="select" value="" onChange={(e) => { addArea(e.target.value); }} style={{ maxWidth: 260 }}>
                <option value="">+ Add area…</option>
                {AREA_KEYS.filter((a) => !edit.areas.includes(a)).map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          )}

          {/* Preferred connectors (soft preference, by label). */}
          <div className="field">
            <span className="t-label">Preferred connectors <span className="t-muted" style={{ fontWeight: 400 }}>— MCP systems this skill expects</span></span>
            <div className="row gap-2" style={{ flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
              {edit.connectors.map((c) => <button key={c} type="button" className="chip chip-violet" onClick={() => setEdit((e) => ({ ...e, connectors: e.connectors.filter((x) => x !== c) }))} title="Remove">{c} ✕</button>)}
              {edit.connectors.length === 0 && <span className="t-mono-xs t-muted">none yet</span>}
            </div>
            <div className="row gap-2" style={{ alignItems: "center" }}>
              <input className="input" list="conn-suggest" value={connInput} placeholder="e.g. DeepWiki" style={{ maxWidth: 220 }}
                onChange={(e) => setConnInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addConn(connInput); } }} />
              <datalist id="conn-suggest">{CONNECTOR_SUGGESTIONS.map((c) => <option key={c} value={c} />)}</datalist>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => addConn(connInput)}>Add</button>
            </div>
          </div>

          {/* Playbook — edit / preview toggle + improve-with-AI. */}
          <div className="field">
            <div className="row-between" style={{ alignItems: "center", marginBottom: 4, flexWrap: "wrap", gap: 6 }}>
              <span className="t-label">Instructions (playbook)</span>
              <div className="row gap-2">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowImprove((v) => !v)} style={{ color: "var(--ac-text)" }}>✨ Improve with AI</button>
                <button type="button" className="btn btn-secondary btn-sm" style={!preview ? { background: "var(--fill-2)" } : undefined} onClick={() => setPreview(false)}>Edit</button>
                <button type="button" className="btn btn-secondary btn-sm" style={preview ? { background: "var(--fill-2)" } : undefined} onClick={() => setPreview(true)}>Preview</button>
              </div>
            </div>
            {showImprove && (
              <div className="card card-pad" style={{ background: "var(--panel-2)", marginBottom: 8 }}>
                <span className="t-label">What should change?</span>
                <textarea className="textarea" rows={2} value={improveAsk} onChange={(e) => setImproveAsk(e.target.value)} placeholder="e.g. Tighten it, add a step for pricing objections, make the tone more direct." />
                <div className="row gap-2" style={{ marginTop: 8 }}><button type="button" className="btn btn-sm" disabled={improving} onClick={() => improveWithAI(selSkill)} style={{ background: "var(--ac)", color: "#fff" }}>{improving ? "Improving…" : "Apply"}</button><button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowImprove(false)}>Cancel</button><span className="t-sub t-muted" style={{ fontSize: 11.5 }}>Rewrites the playbook below — review before saving.</span></div>
              </div>
            )}
            {preview
              ? <div className="card card-pad" style={{ background: "var(--panel-2)", minHeight: 120 }}>{edit.instructions.trim() ? <Markdown text={edit.instructions} /> : <span className="t-sub t-muted">Nothing to preview yet.</span>}</div>
              : <textarea className="textarea" rows={12} value={edit.instructions} onChange={(e) => setEdit({ ...edit, instructions: e.target.value })} placeholder="How the agent applies this skill — markdown supported." />}
          </div>

          <div className="row gap-2" style={{ marginTop: 4 }}><button className="btn btn-sm" onClick={() => saveSkill(selSkill)}>Save</button><button className="btn btn-secondary btn-sm" onClick={() => setSelected(null)}>Cancel</button></div>
        </>)}
      </Modal>

    </Section>
  );
}

// ---------- Alignment ----------
// Point this agent at the concrete WORK it is responsible for — specific
// initiatives or single tasks — not just broad areas. The binding is real
// (agent_alignments), so coverage is auditable and (phase 2) scopes what the
// agent sees in context.
function Alignment({ agentId, alignments, initiatives, workstreams, reload, setError }: { agentId: string; alignments: Alignment[]; initiatives: InitiativeOpt[]; workstreams: WorkstreamOpt[]; reload: () => void; setError: (s: string | null) => void }) {
  const supabase = createClient();
  const [sel, setSel] = useState("");
  const [role, setRole] = useState("watcher");
  const [guidance, setGuidance] = useState("");
  const [busy, setBusy] = useState(false);

  const alignedInit = new Set(alignments.filter((a) => a.kind === "initiative").map((a) => a.initiative_id));
  const alignedTask = new Set(alignments.filter((a) => a.kind === "task").map((a) => a.workstream_id));
  const openInits = initiatives.filter((i) => !alignedInit.has(i.id));
  const openTasks = workstreams.filter((w) => !alignedTask.has(w.id));

  async function add() {
    if (!sel) return;
    setBusy(true); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const [type, id] = sel.split(":");
      const row = type === "task"
        ? { org_id: orgId, agent_id: agentId, workstream_id: id, initiative_id: workstreams.find((w) => w.id === id)?.initiative_id ?? null, role, guidance: guidance.trim() || null }
        : { org_id: orgId, agent_id: agentId, initiative_id: id, role, guidance: guidance.trim() || null };
      const { error } = await supabase.from("agent_alignments").insert(row);
      if (error && (error as { code?: string }).code !== "23505") throw error;
      setSel(""); setGuidance(""); setRole("watcher"); reload();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not align."); }
    finally { setBusy(false); }
  }
  async function remove(id: string) { setError(null); await supabase.from("agent_alignments").delete().eq("id", id); reload(); }
  async function flipRole(a: Alignment) { setError(null); await supabase.from("agent_alignments").update({ role: a.role === "owner" ? "watcher" : "owner" }).eq("id", a.id); reload(); }

  const inits = alignments.filter((a) => a.kind === "initiative");
  const tasks = alignments.filter((a) => a.kind === "task");

  function row(a: Alignment) {
    return (
      <div key={a.id} className="card card-pad row-between" style={{ gap: 10, padding: "10px 12px" }}>
        <div style={{ minWidth: 0 }}>
          <div className="row gap-2" style={{ flexWrap: "wrap" }}>
            <span style={{ fontSize: 13.5, fontWeight: 620 }}>{a.title}</span>
            {a.sub && <Chip tone={a.kind === "task" ? (a.sub === "gtm" ? "violet" : "accent") : "default"}>{a.sub}</Chip>}
          </div>
          {a.guidance && <div className="t-sub t-muted" style={{ fontSize: 12, marginTop: 3 }}>{a.guidance}</div>}
        </div>
        <div className="row gap-2" style={{ flexShrink: 0 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => flipRole(a)} title="Toggle watcher / owner">
            {a.role === "owner" ? "● owner" : "○ watcher"}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => remove(a.id)} style={{ color: "var(--rd-text)" }}>Remove</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Section label="Aligned to">
        <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
          Point this agent at the work it answers for — whole initiatives or single tasks. <strong>Owner</strong> = accountable and proactive; <strong>watcher</strong> = keeps an eye and weighs in when asked.
        </div>
        {alignments.length === 0 ? (
          <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>Not aligned to any initiative or task yet.</div>
        ) : (
          <div className="stack-3" style={{ marginBottom: 12 }}>
            {inits.length > 0 && <>
              <div className="t-label" style={{ color: "var(--tm)" }}>Initiatives · {inits.length}</div>
              {inits.map(row)}
            </>}
            {tasks.length > 0 && <>
              <div className="t-label" style={{ color: "var(--tm)", marginTop: inits.length > 0 ? 8 : 0 }}>Tasks · {tasks.length}</div>
              {tasks.map(row)}
            </>}
          </div>
        )}

        {/* add a binding */}
        <div className="card card-pad" style={{ background: "var(--panel-2)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "var(--sp-3)" }}>
            <label className="field"><span className="t-label">Align to</span>
              <select className="select" value={sel} onChange={(e) => setSel(e.target.value)}>
                <option value="">— pick an initiative or task —</option>
                {openInits.length > 0 && (
                  <optgroup label="Initiatives">
                    {openInits.map((i) => <option key={i.id} value={`init:${i.id}`}>{i.title}{i.stage ? ` · ${i.stage}` : ""}</option>)}
                  </optgroup>
                )}
                {openTasks.length > 0 && (
                  <optgroup label="Tasks">
                    {openTasks.map((w) => <option key={w.id} value={`task:${w.id}`}>{w.initiative_title ? `${w.initiative_title} › ` : ""}{w.title}</option>)}
                  </optgroup>
                )}
              </select></label>
            <label className="field"><span className="t-label">Role</span>
              <select className="select" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="watcher">Watcher</option>
                <option value="owner">Owner</option>
              </select></label>
          </div>
          <label className="field"><span className="t-label">Focus (optional)</span>
            <input className="input" value={guidance} onChange={(e) => setGuidance(e.target.value)} placeholder="What should it watch for on this work?" /></label>
          <button className="btn btn-sm" onClick={add} disabled={busy || !sel}>{busy ? "Aligning…" : "+ Align"}</button>
        </div>
      </Section>
    </>
  );
}

// ---------- Scope — what the agent connects to & answers for ----------
// Consolidates the old Connections + Alignment under one internal-vs-external
// model: INTERNAL = SingleStack data areas + the work it's aligned to; EXTERNAL
// = MCP tools. One mental model: everything this agent can see and act on.
const ScopeHead = ({ title, blurb }: { title: string; blurb: string }) => (
  <div style={{ margin: "var(--sp-2) 0 var(--sp-3)" }}>
    <div className="t-h2" style={{ fontSize: 15 }}>{title}</div>
    <div className="t-sub t-muted" style={{ fontSize: 12.5, marginTop: 2 }}>{blurb}</div>
  </div>
);

function Scope({ agentId, connections, alignments, initiatives, workstreams, reload, setError }: {
  agentId: string; connections: Connection[]; alignments: Alignment[]; initiatives: InitiativeOpt[]; workstreams: WorkstreamOpt[]; reload: () => void; setError: (s: string | null) => void;
}) {
  const supabase = createClient();
  const [mcp, setMcp] = useState({ label: "", url: "", purpose: "", targets: "", token: "" });
  const [busy, setBusy] = useState(false);

  const haveArea = (area: string) => connections.some((c) => c.kind === "internal" && c.area === area);
  const internalConns = connections.filter((c) => c.kind === "internal");
  const mcpConns = connections.filter((c) => c.kind === "mcp");

  async function addInternal(area: string, label: string) {
    setError(null);
    const orgId = await getOrgId();
    if (!orgId) return;
    await supabase.from("connections").insert({ org_id: orgId, agent_id: agentId, kind: "internal", label, area, status: "connected" });
    reload();
  }
  async function addMcp(e: React.FormEvent) {
    e.preventDefault(); if (!mcp.label.trim() || !mcp.url.trim()) return;
    setBusy(true); setError(null);
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization.");
      // Pointing context: an MCP connection is only useful if the agent knows
      // WHERE to look (which reports/accounts/repos). Targets capture that.
      const targets = mcp.targets.split("\n").map((l) => l.trim()).filter(Boolean).map((ref) => ({ type: "ref", ref }));
      const { data: conn, error: connErr } = await supabase.from("connections").insert({
        org_id: orgId, agent_id: agentId, kind: "mcp", label: mcp.label.trim(), mcp_url: mcp.url.trim(),
        status: "manual", config: { purpose: mcp.purpose.trim() || null },
        guidance: mcp.purpose.trim() || null, targets,
      }).select("id").single();
      if (connErr) throw connErr;
      // The token goes to the secure store (never the connections row) via the
      // org-checked RPC. set_connection_secret also flips status to 'connected'.
      if (mcp.token.trim() && conn) {
        const { error: secErr } = await supabase.rpc("set_connection_secret", { p_connection: conn.id, p_token: mcp.token.trim() });
        if (secErr) throw secErr;
      }
      setMcp({ label: "", url: "", purpose: "", targets: "", token: "" }); reload();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not add connection."); }
    finally { setBusy(false); }
  }
  async function remove(id: string) { setError(null); await supabase.from("connections").delete().eq("id", id); reload(); }

  return (
    <>
      <ScopeHead title="Internal" blurb="What this agent sees inside SingleStack, and the work it answers for." />
      <Section label="Data areas">
        <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>Give this agent access to areas of SingleStack to reason over.</div>
        <div className="row gap-2" style={{ flexWrap: "wrap" }}>
          {INTERNAL_AREAS.map((a) => (
            <button key={a.area} className={`btn btn-sm ${haveArea(a.area) ? "btn-secondary" : ""}`} disabled={haveArea(a.area)} onClick={() => addInternal(a.area, a.label)}>
              {haveArea(a.area) ? `${a.label} ✓` : `+ ${a.label}`}
            </button>
          ))}
        </div>
        {internalConns.length > 0 && (
          <div className="stack-3" style={{ marginTop: "var(--sp-3)" }}>
            {internalConns.map((c) => <ConnRow key={c.id} c={c} onRemove={remove} reload={reload} setError={setError} />)}
          </div>
        )}
      </Section>

      {/* Aligned work — the concrete initiatives/tasks this agent owns or watches. */}
      <Alignment agentId={agentId} alignments={alignments} initiatives={initiatives} workstreams={workstreams} reload={reload} setError={setError} />

      <ScopeHead title="External" blurb="Tools this agent reaches outside SingleStack, via MCP." />
      <Section label="External tools (MCP)">
        <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>Connect an MCP server so this agent can use external tools (web search, GitHub, your own). <strong>Live now</strong> — a connected server&rsquo;s tools run inside the agent&rsquo;s loop. Add a token for secured servers (kept in a locked store, never shown again, passed only to the model at run time). Whatever it gathers still flows through the review queue.</div>
        {/* Prebuilt connectors — one click prefills the form below; add your token, then Add. */}
        <div className="t-label" style={{ color: "var(--tm)", marginBottom: 6 }}>Prebuilt connectors</div>
        <div className="row gap-2" style={{ flexWrap: "wrap", marginBottom: "var(--sp-3)" }}>
          {CONNECTOR_CATALOG.map((c) => (
            <button key={c.key} className="btn btn-secondary btn-sm" title={`${c.blurb}${c.needsAuth ? " (needs an auth token)" : ""}`}
              onClick={() => setMcp({ label: c.name, url: c.url, purpose: c.blurb, targets: "", token: "" })}>+ {c.name}</button>
          ))}
        </div>

        <form onSubmit={addMcp} className="card card-pad" style={{ marginBottom: "var(--sp-3)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "var(--sp-3)" }}>
            <label className="field"><span className="t-label">Name</span><input className="input" value={mcp.label} onChange={(e) => setMcp({ ...mcp, label: e.target.value })} placeholder="e.g. Web search" /></label>
            <label className="field"><span className="t-label">MCP server URL</span><input className="input mono" value={mcp.url} onChange={(e) => setMcp({ ...mcp, url: e.target.value })} placeholder="https://…/mcp" /></label>
          </div>
          <label className="field"><span className="t-label">What it does in SingleStack</span>
            <input className="input" value={mcp.purpose} onChange={(e) => setMcp({ ...mcp, purpose: e.target.value })} placeholder="e.g. Pulls competitor releases into external signals; used by the CRO agent for battlecards." /></label>
          <label className="field"><span className="t-label">Point it at specifics — where to look (one per line)</span>
            <textarea className="textarea" rows={3} value={mcp.targets} onChange={(e) => setMcp({ ...mcp, targets: e.target.value })} placeholder={"e.g. report: Win/Loss by Competitor\naccount: Acme Corp\nopportunity stage: Negotiation"} /></label>
          <label className="field"><span className="t-label">Auth token <span className="t-muted" style={{ fontWeight: 400 }}>— optional; for secured servers. Stored locked; not shown again.</span></span>
            <input className="input mono" type="password" autoComplete="off" value={mcp.token} onChange={(e) => setMcp({ ...mcp, token: e.target.value })} placeholder="Bearer token (leave blank for public servers)" /></label>
          <div className="t-sub t-muted" style={{ fontSize: 11.5, marginBottom: 8 }}>Connecting Salesforce isn’t enough — tell the agent which reports, accounts, and opportunities to consult. This is the difference between a connection and a useful one.</div>
          <button className="btn btn-sm" type="submit" disabled={busy}>{busy ? "Adding…" : "+ Add MCP connection"}</button>
        </form>
        {mcpConns.length > 0 && (
          <div className="stack-3">
            {mcpConns.map((c) => <ConnRow key={c.id} c={c} onRemove={remove} reload={reload} setError={setError} />)}
          </div>
        )}
      </Section>
    </>
  );
}

// A connected area/tool, with an inline "curate" editor for guidance + targets —
// what to watch/prioritize/ignore and which specifics to consult.
function ConnRow({ c, onRemove, reload, setError }: { c: Connection; onRemove: (id: string) => void; reload: () => void; setError: (s: string | null) => void }) {
  const supabase = createClient();
  const [editing, setEditing] = useState(false);
  const [guidance, setGuidance] = useState(c.guidance ?? "");
  const [targets, setTargets] = useState((c.targets ?? []).map((t) => t.ref).join("\n"));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true); setError(null);
    const tg = targets.split("\n").map((l) => l.trim()).filter(Boolean).map((ref) => ({ type: "ref", ref }));
    const { error } = await supabase.from("connections").update({ guidance: guidance.trim() || null, targets: tg }).eq("id", c.id);
    if (error) setError(error.message); else { setEditing(false); reload(); }
    setBusy(false);
  }

  return (
    <div className="card card-pad">
      <div className="row-between" style={{ alignItems: "flex-start", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div className="row gap-2">
            <Chip tone={c.kind === "internal" ? "accent" : "violet"}>{c.kind === "internal" ? "internal" : "MCP"}</Chip>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{c.label}</span>
            <Chip tone={c.status === "connected" ? "green" : "default"}>{c.status === "connected" ? "live" : "declared"}</Chip>
          </div>
          {c.mcp_url && <div className="mono t-muted" style={{ fontSize: 11, marginTop: 4 }}>{c.mcp_url}</div>}
          {c.guidance && <div className="t-sub" style={{ fontSize: 12.5, marginTop: 4 }}>🧭 {c.guidance}</div>}
          {(c.targets?.length ?? 0) > 0 && (
            <div className="t-sub t-muted" style={{ fontSize: 11.5, marginTop: 4 }}>🎯 Watches: {c.targets!.map((t) => t.ref).join(" · ")}</div>
          )}
        </div>
        <div className="row gap-2" style={{ flexShrink: 0 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setEditing((v) => !v)}>{editing ? "Cancel" : "Curate"}</button>
          <button className="btn btn-secondary btn-sm" onClick={() => onRemove(c.id)}>Remove</button>
        </div>
      </div>
      {editing && (
        <div style={{ marginTop: 10 }}>
          <label className="field"><span className="t-label">What to watch / prioritize / ignore</span>
            <textarea className="textarea" rows={2} value={guidance} onChange={(e) => setGuidance(e.target.value)} placeholder="e.g. Focus on pricing & competitive signals; weight escalating themes; ignore low-confidence noise." /></label>
          <label className="field"><span className="t-label">Point at specifics (one per line)</span>
            <textarea className="textarea" rows={2} value={targets} onChange={(e) => setTargets(e.target.value)} placeholder={"theme: Pricing friction\ncompetitor: Crayon\ncapability area: orchestration"} /></label>
          <button className="btn btn-sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save curation"}</button>
        </div>
      )}
    </div>
  );
}

// ---------- Workflows (the workflows this agent participates in) ----------
type AgentWorkflow = { id: string; name: string; description: string | null; is_active: boolean; stepCount: number };
function Workflows({ workflows }: { workflows: AgentWorkflow[] }) {
  return (
    <Section label="Workflows" action={<a className="btn btn-secondary btn-sm" href="/agents?tab=workflows">Manage workflows</a>}>
      <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>The workflows this agent runs in — as owner, or as a step in a chain. Author and edit them over in <a href="/agents?tab=workflows" style={{ color: "var(--ac-text)", fontWeight: 600 }}>Workflows</a>.</div>
      {workflows.length === 0 ? (
        <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 10 }}>Not part of any workflow yet.</div>
      ) : (
        <div className="stack-3">
          {workflows.map((w) => (
            <div key={w.id} className="card card-pad row-between" style={{ gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div className="row gap-2" style={{ alignItems: "center" }}>
                  <a href="/agents?tab=workflows" style={{ fontSize: 14, fontWeight: 620, color: "var(--tp)" }}>{w.name}</a>
                  {!w.is_active && <Chip tone="amber">inactive</Chip>}
                  <span className="t-mono-xs t-muted">{w.stepCount} step{w.stepCount === 1 ? "" : "s"}</span>
                </div>
                {w.description && <div className="t-sub t-muted" style={{ fontSize: 12.5, marginTop: 2 }}>{w.description}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ---------- Evolve from signals (recursive skill evolution) ----------
type Revision = { skill_id: string; name: string; category: string | null; current_instructions: string; proposed_instructions: string; rationale: string; drivers: string[] };
type NewSkill = { name: string; description: string; category: string; instructions: string; areas?: string[]; connectors?: string[]; rationale: string; drivers: string[] };
type NewDraft = { name: string; category: string; instructions: string };

function EvolvePanel({ agentId, onApplied, onClose, setError }: { agentId: string; onApplied: () => void; onClose: () => void; setError: (s: string | null) => void }) {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [revs, setRevs] = useState<Revision[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [applying, setApplying] = useState<string | null>(null);
  const [news, setNews] = useState<(NewSkill & { uid: string })[]>([]);
  const [newDrafts, setNewDrafts] = useState<Record<string, NewDraft>>({});
  const [applyingNew, setApplyingNew] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true); setError(null); setNote(null);
    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      const { data, error } = await supabase.functions.invoke("evolve-skills", {
        body: { agent_id: agentId },
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const rs: Revision[] = data?.revisions ?? [];
      const ns: NewSkill[] = data?.new_skills ?? [];
      setRevs(rs);
      setDrafts(Object.fromEntries(rs.map((r) => [r.skill_id, r.proposed_instructions])));
      const withUid = ns.map((n, i) => ({ ...n, uid: `new-${i}` }));
      setNews(withUid);
      setNewDrafts(Object.fromEntries(withUid.map((n) => [n.uid, { name: n.name, category: n.category, instructions: n.instructions }])));
      if (rs.length === 0 && ns.length === 0) setNote(data?.message ?? "No skill changes warranted by current intelligence. Your playbooks are up to date.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not evolve skills."); }
    finally { setLoading(false); }
  }, [supabase, agentId, setError]);

  useEffect(() => { run(); }, [run]);

  async function accept(r: Revision) {
    setApplying(r.skill_id); setError(null);
    try {
      const { error } = await supabase.rpc("apply_skill_evolution", {
        p_skill: r.skill_id,
        p_instructions: drafts[r.skill_id] ?? r.proposed_instructions,
        p_drivers: r.drivers.map((d) => ({ kind: "intelligence", title: d })),
        p_note: r.rationale,
      });
      if (error) throw error;
      setRevs((prev) => prev.filter((x) => x.skill_id !== r.skill_id));
      onApplied();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not apply evolution."); }
    finally { setApplying(null); }
  }
  function dismiss(id: string) { setRevs((prev) => prev.filter((x) => x.skill_id !== id)); }

  async function acceptNew(n: NewSkill & { uid: string }) {
    const d = newDrafts[n.uid] ?? { name: n.name, category: n.category, instructions: n.instructions };
    if (!d.name.trim() || !d.instructions.trim()) { setError("New skill needs a name and instructions."); return; }
    setApplyingNew(n.uid); setError(null);
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization.");
      const base = d.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `skill_${Date.now()}`;
      // Create with no instructions first, then evolve them in — so the skill's
      // first revision is provenance-tagged 'evolved' (born from these signals).
      const newCols = { description: n.description?.trim() || null, category: d.category, source: "evolved", areas: n.areas ?? [], connectors: n.connectors ?? [] };
      let { data: created, error: insErr } = await supabase.from("skills")
        .insert({ org_id: orgId, key: base, name: d.name.trim(), instructions: null, ...newCols })
        .select("id").single();
      if (insErr && (insErr as { code?: string }).code === "23505") {
        ({ data: created, error: insErr } = await supabase.from("skills")
          .insert({ org_id: orgId, key: `${base}_${Date.now().toString(36)}`, name: d.name.trim(), instructions: null, ...newCols })
          .select("id").single());
      }
      if (insErr) throw insErr;
      await supabase.from("agent_skills").insert({ org_id: orgId, agent_id: agentId, skill_id: created!.id });
      const { error: rpcErr } = await supabase.rpc("apply_skill_evolution", {
        p_skill: created!.id, p_instructions: d.instructions, p_drivers: n.drivers.map((x) => ({ kind: "intelligence", title: x })), p_note: n.rationale,
      });
      if (rpcErr) throw rpcErr;
      setNews((prev) => prev.filter((x) => x.uid !== n.uid));
      onApplied();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create skill."); }
    finally { setApplyingNew(null); }
  }
  function dismissNew(uid: string) { setNews((prev) => prev.filter((x) => x.uid !== uid)); }

  return (
    <div className="card card-pad" style={{ marginBottom: "var(--sp-3)", borderColor: "var(--ac)", background: "var(--ac-fill)" }}>
      <div className="row-between" style={{ marginBottom: 10 }}>
        <div className="row gap-2"><span style={{ fontWeight: 660 }}>Evolve skills from signals</span></div>
        <div className="row gap-2">
          <button className="btn btn-secondary btn-sm" onClick={run} disabled={loading}>{loading ? "Analyzing…" : "Re-run"}</button>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
        </div>
      </div>

      {loading && <div className="t-sub t-muted">Reading this agent's intelligence and proposing playbook updates…</div>}
      {!loading && note && <div className="t-sub" style={{ fontSize: 13 }}>{note}</div>}

      <div className="stack-3">
        {revs.map((r) => (
          <div key={r.skill_id} className="card card-pad" style={{ background: "var(--panel)" }}>
            <div className="row gap-2" style={{ marginBottom: 6 }}>
              <Chip tone="accent">revise</Chip>
              <span style={{ fontSize: 14, fontWeight: 640 }}>{r.name}</span>
              {r.category && <Chip tone={r.category === "product" ? "accent" : r.category === "gtm" ? "violet" : "default"}>{r.category}</Chip>}
            </div>
            <div className="t-sub" style={{ fontSize: 12.5, marginBottom: 8 }}><strong>Why:</strong> {r.rationale}</div>
            {r.drivers.length > 0 && (
              <div className="row gap-2" style={{ flexWrap: "wrap", marginBottom: 8 }}>
                {r.drivers.map((d, i) => <Chip key={i} tone="default">{d}</Chip>)}
              </div>
            )}
            <details style={{ marginBottom: 8 }}>
              <summary className="t-sub t-muted" style={{ fontSize: 12, cursor: "pointer" }}>Current instructions</summary>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, color: "var(--ts)", marginTop: 6, fontFamily: "inherit" }}>{r.current_instructions || "(none yet)"}</pre>
            </details>
            <label className="field"><span className="t-label">Proposed instructions (edit before accepting)</span>
              <textarea className="textarea" rows={8} value={drafts[r.skill_id] ?? ""} onChange={(e) => setDrafts({ ...drafts, [r.skill_id]: e.target.value })} /></label>
            <div className="row gap-2">
              <button className="btn btn-success btn-sm" onClick={() => accept(r)} disabled={applying === r.skill_id}>{applying === r.skill_id ? "Applying…" : "Accept & evolve"}</button>
              <button className="btn btn-secondary btn-sm" onClick={() => dismiss(r.skill_id)} disabled={applying === r.skill_id}>Dismiss</button>
            </div>
          </div>
        ))}

        {news.map((n) => {
          const d = newDrafts[n.uid] ?? { name: n.name, category: n.category, instructions: n.instructions };
          return (
            <div key={n.uid} className="card card-pad" style={{ background: "var(--panel)", borderColor: "var(--gn)" }}>
              <div className="row gap-2" style={{ marginBottom: 6 }}>
                <Chip tone="green">new skill</Chip>
                <span className="t-sub t-muted" style={{ fontSize: 12 }}>a capability this agent doesn&apos;t have yet</span>
              </div>
              <div className="t-sub" style={{ fontSize: 12.5, marginBottom: 8 }}><strong>Why:</strong> {n.rationale}</div>
              {n.drivers.length > 0 && (
                <div className="row gap-2" style={{ flexWrap: "wrap", marginBottom: 8 }}>
                  {n.drivers.map((x, i) => <Chip key={i} tone="default">{x}</Chip>)}
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "var(--sp-3)" }}>
                <label className="field"><span className="t-label">Name</span>
                  <input className="input" value={d.name} onChange={(e) => setNewDrafts({ ...newDrafts, [n.uid]: { ...d, name: e.target.value } })} /></label>
                <label className="field"><span className="t-label">Category</span>
                  <select className="select" value={d.category} onChange={(e) => setNewDrafts({ ...newDrafts, [n.uid]: { ...d, category: e.target.value } })}>
                    <option value="general">General</option><option value="product">Product</option><option value="gtm">GTM</option><option value="research">Research</option>
                  </select></label>
              </div>
              <label className="field"><span className="t-label">Instructions / playbook (edit before accepting)</span>
                <textarea className="textarea" rows={8} value={d.instructions} onChange={(e) => setNewDrafts({ ...newDrafts, [n.uid]: { ...d, instructions: e.target.value } })} /></label>
              <div className="row gap-2">
                <button className="btn btn-success btn-sm" onClick={() => acceptNew(n)} disabled={applyingNew === n.uid}>{applyingNew === n.uid ? "Creating…" : "Create & attach"}</button>
                <button className="btn btn-secondary btn-sm" onClick={() => dismissNew(n.uid)} disabled={applyingNew === n.uid}>Dismiss</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Skill revision history ----------
type Rev = { id: string; created_at: string; instructions: string | null; source: string; drivers: { kind?: string; title: string }[] | null; note: string | null };

function SkillHistory({ skill, onClose }: { skill: Skill; onClose: () => void }) {
  const supabase = createClient();
  const [revs, setRevs] = useState<Rev[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("skill_revisions").select("id, created_at, instructions, source, drivers, note").eq("skill_id", skill.id).order("created_at", { ascending: false });
      setRevs(data ?? []); setLoading(false);
    })();
  }, [supabase, skill.id]);
  return (
    <Modal open onClose={onClose} title={`History · ${skill.name}`} width={620}>
      {loading ? <div className="t-sub t-muted">Loading…</div> : revs.length === 0 ? (
        <div className="t-sub t-muted">No revisions yet. This skill hasn't changed since it was created.</div>
      ) : (
        <div className="stack-3">
          {revs.map((r, i) => (
            <div key={r.id} className="card card-pad">
              <div className="row gap-2" style={{ marginBottom: 6 }}>
                <Chip tone={r.source === "evolved" ? "accent" : "default"}>{r.source === "evolved" ? "evolved from signals" : r.source}</Chip>
                {i === 0 && <Chip tone="green">current</Chip>}
                <span className="t-sub t-muted mono" style={{ fontSize: 11 }}>{new Date(r.created_at).toLocaleString()}</span>
              </div>
              {r.note && <div className="t-sub" style={{ fontSize: 12.5, marginBottom: 6 }}><strong>Why:</strong> {r.note}</div>}
              {(r.drivers?.length ?? 0) > 0 && (
                <div className="row gap-2" style={{ flexWrap: "wrap", marginBottom: 6 }}>
                  {r.drivers!.map((d, j) => <Chip key={j}>{d.title}</Chip>)}
                </div>
              )}
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, color: "var(--ts)", fontFamily: "inherit", margin: 0 }}>{r.instructions || "(empty)"}</pre>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
