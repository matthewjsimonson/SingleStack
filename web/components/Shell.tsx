"use client";

// App shell: dark sidebar + white topbar, matching the v1 prototype's frame.
// Wraps every authenticated page.
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function Shell({
  children,
  email,
}: {
  children: React.ReactNode;
  email?: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      {/* Sidebar */}
      <aside
        style={{
          width: 230,
          minWidth: 230,
          background: "var(--sb)",
          color: "var(--sbt)",
          padding: "20px 0",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          className="serif"
          style={{
            color: "#fff",
            fontSize: 19,
            fontWeight: 600,
            padding: "0 22px 18px",
          }}
        >
          SingleStack
        </div>
        <nav style={{ flex: 1 }}>
          <a
            href="/"
            style={{
              display: "block",
              padding: "9px 22px",
              fontSize: 13.5,
              fontWeight: 600,
              color: "#fff",
              background: "var(--sa)",
            }}
          >
            Records
          </a>
        </nav>
        <div style={{ padding: "12px 22px", borderTop: "1px solid var(--sbb)" }}>
          <div style={{ fontSize: 12, color: "var(--sbl)", marginBottom: 8 }}>
            {email ?? ""}
          </div>
          <button
            onClick={signOut}
            style={{
              background: "transparent",
              border: "1px solid var(--sbb)",
              color: "var(--sbt)",
              borderRadius: 6,
              padding: "5px 11px",
              fontSize: 12.5,
              fontWeight: 600,
            }}
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <header
          style={{
            height: 54,
            minHeight: 54,
            background: "var(--tb)",
            borderBottom: "1px solid var(--tbb)",
            display: "flex",
            alignItems: "center",
            padding: "0 24px",
          }}
        >
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>Records</span>
        </header>
        <main style={{ flex: 1, overflowY: "auto", padding: 28 }}>{children}</main>
      </div>
    </div>
  );
}
