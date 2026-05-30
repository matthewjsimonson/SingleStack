import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/Shell";
import InitiativeBoard from "@/components/InitiativeBoard";

export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <Shell email={user?.email} crumbs={[{ label: "Content" }]}>
      <InitiativeBoard lane="content" title="Content" meta="Campaign and messaging content, tied to GTM records and driven by GTM signals." recordType="gtm" />
    </Shell>
  );
}
