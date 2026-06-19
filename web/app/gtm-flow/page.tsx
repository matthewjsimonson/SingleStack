import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/Shell";
import GtmFlowView from "@/components/gtm/GtmFlowView";
import ErrorBoundary from "@/components/ErrorBoundary";

// GTM Flow — the go-to-market production workflow (Review → Tailor → Assign).
export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <Shell email={user?.email} crumbs={[{ label: "Workflow" }]}>
      <ErrorBoundary label="The GTM workflow failed to render. Share the message below and we'll fix it.">
        <GtmFlowView />
      </ErrorBoundary>
    </Shell>
  );
}
