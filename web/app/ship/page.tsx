import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/Shell";
import WorkstreamBoard from "@/components/WorkstreamBoard";

export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <Shell email={user?.email} crumbs={[{ label: "Ship" }]}>
      <WorkstreamBoard area="build" title="Ship" meta="Build execution — the product workstreams of your initiatives. Each task ladders up to its initiative (the cross-functional motion)." />
    </Shell>
  );
}
