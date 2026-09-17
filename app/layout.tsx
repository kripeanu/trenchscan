import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TrenchScan — Scan first. Ape second.",
  description: "Real-time Solana launch intelligence for the trenches.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
