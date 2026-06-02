// Demo seed — loads a coherent sample workspace so the whole AI loop has
// something real to run on: a product + GTM record, SIGNALS (the fuel —
// GTM, market, and capability), durable themes, and skills attached to the
// executive agents with their area connections. Runs client-side with the
// user's session, so every write lands in their org under RLS. Idempotent:
// bails if the sample product already exists.
import type { SupabaseClient } from "@supabase/supabase-js";
import { EXECUTIVE_TEAM } from "@/lib/team";

const DEMO_PRODUCT = "Atlas";
const AREA_LABEL: Record<string, string> = { products: "Product records", gtm: "GTM records", signals: "Signals", records: "All records" };

export async function loadDemoData(supabase: SupabaseClient, orgId: string): Promise<{ created: boolean; message: string }> {
  // Idempotency marker.
  const { data: existing } = await supabase.from("product_records").select("id").eq("name", DEMO_PRODUCT).maybeSingle();
  if (existing) return { created: false, message: "Sample workspace already loaded." };

  const now = Date.now();
  const iso = (hoursAgo: number) => new Date(now - hoursAgo * 3600_000).toISOString();

  // 1) Ensure the executive agents exist.
  const { data: ag0 } = await supabase.from("agents").select("id, key").eq("is_active", true);
  const have = new Set((ag0 ?? []).map((a) => a.key));
  const toAdd = EXECUTIVE_TEAM.filter((e) => !have.has(e.key)).map((e) => ({ org_id: orgId, key: e.key, name: e.name, role: e.role, model: "claude-opus-4-8", system_prompt: e.system_prompt, is_active: true }));
  if (toAdd.length) { const { error } = await supabase.from("agents").insert(toAdd); if (error) throw error; }
  const { data: agents } = await supabase.from("agents").select("id, key").eq("is_active", true);
  const agentId = (key: string) => agents?.find((a) => a.key === key)?.id as string | undefined;

  // 2) Connect each officer to its areas (the runtime scoping) — skip dupes.
  const { data: existingConns } = await supabase.from("connections").select("agent_id, area").eq("kind", "internal");
  const connKey = (aid: string, area: string) => `${aid}:${area}`;
  const haveConn = new Set((existingConns ?? []).map((c) => connKey(c.agent_id, c.area)));
  const wiring: [string, string[]][] = [["cpo", ["products", "signals"]], ["ceng", ["products", "signals"]], ["cro", ["gtm", "signals"]], ["cco", ["gtm", "signals"]], ["cos", ["records"]]];
  const conns: Record<string, unknown>[] = [];
  for (const [key, areas] of wiring) {
    const aid = agentId(key); if (!aid) continue;
    for (const area of areas) { if (!haveConn.has(connKey(aid, area))) conns.push({ org_id: orgId, agent_id: aid, kind: "internal", label: AREA_LABEL[area], area, status: "connected" }); }
  }
  if (conns.length) await supabase.from("connections").insert(conns);

  // 3) Product record + fields + modules + features.
  const { data: prod, error: pErr } = await supabase.from("product_records").insert({ org_id: orgId, name: DEMO_PRODUCT }).select("id").single();
  if (pErr) throw pErr;
  const productId = prod.id as string;

  await supabase.from("record_fields").insert([
    ["overview", "Overview", "Atlas is an AI operating layer for product & go-to-market teams: a single source of truth where executive agents keep your product and messaging current as the market moves.", 0],
    ["target_market", "Target market", "Series A–C B2B software companies (20–200 people) where product and GTM drift apart and no one owns keeping them aligned.", 1],
    ["value_prop", "Value proposition", "Your strategy stays current automatically. Agents watch signals, propose sharp updates, and you ratify — so the record and messaging never go stale.", 2],
    ["positioning", "Positioning", "Not another doc tool or BI dashboard — a living system of record that proposes change, with humans in the loop.", 3],
    ["key_metrics", "Key metrics", "Design partners: 6 · Weekly active operators: 41 · Proposals ratified/wk: 28", 4],
  ].map(([field_key, label, value, position]) => ({ org_id: orgId, product_id: productId, field_key, label, value, position })));

  const modDefs = [
    { name: "Intelligence", description: "Signals, themes, and the honest-confidence engine that turns evidence into durable patterns.", features: ["Signal capture", "Theme reconciliation", "Honest confidence"] },
    { name: "Agents", description: "Executive agents with tailorable skills, area connections, and workflows.", features: ["Skill library", "Roster orchestration", "Recursive skill evolution"] },
    { name: "Records", description: "Living product & GTM records that move only when a human ratifies a proposal.", features: ["Structured fields", "Proposals & ratification", "Revision history"] },
  ];
  for (const m of modDefs) {
    const { data: mod } = await supabase.from("modules").insert({ org_id: orgId, product_id: productId, name: m.name, description: m.description }).select("id").single();
    if (mod) await supabase.from("features").insert(m.features.map((name) => ({ org_id: orgId, module_id: mod.id, name })));
  }

  // 4) GTM record + fields.
  const { data: gtm, error: gErr } = await supabase.from("gtm_records").insert({ org_id: orgId, product_id: productId, name: "Homepage hero · messaging" }).select("id").single();
  if (gErr) throw gErr;
  const gtmId = gtm.id as string;
  await supabase.from("record_fields").insert([
    ["hero", "Hero", "Your strategy, kept current by agents you control.", 0],
    ["personas", "Personas", "Heads of Product, founders, and RevOps leads at scaling B2B software companies.", 1],
    ["positioning", "Positioning", "A living system of record — not a doc, not a dashboard. It proposes change; you ratify.", 2],
    ["objections", "Objections", "“Is this just another AI wrapper?” — No: humans ratify every change; nothing moves on its own.", 3],
  ].map(([field_key, label, value, position]) => ({ org_id: orgId, gtm_record_id: gtmId, field_key, label, value, position })));

  // 5) SIGNALS — the fuel. GTM (on the record), market, and capability.
  await supabase.from("signals").insert([
    ["Prospects bounce on the pricing page after the demo", "Three design partners said pricing tiers were unclear post-demo; two stalled.", 0.82, "High", 6],
    ["“Is it just an AI wrapper?” keeps surfacing", "Recurring first-call objection — the human-in-the-loop control isn't landing in our messaging.", 0.78, "High", 22],
    ["Founders resonate with “living system of record”", "The phrase consistently lands with founders in discovery; product leads less so.", 0.66, "Medium", 50],
    ["Demo-to-trial drop-off on mobile", "Hero CTA underperforms on mobile; analytics show ~40% lower trial starts.", 0.7, "Medium", 73],
  ].map(([title, why, conf_level, conf_label, h]) => ({ org_id: orgId, scope: "gtm", gtm_record_id: gtmId, title, why, conf_level, conf_label, observed_at: iso(h as number) })));

  await supabase.from("signals").insert([
    ["Analysts reframing “AI copilots” as “AI operating layers”", "industry", "A leading analyst note argues the category is shifting from assistants to systems of record.", 0.6, "Medium", 30],
    ["Buyers now expect human-in-the-loop governance", "persona", "Procurement increasingly asks how AI-driven changes are reviewed and audited.", 0.72, "High", 54],
    ["Funding flowing to “agent orchestration” startups", "analysts", "Several raises this quarter centered explicitly on multi-agent orchestration.", 0.55, "Medium", 100],
  ].map(([title, lens, why, conf_level, conf_label, h]) => ({ org_id: orgId, scope: "org", title, why, conf_level, conf_label, observed_at: iso(h as number), metadata: { domain: "market", lens } })));

  await supabase.from("signals").insert([
    ["Claude ships tool orchestration", "Native multi-tool orchestration lets a single agent plan and run multi-step tasks.", "orchestration", 12],
    ["Claude adds long-term memory", "Agents can persist and recall context across sessions.", "memory", 40],
    ["Claude computer use", "Agents can operate software UIs directly.", "computer-use", 120],
  ].map(([title, why, area, h]) => ({ org_id: orgId, scope: "org", title, why, observed_at: iso(h as number), metadata: { domain: "capability", provider: "anthropic", area } })));

  // 6) Skills + attach to the right officers (so evolve/orchestrate have inputs).
  const skillDefs: { key: string; name: string; description: string; category: string; instructions: string; agents: string[] }[] = [
    { key: "demo_positioning_sharpening", name: "Positioning sharpening", category: "product", description: "Tighten how the product is positioned against alternatives.", instructions: "Sharpen positioning to be specific and defensible. Lead with the category we're reframing, name the alternative we are NOT, and ground every claim in a signal. Avoid hype; prefer concrete proof.", agents: ["cpo"] },
    { key: "demo_roadmap_prioritization", name: "Roadmap prioritization", category: "product", description: "Decide what to build next from evidence.", instructions: "Prioritize by corroborated demand (escalating themes), strategic fit, and buildability. Recommend the smallest change that moves the metric; cite the signals behind it.", agents: ["cpo"] },
    { key: "demo_architecture_review", name: "Architecture review", category: "general", description: "Keep technical claims precise and buildable.", instructions: "Review technical fields for accuracy and feasibility. Flag risk, keep stack/integration detail precise, and separate what's buildable now from later. Watch platform capabilities for what's newly possible.", agents: ["ceng"] },
    { key: "demo_competitive_battlecard", name: "Competitive battlecard", category: "gtm", description: "Equip GTM to win against alternatives.", instructions: "Frame the win: where we're clearly better, where to reframe, and the proof. Ground in competitive and market signals; keep it honest and specific.", agents: ["cro"] },
    { key: "demo_persona_messaging", name: "Persona messaging", category: "gtm", description: "Tune messaging to each buyer.", instructions: "Match the message to the persona. Lead with the outcome they care about, address their top objection, and use language pulled from real signals.", agents: ["cro"] },
    { key: "demo_narrative_voice", name: "Narrative & brand voice", category: "gtm", description: "Keep the story consistent and compelling.", instructions: "Keep the narrative consistent across records: confident, concrete, human-in-the-loop. Avoid AI hype; emphasize control and living truth.", agents: ["cco"] },
  ];
  for (const s of skillDefs) {
    let { data: sk } = await supabase.from("skills").insert({ org_id: orgId, key: s.key, name: s.name, description: s.description, category: s.category, instructions: s.instructions, source: "template" }).select("id").maybeSingle();
    if (!sk) { const { data: found } = await supabase.from("skills").select("id").eq("key", s.key).maybeSingle(); sk = found; }
    if (sk) {
      const rows = s.agents.map((k) => agentId(k)).filter(Boolean).map((aid) => ({ org_id: orgId, agent_id: aid, skill_id: sk!.id }));
      if (rows.length) await supabase.from("agent_skills").insert(rows);
    }
  }

  // 7) Durable themes — so Evolve & the Chief of Staff have patterns to act on.
  await supabase.from("signal_themes").insert([
    { category: "product", state: "escalating", momentum: "accelerating", conf_level: 0.74, title: "Buyers expect built-in agent orchestration", summary: "Demand is shifting from single assistants to multi-agent orchestration; analysts and funding corroborate.", recommendation: "Make orchestration a first-class, demoable capability; evolve engineering skills to leverage new platform features." },
    { category: "gtm", state: "active", momentum: "steady", conf_level: 0.7, title: "Pricing & “AI wrapper” objections create demo-to-trial friction", summary: "Two recurring post-demo blockers: unclear pricing and skepticism that we're 'just a wrapper'.", recommendation: "Lead messaging with human-in-the-loop control; clarify pricing tiers on the hero path." },
    { category: "product", state: "escalating", momentum: "accelerating", conf_level: 0.68, title: "Frontier capabilities reset table stakes each quarter", summary: "New Claude capabilities (orchestration, memory, computer use) keep changing what's expected of an 'AI operating layer'.", recommendation: "Continuously evolve agent skills to leverage new capabilities; treat capability releases as signals." },
  ].map((t) => ({ org_id: orgId, ...t, domain: "signals", last_evidence_at: iso(8) })));

  return { created: true, message: "Sample workspace loaded — product, GTM, signals, capabilities, skills & themes." };
}
