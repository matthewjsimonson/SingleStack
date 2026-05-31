# SingleStack Dogfood Playbook
**Using SingleStack to deliver SingleStack.**

This walks the whole product in logical order — Foundation → Signals →
Intelligence → Roadmap → Build → GTM → Content — using *real SingleStack
material* you can type straight in. Two jobs at once: (1) stand up SingleStack's
own product + GTM inside the tool, and (2) stress every surface and capture what
should work better.

> **How to use this.** Work top to bottom. Each step has **▸ Screen** (where),
> **✎ Enter** (what to type — real content, edit to taste), **🔬 Dogfood**
> (what to watch / what good looks like). When something's off, note it the way
> we agreed: product/GTM insight → log it as a **Signal**; pure bug/polish →
> tell me for the punch-list.

> **Before you start:** on **dev**, hit **Synthesize** once. If themes/proposals
> come back, the AI is live and everything works. If it errors, stop — the
> `ANTHROPIC_API_KEY` secret isn't set on the dev project and we fix that first.
> To wipe and restart anytime: run `scripts/reset-my-workspace.sql` in the dev
> SQL editor.

---

## Phase 0 — Frame the dogfood (5 min)
We're "marketizing our GitHub": the repo is what SingleStack *is*; this playbook
turns it into a product record, a GTM motion, a listening system, a roadmap, and
content — entirely inside SingleStack.

**Definition of done for the whole playbook:** a stranger could open our
SingleStack workspace and understand what we're building, who it's for, who we're
up against, what we'll ship next and why, and have the messaging to sell it —
all linked by evidence, not vibes.

---

## Phase 1 — Foundation: the Product Record (what SingleStack IS)
The source of truth the rest hangs off.

**▸ Screen:** Products → New product → open the record (`/products`, `/records/[id]`)

**✎ Enter — Overview**
- **What it is:** *An AI-native operating system for product & go-to-market. SingleStack turns the scattered signals a company already generates into living intelligence — themes that compound, confidence you can trust, and a straight line from a signal to the thing you ship.*
- **Who it's for:** *Founders and product/GTM leaders at AI-native software companies (seed–Series C) where product and go-to-market have to move as one brain.*
- **Problem it solves:** *Product and GTM run in silos on stale docs. Intelligence is scattered across calls, tickets, and dashboards; it never accumulates. Decisions lose the evidence that justified them. And the "how" goes stale weekly as AI capabilities change. Teams regress to the mean.*
- **Strategic intent:** *Be the compounding intelligence layer a company runs on — the system of record that gets smarter every time you use it, and pushes you toward the best call instead of the average one.*
- **Vision:** *Every strategic decision in a company traceable from the signal that sparked it to the work that shipped — on a living map you operate from.*
- **Category:** *AI-native product & GTM intelligence platform (a "compounding intelligence OS").*
- **Positioning:** *Not a doc tool, not a roadmap board, not a research repo — the connective intelligence between all of them, that learns.*
- **Differentiation:** *Living themes (not dead docs) · honest confidence (independent corroboration + disconfirmation, not vote-counting) · bridges (cross-lens Product↔GTM insight) · an intelligence map you fight from · it learns from your ratifications and surfaces its own misses.*
- **Ideal customer profile:** *AI-native software companies, 10–200 people, with a founder/CPO who feels the product↔GTM seam and a culture that wants to be pushed, not flattered.*
- **Pricing model:** *(hypothesis — we'll let signals shape it)* per-seat for operators + a workspace/intelligence tier; usage on AI synthesis.

**✎ Enter — Capabilities**
- **Core capabilities:** *Signals & sources · synthesis into living themes · decisions with evidence · Ship/build with provenance · product & GTM foundation records.*
- **Differentiated capabilities:** *Honest confidence engine · cross-lens bridges · the intelligence map (semantic + topographic) · learning from ratification · self-surfaced misses & stale-conviction flags.*
- **Roadmap themes:** *Situational & Accountability map views · agent commanders · real-time streaming agents · objectives as strategy spine · deeper source integrations.*

**✎ Enter — Technical** (this is the "How" that AI capabilities keep changing)
- **Architecture:** *Next.js web + Supabase (Postgres, RLS, Edge Functions) + Claude (Opus) for synthesis/agents.*
- **Tech stack:** *TypeScript, Next.js App Router, Supabase, Deno edge functions, Anthropic SDK.*
- **Integrations:** *MCP-based sources (G2, GitHub, web), more to come.*
- **Data & AI:** *Org-scoped RLS · themes/bridges/confidence computed in Postgres · adaptive-thinking Claude calls with JSON-schema outputs.*
- **Security & compliance:** *Row-level tenant isolation on every table; per-tier project isolation.*

**🔬 Dogfood:** Does the record template fit a *software* product cleanly? Is
anything missing to describe an AI-native product? Does it feel like the source
of truth, or a form? (Note gaps as Signals.)

---

## Phase 2 — Foundation: the GTM Record (how we take it to market)
Marketize the repo. This is the first draft of our story; signals will sharpen it.

**▸ Screen:** GTM → New GTM record → open it (`/gtm`, `/records/[id]`)

**✎ Enter — Overview**
- **Positioning statement:** *For product & GTM leaders at AI-native companies who are tired of strategy that lives in stale docs, SingleStack is the compounding intelligence OS that turns your everyday signals into living strategy and shipped work — unlike roadmap boards and research repos, it learns from your judgment and pushes you to the best call.*
- **Target market:** *AI-native software companies, seed–Series C, 10–200 people.*
- **Personas:** (enter all three)
  - *Maya — Founder/CEO (AI-native startup). Holds product + GTM in her head; needs one brain so the company stops re-deciding the same things. Wins when the team moves as one.*
  - *Devin — Head of Product. Drowning in signals, deciding on gut, losing the "why" behind past calls. Wants evidence that compounds and a roadmap that traces to it.*
  - *Priya — Product Marketing Lead. Positioning goes stale the moment the product moves. Wants product reality and messaging to stay in lockstep, with proof points she can trust.*
- **Messaging pillars:**
  1. *One brain for product + GTM — the seam disappears.*
  2. *Intelligence that compounds — you never start from zero.*
  3. *Honest confidence — pushes you to the best, not the mean.*
  4. *Signal to shipped — one traceable thread.*
- **Competitive landscape:** *(seed; Phase 3 enriches via G2)* Productboard, Aha!, Cycle (product mgmt/feedback); Dovetail (research); Crayon, Klue (competitive intel); Gong, Pendo (signal sources we could ingest, not compete with). Our wedge: none of them connect product↔GTM as one learning intelligence layer.*
- **Pricing & packaging:** *(hypothesis)* Operator seats + workspace tier + AI usage.
- **Channels:** *Founder-led + content (the dogfood story itself) + design-partner motion.*
- **Launch motion:** *Design partners → public "build in the open" → category POV.*
- **Metrics:** *Activation = first synthesis to first ratified theme; depth = themes with 3+ independent sources; the loop = decisions routed to Ship.*
- **Objections & rebuttals:** *"Another PM tool?" → No — it's the learning layer between them. "We have Productboard." → That collects feedback; it doesn't compound intelligence or connect GTM.*
- **Proof points:** *(build these as we go)* the dogfood workspace itself; honest-confidence demo; the map.
- **Sales enablement:** *(Phase 6)* battlecards from /competitive, the live map as the demo.

**🔬 Dogfood:** Can you express the *whole* story here, or do you reach for
things the record can't hold? Does "marketizing the repo" feel natural? This is
the record signals will later challenge — note what's missing.

---

## Phase 3 — Signals & Sources: the listening system
We have **no internal usage data yet**, so we listen externally — via MCP — and
seed the engine with what we already know.

**▸ Screen:** Signals → Product / GTM tabs → Sources (`/signals`), Competitive (`/competitive`), Market (`/market`)

**Step 3a — Connect external sources (MCP).** We'll wire these as our ears:
- **G2** (available now) — market & competitive intelligence: who's researching the
  category, competitor ratings/reviews, buyer intent. *I can pull this live with
  you and log the findings as signals.*
- **GitHub** (our own repo) — our changelog/releases as internal-ish product signals.
- **Web/news** — competitor launches, funding, positioning shifts.

> 🔬 Dogfood: we don't yet have a first-class "connect an MCP source" flow for
> arbitrary servers. Note how you *wish* this worked — it's likely a real gap.

**Step 3b — Add competitors to track.** In `/competitive`, add: Productboard,
Aha!, Cycle, Dovetail, Crayon, Klue. For each, the dimension that matters: *do
they connect product↔GTM? do they learn?* (Our answer: no — that's the wedge.)

**Step 3c — Seed the signals.** Log 8–12 real signals you already believe, mixing
lenses and confidence, so synthesis has something to chew. Examples to type:
- *(product) "Teams keep asking 'why did we decide this?' — decision provenance is a real pain."*
- *(product) "Stale 'how' is universal — AI capabilities change what's buildable weekly."*
- *(gtm) "'Compounding intelligence' lands harder than 'AI for PM' in conversations."*
- *(gtm) "Buyers conflate us with Productboard until they see bridges + the map."*
- *(product) "People love the map demo but want it scoped to their team."*
- *(gtm) "Founders, not PMs, are the ones who feel the product↔GTM seam."*
- Add a couple that **contradict** each other on purpose (e.g. one signal says
  "buyers want a roadmap board," another says "buyers are sick of boards") — so
  you can watch disconfirmation + honest confidence work.

**🔬 Dogfood:** Is logging a signal fast enough to do 12 in a sitting? Does
origin/lens/confidence feel right? Is anything missing to capture a *source*?

---

## Phase 4 — Intelligence: run the loop (the heart)
Now make the engine earn its name.

**▸ Screen:** Signals → Homepage, Map, and the review/learning surfaces (`/signals`)

1. **Synthesize.** Watch the agent's stages (alive). Expect queued **intel
   updates** (new themes / escalations), not silent auto-apply.
2. **Review intel updates.** Accept / edit / reject *with a "why"* and reason
   tags. Reject one thin theme on purpose. → **Distill lessons** → confirm a
   lesson appears, then re-synthesize and watch it apply.
3. **Find bridges.** Confirm at least one real cross-lens bridge (e.g. *"the map
   demo wows" (product) ↔ "buyers conflate us with boards until they see it"
   (gtm)"* → bridge: *the map is the wedge; lead GTM with it, invest product in
   it*). Check the weaker-leg confidence.
4. **Open the Map.** Action Matrix: is the top-right ("act now") cluster the
   thing you'd actually act on? Do contradictions show? Does it breathe? Does
   high ground sit where your confident, accelerating themes are?
5. **Check Worth-reconsidering / Worth-revisiting** if any surface.

**🔬 Dogfood — this is the money moment.** Does the intelligence feel *smarter
than the sum of the signals*? Does honest confidence match your gut? Is a bridge
genuinely non-obvious? Capture everything here as Signals — we're using the
engine to improve the engine.

---

## Phase 5 — Roadmap: what we'll actually build (you + me)
Turn intelligence into committed work. We co-create this.

**▸ Screen:** Decisions (`/decisions`), Roadmap (`/roadmap`), then Ship (`/ship`)

1. **Set objectives** (the strategy spine) — e.g. *"Win the AI-native category
   POV," "Make the map the wedge," "Prove compounding intelligence with our own
   dogfood."*
2. **Open decisions from the hot themes/bridges.** For each escalating theme or
   confirmed bridge, start a **Decision** → **Draft options** (AI) → choose →
   capture the rationale. (e.g. *"Lead the product with the Map"* → decided.)
3. **Route decided decisions to Ship.** Confirm the build item carries its
   provenance (the decision + its evidence + a pre-filled Why).
4. **In Ship, Draft How with AI** — grounded in our capabilities. This is where
   "the How changes as capabilities ship" gets tested for real.

**🔬 Dogfood:** Does decision → build provenance hold? Is the roadmap *traceable*
to evidence? When we decide something, does it feel like it was earned? This
phase produces our **actual** near-term build list — we'll execute it for real.

---

## Phase 6 — GTM & Content (closing the loop)
The intelligence now feeds the go-to-market.

**▸ Screen:** Competitive/Battlecards (`/competitive`), Content (`/content`), Campaigns (`/campaigns`), Enablement (`/enablement`)

1. **Battlecards** from the competitor set + the bridges (our wedge vs each).
2. **Content** — the dogfood story is the content: "We built an intelligence OS,
   then used it to run its own company." Draft pieces from the themes/messaging
   pillars.
3. **Campaigns** — a "build in the open" campaign around the map + honest
   confidence.
4. **Enablement** — the live map as the demo script; objections/rebuttals from
   the GTM record.

**🔬 Dogfood:** Can GTM artifacts pull from the intelligence, or are they
disconnected islands? Does content trace back to a theme/signal? This is where we
learn how tightly the GTM side is wired to the brain.

---

## The feedback contract (every phase)
- **Product/GTM insight** ("synthesis missed X," "bridges should also…") → **log
  it as a Signal in SingleStack.** We literally use the loop to improve the loop;
  by Phase 4 these become themes about our own product.
- **Bug / polish / "this should feel better"** → tell me; punch-list, fast fix,
  push to dev, you refresh.
- **Recurring pain** → it'll cluster into a theme on its own. That's the proof.

## Suggested cadence
1. Phases 1–2 in one sitting (Foundation). Reset dev if it gets messy.
2. Phase 3 (seed signals + sources) — I'll pull G2 live with you.
3. Phase 4 (synthesize + map) — the core test; go slow, capture a lot.
4. Phases 5–6 with me, turning intelligence into real roadmap + GTM.
5. When a wave feels solid → promote to demo (one-click PR) and rebuild the
   *keeper* version there.
