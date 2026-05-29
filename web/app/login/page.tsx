"use client";

// Email + password sign in / sign up. New signups land in your single org via
// the on_auth_user_created trigger already in the DB. On success we redirect to
// the app; middleware enforces auth everywhere else.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setError(error.message);
      } else {
        // If email confirmation is on, there's no session yet.
        const { data } = await supabase.auth.getSession();
        if (data.session) router.push("/");
        else setNotice("Check your email to confirm your account, then sign in.");
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
      else router.push("/");
    }
    setBusy(false);
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg)",
        padding: 24,
      }}
    >
      <div className="card" style={{ width: 380, padding: 32 }}>
        <div className="row gap-2" style={{ marginBottom: 18 }}>
          <span style={{
            width: 24, height: 24, borderRadius: 7, background: "var(--ac)",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontWeight: 800, fontSize: 14,
          }}>S</span>
          <span style={{ fontSize: 19, fontWeight: 680, letterSpacing: "-0.02em" }}>SingleStack</span>
        </div>
        <p className="t-sub" style={{ marginBottom: 24 }}>
          {mode === "signin" ? "Sign in to continue." : "Create your account."}
        </p>

        <form onSubmit={submit}>
          <label className="field">
            <span className="t-label">Email</span>
            <input
              className="input"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="t-label">Password</span>
            <input
              className="input"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          {error && (
            <div className="banner banner-error" style={{ marginBottom: 14 }}>
              {error}
            </div>
          )}
          {notice && (
            <div className="banner" style={{ background: "var(--gn-fill)", color: "var(--gn-text)", marginBottom: 14 }}>
              {notice}
            </div>
          )}

          <button className="btn" type="submit" disabled={busy} style={{ width: "100%" }}>
            {busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        <button
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
            setNotice(null);
          }}
          style={{
            background: "none",
            border: "none",
            color: "var(--ac-text)",
            fontSize: 13,
            fontWeight: 600,
            marginTop: 18,
            display: "block",
            width: "100%",
            textAlign: "center",
          }}
        >
          {mode === "signin"
            ? "Need an account? Sign up"
            : "Have an account? Sign in"}
        </button>
      </div>
    </main>
  );
}
