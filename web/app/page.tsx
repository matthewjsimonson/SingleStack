// Home: records (products + GTM), with in-app creation of either type.
import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/Shell";
import RecordsView from "./RecordsView";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <Shell email={user?.email} active="records">
      <RecordsView />
    </Shell>
  );
}
