import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SingleStack",
  description: "AI-native record system — agents propose, humans ratify.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
      <body>{children}</body>
    </html>
  );
}
