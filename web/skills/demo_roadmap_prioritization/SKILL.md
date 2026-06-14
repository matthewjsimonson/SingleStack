---
key: demo_roadmap_prioritization
name: Roadmap prioritization
category: product
description: Produces a ranked "build next" shortlist with an explicit "not now" list — each item scored on corroborated demand, strategic fit, and effort, and tied to the metric it moves. Use when sequencing the roadmap, triaging an incoming request, or auditing whether an item still earns its slot. Not for technical feasibility (use Architecture review), positioning (use Positioning sharpening), or what a competitor's move means (use Competitive evidence analyst).
agents: cpo
areas: product, roadmap, strategy
---
# Roadmap prioritization

Convert demand into a ranked, defensible build order — optimizing for the smallest move that shifts a real metric, with every trade-off explicit and evidence-backed.

## When to use
- Sequencing or re-sequencing what to build next.
- A request lands and you must place it — or decline it.
- Auditing whether a roadmap item still earns its slot.

**Don't use for:** is-this-buildable (→ Architecture review), how-we-say-it (→ Positioning sharpening), or what a rival's move means (→ Competitive evidence analyst). Bring their outputs here as inputs.

## Inputs
- `signal_themes` + `theme_evidence_strength` — the demand signal; prefer independent-source corroboration over count.
- Product record fields `strategic_intent`, `core_capabilities`, modules/features — fit and overlap.
- The engineering read (Architecture review) — buildable-now vs later + dependency.
- Outcome/metric signals — what each candidate would actually move.

## Procedure — score each candidate, then rank
1. **Demand (0–3)** from `theme_evidence_strength`: 0 = single source / one loud ask; 1 = 2 independent sources; 2 = 3+ or escalating; 3 = 3+ AND escalating AND survives contradiction. A lone signal never exceeds 0.
2. **Strategic fit (−1 / 0 / +1):** +1 advances the category we claim; 0 maintenance; −1 pulls us off-thesis (flag even if demanded).
3. **Effort (S/M/L)** from the engineering read; note the blocking dependency for anything not buildable now.

**Rank** by Demand ↓, then Fit, then smallest Effort. Prefer the smallest unlock that moves a metric over a larger adjacent bet. Defer/drop fit = −1 and say why.

## Output
A table — `Item · Demand (n sources) · Fit · Effort · Metric · Dependency · Cited themes` — then an explicit **"Not now"** list (item + the one reason). Each row is a proposal into the review queue; never applied.

## Worked example
> **Ship:** Saved-view filters — Demand 2 (theme "reporting friction", 3 sources, escalating) · Fit +1 · Effort S · moves weekly-active-operators · no dep · T-412.
> **Not now:** Full analytics dashboard — Demand 0 (one enterprise ask) · Effort L · "single-source; revisit if filter usage shows the pull."

## Reject / push back if
- An item is ranked on a single loud signal (that's Demand 0).
- A −1 fit item is proposed without flagging the thesis conflict.
- No "Not now" list, or no metric named per item.
- Effort/dependency asserted without the engineering read — say "needs Architecture review" instead of guessing.
