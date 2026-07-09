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

      // ---- COMPETITIVE — archetypes root the branches; rivals chain off them ----
      ["arch_pm_suites", "PM suites", "Product-management suites are the head-on frame: they own the DECIDE leg (roadmapping, discovery, prioritization) and are bolting on AI agents.", "competitive", 3, null],
      ["riv_productboard", "Productboard", "Productboard is the closest adjacent — deep roadmapping plus the Spark AI agent; product-side only, it doesn't build and holds no GTM record.", "competitive", 2, "arch_pm_suites"],
      ["pb_agent_moves", "Spark's trajectory", "Productboard Spark's move from 'AI suggests' toward 'AI builds' is the single sharpest encroachment on our wedge — watch its releases and positioning.", "competitive", 1, "riv_productboard"],
      ["arch_ai_builders", "AI app builders", "Prompt-to-app builders own the BUILD leg — PMs already reach for them; they generate working software with no memory of the strategy, signals, or GTM behind it.", "competitive", 3, null],
      ["riv_lovable", "Lovable", "Lovable is the reference prompt-to-app builder our Build module orchestrates or displaces — watch its team features, pricing, and enterprise motion.", "competitive", 2, "arch_ai_builders"],
      ["riv_cursor", "Cursor", "Cursor owns developer-led building; it enters our deals when engineering says 'we'll just build it ourselves' — a BYO tool we embed, not a system of record.", "competitive", 2, "arch_ai_builders"],
      ["arch_workspaces", "AI workspaces", "Connected AI workspaces (Notion-class) are the flexible status-quo substitute — docs + AI that can model anything and understand nothing about the loop.", "competitive", 2, null],
      ["arch_plg_analytics", "PLG analytics", "PLG analytics tools (Pendo-class) own LEARN-leg telemetry and compete for the same 'PLG platform' budget line without deciding or building anything.", "competitive", 2, null],
      ["battlegrounds", "Where deals are won", "Deals are won on the closed loop — sense-to-ship-to-sell in one governed system — and lost when the buyer scopes the problem to a single leg a point tool does deeper.", "competitive", 3, null],
      ["status_quo_alternative", "The stitched stack", "The real rival is the stitched stack: a PM suite + Notion docs + an AI builder + spreadsheets — 'we already have tools for each piece' is the default no.", "competitive", 2, null],
      ["competitive_search_focus", "Where to hunt", "Hunt functional substitutes, not category labels: tools that turn product decisions into working software, AI agents inside PM suites, and platforms unifying product + GTM. Watch G2 comparisons, launch posts, pricing pages, and agent-roadmap announcements.", "competitive", 3, null],
      ["win_loss_patterns", "Win/loss pattern", "We win where the team feels tool-boundary pain — signal lost between product and GTM; we lose to single-leg depth when one champion owns one job.", "competitive", 2, null],

      // ---- MARKET — one branch: industries, personas, market news, graded by
      //      applicability (3 direct · 2 adjacent · 1 indirect) ----
      ["mkt_b2b_saas", "Series A–C B2B SaaS", "Series A–C B2B software companies building product-led are the direct market — big enough to hold PM and GTM roles, small enough to feel every tool seam.", "market", 3, null],
      ["mkt_plg_native", "PLG-native startups", "PLG-native startups (self-serve first, usage-priced) are the sharpest fit — the whole company already runs the loop we operate.", "market", 2, "mkt_b2b_saas"],
      ["mkt_devtools", "DevTools", "DevTools companies are the strong early segment — technical PMs prototype naturally and their GTM is PLG by default.", "market", 2, "mkt_b2b_saas"],
      ["mkt_vertical_saas", "Vertical SaaS on PLG", "Vertical SaaS teams adopting PLG motions are the indirect edge — they arrive when the sales-led motion stalls and bring compliance questions with them.", "market", 1, "mkt_plg_native"],
      ["p_head_product", "Head of Product", "The Head of Product / VP Product is the economic buyer — they own the tool budget and personally feel the broken sense→ship thread.", "market", 3, null],
      ["p_pm", "Product manager", "The product manager is the daily operator — senses, decides, and now legitimately prototypes with AI instead of writing another spec.", "market", 2, "p_head_product"],
      ["p_pm_signal", "Where PMs talk", "PM signal lives where they compare tools and vent about sprawl: product communities, PM podcasts and newsletters, and AI-prototyping threads.", "market", 1, "p_pm"],
      ["p_pmm", "PMM / GTM lead", "The PMM or GTM lead is the second daily operator — turns the same living record into messaging, battlecards, and campaigns without re-asking product.", "market", 3, null],
      ["p_growth", "Growth / RevOps", "Growth and RevOps leads adopt the sell loop — usage → PQL scoring — arriving with the data and staying for the pipeline.", "market", 2, "p_pmm"],
      ["p_founder", "Founder-operator", "Series A founders run product AND GTM personally — the whole-loop pitch lands hardest on them, and they ratify fastest.", "market", 2, null],
      ["market_objections", "Standing objections", "'We already have Productboard and Notion' and 'AI can't be trusted to change our records' are the two standing objections — the Build wedge answers the first, ratification the second.", "market", 2, null],
      ["regulatory_landscape", "AI governance pressure", "AI-governance expectations (EU-AI-Act-class rules, SOC 2 scrutiny of AI features) shape agentic-tool adoption — our human-ratification gate is the compliance answer.", "market", 1, null],
      ["market_search_focus", "Where the market talks", "Watch where PLG operators actually talk: PLG and growth communities, product-leadership newsletters and podcasts, launch feeds for PLG-native startups, analyst coverage of AI in product management, and hiring signals (first PMM, growth PM, product-ops-plus-AI postings).", "market", 3, null],

      // ---- TECHNOLOGY — three uses root the branches: what we EMBED, what we
      //      BUILD with, what powers GTM; frontier AND open-source across all ----
      ["tech_embedded", "Embedded in the product", "Frontier and open-source models are embedded in the product itself — agent quality, synthesis honesty, and proposal quality all ride the current model generation.", "technology", 3, null],
      ["t_agent_sdks", "Agent frameworks", "Agent frameworks and SDKs set what our executive agents can do — tool use, long-horizon work, and governed autonomy ride their release cadence.", "technology", 2, "tech_embedded"],
      ["t_mcp", "MCP fabric", "MCP is the connector fabric — every tool a customer already runs becomes a signal source or an action surface without bespoke integrations.", "technology", 2, "t_agent_sdks"],
      ["t_open_models", "Open-source models", "Open-source model releases set the floor for embedded cost and the ceiling for self-hosted demands — watch open-weight releases that approach frontier quality on our workloads.", "technology", 2, "tech_embedded"],
      ["tech_build", "Powers building the product", "Prompt-to-app and code-generation capability is the Build module's engine — every release that improves working-app generation moves our core wedge directly.", "technology", 3, null],
      ["t_codegen_watch", "Codegen step changes", "Long-horizon agents, computer use, and code-executing agents are the step changes to watch — each one redraws what 'the PM prototypes it themselves' means.", "technology", 2, "tech_build"],
      ["tech_gtm", "Powers our GTM", "AI products that run GTM work — content generation, signal enrichment, outreach, scoring — are both our tooling and our teachers; what wins there sets buyer expectations for our sell loop.", "technology", 3, null],
      ["platform_dependencies", "Infra we ride", "We ride managed Postgres/edge-function infrastructure and frontier-model APIs — pricing or capability shifts there move our margins and roadmap.", "technology", 2, null],
      ["ai_guide_posture", "The AI guide", "Across all three uses — embedding, building, and GTM — we are the customer's AI guide: the platform that knows which model or tool fits which job, frontier or open-source, and folds each shift into the loop.", "technology", 3, null],
      ["technology_search_focus", "Where tech signal lives", "Track frontier-provider changelogs and launch posts, open-weight model releases and benchmarks, agent-framework releases, MCP registry growth, prompt-to-app tool launches, and AI-for-GTM product launches.", "technology", 3, null],
      ["tech_threats_opportunities", "Platform risk", "The standing platform risk: a frontier provider ships a native idea-to-app-to-GTM loop — watch provider product moves, not just model releases.", "technology", 2, null],
    ];
    const { error } = await supabase.from("signal_profile_fields").insert(
      N.map(([field_key, label, value, vector, weight, parent_key], i) => ({
        org_id: orgId, profile_id: prof!.id, field_key, label, value, vector, weight, parent_key, position: i, origin: "human",
      })));
    if (error) throw error;
    return `+${N.length} nodes`;
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
