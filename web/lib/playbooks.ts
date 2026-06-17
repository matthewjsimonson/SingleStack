// ============================================================================
// playbooks — the PRESCRIPTIVE standard catalog. Each PLG area has a canonical
// playbook: a small set of standard WORKFLOWS, each needing standard SKILLS.
// Grounded in recognized frameworks (docs/research/product-capability.md +
// the playbook research): Dunford positioning, Messaging House, Win/Loss,
// PQL scoring, Strategy Stack, Opportunity Solution Tree, Spec-Driven Dev, ADRs…
//
// The governing model (from the research):
//   • STANDARD  — this catalog. Canonical, platform-owned, works out of the box.
//   • TAILORED  — a STANDARD instance with overrides that STAYS LINKED to its
//                 parent (store the diff, show drift, promote to custom when it
//                 drifts too far). "Adopt and adapt" / golden path.
//   • CUSTOM    — built from scratch, no parent link, org-owned.
//
// Mapping principle: a playbook (workflow) has EXACTLY ONE owning area, by
// purpose (single accountable owner). Cross-area is linked visibility
// ("feeds"/"consumes"), never co-ownership. SKILLS are the one healthy
// many-to-many — a shared library many playbooks reuse. So:
//   workflow -> one owning area ;  workflow -> many skills (shared).
//
// Area keys mirror web/lib/ecosystem.ts AREAS. Skill labels are the standard
// competencies a workflow needs (matched to child skills, tailorable per agent).
// ============================================================================

export type StandardPlaybook = {
  key: string;       // stable, unique within its area (becomes workflows.standard_key)
  name: string;      // the recognized playbook name
  purpose: string;   // why it exists — its one job for the area
  skills: string[];  // the standard skills it needs (the shared competency library)
};

export const STANDARD_PLAYBOOKS: Record<string, StandardPlaybook[]> = {
  // ---- Build / Product circle ---------------------------------------------
  product_truth: [
    { key: "ssot_reconciliation", name: "Source-of-truth reconciliation", purpose: "Keep one canonical product description humans and agents reason from.", skills: ["Canonical data modeling", "Documentation governance", "Cross-functional verification"] },
    { key: "factbase_freshness", name: "Fact-base freshness cadence", purpose: "Keep the Overview current and machine-readable as the product changes.", skills: ["Technical writing", "Drift detection", "Semantic structuring"] },
  ],
  capabilities: [
    { key: "capability_mapping", name: "Capability mapping", purpose: "Inventory what the product can do, feature-to-capability.", skills: ["Capability taxonomy design", "Feature-to-capability abstraction", "Systems thinking"] },
    { key: "differentiation_analysis", name: "Differentiation analysis", purpose: "Isolate where you genuinely win vs table stakes.", skills: ["Competitive feature analysis", "Capability-to-value translation", "Ownable-position framing"] },
  ],
  technical: [
    { key: "adr", name: "Architecture Decision Records", purpose: "Make architecture decisions explicit, traceable, supersedable.", skills: ["System design", "Technical writing", "Trade-off articulation"] },
    { key: "tech_debt_triage", name: "Tech-debt triage", purpose: "Register, score, and deliberately manage debt.", skills: ["System assessment", "Risk & impact prioritization", "Refactoring roadmap"] },
    { key: "stack_constitution", name: "Stack & constraints map", purpose: "Map the buildable truth + the constraints agents must respect.", skills: ["System mapping", "Constraint authoring", "Architectural literacy"] },
  ],
  strategy: [
    { key: "strategy_stack", name: "Product Strategy Stack", purpose: "Cascade mission → strategy → roadmap; set explicit non-goals.", skills: ["Cascading alignment", "Scope-exclusion judgment", "Roadmap-theme framing"] },
    { key: "opportunity_tree", name: "Opportunity Solution Tree", purpose: "Outcome → opportunities → solutions → assumption tests.", skills: ["Continuous discovery", "Opportunity decomposition", "Assumption testing"] },
    { key: "theme_prioritization", name: "Theme prioritization (RICE/ICE)", purpose: "Rank themes into build candidates under uncertainty.", skills: ["Quantitative estimation", "Confidence calibration", "Portfolio trade-offs"] },
  ],
  build_ship: [
    { key: "spec_driven", name: "Spec-Driven Development", purpose: "Constitution → specify → plan → tasks → implement, spec as the durable artifact.", skills: ["Agent-grade spec authoring", "Plan/tasks decomposition", "HITL spec review"] },
    { key: "ai_prototyping", name: "AI prototyping", purpose: "Idea → working artifact fast, to validate before heavy build.", skills: ["Prompt-to-app iteration", "Prototype-driven feedback", "Enabling non-engineers"] },
    { key: "ship_release", name: "Ship / release management", purpose: "Staged rollout with flags + readiness.", skills: ["Release process", "Risk management", "QA"] },
    { key: "post_launch_validation", name: "Post-launch validation", purpose: "Experiment + eval against the success metric → new signals.", skills: ["Experiment design", "Eval design", "Decision-making on results"] },
  ],
  // ---- GTM circle ----------------------------------------------------------
  positioning: [
    { key: "dunford_positioning", name: "Positioning process (Dunford)", purpose: "Define how you're uniquely best at something a market cares about.", skills: ["Best-fit / sales-call analysis", "Competitive & market research", "Features→value synthesis"] },
    { key: "positioning_validation", name: "Positioning validation", purpose: "Pressure-test the frame against real sales conversations / win-loss.", skills: ["Customer & sales interviewing", "Win-loss analysis", "Positioning iteration"] },
  ],
  messaging: [
    { key: "messaging_house", name: "Messaging House", purpose: "Value prop → pillars → proof points, one consistent hierarchy.", skills: ["Voice-of-customer research", "Message architecture", "Persuasive copywriting"] },
    { key: "value_prop_canvas", name: "Value Proposition Canvas", purpose: "Map jobs/pains/gains to relievers/creators for fit.", skills: ["JTBD synthesis", "Pain-gain mapping", "Value articulation"] },
    { key: "messaging_testing", name: "Messaging testing", purpose: "Validate resonance before rollout.", skills: ["Message-test design", "Qual/quant analysis", "Copy iteration"] },
  ],
  audience: [
    { key: "icp_workshop", name: "ICP definition", purpose: "Score account fit; name the segments you grow.", skills: ["Segmentation analysis", "Facilitation", "Qualitative synthesis"] },
    { key: "jtbd_personas", name: "JTBD persona research", purpose: "Switching-forces interviews → personas + champion.", skills: ["Discovery interviewing", "Switching-forces analysis", "Persona synthesis"] },
  ],
  motion: [
    { key: "motion_selection", name: "GTM motion selection", purpose: "PLG vs sales-led vs hybrid, keyed to the economics.", skills: ["Unit-economics modeling", "Funnel benchmarking", "Self-serve↔sales handoff"] },
    { key: "pricing_packaging", name: "Pricing & packaging review", purpose: "Pick the value metric so price mirrors value.", skills: ["Value-metric identification", "Willingness-to-pay research", "Pricing interpretation"] },
    { key: "gbb_tiering", name: "Good-Better-Best tiering", purpose: "Tier packaging by segment WTP.", skills: ["Feature-to-tier allocation", "Segment WTP analysis", "Packaging differentiation"] },
    { key: "free_model", name: "Free-model design", purpose: "Freemium / trial routed to a PQL.", skills: ["Activation design", "Free-to-paid economics", "PQL definition"] },
  ],
  competitive: [
    { key: "win_loss", name: "Win/Loss program", purpose: "Learn why you win or lose; activate the insight.", skills: ["Neutral buyer interviewing", "Thematic synthesis", "Insight activation"] },
    { key: "battlecards", name: "Battlecard build & upkeep", purpose: "Equip sales to win against specific rivals (living doc).", skills: ["Competitive research", "Objection / talk-track writing", "Enablement-asset design"] },
    { key: "ci_program", name: "Competitive intelligence program", purpose: "Monitor the landscape; brief stakeholders.", skills: ["Source monitoring", "Signal-vs-noise synthesis", "Stakeholder comms"] },
  ],
  demand: [
    { key: "demand_engine", name: "Demand-gen engine", purpose: "Create + capture demand at sustainable CAC.", skills: ["Channel / CAC economics", "Paid-media management", "Attribution & measurement"] },
    { key: "content_engine", name: "Content engine", purpose: "Hub-and-cluster editorial at ROI.", skills: ["Keyword research", "Editorial production", "Topical SEO"] },
    { key: "campaign_abm", name: "Campaign & ABM orchestration", purpose: "Intent → score accounts → orchestrate across teams.", skills: ["Intent-data interpretation", "Cross-channel orchestration", "Sales-marketing alignment"] },
  ],
  enablement: [
    { key: "launch_tiered", name: "Tiered product launch", purpose: "Ready/Set/Go, sized by reach × impact.", skills: ["Launch scoping & PM", "Launch narrative", "GTM coordination"] },
    { key: "sales_enablement", name: "Sales enablement build", purpose: "Battlecards, first-call deck, demo scripts, content matrix.", skills: ["Enablement content", "Objection-handling writing", "Role-based asset design"] },
    { key: "readiness_ramp", name: "Internal readiness & ramp", purpose: "Briefing, rep certification, soft launch.", skills: ["Rep ramp / training", "Readiness governance", "Stakeholder alignment"] },
  ],
  lifecycle_pql: [
    { key: "pql_scoring", name: "PQL scoring model", purpose: "Fit + usage + intent → qualified, sellable signal.", skills: ["Behavioral instrumentation", "Weighted-model + cohort analysis", "ICP enrichment"] },
    { key: "activation_onboarding", name: "Activation & onboarding", purpose: "Setup → Aha → Habit; cut time-to-value.", skills: ["Funnel / cohort analysis", "Onboarding experimentation", "Aha-moment identification"] },
    { key: "lifecycle_stages", name: "Lifecycle stage definition", purpose: "New/current/dormant/resurrected → matched lever.", skills: ["Retention charting", "Stage cohorting", "Trigger-campaign design"] },
    { key: "expansion_loops", name: "Expansion & retention loops", purpose: "Usage-based upsell to NRR 120%+; PQL/CSQL handoff.", skills: ["Growth-loop modeling", "Upgrade-prompt design", "Handoff governance"] },
  ],
};

export const playbooksFor = (areaKey: string): StandardPlaybook[] => STANDARD_PLAYBOOKS[areaKey] ?? [];

// The shared skill library implied by the catalog — the standard competencies,
// deduped, that the per-area playbooks reuse across areas (many-to-many).
export const STANDARD_SKILLS: string[] = [...new Set(
  Object.values(STANDARD_PLAYBOOKS).flatMap((ps) => ps.flatMap((p) => p.skills)),
)].sort();
