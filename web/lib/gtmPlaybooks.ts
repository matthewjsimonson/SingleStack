// The GTM playbook catalog — the heart of the Tailor step. Each playbook is a
// downstream artifact TYPE (its `key` becomes initiative_workstreams.content_type,
// which is free text) plus an ordered `setup` (the step-by-step a human follows to
// produce it). Areas group playbooks into the four GTM disciplines. `isVideo`
// playbooks carry the Descript `details` shape { hook, script, prompts, descript_steps }.
export type GtmPlaybookArea = "content" | "video" | "enablement" | "competitive";
export type GtmPlaybook = { key: string; area: GtmPlaybookArea; name: string; purpose: string; isVideo?: boolean; setup: string[] };

export const GTM_AREAS: { id: GtmPlaybookArea; label: string }[] = [
  { id: "content", label: "Content" }, { id: "video", label: "Video" },
  { id: "enablement", label: "Enablement" }, { id: "competitive", label: "Competitive" },
];

export const GTM_PLAYBOOKS: GtmPlaybook[] = [
  // CONTENT
  { key: "solution_brief", area: "content", name: "Solution brief", purpose: "A 1–2 page problem→solution→outcome a buyer can act on.", setup: ["Name the buyer/persona and the problem they feel", "Frame the solution from the brief", "Pull 2–3 proof points / outcomes", "Add the CTA and next step", "Tighten to one page"] },
  { key: "blog", area: "content", name: "Blog post", purpose: "An SEO/thought piece that frames the narrative.", setup: ["Pick the angle + target keyword", "Outline the sections", "Draft grounded in the brief", "Add internal links + CTA"] },
  { key: "slide_deck", area: "content", name: "Slide deck", purpose: "A pitch/overview deck sales can present.", setup: ["Set the narrative arc", "Draft the key slides (problem, solution, proof, ask)", "Write speaker talking points", "Add a closing CTA slide"] },
  { key: "white_paper", area: "content", name: "White paper", purpose: "Long-form authority for the considered buyer.", setup: ["State the thesis", "Structure the sections", "Marshal the evidence", "Write the conclusion + CTA"] },
  { key: "case_study", area: "content", name: "Case study", purpose: "Customer proof: challenge → solution → results.", setup: ["Pick the customer + outcome", "Capture the challenge", "Tell the solution story", "Quantify the results", "Pull a quote"] },
  { key: "one_pager", area: "content", name: "One-pager", purpose: "A single-page value summary.", setup: ["Headline the value", "Three proof points", "Note a visual/diagram", "CTA"] },
  // VIDEO
  { key: "short_form_video", area: "video", name: "Short-form video", purpose: "A <60s social clip with a strong hook.", isVideo: true, setup: ["Write the hook (first 3s)", "Script the body", "List the shots/prompts", "Note the Descript steps"] },
  { key: "long_form_video", area: "video", name: "Long-form video", purpose: "A demo/webinar walkthrough.", isVideo: true, setup: ["Outline the segments", "Script each segment", "List shots/prompts", "Note the Descript steps"] },
  { key: "video_ad", area: "video", name: "Video ad", purpose: "A paid spot with offer + CTA.", isVideo: true, setup: ["Hook", "Problem→offer", "CTA", "Shot list"] },
  { key: "thought_leadership_video", area: "video", name: "Thought-leadership video", purpose: "A POV piece from a leader.", isVideo: true, setup: ["Thesis", "Talking points", "Script", "Shot notes"] },
  { key: "product_video", area: "video", name: "Product video", purpose: "A feature walkthrough/demo.", isVideo: true, setup: ["Pick the feature/flow", "Script the walkthrough", "List screen prompts", "Descript steps"] },
  // ENABLEMENT
  { key: "battlecard", area: "enablement", name: "Battlecard", purpose: "Equip reps to win vs a specific rival.", setup: ["Name the competitor", "Why we win (3)", "Traps to set", "Objection responses"] },
  { key: "first_call_deck", area: "enablement", name: "First-call deck", purpose: "The discovery + framing deck for call one.", setup: ["Discovery questions", "The narrative", "The demo flow", "Next-step ask"] },
  { key: "demo_script", area: "enablement", name: "Demo script", purpose: "A repeatable demo with talk track.", setup: ["Set the scenario", "Step the flow", "Write the talk track", "Note the wow moments"] },
  { key: "objection_handling", area: "enablement", name: "Objection handling", purpose: "Top objections + proof-backed responses.", setup: ["List the top objections", "Draft responses", "Attach proof", "Add reframes"] },
  { key: "faq", area: "enablement", name: "FAQ", purpose: "The questions the field keeps getting.", setup: ["Collect the questions", "Draft crisp answers", "Link proof"] },
  // COMPETITIVE
  { key: "comp_battlecard", area: "competitive", name: "Competitive battlecard", purpose: "Win-room card for a named competitor.", setup: ["Competitor + positioning", "Why we win", "Landmines", "Objection handling"] },
  { key: "comparison_page", area: "competitive", name: "Comparison page", purpose: "Us-vs-them, sourced and dated.", setup: ["Pick the axes", "Fill the comparison", "Source every claim", "Add the CTA"] },
  { key: "winloss_talktrack", area: "competitive", name: "Win/loss talk track", purpose: "Talk track from why we win/lose.", setup: ["Pull the win/loss themes", "Draft the talk track", "Attach proof"] },
];

// Maps a content_type value back to its playbook (and thus its area / setup).
export const PLAYBOOK_BY_KEY: Record<string, GtmPlaybook> = Object.fromEntries(GTM_PLAYBOOKS.map((p) => [p.key, p]));

// Resolves an item's area from its content_type; unknown types fall back to "content".
export function areaForContentType(contentType: string | null | undefined): GtmPlaybookArea {
  return (contentType && PLAYBOOK_BY_KEY[contentType]?.area) || "content";
}
