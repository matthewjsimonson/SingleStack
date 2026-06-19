import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/Shell";
import ProductFlowView from "@/components/product/ProductFlowView";
import ErrorBoundary from "@/components/ErrorBoundary";

// Product Flow — the product production workflow (Review → Tailor → Assign).
export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <Shell email={user?.email} crumbs={[{ label: "Build" }]}>
      <ErrorBoundary label="The product workflow failed to render. Share the message below and we'll fix it.">
        <ProductFlowView />
      </ErrorBoundary>
    </Shell>
  );
}
