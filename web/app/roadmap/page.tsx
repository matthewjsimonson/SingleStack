import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/Shell";
import { ComingSoon } from "@/components/ui";

export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <Shell email={user?.email} crumbs={[{ label: "Roadmap" }]}>
      <ComingSoon title="Roadmap" blurb="What's planned across modules and features — sequenced by signal-driven priority." />
    </Shell>
  );
}
