import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: "SingleStack",
  description: "AI-native record system — agents propose, humans ratify.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Sidebar collapsed state, read server-side from the "sb" cookie so the very
  // first paint already reflects the user's choice — no hydration width flash.
  // Default OPEN (cookie absent or != "1").
  const collapsed = (await cookies()).get("sb")?.value === "1";
  return (
    <html lang="en">
      <head>
        {/* Typefaces: Inter (UI), JetBrains Mono (numbers/IDs/timestamps). Per
            singlestack-ui — a real sans + a tabular mono, no system fonts, no
            decorative serif display. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body data-sb={collapsed ? "1" : "0"}>{children}</body>
    </html>
  );
}
