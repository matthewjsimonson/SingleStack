// ============================================================================
// ai_usage — shared spend accounting for every AI call (F1: visibility).
// The single source of model PRICING (was duplicated across functions) + a
// logUsage() helper that records one ai_usage row per call. Cost includes cached
// reads (cheap) and cache writes (one-time premium). Best-effort: a logging
// failure NEVER breaks the caller's response.
// ============================================================================

// Per-1M-token USD prices. Unknown models → cost left null (still logs tokens).
export const PRICING: Record<string, { input: number; output: number }> = {
  // current
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  // superseded — kept so historical ai_usage rows still cost out correctly
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
};

// Anthropic cache pricing relative to input: reads ~0.1x, writes ~1.25x.
const CACHE_READ_MULT = 0.1;
const CACHE_WRITE_MULT = 1.25;

// The SDK reports absent cache counters as null, not undefined — accept both,
// or every logUsage() call site fails to typecheck against a real Message.
type Usage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
} | null | undefined;

/**
 * Running totals for a call that spans several model requests (a tool loop).
 *
 * Loops used to accumulate input/output only and drop the cache counters at the
 * source, which made a cached read bill as a full-price input token and left
 * cache hit rate unmeasurable on exactly the runs where caching matters most.
 * Carry all four, and costOf() prices them correctly.
 */
export type UsageTotals = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
};

export const emptyUsage = (): UsageTotals => ({
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
});

/** Fold one response's usage into the running total. Absent counters read as 0. */
export function addUsage(acc: UsageTotals, u: Usage): UsageTotals {
  return {
    input_tokens: acc.input_tokens + (u?.input_tokens ?? 0),
    output_tokens: acc.output_tokens + (u?.output_tokens ?? 0),
    cache_read_input_tokens: acc.cache_read_input_tokens + (u?.cache_read_input_tokens ?? 0),
    cache_creation_input_tokens: acc.cache_creation_input_tokens + (u?.cache_creation_input_tokens ?? 0),
  };
}

/**
 * The ONLY place model cost arithmetic lives. Seven functions used to import
 * PRICING and rewrite this expression by hand, all of them omitting the cache
 * terms — see ai_usage.test.ts, whose drift guard fails if that comes back.
 */
export function costOf(model: string, u: Usage): number | null {
  const p = PRICING[model];
  if (!p) return null;
  const inT = u?.input_tokens ?? 0, outT = u?.output_tokens ?? 0;
  const cr = u?.cache_read_input_tokens ?? 0, cw = u?.cache_creation_input_tokens ?? 0;
  return (inT * p.input + outT * p.output + cr * p.input * CACHE_READ_MULT + cw * p.input * CACHE_WRITE_MULT) / 1_000_000;
}

/**
 * Record one call in the spend ledger. Best-effort — never breaks the response.
 *
 * `orgId` is not optional in spirit, only in signature. current_org_id() resolves
 * from memberships via auth.uid(), so it returns NULL for a service-role bearer:
 * every machine-invoked call (the heartbeat's connector pulls, outcome-watch)
 * silently logged nothing, which is precisely the unattended population whose
 * spend most needs watching. Pass the org explicitly wherever it is known.
 */
// deno-lint-ignore no-explicit-any
export async function logUsage(supabase: any, opts: { task: string; model: string; usage: Usage; agentId?: string | null; orgId?: string | null }): Promise<void> {
  try {
    let org = opts.orgId ?? null;
    if (!org) {
      const { data } = await supabase.rpc("current_org_id");
      org = data ?? null;
    }
    if (!org) return;
    const u = opts.usage ?? {};
    await supabase.from("ai_usage").insert({
      org_id: org,
      task: opts.task,
      agent_id: opts.agentId ?? null,
      model: opts.model,
      input_tokens: u.input_tokens ?? 0,
      output_tokens: u.output_tokens ?? 0,
      cache_read_tokens: u.cache_read_input_tokens ?? 0,
      cache_write_tokens: u.cache_creation_input_tokens ?? 0,
      cost_usd: costOf(opts.model, u),
    });
  } catch (_) {
    // Never break the response on a logging failure.
  }
}
