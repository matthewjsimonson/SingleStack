// The REAL stages each agent passes through. Not decoration — these mirror what
// the edge function actually does, so showing them is honest. Used by
// AgentProgress to make AI moments feel alive without any backend change.

export const AGENT_STAGES: Record<string, string[]> = {
  // synthesize-signals (reconciliation engine)
  synthesize: [
    "Reading your signals",
    "Recalling what you've taught it",
    "Finding the patterns",
    "Reconciling against existing themes",
    "Scoring honest confidence",
  ],
  // propose-bridges
  bridges: [
    "Reading product themes",
    "Reading go-to-market themes",
    "Looking for where two fronts are one",
    "Weighing each side's evidence",
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
