---
key: demo_roadmap_prioritization
name: Roadmap prioritization
category: product
description: Produces a ranked, evidence-backed shortlist of what to build next, with an explicit "not doing" list. Use when deciding or re-sequencing the roadmap, triaging an incoming request, or pressure-testing whether an item still earns its slot. Not for technical feasibility (use Architecture review) or market positioning (use Positioning sharpening).
agents: cpo
areas: product, roadmap, strategy
---
# Roadmap prioritization

Turn raw demand into a ranked, defensible "build next" list — driven by corroborated evidence, not the loudest request, and biased toward the smallest move that shifts a real metric.

## When to use
- Deciding or re-sequencing what to build next.
- Triaging an incoming feature request or stakeholder ask.
- Re-checking whether an item already on the roadmap still earns its slot.
- **Not for**: judging whether something is technically buildable (→ Architecture review) or how to position it (→ Positioning sharpening).

## Inputs
- Reconciled themes + their confidence (the demand signal) and the signals beneath them.
- The product record's strategy, modules, and features (for fit and overlap).
- The engineering read on buildability (now vs later, dependencies).

## Process
1. **Rank by corroborated demand.** Order by escalating, multi-source themes — use theme confidence (independent corroboration), never raw signal count. One loud customer is not a theme.
2. **Test strategic fit.** Does it advance the category we're claiming, or is it a detour? Name the detours and set them down.
3. **Get the buildability read.** For each top candidate, pull what's shippable now vs later and the dependency each "later" waits on.
4. **Choose the smallest unlock.** Recommend the minimal change that moves the outcome; name the metric and the evidence.
5. **State the trade-off.** Name what loses a slot and why — a prioritization without a "no" is a wishlist.

## Example
**Weak:** "Build an analytics dashboard — customers keep asking."
**Strong:** "Ship saved-view filters first (theme 'reporting friction': 5 signals / 3 sources, escalating). Moves weekly-active-operators; ~3 days; unblocks the dashboard ask without committing to the full build. Deferring the dashboard — single-source demand, large build."

## Critical rules
- Demand = independent corroboration, not volume.
- Smaller, reversible moves beat big bets when evidence is mixed.
- If evidence can't separate two items, say so and ask — don't invent a ranking.

## Output
A ranked shortlist; each item carries its theme/signals, why-now, the metric it moves, rough effort, and dependency — plus an explicit "not doing" list. Proposed for ratification, never applied.
