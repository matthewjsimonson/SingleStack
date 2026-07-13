// ============================================================================
// Profile freshness — is the signals profile stale vs the records it was built
// from? The profile's nodes/weights are derived from the product & GTM records;
// when those records change, search stays aimed at an old picture until the
// profile is refreshed. There is no updated_at on the record tables, but every
// field value change writes a field_revisions row — so the last record change
// is max(field_revisions.created_at), compared against signal_profiles.updated_at
// (stamped on every profile Save). Live-computed, mirroring update_alerts.
// ============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";

export async function recordsChangedSince(
  supabase: SupabaseClient,
  profileUpdatedAt: string | null,
): Promise<{ changed: boolean; lastChange: string | null }> {
  const { data } = await supabase
    .from("field_revisions")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastChange = (data?.created_at as string | undefined) ?? null;
  if (!lastChange) return { changed: false, lastChange: null };
  if (!profileUpdatedAt) return { changed: true, lastChange };
  return { changed: new Date(lastChange).getTime() > new Date(profileUpdatedAt).getTime(), lastChange };
}

// Relative "3 days ago"-style age, for the banner copy.
export function since(iso: string | null): string {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
