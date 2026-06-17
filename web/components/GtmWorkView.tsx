"use client";

// GTM Work — one surface for the launch-execution boards that used to be three
// separate routes (Content, Campaigns, Enablement). They already share campaign_id /
// initiative_id links, so they're tabs of one job, not three destinations. Part of the
// 22->10 cohesion consolidation (collapse GTM sprawl).
import { useState } from "react";
import ContentView from "@/app/content/ContentView";
import CampaignsView from "@/app/campaigns/CampaignsView";
import EnablementBoard from "@/components/EnablementBoard";

const TABS = [
  { k: "content", label: "Content" },
  { k: "campaigns", label: "Campaigns" },
  { k: "enablement", label: "Enablement" },
] as const;
type Tab = (typeof TABS)[number]["k"];

export default function GtmWorkView() {
  const [tab, setTab] = useState<Tab>("content");
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
      {tab === "content" && <ContentView />}
      {tab === "campaigns" && <CampaignsView />}
      {tab === "enablement" && <EnablementBoard />}
    </div>
  );
}
