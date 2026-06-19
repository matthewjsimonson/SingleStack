import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/Shell";
import ErrorBoundary from "@/components/ErrorBoundary";
import SignalsView from "./SignalsView";

export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <Shell email={user?.email} crumbs={[{ label: "Signals" }]}>
      <ErrorBoundary label="Signals failed to render. Share the message below and we'll fix it.">
        <SignalsView />
      </ErrorBoundary>
    </Shell>
  );
}
