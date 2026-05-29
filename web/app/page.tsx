// Foundation — the landing/overview. The big-picture view of the whole model.
import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/Shell";
import FoundationView from "./FoundationView";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <Shell email={user?.email} crumbs={[{ label: "Overview" }]}>
      <FoundationView />
    </Shell>
  );
}
