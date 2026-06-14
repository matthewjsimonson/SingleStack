---
key: demo_competitive_battlecard
name: Competitive battlecard
category: gtm
description: Produces a rep-usable battlecard for one named competitor — win lines, a discovery trap, objection→response pairs, and proof, each tied to a ratified fact or a matrix delta. Use when a competitor recurs in deals, after their signals/scores shift, or when reps lack a current line. Not for the fact-finding (use Competitive evidence analyst) or scoring the matrix (use Capability evidence scoring); this turns ratified facts into copy a rep can say.
agents: cro
areas: competitive, gtm
connectors: DeepWiki, G2
---
# Competitive battlecard

Give a rep what to say to win a live deal against one named competitor — specific, current, and defensible under push-back.

## When to use
- A competitor keeps appearing in deals or losses.
- Their capability scores or signals just moved.
- Reps are improvising against a named alternative.

**Don't use for:** building/curating the facts (→ Competitive evidence analyst) or scoring capabilities (→ Capability evidence scoring). A battlecard consumes **ratified** items; it never invents them.

## Inputs
- Ratified competitive items for the competitor (the facts layer).
- `capability_scores` vs the competitor (lead / parity / trail).
- `signals` where `competitor_id = X` and per-competitor `signal_themes`.
- GTM record fields `differentiation`, `proof_points`; reviews (G2), product detail (DeepWiki).

## Build, in this order
1. **Wins** (matrix delta ≥ +1, ≥1 cited signal): one line framed as the buyer's outcome. Skip cells without cited evidence.
2. **Parity** (delta 0): say "comparable here" and pivot to a win — claiming a win at parity loses trust.
3. **Trap** (1 discovery question): surfaces our wedge before the competitor frames it; a genuine question, not a gotcha.
4. **Objections** (they lead, delta ≤ −1): their real strength (named, honest) → the truthful reframe → the proof that closes.

## Output
A card: **Summary** (the paragraph a rep leads with) · **Win lines** (3–5) · **Trap** (1) · **Objection→Response** (2–3, each with proof) · **Sources** (the ratified items each line rests on). Proposed for ratification.

## Worked example (vs Crayon)
> **Win:** "We keep your *own* positioning current, not just a feed of rival moves" — matrix 'living product+GTM record' 3 vs 0; signal S-220.
> **Parity:** "Source coverage is comparable" → pivot to the win.
> **Trap:** "How does competitive intel reach your own messaging today — who updates it, how often?"
> **Objection:** "Crayon has more integrations" → true today → "and they stop at intel; we turn it into ratified record changes" → proof: 28 ratified updates/wk.

## Reject / push back if
- Any line lacks a ratified item or cited signal.
- A parity cell is sold as a win, or a strength is denied rather than reframed.
- New facts appear that aren't in the ratified set — bounce to Competitive evidence analyst.
- Superlatives ("crush", "best-in-class") with no proof.
