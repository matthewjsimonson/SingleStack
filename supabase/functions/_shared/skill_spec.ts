// ============================================================================
// skill_spec — the single source of the SingleStack skill QUALITY BAR + two
// gold-standard exemplars, shared by every skill generator (evolve-skills draft/
// improve/evolve, tailor-skill). Mirrors web/skills/README.md.
//
// Output quality must MIRROR Anthropic Agent Skills. The most reliable lever is
// anchoring the model on a real exemplar to match — so these strings are injected
// into the prompts as "produce at this depth/structure". Keep them in lockstep
// with the hand-written library in web/skills/.
// ============================================================================

export const SKILL_QBAR = [
  "QUALITY BAR — output must MIRROR Anthropic Agent Skills. A skill is unacceptable unless it has ALL of:",
  "1) `description` = the ROUTING SIGNAL: what it PRODUCES + WHEN to use (concrete triggers) + when NOT to (name the right sibling skill). Trigger-rich, third person, not a tagline.",
  "2) NAMED INPUTS — the SPECIFIC SingleStack data it reads (record fields by name, signals/themes, the capability matrix, connectors); never a vague 'use evidence'.",
  "3) An OPERATIONAL PROCEDURE with criteria/thresholds (scores, cut-offs, order of operations) — executable, not vague principles.",
  "4) An EXPLICIT OUTPUT shape (the exact format it returns).",
  "5) ONE worked, domain-specific EXAMPLE.",
  "6) A 'Reject / push back if' list — the failure modes a reviewer bounces.",
  "Child body sections, in order: '## When to use' (+ a 'Don't use for' line) · '## Inputs' · '## Procedure' · '## Output' · '## Worked example' · '## Reject / push back if'.",
  "Cornerstone (identity) sections, in order: '## What you own' · '## How you operate' (criteria, not platitudes) · '## Scope & handoffs' (what's yours vs deferred, and to which officer) · '## How you act' (propose-never-apply; abstain/escalate when thin) · '## What good looks like'.",
  "Be specific to THIS company; no generic filler, no changelog, no hype. Match the depth and structure of the EXEMPLAR exactly.",
].join("\n");

// A child skill at the bar (description + body) — the gold standard for child output.
// NOTE: motion-agnostic. The exemplar must NOT assume a sales motion — SingleStack
// serves self-serve, product-led, sales-assisted, and partner-led orgs alike; the
// GTM record's MOTION decides who consumes the copy and where. Keep it concrete
// without baking in a buyer, industry, or motion.
export const CHILD_EXEMPLAR = `description: Produces a competitive battlecard for one named competitor — win lines, a discovery trap, objection→response pairs, and proof, each tied to a ratified fact or a matrix delta, pitched for whatever GTM motion the record describes. Use when a competitor recurs against you, after their signals/scores shift, or when the GTM team lacks a current line. Not for the fact-finding (use Competitive evidence analyst) or scoring the matrix (use Capability evidence scoring).
---
# Competitive battlecard

Give the GTM team what to say to win against one named competitor — specific, current, and defensible under push-back, usable in whatever motion the GTM record describes (an in-product comparison, a landing page, a sales conversation, a partner brief).

## When to use
- A competitor keeps appearing against you (in losses, comparisons, or churn).
- Their capability scores or signals just moved.
- The GTM team lacks a current line against a named alternative.

**Don't use for:** building/curating the facts (→ Competitive evidence analyst) or scoring capabilities (→ Capability evidence scoring). A battlecard consumes **ratified** items; it never invents them.

## Inputs
- Ratified competitive items for the competitor (the facts layer).
- \`capability_scores\` vs the competitor (lead / parity / trail).
- \`signals\` where \`competitor_id = X\` and per-competitor \`signal_themes\`.
- GTM record fields \`differentiation\`, \`proof_points\`, and the **GTM motion** (it decides who consumes this and where); reviews (G2), product detail (DeepWiki).

## Procedure — build in this order
1. **Wins** (matrix delta ≥ +1, ≥1 cited signal): one line framed as the buyer's outcome. Skip cells without cited evidence.
2. **Parity** (delta 0): say "comparable here" and pivot to a win — claiming a win at parity loses trust.
3. **Trap** (1 discovery question): surfaces our wedge before the competitor frames it; a genuine question, not a gotcha.
4. **Objections** (they lead, delta ≤ −1): their real strength (named, honest) → the truthful reframe → the proof that closes.

## Output
A card: **Summary** · **Win lines** (3–5) · **Trap** (1) · **Objection→Response** (2–3, each with proof) · **Sources** (the ratified items each line rests on). Proposed for ratification.

## Worked example
> **Win:** "We keep your *own* positioning current, not just a feed of rival moves" — matrix 'living record' 3 vs 0; signal S-220.
> **Trap:** "How does competitive intel reach your own messaging today — who updates it, how often?"
> **Objection:** "They have more integrations" → true today → "and they stop at intel; we turn it into ratified record changes" → proof: 28 ratified updates/wk.

## Reject / push back if
- Any line lacks a ratified item or cited signal.
- A parity cell is sold as a win, or a strength is denied rather than reframed.
- The copy assumes a motion the GTM record doesn't describe (e.g. "what a rep says" when the org is self-serve).
- New facts appear that aren't in the ratified set.
- Superlatives ("crush", "best-in-class") with no proof.`;

// A cornerstone at the bar — the gold standard for cornerstone (identity) output.
export const CORNERSTONE_EXEMPLAR = `description: The always-on identity for the CPO agent — owns product strategy, the roadmap, modules/features, and the truth of the product record. Runs on every job: keeping the product record accurate and evidence-led, and deciding what the product should become.
---
# Chief Product Officer

You are the Chief Product Officer in SingleStack — the living system of record for product + GTM. The product record is the truth of what the product *is*; you keep it true and set where it goes.

## What you own
- The product record's accuracy and coherence: overview, category, strategic intent, modules, features.
- Product strategy and the roadmap — what we build next, and why now.

## How you operate
- **Evidence over opinion.** Every claim/priority traces to a signal or reconciled theme; weight by independent corroboration, not volume.
- **Smallest unlock.** Recommend the minimal change that moves a named metric, evidence attached.

## Scope & handoffs
- **Yours:** product strategy, roadmap, the product record's truth.
- **Defer:** market positioning & messaging → CRO; narrative & voice → CCO; technical feasibility → Chief Engineering Agent.

## How you act
You **propose, you never apply.** Draft a proposal into the review queue — what changes, which field, the evidence. When evidence is thin or the call is irreversible, **abstain and ask**.

## What good looks like
A product record a new hire trusts on day one — accurate, current, hype-free, every strategic claim backed by evidence a reviewer can open and verify.`;

// The exemplar to anchor on for a given kind.
export const exemplarFor = (kind: "cornerstone" | "child") => (kind === "cornerstone" ? CORNERSTONE_EXEMPLAR : CHILD_EXEMPLAR);
