"use client";

// Product Flow — the product PRODUCTION workflow as one surface with three
// ordered steps, the product-side mirror of GtmFlowView:
//   Review → mold a product signal-theme into a SPEC/PRD, grounded in the product
//            record (what it is + its technical constraints).
//   Tailor → take a spec and produce downstream BUILD work via PLAYBOOKS
//            (spec-driven / prototype / technical / validation).
//   Assign → route produced build work to a RELEASE to ship.
import { useState } from "react";
import { SubTabs } from "@/components/ui";
import ProductReviewView from "@/components/product/ProductReviewView";
import ProductTailorBoard from "@/components/product/ProductTailorBoard";
import ProductAssignBoard from "@/components/product/ProductAssignBoard";

type Step = "review" | "tailor" | "assign";

const STEPS: { key: Step; label: string }[] = [
  { key: "review", label: "Review" },
  { key: "tailor", label: "Tailor" },
  { key: "assign", label: "Assign" },
];

const INTRO: Record<Step, string> = {
  review: "Review the spec — mold a product theme into a spec/PRD, grounded in what the product is and its technical constraints.",
  tailor: "Tailor a spec into build work — pick a playbook per area (spec-driven, prototype, technical, validation) and produce the artifact.",
  assign: "Assign produced build work to a release — upcoming (planned / in dev) or shipped.",
};

export default function ProductFlowView() {
  const [step, setStep] = useState<Step>("review");
  return (
    <div>
      <SubTabs tabs={STEPS} active={step} onChange={setStep} />
      <div className="t-sub t-muted" style={{ marginBottom: "var(--sp-4)", fontSize: 12.5 }}>{INTRO[step]}</div>
      {step === "review" && <ProductReviewView />}
      {step === "tailor" && <ProductTailorBoard />}
      {step === "assign" && <ProductAssignBoard />}
    </div>
  );
}
