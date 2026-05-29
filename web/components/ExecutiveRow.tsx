"use client";

// The executive agent row in the command center. Shows the team as dynamic
// cards (hover to pop, click to open the drawer). If the org hasn't created the
// executive agents yet, offers a one-click setup that inserts them (RLS-scoped).
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { EXECUTIVE_TEAM, type Exec } from "@/lib/team";
import { Section } from "@/components/ui";
import AgentDrawer from "@/components/AgentDrawer";

export default function ExecutiveRow() {
  const supabase = createClient();
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [settingUp, setSettingUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openExec, setOpenExec] = useState<Exec | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from("agents").select("key").eq("is_active", true);
    setExisting(new Set((data ?? []).map((a) => a.key)));
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const haveAny = EXECUTIVE_TEAM.some((e) => existing.has(e.key));

  async function setupTeam() {
    setSettingUp(true); setError(null);
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization.");
      const rows = EXECUTIVE_TEAM.filter((e) => !existing.has(e.key)).map((e) => ({
        org_id: orgId, key: e.key, name: e.name, role: e.role, model: "claude-opus-4-8", system_prompt: e.system_prompt, is_active: true,
      }));
      if (rows.length) {
        const { error } = await supabase.from("agents").insert(rows);
        if (error) throw error;
      }
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not set up team."); }
    finally { setSettingUp(false); }
  }

  function openAgent(exec: Exec) {
    if (!existing.has(exec.key)) return; // only open if the agent exists
    setOpenExec(exec); setDrawerOpen(true);
  }

  return (
    <Section label="Your executive team" action={haveAny && existing.size < EXECUTIVE_TEAM.length ? <button className="btn btn-secondary btn-sm" onClick={setupTeam} disabled={settingUp}>{settingUp ? "Adding…" : "Add missing"}</button> : undefined}>
      {error && <div className="banner banner-error" style={{ marginBottom: 12 }}>{error}</div>}

      {!loading && !haveAny ? (
        <div className="empty">
          <div className="t-body" style={{ fontWeight: 600, marginBottom: 6 }}>Staff your command center</div>
          <div className="t-sub" style={{ maxWidth: 460, marginInline: "auto", marginBottom: 16 }}>
            Set up your executive agents — a CPO, Chief Engineering Agent, CRO, and CCO. Each chats, briefs you, and works its domain of the Foundation.
          </div>
          <button className="btn" onClick={setupTeam} disabled={settingUp}>{settingUp ? "Setting up…" : "Set up executive team"}</button>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--sp-3)" }}>
          {EXECUTIVE_TEAM.map((e) => {
            const active = existing.has(e.key);
            return (
              <div key={e.key} className={`card card-pad ${active ? "pop" : ""}`} onClick={() => openAgent(e)}
                style={{ textAlign: "center", opacity: active ? 1 : 0.5 }} title={active ? `Open ${e.name}` : "Not set up"}>
                <span style={{ width: 44, height: 44, borderRadius: 12, background: active ? e.accent : "var(--fill-2)", color: active ? "#fff" : "var(--tm)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 16, marginBottom: 10 }}>{e.short}</span>
                <div style={{ fontSize: 13, fontWeight: 640, lineHeight: 1.25 }}>{e.name}</div>
                <div className="t-sub t-muted" style={{ fontSize: 11.5, marginTop: 3, lineHeight: 1.3 }}>{e.role}</div>
              </div>
            );
          })}
        </div>
      )}

      <AgentDrawer exec={openExec} open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </Section>
  );
}
