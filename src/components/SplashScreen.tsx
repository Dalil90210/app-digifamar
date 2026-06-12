import { useMemo, useEffect, useState } from "react";
import logoAsset from "@/assets/logo.png.asset.json";
const logoSrc = logoAsset.url;

const SPLASH_KEY = "dgf_splash_v1";

// ─── Deterministic floating particles (same seed = no SSR hydration mismatch) ───
function Particles() {
  const particles = useMemo(
    () =>
      Array.from({ length: 22 }).map((_, i) => {
        const seed = (i * 9301 + 49297) % 233280;
        const r = (n: number) => ((seed * (n + 1)) % 1000) / 1000;
        const size = 2 + r(1) * 3.5;
        return {
          left:     `${r(2) * 100}%`,
          bottom:   `-${r(3) * 20 + 5}%`,
          size,
          duration: 20 + r(4) * 26,
          delay:    -r(5) * 30,
          dx:       `${(r(6) - 0.5) * 70}px`,
          opacity:  0.25 + r(7) * 0.4,
        };
      }),
    [],
  );

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {particles.map((p, i) => (
        <span
          key={i}
          className="dew-particle"
          style={{
            left:            p.left,
            bottom:          p.bottom,
            width:           p.size,
            height:          p.size,
            animationDuration: `${p.duration}s`,
            animationDelay:    `${p.delay}s`,
            ["--dew-dx" as string]:      p.dx,
            ["--dew-opacity" as string]: p.opacity,
          }}
        />
      ))}
    </div>
  );
}

// ─── Trust badge pill ────────────────────────────────────────────────────────
const BADGES = [
  { emoji: "🔒", text: "Secured by Escrow.com",     delay: "1.4s" },
  { emoji: "📍", text: "All 50 States",              delay: "1.65s" },
  { emoji: "🌾", text: "10,000+ Verified Farmers",  delay: "1.9s" },
  { emoji: "⭐", text: "98% Delivery Rate",          delay: "2.15s" },
];

// ─── Main component ──────────────────────────────────────────────────────────
export function SplashScreen() {
  const [visible, setVisible] = useState(() => {
    if (typeof window === "undefined") return false;
    return !localStorage.getItem(SPLASH_KEY);
  });
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const t = window.setTimeout(() => {
      setFading(true);
      window.setTimeout(() => {
        localStorage.setItem(SPLASH_KEY, "1");
        setVisible(false);
      }, 700);
    }, 3200);
    return () => window.clearTimeout(t);
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-label="Loading DiGiFaMaR"
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-hidden select-none"
      style={{
        backgroundColor: "#060F06",
        opacity: fading ? 0 : 1,
        transition: "opacity 0.7s cubic-bezier(0.4, 0, 0.2, 1)",
        pointerEvents: fading ? "none" : "auto",
      }}
    >
      {/* ── Background layers ── */}

      {/* Deep radial gradient — green core fading to black */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 55% at 50% 42%, rgba(20,55,20,0.95) 0%, #060F06 75%)",
        }}
      />

      {/* Left + right ambient blobs */}
      <div
        className="pointer-events-none absolute"
        style={{
          left: "-10%", top: "20%",
          width: 320, height: 320,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(45,122,46,0.14) 0%, transparent 70%)",
          filter: "blur(40px)",
        }}
      />
      <div
        className="pointer-events-none absolute"
        style={{
          right: "-10%", bottom: "15%",
          width: 280, height: 280,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(74,222,128,0.10) 0%, transparent 70%)",
          filter: "blur(40px)",
        }}
      />

      {/* Floating dew particles */}
      <Particles />

      {/* ── Content ── */}
      <div className="relative z-10 flex flex-col items-center px-6 text-center">

        {/* Logo with pulsing halo */}
        <div className="relative mb-1">
          {/* Halo layers behind logo */}
          <div
            className="animate-splash-halo pointer-events-none absolute rounded-full"
            style={{
              left: "50%", top: "50%",
              width: 260, height: 260,
              marginLeft: -130, marginTop: -130,
              background:
                "radial-gradient(circle, rgba(74,222,128,0.18) 0%, rgba(45,122,46,0.08) 50%, transparent 75%)",
              filter: "blur(8px)",
            }}
          />
          <div
            className="pointer-events-none absolute rounded-full"
            style={{
              left: "50%", top: "50%",
              width: 180, height: 180,
              marginLeft: -90, marginTop: -90,
              background:
                "radial-gradient(circle, rgba(74,222,128,0.12) 0%, transparent 70%)",
              filter: "blur(4px)",
            }}
          />

          {/* Logo image */}
          <div className="animate-splash-logo">
            <img
              src={logoSrc}
              alt="DiGiFaMaR"
              width={320}
              height={320}
              className="h-44 sm:h-56 w-auto object-contain"
              draggable={false}
            />
          </div>
        </div>

        {/* Tagline with shimmer */}
        <p
          className="animate-splash-tagline animate-splash-shimmer mt-0 text-base sm:text-lg font-bold tracking-wide px-4"
        >
          America's Farmers. Direct to Market. No Middlemen.
        </p>

        {/* Gradient divider */}
        <div
          className="animate-splash-divider mx-auto mt-5 h-px"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgba(74,222,128,0.6), transparent)",
          }}
        />

        {/* Trust badge pills */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2 sm:gap-3">
          {BADGES.map(({ emoji, text, delay }) => (
            <span
              key={text}
              className="animate-splash-badge inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium"
              style={{
                animationDelay: delay,
                borderColor: "rgba(74,222,128,0.25)",
                backgroundColor: "rgba(74,222,128,0.07)",
                color: "rgba(255,255,255,0.70)",
              }}
            >
              <span aria-hidden>{emoji}</span>
              {text}
            </span>
          ))}
        </div>

        {/* Powered-by line */}
        <p
          className="animate-splash-badge mt-5 text-[11px] tracking-widest uppercase"
          style={{ animationDelay: "2.4s", color: "rgba(255,255,255,0.25)" }}
        >
          Powered by Escrow.com · Cloudflare · Supabase
        </p>
      </div>

      {/* ── Loading bar ── */}
      <div
        className="absolute bottom-0 left-0 right-0 h-1"
        style={{ backgroundColor: "rgba(74,222,128,0.08)" }}
      >
        <div
          className="animate-splash-bar animate-splash-bar-glow h-full"
          style={{ backgroundColor: "#4ADE80", width: 0, borderRadius: "0 9999px 9999px 0" }}
        />
      </div>

      {/* Thin top accent line */}
      <div
        className="animate-splash-bar absolute top-0 left-0 h-[2px]"
        style={{
          background: "linear-gradient(90deg, transparent, #4ADE80, transparent)",
          width: 0,
          animationDuration: "3.2s",
        }}
      />
    </div>
  );
}
