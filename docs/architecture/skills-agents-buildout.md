# Skills & Agents buildout — the living plan

Status: **building (Phase A)** · Owner: SingleStack
Governs: the skills-as-files substrate, the agent model, stewardship, and fail-safes.
Companion to `living-records.md` (records) and `compounding-intelligence.md` (themes).

This doc is the source of truth for the multi-phase build. Keep it accurate: before
starting any phase, re-validate it against the current schema and prior commits.
**No shortcuts** — each phase ships the right architecture, reliability, and
performance, verified, before the next.

---

## North star
An agentic system where humans and AI co-maintain product + GTM, where **agents
don't fight or contradict** each other, where **skills are true markdown files**
(uploadable, downloadable, and updated *as files* — including agentically), and
where, when an answer is unclear, an agent **walks a decision tree of fail-safes**
instead of guessing.

## Load-bearing decisions (made)
1. **Control before features.** Canonical record values cannot change except via a
   ratified proposal or an explicit human channel (DB invariant). *(Shipped: C1, C2.)*
2. **Skill body = markdown in the DB** (`skills.instructions`), canonical. A real
   `SKILL.md` is materialized on download and parsed on upload; `skill_revisions`
   is the file-diff history. Storage is used only for the raw uploaded original
   (provenance), never as the canonical body.
3. **Cornerstone/child are first-class in the library.** `skills.kind`
   (cornerstone|child) + `skills.parent_id` (child→its cornerstone, self-FK,
   arbitrary depth). A cornerstone is the parent profile (an agent's identity); a
   child tailors it. *(Shipped: A.1.)*
4. **One identity source (pending execution — Phase C).** An agent's identity is
   its cornerstone skill; the runtime prompt is *derived* from cornerstone + child
   skills. The parallel `agents.identity/mandate/principles/voice → system_prompt`
   composition is retired/rendered-from-cornerstone so there is nothing to
   contradict. **Decision to confirm with the operator before executing.**
5. **The skill hierarchy and the fail-safe decision tree are one graph.** Two edge
   types on the same top-down tree: *composition* edges (`parent_id`: this child
   tailors that parent) and *fallback* edges (when unclear → ask_human / hand to
   another skill node / escalate / hold). The tree drives **AI-assisted setup**
   (grow an agent from its cornerstone down) and makes fail-safes legible. It is
   functional, not decorative.
6. **Fail-safes are evidence-first.** Self-reported model confidence is poorly
   calibrated; gate on independent-source corroboration (`theme_confidence`) +
   abstention, with the autonomy dial (`review_policies`) as ceiling and the
   fail-safe as floor. (Research: arXiv 2601.07767, 2510.20460, 2604.03904.)

## Dependency-ordered phases
- **A. Skills substrate**
  - **A.1** `skills.kind` + `parent_id` (cornerstone/child). ✅ *(20260613050000)*
  - **A.2** Files I/O: export skill → `SKILL.md`; surface cornerstone/child in the
    library; import skill ← uploaded file (`import-skill` edge fn, AI-structured,
    HITL draft) + raw original kept in `documents` for provenance.
- **B. Authoring & setup UI** — upload + "tailor with AI" in the library; the
  **top-down hierarchy/decision-tree view** (replaces the radial depiction);
  AI-assisted setup walks the tree. Real, company-grounded child-skill content
  replaces demo placeholders.
- **C. Agent rebuild** — unify identity onto the cornerstone (decision #4); derive
  the runtime prompt; reseed the roster. *(Confirm before executing.)*
- **D. Stewardship (C3)** — a steward (agent/role) per field/section so non-steward
  proposals are flagged/routed; binds to the rebuilt agent model.
- **E. Fail-safes** — confidence-gated decision tree (the fallback edges on the
  Phase-B tree); evidence-first; runtime-enforced under the autonomy dial.

## Control layer (done, underpins everything)
- **C1** conflict-aware `accept_proposal` (optimistic concurrency, race-safe). ✅
- **C2a/b** structural HITL write-gate on `record_fields.value` (UPDATE + INSERT). ✅
- **P2** org-leading composite indexes. ✅
- Deferred: **P1** (drop `signal_themes.signal_ids[]` dual-source — high-touch),
  **P3** (persist honest confidence vs recompute) — optimizations, not gaps.

## UI/UX backlog (phase in when the relevant surface is touched)
- **Expandable text fields** — a clean popup to expand small textareas across the
  app (record fields, skill body, etc.). Cross-cutting; apply per surface.
- **Top-down skill/decision tree** — see decision #5; lands in Phase B.
- **Conflicted re-review affordance** — a way to act on `conflicted` proposals
  beyond the History chip + inline notice.
