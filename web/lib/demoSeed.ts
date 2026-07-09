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
import { SKILL_DEFS } from "@/lib/skills.generated";

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
    const { error } = await supabase.rpc("human_add_fields", { p_rows: [
      ["what_it_is", "What it is", "SingleStack is a product-led growth (PLG) platform that runs the entire PLG loop in one system — sense → decide → build → sell → learn — for product managers AND go-to-market teams. Its first-class Build module lets PMs use AI to legitimately prototype: turn a decision into a real, working prototype, then ship it. AI agents move the work; humans ratify every change.", 0],
      ["category", "Category", "Product-led growth (PLG) platform", 1],
      ["target_market", "Target market", "Series A–C B2B software companies (20–200 people) building product-led, where PMs and GTM need to move from signal → shipped → sold without tool-hopping.", 2],
      ["value_prop", "Value proposition", "Take an idea all the way through the PLG loop without leaving one system: sense the market, decide what to build, actually BUILD it with AI prototyping, sell it (usage → PQLs → GTM), and learn from the outcome — agents propose, you ratify.", 3],
      ["core_capabilities", "Core capabilities", "AI prototyping / build; signal sensing & synthesis; product & GTM strategy; messaging & battlecards; PQL scoring; outcome learning; agent orchestration; human-in-the-loop governance.", 4],
      ["differentiated_capabilities", "Differentiated capabilities", "A FIRST-CLASS Build module where PMs genuinely prototype with AI — most tools stop at docs or strategy; SingleStack closes sense → build → sell → learn in one loop.", 5],
      ["key_metrics", "Key metrics", "Design partners: 6 · Weekly active operators: 41 · Prototypes shipped/wk: 12", 6],
    ].map(([field_key, label, value, position]) => ({ org_id: orgId, product_id: pid, field_key, label, value, position })) });
    if (error) throw error; return "created";
  });

  // ---- Modules + features ----
  await step("modules", async () => {
    if (await count("modules", "product_id", pid)) return "exist";
    const modDefs = [
      { name: "Sense", description: "Signals from the market and inside the company, synthesized into durable themes with honest confidence — competitive, market, and frontier intel.", features: ["Signal capture", "Theme synthesis", "Competitive & market intel", "Frontier-capability radar"] },
      { name: "Decide", description: "Turn themes into product & GTM strategy — what to build and why, prioritized against objectives.", features: ["Strategy boards", "Theme → initiative", "Prioritization"] },
      { name: "Build", description: "The first-class build motor: PMs use AI to legitimately prototype — turn a decision into a real, working prototype, then ship it.", features: ["AI prototyping (prompt-to-app)", "Specs & build items", "Ship to release"] },
      { name: "Sell", description: "Messaging, battlecards, and product-qualified leads — usage signals scored into who's ready to buy.", features: ["Messaging & battlecards", "PQL scoring", "Accounts → usage → leads"] },
      { name: "Learn", description: "Ship → outcome → signal: measure what shipped and feed the result back into the loop.", features: ["Outcomes", "Outcome → signal", "Closed-loop learning"] },
      { name: "Agents", description: "Executive AI agents with tailorable skills and workflows that run the loop end to end; humans ratify every change.", features: ["Skill library", "Workflows", "Human-in-the-loop governance"] },
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
      { org_id: orgId, name: "Productboard", relationship: "adjacent", website: "https://www.productboard.com", notes: "Product management & roadmapping with an AI product agent (Spark). Strong on the DECIDE leg — product-side only, doesn't build, and isn't a unified product+GTM record." },
      { org_id: orgId, name: "Lovable", relationship: "adjacent", website: "https://lovable.dev", notes: "AI app builder — prompt to full-stack prototype. Owns the BUILD leg, but the prototype has no memory of the strategy, signals, or GTM behind it. A tool the Build module orchestrates." },
      { org_id: orgId, name: "Cursor", relationship: "adjacent", website: "https://cursor.com", notes: "AI coding environment for developers. Owns the BUILD leg; code-only, no product/GTM context. A BYO build tool to embed or hand off to." },
      { org_id: orgId, name: "Notion", relationship: "adjacent", website: "https://www.notion.so", notes: "Connected AI workspace — flexible and generic. No native product↔GTM ontology, no sensing, no governed AI." },
      { org_id: orgId, name: "Pendo", relationship: "adjacent", website: "https://www.pendo.io", notes: "Product analytics & in-app guidance. Owns the LEARN leg (usage telemetry) — a signal source, not a system of record." },
    ]);
    if (error) throw error; return "+5";
  });

  // ---- Competitive capability heat-map: functionality vectors × competitors ----
  await step("capability matrix", async () => {
    const { data: exCap } = await supabase.from("capabilities").select("id").limit(1);
    if (exCap && exCap.length) return "exist";
    const CAPS = [
      "Unified product + GTM record", "AI build / prototyping", "Signal sensing & synthesis",
      "Product & GTM strategy", "PLG analytics & PQLs", "Human-in-the-loop governance", "Frontier-capability leverage",
    ];
    const { data: created, error } = await supabase.from("capabilities").insert(CAPS.map((name, i) => ({ org_id: orgId, name, position: i }))).select("id, name");
    if (error) throw error;
    const capId = (n: string) => created!.find((c) => c.name === n)!.id;
    const { data: comps } = await supabase.from("competitors").select("id, name");
    const compId = (n: string) => comps?.find((c) => c.name === n)?.id ?? null;
    // score 0..3 (— / Partial / Good / Strong). null competitor = "Us". Each rival
    // owns one leg of the loop; we span it on a governed, unified record.
    const S: Record<string, Record<string, number>> = {
      "Us":           { "Unified product + GTM record": 3, "AI build / prototyping": 2, "Signal sensing & synthesis": 3, "Product & GTM strategy": 3, "PLG analytics & PQLs": 2, "Human-in-the-loop governance": 3, "Frontier-capability leverage": 3 },
      "Productboard": { "Unified product + GTM record": 1, "AI build / prototyping": 0, "Signal sensing & synthesis": 1, "Product & GTM strategy": 3, "PLG analytics & PQLs": 1, "Human-in-the-loop governance": 1, "Frontier-capability leverage": 1 },
      "Lovable":      { "Unified product + GTM record": 0, "AI build / prototyping": 3, "Signal sensing & synthesis": 0, "Product & GTM strategy": 0, "PLG analytics & PQLs": 0, "Human-in-the-loop governance": 0, "Frontier-capability leverage": 2 },
      "Cursor":       { "Unified product + GTM record": 0, "AI build / prototyping": 3, "Signal sensing & synthesis": 0, "Product & GTM strategy": 0, "PLG analytics & PQLs": 0, "Human-in-the-loop governance": 0, "Frontier-capability leverage": 2 },
      "Notion":       { "Unified product + GTM record": 1, "AI build / prototyping": 0, "Signal sensing & synthesis": 0, "Product & GTM strategy": 1, "PLG analytics & PQLs": 0, "Human-in-the-loop governance": 0, "Frontier-capability leverage": 1 },
      "Pendo":        { "Unified product + GTM record": 0, "AI build / prototyping": 0, "Signal sensing & synthesis": 1, "Product & GTM strategy": 1, "PLG analytics & PQLs": 3, "Human-in-the-loop governance": 0, "Frontier-capability leverage": 1 },
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
      ["Lovable crosses $40M ARR — AI app builders make PM prototyping real", "AI build tools prove PMs can prototype for real — validates the first-class Build module.", 0.72, "High", 18],
      ["Productboard ships Spark, an AI product agent", "Adjacent move on the decide leg — an assistant atop roadmapping, not a unified product+GTM record.", 0.66, "Medium", 36],
      ["Enterprise buyers require human-in-the-loop sign-off on AI", "Procurement now asks for audit trails + human ratification on AI changes — a strength to lead with.", 0.68, "High", 70],
    ].map(([title, why, conf_level, conf_label, h]) => ({ org_id: orgId, scope: "org", category: "gtm", title, why, conf_level, conf_label, observed_at: iso(h as number), metadata: { domain: "competitive" } })));
    if (error) throw error; return "+3";
  });

  // ---- Signals network (the landscape profile: core + 4 branched vectors) ----
  // SingleStack's own brain, as DATA. The platform stays agnostic: this content
  // lives in signal_profile_fields for THIS org; the pull/steer logic reads
  // whatever profile the customer's own records grow. weight 3 = closest to the
  // core … 1 = edge; parent = the same-vector node a branch chains off.
  await step("signals network", async () => {
    let { data: prof } = await supabase.from("signal_profiles").select("id").eq("scope", "landscape").is("competitor_id", null).maybeSingle();
    if (!prof) {
      const { data: np, error: pe } = await supabase.from("signal_profiles")
        .insert({ org_id: orgId, scope: "landscape", headline: "The PLG operating platform — the loop is the product; the Build module is the wedge." })
        .select("id").single();
      if (pe) throw pe;
      prof = np;
    }
    const { count: c } = await supabase.from("signal_profile_fields").select("id", { count: "exact", head: true }).eq("profile_id", prof!.id);
    if (c) return "exist";
    // [key, label, statement, vector, weight, parent]
    const N: [string, string, string, string, number, string | null][] = [
      // ---- CORE — what we are; everything hangs off this ----
      ["essence", "PLG operating platform", "SingleStack is a product-led growth operating platform: one governed system that runs sense → decide → build → sell → learn for product managers and GTM teams together.", "core", 3, null],
      ["core_problem", "The broken loop", "Product and GTM teams lose the thread between the market signal, the decision, the build, and the sale — the loop breaks at every tool boundary and someone becomes the human router.", "core", 3, null],
      ["build_first_class", "Build is first-class", "AI prototyping is a first-class Build module: a PM turns a ratified decision into a real, working prototype — not another document.", "core", 3, null],
      ["value_prop", "One system, whole loop", "An idea travels the entire loop without leaving the system — sensed, decided, legitimately prototyped, sold through PQLs, and learned from. Agents propose; humans ratify.", "core", 3, null],
      ["living_records", "Living records", "Product and GTM records are living artifacts — signal-fed, agent-maintained, human-ratified — the one source both sides of the company read.", "core", 2, null],
      ["hitl_governance", "Human-gated AI", "Every AI change passes a human gate: propose → review → ratify, field by field, with provenance — the trust layer that lets agents do real work.", "core", 2, null],
      ["business_model", "Who pays and how", "We sell workspace SaaS to Series A–C B2B software companies (20–200 people); product leadership buys, PMs and PMMs operate it daily.", "core", 2, null],


      // ---- COMPETITIVE — direct: rip-and-replace (platform AND point attacks);
      //      adjacent: same job, different means; indirect: different game, our world ----
      ["arch_platform_rip", "Platform rip-and-replace", "Solutions a buyer could swap in for the WHOLE loop \u2014 sense, decide, build, sell in one governed system. The test on every candidate: could a customer cancel us and move everything here?", "competitive", 3, null],
      ["riv_pm_suites", "PM suites expanding down-loop", "Productboard-class suites own the Decide leg and are adding AI agents and build ambitions. Watch Spark-class agents moving from suggests to builds, pricing moves, and loop-wide positioning.", "competitive", 3, "arch_platform_rip"],
      ["riv_plg_ops", "Emerging PLG-ops platforms", "New entrants claiming product + GTM + build in one system are the head-on future. Watch launches, fundraises, and positioning that names the full loop.", "competitive", 3, "arch_platform_rip"],
      ["arch_point_attacks", "Point-solution direct attacks", "Tools that are direct on ONE capability we own \u2014 they win that job outright and we lose the wedge. Each child names the capability it attacks and who is winning it.", "competitive", 3, null],
      ["pt_app_builders", "AI app builders \u00b7 Build", "Lovable, Cursor, and v0-class prompt-to-app tools own the Build leg outright. Watch team and enterprise features, pricing, and PM-friendly positioning that reaches past developers.", "competitive", 3, "arch_point_attacks"],
      ["pt_ci_tools", "Competitive-intel tools \u00b7 Sell", "Klue and Crayon-class battlecard products attack our Sell leg. Watch their AI features, win-loss integrations, and mid-market motion.", "competitive", 3, "arch_point_attacks"],
      ["pt_insight_tools", "Feedback & insight tools \u00b7 Sense", "Dovetail and Enterpret-class feedback-intelligence tools attack our Sense leg. Watch their synthesis features and product-team positioning.", "competitive", 3, "arch_point_attacks"],
      ["arch_same_job", "Same job, different means", "No product to rip out \u2014 a different route to the same outcome. These win silently in deals we never see.", "competitive", 2, null],
      ["adj_diy_stack", "DIY stitched stack", "Notion plus AI plus spreadsheets plus a builder \u2014 'we already have tools for each piece' is the default alternative. Watch templates, workflows, and community recipes that stitch the loop by hand.", "competitive", 2, "arch_same_job"],
      ["adj_services", "Services route", "Agencies and fractional PMM or product-ops operators run the loop as a service. Watch productized-service offers aimed at our ICP.", "competitive", 2, "arch_same_job"],
      ["adj_inhouse", "In-house build", "Engineering builds internal tooling instead of buying. Watch engineering-blog posts and open-source internal-tool releases from PLG companies.", "competitive", 2, "arch_same_job"],
      ["arch_diff_game", "Different game, our world", "Not competing for the job \u2014 but they shape our buyers, budgets, and category.", "competitive", 1, null],
      ["ind_plg_analytics", "PLG analytics & telemetry", "Pendo and Amplitude-class products own the Learn leg's telemetry and compete for the same budget line. Watch packaging that creeps toward decisions and workflows.", "competitive", 1, "arch_diff_game"],
      ["ind_provider_upstack", "Model providers moving up-stack", "A frontier provider shipping a native idea-to-app-to-GTM loop is the standing platform shock. Watch provider PRODUCT moves, not just model releases.", "competitive", 1, "arch_diff_game"],
      ["ind_category_voices", "Category voices", "Analysts, newsletters, and communities defining what PLG ops and AI product management mean \u2014 they set the category we are bought in.", "competitive", 1, "arch_diff_game"],

      // ---- MARKET — direct: our segments, buyers, demand signals; adjacent:
      //      one step out; indirect: the horizon ----
      ["seg_core_icp", "Series A\u2013C B2B SaaS, product-led", "Our market: 20\u2013200-person B2B software companies building product-led \u2014 big enough for PM and GTM roles, small enough to feel every tool seam.", "market", 3, null],
      ["seg_plg_native", "PLG-native startups", "Self-serve-first, usage-priced startups are the sharpest fit \u2014 the whole company already runs the loop we operate. Watch launch feeds and PLG community threads.", "market", 3, "seg_core_icp"],
      ["seg_devtools", "DevTools & technical products", "DevTools companies prototype naturally and default to PLG. Watch their product-team hiring and tooling discussions.", "market", 3, "seg_core_icp"],
      ["per_econ_buyer", "Head of Product / VP Product", "The economic buyer \u2014 owns the tool budget and personally feels the broken sense-to-ship thread. Watch what product leadership reads, attends, and debates.", "market", 3, null],
      ["per_pm", "Product managers", "The daily operator \u2014 senses, decides, and now prototypes with AI. Their signal lives in product communities, PM newsletters and podcasts, and AI-prototyping threads.", "market", 3, "per_econ_buyer"],
      ["per_pmm", "PMM / GTM leads", "The second operator \u2014 turns the living record into messaging, battlecards, and campaigns. Their signal lives in PMM communities and GTM newsletters.", "market", 3, null],
      ["dem_hiring", "Demand signals in hiring", "First-PMM, growth-PM, and product-ops-plus-AI job postings are direct demand for the loop. Watch job boards for ICP-stage companies.", "market", 3, null],
      ["arch_market_adj", "One step out", "Nearby segments and roles \u2014 tracked steadily; they become direct as PLG spreads.", "market", 2, null],
      ["adj_vertical_saas", "Vertical SaaS adopting PLG", "Vertical SaaS teams adding PLG motions arrive when sales-led stalls. Watch PLG-transformation stories and hires in vertical SaaS.", "market", 2, "arch_market_adj"],
      ["adj_founders", "Founder-operators", "Series-A founders run product AND GTM personally \u2014 the whole-loop pitch lands hardest here. Watch founder communities and accelerator content.", "market", 2, "arch_market_adj"],
      ["adj_growth_revops", "Growth & RevOps leads", "They adopt the sell loop \u2014 usage to PQL \u2014 and bring the data with them. Watch RevOps and growth communities and their tooling debates.", "market", 2, "arch_market_adj"],
      ["arch_market_ind", "The horizon", "General movement that reshapes our world without naming it.", "market", 1, null],
      ["ind_ai_governance", "AI-governance expectations", "EU-AI-Act-class rules and SOC 2 scrutiny of AI features shape agentic-tool procurement \u2014 our ratification gate is the answer. Watch enterprise AI-policy news.", "market", 1, "arch_market_ind"],
      ["ind_budget_cycles", "SaaS budgets & consolidation", "Macro budget cycles and stack-consolidation pressure decide whether one platform beats five tools this year. Watch spend reports and consolidation coverage.", "market", 1, "arch_market_ind"],
      ["ind_future_of_pm", "The future-of-PM discourse", "How AI changes the PM role reshapes demand for the loop. Watch the debate in product-leadership media.", "market", 1, "arch_market_ind"],

      // ---- TECHNOLOGY — direct: embedded + build engines; adjacent: one step
      //      out; indirect: the horizon ----
      ["tech_embedded", "Embedded intelligence", "Frontier model APIs are load-bearing in the product itself \u2014 agent quality, synthesis honesty, and proposal quality ride the current generation. Watch model releases and capability jumps.", "technology", 3, null],
      ["t_agent_sdks", "Agent frameworks & SDKs", "Agent SDKs set what our executive agents can do \u2014 tool use, long-horizon work, governed autonomy. Watch framework releases and changelogs.", "technology", 3, "tech_embedded"],
      ["t_mcp", "MCP connector fabric", "MCP turns every tool a customer runs into a signal source or an action surface. Watch registry growth and new server releases.", "technology", 3, "tech_embedded"],
      ["tech_build", "Build engines", "Prompt-to-app and code-generation capability is the Build module's engine \u2014 releases that improve working-app generation move our core wedge. Watch codegen model and tool launches.", "technology", 3, null],
      ["t_codegen_steps", "Codegen step changes", "Long-horizon agents, computer use, and code-executing agents each redraw what 'the PM prototypes it themselves' means. Watch provider research posts and agent benchmarks.", "technology", 3, "tech_build"],
      ["arch_tech_adj", "One step out", "Technology one step from the core \u2014 shifts here move cost, capability, or buyer expectations.", "technology", 2, null],
      ["adj_open_models", "Open-weight models", "Open-weight releases set the floor for embedded cost and the ceiling for self-host demands. Watch releases and benchmarks approaching frontier quality on our workloads.", "technology", 2, "arch_tech_adj"],
      ["adj_ai_gtm", "AI-for-GTM products", "AI products running GTM work \u2014 content, enrichment, outreach, scoring \u2014 are our sell-loop tooling AND set buyer expectations. Watch launches and adoption.", "technology", 2, "arch_tech_adj"],
      ["adj_infra", "Infra we ride", "Managed Postgres, edge-function, and hosting platforms carry us \u2014 pricing or capability shifts move margins and roadmap. Watch platform changelogs and pricing pages.", "technology", 2, "arch_tech_adj"],
      ["arch_tech_ind", "The horizon", "Not yet productized or priced \u2014 but it decides the next generation.", "technology", 1, null],
      ["ind_research", "Research frontier", "Memory, planning, and multi-agent research not yet productized. Watch papers and lab posts for what changes the loop next.", "technology", 1, "arch_tech_ind"],
      ["ind_agentic_reg", "Agentic-AI standards & safety", "Safety rulesets and standards for autonomous agents shape what we may ship. Watch standards bodies and provider policy changes.", "technology", 1, "arch_tech_ind"],
      ["ind_compute", "Compute economics", "API pricing and compute cost curves move our margins and what is feasible to embed. Watch provider pricing moves.", "technology", 1, "arch_tech_ind"],
    ];
    const { error } = await supabase.from("signal_profile_fields").insert(
      N.map(([field_key, label, value, vector, weight, parent_key], i) => ({
        org_id: orgId, profile_id: prof!.id, field_key, label, value, vector, weight, parent_key, position: i, origin: "human",
      })));
    if (error) throw error;
    return `+${N.length} nodes`;
  });


  // ---- Researched signals (dogfood, July 2026) ----
  // REAL intel, researched the way connector-runner would have pulled it: each
  // signal executes its node's hunting instruction, carries its source URL, and
  // is stamped with vector + node_key + domain so it lands on the right
  // intelligence page and feeds the right node. Data, not fixtures — these are
  // genuine, dated, decision-useful developments. Idempotent via the
  // researched marker; deliberately NOT swept by clearDemoIntel (it is real).
  await step("researched signals", async () => {
    const { count: c } = await supabase.from("signals").select("id", { count: "exact", head: true }).eq("metadata->>researched", "true");
    if (c) return "exist";
    const rows = [
      { org_id: orgId, scope: "org", category: "both", origin: "external", title: "Productboard Spark now GA: single $15/maker/mo plan with 250 pooled AI credits and agentic jobs", why: "PM-suite incumbent collapsed tiers into one cheap AI-agent plan (briefs, feedback, competitor analysis) \u2014 undercuts our sense/decide pricing room.", conf_level: 0.7, conf_label: "Medium", observed_at: "2026-05-15", metadata: {"domain": "competitive", "vector": "competitive", "node_key": "riv_pm_suites", "url": "https://www.productboard.com/product/spark/", "source": "Productboard", "researched": true} },
      { org_id: orgId, scope: "org", category: "both", origin: "external", title: "Dovetail + Alloy partnership turns customer feedback into live AI prototypes for PM review", why: "Two vendors stitching sense-to-build across products \u2014 the loop we sell as one governed system is forming via integrations.", conf_level: 0.8, conf_label: "Medium", observed_at: "2025-10-08", metadata: {"domain": "competitive", "vector": "competitive", "node_key": "riv_plg_ops", "url": "https://dovetail.com/blog/feedback-prototype-dovetail-alloy-partnership/", "source": "Dovetail Blog", "researched": true} },
      { org_id: orgId, scope: "org", category: "both", origin: "external", title: "Lovable in talks to raise at $12B valuation (Forbes, Jun 5 2026); ~$500M ARR, enterprise governance push", why: "Prompt-to-app leader is capitalized to add collaboration, governance, and security \u2014 moving upmarket into our Build territory fast.", conf_level: 0.75, conf_label: "Medium", observed_at: "2026-06-05", metadata: {"domain": "competitive", "vector": "competitive", "node_key": "pt_app_builders", "url": "https://www.forbes.com/sites/rashishrivastava/2026/06/05/ai-coding-startup-lovable-in-talks-to-raise-funding-at-a-12-billion-valuation/", "source": "Forbes", "researched": true} },
      { org_id: orgId, scope: "org", category: "both", origin: "external", title: "Alloy (YC) ships PM-native AI prototyping on your real design system; claims 42% of Cloud 100 signed up", why: "Purpose-built PM prototyping that matches the existing product beats generic builders \u2014 direct feature-level rival to the Build module.", conf_level: 0.7, conf_label: "Medium", observed_at: "2025-10-20", metadata: {"domain": "competitive", "vector": "competitive", "node_key": "pt_app_builders", "url": "https://www.ycombinator.com/launches/OiU-alloy-ai-prototyping-for-product-managers", "source": "Y Combinator Launches", "researched": true} },
      { org_id: orgId, scope: "org", category: "both", origin: "external", title: "Klue named Leader in first-ever Gartner MQ for Competitive & Market Intelligence Platforms (Apr 2026)", why: "CI category now Gartner-legitimized with Klue leading in revenue enablement \u2014 raises the bar for our competitive-signal surface.", conf_level: 0.7, conf_label: "Medium", observed_at: "2026-04-15", metadata: {"domain": "competitive", "vector": "competitive", "node_key": "pt_ci_tools", "url": "https://klue.com/gartner-2026", "source": "Klue", "researched": true} },
      { org_id: orgId, scope: "org", category: "both", origin: "external", title: "Klue acquired Ignition (Sep 8 2025), agentic AI spanning research, launches, messaging, win-loss", why: "Klue is absorbing the full product-marketing cycle into CI \u2014 encroaches on our GTM artifact and learn-loop scope.", conf_level: 0.8, conf_label: "Medium", observed_at: "2025-09-08", metadata: {"domain": "competitive", "vector": "competitive", "node_key": "pt_ci_tools", "url": "https://klue.com/blog/klue-acquires-ignition", "source": "Klue Blog", "researched": true} },
      { org_id: orgId, scope: "org", category: "both", origin: "external", title: "Dovetail ships Agents (beta): autonomous assistants that monitor feedback, generate docs, alert via Slack (Jan 2026)", why: "Feedback intelligence is going always-on and agentic \u2014 our Signals sense layer must match autonomous synthesis, not just search.", conf_level: 0.75, conf_label: "Medium", observed_at: "2026-01-20", metadata: {"domain": "competitive", "vector": "competitive", "node_key": "pt_insight_tools", "url": "https://dovetail.com/events/whats-new-in-dovetail-jan-2026/", "source": "Dovetail", "researched": true} },
      { org_id: orgId, scope: "org", category: "both", origin: "external", title: "Notion 3.3 (Feb 24 2026) launches Custom Agents plus marketplace templates like Linear PRD Implementer", why: "Teams can now stitch a 24/7 PM workflow inside Notion for ~$0 extra \u2014 strengthens the DIY-stack alternative.", conf_level: 0.8, conf_label: "Medium", observed_at: "2026-02-24", metadata: {"domain": "competitive", "vector": "competitive", "node_key": "adj_diy_stack", "url": "https://www.notion.com/releases/2026-02-24", "source": "Notion Releases", "researched": true} },
      { org_id: orgId, scope: "org", category: "both", origin: "external", title: "Amplitude launches agentic AI analytics (Feb 16 2026): Global Agent + 4 agents, MCP into Cursor, Lovable, Figma", why: "Analytics incumbent now recommends and takes actions \u2014 creeping from measurement into our decide loop.", conf_level: 0.85, conf_label: "High", observed_at: "2026-02-16", metadata: {"domain": "competitive", "vector": "competitive", "node_key": "ind_plg_analytics", "url": "https://www.businesswire.com/news/home/20260216773220/en/Amplitude-Introduces-Agentic-AI-Analytics-for-the-Next-Era-of-Product-Experiences", "source": "Business Wire", "researched": true} },
      { org_id: orgId, scope: "org", category: "both", origin: "external", title: "Pendo acquires Chisel Labs (Feb 3 2026) for agentic roadmapping \u2014 its 3rd AI-native buy in 18 months", why: "Pendo is rolling up PM decision tooling onto its analytics base \u2014 converging on our sense-to-decide span from the data side.", conf_level: 0.85, conf_label: "High", observed_at: "2026-02-03", metadata: {"domain": "competitive", "vector": "competitive", "node_key": "ind_plg_analytics", "url": "https://www.pendo.io/news/pendo-acquires-chisel-labs-to-help-product-teams-build-better-and-faster-with-agentic-ai/", "source": "Pendo", "researched": true} },
      { org_id: orgId, scope: "org", category: "both", origin: "external", title: "OpenAI ships Workspace Agents (Apr 22 2026): shared org agents on Codex; credit pricing starts Jul 6 2026", why: "Frontier provider now sells governed, shared work agents that write code and reports natively \u2014 platform-level squeeze on the whole loop.", conf_level: 0.85, conf_label: "High", observed_at: "2026-04-22", metadata: {"domain": "competitive", "vector": "competitive", "node_key": "ind_provider_upstack", "url": "https://openai.com/index/introducing-workspace-agents-in-chatgpt/", "source": "OpenAI", "researched": true} },
      { org_id: orgId, scope: "org", category: "gtm", origin: "external", title: "Lovable in talks to raise at $12B valuation, ~$500M ARR, six months after its $6.6B Series B", why: "Self-serve, AI-native PLG archetype scaling fast \u2014 the buyer cohort and cultural moment our Build-first pitch rides.", conf_level: 0.8, conf_label: "Medium", observed_at: "2026-06-05", metadata: {"domain": "market", "vector": "market", "node_key": "seg_plg_native", "url": "https://www.forbes.com/sites/rashishrivastava/2026/06/05/ai-coding-startup-lovable-in-talks-to-raise-funding-at-a-12-billion-valuation/", "source": "Forbes", "researched": true} },
      { org_id: orgId, scope: "org", category: "gtm", origin: "external", title: "ProductLed publishes 'PLG Predictions for 2026: The Playbook is Being Rewritten. Fast.'", why: "The PLG community's own framing \u2014 self-serve plus AI and usage-based expansion \u2014 matches our sense-to-sell loop positioning.", conf_level: 0.6, conf_label: "Medium", observed_at: "2026-01-15", metadata: {"domain": "market", "vector": "market", "node_key": "seg_plg_native", "url": "https://productled.com/blog/plg-predictions-for-2026", "source": "ProductLed", "researched": true} },
      { org_id: orgId, scope: "org", category: "gtm", origin: "external", title: "Replit closes $400M Series D at $9B valuation, tripling in six months; targets $1B ARR", why: "DevTools PLG momentum and cash for team growth \u2014 Series C-scale devtools firms are prime product-team buyers.", conf_level: 0.85, conf_label: "High", observed_at: "2026-03-11", metadata: {"domain": "market", "vector": "market", "node_key": "seg_devtools", "url": "https://techcrunch.com/2026/03/11/replit-snags-9b-valuation-6-months-after-hitting-3b/", "source": "TechCrunch", "researched": true} },
      { org_id: orgId, scope: "org", category: "gtm", origin: "external", title: "2026 CPO Insights Report (1,500+ CPOs): 'Product Builders' up 10x, traditional PM count down 30%", why: "Product leadership's top read this spring; 3 of 4 leaders use AI prototyping \u2014 validates the Build module as a leadership-level need.", conf_level: 0.75, conf_label: "Medium", observed_at: "2026-05-15", metadata: {"domain": "market", "vector": "market", "node_key": "per_econ_buyer", "url": "https://www.prnewswire.com/news-releases/2026-cpo-insights-report-predicts-product-managers-will-disappear-by-2030-302782732.html", "source": "PR Newswire (Products That Count)", "researched": true} },
      { org_id: orgId, scope: "org", category: "gtm", origin: "external", title: "Aakash Gupta updates 'Best AI Prototyping Tools 2026: Bolt vs Lovable vs Replit vs v0' for PMs", why: "PM newsletters now rank prototyping stacks like IDE wars \u2014 tool-sprawl and 'which stack' anxiety is our wedge.", conf_level: 0.65, conf_label: "Medium", observed_at: "2026-05-01", metadata: {"domain": "market", "vector": "market", "node_key": "per_pm", "url": "https://www.news.aakashg.com/p/ai-prototyping-tools-2026", "source": "Product Growth (Aakash Gupta)", "researched": true} },
      { org_id: orgId, scope: "org", category: "gtm", origin: "external", title: "PMA State of Product Marketing 2026: AI now everyday PMM practice; metrics shift to revenue impact", why: "PMMs judged on commercial impact, not deliverable volume \u2014 favors a platform tying GTM artifacts to product signal.", conf_level: 0.65, conf_label: "Medium", observed_at: "2026-06-01", metadata: {"domain": "market", "vector": "market", "node_key": "per_pmm", "url": "https://www.productmarketingalliance.com/state-of-product-marketing-report-2026/", "source": "Product Marketing Alliance", "researched": true} },
      { org_id: orgId, scope: "org", category: "gtm", origin: "external", title: "Fluvio 2026 PMM Hiring Trends: zero respondents call success metrics for PMM hires 'very clear'", why: "First-PMM hires arrive without role clarity \u2014 an onboarding-shaped opening for structured GTM records.", conf_level: 0.6, conf_label: "Medium", observed_at: "2026-02-01", metadata: {"domain": "market", "vector": "market", "node_key": "dem_hiring", "url": "https://www.fluviomarketing.com/blog-summary/2026-product-marketing-hiring-trends-report-ai-is-hiding-whats-still-broken", "source": "Fluvio", "researched": true} },
      { org_id: orgId, scope: "org", category: "gtm", origin: "external", title: "EU agrees to delay AI Act high-risk duties to Dec 2027; Article 50 transparency holds at Aug 2, 2026", why: "Aug 2026 disclosure rules push AI questions into EU SaaS procurement questionnaires \u2014 we need answers ready.", conf_level: 0.75, conf_label: "Medium", observed_at: "2026-05-20", metadata: {"domain": "market", "vector": "market", "node_key": "ind_ai_governance", "url": "https://www.traverssmith.com/knowledge/knowledge-container/eu-agrees-to-delay-key-ai-act-compliance-deadlines/", "source": "Travers Smith", "researched": true} },
      { org_id: orgId, scope: "org", category: "gtm", origin: "external", title: "Zylo 2026 SaaS Management Index: AI-native app spend up 108%, but AI point solutions only 38% utilized", why: "Consolidation pressure plus poorly-used AI point tools strengthens the 'one platform vs five tools' pitch.", conf_level: 0.75, conf_label: "Medium", observed_at: "2026-02-15", metadata: {"domain": "market", "vector": "market", "node_key": "ind_budget_cycles", "url": "https://zylo.com/2026-saas-management-index", "source": "Zylo", "researched": true} },
      { org_id: orgId, scope: "org", category: "gtm", origin: "external", title: "Analysis of 638 practitioner voices maps how AI is transforming the PM role (March 2026)", why: "Future-of-PM discourse is now the dominant lens in product media \u2014 the narrative to attach the Build story to.", conf_level: 0.6, conf_label: "Medium", observed_at: "2026-03-15", metadata: {"domain": "market", "vector": "market", "node_key": "ind_future_of_pm", "url": "https://medium.com/@haberlah/what-638-practitioner-voices-reveal-about-pms-ai-transformation-7d2fd16be10d", "source": "Medium (David Haberlah)", "researched": true} },
      { org_id: orgId, scope: "org", category: "product", origin: "external", title: "Anthropic launches Claude Fable 5 (Jun 9): 1M context, adaptive thinking; redeployed globally Jul 1", why: "Frontier capability jump for our embedded agents; 1M context enables whole-record synthesis \u2014 and the rollout pause shows platform risk.", conf_level: 0.85, conf_label: "High", observed_at: "2026-06-09", metadata: {"domain": "capability", "vector": "technology", "node_key": "tech_embedded", "url": "https://www.infoq.com/news/2026/06/claude-5-release/", "source": "InfoQ", "researched": true} },
      { org_id: orgId, scope: "org", category: "product", origin: "external", title: "OpenAI Agents SDK adds model-native harness and sandboxed execution for file/tool work (April 2026)", why: "Competitor agent stack ships memory, sandbox orchestration, filesystem tools \u2014 raises the bar for our agent runtime choices.", conf_level: 0.8, conf_label: "Medium", observed_at: "2026-04-15", metadata: {"domain": "capability", "vector": "technology", "node_key": "t_agent_sdks", "url": "https://openai.com/index/the-next-evolution-of-the-agents-sdk/", "source": "OpenAI", "researched": true} },
      { org_id: orgId, scope: "org", category: "product", origin: "external", title: "MCP publishes next-spec release candidate: stateless core, Extensions, Tasks, MCP Apps; final Jul 28", why: "MCP is Linux Foundation-governed with ~10k public servers \u2014 our connector strategy should track Tasks and MCP Apps primitives.", conf_level: 0.75, conf_label: "Medium", observed_at: "2026-07-01", metadata: {"domain": "capability", "vector": "technology", "node_key": "t_mcp", "url": "https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/", "source": "Model Context Protocol Blog", "researched": true} },
      { org_id: orgId, scope: "org", category: "product", origin: "external", title: "Vercel ships 'the new v0' (Feb 3): sandbox runtime, GitHub PR workflows, imports existing codebases", why: "Prompt-to-app moves from prototype to production-grade git workflows \u2014 capability lift and competitive pressure for the Build module.", conf_level: 0.85, conf_label: "High", observed_at: "2026-02-03", metadata: {"domain": "capability", "vector": "technology", "node_key": "tech_build", "url": "https://vercel.com/blog/introducing-the-new-v0", "source": "Vercel", "researched": true} },
      { org_id: orgId, scope: "org", category: "product", origin: "external", title: "OSWorld 2.0: 108 long-horizon computer-use tasks (~1.6h human median); best agent completes 20.6%", why: "Quantifies the long-horizon gap \u2014 agents fail on hidden state and mid-task updates; informs how much autonomy we can safely grant.", conf_level: 0.8, conf_label: "Medium", observed_at: "2026-06-25", metadata: {"domain": "capability", "vector": "technology", "node_key": "t_codegen_steps", "url": "https://arxiv.org/abs/2606.29537", "source": "arXiv", "researched": true} },
      { org_id: orgId, scope: "org", category: "product", origin: "external", title: "DeepSeek V4 Preview (Apr 24): V4-Pro hits 80.6% SWE-bench Verified under MIT, near frontier coding quality", why: "Open-weight coding within single points of frontier \u2014 a future cost lever or fallback for our codegen workloads.", conf_level: 0.65, conf_label: "Medium", observed_at: "2026-04-24", metadata: {"domain": "capability", "vector": "technology", "node_key": "adj_open_models", "url": "https://www.digitalapplied.com/blog/open-weight-models-h1-2026-retrospective-deepseek-qwen-llama", "source": "Digital Applied", "researched": true} },
      { org_id: orgId, scope: "org", category: "product", origin: "external", title: "Clay's Claygent passes 1B AI research runs as GTM agents become production-grade in-table capability", why: "AI enrichment/research agents are mainstream in GTM stacks \u2014 validates our sense/sell loop and sets integration expectations.", conf_level: 0.6, conf_label: "Medium", observed_at: "2026-05-01", metadata: {"domain": "capability", "vector": "technology", "node_key": "adj_ai_gtm", "url": "https://www.clay.com/claygent", "source": "Clay", "researched": true} },
      { org_id: orgId, scope: "org", category: "product", origin: "external", title: "Vercel Pro bundles Turbo build machines (30 vCPU / 60GB) by default as of February 2026", why: "Faster default builds at the same seat price improve our deploy-loop economics on the existing surface.", conf_level: 0.55, conf_label: "Low", observed_at: "2026-02-15", metadata: {"domain": "capability", "vector": "technology", "node_key": "adj_infra", "url": "https://uibakery.io/blog/vercel-vs-supabase", "source": "UI Bakery", "researched": true} },
      { org_id: orgId, scope: "org", category: "product", origin: "external", title: "NIST CAISI launches AI Agent Standards Initiative (Feb 17): agent security, interoperability, identity", why: "US standards track signals coming requirements for agent identity and audit trails \u2014 our ratification trail is the head start.", conf_level: 0.75, conf_label: "Medium", observed_at: "2026-02-17", metadata: {"domain": "capability", "vector": "technology", "node_key": "ind_agentic_reg", "url": "https://www.pillsburylaw.com/en/news-and-insights/nist-ai-agent-standards.html", "source": "Pillsbury Law", "researched": true} },
      { org_id: orgId, scope: "org", category: "product", origin: "external", title: "Anthropic cuts Opus pricing 67% to $5/$25 per Mtok at Opus 4.6 launch; holds price at Opus 4.8", why: "Flagship-tier tokens at former mid-tier prices materially improve unit economics for agent-heavy synthesis and Build runs.", conf_level: 0.7, conf_label: "Medium", observed_at: "2026-02-05", metadata: {"domain": "capability", "vector": "technology", "node_key": "ind_compute", "url": "https://www.cloudzero.com/blog/claude-api-pricing/", "source": "CloudZero", "researched": true} },
    ];
    const { error } = await supabase.from("signals").insert(rows);
    if (error) throw error;
    return `+${rows.length}`;
  });

  // ---- Battle cards (the SELLER's asset — what to SAY, per competitor) ----
  await step("battle cards", async () => {
    const { count: c } = await supabase.from("battlecard_items").select("id", { count: "exact", head: true });
    if (c) return "exist";
    const { data: comps } = await supabase.from("competitors").select("id, name");
    const cid = (n: string) => comps?.find((x) => x.name === n)?.id ?? null;
    const cards: [string, string, string, string][] = [
      // [competitor, kind, title, detail]
      ["Productboard", "win", "One record for product AND GTM", "Spark assists roadmapping, but the truth still lives in scattered docs. We hold product + GTM in one record that only moves when a human ratifies — so it never drifts."],
      ["Productboard", "lose", "Roadmapping depth", "If the only need is roadmap prioritization and delivery, they're deeper there. Reframe to the unified record + real build + GTM."],
      ["Productboard", "proof", "Human-ratified, auditable change", "Every change is a ratified proposal with a full trail — exactly what procurement now asks about."],
      ["Lovable", "win", "Build stays connected to the why", "Lovable generates a prototype with no memory of the strategy, signals, or GTM behind it. We build on the record, so the artifact stays tied to the decision that drove it."],
      ["Lovable", "trap", "Ask: where does the prototype's rationale live?", "Build tools produce code; nobody keeps it tied to the signal, the strategy, and the GTM. That connection is the wedge — set it early."],
      ["Cursor", "win", "BYO build tool, governed record", "Cursor is a great coding tool — we orchestrate around it. Build there or in-app; the record and the human-ratified governance are ours."],
      ["Notion", "win", "Opinionated for the PLG loop", "Notion can model anything but understands nothing about sense → build → sell → learn. We're purpose-built for that loop, with governed AI."],
      ["Pendo", "win", "A signal source, not the system of record", "We ingest usage signals; Pendo can't keep your product + GTM record current. Complementary — feed us, we govern the change."],
    ];
    const rows = cards.flatMap(([name, kind, title, detail], i) => { const id = cid(name); return id ? [{ org_id: orgId, competitor_id: id, kind, title, detail, position: i }] : []; });
    if (rows.length) { const { error } = await supabase.from("battlecard_items").insert(rows); if (error) throw error; }
    return `+${rows.length}`;
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
    const { error } = await supabase.rpc("human_add_fields", { p_rows: [
      // Audience + Motion = GTM strategy (the Strategy & execution tab)
      ["primary_persona", "Primary persona", "The product manager at a product-led B2B company who needs to go from a market signal to a real, working prototype to a shipped, sold feature — without leaving one system.", "Audience", 0],
      ["icp", "Ideal customer profile", "Scaling B2B software companies (Series A–C, 20–200 people) building product-led, where PMs and GTM need to move from signal → shipped → sold without tool-hopping.", "Audience", 1],
      ["industries", "Industries / verticals", "B2B software / SaaS.", "Audience", 2],
      ["gtm_motion", "GTM motion", "Product-led: hands-on AI prototyping in the Build module is the wedge; usage → PQLs → assisted GTM. Lead with 'build it for real,' backed by working-prototype proof.", "Motion", 3],
      // Messaging framework (the Messaging tab)
      ["positioning_statement", "Positioning statement", "For product and GTM teams at PLG companies, SingleStack is the living system of record for both product and go-to-market, where teams also build for real — the whole loop (sense → decide → build → sell → learn) on one record, every AI change human-ratified.", "Messaging", 4],
      ["value_proposition", "Value proposition", "Take an idea all the way through the PLG loop on one living record — AI does the work, humans ratify every change, nothing drifts.", "Messaging", 5],
      ["pillar_1", "Messaging pillar 1", "One record for product + GTM — always current, the shared source of truth.", "Messaging", 6],
      ["pillar_2", "Messaging pillar 2", "Build is first-class — real AI prototyping on the record with your own coding tools, not just docs.", "Messaging", 7],
      ["pillar_3", "Messaging pillar 3", "Human-ratified AI — every change is a reviewable, auditable proposal you approve.", "Messaging", 8],
      ["proof_points", "Proof points", "6 design partners · 41 weekly active operators · 12 prototypes shipped/week · every change carries an auditable, ratified trail.", "Messaging", 9],
    ].map(([field_key, label, value, section, position]) => ({ org_id: orgId, gtm_record_id: gtmId, field_key, label, value, section, position })) });
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
      ["AI app builders make real prototyping mainstream", "analysts", "Tools like Lovable and Cursor mean PMs can build for real — the premise behind a first-class Build module.", 0.7, "High", 54],
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
    const skillDefs = SKILL_DEFS; // canonical source: web/skills/**/SKILL.md → skills.generated.ts
    let made = 0;
    for (const s of skillDefs) {
      // SKILL.md is the source of truth for built-in (template) skills: insert if missing,
      // otherwise sync content — but never clobber a skill a human/agent has evolved.
      let sk: { id: string } | null = null;
      const { data: existing } = await supabase.from("skills").select("id, source").eq("key", s.key).maybeSingle();
      if (existing) {
        sk = { id: (existing as { id: string }).id };
        if ((existing as { source?: string }).source === "template") {
          await supabase.from("skills").update({ name: s.name, description: s.description, category: s.category, instructions: s.instructions, areas: s.areas, connectors: s.connectors, kind: s.cornerstone ? "cornerstone" : "child" }).eq("id", sk.id);
        }
      } else {
        const { data: created } = await supabase.from("skills").insert({ org_id: orgId, key: s.key, name: s.name, description: s.description, category: s.category, instructions: s.instructions, source: "template", areas: s.areas, connectors: s.connectors, kind: s.cornerstone ? "cornerstone" : "child" }).select("id").single();
        if (created) { sk = { id: (created as { id: string }).id }; made++; }
      }
      if (sk) {
        for (const k of s.agents) {
          const aid = agentId(k); if (!aid) continue;
          await supabase.from("agent_skills").upsert({ org_id: orgId, agent_id: aid, skill_id: sk.id, is_cornerstone: s.cornerstone }, { onConflict: "agent_id,skill_id", ignoreDuplicates: true });
          // Backfill: the upsert above ignores existing rows, so set the cornerstone flag
          // explicitly for already-attached skills (fixes orgs seeded before cornerstones).
          if (s.cornerstone) await supabase.from("agent_skills").update({ is_cornerstone: true }).eq("agent_id", aid).eq("skill_id", sk.id);
        }
      }
    }
    return made ? `+${made}` : "exist";
  });

  // ---- Agentic tasks (multi-step workflows) ----
  // Real, ordered processes: each step is an officer applying its skills, drawing on
  // internal/external signals; its output feeds the next. run-workflow executes them.
  await step("agentic workflows", async () => {
    const uid = () => (globalThis.crypto?.randomUUID?.() ?? `s_${Math.random().toString(36).slice(2)}`);
    const A = (k: string) => agentId(k);
    const { data: have } = await supabase.from("workflows").select("name");
    const names = new Set((have ?? []).map((w) => w.name));
    const defs: { name: string; description: string; steps: { agent: string; signals: "none" | "internal" | "external" | "both"; instruction: string }[] }[] = [
      {
        name: "Harden a GTM record",
        description: "Three officers pass a GTM record forward: sharpen positioning, tighten the narrative, then check it against the product truth.",
        steps: [
          { agent: "cro", signals: "external", instruction: "Read the GTM record and the latest competitive + market signals. Sharpen the positioning against named competitors — where we win, where to reframe, the proof. Hand the tightened positioning to the narrative pass." },
          { agent: "cco", signals: "none", instruction: "Take the CRO's positioning and make the narrative consistent, concrete, and human-in-the-loop across the record. Strip hype; keep the one story. Hand the polished narrative forward." },
          { agent: "cpo", signals: "internal", instruction: "Verify the GTM claims align with the product record and the evidence. Flag anything overclaimed or unsupported, and note the single change that would most improve the record." },
        ],
      },
      {
        name: "Competitive teardown",
        description: "Tear down a named competitor, then map the read back to our own product truth — where we win, where we're exposed, and the one move that matters.",
        steps: [
          { agent: "cro", signals: "external", instruction: "Tear down the named competitor using the latest competitive + market signals (and any connector you have for their docs/site). Cover their positioning, pricing posture, strongest claims, and where they're vulnerable. Be concrete and cite the signals you leaned on. Hand the teardown forward." },
          { agent: "cpo", signals: "internal", instruction: "Take the CRO's teardown and map it against our product record and evidence: where we genuinely win, where we're exposed, and what's overclaimed on either side. Recommend the single highest-leverage move in response." },
        ],
      },
      {
        name: "Frontier capability sweep",
        description: "Engineering scans what's newly possible; product turns it into priorities.",
        steps: [
          { agent: "ceng", signals: "both", instruction: "Review the recent frontier-model & platform capabilities. Flag what is newly buildable for us and what each unlocks — separate now from later, and note the dependency on each 'later'." },
          { agent: "cpo", signals: "internal", instruction: "Translate engineering's read into product implications: which newly-possible capabilities map to corroborated demand, and the smallest change that would move the metric. Recommend the top one or two to prioritize." },
        ],
      },
    ];
    let made = 0;
    for (const d of defs) {
      if (names.has(d.name)) continue;
      const steps = d.steps.flatMap((s) => { const id = A(s.agent); return id ? [{ id: uid(), agent_id: id, skill_id: null, signals: s.signals, instruction: s.instruction }] : []; });
      if (!steps.length) continue;
      const { error } = await supabase.from("workflows").insert({ org_id: orgId, agent_id: steps[0].agent_id, name: d.name, description: d.description, trigger: "manual", target_type: "none", steps, is_active: true });
      if (!error) made++;
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

  // ---- People (assignable owners) — top up by name ----
  await step("people", async () => {
    const team: [string, string, string][] = [
      ["Maya Chen", "Head of Product", "product"],
      ["Sam Rivera", "Chief Engineer", "eng"],
      ["Jordan Lee", "Head of GTM", "gtm"],
      ["Alex Kim", "Founder / CEO", "exec"],
    ];
    const { data: ex } = await supabase.from("people").select("name");
    const have = new Set((ex ?? []).map((r) => r.name));
    const toAdd = team.filter(([n]) => !have.has(n));
    if (!toAdd.length) return "exist";
    const { error } = await supabase.from("people").insert(toAdd.map(([name, title, area]) => ({ org_id: orgId, name, title, area })));
    if (error) throw error; return `+${toAdd.length}`;
  });

  // ---- Strategy north star (objective only — no fake in-flight work) ----
  // De-faked: we no longer seed pretend initiatives / roadmap / content. The
  // Build workflow starts EMPTY and is filled for real by shipping bundles from
  // Product Strategy (the seeded signals above are the raw intake). We keep one
  // real objective as the strategic frame.
  await step("strategy", async () => {
    const OBJ = "Win the AI-native product + GTM category in 2026";
    const { data: obj } = await supabase.from("objectives").select("id").eq("title", OBJ).maybeSingle();
    if (obj) return "exist";
    await supabase.from("objectives").insert({ org_id: orgId, title: OBJ, pillar: "Growth", description: "Be the living system of record for product + GTM before the category consolidates.", status: "active" });
    return "+1";
  });

  // ---- Automations: an on_release workflow + one fired (pending) run ----
  await step("automations", async () => {
    const { data: existing } = await supabase.from("workflow_runs").select("id").limit(1);
    if (existing && existing.length) return "exist";
    const aid = agentId("cro"); if (!aid) return "no agent";
    let { data: wf } = await supabase.from("workflows").select("id").eq("name", "Launch follow-through").maybeSingle();
    if (!wf) ({ data: wf } = await supabase.from("workflows").insert({
      org_id: orgId, agent_id: aid, name: "Launch follow-through", trigger: "on_release",
      function_key: "enablement", target_type: "none", is_active: true,
    }).select("id").single());
    const { data: rel } = await supabase.from("releases").select("id, name, version").eq("name", "Agent orchestration").maybeSingle();
    if (wf && rel) {
      const label = rel.version ? `${rel.version} · ${rel.name}` : rel.name;
      await supabase.from("workflow_runs").insert({
        org_id: orgId, workflow_id: wf.id, trigger: "on_release", status: "pending",
        context: { label, releaseId: rel.id }, summary: `Launch follow-through — ${label}`,
        proposed_action: `Draft a GTM launch follow-through initiative for “${label}”.`,
      });
    }

    // A product-targeted on_signal workflow — accepting has the product officer
    // DRAFT a proposal on the record (agent-propose), the AI-maximizing path.
    const cpo = agentId("cpo");
    const { data: prod } = await supabase.from("product_records").select("id, name").limit(1).maybeSingle();
    const { data: sig } = await supabase.from("signals").select("id, title, why").eq("category", "product").limit(1).maybeSingle();
    if (cpo && prod) {
      let { data: wf2 } = await supabase.from("workflows").select("id").eq("name", "Respond to product signals").maybeSingle();
      if (!wf2) ({ data: wf2 } = await supabase.from("workflows").insert({
        org_id: orgId, agent_id: cpo, name: "Respond to product signals", trigger: "on_signal",
        function_key: "positioning", target_type: "product", target_id: prod.id, is_active: true,
      }).select("id").single());
      if (wf2 && sig) {
        await supabase.from("workflow_runs").insert({
          org_id: orgId, workflow_id: wf2.id, trigger: "on_signal", status: "pending",
          context: { label: sig.title, why: sig.why ?? undefined, signalId: sig.id },
          summary: `Respond to product signals — ${sig.title}`,
          proposed_action: `Have the product officer draft a proposal on ${prod.name}.`,
        });
      }
    }
    return "+1";
  });

  // ---- Durable themes ----
  await step("themes", async () => {
    const defs = [
      { category: "product", state: "escalating", momentum: "accelerating", conf_level: 0.86, title: "Buyers expect built-in agent orchestration", summary: "Demand is shifting from single assistants to multi-agent orchestration; analyst commentary and adjacent product moves corroborate.", recommendation: "Make orchestration a first-class, demoable capability; evolve engineering & product skills to leverage new platform features." },
      { category: "gtm", state: "active", momentum: "steady", conf_level: 0.7, title: "Pricing & “AI wrapper” objections create demo-to-trial friction", summary: "Two recurring post-demo blockers: unclear pricing and skepticism that we're 'just a wrapper'.", recommendation: "Lead messaging with human-in-the-loop control; clarify pricing tiers on the hero path." },
      { category: "product", state: "escalating", momentum: "accelerating", conf_level: 0.78, title: "Frontier capabilities reset table stakes each quarter", summary: "New model capabilities (orchestration, memory, long context) keep changing what's expected of an 'AI operating layer'.", recommendation: "Continuously evolve agent skills to leverage new capabilities; treat capability releases as signals every officer acts on." },
      { category: "gtm", state: "active", momentum: "accelerating", conf_level: 0.62, title: "Human-in-the-loop governance is becoming a buying criterion", summary: "Procurement increasingly asks how AI changes are reviewed and audited — our ratification model is a differentiator if we lead with it.", recommendation: "Put HITL governance on the hero and in the security one-pager." },
      { category: "product", state: "active", momentum: "steady", conf_level: 0.5, title: "Mobile is an underserved surface", summary: "Demo-to-trial drop-off concentrates on mobile; the hero CTA underperforms there.", recommendation: "Ship a mobile-first hero variant; measure trial starts." },
      { category: "gtm", state: "emerging", momentum: "accelerating", conf_level: 0.34, title: "“Operating layer” category language is forming", summary: "Analysts beginning to reframe copilots as operating layers — early, thin, but trending our way.", recommendation: "Watch; seed the language in content, don't bet the positioning yet." },
      { category: "product", state: "fading", momentum: "fading", conf_level: 0.42, title: "Standalone roadmapping as a wedge", summary: "Leading with roadmapping is losing steam; buyers want the unified record where they also build, not another roadmap tool.", recommendation: "De-emphasize roadmapping-first messaging." },
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

  // ---- Accounts → usage → PQL (the Sell loop has real content) ----
  await step("accounts (usage / PQL)", async () => {
    const { count: c } = await supabase.from("accounts").select("id", { count: "exact", head: true });
    if (c) return "exist";
    // [ref, name, domain, plan, activation, expansion, churn, pql_state, reason, lastSeenH]
    const accts: [string, string, string, string, number, number, number, string, string, number][] = [
      ["acme", "Acme Robotics", "acme.io", "Team", 0.82, 0.7, 0.1, "expansion", "Activation 82% — 12 activation actions in 35d; 6 seats added and hitting plan limits.", 6],
      ["globex", "Globex", "globex.com", "Pro", 0.74, 0.2, 0.15, "qualified", "Activation 74% — onboarding complete, 9 key actions. Product-qualified.", 10],
      ["soylent", "Soylent", "soylent.io", "Pro", 0.6, 0.1, 0.1, "qualified", "Activation 60% — crossed the activation bar this week.", 14],
      ["initech", "Initech", "initech.co", "Starter", 0.35, 0.05, 0.2, "activating", "Activation 35% — onboarding underway (3 actions).", 18],
      ["umbrella", "Umbrella Corp", "umbrella.com", "Team", 0.4, 0.0, 0.7, "at_risk", "Churn risk 70% — logins down ~60%, last seen 24d ago.", 24 * 24],
    ];
    const rows = accts.map(([external_ref, name, domain, plan, a, e, ch, pql, reason, h]) => ({ org_id: orgId, external_ref, name, domain, plan, status: "active", metrics: {}, last_seen_at: iso(h), activation_score: a, expansion_score: e, churn_risk: ch, pql_state: pql, score_reason: reason, scored_at: iso(2) }));
    const { data: created, error } = await supabase.from("accounts").insert(rows).select("id, external_ref, name, pql_state, score_reason");
    if (error) throw error;
    const refId = new Map((created ?? []).map((x) => [x.external_ref, x.id]));
    // Usage events — the evidence behind each score.
    const evs: Record<string, unknown>[] = [];
    const ev = (ref: string, kind: string, value: number, h: number) => { const id = refId.get(ref); if (id) evs.push({ org_id: orgId, account_id: id, kind, value, occurred_at: iso(h) }); };
    ev("acme", "activation", 5, 30); ev("acme", "feature_adopt", 4, 20); ev("acme", "seat_add", 6, 10); ev("acme", "limit_hit", 2, 5);
    ev("globex", "onboarding_complete", 1, 40); ev("globex", "key_action", 9, 15);
    ev("soylent", "activation", 4, 10);
    ev("initech", "activation", 3, 12);
    ev("umbrella", "churn_risk", 2, 8); ev("umbrella", "login", 1, 24 * 24);
    if (evs.length) await supabase.from("account_events").insert(evs);
    // Emit the PQL signals these crossings would have produced (so /signals and
    // the GTM strategy board show the sell motion the product generated).
    const titleFor = (s: string, n: string) => s === "qualified" ? `PQL: ${n} is product-qualified` : s === "expansion" ? `Expansion signal: ${n}` : `Churn risk: ${n}`;
    const sigs = (created ?? []).filter((x) => ["qualified", "expansion", "at_risk"].includes(x.pql_state))
      .map((x) => ({ org_id: orgId, scope: "org", origin: "internal", category: "gtm", title: titleFor(x.pql_state, x.name).slice(0, 280), why: x.score_reason, conf_level: 0.9, conf_label: "High", observed_at: iso(2), metadata: { domain: "usage", account_id: x.id, pql_state: x.pql_state } }));
    if (sigs.length) await supabase.from("signals").insert(sigs);
    return `+${rows.length}`;
  });

  // ---- Outcome track record (the Learn loop: shipped work, scored) ----
  await step("outcome track record", async () => {
    const { count: c } = await supabase.from("expected_outcomes").select("id", { count: "exact", head: true });
    if (c) return "exist";
    const TITLE = "Ship agent orchestration as a demoable capability";
    let { data: b } = await supabase.from("strategy_bundles").select("id").eq("title", TITLE).maybeSingle();
    if (!b) ({ data: b } = await supabase.from("strategy_bundles").insert({ org_id: orgId, title: TITLE, rationale: "Buyers expect built-in orchestration; make it first-class and demoable.", state: "promoted", promoted_at: iso(40 * 24) }).select("id").single());
    if (!b) return "no bundle";
    const rows = [
      { org_id: orgId, bundle_id: b.id, title: "Demo-to-trial conversion rises", measure_kind: "signal", direction: "up", horizon_days: 30, review_due_at: iso(5 * 24), baseline_at: iso(40 * 24), status: "hit", ai_verdict: "hit", ai_rationale: "Multiple signals show the orchestration demo converting; trial starts up ~20%.", resolved_at: iso(3), resolved_by: "human", resolution_note: "Confirmed — the orchestration demo is the new default and lifted conversion." },
      { org_id: orgId, bundle_id: b.id, title: "“AI wrapper” objection fades", measure_kind: "signal", direction: "down", horizon_days: 45, review_due_at: iso(-15 * 24), baseline_at: iso(40 * 24), status: "watching" },
    ];
    const { error } = await supabase.from("expected_outcomes").insert(rows);
    if (error) throw error; return "+2";
  });

  const summary = report.join(" · ");
  return {
    created: errors.length === 0,
    message: errors.length
      ? `Loaded with issues — ${summary}. ⚠️ ERRORS: ${errors.join(" | ")}`
      : `SingleStack workspace loaded ✓ — ${summary}. Operator view: Signals → Strategy. Seller view: Competitive → Competitors (battle cards), Go-to-market → Qualified leads (PQLs).`,
  };
}

// ============================================================================
// clearDemoIntel — the broom for "we're doing legit now".
//
// Deletes the DEMO INTEL the seed above inserted — signals, themes, battle
// cards, accounts, outcomes, and the seeded capability-matrix rows (their
// scores cascade, so the matrix AND the grid empty together) — matched by the
// exact titles/domains the seed uses (keep the lists in sync with the step
// literals above). Deliberately NOT touched: the product & GTM records and
// their fields (the user authors those), competitors (real rivals),
// agents/skills/workflows (configuration, not intel). Usage-domain signals
// and accounts are removed wholesale: no live
// analytics/CRM connector exists yet, so every one of them is seed by
// definition. RLS scopes all deletes to the caller's org.
// ============================================================================
// deno-lint-ignore-file
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function clearDemoIntel(supabase: any): Promise<{ message: string }> {
  const SIGNAL_TITLES = [
    // competitive
    "Lovable crosses $40M ARR — AI app builders make PM prototyping real",
    "Productboard ships Spark, an AI product agent",
    "Enterprise buyers require human-in-the-loop sign-off on AI",
    // gtm record
    "Prospects bounce on the pricing page after the demo",
    "“Is it just an AI wrapper?” keeps surfacing",
    "Founders resonate with “living system of record”",
    "Demo-to-trial drop-off on mobile",
    // market
    "Analysts reframing “AI copilots” as “AI operating layers”",
    "AI app builders make real prototyping mainstream",
    "Buyers now expect human-in-the-loop governance",
    // frontier capabilities
    "Claude tool orchestration", "Claude long-term memory", "Claude computer use",
    "OpenAI Realtime API", "OpenAI structured outputs", "Google Gemini long context",
    "Meta Llama on-prem", "xAI Grok live search",
  ];
  const THEME_TITLES = [
    "Buyers expect built-in agent orchestration",
    "Pricing & “AI wrapper” objections create demo-to-trial friction",
    "Frontier capabilities reset table stakes each quarter",
    "Human-in-the-loop governance is becoming a buying criterion",
    "Mobile is an underserved surface",
    "“Operating layer” category language is forming",
    "Standalone roadmapping as a wedge",
    "Win/loss cites unclear pricing as top stall",
  ];
  const CARD_TITLES = [
    "One record for product AND GTM", "Roadmapping depth", "Human-ratified, auditable change",
    "Build stays connected to the why", "Ask: where does the prototype's rationale live?",
    "BYO build tool, governed record", "Opinionated for the PLG loop",
    "A signal source, not the system of record",
  ];
  const BUNDLE_TITLE = "Ship agent orchestration as a demoable capability";
  const MATRIX_ROWS = [
    "Unified product + GTM record", "AI build / prototyping", "Signal sensing & synthesis",
    "Product & GTM strategy", "PLG analytics & PQLs", "Human-in-the-loop governance", "Frontier-capability leverage",
  ];

  const counts: string[] = [];
  const del = async (label: string, q: Promise<{ count?: number | null; error: { message: string } | null }>) => {
    const { count, error } = await q;
    if (error) throw new Error(`${label}: ${error.message}`);
    counts.push(`${label} −${count ?? 0}`);
  };

  // Themes first (theme_signals/theme_events cascade with them), then signals.
  await del("themes", supabase.from("signal_themes").delete({ count: "exact" }).in("title", THEME_TITLES));
  // Pending recommendations derive from the intel being cleared — sweep them too.
  await del("pending recommendations", supabase.from("intel_updates").delete({ count: "exact" }).eq("status", "pending"));
  await del("signals", supabase.from("signals").delete({ count: "exact" }).in("title", SIGNAL_TITLES));
  await del("usage signals", supabase.from("signals").delete({ count: "exact" }).eq("metadata->>domain", "usage"));
  await del("battle cards", supabase.from("battlecard_items").delete({ count: "exact" }).in("title", CARD_TITLES));
  // seeded matrix rows — their capability_scores cascade, so matrix + grid clear together
  await del("matrix rows", supabase.from("capabilities").delete({ count: "exact" }).in("name", MATRIX_ROWS));
  await del("accounts", supabase.from("accounts").delete({ count: "exact" }).gte("created_at", "1970-01-01"));
  // outcomes, then their bundle
  const { data: bundle } = await supabase.from("strategy_bundles").select("id").eq("title", BUNDLE_TITLE).maybeSingle();
  if (bundle?.id) {
    await del("outcomes", supabase.from("expected_outcomes").delete({ count: "exact" }).eq("bundle_id", bundle.id));
    await del("bundle", supabase.from("strategy_bundles").delete({ count: "exact" }).eq("id", bundle.id));
  }

  return { message: `Demo intel cleared — ${counts.join(" · ")}. Kept: your product & GTM records, competitors, agents/skills/workflows. The matrix and grid are empty until evidence fills them — run the guided setup to design your own rows.` };
}
