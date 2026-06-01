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
| 1 | bring-up | `/signals` | UX | P1 | Checklist said "hit Synthesize as the hard gate" but the button is `disabled` until ≥1 signal exists (`SignalsView.tsx:285`) — impossible on an empty workspace. Sequencing bug in the playbook. Fixed: bring-up now says seed 2–3 signals first, then Synthesize. | fixed `7d343ef→` |
| 2 | 1 | `/records/[id]` product → Market & positioning | SIGNAL | P1 | Product record's "Market & positioning" section (Category, Positioning, Differentiation, ICP, Pricing) is really GTM content & overlapped GTM record fields → duplication/drift risk. Decided: clean separation, one home per field. Done: Category→Product Overview; Positioning→GTM Company narrative; ICP→GTM "Personas & ICP"; Pricing→GTM Channels & motion; removed Product "Market & positioning" section. No data loss (SectionedFields renders all filled DB fields regardless of template). | fixed |
| 3 | 1 | product record → Category field | BUG | P2 | Typo in entered content: "Product Leg Growth Platform" → should be "Product-Led Growth Platform". User-side fix on re-entry. | flagged |
| 4 | 1 | product record → Proof section | SIGNAL | P1 | Same root as #2: Product's "Proof" section (Key metrics, Reference customers, Customer outcomes) is market-facing sales proof, not what-it-is. Moved to a consolidated GTM "Proof" section (also pulled `proof_points` out of GTM Product messaging into it — one proof home, no drift). Product per-ship validation stays on Build items' Proof section. | fixed |
| 5 | 1 | records (architecture) | SIGNAL | P0-concept | Records must be LIVING: dynamic with signals/releases, human-ratified, esp. customer metrics (NPS, usage) MoM. Narrative side already built (`field_revisions`+`accept_proposal`). Gap = METRIC fields. BUILT: (a) DB foundation — `record_fields.field_kind`, `record_metrics` time-series with enforced provenance (no naked numbers — DB CHECK), `metric_latest()` MoM helper, verified on Postgres; (b) UI — `MetricField` (latest value + MoM delta + history + sourced "add reading" that requires source+backup), metric/narrative split in `SectionedFields`, add-field toggle to create a metric. Narrative fields untouched (filled at the gate, no source needed). Next: `metric_update` proposal-gate wiring + signal-source binding. | mostly fixed |
| 6 | hardening | `metric_latest()` RPC | BUG | **P0 security** | Self-caught in pre-dogfood hardening: `metric_latest()` was SECURITY DEFINER with no org check → cross-tenant leak (user in org B read org A's NPS via RPC; direct table read was correctly RLS-blocked). Fixed: redefined WITHOUT definer so record_metrics RLS applies to the caller. Verified on 2-org Postgres (B→`<none>`, A→own value). Swept all other definer funcs (accept_proposal/merge_themes/record_field_revision/handle_new_user) — all correctly org-guarded. | fixed |
| 7 | 2 | GTM record template | SIGNAL | P1 | GTM record had 27 fields — too many, much of it AI-derivable output or duplicated. Cut to 10 cornerstone INPUT fields across 4 sections (Positioning, Messaging, Buyer, Motion). Per owner: dropped Objections (too specific) and Economic buyer (folded into personas — multiple personas via +Field). Also dropped AI-outputs (tagline/pitch/battlecard), own-entity dupes (competitors/campaigns), Proof (now metric fields), narrative/vision dupes, loss_themes (→ win-loss signals). | fixed |
| 8 | 3 | `/gtm/[id]` back button | BUG | P1 | GTM record "back" pointed to parent product record (`/records/{product}`), not GTM home — inconsistent with its own breadcrumb. Fixed → `/gtm`. | fixed |
| 9 | 3 | `/competitive` | BUG | P1 | No way to delete a competitor (GovDash isn't a SingleStack competitor, couldn't remove). RLS already allowed delete; UI never exposed it. Added a confirm-guarded `×` remove on each competitor card (Dashboard). NOTE: first attempt was committed prematurely against a wrong assumed file structure and did NOT apply — corrected in a follow-up commit; competitor delete is now actually present + build-verified. FK cascade (scores/battlecards/sources) + RLS delete both verified on Postgres. | fixed |
| 10 | dogfood | homepage "Foundation filled %" | BUG | P1 | Showed **100%** on a near-empty workspace. Cause: denominator was "record_fields rows that exist," but rows are only created when filled → filled/existing = 100% with a couple residual fields. Fixed: measure against the TEMPLATE's expected fields × the product/GTM records that should have them (matches the per-record completion logic). Metric fields excluded from numerator (their data lives elsewhere). | fixed |
| 11 | 3 | `/competitive` delete | UX | P2 | Delete used the browser's native `confirm()` popup. Replaced with an in-app `ConfirmDialog` (new reusable primitive in ui.tsx, built on Modal, destructive-red confirm) matching the design system. | fixed |
| 12 | 1 | product record save | BUG | P1 | "Could not save" → real cause (after error-surfacing fix) was `duplicate key … record_fields_product_key_uniq [23505]`: record had fields from an earlier session, save decided insert-vs-update from STALE CLIENT state and re-inserted an existing key. Fixed: surface real PostgrestError (was hidden by `instanceof Error`); decide insert/update by re-querying DB keys at save time (upsert impossible — unique index is partial, ON CONFLICT can't target it). Verified on Postgres. | fixed |
| 13 | sweep | same bug elsewhere | BUG | P1 | Swept all 16 unique constraints for the same stale-state insert/update anti-pattern. Found + fixed: `BuildItemWorkspace.saveField` (initiative_fields, Ship — exact same bug) and hardened `CompetitiveView.cycleScore` (capability_scores — lower risk but same class + was swallowing errors). Confirmed SAFE: `DecisionWorkspace` insert (brand-new initiative, keys can't pre-exist) and `MetricField` (already handles unique-period collision with a clear message). | fixed |

---

## Notes for the walkthrough
- **Not in scope for this dogfood** (single-product path): the cross-sell /
  multi-product surfaces (switcher, cross-product themes, per-line scoping). Built
  and tested, but a single-product workspace won't surface them.
- **Built-but-unwired** (don't file as bugs — known): one-click MCP source
  connections, scheduled/on-signal workflows, agent-to-agent, agent skills at
  runtime. See playbook's "LIVE vs UNBUILT".
