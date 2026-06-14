"use client";

// AI & token management (F1: visibility). Reads the unified ai_usage ledger + the
// existing agent_runs cost rows and shows spend by task and by model, so customers
// can SEE where tokens go before tuning the levers (F2: the cost dial). Read-only.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Section } from "@/components/ui";
import { TASK_LABEL as POLICY_TASK_LABEL } from "@/lib/aiPolicy";

type Row = { task: string; model: string | null; input_tokens: number | null; output_tokens: number | null; cost_usd: number | null };
type Agg = { calls: number; cost: number; tokens: number };

const usd = (n: number) => `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`;
const toks = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n));
// One label source (web/lib/aiPolicy) + the agent_runs merge bucket.
const TASK_LABEL: Record<string, string> = { ...POLICY_TASK_LABEL, "agent run": "Agent runs" };

export default function TokenUsage() {
  const supabase = createClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [{ data: u }, { data: r }] = await Promise.all([
      supabase.from("ai_usage").select("task, model, input_tokens, output_tokens, cost_usd").order("created_at", { ascending: false }).limit(1000),
      supabase.from("agent_runs").select("model, input_tokens, output_tokens, cost_usd").not("cost_usd", "is", null).order("created_at", { ascending: false }).limit(1000),
    ]);
    const merged: Row[] = [
      ...((u ?? []) as Row[]),
      ...((r ?? []) as { model: string | null; input_tokens: number | null; output_tokens: number | null; cost_usd: number | null }[]).map((x) => ({ ...x, task: "agent run" })),
    ];
    setRows(merged); setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const totalCost = rows.reduce((s, r) => s + (r.cost_usd ?? 0), 0);
  const totalTok = rows.reduce((s, r) => s + (r.input_tokens ?? 0) + (r.output_tokens ?? 0), 0);
  const group = (key: (r: Row) => string) => {
    const m = new Map<string, Agg>();
    for (const r of rows) {
      const k = key(r) || "—";
      const e = m.get(k) ?? { calls: 0, cost: 0, tokens: 0 };
      e.calls++; e.cost += r.cost_usd ?? 0; e.tokens += (r.input_tokens ?? 0) + (r.output_tokens ?? 0);
      m.set(k, e);
    }
    return [...m.entries()].sort((a, b) => b[1].cost - a[1].cost);
  };
  const byTask = group((r) => TASK_LABEL[r.task] ?? r.task);
  const byModel = group((r) => r.model ?? "—");

  const Table = ({ title, data }: { title: string; data: [string, Agg][] }) => (
    <div className="card card-pad" style={{ flex: "1 1 280px" }}>
      <div className="t-label" style={{ color: "var(--tm)", marginBottom: 8 }}>{title}</div>
      {data.length === 0 ? <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No usage yet.</div> : (
        <div className="stack-2">
          {data.map(([k, a]) => (
            <div key={k} className="row-between" style={{ alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k}</span>
              <span className="t-mono-xs t-muted" style={{ flexShrink: 0 }}>{a.calls} call{a.calls === 1 ? "" : "s"} · {toks(a.tokens)} tok · <strong style={{ color: "var(--tp)" }}>{usd(a.cost)}</strong></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <Section label="AI & token management">
      <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>Where your AI spend goes, across every task and model — the ground truth the dial above re-prices when you change a preset.</div>
      {loading ? <div className="t-sub t-muted">Loading…</div> : (
        <>
          <div className="row gap-2" style={{ marginBottom: "var(--sp-3)", flexWrap: "wrap" }}>
            <div className="card card-pad" style={{ flex: "1 1 160px" }}><div className="t-label" style={{ color: "var(--tm)" }}>Total spend</div><div style={{ fontSize: 20, fontWeight: 720 }}>{usd(totalCost)}</div></div>
            <div className="card card-pad" style={{ flex: "1 1 160px" }}><div className="t-label" style={{ color: "var(--tm)" }}>Tokens</div><div style={{ fontSize: 20, fontWeight: 720 }}>{toks(totalTok)}</div></div>
            <div className="card card-pad" style={{ flex: "1 1 160px" }}><div className="t-label" style={{ color: "var(--tm)" }}>AI calls</div><div style={{ fontSize: 20, fontWeight: 720 }}>{rows.length}</div></div>
          </div>
          <div className="row gap-2" style={{ flexWrap: "wrap", alignItems: "stretch" }}>
            <Table title="By task" data={byTask} />
            <Table title="By model" data={byModel} />
          </div>
        </>
      )}
    </Section>
  );
}
