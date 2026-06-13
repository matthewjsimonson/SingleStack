// The REAL stages each agent passes through. Not decoration — these mirror what
// the edge function actually does, so showing them is honest. Used by
// AgentProgress to make AI moments feel alive without any backend change.

export const AGENT_STAGES: Record<string, string[]> = {
  // setup-competitive · competitors (live web search — the long one)
  setupComps: [
    "Reading your full picture",
    "Searching the live landscape",
    "Assessing buyer & industry overlap",
    "Checking capability collisions",
    "Scoring honest match levels",
  ],
  // setup-records · draft both records
  draftRecords: [
    "Reading your materials",
    "Folding in the interview",
    "Drafting the product record",
    "Drafting the GTM record",
    "Leaving honest gaps empty",
  ],
  // connector-runner · one pull, the pipeline made visible
  pullSource: [
    "Fetching the source",
    "Screening for prompt injection",
    "Distilling into candidate signals",
    "Gating on relevance & budget",
    "Landing tagged signals",
  ],
  // setup-competitive · interview turn
  setupAsk: [
    "Reading everything you've given it",
    "Spotting the most decisive gap",
    "Re-grading search readiness",
  ],
  // setup-competitive · paint the picture
  setupPicture: [
    "Folding records and answers together",
    "Writing the full picture",
    "Distilling the profile fields",
    "Queueing record updates for review",
  ],
  // setup-competitive · capabilities
  setupCaps: [
    "Reading your category and confirmed rivals",
    "Checking how the category is actually graded (G2 / analyst areas)",
    "Selecting standard, cross-vendor capability areas",
    "Trimming to a usable matrix",
  ],
  // agent-propose (an officer reviews a record and drafts a change)
  propose: [
    "Reading the record",
    "Recalling its skills & connected areas",
    "Reviewing the signals",
    "Drafting a proposal",
  ],
  // synthesize-signals (reconciliation engine)
  synthesize: [
    "Reading your signals",
    "Recalling what you've taught it",
    "Finding the patterns",
    "Reconciling against existing themes",
    "Scoring honest confidence",
  ],
  // draft-how (build architect)
  draftHow: [
    "Reading the build item",
    "Pulling the product's technical foundation",
    "Checking what's buildable now",
    "Drafting the approach",
  ],
  // draft-decision
  draftDecision: [
    "Reading the theme",
    "Gathering the evidence",
    "Framing the question",
    "Weighing the options",
  ],
  // distill-lessons
  distill: [
    "Reading your feedback",
    "Finding the patterns in your judgments",
    "Consolidating the lessons",
  ],
  // propose-dimensions
  dimensions: [
    "Reading the themes",
    "Reading your objectives",
    "Suggesting where each belongs",
  ],
};
