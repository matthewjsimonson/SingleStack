# Dogfood Findings — sequential log

We walk `DOGFOOD-PLAYBOOK.md` **as a new customer would**, top to bottom, and log
what we hit in order. One row per finding. This is the running record between the
person at the keyboard and Claude.

**Conventions**
- **Type:** `BUG` (broken/wrong) · `POLISH` (rough but works) · `UX` (confusing) ·
  `SIGNAL` (a real product/GTM insight — also log it *in* SingleStack) · `BLOCK`
  (can't proceed).
- **Sev:** `P0` blocks the walkthrough · `P1` hurts first impression · `P2` minor.
- **Status:** `open` → `fixed` (commit) / `flagged` (deferred) / `wontfix`.

**Preconditions (check once, before Phase 1)**
- [ ] dev `ANTHROPIC_API_KEY` set — hit **Synthesize** once; themes/proposals
      come back without error. *(The playbook's hard gate.)*
- [ ] Signed in; empty workspace loads (homepage renders, no console errors).
- [ ] Single-product path confirmed: product switcher hidden, all "company-wide".

---

## Findings

| # | Phase | Screen | Type | Sev | What happened | Status |
|---|-------|--------|------|-----|---------------|--------|
| _e.g._ | 1 | `/products` empty | UX | P1 | _no guidance on what a product record is for_ | open |

---

## Notes for the walkthrough
- **Not in scope for this dogfood** (single-product path): the cross-sell /
  multi-product surfaces (switcher, cross-product themes, per-line scoping). Built
  and tested, but a single-product workspace won't surface them.
- **Built-but-unwired** (don't file as bugs — known): one-click MCP source
  connections, scheduled/on-signal workflows, agent-to-agent, agent skills at
  runtime. See playbook's "LIVE vs UNBUILT".
