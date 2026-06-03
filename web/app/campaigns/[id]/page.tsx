import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/Shell";
import CampaignDetail from "./CampaignDetail";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <Shell email={user?.email} crumbs={[{ label: "Campaigns", href: "/campaigns" }, { label: "Campaign" }]}>
      <CampaignDetail id={id} />
    </Shell>
  );
}
