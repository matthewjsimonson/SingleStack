"use client";

// GTM strategy — the go-to-market equivalent of the product strategy board.
// GTM signals merge into themes, bucketed into campaign/content/messaging plays.
import ThemesTab from "@/components/strategy/ThemesTab";

export default function GtmStrategyView() {
  return (
    <div>
      <div style={{ marginBottom: "var(--sp-3)" }}>
        <h1 className="t-page">GTM strategy</h1>
        <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>GTM signals merge into themes, auto-bucketed into campaign, content, and messaging plays — the go-to-market mirror of the product strategy board. Watch the ones that matter; they become the brief for <strong>Content</strong> &amp; <strong>Campaigns</strong>.</div>
      </div>
      <ThemesTab lens="gtm" />
    </div>
  );
}
