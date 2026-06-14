// ============================================================================
// ai_usage — shared spend accounting for every AI call (F1: visibility).
// The single source of model PRICING (was duplicated across functions) + a
// logUsage() helper that records one ai_usage row per call. Cost includes cached
// reads (cheap) and cache writes (one-time premium). Best-effort: a logging
// failure NEVER breaks the caller's response.
// ============================================================================

// Per-1M-token USD prices. Unknown models → cost left null (still logs tokens).
export const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

// Anthropic cache pricing relative to input: reads ~0.1x, writes ~1.25x.
const CACHE_READ_MULT = 0.1;
const CACHE_WRITE_MULT = 1.25;

type Usage = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | null | undefined;

export function costOf(model: string, u: Usage): number | null {
  const p = PRICING[model];
  if (!p) return null;
  const inT = u?.input_tokens ?? 0, outT = u?.output_tokens ?? 0;
  const cr = u?.cache_read_input_tokens ?? 0, cw = u?.cache_creation_input_tokens ?? 0;
  return (inT * p.input + outT * p.output + cr * p.input * CACHE_READ_MULT + cw * p.input * CACHE_WRITE_MULT) / 1_000_000;
}

// deno-lint-ignore no-explicit-any
export async function logUsage(supabase: any, opts: { task: string; model: string; usage: Usage; agentId?: string | null }): Promise<void> {
  try {
    const { data: org } = await supabase.rpc("current_org_id");
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
