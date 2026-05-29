import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/Shell";
import { ComingSoon } from "@/components/ui";

export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <Shell email={user?.email} crumbs={[{ label: "Content" }]}>
      <ComingSoon title="Content" blurb="Campaign and messaging content generated from the GTM records, kept in sync with the Foundation." />
    </Shell>
  );
}
