"use client";

// GTM Work — one surface for the launch-execution job. Top IA:
//   Pre-work   — the strategy ROOT before you ship: Messaging (framework) and
//                Enablement (what reps need). A sub-toggle between the two.
//   Content    — the content board (drafting/video split is a later phase).
//   Campaigns  — the campaign board.
// Part of the 22->10 cohesion consolidation (collapse GTM sprawl): these used to
// be separate routes; they share campaign_id / initiative_id links, so they're
// tabs of one job, not three destinations.
import { useState } from "react";
import ContentView from "@/app/content/ContentView";
import CampaignsView from "@/app/campaigns/CampaignsView";
import EnablementBoard from "@/components/EnablementBoard";
import MessagingView from "@/components/MessagingView";

const TABS = [
  { k: "prework", label: "Pre-work" },
  { k: "content", label: "Content" },
  { k: "campaigns", label: "Campaigns" },
] as const;
type Tab = (typeof TABS)[number]["k"];

const PRE = [
  { k: "messaging", label: "Messaging" },
  { k: "enablement", label: "Enablement" },
] as const;
type Pre = (typeof PRE)[number]["k"];

export default function GtmWorkView() {
  const [tab, setTab] = useState<Tab>("prework");
  const [pre, setPre] = useState<Pre>("messaging");
  return (
    <div>
      <div className="row gap-2" style={{ marginBottom: 16, borderBottom: "1px solid var(--border)" }}>
        {TABS.map((t) => {
          const on = tab === t.k;
          return (
            <button key={t.k} onClick={() => setTab(t.k)} className="btn btn-sm"
              style={{ background: "transparent", color: on ? "var(--ac-text)" : "var(--tp)", border: "none", borderRadius: 0, borderBottom: on ? "2px solid var(--ac-text)" : "2px solid transparent", fontWeight: on ? 700 : 540, marginBottom: -1 }}>
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "prework" && (
        <>
          <div className="row gap-2" style={{ marginBottom: 16 }}>
            {PRE.map((p) => {
              const on = pre === p.k;
              return (
                <button key={p.k} onClick={() => setPre(p.k)} className="btn btn-sm"
                  style={{ background: on ? "var(--fill)" : "transparent", color: on ? "var(--tp)" : "var(--ts)", border: "1px solid var(--border)", fontWeight: on ? 660 : 540 }}>
                  {p.label}
                </button>
              );
            })}
          </div>
          {pre === "messaging" && <MessagingView />}
          {pre === "enablement" && <EnablementBoard />}
        </>
      )}
      {tab === "content" && <ContentView />}
      {tab === "campaigns" && <CampaignsView />}
    </div>
  );
}
