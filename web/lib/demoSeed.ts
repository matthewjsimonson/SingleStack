// Dogfood seed — loads SingleStack's OWN workspace so we use SingleStack to
// build SingleStack: the product record, a GTM record, SIGNALS (GTM + market),
// real COMPETITORS, frontier CAPABILITIES (which feed the Frontier Models
// space), durable themes, and skills attached to the executive agents with
// their area connections (incl. the frontier-models area).
//
// Resilient & self-reporting: every section runs independently (one failure
// can't abort the rest), it's idempotent per-section (safe to re-run; repairs
// partial loads), and it returns a per-section report so the UI can show
// exactly what wrote and what errored. DATA only — the platform stays fully
// product-agnostic; nothing here is hardcoded into the app. RLS scopes all
// writes to the caller's org.
import type { SupabaseClient } from "@supabase/supabase-js";
import { EXECUTIVE_TEAM } from "@/lib/team";

const DEMO_PRODUCT = "SingleStack";
const GTM_NAME = "Homepage hero · messaging";
const AREA_LABEL: Record<string, string> = { products: "Product records", gtm: "GTM records", signals: "Signals", capabilities: "Frontier models & capabilities", records: "All records" };

export async function loadDemoData(supabase: SupabaseClient, orgId: string): Promise<{ created: boolean; message: string }> {
  const now = Date.now();
  const iso = (h: number) => new Date(now - h * 3600_000).toISOString();
  const report: string[] = [];
  const errors: string[] = [];
  const count = async (table: string, col: string, val: string) => {
    const { count } = await supabase.from(table).select("id", { count: "exact", head: true }).eq(col, val);
    return count ?? 0;
  };
  const step = async (label: string, fn: () => Promise<string>) => {
    try { report.push(`${label}: ${await fn()}`); } catch (e) { errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`); }
  };

  // ---- Agents ----
  await step("agents", async () => {
    const { data: ag0 } = await supabase.from("agents").select("key").eq("is_active", true);
    const have = new Set((ag0 ?? []).map((a) => a.key));
    const toAdd = EXECUTIVE_TEAM.filter((e) => !have.has(e.key)).map((e) => ({ org_id: orgId, key: e.key, name: e.name, role: e.role, model: "claude-opus-4-8", system_prompt: e.system_prompt, is_active: true }));
    if (toAdd.length) { const { error } = await supabase.from("agents").insert(toAdd); if (error) throw error; }
    return toAdd.length ? `+${toAdd.length}` : "exist";
  });
  const { data: agents } = await supabase.from("agents").select("id, key").eq("is_active", true);
  const agentId = (key: string) => agents?.find((a) => a.key === key)?.id as string | undefined;

  // ---- Connections (incl. frontier for every officer) ----
  await step("connections", async () => {
    const { data: ex } = await supabase.from("connections").select("agent_id, area").eq("kind", "internal");
    const have = new Set((ex ?? []).map((c) => `${c.agent_id}:${c.area}`));
    const wiring: [string, string[]][] = [["cpo", ["products", "signals", "capabilities"]], ["ceng", ["products", "signals", "capabilities"]], ["cro", ["gtm", "signals", "capabilities"]], ["cco", ["gtm", "signals", "capabilities"]], ["cos", ["records", "capabilities"]]];
    const rows: Record<string, unknown>[] = [];
    for (const [k, areas] of wiring) { const aid = agentId(k); if (!aid) continue; for (const area of areas) if (!have.has(`${aid}:${area}`)) rows.push({ org_id: orgId, agent_id: aid, kind: "internal", label: AREA_LABEL[area], area, status: "connected" }); }
    if (rows.length) { const { error } = await supabase.from("connections").insert(rows); if (error) throw error; }
    return rows.length ? `+${rows.length}` : "exist";
  });

  // ---- Product (find or create) ----
  let productId: string | undefined;
  await step("product", async () => {
    const { data: ex } = await supabase.from("product_records").select("id").eq("name", DEMO_PRODUCT).maybeSingle();
    if (ex) { productId = ex.id as string; return "exists"; }
    const { data, error } = await supabase.from("product_records").insert({ org_id: orgId, name: DEMO_PRODUCT }).select("id").single();
    if (error) throw error; productId = data.id as string; return "created";
  });
  if (!productId) return { created: false, message: `Could not create the product. ${errors.join(" | ")}` };
  const pid = productId;

  // ---- Product fields ----
  await step("product fields", async () => {
    if (await count("record_fields", "product_id", pid)) return "exist";
    const { error } = await supabase.from("record_fields").insert([
      ["overview", "Overview", "SingleStack is an AI operating layer for product & go-to-market teams: a single, living system of record where executive agents keep your product and messaging current as the market moves — and nothing changes without a human ratifying it.", 0],
      ["target_market", "Target market", "Series A–C B2B software companies (20–200 people) where product and GTM drift apart and no one owns keeping them aligned.", 1],
      ["value_prop", "Value proposition", "Your strategy stays current automatically. Agents watch signals, propose sharp updates, and you ratify — so the record and messaging never go stale, and you can leverage new frontier-model capabilities as they ship.", 2],
      ["positioning", "Positioning", "Not a roadmapping tool (Aha!), not a competitive-intel feed (Crayon/Klue), not call analytics (Gong) — a living system of record that unifies product + GTM and proposes change, human-in-the-loop.", 3],
      ["key_metrics", "Key metrics", "Design partners: 6 · Weekly active operators: 41 · Proposals ratified/wk: 28", 4],
    ].map(([field_key, label, value, position]) => ({ org_id: orgId, product_id: pid, field_key, label, value, position })));
    if (error) throw error; return "created";
  });

  // ---- Modules + features ----
  await step("modules", async () => {
    if (await count("modules", "product_id", pid)) return "exist";
    const modDefs = [
      { name: "Intelligence", description: "Signals, themes, and the honest-confidence engine that turns evidence into durable patterns.", features: ["Signal capture", "Theme reconciliation", "Honest confidence"] },
      { name: "Agents", description: "Executive agents with tailorable skills, area connections, and workflows.", features: ["Skill library", "Roster orchestration", "Recursive skill evolution"] },
      { name: "Frontier", description: "Frontier-model & platform capabilities the agents act on in their own domains.", features: ["Capability radar", "Capability-triggered workflows"] },
      { name: "Records", description: "Living product & GTM records that move only when a human ratifies a proposal.", features: ["Structured fields", "Proposals & ratification", "Revision history"] },
    ];
    for (const m of modDefs) {
      const { data: mod, error } = await supabase.from("modules").insert({ org_id: orgId, product_id: pid, name: m.name, description: m.description }).select("id").single();
      if (error) throw error;
      if (mod) await supabase.from("features").insert(m.features.map((name) => ({ org_id: orgId, module_id: mod.id, name })));
    }
    return "created";
  });

  // ---- Competitors ----
  await step("competitors", async () => {
    const { data: ex } = await supabase.from("competitors").select("id").eq("name", "Productboard").maybeSingle();
    if (ex) return "exist";
    const { error } = await supabase.from("competitors").insert([
      { org_id: orgId, name: "Productboard", relationship: "direct", website: "https://www.productboard.com", notes: "Product management platform; its Spark AI runs agentic competitive research and builds battlecards. Overlaps on product strategy + CI, but isn't a unified product+GTM record." },
      { org_id: orgId, name: "Crayon", relationship: "direct", website: "https://www.crayon.co", notes: "Competitive intelligence platform monitoring 100+ data types; its Sparks AI generates SWOTs and talk tracks. Strong on CI; not a living system of record." },
      { org_id: orgId, name: "Klue", relationship: "direct", website: "https://klue.com", notes: "Competitive enablement: collects competitor intel and pushes battlecards to sales. CI→sales focus, not product + GTM as one record." },
      { org_id: orgId, name: "Aha!", relationship: "adjacent", website: "https://www.aha.io", notes: "Roadmapping with ML-based prioritization. Strong roadmap; weak on live market intelligence and GTM." },
      { org_id: orgId, name: "Gong", relationship: "adjacent", website: "https://www.gong.io", notes: "Revenue intelligence from call data; surfaces competitor mentions and deal risk. A GTM signal source, not a system of record." },
      { org_id: orgId, name: "Signum.AI", relationship: "adjacent", website: "https://signum.ai", notes: "AI competitive intelligence consolidating external signals (hiring, launches, social). A signal feed, not a ratified record." },
    ]);
    if (error) throw error; return "+6";
  });

  // ---- Competitive capability heat-map: functionality vectors × competitors ----
  await step("capability matrix", async () => {
    const { data: exCap } = await supabase.from("capabilities").select("id").limit(1);
    if (exCap && exCap.length) return "exist";
    const CAPS = [
      "Unified product + GTM record", "Competitive intelligence", "Agent orchestration",
      "Roadmapping & delivery", "Signal synthesis", "Human-in-the-loop governance", "Frontier-capability leverage",
    ];
    const { data: created, error } = await supabase.from("capabilities").insert(CAPS.map((name, i) => ({ org_id: orgId, name, position: i }))).select("id, name");
    if (error) throw error;
    const capId = (n: string) => created!.find((c) => c.name === n)!.id;
    const { data: comps } = await supabase.from("competitors").select("id, name");
    const compId = (n: string) => comps?.find((c) => c.name === n)?.id ?? null;
    // score 0..3 (— / Partial / Good / Strong). null competitor = "Us".
    const S: Record<string, Record<string, number>> = {
      "Us": { "Unified product + GTM record": 3, "Competitive intelligence": 2, "Agent orchestration": 3, "Roadmapping & delivery": 2, "Signal synthesis": 3, "Human-in-the-loop governance": 3, "Frontier-capability leverage": 3 },
      "Productboard": { "Unified product + GTM record": 1, "Competitive intelligence": 2, "Agent orchestration": 1, "Roadmapping & delivery": 3, "Signal synthesis": 1, "Human-in-the-loop governance": 1, "Frontier-capability leverage": 1 },
      "Crayon": { "Competitive intelligence": 3, "Signal synthesis": 2, "Roadmapping & delivery": 0, "Unified product + GTM record": 0, "Agent orchestration": 1, "Human-in-the-loop governance": 1, "Frontier-capability leverage": 1 },
      "Klue": { "Competitive intelligence": 3, "Signal synthesis": 1, "Roadmapping & delivery": 0, "Unified product + GTM record": 0, "Agent orchestration": 0, "Human-in-the-loop governance": 1, "Frontier-capability leverage": 0 },
      "Aha!": { "Roadmapping & delivery": 3, "Unified product + GTM record": 1, "Competitive intelligence": 0, "Agent orchestration": 0, "Signal synthesis": 1, "Human-in-the-loop governance": 1, "Frontier-capability leverage": 0 },
      "Gong": { "Competitive intelligence": 1, "Signal synthesis": 2, "Roadmapping & delivery": 0, "Unified product + GTM record": 0, "Agent orchestration": 1, "Human-in-the-loop governance": 0, "Frontier-capability leverage": 1 },
      "Signum.AI": { "Competitive intelligence": 2, "Signal synthesis": 2, "Roadmapping & delivery": 0, "Unified product + GTM record": 0, "Agent orchestration": 1, "Human-in-the-loop governance": 0, "Frontier-capability leverage": 1 },
    };
    const rows: Record<string, unknown>[] = [];
    for (const [who, scores] of Object.entries(S)) {
      const cid = who === "Us" ? null : compId(who);
      if (who !== "Us" && !cid) continue;
      for (const [cap, score] of Object.entries(scores)) rows.push({ org_id: orgId, capability_id: capId(cap), competitor_id: cid, score });
    }
    if (rows.length) { const { error: se } = await supabase.from("capability_scores").insert(rows); if (se) throw se; }
    return `+${CAPS.length} caps`;
  });

  // ---- Competitive signals (what's happening) ----
  await step("competitive signals", async () => {
    const { count: c } = await supabase.from("signals").select("id", { count: "exact", head: true }).eq("metadata->>domain", "competitive");
    if (c) return "exist";
    const { error } = await supabase.from("signals").insert([
      ["Crayon ships Sparks AI: auto-SWOT + talk tracks", "Competitor deepening AI on CI — raises the bar on automated competitive analysis.", 0.7, "High", 18],
      ["Productboard's Spark adds agentic competitive research", "Direct overlap with our competitive intel; watch their battlecard automation.", 0.68, "Medium", 36],
      ["Klue expanding into win/loss analytics", "Moving down-funnel toward revenue intelligence; adjacent encroachment.", 0.55, "Medium", 70],
    ].map(([title, why, conf_level, conf_label, h]) => ({ org_id: orgId, scope: "org", category: "gtm", title, why, conf_level, conf_label, observed_at: iso(h as number), metadata: { domain: "competitive" } })));
    if (error) throw error; return "+3";
  });

  // ---- GTM record (find or create) ----
  let gtmId: string | undefined;
  await step("gtm record", async () => {
    const { data: ex } = await supabase.from("gtm_records").select("id").eq("product_id", pid).eq("name", GTM_NAME).maybeSingle();
    if (ex) { gtmId = ex.id as string; return "exists"; }
    const { data, error } = await supabase.from("gtm_records").insert({ org_id: orgId, product_id: pid, name: GTM_NAME }).select("id").single();
    if (error) throw error; gtmId = data.id as string; return "created";
  });

  // ---- GTM fields ----
  if (gtmId) await step("gtm fields", async () => {
    if (await count("record_fields", "gtm_record_id", gtmId!)) return "exist";
    const { error } = await supabase.from("record_fields").insert([
      ["hero", "Hero", "Your strategy, kept current by agents you control.", 0],
      ["personas", "Personas", "Heads of Product, founders, and RevOps leads at scaling B2B software companies.", 1],
      ["positioning", "Positioning", "A living system of record — not a doc, not a dashboard. It proposes change; you ratify.", 2],
      ["objections", "Objections", "“Is this just another AI wrapper?” — No: humans ratify every change; nothing moves on its own.", 3],
    ].map(([field_key, label, value, position]) => ({ org_id: orgId, gtm_record_id: gtmId, field_key, label, value, position })));
    if (error) throw error; return "created";
  });

  // ---- GTM signals (THE fuel) — categorized + product-scoped so they show in /signals ----
  if (gtmId) await step("gtm signals", async () => {
    if (await count("signals", "gtm_record_id", gtmId!)) return "exist";
    const { error } = await supabase.from("signals").insert([
      ["Prospects bounce on the pricing page after the demo", "Three design partners said pricing tiers were unclear post-demo; two stalled.", 0.82, "High", 6],
      ["“Is it just an AI wrapper?” keeps surfacing", "Recurring first-call objection — our human-in-the-loop control isn't landing in the messaging.", 0.78, "High", 22],
      ["Founders resonate with “living system of record”", "The phrase consistently lands with founders in discovery; product leads less so.", 0.66, "Medium", 50],
      ["Demo-to-trial drop-off on mobile", "Hero CTA underperforms on mobile; analytics show ~40% lower trial starts.", 0.7, "Medium", 73],
    ].map(([title, why, conf_level, conf_label, h]) => ({ org_id: orgId, scope: "gtm", gtm_record_id: gtmId, product_id: pid, category: "gtm", title, why, conf_level, conf_label, observed_at: iso(h as number) })));
    if (error) throw error; return "+4";
  });

  // ---- Market signals ----
  await step("market signals", async () => {
    const { count: c } = await supabase.from("signals").select("id", { count: "exact", head: true }).eq("metadata->>domain", "market");
    if (c) return "exist";
    const { error } = await supabase.from("signals").insert([
      ["Analysts reframing “AI copilots” as “AI operating layers”", "industry", "Analyst commentary is shifting the category from assistants to systems of record — our exact framing.", 0.62, "Medium", 30],
      ["CI teams adopting AI daily (Crayon 2025 report)", "analysts", "~60% of competitive-intelligence teams now use AI tools daily, up ~25% YoY — buyers expect AI-native intel.", 0.7, "High", 54],
      ["Buyers now expect human-in-the-loop governance", "persona", "Procurement increasingly asks how AI-driven changes are reviewed and audited — a strength to lead with.", 0.72, "High", 80],
    ].map(([title, lens, why, conf_level, conf_label, h]) => ({ org_id: orgId, scope: "org", category: "product", title, why, conf_level, conf_label, observed_at: iso(h as number), metadata: { domain: "market", lens } })));
    if (error) throw error; return "+3";
  });

  // ---- Frontier capabilities ----
  await step("capabilities", async () => {
    const caps: [string, string, string, string, number][] = [
      ["Claude tool orchestration", "Native multi-tool orchestration lets a single agent plan and run multi-step tasks.", "anthropic", "orchestration", 12],
      ["Claude long-term memory", "Agents persist and recall context across sessions.", "anthropic", "memory", 40],
      ["Claude computer use", "Agents operate software UIs directly.", "anthropic", "computer-use", 120],
      ["OpenAI Realtime API", "Low-latency speech-to-speech for live voice agents.", "openai", "voice", 30],
      ["OpenAI structured outputs", "Guaranteed JSON-schema conformance for reliable tool pipelines.", "openai", "reliability", 96],
      ["Google Gemini long context", "Multi-million-token context for whole-codebase / corpus reasoning.", "google", "context", 60],
      ["Meta Llama on-prem", "Open-weight models for self-hosted, data-resident deployments.", "meta", "deployment", 150],
      ["xAI Grok live search", "Real-time web/X signal grounding inside the model.", "xai", "retrieval", 80],
    ];
    // Top up by title (idempotent), so re-running adds NEW providers instead of bailing.
    const { data: ex } = await supabase.from("signals").select("title").eq("metadata->>domain", "capability");
    const have = new Set((ex ?? []).map((r) => r.title));
    const toAdd = caps.filter((c) => !have.has(c[0]));
    if (!toAdd.length) return "exist";
    const { error } = await supabase.from("signals").insert(toAdd.map(([title, why, provider, area, h]) =>
      ({ org_id: orgId, scope: "org", title, why, observed_at: iso(h), metadata: { domain: "capability", provider, area } })));
    if (error) throw error; return `+${toAdd.length}`;
  });

  // ---- Skills + attach ----
  await step("skills", async () => {
    const skillDefs: { key: string; name: string; description: string; category: string; instructions: string; agents: string[] }[] = [
      { key: "demo_positioning_sharpening", name: "Positioning sharpening", category: "product", description: "Tighten how the product is positioned against alternatives.", instructions: "Sharpen positioning to be specific and defensible. Lead with the category we're reframing, name the alternative we are NOT (roadmapping tools, CI feeds, call analytics), and ground every claim in a signal. Avoid hype; prefer concrete proof.", agents: ["cpo"] },
      { key: "demo_roadmap_prioritization", name: "Roadmap prioritization", category: "product", description: "Decide what to build next from evidence.", instructions: "Prioritize by corroborated demand (escalating themes), strategic fit, and buildability. Recommend the smallest change that moves the metric; cite the signals behind it.", agents: ["cpo"] },
      { key: "demo_architecture_review", name: "Architecture review", category: "general", description: "Keep technical claims precise and buildable.", instructions: "Review technical fields for accuracy and feasibility. Flag risk, keep stack/integration detail precise, and separate what's buildable now from later. Watch frontier-model capabilities for what's newly possible.", agents: ["ceng"] },
      { key: "demo_competitive_battlecard", name: "Competitive battlecard", category: "gtm", description: "Equip GTM to win against alternatives.", instructions: "Frame the win against named competitors (Productboard, Crayon, Klue, Aha!, Gong): where we're clearly better, where to reframe, and the proof. Ground in competitive and market signals; keep it honest and specific.", agents: ["cro"] },
      { key: "demo_persona_messaging", name: "Persona messaging", category: "gtm", description: "Tune messaging to each buyer.", instructions: "Match the message to the persona. Lead with the outcome they care about, address their top objection, and use language pulled from real signals.", agents: ["cro"] },
      { key: "demo_narrative_voice", name: "Narrative & brand voice", category: "gtm", description: "Keep the story consistent and compelling.", instructions: "Keep the narrative consistent across records: confident, concrete, human-in-the-loop. Avoid AI hype; emphasize control and living truth.", agents: ["cco"] },
    ];
    let made = 0;
    for (const s of skillDefs) {
      let { data: sk } = await supabase.from("skills").insert({ org_id: orgId, key: s.key, name: s.name, description: s.description, category: s.category, instructions: s.instructions, source: "template" }).select("id").maybeSingle();
      if (!sk) { const { data: found } = await supabase.from("skills").select("id").eq("key", s.key).maybeSingle(); sk = found; } else made++;
      if (sk) {
        for (const k of s.agents) { const aid = agentId(k); if (aid) await supabase.from("agent_skills").upsert({ org_id: orgId, agent_id: aid, skill_id: sk.id }, { onConflict: "agent_id,skill_id", ignoreDuplicates: true }); }
      }
    }
    return made ? `+${made}` : "exist";
  });

  // ---- Frontier workflow ----
  await step("frontier workflow", async () => {
    const cpoId = agentId("cpo"); if (!cpoId) return "no cpo";
    const { data: ex } = await supabase.from("workflows").select("id").eq("trigger", "on_capability_update").maybeSingle();
    if (ex) return "exist";
    const { error } = await supabase.from("workflows").insert({ org_id: orgId, agent_id: cpoId, name: "Review new capability for product impact", trigger: "on_capability_update", function_key: "frontier", target_type: "none", skill_ids: [] });
    if (error) throw error; return "created";
  });

  // ---- Durable themes ----
  await step("themes", async () => {
    const defs = [
      { category: "product", state: "escalating", momentum: "accelerating", conf_level: 0.86, title: "Buyers expect built-in agent orchestration", summary: "Demand is shifting from single assistants to multi-agent orchestration; analysts and competitor moves (Productboard Spark, Crayon Sparks) corroborate.", recommendation: "Make orchestration a first-class, demoable capability; evolve engineering & product skills to leverage new platform features." },
      { category: "gtm", state: "active", momentum: "steady", conf_level: 0.7, title: "Pricing & “AI wrapper” objections create demo-to-trial friction", summary: "Two recurring post-demo blockers: unclear pricing and skepticism that we're 'just a wrapper'.", recommendation: "Lead messaging with human-in-the-loop control; clarify pricing tiers on the hero path." },
      { category: "product", state: "escalating", momentum: "accelerating", conf_level: 0.78, title: "Frontier capabilities reset table stakes each quarter", summary: "New model capabilities (orchestration, memory, long context) keep changing what's expected of an 'AI operating layer'.", recommendation: "Continuously evolve agent skills to leverage new capabilities; treat capability releases as signals every officer acts on." },
      { category: "gtm", state: "active", momentum: "accelerating", conf_level: 0.62, title: "Human-in-the-loop governance is becoming a buying criterion", summary: "Procurement increasingly asks how AI changes are reviewed and audited — our ratification model is a differentiator if we lead with it.", recommendation: "Put HITL governance on the hero and in the security one-pager." },
      { category: "product", state: "active", momentum: "steady", conf_level: 0.5, title: "Mobile is an underserved surface", summary: "Demo-to-trial drop-off concentrates on mobile; the hero CTA underperforms there.", recommendation: "Ship a mobile-first hero variant; measure trial starts." },
      { category: "gtm", state: "emerging", momentum: "accelerating", conf_level: 0.34, title: "“Operating layer” category language is forming", summary: "Analysts beginning to reframe copilots as operating layers — early, thin, but trending our way.", recommendation: "Watch; seed the language in content, don't bet the positioning yet." },
      { category: "product", state: "fading", momentum: "fading", conf_level: 0.42, title: "Standalone roadmapping as a wedge", summary: "Leading with roadmapping (vs Aha!) is losing steam; buyers want the unified record, not another roadmap tool.", recommendation: "De-emphasize roadmapping-first messaging." },
      { category: "gtm", state: "active", momentum: "steady", conf_level: 0.9, title: "Win/loss cites unclear pricing as top stall", summary: "Across recent deals, pricing clarity is the most-cited reason for stalls — high confidence, well corroborated.", recommendation: "Publish transparent tiers; add a pricing FAQ to the demo follow-up." },
    ];
    // Top up by title so re-running adds the spread themes instead of bailing.
    const { data: ex } = await supabase.from("signal_themes").select("title");
    const have = new Set((ex ?? []).map((r) => r.title));
    const toAdd = defs.filter((d) => !have.has(d.title));
    if (!toAdd.length) return "exist";
    const { error } = await supabase.from("signal_themes").insert(toAdd.map((t, i) => ({ org_id: orgId, ...t, domain: "signals", last_evidence_at: iso(8 + i * 5) })));
    if (error) throw error; return `+${toAdd.length}`;
  });

  const summary = report.join(" · ");
  return {
    created: errors.length === 0,
    message: errors.length
      ? `Loaded with issues — ${summary}. ⚠️ ERRORS: ${errors.join(" | ")}`
      : `SingleStack workspace loaded ✓ — ${summary}. Open Signals (Product/GTM tabs).`,
  };
}
