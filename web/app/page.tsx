// Home: the org's records, with in-app creation. Server component loads the
// initial list (RLS-scoped); the client component handles create + navigation.
import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/Shell";
import RecordsView from "./RecordsView";

export default async function HomePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: records } = await supabase
    .from("product_records")
    .select("id, name, created_at")
    .order("created_at", { ascending: false });

  return (
    <Shell email={user?.email} active="records">
      <RecordsView initial={records ?? []} />
    </Shell>
  );
}
