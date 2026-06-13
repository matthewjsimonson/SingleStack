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
3. **Library = generic templates; agent = tailored instances (`template → instance`).**
   A library skill is a generic **template** (cornerstone = a role/purpose profile like
   "one narrative" for a CMO/CCO; child = a general capability like "competitive
   analysis"). Attaching a template to an agent **mints a per-agent tailored
   INSTANCE** — its own markdown body and its own `skill_revisions` history,
   `parent_id → the template` it was tailored from. The same generic child is
   tailored differently for a CPO vs a CMO. *(Validated against agent-design
   research: persistent role identity + reusable skills specialized per role.)*
   Schema: `skills.kind` (cornerstone|child) ✅ A.1; `skills.scope`
   (library|agent) + `skills.agent_id` (instance owner) + `parent_id` re-purposed
   as **instance→template lineage** (A.1b).
4. **One identity source = the cornerstone skill (CONFIRMED).** An agent's identity
   is its **cornerstone instance**; the runtime prompt is *derived* from cornerstone
   + tailored children. The parallel `agents.identity/mandate/principles/voice →
   system_prompt` composition is retired / rendered *from* the cornerstone, so there
   is one source and nothing to contradict. *(Executes in Phase C.)*
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
7. **Relevance & tailoring reuse existing governed data — no new schema.**
   Agent↔child relevance = `skills.areas` ∩ `connections.area`; the tailor / AI-update
   is grounded in cornerstone + product record + the GTM record's personas/market;
   control = `apply_skill_evolution` / `skill_revisions` + the autonomy dial over
   C2-gated records. Skills live under Agents (IA), not as a top-level tab.

## Dependency-ordered phases
- **A. Skills substrate**
  - **A.1** `skills.kind` (cornerstone/child). ✅ *(20260613050000)*
  - **A.1b** `template → instance`: `skills.scope` (library|agent) + `skills.agent_id`
    (instance owner); re-purpose `parent_id` as instance→template lineage (drop the
    old cornerstone-no-parent check). Library view filters to `scope='library'`.
  - **A.2** Files I/O: export skill → `SKILL.md` ✅ (slice 1); import skill ←
    uploaded file (`import-skill` edge fn, AI-structured, HITL draft) + raw original
    kept in `documents` for provenance.
- **B. Tailoring + agent setup (skills live UNDER Agents)**
  - **B.1 IA:** the skills library is a **tab within Agents**, not a top-level nav
    item — skills are agent-scoped knowledge, so they live where agents live.
  - **B.2 Relevant skill picker:** creating/updating an agent opens a popup to attach
    skills; it shows only the **generic child templates relevant to that agent** —
    relevance = `skills.areas` ∩ the agent's connected areas (`connections.area`,
    normalized product(s)/gtm) + cornerstone role. Attaching mints a tailored
    instance (A.1b).
  - **B.3 Tailor = grounded + controlled (one engine with "update skills with AI"):**
    tailoring / AI-updating a skill is specialized from the agent's **cornerstone**
    (role identity) + the **product record** + the **GTM record's market & personas**
    (`icp`, `industries`, `primary_persona`+, `positioning`, `category_pov`,
    `differentiation`, `win_themes`, `gtm_motion`) — all C2-gated canonical records.
    It writes through `apply_skill_evolution` → `skill_revisions` (provenance), HITL
    under the autonomy dial. The first tailor and ongoing AI updates use the same
    grounded, controlled path.
  - **B.4 Top-down decision-tree view** (replaces the radial depiction); AI-assisted
    setup walks the tree. Real, company-grounded instance content replaces demo
    placeholders.
- **C. Agent rebuild** — unify identity onto the cornerstone instance (decision #4);
  derive the runtime prompt; retire the 4-window composition; reseed the roster with
  the role-named cornerstones. **Existing agents will be rebuilt onto this model.**
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
