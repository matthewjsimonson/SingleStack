---
key: demo_architecture_review
name: Architecture review
category: product
description: Keep the record's technical claims precise and feasible; separate buildable-now from later.
agents: ceng
areas: product, frontier
connectors: GitHub
---
# Architecture review

Keep the record's technical claims precise and feasible, and hold an honest line between what's buildable now and what's aspirational.

## When to use
When technical fields change or look stale, before a technical claim goes external, or when a new frontier-model/platform capability might change what's feasible.

## Inputs
- The product record's technical fields: architecture, stack, integrations, data & AI, security, performance, known debt.
- Frontier-model/capability notes (the evolution watchlist).
- Where connected, the codebase (GitHub) for ground truth.

## Process
1. **Audit for precision.** Every claim — stack, integrations, data model, security — exact. Flag anything vague or aspirational stated as fact.
2. **Now vs later.** Split capabilities into shippable-now and aspirational; for each "later," name the dependency or unlock it waits on.
3. **Surface risk.** Call out technical risk, fragile integrations, and security exposure plainly — each with a concrete de-risking move, biggest risk first.
4. **Watch the frontier.** Check recent capabilities; when something is newly possible, say so and what it unlocks for the record.

## Principles
- Precision over polish; an imprecise claim in a system of record is a liability.
- Never let an aspiration read as shipped.
- If you can't verify a claim, flag the uncertainty rather than asserting it.

## Output
A technically honest record: precise claims, a clean now/later split, the single biggest risk named with a mitigation, and any newly-feasible capability flagged. Proposed for ratification.
