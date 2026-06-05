// AUTO-GENERATED from web/skills/**/SKILL.md by scripts/build-skills.mjs — do not edit by hand.
export type SkillDef = { key: string; name: string; description: string; category: string; instructions: string; agents: string[] };
export const SKILL_DEFS: SkillDef[] = [
  {
    "key": "demo_architecture_review",
    "name": "Architecture review",
    "description": "Keep technical claims precise and buildable.",
    "category": "general",
    "instructions": "Review technical fields for accuracy and feasibility. Flag risk, keep stack/integration detail precise, and separate what's buildable now from later. Watch frontier-model capabilities for what's newly possible.",
    "agents": [
      "ceng"
    ]
  },
  {
    "key": "demo_competitive_battlecard",
    "name": "Competitive battlecard",
    "description": "Equip GTM to win against alternatives.",
    "category": "gtm",
    "instructions": "Frame the win against named competitors (Productboard, Crayon, Klue, Aha!, Gong): where we're clearly better, where to reframe, and the proof. Ground in competitive and market signals; keep it honest and specific.",
    "agents": [
      "cro"
    ]
  },
  {
    "key": "demo_narrative_voice",
    "name": "Narrative & brand voice",
    "description": "Keep the story consistent and compelling.",
    "category": "gtm",
    "instructions": "Keep the narrative consistent across records: confident, concrete, human-in-the-loop. Avoid AI hype; emphasize control and living truth.",
    "agents": [
      "cco"
    ]
  },
  {
    "key": "demo_persona_messaging",
    "name": "Persona messaging",
    "description": "Tune messaging to each buyer.",
    "category": "gtm",
    "instructions": "Match the message to the persona. Lead with the outcome they care about, address their top objection, and use language pulled from real signals.",
    "agents": [
      "cro"
    ]
  },
  {
    "key": "demo_positioning_sharpening",
    "name": "Positioning sharpening",
    "description": "Tighten how the product is positioned against alternatives.",
    "category": "product",
    "instructions": "Sharpen positioning to be specific and defensible. Lead with the category we're reframing, name the alternative we are NOT (roadmapping tools, CI feeds, call analytics), and ground every claim in a signal. Avoid hype; prefer concrete proof.",
    "agents": [
      "cpo"
    ]
  },
  {
    "key": "demo_roadmap_prioritization",
    "name": "Roadmap prioritization",
    "description": "Decide what to build next from evidence.",
    "category": "product",
    "instructions": "Prioritize by corroborated demand (escalating themes), strategic fit, and buildability. Recommend the smallest change that moves the metric; cite the signals behind it.",
    "agents": [
      "cpo"
    ]
  }
];
