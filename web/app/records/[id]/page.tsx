// Record detail. Thin server wrapper — it only resolves the id and the user's
// email for the shell; RecordView fetches the record/fields/agents/proposals
// client-side (session-carrying) so RLS reliably returns the org's data.
import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/Shell";
import RecordView from "./RecordView";

export default async function RecordPage({
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
    <Shell email={user?.email} crumbs={[{ label: "Foundation", href: "/" }, { label: "Product records", href: "/products" }]}>
      <RecordView recordId={id} />
    </Shell>
  );
}
