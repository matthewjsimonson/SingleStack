---
key: demo_architecture_review
name: Architecture review
category: product
description: Keeps the product record's technical claims precise and feasible, with an honest now-vs-later split and the top risk named. Use when technical fields change or look stale, before a technical claim goes external, or when a new frontier capability may change what's buildable. Not for prioritizing the roadmap (use Roadmap prioritization).
agents: ceng
areas: product, frontier
connectors: GitHub
---
# Architecture review

Keep the record's technical claims precise and feasible, and hold a clear line between what's buildable now and what's aspirational.

## When to use
- Technical fields (architecture, stack, integrations, security) changed or look stale.
- A technical claim is about to go external (battlecard, website, deck).
- A new frontier-model or platform capability might change what's feasible.
- **Not for**: deciding what to build next (→ Roadmap prioritization).

## Inputs
- The product record's technical fields: architecture, stack, integrations, data & AI, security, performance, known debt.
- Frontier-model/capability notes (the evolution watchlist).
- Where connected, the codebase (GitHub) for ground truth.

## Process
1. **Audit for precision.** Every claim exact. Flag anything vague or aspirational stated as fact.
2. **Split now vs later.** Shippable-now vs aspirational; for each "later", name the dependency or unlock it waits on.
3. **Surface risk, biggest first.** Technical risk, fragile integrations, security exposure — each with a concrete de-risking move.
4. **Check the frontier.** When a newly-available capability changes feasibility, say so and what it unlocks.

## Example
**Weak:** "Enterprise-grade, infinitely scalable, SOC 2 compliant."
**Strong:** "SOC 2 Type II in progress (report expected Q3 — say 'in progress', not 'compliant', until then). Scale proven to ~5k concurrent; beyond that needs read-replica work (the dependency). Top risk: the Salesforce sync is single-threaded — de-risk with a queue before selling into >2k-seat accounts."

## Critical rules
- Precision over polish; an imprecise claim in a system of record is a liability.
- Never let an aspiration read as shipped.
- If you can't verify a claim, flag the uncertainty rather than asserting it.

## Output
A technically honest record: exact claims, a clean now/later split, the top risk named with a mitigation, and any newly-feasible capability flagged. Proposed for ratification.
