"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/", label: "Dashboard" },
  { href: "/analyze", label: "Analyze" },
  { href: "/analytics", label: "Analytics" },
  { href: "/journal", label: "Journal" },
  { href: "/signals", label: "Signals" },
  { href: "/strategies", label: "Strategies" },
];

export function TopNav() {
  const pathname = usePathname();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-bg/90 backdrop-blur-xl">
      <div className="mx-auto flex h-12 max-w-[1600px] items-center px-4">
        <Link href="/" className="mr-8 flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-brand text-[10px] font-bold text-white">
            TZ
          </div>
          <span className="text-sm font-semibold tracking-tight text-text">
            tradzfx
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          {navItems.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  active
                    ? "text-text"
                    : "text-text-dim hover:text-text-muted"
                }`}
              >
                {item.label}
                {active && (
                  <span className="absolute bottom-0 left-3 right-3 h-0.5 rounded-full bg-brand" />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <LiveIndicator />
        </div>
      </div>
    </header>
  );
}

function LiveIndicator() {
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-long/30 bg-long-soft px-2.5 py-1">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-long opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-long" />
      </span>
      <span className="text-[11px] font-medium text-long">LIVE</span>
    </div>
  );
}
