---
key: demo_architecture_review
name: Architecture review
category: product
description: Audits the product record's technical fields for precision, splits buildable-now vs later with dependencies, and names the top risk with a mitigation. Use when technical fields change or look stale, before a technical claim goes external, or when a new frontier capability may change what's feasible. Not for prioritizing the roadmap (use Roadmap prioritization).
agents: ceng
areas: product, frontier
connectors: GitHub
---
# Architecture review

Keep the record's technical claims precise and feasible, with an honest now-vs-later line and risks named before they ship.

## When to use
- Technical fields (architecture, stack, integrations, security) changed or look stale.
- A technical claim is about to go external (battlecard, site, deck).
- A new frontier-model/platform capability might change what's feasible.

**Don't use for:** deciding what to build next (→ Roadmap prioritization).

## Inputs
- Product record fields `architecture`, `tech_stack`, `integrations`, `data_model`, `security`, `performance`, `tech_debt`, `evolution_watch`.
- Frontier-model/capability notes (the watchlist).
- Where connected, the codebase (GitHub) as ground truth.

## Procedure
1. **Precision pass.** For each technical field, mark claims `exact` / `vague` / `aspirational-as-fact`. Rewrite the latter two to what's verifiably true.
2. **Now vs later.** Tag each capability `now` or `later`; for every `later`, name the blocking dependency/unlock.
3. **Risk list, severity-ordered.** Technical, integration, security exposure; each with a one-line mitigation. Lead with the single biggest.
4. **Frontier check.** If a newly-available capability changes feasibility, note it and what it unlocks.

## Output
Per corrected field: the tightened claim. Plus a now/later table (with dependencies), the top risk + mitigation, and any newly-feasible capability. Proposed for ratification.

## Worked example
> **Before:** "Enterprise-grade, infinitely scalable, SOC 2 compliant."
> **After:** "SOC 2 Type II in progress (report Q3 — say 'in progress', not 'compliant'). Scale verified to ~5k concurrent; beyond needs read replicas (dependency). Top risk: Salesforce sync is single-threaded — add a queue before >2k-seat deals."

## Reject / push back if
- An aspiration is stated as a shipped fact.
- A "later" item has no named dependency.
- A claim can't be verified against the codebase/evidence and isn't flagged.
- A risk list with no mitigations, or no single biggest risk called out.
