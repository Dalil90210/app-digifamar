// Shared dark-navy UI primitives for the lender portal.
// The portal is themed in isolation with arbitrary Tailwind values + inline
// styles so it never depends on (or mutates) the app's global green theme.
import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, ShieldCheck, type LucideIcon } from "lucide-react";
import { type ReactNode } from "react";
import logoAsset from "@/assets/logo.png.asset.json";
import { NAVY, scoreTier, TIER_META } from "./-data";

const logoSrc = logoAsset.url;

const navItems: { to: string; label: string; icon: LucideIcon }[] = [
  { to: "/lenders/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/lenders/admin", label: "Admin", icon: ShieldCheck },
];

/** Full-page navy chrome shared by every lender route. */
export function LenderShell({
  children,
  showNav = true,
}: {
  children: ReactNode;
  showNav?: boolean;
}) {
  const path = useRouterState({ select: (r) => r.location.pathname });

  return (
    <div className="min-h-screen text-slate-100" style={{ backgroundColor: NAVY.bg }}>
      <header
        className="sticky top-0 z-30 border-b border-white/10 backdrop-blur"
        style={{ backgroundColor: "rgba(10,15,30,0.85)" }}
      >
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/lenders/dashboard" className="flex items-center gap-2">
            <img src={logoSrc} alt="DiGiFaMaR" className="h-9 w-auto object-contain" />
            <span className="text-sm font-extrabold tracking-tight">
              DiGiFaMaR <span className="text-slate-400 font-semibold">Lending</span>
            </span>
          </Link>

          {showNav && (
            <nav className="hidden items-center gap-1 sm:flex">
              {navItems.map((n) => {
                const active = path.startsWith(n.to);
                return (
                  <Link
                    key={n.to}
                    to={n.to}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                      active ? "text-white" : "text-slate-400 hover:text-slate-200"
                    }`}
                    style={active ? { backgroundColor: "rgba(29,78,216,0.18)", color: "#93B4FF" } : undefined}
                  >
                    <n.icon className="h-4 w-4" /> {n.label}
                  </Link>
                );
              })}
            </nav>
          )}

          <Link
            to="/lenders/login"
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10"
          >
            Account
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}

/** Navy card surface (#111827). */
export function LenderCard({
  children,
  className = "",
  ...rest
}: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-2xl border border-white/10 ${className}`}
      style={{ backgroundColor: NAVY.card }}
      {...rest}
    >
      {children}
    </div>
  );
}

export function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accent = false,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: boolean;
}) {
  return (
    <LenderCard
      className="p-4"
      style={
        accent
          ? { backgroundColor: "rgba(29,78,216,0.12)", borderColor: "rgba(29,78,216,0.4)" }
          : { backgroundColor: NAVY.card }
      }
    >
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <Icon className="h-4 w-4" style={{ color: NAVY.accent }} /> {label}
      </div>
      <p className="mt-1 text-2xl font-extrabold" style={accent ? { color: "#93B4FF" } : undefined}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </LenderCard>
  );
}

/** Color-coded DiGiFaMaR Trade Score chip. */
export function TradeScoreBadge({
  score,
  size = "md",
}: {
  score: number;
  size?: "sm" | "md" | "lg";
}) {
  const meta = TIER_META[scoreTier(score)];
  const pad = size === "lg" ? "px-3 py-1.5 text-base" : size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-bold ${pad}`}
      style={{ color: meta.text, backgroundColor: meta.bg, boxShadow: `inset 0 0 0 1px ${meta.ring}` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.dot }} />
      {score}
      <span className="font-semibold opacity-80">· {meta.label}</span>
    </span>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-end justify-between">
      <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400">{children}</h2>
      {right}
    </div>
  );
}

/** Shared recharts tooltip styling for the navy theme. */
export const chartTooltip = {
  contentStyle: {
    background: NAVY.card,
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 8,
    fontSize: 12,
    color: "#E2E8F0",
  },
  labelStyle: { color: "#94A3B8" },
} as const;
