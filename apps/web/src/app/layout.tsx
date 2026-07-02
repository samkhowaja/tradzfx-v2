import type { Metadata } from "next";
import "./globals.css";
import { TopNav } from "@/components/layout/TopNav";

export const metadata: Metadata = {
  title: "tradzfx — Command Center",
  description: "Live trading dashboard and analytics",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <TopNav />
        <main className="pt-12">{children}</main>
      </body>
    </html>
  );
}
