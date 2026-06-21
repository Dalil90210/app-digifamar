import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import {
  BadgeCheck,
  Heart,
  MapPin,
  MessageSquare,
  Package,
  Sprout,
  Star,
  Loader2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { SiteLayout } from "@/components/SiteLayout";
import { Button } from "@/components/ui/button";
import { ChatNegotiateButton } from "@/components/ChatNegotiateButton";
import { ProductCard } from "@/components/Cards";
import { farms, getFarm, getProductsByFarm, products, type Farm } from "@/lib/mock-data";
import { getFarmDetail, type FarmDetail } from "@/lib/farm.functions";
import { useAuth } from "@/hooks/use-auth";
import { findOrCreateConversation } from "@/lib/chat/start-conversation";
import { formatCents } from "@/lib/cart/fees";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/farm/$id")({
  // Real Supabase farm (id = farmer user_id) when the param is a UUID; otherwise
  // fall back to the mock catalogue so legacy slug links keep working.
  loader: async ({ params }) => {
    if (UUID_RE.test(params.id)) {
      const real = await getFarmDetail({ data: { id: params.id } });
      if (real) return { source: "real" as const, real, mock: null };
    }
    const farm = getFarm(params.id);
    if (farm) return { source: "mock" as const, real: null, mock: farm };
    throw notFound();
  },
  head: ({ loaderData }) => {
    if (loaderData?.source === "real" && loaderData.real) {
      const f = loaderData.real;
      const loc = [f.city, f.state].filter(Boolean).join(", ");
      const title = `${f.name}${loc ? ` — ${loc}` : ""} | DiGiFaMaR`;
      const desc = f.description ?? `Fresh produce from ${f.name} on DiGiFaMaR.`;
      return {
        meta: [
          { title },
          { name: "description", content: desc },
          { property: "og:title", content: `${f.name} | DiGiFaMaR` },
          { property: "og:description", content: desc },
          { property: "og:type", content: "profile" },
        ],
      };
    }
    const f = loaderData?.mock;
    if (!f) return { meta: [{ title: "Farm not found | DiGiFaMaR" }] };
    return {
      meta: [
        { title: `${f.name} — ${f.location} | DiGiFaMaR` },
        { name: "description", content: f.description },
        { property: "og:title", content: `${f.name} | DiGiFaMaR` },
        { property: "og:description", content: f.description },
        { property: "og:type", content: "profile" },
        { property: "og:image", content: f.image },
      ],
    };
  },
  component: FarmPage,
});

function FarmPage() {
  const data = Route.useLoaderData();
  if (data.source === "real" && data.real) return <RealFarmView farm={data.real} />;
  return <MockFarmView farm={data.mock!} />;
}

// ─────────────────────────────────────────────────────────────────
// REAL FARM (Supabase)
// ─────────────────────────────────────────────────────────────────

function RealFarmView({ farm }: { farm: FarmDetail }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [messaging, setMessaging] = useState(false);
  const location = [farm.city, farm.state].filter(Boolean).join(", ");
  const heroImage = farm.listings.find((l) => l.image)?.image ?? null;

  const handleMessageFarmer = async () => {
    if (!user) {
      navigate({ to: "/auth", search: { tab: "signin" } });
      return;
    }
    setMessaging(true);
    try {
      const convId = await findOrCreateConversation(user.id, farm.farmerId, farm.name);
      if (convId) {
        navigate({ to: "/chat/$productId", params: { productId: convId } });
      } else {
        toast.error("Couldn't open chat. Please try again.");
      }
    } catch {
      toast.error("Couldn't open chat. Please try again.");
    } finally {
      setMessaging(false);
    }
  };

  return (
    <SiteLayout>
      <div className="relative h-56 sm:h-72">
        {heroImage ? (
          <img src={heroImage} alt={farm.name} className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-primary/25 via-leaf-soft to-background" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
      </div>

      <div className="mx-auto -mt-16 max-w-7xl px-4 sm:px-6">
        <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-extrabold sm:text-4xl">{farm.name}</h1>
                {farm.verified && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-badge-verified px-2 py-0.5 text-xs font-semibold text-badge-verified-foreground">
                    <BadgeCheck className="h-3.5 w-3.5" /> Verified
                  </span>
                )}
              </div>
              {location && (
                <p className="mt-1 text-sm text-muted-foreground">
                  <MapPin className="mr-0.5 inline h-4 w-4" />
                  {location}
                  {farm.yearsFarming ? ` · ${farm.yearsFarming} years farming` : ""}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline">
                <Heart className="mr-1 h-4 w-4" /> Follow farm
              </Button>
              <Button onClick={handleMessageFarmer} disabled={messaging}>
                {messaging ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <MessageSquare className="mr-1 h-4 w-4" />
                )}
                Message Farmer
              </Button>
            </div>
          </div>

          {farm.description && (
            <p className="mt-4 max-w-3xl text-sm text-muted-foreground">{farm.description}</p>
          )}

          {farm.certifications.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {farm.certifications.map((c) => (
                <span
                  key={c}
                  className="rounded-full bg-leaf-soft px-3 py-1 text-xs font-semibold text-primary"
                >
                  {c}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12">
        <section>
          <h2 className="flex items-center gap-2 text-2xl font-extrabold">
            <Sprout className="h-5 w-5 text-primary" />
            Listings from {farm.name.split(" ")[0]}
          </h2>

          {farm.listings.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-border bg-card/50 p-10 text-center">
              <Package className="mx-auto h-7 w-7 text-muted-foreground" />
              <p className="mt-2 font-semibold">No active listings right now</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Message the farmer to ask what's in season.
              </p>
            </div>
          ) : (
            <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {farm.listings.map((l) => (
                <div
                  key={l.id}
                  className="flex flex-col overflow-hidden rounded-xl border border-border bg-card"
                >
                  {l.image ? (
                    <img
                      src={l.image}
                      alt={l.title}
                      loading="lazy"
                      className="aspect-[4/3] w-full object-cover"
                    />
                  ) : (
                    <div className="aspect-[4/3] w-full bg-muted" />
                  )}
                  <div className="flex flex-1 flex-col p-4">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold leading-tight">{l.title}</h3>
                      <span className="shrink-0 text-sm font-bold text-primary">
                        {formatCents(l.price_cents)}
                        <span className="text-xs text-muted-foreground">/{l.unit}</span>
                      </span>
                    </div>
                    <p className="mt-1 text-xs capitalize text-muted-foreground">{l.category}</p>
                    <div className="mt-3 flex-1" />
                    <ChatNegotiateButton
                      listing={{
                        id: l.id,
                        farmer_id: l.farmer_id,
                        title: l.title,
                        unit: l.unit,
                        price_cents: l.price_cents,
                        farm_name: farm.name,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="mt-14 rounded-2xl border border-border bg-card p-6">
          <h2 className="text-xl font-bold">About {farm.name}</h2>
          <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
            {farm.description ??
              "A verified farm on DiGiFaMaR. Message the farmer to learn more about their growing practices and what's fresh this week."}
          </p>
          <Link
            to="/browse"
            className="mt-4 inline-flex text-sm font-semibold text-primary hover:underline"
          >
            Browse more farms near you →
          </Link>
        </section>
      </div>
    </SiteLayout>
  );
}

// ─────────────────────────────────────────────────────────────────
// MOCK FARM (legacy slug catalogue) — unchanged behaviour
// ─────────────────────────────────────────────────────────────────

function MockFarmView({ farm }: { farm: Farm }) {
  const farmProducts = getProductsByFarm(farm.id);
  const fallback = farmProducts.length ? farmProducts : products.slice(0, 3);
  const nearby = farms.filter((f) => f.id !== farm.id).slice(0, 3);
  const { user } = useAuth();
  const navigate = useNavigate();
  const [messaging, setMessaging] = useState(false);

  const handleMessageFarmer = () => {
    if (!user) {
      navigate({ to: "/auth", search: { tab: "signin" } });
      return;
    }
    // Mock farms have no real auth.users row, so we route to the localStorage
    // demo chat keyed by the mock farm id.
    setMessaging(true);
    navigate({ to: "/chat/farm/$farmId", params: { farmId: farm.id }, search: {} });
  };

  return (
    <SiteLayout>
      <div className="relative h-64 sm:h-80">
        <img src={farm.image} alt={farm.name} className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
      </div>

      <div className="mx-auto -mt-16 max-w-7xl px-4 sm:px-6">
        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-3xl font-extrabold sm:text-4xl">{farm.name}</h1>
                {farm.verified && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-badge-verified px-2 py-0.5 text-xs font-semibold text-badge-verified-foreground">
                    <BadgeCheck className="h-3.5 w-3.5" /> Verified
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                <MapPin className="mr-0.5 inline h-4 w-4" />
                {farm.location} · est. {farm.established}
              </p>
              <p className="mt-2 flex items-center gap-3 text-sm">
                <span className="flex items-center gap-0.5">
                  <Star className="h-4 w-4 fill-badge-gold text-badge-gold" />
                  <strong>{farm.rating}</strong> ({farm.reviews} reviews)
                </span>
                <span>·</span>
                <span className="text-muted-foreground">
                  {farm.totalSales.toLocaleString()} total sales
                </span>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button>
                <Heart className="mr-1 h-4 w-4" /> Follow farm
              </Button>
              <Button variant="outline" onClick={handleMessageFarmer} disabled={messaging}>
                {messaging ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <MessageSquare className="mr-1 h-4 w-4" />
                )}
                Message Farmer
              </Button>
            </div>
          </div>
          <p className="mt-4 max-w-3xl text-sm text-muted-foreground">{farm.description}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {farm.certifications.map((c: string) => (
              <span
                key={c}
                className="rounded-full bg-leaf-soft px-3 py-1 text-xs font-semibold text-primary"
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <section>
          <h2 className="text-2xl font-extrabold">Products from {farm.name.split(" ")[0]}</h2>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {fallback.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>

        <section className="mt-16 grid gap-8 md:grid-cols-3">
          <div className="md:col-span-2 rounded-2xl border border-border bg-card p-6">
            <h2 className="text-xl font-bold">About the farmer</h2>
            <div className="mt-4 flex gap-4">
              <img
                src={farm.image}
                alt=""
                loading="lazy"
                className="h-20 w-20 rounded-full object-cover"
              />
              <p className="text-sm text-muted-foreground">
                Family-run for {2026 - farm.established} years. Our practices center on soil health,
                animal welfare, and feeding our neighbors better food. We're proud to ship across
                America through DiGiFaMaR.
              </p>
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="text-xl font-bold">Find us</h2>
            <div className="mt-3 aspect-square overflow-hidden rounded-xl bg-leaf-soft">
              <div className="grid h-full place-items-center">
                <div className="text-center">
                  <MapPin className="mx-auto h-8 w-8 text-primary" />
                  <p className="mt-2 text-sm font-semibold">{farm.location}</p>
                  <p className="text-xs text-muted-foreground">Interactive map next phase</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-16">
          <h2 className="text-2xl font-extrabold">Nearby farms</h2>
          <div className="mt-6 grid gap-5 sm:grid-cols-3">
            {nearby.map((f) => (
              <Link
                key={f.id}
                to="/farm/$id"
                params={{ id: f.id }}
                className="card-lift overflow-hidden rounded-xl border border-border bg-card"
              >
                <img
                  src={f.image}
                  alt={f.name}
                  loading="lazy"
                  className="h-32 w-full object-cover"
                />
                <div className="p-3">
                  <p className="font-semibold">{f.name}</p>
                  <p className="text-xs text-muted-foreground">{f.location}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </SiteLayout>
  );
}
