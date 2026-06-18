// Messaging workbench helpers — officer-key resolution + staleness delta math,
// kept out of the component so MessagingView stays about the surface, not the math.
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAgentKey } from "@/lib/strategy";

// The GTM officer that drafts messaging updates: prefer a narrative/revenue
// officer (cco = Chief Creative Officer, cro = Chief Revenue Officer), else fall
// back to any active agent. Returns the agent KEY (what agent-propose wants).
export async function fetchOfficerKey(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase.from("agents").select("key").eq("is_active", true);
  const rows = (data ?? []) as { key: string }[];
  const preferred = rows.find((a) => a.key === "cco") ?? rows.find((a) => a.key === "cro");
  if (preferred) return preferred.key;
  return fetchAgentKey(supabase); // cpo, else first active
}

// A theme moving in the GTM/living-memory loop.
export type ThemeRow = {
  id: string;
  title: string;
  summary: string | null;
  recommendation: string | null;
  conf_level: number | null;
  category: string | null;
  state: string | null;
  last_evidence_at: string | null;
  signal_ids: string[] | null;
};

// A shipped release.
export type ReleaseRow = {
  id: string;
  name: string;
  version: string | null;
  summary: string | null;
  stage: string | null;
  target_date: string | null;
  product_id: string | null;
};

// The actionable delta for ONE framework element: how much has moved since it was
// last updated. Reflect this — don't regenerate the whole field.
export type FieldDelta = {
  themes: ThemeRow[];   // themes with evidence newer than the field's last update
  releases: ReleaseRow[]; // releases shipped after the field's last update
  stale: boolean;
};

// N themes + M releases that moved AFTER `since` (a field's last-updated ISO ts).
// `since` null → everything counts as "moved since" (field never had a revision).
export function deltaSince(since: string | null, themes: ThemeRow[], releases: ReleaseRow[]): FieldDelta {
  const after = (ts: string | null | undefined): boolean => {
    if (!ts) return false;            // no timestamp on the moving thing → can't claim it moved
    if (!since) return true;          // field never updated → everything is newer
    return new Date(ts).getTime() > new Date(since).getTime();
  };
  const movedThemes = themes.filter((t) => after(t.last_evidence_at));
  const movedReleases = releases.filter((r) => after(r.target_date));
  return { themes: movedThemes, releases: movedReleases, stale: movedThemes.length + movedReleases.length > 0 };
}

// Human-readable "this element is stale — N themes + M releases moved" line.
export function deltaLine(d: FieldDelta): string {
  const n = d.themes.length, m = d.releases.length;
  if (n + m === 0) return "Current — nothing has moved since it was last updated.";
  const parts: string[] = [];
  if (n) parts.push(`${n} theme${n === 1 ? "" : "s"}`);
  if (m) parts.push(`${m} release${m === 1 ? "" : "s"}`);
  return `Stale — ${parts.join(" + ")} moved since it was last updated.`;
}

// Build the focused instruction for agent-propose: name the ONE field, give the
// delta as grounding, ask for a SINGLE update against the existing value. The
// edge function injects this into the officer's prompt.
export function buildInstruction(opts: {
  fieldKey: string;
  label: string;
  currentValue: string | null;
  delta: FieldDelta;
}): string {
  const { fieldKey, label, currentValue, delta } = opts;
  const themeLines = delta.themes.slice(0, 6).map((t) =>
    `- THEME "${t.title}"${t.recommendation ? ` → ${t.recommendation}` : t.summary ? ` — ${t.summary}` : ""}`).join("\n");
  const releaseLines = delta.releases.slice(0, 6).map((r) =>
    `- SHIPPED ${r.version ? `${r.version} ` : ""}${r.name}${r.summary ? ` — ${r.summary}` : ""}`).join("\n");
  return [
    `Update EXACTLY ONE messaging element on this GTM record: the field "${label}" (field_key: ${fieldKey}).`,
    `Propose a single update_field change for that record_field against its EXISTING value — refine it to reflect what has moved, do NOT regenerate from scratch and do NOT touch any other field.`,
    ``,
    `CURRENT VALUE:\n${currentValue && currentValue.trim() ? currentValue : "(empty)"}`,
    ``,
    `WHAT HAS MOVED SINCE THIS ELEMENT WAS LAST UPDATED:`,
    themeLines || "- (no new themes)",
    releaseLines || "- (no new releases)",
    ``,
    `Keep the voice and structure of the current value; fold in only the delta that genuinely changes the message. Return one update_field change for this field.`,
  ].join("\n");
}

// A compact human-readable brief of what has moved for ONE element — the
// themes/releases driving its delta, fed to the chat/sidebar agents as grounding.
export function briefText(d: FieldDelta): string {
  const themeLines = d.themes.slice(0, 6).map((t) =>
    `- THEME "${t.title}"${t.recommendation ? ` → ${t.recommendation}` : t.summary ? ` — ${t.summary}` : ""}`);
  const releaseLines = d.releases.slice(0, 6).map((r) =>
    `- SHIPPED ${r.version ? `${r.version} ` : ""}${r.name}${r.summary ? ` — ${r.summary}` : ""}`);
  const lines = [...themeLines, ...releaseLines];
  return lines.length ? lines.join("\n") : "Nothing has moved since this element was last updated.";
}

// Fmt a timestamp for a monospace Source chip ("Jun 12" / "Jun 12 '25").
export function fmtWhen(ts: string | null | undefined): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const base = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return sameYear ? base : `${base} '${String(d.getFullYear()).slice(2)}`;
}
