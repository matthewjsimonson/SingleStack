// GTM record detail. Thin server wrapper; GtmView fetches client-side
// (session-carrying) so RLS reliably returns the org's data.
import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/Shell";
import GtmView from "./GtmView";

export default async function GtmPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <Shell email={user?.email} active="records">
      <GtmView gtmId={id} />
    </Shell>
  );
}
