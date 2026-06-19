"use client";

// GTM Flow — the go-to-market PRODUCTION workflow as one surface with three
// ordered steps:
//   Review → the messaging brief (reuses the Messaging module as-is).
//   Tailor → take a brief and produce downstream GTM items via PLAYBOOKS.
//   Assign → route produced items to campaigns (external pipeline / internal org).
// Messaging and Content fold INTO Review and Tailor; this is the home for both.
import { useState } from "react";
import { SubTabs } from "@/components/ui";
import MessagingView from "@/components/MessagingView";
import TailorBoard from "@/components/gtm/TailorBoard";
import AssignBoard from "@/components/gtm/AssignBoard";

type Step = "review" | "tailor" | "assign";

const STEPS: { key: Step; label: string }[] = [
  { key: "review", label: "Review" },
  { key: "tailor", label: "Tailor" },
  { key: "assign", label: "Assign" },
];

const INTRO: Record<Step, string> = {
  review: "Review the messaging brief — the seed every downstream GTM item is grounded in.",
  tailor: "Tailor a brief into downstream items — pick a playbook per area and produce the artifact.",
  assign: "Assign produced items to campaigns — external pipeline pushes or internal GTM-org work.",
};

export default function GtmFlowView() {
  const [step, setStep] = useState<Step>("review");
  return (
    <div>
      <SubTabs tabs={STEPS} active={step} onChange={setStep} />
      <div className="t-sub t-muted" style={{ marginBottom: "var(--sp-4)", fontSize: 12.5 }}>{INTRO[step]}</div>
      {step === "review" && <MessagingView />}
      {step === "tailor" && <TailorBoard />}
      {step === "assign" && <AssignBoard />}
    </div>
  );
}
