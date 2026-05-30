import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/Shell";
import InitiativeBoard from "@/components/InitiativeBoard";

export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <Shell email={user?.email} crumbs={[{ label: "Roadmap" }]}>
      <InitiativeBoard lane="roadmap" title="Roadmap" meta="What's planned across modules and features, driven by product signals." recordType="product" />
    </Shell>
  );
}
