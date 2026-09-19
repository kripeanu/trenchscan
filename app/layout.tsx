import type { Metadata } from "next";
import "./globals.css";
import "./snapshot.css";

export const metadata: Metadata = {
  title: "TrenchScan — Fresh trenches. Less bullshit.",
  description:
    "Real-time Pump and StonkFun launch intelligence for trenchers. See fresh launches, read the bags, and follow source-aware on-chain receipts before you ape.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
