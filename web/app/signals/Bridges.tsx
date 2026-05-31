"use client";

// Bridges — cross-lens Product↔GTM patterns, the differentiated insight. A
// bridge links a product theme and a gtm theme into one insight + a two-sided
// move. Confidence is the WEAKER leg (honest by construction). Proposed bridges
// are confirmed/dismissed by a human (graduated HITL); active bridges are the
// marquee briefs. Restrained, house style — this earns prominence by being rare.
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Section, Chip, Banner, Confidence } from "@/components/ui";

type Bridge = {
  bridge_id: string; title: string; insight: string | null; recommendation: string | null; state: string;
  product_theme_id: string; product_theme_title: string; product_conf: number | null;
  gtm_theme_id: string; gtm_theme_title: string; gtm_conf: number | null;
  bridge_conf: number | null;
};

export default function Bridges({ onChange }: { onChange?: () => void }) {
  const supabase = createClient();
  const [bridges, setBridges] = useState<Bridge[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("bridge_strength")
      .select("bridge_id, title, insight, recommendation, state, product_theme_id, product_theme_title, product_conf, gtm_theme_id, gtm_theme_title, gtm_conf, bridge_conf")
      .neq("state", "dismissed");
    // strongest first (by weaker-leg confidence)
    setBridges((data ?? []).sort((a, b) => (b.bridge_conf ?? 0) - (a.bridge_conf ?? 0)));
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  async function find() {
    setFinding(true); setError(null);
    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      const { data, error } = await supabase.functions.invoke("propose-bridges", {
        body: {}, headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not find bridges."); }
    finally { setFinding(false); }
  }

  async function setState(b: Bridge, next: "active" | "dismissed") {
    setBusy(b.bridge_id); setError(null);
    try {
      await supabase.from("bridges").update({ state: next }).eq("id", b.bridge_id);
      await load(); onChange?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update."); }
    finally { setBusy(null); }
  }

  const proposed = bridges.filter((b) => b.state === "proposed");
  const active = bridges.filter((b) => b.state === "active");

  return (
    <div style={{ marginBottom: "var(--sp-6)" }}>
      <Banner>{error}</Banner>
      <Section
        label={`Bridges${active.length ? ` · ${active.length}` : ""}`}
        action={<button className="btn btn-accent btn-sm" disabled={finding} onClick={find}>{finding ? "Finding…" : "✨ Find bridges"}</button>}
      >
        <div className="t-sub t-muted" style={{ marginBottom: "var(--sp-3)" }}>
          Where a product pattern and a go-to-market pattern are one reality. A bridge is only as strong as its weaker side.
        </div>

        {bridges.length === 0 ? (
          <p className="t-muted" style={{ margin: 0 }}>No bridges yet. With product and GTM themes in play, “Find bridges” looks for the cross-lens insight.</p>
        ) : (
          <div className="stack-3">
            {[...proposed, ...active].map((b) => (
              <div key={b.bridge_id} className="card card-pad" style={{ borderLeft: `2px solid var(--vl)` }}>
                <div className="row-between" style={{ alignItems: "baseline", gap: 10 }}>
                  <span style={{ fontSize: 14, fontWeight: 660 }}>{b.title}</span>
                  <div className="row gap-2" style={{ flexShrink: 0 }}>
                    {b.state === "proposed" && <Chip tone="accent">proposed</Chip>}
                    <Confidence level={b.bridge_conf} label={b.bridge_conf != null ? `${Math.round(b.bridge_conf * 100)}%` : null} />
                  </div>
                </div>

                {b.insight && <p className="t-sub" style={{ lineHeight: 1.5, margin: "6px 0 8px" }}>{b.insight}</p>}

                {/* The two legs, with each side's honest confidence. */}
                <div className="row gap-2" style={{ flexWrap: "wrap", marginBottom: b.recommendation ? 8 : 0 }}>
                  <Link href={`/signals/themes/${b.product_theme_id}`} className="chip chip-accent" style={{ textDecoration: "none" }}>
                    Product: {b.product_theme_title} · {b.product_conf != null ? `${Math.round(b.product_conf * 100)}%` : "—"}
                  </Link>
                  <span className="t-muted" style={{ alignSelf: "center" }}>↔</span>
                  <Link href={`/signals/themes/${b.gtm_theme_id}`} className="chip chip-violet" style={{ textDecoration: "none" }}>
                    GTM: {b.gtm_theme_title} · {b.gtm_conf != null ? `${Math.round(b.gtm_conf * 100)}%` : "—"}
                  </Link>
                </div>

                {b.recommendation && (
                  <div style={{ background: "var(--panel-2)", borderRadius: 8, padding: "9px 11px" }}>
                    <div className="t-label" style={{ marginBottom: 3 }}>Two-sided move</div>
                    <div className="t-body" style={{ fontSize: 13, lineHeight: 1.5 }}>{b.recommendation}</div>
                  </div>
                )}

                {b.state === "proposed" && (
                  <div className="row gap-2" style={{ marginTop: 10 }}>
                    <button className="btn btn-sm" disabled={busy === b.bridge_id} onClick={() => setState(b, "active")}>Confirm bridge</button>
                    <button className="btn btn-secondary btn-sm" disabled={busy === b.bridge_id} onClick={() => setState(b, "dismissed")}>Dismiss</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
