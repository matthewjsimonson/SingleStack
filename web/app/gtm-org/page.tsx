import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/Shell";
import SellDesk from "@/components/SellDesk";

// GTM Org — the field-facing consumption hub (renamed from "Desk"). Not a producer:
// it RECEIVES what Pre-work, Content, and Competitive push to the field
// (published battlecards at audience='field', the messaging one-pager, talk tracks,
// finished assets), role-filtered for Sales / Solutions / BDR / CS / Exec.
export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <Shell email={user?.email} crumbs={[{ label: "GTM Org" }]}>
      <SellDesk />
    </Shell>
  );
}
