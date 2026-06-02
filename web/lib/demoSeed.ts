// Dogfood seed — loads SingleStack's OWN workspace so we use SingleStack to
// build SingleStack. It populates the things the AI loop runs on: the product
// record, a GTM record, SIGNALS (GTM + market), real COMPETITORS, frontier
// CAPABILITIES (which feed the Frontier Models space), durable themes, and
// skills attached to the executive agents with their area connections
// (including the frontier-models area, so every officer can act on capabilities).
//
// IMPORTANT: this is DATA, not product behavior. The platform stays fully
// product-agnostic — nothing here is hardcoded into the app. It writes to the
// caller's org under RLS and is idempotent (bails if the product already exists).
import type { SupabaseClient } from "@supabase/supabase-js";
import { EXECUTIVE_TEAM } from "@/lib/team";

const DEMO_PRODUCT = "SingleStack";
const AREA_LABEL: Record<string, string> = { products: "Product records", gtm: "GTM records", signals: "Signals", capabilities: "Frontier models & capabilities", records: "All records" };

export async function loadDemoData(supabase: SupabaseClient, orgId: string): Promise<{ created: boolean; message: string }> {
  const { data: existing } = await supabase.from("product_records").select("id").eq("name", DEMO_PRODUCT).maybeSingle();
  if (existing) return { created: false, message: "SingleStack workspace already loaded." };

  const now = Date.now();
  const iso = (hoursAgo: number) => new Date(now - hoursAgo * 3600_000).toISOString();

  // 1) Ensure the executive agents exist.
  const { data: ag0 } = await supabase.from("agents").select("id, key").eq("is_active", true);
  const have = new Set((ag0 ?? []).map((a) => a.key));
  const toAdd = EXECUTIVE_TEAM.filter((e) => !have.has(e.key)).map((e) => ({ org_id: orgId, key: e.key, name: e.name, role: e.role, model: "claude-opus-4-8", system_prompt: e.system_prompt, is_active: true }));
  if (toAdd.length) { const { error } = await supabase.from("agents").insert(toAdd); if (error) throw error; }
  const { data: agents } = await supabase.from("agents").select("id, key").eq("is_active", true);
  const agentId = (key: string) => agents?.find((a) => a.key === key)?.id as string | undefined;

  // 2) Connect each officer to its areas — including FRONTIER MODELS, so every
  //    officer (not just engineering) can act on new capabilities. Skip dupes.
  const { data: existingConns } = await supabase.from("connections").select("agent_id, area").eq("kind", "internal");
  const ck = (aid: string, area: string) => `${aid}:${area}`;
  const haveConn = new Set((existingConns ?? []).map((c) => ck(c.agent_id, c.area)));
  const wiring: [string, string[]][] = [
    ["cpo", ["products", "signals", "capabilities"]],
    ["ceng", ["products", "signals", "capabilities"]],
    ["cro", ["gtm", "signals", "capabilities"]],
    ["cco", ["gtm", "signals", "capabilities"]],
    ["cos", ["records", "capabilities"]],
  ];
  const conns: Record<string, unknown>[] = [];
  for (const [key, areas] of wiring) {
    const aid = agentId(key); if (!aid) continue;
    for (const area of areas) if (!haveConn.has(ck(aid, area))) conns.push({ org_id: orgId, agent_id: aid, kind: "internal", label: AREA_LABEL[area], area, status: "connected" });
  }
  if (conns.length) await supabase.from("connections").insert(conns);

  // 3) Product record (SingleStack itself) + fields + modules + features.
  const { data: prod, error: pErr } = await supabase.from("product_records").insert({ org_id: orgId, name: DEMO_PRODUCT }).select("id").single();
  if (pErr) throw pErr;
  const productId = prod.id as string;

  await supabase.from("record_fields").insert([
    ["overview", "Overview", "SingleStack is an AI operating layer for product & go-to-market teams: a single, living system of record where executive agents keep your product and messaging current as the market moves — and nothing changes without a human ratifying it.", 0],
    ["target_market", "Target market", "Series A–C B2B software companies (20–200 people) where product and GTM drift apart and no one owns keeping them aligned.", 1],
    ["value_prop", "Value proposition", "Your strategy stays current automatically. Agents watch signals, propose sharp updates, and you ratify — so the record and messaging never go stale, and you can leverage new frontier-model capabilities as they ship.", 2],
    ["positioning", "Positioning", "Not a roadmapping tool (Aha!), not a competitive-intel feed (Crayon/Klue), not call analytics (Gong) — a living system of record that unifies product + GTM and proposes change, human-in-the-loop.", 3],
    ["key_metrics", "Key metrics", "Design partners: 6 · Weekly active operators: 41 · Proposals ratified/wk: 28", 4],
  ].map(([field_key, label, value, position]) => ({ org_id: orgId, product_id: productId, field_key, label, value, position })));

  const modDefs = [
    { name: "Intelligence", description: "Signals, themes, and the honest-confidence engine that turns evidence into durable patterns.", features: ["Signal capture", "Theme reconciliation", "Honest confidence"] },
    { name: "Agents", description: "Executive agents with tailorable skills, area connections, and workflows.", features: ["Skill library", "Roster orchestration", "Recursive skill evolution"] },
    { name: "Frontier", description: "Frontier-model & platform capabilities the agents act on in their own domains.", features: ["Capability radar", "Capability-triggered workflows"] },
    { name: "Records", description: "Living product & GTM records that move only when a human ratifies a proposal.", features: ["Structured fields", "Proposals & ratification", "Revision history"] },
  ];
  for (const m of modDefs) {
    const { data: mod } = await supabase.from("modules").insert({ org_id: orgId, product_id: productId, name: m.name, description: m.description }).select("id").single();
    if (mod) await supabase.from("features").insert(m.features.map((name) => ({ org_id: orgId, module_id: mod.id, name })));
  }

  // 4) Competitors — the real landscape (researched), for the Competitive area.
  await supabase.from("competitors").insert([
    { org_id: orgId, name: "Productboard", relationship: "direct", website: "https://www.productboard.com", notes: "Product management platform; its Spark AI runs agentic competitive research and builds battlecards. Overlaps on product strategy + CI, but isn't a unified product+GTM record." },
    { org_id: orgId, name: "Crayon", relationship: "direct", website: "https://www.crayon.co", notes: "Competitive intelligence platform monitoring 100+ data types; its Sparks AI generates SWOTs and talk tracks. Strong on CI; not a living system of record." },
    { org_id: orgId, name: "Klue", relationship: "direct", website: "https://klue.com", notes: "Competitive enablement: collects competitor intel and pushes battlecards to sales. CI→sales focus, not product + GTM as one record." },
    { org_id: orgId, name: "Aha!", relationship: "adjacent", website: "https://www.aha.io", notes: "Roadmapping with ML-based prioritization. Strong roadmap; weak on live market intelligence and GTM." },
    { org_id: orgId, name: "Gong", relationship: "adjacent", website: "https://www.gong.io", notes: "Revenue intelligence from call data; surfaces competitor mentions and deal risk. A GTM signal source, not a system of record." },
    { org_id: orgId, name: "Signum.AI", relationship: "adjacent", website: "https://signum.ai", notes: "AI competitive intelligence consolidating external signals (hiring, launches, social). A signal feed, not a ratified record." },
  ]);

  // 5) GTM record + fields.
  const { data: gtm, error: gErr } = await supabase.from("gtm_records").insert({ org_id: orgId, product_id: productId, name: "Homepage hero · messaging" }).select("id").single();
  if (gErr) throw gErr;
  const gtmId = gtm.id as string;
  await supabase.from("record_fields").insert([
    ["hero", "Hero", "Your strategy, kept current by agents you control.", 0],
    ["personas", "Personas", "Heads of Product, founders, and RevOps leads at scaling B2B software companies.", 1],
    ["positioning", "Positioning", "A living system of record — not a doc, not a dashboard. It proposes change; you ratify.", 2],
    ["objections", "Objections", "“Is this just another AI wrapper?” — No: humans ratify every change; nothing moves on its own.", 3],
  ].map(([field_key, label, value, position]) => ({ org_id: orgId, gtm_record_id: gtmId, field_key, label, value, position })));

  // 6) SIGNALS — the fuel. GTM (on the record) + market (org).
  await supabase.from("signals").insert([
    ["Prospects bounce on the pricing page after the demo", "Three design partners said pricing tiers were unclear post-demo; two stalled.", 0.82, "High", 6],
    ["“Is it just an AI wrapper?” keeps surfacing", "Recurring first-call objection — our human-in-the-loop control isn't landing in the messaging.", 0.78, "High", 22],
    ["Founders resonate with “living system of record”", "The phrase consistently lands with founders in discovery; product leads less so.", 0.66, "Medium", 50],
    ["Demo-to-trial drop-off on mobile", "Hero CTA underperforms on mobile; analytics show ~40% lower trial starts.", 0.7, "Medium", 73],
  ].map(([title, why, conf_level, conf_label, h]) => ({ org_id: orgId, scope: "gtm", gtm_record_id: gtmId, title, why, conf_level, conf_label, observed_at: iso(h as number) })));

  await supabase.from("signals").insert([
    ["Analysts reframing “AI copilots” as “AI operating layers”", "industry", "Analyst commentary is shifting the category from assistants to systems of record — our exact framing.", 0.62, "Medium", 30],
    ["CI teams adopting AI daily (Crayon 2025 report)", "analysts", "~60% of competitive-intelligence teams now use AI tools daily, up ~25% YoY — buyers expect AI-native intel.", 0.7, "High", 54],
    ["Buyers now expect human-in-the-loop governance", "persona", "Procurement increasingly asks how AI-driven changes are reviewed and audited — a strength to lead with.", 0.72, "High", 80],
  ].map(([title, lens, why, conf_level, conf_label, h]) => ({ org_id: orgId, scope: "org", title, why, conf_level, conf_label, observed_at: iso(h as number), metadata: { domain: "market", lens } })));

  // 7) FRONTIER capabilities — real model/platform releases (feed the Frontier space).
  await supabase.from("signals").insert([
    ["Claude tool orchestration", "Native multi-tool orchestration lets a single agent plan and run multi-step tasks.", "orchestration", 12],
    ["Claude long-term memory", "Agents can persist and recall context across sessions.", "memory", 40],
    ["Claude computer use", "Agents can operate software UIs directly.", "computer-use", 120],
  ].map(([title, why, area, h]) => ({ org_id: orgId, scope: "org", title, why, observed_at: iso(h as number), metadata: { domain: "capability", provider: "anthropic", area } })));

  // 8) Skills + attach to the right officers.
  const skillDefs: { key: string; name: string; description: string; category: string; instructions: string; agents: string[] }[] = [
    { key: "demo_positioning_sharpening", name: "Positioning sharpening", category: "product", description: "Tighten how the product is positioned against alternatives.", instructions: "Sharpen positioning to be specific and defensible. Lead with the category we're reframing, name the alternative we are NOT (e.g. roadmapping tools, CI feeds, call analytics), and ground every claim in a signal. Avoid hype; prefer concrete proof.", agents: ["cpo"] },
    { key: "demo_roadmap_prioritization", name: "Roadmap prioritization", category: "product", description: "Decide what to build next from evidence.", instructions: "Prioritize by corroborated demand (escalating themes), strategic fit, and buildability. Recommend the smallest change that moves the metric; cite the signals behind it.", agents: ["cpo"] },
    { key: "demo_architecture_review", name: "Architecture review", category: "general", description: "Keep technical claims precise and buildable.", instructions: "Review technical fields for accuracy and feasibility. Flag risk, keep stack/integration detail precise, and separate what's buildable now from later. Watch frontier-model capabilities for what's newly possible.", agents: ["ceng"] },
    { key: "demo_competitive_battlecard", name: "Competitive battlecard", category: "gtm", description: "Equip GTM to win against alternatives.", instructions: "Frame the win against named competitors (Productboard, Crayon, Klue, Aha!, Gong): where we're clearly better, where to reframe, and the proof. Ground in competitive and market signals; keep it honest and specific.", agents: ["cro"] },
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

  // 9) A frontier-triggered workflow (so the Frontier space isn't empty).
  const cpoId = agentId("cpo");
  if (cpoId) await supabase.from("workflows").insert({ org_id: orgId, agent_id: cpoId, name: "Review new capability for product impact", trigger: "on_capability_update", function_key: "frontier", target_type: "none", skill_ids: [] });

  // 10) Durable themes — so Evolve & the Chief of Staff have patterns to act on.
  await supabase.from("signal_themes").insert([
    { category: "product", state: "escalating", momentum: "accelerating", conf_level: 0.74, title: "Buyers expect built-in agent orchestration", summary: "Demand is shifting from single assistants to multi-agent orchestration; analysts and competitor moves (Productboard Spark, Crayon Sparks) corroborate.", recommendation: "Make orchestration a first-class, demoable capability; evolve engineering & product skills to leverage new platform features." },
    { category: "gtm", state: "active", momentum: "steady", conf_level: 0.7, title: "Pricing & “AI wrapper” objections create demo-to-trial friction", summary: "Two recurring post-demo blockers: unclear pricing and skepticism that we're 'just a wrapper'.", recommendation: "Lead messaging with human-in-the-loop control; clarify pricing tiers on the hero path." },
    { category: "product", state: "escalating", momentum: "accelerating", conf_level: 0.68, title: "Frontier capabilities reset table stakes each quarter", summary: "New Claude capabilities (orchestration, memory, computer use) keep changing what's expected of an 'AI operating layer'.", recommendation: "Continuously evolve agent skills to leverage new capabilities; treat capability releases as signals every officer acts on." },
  ].map((t) => ({ org_id: orgId, ...t, domain: "signals", last_evidence_at: iso(8) })));

  return { created: true, message: "SingleStack workspace loaded — product, GTM, signals, competitors, frontier capabilities, skills & themes." };
}
