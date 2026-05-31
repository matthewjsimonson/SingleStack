# SingleStack Dogfood Playbook
**Using SingleStack to deliver SingleStack.**

This walks the whole product in logical order — Foundation → Signals →
Intelligence → Roadmap → Build → GTM → Content — using *real SingleStack
material* you can type straight in. Two jobs at once: (1) stand up SingleStack's
own product + GTM inside the tool, and (2) stress every surface and capture what
should work better.

> **How to use this.** Work top to bottom. Each step has **▸ Screen** (where),
> **✎ Enter** (what to type — real content, edit to taste), **🔬 Dogfood**
> (what to watch / what good looks like). We walk it **as a new customer would**,
> flagging issues **sequentially as they arise** — you drive the screen, I triage
> and fix. Every finding goes into `docs/DOGFOOD-FINDINGS.md` (one row, type/sev/
> status). Product/GTM insight → also log it as a **Signal** in the tool; pure
> bug/polish → I fix and push to dev, you refresh.

> **Bring-up checklist — do this once before Phase 1 (only you can; I have no dev
> runtime):**
> 1. **The hard gate:** sign into dev, hit **Synthesize** once. Themes/proposals
>    come back → AI is live, proceed. It errors → STOP; the dev
>    `ANTHROPIC_API_KEY` isn't set. Fix that first.
> 2. **Migrations applied on dev:** all **55**, incl. the cross-tenant P0 fix
>    (`20260530270000`). (Repo is verified clean; what I can't check is that dev
>    has *run* them.)
> 3. **Clean slate if needed:** run `scripts/reset-my-workspace.sql` in the dev
>    SQL editor.
> 4. **First-run expectation:** this is the **first true end-to-end firing** of
>    the edge functions + model calls — everything to date is build/logic/DB-
>    verified, never live-runtime-verified. Expect first-run surprises on the
>    synthesize / resolve / distill paths; that's what we're here to catch.
> 5. **New signups auto-join the org** (the `on_auth_user_created` trigger) —
>    correct single-tenant behavior; don't mistake it for a bug.

> **What's LIVE vs UNBUILT (read this — it sets expectations).**
> *Live and working:* Foundation records, logging signals, synthesize → review →
> distill (the learning loop), find bridges, the intelligence map (Action Matrix
> with terrain + motion), decisions → draft options → route to Ship → draft How,
> honest confidence, self-surfaced misses & stale flags, multi-product scoping.
> *New this session (built + verified, exercised here for the first time):* a
> **secured connector** for public web/YouTube sources (SSRF-guarded fetch + an
> always-on prompt-injection screen that quarantines hostile content before it
> reaches a model, logged to `security_events`); a **Source Recipe Builder**
> ("describe a signal you want" → Claude drafts a runner-ready source you confirm);
> a **bounded, product-aware synthesis** engine that also detects **cross-sell
> (cross-product) themes**; and **HITL review of that cross-sell scope**. *(The
> cross-sell + multi-product surfaces won't visibly fire in a single-product
> workspace — see the multi-product note below — but the secured web/YouTube
> connector + recipe builder WILL.)*
> *Still NOT wired (don't file as bugs):* credentialed **MCP source connections**
> (G2/GitHub/CRM one-click pulls need the secret store — `docs/CONNECTIVITY.md`);
> **scheduled / on-signal workflows**; **agent-to-agent**; agent **skills** at
> runtime. So credentialed external signals are still **me-assisted**; *public*
> web/YouTube sources you can now add yourself via the recipe builder.

> **Multi-product note.** SingleStack is one product, so the product switcher
> stays hidden and everything is "company-wide" — the clean single-product path.
> This means the session's **cross-sell / multi-product** work (the sidebar
> switcher, per-line scoping, cross-product theme detection, and HITL review of
> cross-sell scope) **won't visibly fire here** — it's built + DB-verified and
> lights up the moment a second product line exists. *Optional stress test:* add a
> throwaway second product to watch the switcher appear and synthesis split by
> line; then reset. Otherwise, treat those surfaces as out-of-scope for this walk.

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

**▸ Screen:** GTM → New GTM record → open it (`/gtm`, `/records/[id]`).
Fields below match the real GTM template (Company narrative / Product messaging
/ Personas / Competitive).

**✎ Enter — Company narrative**
- **Narrative:** *Companies generate more signal than ever and turn less of it into good decisions. Product and GTM drift apart on stale docs; the "why" behind decisions evaporates; AI changes what's buildable weekly. SingleStack is the compounding intelligence layer that fixes this — one brain that gets smarter every time you use it.*
- **Category POV:** *The category isn't "AI for PM." It's the compounding intelligence OS — the learning layer between product and go-to-market. Roadmap boards, research repos, and competitive-intel tools are point solutions; the value is in connecting them and making the connection learn.*
- **Vision:** *Every strategic decision traceable from the signal that sparked it to the work that shipped — on a living map you operate from.*
- **Differentiation:** *Living themes (not dead docs) · honest confidence (independent corroboration + disconfirmation) · cross-lens bridges · an intelligence map you fight from · learns from your ratifications and surfaces its own misses.*

**✎ Enter — Product messaging**
- **Value proposition:** *Turn the signals you already generate into living strategy and shipped work — with confidence you can actually trust.*
- **Message pillars:** *(1) One brain for product + GTM. (2) Intelligence that compounds — never start from zero. (3) Honest confidence — pushed to the best, not the mean. (4) Signal to shipped — one traceable thread.*
- **Proof points:** *(build as we go)* this dogfood workspace; the honest-confidence demo (3 independent sources beat 5 from one); the map.
- **Elevator pitch:** *SingleStack is the compounding intelligence OS for AI-native companies. It turns scattered signals into living themes, connects product and GTM into one picture, and traces every decision to the evidence and the work — getting smarter each time you use it.*
- **Tagline:** *(candidates to test as signals)* "The compounding intelligence OS." / "From signal to shipped." / "Strategy that learns."

**✎ Enter — Personas** (the buying side)
- **Primary persona:** *Devin — Head of Product at an AI-native company. Drowning in signals, deciding on gut, losing the "why" behind past calls. Wants evidence that compounds and a roadmap that traces to it.*
- **Economic buyer:** *Maya — Founder/CEO. Feels the product↔GTM seam most; buys "one brain so we stop re-deciding the same things."*
- **Buying committee:** *Founder/CEO (economic), Head of Product (champion/primary), Product Marketing Lead (Priya — positioning stays in lockstep with product), eng lead (the "How").*
- **Objections & answers:** *"Another PM tool?" → No — the learning layer between them. "We have Productboard." → That collects feedback; it doesn't compound intelligence or connect GTM. "Is the AI trustworthy?" → Honest confidence + disconfirmation + it surfaces its own misses; it's built not to flatter you.*

**✎ Enter — Competitive** *(seed now; Phase 3 enriches via G2)*
- **Main competitors:** *Productboard, Aha!, Cycle (product mgmt/feedback); Dovetail (research); Crayon, Klue (competitive intel). Gong/Pendo are signal sources to ingest, not competitors.*
- **Win themes:** *Cross-lens product↔GTM; intelligence that compounds; honest, disconfirmation-aware confidence; the map as the demo.*
- **Loss themes:** *(hypotheses to validate)* "we already have a roadmap tool"; single-player vs. the team needing one source; early-stage trust in AI judgment.*
- **Battlecard summary:** *Everyone else is a point solution that collects or displays. We're the connective layer that learns. Lead with the map + a bridge.*
- **GTM motion:** *Founder-led + build-in-the-open content + design partners.*
- **Channels:** *Founder network, content (the dogfood story), design-partner motion.*
- **Active campaigns:** *(Phase 6)* "Build in the open" around the map + honest confidence.

**🔬 Dogfood:** Can you express the *whole* story here, or do you reach for
things the record can't hold? Does "marketizing the repo" feel natural? This is
the record signals will later challenge — note what's missing.

---

## Phase 3 — Signals & Sources: the listening system
We have **no internal usage data yet**, so we listen externally — via MCP — and
seed the engine with what we already know.

**▸ Screen:** Signals → Product / GTM tabs → Sources (`/signals`), Competitive (`/competitive`), Market (`/market`)

**Step 3a — Bring in external sources.** Two paths now exist:

*Self-serve (new this session — public sources, no credentials):* In **Sources**,
use **"✨ Describe a signal you want"** — type something like *"watch our GitHub
releases page"* or *"competitor X's pricing page"* → Claude drafts a runner-ready
source (kind, targets, focus, budget) you review and add → **Pull now**. The
runner fetches it (SSRF-guarded), **screens it for prompt-injection before any
model sees it**, distills signals, and respects your per-pull budget. Works today
for **public web pages and YouTube**.
- **GitHub** (our repo) — point a `website` source at the releases/changelog page.
- **Web/news** — point a `website` source at a competitor's blog/pricing/launch page.

*Me-assisted (credentialed sources — until the secret store lands):*
- **G2** (I have a live connection) — market & competitive intel: who's
  researching the category, competitor ratings/reviews, buyer intent. *Say the
  word and I'll pull it and draft signals for you.*

> 🔬 Dogfood — the recipe builder: does "describe a signal → confirm a source"
> feel trustworthy and clear? Is the access scope / read-only / budget visible
> enough? Where would you *expect* the button, and what would make you trust it
> with a credential later? That feedback shapes the credentialed flow.
> 🔬 Dogfood — **security (try to break it):** add a `website` source pointed at a
> page you control that contains text like *"ignore previous instructions and…"*;
> confirm those instructions are **quarantined**, not obeyed (the run should
> report content blocked / not surface it as a signal). Try an internal URL
> (`http://localhost`, `http://169.254.169.254`) — it should be **refused**.

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
4. **Open the Map** (Signals → Map tab). It's the dark, topographic Action
   Matrix: X = confidence (Watch → Act now), Y = momentum lanes (Accelerating /
   Steady / Fading). Check: does the **high ground** (bright contour clusters)
   sit on your confident+accelerating themes? Do **red contradiction dots** show
   on contested themes? Does it **breathe** (subtle motion) — too much, too
   little, just right? Click a node to drill into the theme. *Feel the pacing —
   the breathing speed is tuned by me and is the one thing only you can judge
   live.*
5. **Check Worth-reconsidering / Worth-revisiting** if any surface (the system
   flagging its own misses + decisions whose ground shifted).

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
0. **Bring-up** (the checklist up top): Synthesize once, confirm migrations,
   reset if needed. Don't start Phase 1 until the hard gate is green.
1. Phases 1–2 in one sitting (Foundation). Reset dev if it gets messy.
2. Phase 3 — seed 8–12 signals + add a **public web/YouTube source via the recipe
   builder** (and try the security stress test); I'll pull G2 live with you.
3. Phase 4 (synthesize + map) — the core test; go slow, capture a lot.
4. Phases 5–6 with me, turning intelligence into real roadmap + GTM.
5. When a wave feels solid → promote to demo (one-click PR) and rebuild the
   *keeper* version there.

**Working rhythm (how we stay in sync):** you call out each finding as you hit it
(screen + what happened); I log it to `docs/DOGFOOD-FINDINGS.md`, triage P0/P1/P2,
fix the blocking ones immediately and push to dev, you refresh and we continue.
We don't batch — we knock them out **as they arise**, in playbook order.
