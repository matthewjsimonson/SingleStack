// ============================================================================
// playbooks — the PRESCRIPTIVE standard catalog. Each PLG area has a canonical
// playbook: a small set of standard WORKFLOWS, each needing standard SKILLS, and
// each carrying a STEP-CHAIN — the canonical operating procedure the product
// instantiates from (binding each step to a real roster agent + child skill).
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

export type StandardStep = {
  skill: string;     // MUST exactly match one of the playbook's own `skills`
  signals: "none" | "internal" | "external" | "both";
  instruction: string;
};

export type StandardPlaybook = {
  key: string;       // stable, unique within its area (becomes workflows.standard_key)
  name: string;      // the recognized playbook name
  purpose: string;   // why it exists — its one job for the area
  skills: string[];  // the standard skills it needs (the shared competency library)
  steps: StandardStep[]; // the canonical operating procedure — the seed the product instantiates from
};

export const STANDARD_PLAYBOOKS: Record<string, StandardPlaybook[]> = {
  // ---- Build / Product circle ---------------------------------------------
  product_truth: [
    { key: "ssot_reconciliation", name: "Source-of-truth reconciliation", purpose: "Keep one canonical product description humans and agents reason from.", skills: ["Canonical data modeling", "Documentation governance", "Cross-functional verification"],
      steps: [
        { skill: "Documentation governance", signals: "internal", instruction: "Pull every source that asserts what the product is — the Overview record fields, recent releases, and any agent-drafted claims — and list each assertion with where it lives, so contradictions become visible rather than assumed." },
        { skill: "Cross-functional verification", signals: "both", instruction: "For each contradicting assertion, check it against the latest shipped releases and any external collateral; mark each claim as confirmed, stale, or disputed, and route the disputed ones to the owning function rather than guessing." },
        { skill: "Canonical data modeling", signals: "none", instruction: "Reconcile the confirmed claims into ONE canonical statement per record field (overview, value_prop, category), eliminating redundant or near-duplicate fields so a single coherent truth remains." },
        { skill: "Documentation governance", signals: "none", instruction: "Stage the reconciled record fields as a ratification proposal with a change log of what merged or was retired, and hand off to a human owner to ratify before it becomes the canonical fact-base." },
      ] },
    { key: "factbase_freshness", name: "Fact-base freshness cadence", purpose: "Keep the Overview current and machine-readable as the product changes.", skills: ["Technical writing", "Drift detection", "Semantic structuring"],
      steps: [
        { skill: "Drift detection", signals: "internal", instruction: "Diff the current Overview against signals since the last refresh — shipped releases, new capabilities, retired features — and flag the specific fields whose facts have drifted out of date." },
        { skill: "Technical writing", signals: "none", instruction: "Rewrite each drifted field to reflect the current product, keeping claims concrete and verifiable and stripping aspirational language that the product doesn't yet deliver." },
        { skill: "Semantic structuring", signals: "none", instruction: "Re-encode the refreshed Overview into the machine-readable record schema (typed fields, clear keys) so downstream agents can reason from it without re-parsing prose." },
        { skill: "Drift detection", signals: "none", instruction: "Set the next freshness checkpoint and emit the diff as a proposal for human ratification, so the cadence holds and no silent drift accumulates between runs." },
      ] },
  ],
  capabilities: [
    { key: "capability_mapping", name: "Capability mapping", purpose: "Inventory what the product can do, feature-to-capability.", skills: ["Capability taxonomy design", "Feature-to-capability abstraction", "Systems thinking"],
      steps: [
        { skill: "Feature-to-capability abstraction", signals: "internal", instruction: "Enumerate the shipped features from the product record and releases, then roll each up to the underlying capability it delivers (many features can serve one capability), so the inventory reflects what the product DOES, not just its feature list." },
        { skill: "Capability taxonomy design", signals: "none", instruction: "Organize the capabilities into a stable taxonomy — group, name, and tier them (core vs supporting) — so the same capability is named consistently everywhere the product is described." },
        { skill: "Systems thinking", signals: "internal", instruction: "Trace dependencies between capabilities and flag gaps where a claimed capability has no feature backing it, marking those as either roadmap candidates or claims to retire." },
        { skill: "Capability taxonomy design", signals: "none", instruction: "Write the capability map into the Capabilities record as a proposal and hand to a human to ratify the taxonomy and tiering before downstream GTM reasons from it." },
      ] },
    { key: "differentiation_analysis", name: "Differentiation analysis", purpose: "Isolate where you genuinely win vs table stakes.", skills: ["Competitive feature analysis", "Capability-to-value translation", "Ownable-position framing"],
      steps: [
        { skill: "Competitive feature analysis", signals: "external", instruction: "For each core capability, gather how the top 2-3 rivals deliver the same thing from public sources and review data, scoring parity vs advantage so table-stakes capabilities are separated from real edges." },
        { skill: "Capability-to-value translation", signals: "both", instruction: "For the capabilities scoring as advantages, translate each into the buyer value it creates and corroborate against internal win themes and usage, keeping only differentiators a customer would actually pay for." },
        { skill: "Ownable-position framing", signals: "none", instruction: "Frame the surviving differentiators into 2-3 ownable claims — specific, defensible, hard for rivals to copy — and discard anything generic or easily matched." },
        { skill: "Ownable-position framing", signals: "none", instruction: "Record the differentiation findings as a proposal feeding Positioning, and hand to a human to ratify which edges are real before they anchor the market frame." },
      ] },
  ],
  technical: [
    { key: "adr", name: "Architecture Decision Records", purpose: "Make architecture decisions explicit, traceable, supersedable.", skills: ["System design", "Technical writing", "Trade-off articulation"],
      steps: [
        { skill: "System design", signals: "internal", instruction: "Identify the architecturally significant decision in play — the one that's hard to reverse and constrains future work — and capture its context from the Technical record and current stack so the ADR addresses a real fork, not a trivial choice." },
        { skill: "Trade-off articulation", signals: "none", instruction: "Lay out the viable options with their consequences side by side — cost, risk, reversibility, what each forecloses — so the decision is defensible and the rejected paths are documented, not lost." },
        { skill: "Technical writing", signals: "none", instruction: "Write the ADR in the standard form (context, decision, status, consequences) with a stable id, and link any prior ADR this one supersedes so the decision history stays traceable." },
        { skill: "System design", signals: "none", instruction: "Mark the ADR proposed and route to a human owner to accept; on acceptance, update the Technical record's constraints so agents downstream respect the new decision." },
      ] },
    { key: "tech_debt_triage", name: "Tech-debt triage", purpose: "Register, score, and deliberately manage debt.", skills: ["System assessment", "Risk & impact prioritization", "Refactoring roadmap"],
      steps: [
        { skill: "System assessment", signals: "internal", instruction: "Sweep the codebase and Technical record for debt items — known workarounds, fragile areas, evolution-watch flags — and register each as a discrete item with where it lives and why it's debt." },
        { skill: "Risk & impact prioritization", signals: "internal", instruction: "Score each debt item on blast radius and likelihood of biting (impact × probability × interest rate), ranking them so the deliberately-tolerated debt is separated from the must-address." },
        { skill: "Refactoring roadmap", signals: "none", instruction: "Sequence the top-ranked items into a remediation roadmap with rough effort, calling out which are paydown-now vs watch, so debt is managed on purpose rather than by surprise." },
        { skill: "Risk & impact prioritization", signals: "none", instruction: "Emit the ranked register and roadmap as a proposal for a human to ratify the tolerate/fix calls, since accepting debt is a deliberate decision, not a default." },
      ] },
    { key: "stack_constitution", name: "Stack & constraints map", purpose: "Map the buildable truth + the constraints agents must respect.", skills: ["System mapping", "Constraint authoring", "Architectural literacy"],
      steps: [
        { skill: "System mapping", signals: "internal", instruction: "Map the actual stack from the codebase and Technical record — languages, frameworks, services, data stores, third-party deps — as the ground truth of what's buildable, not what's aspirational." },
        { skill: "Architectural literacy", signals: "internal", instruction: "Identify the hard boundaries this stack imposes — security posture, data-residency, performance envelopes, integration limits — distinguishing immovable constraints from preferences." },
        { skill: "Constraint authoring", signals: "none", instruction: "Author the constraints as explicit, machine-readable rules an agent must respect when planning a build (e.g. 'no client-side secrets', 'RLS on every tenant table'), each phrased so a violation is detectable." },
        { skill: "Constraint authoring", signals: "none", instruction: "Write the stack + constraints map into the Technical record as a proposal and hand to a human to ratify, so every downstream How step inherits a verified set of guardrails." },
      ] },
  ],
  strategy: [
    { key: "strategy_stack", name: "Product Strategy Stack", purpose: "Cascade mission → strategy → roadmap; set explicit non-goals.", skills: ["Cascading alignment", "Scope-exclusion judgment", "Roadmap-theme framing"],
      steps: [
        { skill: "Cascading alignment", signals: "internal", instruction: "Pull the mission and strategic intent from the product record and check each level below it — strategy, roadmap themes — for line-of-sight, surfacing any roadmap item that serves no stated strategy." },
        { skill: "Scope-exclusion judgment", signals: "both", instruction: "Decide the explicit non-goals — what you are deliberately NOT doing this cycle — weighing market pull against focus, so the strategy is defined as much by exclusions as inclusions." },
        { skill: "Roadmap-theme framing", signals: "none", instruction: "Frame the included strategy into a small set of roadmap themes, each tied to its parent strategic bet, so build candidates inherit clear strategic justification." },
        { skill: "Cascading alignment", signals: "none", instruction: "Write the cascade (mission → strategy → themes → non-goals) into the Strategy record as a proposal for a human to ratify the bets and exclusions before they steer the build." },
      ] },
    { key: "opportunity_tree", name: "Opportunity Solution Tree", purpose: "Outcome → opportunities → solutions → assumption tests.", skills: ["Continuous discovery", "Opportunity decomposition", "Assumption testing"],
      steps: [
        { skill: "Continuous discovery", signals: "both", instruction: "Fix the target outcome (the metric the strategy says to move) and gather the discovery evidence — signals, interviews, usage — that reveals where the outcome is currently blocked." },
        { skill: "Opportunity decomposition", signals: "none", instruction: "Decompose the outcome into a tree of distinct opportunities (unmet needs / pain points), then branch candidate solutions under each, keeping opportunities and solutions cleanly separated." },
        { skill: "Assumption testing", signals: "internal", instruction: "For the most promising solution branches, name the riskiest assumption each rests on and design the smallest test that would falsify it, so betting follows evidence." },
        { skill: "Continuous discovery", signals: "none", instruction: "Record the tree and its assumption tests as a proposal feeding theme prioritization, and hand to a human to ratify which opportunities to pursue this cycle." },
      ] },
    { key: "theme_prioritization", name: "Theme prioritization (RICE/ICE)", purpose: "Rank themes into build candidates under uncertainty.", skills: ["Quantitative estimation", "Confidence calibration", "Portfolio trade-offs"],
      steps: [
        { skill: "Quantitative estimation", signals: "both", instruction: "For each candidate theme, estimate reach and impact from usage data and market size, and effort from the Technical record, producing the raw RICE/ICE inputs from real evidence rather than gut feel." },
        { skill: "Confidence calibration", signals: "internal", instruction: "Set a defensible confidence factor per theme based on the strength of the signals behind it (verified vs speculative), so well-evidenced themes aren't outranked by exciting but unproven ones." },
        { skill: "Portfolio trade-offs", signals: "none", instruction: "Compute and rank the scores, then sanity-check the ordering as a portfolio — balancing big bets against quick wins and avoiding overload on one capability area — to produce a build-candidate shortlist." },
        { skill: "Portfolio trade-offs", signals: "none", instruction: "Emit the ranked shortlist with its scoring rationale as a proposal for a human to ratify the cut line before themes become committed build candidates." },
      ] },
  ],
  build_ship: [
    { key: "spec_driven", name: "Spec-Driven Development", purpose: "Constitution → specify → plan → tasks → implement, spec as the durable artifact.", skills: ["Agent-grade spec authoring", "Plan/tasks decomposition", "HITL spec review"],
      steps: [
        { skill: "Agent-grade spec authoring", signals: "internal", instruction: "Take the ratified build candidate and write the spec — the Why and What, success metric, and the constraints inherited from the Technical record — precise enough that a frontier model could implement against it unambiguously." },
        { skill: "HITL spec review", signals: "none", instruction: "Route the spec to a human to ratify scope and acceptance criteria BEFORE any planning, since the spec is the durable artifact everything downstream binds to — catch ambiguity here, not in code review." },
        { skill: "Plan/tasks decomposition", signals: "internal", instruction: "Decompose the ratified spec into an ordered plan and discrete, frontier-aware tasks with explicit dependencies, so the make stage is a sequence of verifiable units rather than one big leap." },
        { skill: "Agent-grade spec authoring", signals: "none", instruction: "Keep the spec as the living source of truth: as implementation surfaces gaps, fold them back into the spec via proposal so it stays the canonical record, not a stale starting document." },
      ] },
    { key: "ai_prototyping", name: "AI prototyping", purpose: "Idea → working artifact fast, to validate before heavy build.", skills: ["Prompt-to-app iteration", "Prototype-driven feedback", "Enabling non-engineers"],
      steps: [
        { skill: "Prompt-to-app iteration", signals: "internal", instruction: "Turn the idea into the thinnest working artifact that exercises the core assumption, using the product record for context, optimizing for speed-to-something-clickable over completeness." },
        { skill: "Prototype-driven feedback", signals: "external", instruction: "Put the prototype in front of real users or stakeholders and capture reactions against the specific question it was built to answer, treating the artifact as the interview prompt." },
        { skill: "Prompt-to-app iteration", signals: "none", instruction: "Iterate the prototype on the feedback, tightening or pivoting the core flow, until the assumption is clearly validated or invalidated." },
        { skill: "Enabling non-engineers", signals: "none", instruction: "Package the validated learning (and the prototype) as a proposal a non-engineer can read and ratify, deciding go/no-go on heavy build before engineering cost is sunk." },
      ] },
    { key: "ship_release", name: "Ship / release management", purpose: "Staged rollout with flags + readiness.", skills: ["Release process", "Risk management", "QA"],
      steps: [
        { skill: "QA", signals: "internal", instruction: "Verify the build against the spec's acceptance criteria — functional checks, edge cases, and the constraints from the Technical record — and gate release on the criteria being met, not on the build merely compiling." },
        { skill: "Risk management", signals: "internal", instruction: "Assess rollout risk and choose the staging plan — feature flag, percentage rollout, or full ship — sized to blast radius, with an explicit rollback trigger defined before launch." },
        { skill: "Release process", signals: "none", instruction: "Execute the staged release behind the chosen flag, record the release in the Roadmap/Ship record, and confirm readiness signals (monitoring, docs, enablement) are in place." },
        { skill: "Risk management", signals: "internal", instruction: "Hold a human ratification at the go-to-full-rollout gate, presenting early-stage health, so the decision to widen exposure is deliberate." },
      ] },
    { key: "post_launch_validation", name: "Post-launch validation", purpose: "Experiment + eval against the success metric → new signals.", skills: ["Experiment design", "Eval design", "Decision-making on results"],
      steps: [
        { skill: "Experiment design", signals: "internal", instruction: "Restate the spec's success metric and design the validation — A/B, holdout, or pre/post — that cleanly attributes movement in that metric to the release, defining the decision threshold up front." },
        { skill: "Eval design", signals: "internal", instruction: "Where the release involves model or quality behavior, build the eval set and rubric that measures whether it actually performs, so 'it shipped' isn't mistaken for 'it works'." },
        { skill: "Decision-making on results", signals: "both", instruction: "Read the experiment and eval results against the threshold and decide keep / iterate / roll back, comparing the outcome to the market expectation that justified the build." },
        { skill: "Decision-making on results", signals: "none", instruction: "Emit the validated outcome as new signals into the Strategy area and a proposal for a human to ratify the decision, closing the build loop." },
      ] },
  ],
  // ---- GTM circle ----------------------------------------------------------
  positioning: [
    { key: "dunford_positioning", name: "Positioning process (Dunford)", purpose: "Define how you're uniquely best at something a market cares about.", skills: ["Best-fit / sales-call analysis", "Competitive & market research", "Features→value synthesis"],
      steps: [
        { skill: "Best-fit / sales-call analysis", signals: "internal", instruction: "Identify the best-fit customers — the accounts that buy fast, stay, and love the product — from win data and usage, since Dunford's method starts from who already sees the value, not from who you wish bought." },
        { skill: "Competitive & market research", signals: "external", instruction: "Map the true competitive alternatives those best-fit buyers would use if you didn't exist (often a spreadsheet or status quo, not just named rivals), to ground what 'unique' actually means in their eyes." },
        { skill: "Features→value synthesis", signals: "both", instruction: "Connect your differentiated capabilities to the value they deliver that the alternatives can't, then choose the market frame / category in which that value is most obviously best." },
        { skill: "Features→value synthesis", signals: "none", instruction: "Assemble the positioning (best-fit, alternatives, unique attributes, value, market frame) into the Positioning record as a proposal for a human to ratify before all of GTM hangs on it." },
      ] },
    { key: "positioning_validation", name: "Positioning validation", purpose: "Pressure-test the frame against real sales conversations / win-loss.", skills: ["Customer & sales interviewing", "Win-loss analysis", "Positioning iteration"],
      steps: [
        { skill: "Win-loss analysis", signals: "internal", instruction: "Pull recent wins and losses and test whether the stated positioning actually predicted them — do we win where the frame says we should, and lose where it says we shouldn't?" },
        { skill: "Customer & sales interviewing", signals: "external", instruction: "Run a few neutral conversations with recent buyers and the sales team to hear, in their words, why the product was chosen, checking whether their language matches the positioning's claims." },
        { skill: "Positioning iteration", signals: "both", instruction: "Reconcile the win/loss pattern and the interview language against the current frame, isolating the specific claims that hold up and the ones the evidence contradicts." },
        { skill: "Positioning iteration", signals: "none", instruction: "Propose the sharpened positioning edits with the supporting evidence attached, and hand to a human to ratify the change before it propagates to messaging and enablement." },
      ] },
  ],
  messaging: [
    { key: "messaging_house", name: "Messaging House", purpose: "Value prop → pillars → proof points, one consistent hierarchy.", skills: ["Voice-of-customer research", "Message architecture", "Persuasive copywriting"],
      steps: [
        { skill: "Voice-of-customer research", signals: "external", instruction: "Mine voice-of-customer sources — reviews, interviews, support themes, win notes — for the exact language buyers use about their problem and the value, so the house is built on their words, not internal jargon." },
        { skill: "Message architecture", signals: "both", instruction: "Anchor the roof on the ratified positioning's value prop, then derive 3 supporting pillars from the differentiated capabilities, ensuring each pillar maps to a real buyer priority from the VoC." },
        { skill: "Persuasive copywriting", signals: "internal", instruction: "Under each pillar, write the proof points — specific features, metrics, customer evidence from the record — that substantiate the claim, so no pillar stands on assertion alone." },
        { skill: "Message architecture", signals: "none", instruction: "Assemble the full house (value prop → pillars → proof) into the Messaging record as a proposal for a human to ratify the hierarchy before it cascades into all downstream copy." },
      ] },
    { key: "value_prop_canvas", name: "Value Proposition Canvas", purpose: "Map jobs/pains/gains to relievers/creators for fit.", skills: ["JTBD synthesis", "Pain-gain mapping", "Value articulation"],
      steps: [
        { skill: "JTBD synthesis", signals: "external", instruction: "For the target persona, synthesize the jobs they're trying to get done from discovery evidence, ranking by frequency and importance so the canvas centers on the jobs that actually drive a switch." },
        { skill: "Pain-gain mapping", signals: "external", instruction: "Map the pains and gains around those jobs — the obstacles, risks, and desired outcomes — sized by severity, so the canvas reflects what the buyer feels, not what the product happens to do." },
        { skill: "Value articulation", signals: "internal", instruction: "Match the product's features to pain relievers and gain creators, and flag any high-severity pain with no reliever as a fit gap rather than papering over it." },
        { skill: "Value articulation", signals: "none", instruction: "Record the fit assessment as a proposal feeding messaging, and hand to a human to ratify where genuine product-market fit exists vs where the canvas exposes a gap." },
      ] },
    { key: "messaging_testing", name: "Messaging testing", purpose: "Validate resonance before rollout.", skills: ["Message-test design", "Qual/quant analysis", "Copy iteration"],
      steps: [
        { skill: "Message-test design", signals: "none", instruction: "Design the test for the draft messaging — which pillars/headlines to test, with which audience, and the resonance metric that decides pass/fail — before any copy goes wide." },
        { skill: "Qual/quant analysis", signals: "external", instruction: "Run the test and analyze results, separating which claims actually move comprehension and preference from which merely sound good internally, with sample-size caveats stated." },
        { skill: "Copy iteration", signals: "none", instruction: "Rewrite the underperforming messages on what the test showed, keeping the winners, so rollout ships the validated variants rather than the original guesses." },
        { skill: "Copy iteration", signals: "none", instruction: "Emit the tested, final messaging as a proposal for a human to ratify before it replaces the live copy across channels." },
      ] },
  ],
  audience: [
    { key: "icp_workshop", name: "ICP definition", purpose: "Score account fit; name the segments you grow.", skills: ["Segmentation analysis", "Facilitation", "Qualitative synthesis"],
      steps: [
        { skill: "Segmentation analysis", signals: "both", instruction: "Cluster the best-fit accounts by firmographic and behavioral attributes (size, industry, usage depth, retention), correlating fit with PQL and win data to find the segments where you genuinely grow." },
        { skill: "Qualitative synthesis", signals: "internal", instruction: "Synthesize the qualitative signal — why those segments fit, what disqualifies a poor-fit account — into explicit inclusion and exclusion criteria, so the ICP can be scored, not just described." },
        { skill: "Facilitation", signals: "none", instruction: "Resolve disagreements on the boundary cases into a single scored fit model (the attributes and their weights), naming the 1-2 segments to prioritize this cycle." },
        { skill: "Segmentation analysis", signals: "none", instruction: "Write the ICP and segment definitions into the Buyer record as a proposal for a human to ratify before targeting, content, and PQL scoring inherit it." },
      ] },
    { key: "jtbd_personas", name: "JTBD persona research", purpose: "Switching-forces interviews → personas + champion.", skills: ["Discovery interviewing", "Switching-forces analysis", "Persona synthesis"],
      steps: [
        { skill: "Discovery interviewing", signals: "external", instruction: "Run switching interviews with recent buyers, reconstructing the timeline from first thought to purchase, to surface the real trigger and the job that prompted the switch." },
        { skill: "Switching-forces analysis", signals: "external", instruction: "Code each story for the four forces — push of the problem, pull of the new, anxiety of switching, habit of the old — to see what actually drives and blocks adoption for this audience." },
        { skill: "Persona synthesis", signals: "both", instruction: "Synthesize the patterns into 1-2 grounded personas and name the champion vs the economic buyer, cross-checking against the ICP segments so personas and accounts line up." },
        { skill: "Persona synthesis", signals: "none", instruction: "Record the personas, jobs, and forces as a proposal feeding messaging and demand, and hand to a human to ratify before they shape narratives and targeting." },
      ] },
  ],
  motion: [
    { key: "motion_selection", name: "GTM motion selection", purpose: "PLG vs sales-led vs hybrid, keyed to the economics.", skills: ["Unit-economics modeling", "Funnel benchmarking", "Self-serve↔sales handoff"],
      steps: [
        { skill: "Unit-economics modeling", signals: "internal", instruction: "Model the unit economics — ACV, CAC, payback, gross margin — from real funnel and revenue data to see which motion the economics can actually sustain (low ACV rarely funds a sales-led motion)." },
        { skill: "Funnel benchmarking", signals: "both", instruction: "Benchmark the current funnel's conversion and velocity against the chosen ICP and category norms to judge where self-serve carries the deal vs where a human must intervene." },
        { skill: "Self-serve↔sales handoff", signals: "none", instruction: "Define the motion and, if hybrid, the explicit handoff trigger (the PQL threshold at which self-serve passes to sales), so the boundary is a rule, not an opinion." },
        { skill: "Unit-economics modeling", signals: "none", instruction: "Record the recommended motion with its economic justification into the Motion record as a proposal for a human to ratify before pricing and lifecycle build on it." },
      ] },
    { key: "pricing_packaging", name: "Pricing & packaging review", purpose: "Pick the value metric so price mirrors value.", skills: ["Value-metric identification", "Willingness-to-pay research", "Pricing interpretation"],
      steps: [
        { skill: "Value-metric identification", signals: "both", instruction: "Identify the value metric — the unit that scales with the value a customer gets (seats, usage, outcomes) — by correlating what heavy, retained accounts consume, so price can track value rather than cost." },
        { skill: "Willingness-to-pay research", signals: "external", instruction: "Research WTP for that metric across the ICP segments (Van Westendorp-style or interview-based), establishing the price band the market will bear before any number is set." },
        { skill: "Pricing interpretation", signals: "none", instruction: "Interpret the WTP and metric into a coherent price/packaging recommendation, checking it against the motion's economics so the model is both wanted and viable." },
        { skill: "Pricing interpretation", signals: "none", instruction: "Propose the pricing change with its evidence and hand to a human to ratify, since pricing moves revenue and contracts and must not auto-apply." },
      ] },
    { key: "gbb_tiering", name: "Good-Better-Best tiering", purpose: "Tier packaging by segment WTP.", skills: ["Feature-to-tier allocation", "Segment WTP analysis", "Packaging differentiation"],
      steps: [
        { skill: "Segment WTP analysis", signals: "external", instruction: "For each ICP segment, establish willingness-to-pay and the must-have vs nice-to-have features, so tier boundaries follow segment value rather than arbitrary feature counts." },
        { skill: "Feature-to-tier allocation", signals: "internal", instruction: "Allocate capabilities across Good/Better/Best so each tier is complete for its segment and the upgrade path is obvious, using a value fence (not a crippled-product fence) between tiers." },
        { skill: "Packaging differentiation", signals: "none", instruction: "Differentiate the tiers so each has a clear 'who it's for' and the jump to the next is justified by value the buyer recognizes, avoiding overlapping or redundant tiers." },
        { skill: "Packaging differentiation", signals: "none", instruction: "Record the three-tier packaging as a proposal for a human to ratify before it ships to pricing pages and sales." },
      ] },
    { key: "free_model", name: "Free-model design", purpose: "Freemium / trial routed to a PQL.", skills: ["Activation design", "Free-to-paid economics", "PQL definition"],
      steps: [
        { skill: "Free-to-paid economics", signals: "internal", instruction: "Decide freemium vs free-trial vs reverse-trial by modeling the conversion and cost-to-serve of free users from funnel data, so the free model is funded by the paid economics, not bleeding them." },
        { skill: "Activation design", signals: "internal", instruction: "Design the free experience to reach the activation 'aha' fast and expose the value that motivates upgrade, setting the natural limit where a converted user hits the paid boundary." },
        { skill: "PQL definition", signals: "both", instruction: "Define the PQL — the fit + usage behavior that signals a free user is ready to buy — as the bridge that routes the free model into the sell desk, aligning with the lifecycle scoring model." },
        { skill: "PQL definition", signals: "none", instruction: "Record the free-model design and its PQL definition as a proposal for a human to ratify before it goes live and starts emitting qualified signals." },
      ] },
  ],
  competitive: [
    { key: "win_loss", name: "Win/Loss program", purpose: "Learn why you win or lose; activate the insight.", skills: ["Neutral buyer interviewing", "Thematic synthesis", "Insight activation"],
      steps: [
        { skill: "Neutral buyer interviewing", signals: "external", instruction: "Pull the last N closed-won and closed-lost opportunities and run neutral, non-leading interviews with the buyers, capturing the decision story in their own words rather than the rep's hypothesis." },
        { skill: "Thematic synthesis", signals: "both", instruction: "Cluster the stated win and loss reasons across interviews and isolate the 3 themes a buyer would recognize, weighting them by deal value and frequency and cross-checking against CRM loss codes." },
        { skill: "Insight activation", signals: "none", instruction: "Translate each theme into a specific action and route it to its owner — positioning gaps to Positioning, objection patterns to battlecards, product gaps to Strategy — so insight becomes change, not a report." },
        { skill: "Insight activation", signals: "none", instruction: "Record the themes and routed actions as a proposal for a human to ratify the priorities, and set the next program cycle so win/loss runs continuously." },
      ] },
    { key: "battlecards", name: "Battlecard build & upkeep", purpose: "Equip sales to win against specific rivals (living doc).", skills: ["Competitive research", "Objection / talk-track writing", "Enablement-asset design"],
      steps: [
        { skill: "Competitive research", signals: "external", instruction: "Gather current evidence on the named rival — pricing, positioning, review strengths/weaknesses, recent releases — and cite each claim, so the battlecard rests on verifiable facts a rep can defend, not rumor." },
        { skill: "Objection / talk-track writing", signals: "both", instruction: "Turn the rival's strengths into objection-handling talk tracks and their weaknesses into trap-setting questions, grounding each in our differentiation and the win/loss themes against that rival." },
        { skill: "Enablement-asset design", signals: "none", instruction: "Format the card for in-deal use — at-a-glance why-we-win, landmines, competitor counters — so a rep can scan it live on a call, not read an essay." },
        { skill: "Enablement-asset design", signals: "none", instruction: "Publish to the Battlecard record as a proposal for a human to ratify accuracy, and set a refresh trigger so the card stays a living doc when the rival moves." },
      ] },
    { key: "ci_program", name: "Competitive intelligence program", purpose: "Monitor the landscape; brief stakeholders.", skills: ["Source monitoring", "Signal-vs-noise synthesis", "Stakeholder comms"],
      steps: [
        { skill: "Source monitoring", signals: "external", instruction: "Watch the defined source set — rival changelogs, pricing pages, reviews, funding and hiring signals — and capture each notable change with a timestamp and link, so the landscape is tracked continuously, not anecdotally." },
        { skill: "Signal-vs-noise synthesis", signals: "both", instruction: "Filter the raw monitoring stream against what matters to our positioning and roadmap, promoting only the moves that change a buyer's choice and discarding noise." },
        { skill: "Stakeholder comms", signals: "none", instruction: "Write a concise brief per audience — sellers get talk-track impact, product gets capability moves, leadership gets strategic shifts — so each stakeholder gets the 'so what', not a raw feed." },
        { skill: "Stakeholder comms", signals: "none", instruction: "Route material moves as proposals into battlecards and positioning for human ratification, and log the brief so the CI trail is auditable over time." },
      ] },
  ],
  demand: [
    { key: "demand_engine", name: "Demand-gen engine", purpose: "Create + capture demand at sustainable CAC.", skills: ["Channel / CAC economics", "Paid-media management", "Attribution & measurement"],
      steps: [
        { skill: "Channel / CAC economics", signals: "both", instruction: "Model CAC and payback per channel against the ICP and motion economics, ranking channels by efficiency so spend concentrates where the unit economics actually work, not where it's easy." },
        { skill: "Paid-media management", signals: "internal", instruction: "Build the campaign structure for the chosen channels grounded in the ratified messaging and personas, so creative and targeting reflect the canonical positioning rather than ad-hoc copy." },
        { skill: "Attribution & measurement", signals: "internal", instruction: "Define the attribution model and the leading indicators per channel up front, so spend is judged on captured demand and pipeline, not vanity impressions." },
        { skill: "Channel / CAC economics", signals: "none", instruction: "Emit the channel plan and budget allocation as a proposal for a human to ratify the spend before it goes live, and set the review cadence that reallocates against measured CAC." },
      ] },
    { key: "content_engine", name: "Content engine", purpose: "Hub-and-cluster editorial at ROI.", skills: ["Keyword research", "Editorial production", "Topical SEO"],
      steps: [
        { skill: "Keyword research", signals: "external", instruction: "Identify the hub topics and supporting cluster keywords by buyer intent and difficulty, prioritizing terms the ICP actually searches so the editorial map targets demand, not just volume." },
        { skill: "Topical SEO", signals: "none", instruction: "Architect the hub-and-cluster structure — pillar page plus interlinked cluster pieces — so the engine builds topical authority rather than scattered one-off posts." },
        { skill: "Editorial production", signals: "internal", instruction: "Draft each piece grounded in the ratified messaging and product record, so content is accurate and on-narrative, with a clear conversion path matched to its funnel stage." },
        { skill: "Editorial production", signals: "none", instruction: "Route drafts for human editorial ratification before publish, and track each piece's ROI (traffic → conversion) so the engine doubles down on what earns its keep." },
      ] },
    { key: "campaign_abm", name: "Campaign & ABM orchestration", purpose: "Intent → score accounts → orchestrate across teams.", skills: ["Intent-data interpretation", "Cross-channel orchestration", "Sales-marketing alignment"],
      steps: [
        { skill: "Intent-data interpretation", signals: "external", instruction: "Read intent signals (third-party intent, site behavior, PQL surges) against the ICP to surface the accounts showing real buying interest right now, not a static target list." },
        { skill: "Cross-channel orchestration", signals: "both", instruction: "Sequence the touch plan across channels for the prioritized accounts — ads, email, content, SDR outreach — so each account gets a coordinated play tied to its intent stage, not duplicate uncoordinated touches." },
        { skill: "Sales-marketing alignment", signals: "internal", instruction: "Define the SLA and handoff between marketing and sales — what score triggers SDR action, what feedback returns — so accounts don't stall in the gap between teams." },
        { skill: "Sales-marketing alignment", signals: "none", instruction: "Emit the account plan and handoff rules as a proposal for human ratification, and set the measurement loop that judges the play on account engagement and pipeline." },
      ] },
  ],
  enablement: [
    { key: "launch_tiered", name: "Tiered product launch", purpose: "Ready/Set/Go, sized by reach × impact.", skills: ["Launch scoping & PM", "Launch narrative", "GTM coordination"],
      steps: [
        { skill: "Launch scoping & PM", signals: "both", instruction: "Size the launch by reach × impact to assign its tier (Ready/Set/Go), then scope the deliverables, owners, and timeline appropriate to that tier so effort matches stakes." },
        { skill: "Launch narrative", signals: "internal", instruction: "Write the launch narrative from the ratified messaging and the release's actual capabilities, so the external story is on-positioning and grounded in what shipped, not hype." },
        { skill: "GTM coordination", signals: "none", instruction: "Orchestrate the cross-functional plan — enablement, demand, content, support readiness — against the launch date, sequencing dependencies so no surface is unready at go-live." },
        { skill: "GTM coordination", signals: "none", instruction: "Hold a go/no-go readiness gate for a human to ratify, confirming every tiered deliverable is in place before the launch fires." },
      ] },
    { key: "sales_enablement", name: "Sales enablement build", purpose: "Battlecards, first-call deck, demo scripts, content matrix.", skills: ["Enablement content", "Objection-handling writing", "Role-based asset design"],
      steps: [
        { skill: "Role-based asset design", signals: "internal", instruction: "Map the assets each selling role needs across the deal stages — first-call deck, demo script, battlecards, content matrix — so the build covers the real sales motion, not a generic kit." },
        { skill: "Enablement content", signals: "internal", instruction: "Draft each asset from ratified facts only — positioning, capabilities, proof points, win themes — so reps carry accurate, on-narrative material that won't contradict the record in front of a buyer." },
        { skill: "Objection-handling writing", signals: "both", instruction: "Write the objection-handling and competitive talk tracks grounded in win/loss themes and battlecards, so reps have tested responses to the objections that actually lose deals." },
        { skill: "Enablement content", signals: "none", instruction: "Publish the kit to the Enablement record as a proposal for a human to ratify accuracy, and link each asset to its source record so updates can flow when facts change." },
      ] },
    { key: "readiness_ramp", name: "Internal readiness & ramp", purpose: "Briefing, rep certification, soft launch.", skills: ["Rep ramp / training", "Readiness governance", "Stakeholder alignment"],
      steps: [
        { skill: "Stakeholder alignment", signals: "internal", instruction: "Brief every internal stakeholder on the launch — sales, CS, support, leadership — so each knows what's changing, who owns what, and when, before anything is buyer-facing." },
        { skill: "Rep ramp / training", signals: "none", instruction: "Run the rep ramp against the enablement kit and certify competence — a pitch or demo check — so reps are demonstrably ready, not merely informed." },
        { skill: "Readiness governance", signals: "both", instruction: "Run a soft launch with a limited cohort, collecting field feedback and surfacing gaps in messaging or assets before the full rollout exposes them." },
        { skill: "Readiness governance", signals: "none", instruction: "Present the readiness scorecard (certification rate, soft-launch findings) for a human to ratify go-for-full-launch, so the gate is evidence-based." },
      ] },
  ],
  lifecycle_pql: [
    { key: "pql_scoring", name: "PQL scoring model", purpose: "Fit + usage + intent → qualified, sellable signal.", skills: ["Behavioral instrumentation", "Weighted-model + cohort analysis", "ICP enrichment"],
      steps: [
        { skill: "Behavioral instrumentation", signals: "internal", instruction: "Identify and instrument the usage events that predict buying readiness — activation milestones, depth, frequency, multi-user spread — so the model is fed by real product behavior, not just form fills." },
        { skill: "ICP enrichment", signals: "both", instruction: "Enrich each account with fit attributes from the ICP definition and external firmographics, so a PQL combines fit (right account) with intent (right behavior), not behavior alone." },
        { skill: "Weighted-model + cohort analysis", signals: "internal", instruction: "Weight the fit + usage + intent inputs by back-testing which combinations actually converted in past cohorts, setting the qualification threshold where conversion lift is real." },
        { skill: "Weighted-model + cohort analysis", signals: "none", instruction: "Emit the scoring model and threshold as a proposal for a human to ratify before it starts routing accounts, so the sell desk trusts the qualified signal." },
      ] },
    { key: "activation_onboarding", name: "Activation & onboarding", purpose: "Setup → Aha → Habit; cut time-to-value.", skills: ["Funnel / cohort analysis", "Onboarding experimentation", "Aha-moment identification"],
      steps: [
        { skill: "Aha-moment identification", signals: "internal", instruction: "Identify the aha moment — the early action most correlated with retention — from cohort behavior, so onboarding optimizes toward a proven value milestone, not an arbitrary checklist." },
        { skill: "Funnel / cohort analysis", signals: "internal", instruction: "Chart the setup → aha → habit funnel and find the steps where new users drop, quantifying time-to-value and the biggest leak so effort targets the real friction." },
        { skill: "Onboarding experimentation", signals: "internal", instruction: "Design experiments on the leakiest step — guided setup, defaults, nudges — measured by lift in reaching the aha milestone, so improvements are validated, not assumed." },
        { skill: "Onboarding experimentation", signals: "none", instruction: "Report the validated onboarding change as a proposal for a human to ratify before rollout, and feed the result back as a signal to the funnel chart." },
      ] },
    { key: "lifecycle_stages", name: "Lifecycle stage definition", purpose: "New/current/dormant/resurrected → matched lever.", skills: ["Retention charting", "Stage cohorting", "Trigger-campaign design"],
      steps: [
        { skill: "Retention charting", signals: "internal", instruction: "Chart usage retention to find the natural breakpoints between new, current, dormant, and resurrected, so stage boundaries reflect real behavior rather than arbitrary day counts." },
        { skill: "Stage cohorting", signals: "internal", instruction: "Define each lifecycle stage as a measurable cohort with entry and exit criteria, so an account's stage is computed from data and transitions are detectable." },
        { skill: "Trigger-campaign design", signals: "both", instruction: "Match each stage to the right lever — onboarding for new, expansion for current, win-back for dormant — designing the trigger that fires on stage change." },
        { skill: "Trigger-campaign design", signals: "none", instruction: "Emit the stage model and triggered levers as a proposal for a human to ratify before campaigns auto-fire, and define the metric that judges each lever's effect." },
      ] },
    { key: "expansion_loops", name: "Expansion & retention loops", purpose: "Usage-based upsell to NRR 120%+; PQL/CSQL handoff.", skills: ["Growth-loop modeling", "Upgrade-prompt design", "Handoff governance"],
      steps: [
        { skill: "Growth-loop modeling", signals: "internal", instruction: "Identify the usage thresholds that signal expansion readiness — seat saturation, limit-hits, feature adoption — and model the loop where success drives more usage drives upsell toward NRR 120%+." },
        { skill: "Upgrade-prompt design", signals: "internal", instruction: "Design in-product upgrade prompts that fire at the moment of value (hitting a limit, needing a gated feature), so the expansion ask lands when the buyer feels the need, not at random." },
        { skill: "Handoff governance", signals: "both", instruction: "Define the PQL/CSQL handoff rules — which expansion signals self-serve and which route to CS or sales — so high-value expansion gets human touch and the rest stays product-led." },
        { skill: "Handoff governance", signals: "none", instruction: "Emit the expansion loop and handoff governance as a proposal for a human to ratify, and set the NRR target and review cadence that tracks the loop's effect." },
      ] },
  ],
};

export const playbooksFor = (areaKey: string): StandardPlaybook[] => STANDARD_PLAYBOOKS[areaKey] ?? [];

// The shared skill library implied by the catalog — the standard competencies,
// deduped, that the per-area playbooks reuse across areas (many-to-many).
export const STANDARD_SKILLS: string[] = [...new Set(
  Object.values(STANDARD_PLAYBOOKS).flatMap((ps) => ps.flatMap((p) => p.skills)),
)].sort();
