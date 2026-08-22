---
name: singlestack-ui
description: Build the frontend and UX for SingleStack — a product-led growth platform where humans and AI agents co-maintain the artifacts of the PLG loop (sense → decide → build → sell → learn), for product managers and GTM alike. Use this skill any time you are writing React or CSS for SingleStack, designing a new module, or making UX decisions about how agents and humans share work. Triggers on requests like "build a screen for X," "design the Y view," "what should this component look like," "style this," or any frontend code generation against the SingleStack schema (Product Records, Modules, Features, GTM Records, Signals, Sources, Agents, Ratifications).
---

# SingleStack UI Skill

This skill governs how SingleStack looks, feels, and behaves. It is opinionated on purpose. The product is a product-led growth platform used by product managers and GTM alike — Build is a first-class module where PMs prototype for real, not a document drafter. The interface is the trust layer between humans and the AI agents acting on their behalf. Get the interface wrong and the agents do not matter.

The non-negotiables come first. Everything else is in service of them.

---

## 1. The Five Non-Negotiables

These are absolute. If a screen violates any of them, it ships broken even if it looks beautiful.

**1.1 Provenance is visible.** Every AI-generated value on the screen — a draft, a claim, a number, a recommendation — has a visible Source chip nearby. If a user cannot trace where a thing came from in under one second, the screen has failed. This is the Sources table doing its job in the UI.

**1.2 Ratification is a moment, not a checkbox.** When a human approves an AI's work, the UI treats it as a meaningful event: a clear "before/after," a visible actor, a timestamp. Approval is field-level by default. Never bury ratification in a settings menu.

**1.3 The user can always interrupt.** Any in-flight agent action exposes a visible Stop control. Users must be able to pause, override, or take the wheel without hunting. Agents are co-workers, not authorities.

**1.4 The agent's reasoning is one gesture away.** If the user wants to know *why* the agent did something, they reach it in a single deliberate gesture — a hover, a click, a keystroke. Never two. Reasoning is summarized, not buried under raw chain-of-thought.

**1.5 Status is always answerable.** "What is happening right now?" must have a visible answer in every state: idle, working, blocked, done, failed. No silent UIs. No mystery spinners. If an agent is thinking, the user sees what it is thinking about.

---

## 2. Mental Model: Intent → Draft → Evidence → Ratify → Memory

Every meaningful interaction in SingleStack moves along this five-step spine. When designing a screen, ask which step the user is in and design for *that step* — not the full lifecycle on one screen.

- **Intent** — user states an outcome (not a click path). Surface: input affordance, signal-triggered concept card, or agent proposal.
- **Draft** — an agent produces a candidate artifact. Surface: visible "draft" state, clearly attributed to an agent by name.
- **Evidence** — the draft carries inline citations to the Sources table. Surface: chunk-level chips, hoverable previews, no "trust me bro."
- **Ratify** — the human approves, edits, or rejects field-by-field. Surface: ratification controls inline, never a wholesale approval modal.
- **Memory** — the approved artifact updates the Product Record hub. Surface: a subtle confirmation, a versioned trail, a quiet update — never a celebration animation for a routine save.

When in doubt about hierarchy on a screen, the active step gets the visual weight.

---

## 3. Aesthetic DNA

SingleStack's visual language sits in the lineage of **Frame.io, Linear, Figma, and Notion's calm-tool school** — not in the lineage of consumer SaaS marketing pages. It is a workbench, not a brochure.

**Read like software, not a deck.** No hero stats over gradient backgrounds. No "transform your workflow" copy. No emoji headers. No marketing photography. The interface earns its weight by helping the user move faster, not by performing energy.

**Calm density over hero gestures.** Information is dense but spaced rationally. White space is structural — it separates objects — not decorative.

**Surfaces, not slabs.** Cards, panels, and rails are the structural unit. They cast subtle shadow or sit on a 1px hairline. They never have heavy rounded corners (≤8px), never have drop shadows that suggest paper, and never have gradient fills as containers.

**Color is rare and load-bearing.** The palette is neutral by default. Color appears only when it carries meaning: an agent's identity color, a state (working/blocked/done), a destructive action. A screen with three colors used purposefully beats a screen with twelve colors used decoratively.

**Typography is the design.** A real sans-serif with strong character (e.g., Söhne, Inter Display, Geist, IBM Plex Sans, GT America, ABC Diatype) for UI; a tabular numeric monospace (e.g., JetBrains Mono, Geist Mono, Berkeley Mono) for data, IDs, timestamps, and code-like values. Body text is set with care: 14–15px UI body, 1.5 line-height, -0.005em tracking, 60–80ch measure for prose.

---

## 4. Anti-Patterns: Things SingleStack Never Does

The fastest way to keep the product on-brand is to refuse the following on sight.

- **No purple-to-pink gradients.** Period. Not on buttons, not on backgrounds, not on hero sections. This is the single clearest "AI slop" tell on the web today.
- **No unchosen type.** Never ship a bare `font-family: system-ui`, Arial, or a framework default as the face. Pick a typeface and own it — the app loads Inter and JetBrains Mono. System fonts belong in the fallback stack after your chosen face, never as the choice.
- **No walls of text.** If a UI surface needs more than ~60 words of body copy, it is the wrong surface. Use progressive disclosure, hover panels, or a side rail.
- **No decorative emoji in UI chrome.** Functional icons only, drawn as inline SVG (the app ships no icon library). Never 🚀 or ✨ in a button label.
- **No marketing copy in the product.** "Unlock your potential," "Supercharge your workflow," etc. Replace with what the surface actually does.
- **No bouncy animations on data.** Numbers do not spring into place. Tables do not fade-slide-rotate. Data appears.
- **No skeleton loaders longer than 400ms without status text.** If something takes longer, the user gets a sentence about what is happening.
- **No modal dialogs for agent reasoning.** Reasoning lives in a side rail, inline panel, or hover card — not a popup that hijacks the screen.
- **No celebration animations for routine work.** Confetti for shipping a campaign is acceptable once a quarter. Confetti for saving a draft is offensive.
- **No "AI" branding on agents.** Agents have names (Creative Officer, etc.) and identity colors. They are co-workers. The brand of "AI" is left at the door.

---

## 5. Design Tokens (Defaults)

These are the starting tokens. Use CSS custom properties; never hardcode. If a screen needs a value outside this scale, that is a signal to revisit.

```css
:root {
  /* Spacing — 4px base, Linear-style modular scale */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;
  --space-8: 64px;

  /* Radii — restrained */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-pill: 999px;

  /* Neutrals — warm graphite, not cold blue-gray */
  --ink-0:  #0B0B0C;   /* near-black, primary text on light */
  --ink-1:  #1C1C1F;
  --ink-2:  #3A3A3F;
  --ink-3:  #6B6B72;   /* secondary text */
  --ink-4:  #9C9CA3;   /* tertiary, placeholders */
  --line-1: #E6E6EA;   /* hairlines */
  --line-2: #F0F0F3;   /* subtle dividers */
  --surface-0: #FFFFFF;
  --surface-1: #FAFAFB;  /* canvas */
  --surface-2: #F4F4F6;  /* recessed wells */

  /* State — load-bearing, never decorative */
  --state-working: #C77A2B;   /* warm amber — agent is acting */
  --state-blocked: #B23A48;   /* clay red — needs human */
  --state-done:    #2F7D58;   /* forest green — ratified */
  --state-idle:    var(--ink-3);

  /* Agent identity — assigned per agent, never reused for state */
  --agent-creative: #E2725B;  /* Creative Officer warm coral */
  /* Add more agent colors as agents are added. */

  /* Type */
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
  --text-xs: 12px;
  --text-sm: 13px;
  --text-base: 14px;
  --text-md: 15px;
  --text-lg: 17px;
  --text-xl: 20px;
  --text-2xl: 24px;
  --text-3xl: 32px;

  /* Motion */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --dur-fast: 120ms;
  --dur-base: 200ms;
  --dur-slow: 320ms;
}
```

If a brief calls for dark mode, derive a parallel set; never hardcode `#fff` or `#000` in components.

---

## 6. Motion: Fluid UI Principles

Borrowed from Frame.io's "Fluid UI" school and used with restraint.

- **Instant.** Every user-initiated action shows feedback within 100ms. If the work takes longer, the feedback is a status indicator, not a blank wait.
- **Smooth.** Motion is `ease-out` for entrances, `ease-in-out` for state changes. Never linear. Never bounce except on intentional micro-celebration.
- **Coordinated.** Related elements move together with stagger (40–80ms). Unrelated elements do not move at all.
- **Performance is a feature.** A laggy interaction is a broken interaction. Virtualize long lists. Defer non-critical animation. If a transition cannot hold 60fps on mid-tier hardware, simplify it.

Default durations: 120ms for hover/focus, 200ms for panel transitions, 320ms for screen transitions. Anything longer needs a reason.

---

## 7. Layout: Modular, Not Grid-Locked

Following Linear's pattern, SingleStack does **not** use a rigid 12-column grid in the application UI. Instead:

- **Workbench layout.** Most application screens are: left rail (navigation), main canvas (the artifact), right rail (agent reasoning, sources, ratification trail). The rails are collapsible; the canvas is the star.
- **Cards are the structural unit.** Concept cards, source cards, ratification cards, agent cards. Each card is a self-contained object with its own header, body, and actions.
- **8px spacing scale** as defined in tokens. Stick to it.
- **Density adapts to content type.** Lists and tables get compact density (28–32px row height); editorial canvases get spacious density (1.6 line-height, generous padding).

Marketing pages and landing pages may use a traditional 12-column grid; the product UI does not.

---

## 8. Component Patterns Specific to Agentic UI

These are the patterns that distinguish SingleStack from a generic SaaS app. Every screen will use one or more.

**Source Chip.** A small inline chip showing the origin of a piece of content. Format: `[icon] [Source name] · [timestamp]`. Click → opens the Source detail. Always visible next to any agent-generated value. Tabular monospace for timestamps.

**Agent Badge.** A pill showing which named agent produced or owns a piece of work. Uses the agent's identity color as a 2px left border or a tinted background at 8% opacity. Never uses the color as the chip fill — that would compete with state colors.

**Ratification Control.** Inline next to any field that has an unratified AI-drafted value. Two visible affordances (Approve, Edit) and one revealed-on-hover (Reject with reason). After ratification, the control collapses to a small "ratified by X · 3m ago" line. Field-level. Always.

**Status Pill.** Shows the live state of an agent action. Four states only: `Idle`, `Working`, `Blocked`, `Done`. Uses the state color from tokens. Includes a short status string when working ("Pulling Gong transcripts…"). Never shows a percentage unless the percentage is real.

**Reasoning Rail.** A right-side panel that shows the agent's current thinking in plain prose, not raw chain-of-thought. Summarized, scannable, with the ability to expand to full reasoning. Always reachable, never auto-opens.

**Concept Card.** A card that surfaces a signal as a proposed action. Has three zones — the signal (what triggered it), the proposed concept (what the agent thinks), the human controls (accept, modify, dismiss). Cards stack chronologically; dismissed cards fade but remain reachable.

**Diff Surface.** When an agent edits an existing value, the UI always shows what changed. Inline strikethrough for removed text, inline highlight for added text. Never a wholesale "new version" with no comparison. This is non-negotiable anywhere an agent rewrites a ratified field — Records, Competitive, and Campaigns above all.

**Source-Grounded Drafting.** When an agent drafts content using retrieved sources, each sentence (or claim) carries a small superscript number that links to the source chunk. This is the inline-citation pattern from research tools, applied to product marketing artifacts. Hover reveals the source chunk verbatim.

---

## 9. Module-Specific Notes

The nav groups four areas (see `web/components/Shell.tsx` for the live IA).

**Foundation — Product records (`/products`), GTM records (`/gtm`).** The hub. Records are long-lived and field-ratified, so the diff surface and provenance chips matter more here than anywhere else. Full-width, collapsible sections.

**Intelligence — Signals (`/signals`), Competitive (`/competitive`), Market (`/market`), Technology (`/frontier`).** Evidence-first. Any claim displayed must be sourced and dated; never let an unsourced claim reach a shareable view. Feeds group by directness and carry their node context.

**Product — Strategy (`/strategy`), Roadmap (`/roadmap`), Ship (`/ship`), Build (`/product-flow`).** Build is the differentiator: PMs prototype for real here, so the surface must treat generated artifacts as working things, not documents about things. Task cards click through to their Build Item.

**Go-to-market — GTM (`/gtm-flow`), Campaigns (`/campaigns`), GTM Org (`/gtm-org`).** Card-based and scannable, optimized for someone reading between calls. Avoid long-form prose blocks.

**Numbers, anywhere.** Tabular monospace for all figures. Charts are restrained, axis-labeled, and never rainbow-palette. Sparkline-first; full charts only when zooming in.

---

## 10. Implementation Stack

This is the stack as it actually is. Do not introduce a library from habit — the app deliberately ships almost none.

- **Next.js 15 (App Router) + React 19**, function components and hooks.
- **Styling is a hand-rolled design system in `web/app/globals.css`** — CSS custom properties plus a small component class layer. Compose those classes. There is no Tailwind, no CSS-in-JS, and no ad-hoc inline styles for anything reusable.
- **No component library.** No shadcn/ui, no Radix, no Material. Primitives are written here; if you need one that doesn't exist, add it to the component layer rather than pulling in a dependency.
- **Icons are inline SVG.** No icon package is installed.
- **Motion is CSS transitions.** No Framer Motion.
- **Tables are hand-built.** No TanStack Table.
- **TipTap** for rich-text editing (`@tiptap/react`, `tiptap-markdown`).
- **Supabase** via `@supabase/supabase-js` and `@supabase/ssr` for data and auth.

Adding a dependency is a real decision with a real cost. If a task seems to need one, say so and get agreement before installing it.

---

## 11. Self-Check Before Declaring Done

Before claiming a screen is ready, walk through this list. If any answer is "no" or "I'm not sure," it is not ready.

- Can I identify the source of every AI-generated value on this screen in under one second?
- If an agent is doing work right now, can I see what it is doing and stop it?
- Can I see who is responsible for each piece of content — which agent, which human?
- If I am a salesperson reading this on a laptop between meetings, can I extract what I need in 10 seconds?
- Is there a purple-to-pink gradient anywhere on this screen? (If yes — remove.)
- Is there marketing copy anywhere on this screen? (If yes — replace with what it does.)
- Does any animation last longer than 320ms? (If yes — justify or remove.)
- Could this be mistaken for a generic AI SaaS product? (If yes — push harder on the aesthetic DNA.)

When the answers are all yes / all no in the right direction, ship.

---

## 12. When in Doubt

Defer to: Frame.io, Linear, Figma, Notion (calm-tool school), the Geist design system, and the Radix UI primitives. When something feels wrong but you cannot name why, it is almost always one of:

1. The screen is performing energy instead of doing work.
2. Provenance is missing or buried.
3. The user cannot tell who did what.
4. Motion is overused.
5. The copy is marketing, not product.

Fix the cause, not the symptom.
