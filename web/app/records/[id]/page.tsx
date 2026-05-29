// Record detail: the record's fields, agents you can run against it, and the
// proposals agents have written (with Accept). Server component loads the data
// (RLS-scoped); the client component <RecordView> handles run/accept actions.
import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/Shell";
import RecordView from "./RecordView";

export default async function RecordPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: record }, { data: fields }, { data: agents }, { data: proposals }] =
    await Promise.all([
      supabase.from("product_records").select("id, name").eq("id", id).maybeSingle(),
      supabase
        .from("record_fields")
        .select("id, field_key, label, value, position")
        .eq("product_id", id)
        .order("position"),
      supabase.from("agents").select("id, key, name, role").eq("is_active", true).order("name"),
      supabase
        .from("proposals")
        .select("id, title, rationale, conf_label, conf_level, proposed_by, status, created_at")
        .eq("product_id", id)
        .order("created_at", { ascending: false }),
    ]);

  return (
    <Shell email={user?.email}>
      {!record ? (
        <div className="card" style={{ padding: 24 }}>Record not found.</div>
      ) : (
        <RecordView
          record={record}
          fields={fields ?? []}
          agents={agents ?? []}
          proposals={proposals ?? []}
        />
      )}
    </Shell>
  );
}
