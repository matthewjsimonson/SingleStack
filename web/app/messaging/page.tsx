import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/Shell";
import MessagingView from "@/components/MessagingView";
import ErrorBoundary from "@/components/ErrorBoundary";

// Messaging — the GTM-strategy root, its own feature-rich module (not a tab).
export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <Shell email={user?.email} crumbs={[{ label: "Messaging" }]}>
      <ErrorBoundary label="The Messaging workspace failed to render. Share the message below and we'll fix it.">
        <MessagingView />
      </ErrorBoundary>
    </Shell>
  );
}
