import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Loader2,
  MapPin,
  Package,
  Search,
  Sprout,
  X,
} from "lucide-react";
import { SiteLayout } from "@/components/SiteLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChatNegotiateButton } from "@/components/ChatNegotiateButton";
import { searchBrowse, type BrowseResults } from "@/lib/browse.functions";
import {
  geocodeAddress,
  geocodePlaceId,
  reverseGeocode,
  type GeocodeResult,
} from "@/lib/geocode.functions";
import { usePlacesAutocomplete } from "@/hooks/use-google-maps";

export const Route = createFileRoute("/browse")({
  head: () => ({
    meta: [
      { title: "Browse verified farms & fresh produce near you | DiGiFaMaR" },
      {
        name: "description",
        content:
          "Search verified American farms and fresh listings by name, city, ZIP or state. Find trusted farmers within 50 miles on DiGiFaMaR.",
      },
      { property: "og:title", content: "Browse verified farms | DiGiFaMaR" },
      {
        property: "og:description",
        content: "Search verified American farms and fresh listings within 50 miles of any ZIP.",
      },
    ],
  }),
  component: Browse,
  errorComponent: ({ error, reset }) => (
    <SiteLayout>
      <div className="mx-auto max-w-2xl px-4 py-12 text-center">
        <h1 className="text-2xl font-bold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <Button className="mt-6" onClick={reset}>
          Try again
        </Button>
      </div>
    </SiteLayout>
  ),
  notFoundComponent: () => (
    <SiteLayout>
      <div className="mx-auto max-w-2xl px-4 py-12 text-center">
        <h1 className="text-2xl font-bold">Page not found</h1>
      </div>
    </SiteLayout>
  ),
});

const DEBOUNCE_MS = 300;

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

function Browse() {
  const [input, setInput] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebounced(input.trim(), DEBOUNCE_MS);

  // Origin = the resolved coordinates we use to filter by distance.
  const [origin, setOrigin] = useState<GeocodeResult>(null);

  // Geolocation state
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [showFallback, setShowFallback] = useState(false);

  // Manual fallback fields
  const [mCity, setMCity] = useState("");
  const [mState, setMState] = useState("");
  const [mZip, setMZip] = useState("");
  const [manualBusy, setManualBusy] = useState(false);

  // Autocomplete suggestions (only when user is typing a location-ish query)
  const [showSuggest, setShowSuggest] = useState(false);
  const { suggestions, loading: autoLoading } = usePlacesAutocomplete(showSuggest ? input : "");
  const suggestBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPage(1);
  }, [debounced, origin]);

  // Close suggestions on outside click
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (suggestBoxRef.current && !suggestBoxRef.current.contains(e.target as Node)) {
        setShowSuggest(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const handleDetect = () => {
    setGeoError(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoError("Your browser does not support location detection.");
      setShowFallback(true);
      return;
    }
    if (
      typeof window !== "undefined" &&
      window.location.protocol !== "https:" &&
      window.location.hostname !== "localhost"
    ) {
      setGeoError("Location requires a secure (HTTPS) connection.");
      setShowFallback(true);
      return;
    }
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const result = await reverseGeocode({
            data: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          });
          if (result) {
            setOrigin(result);
            setShowFallback(false);
          } else {
            setOrigin({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              formatted: "your location",
              city: null,
              state: null,
              zip: null,
            });
          }
        } catch (err) {
          setGeoError(err instanceof Error ? err.message : "Reverse lookup failed");
        } finally {
          setGeoLoading(false);
        }
      },
      (err) => {
        setGeoLoading(false);
        const msg =
          err.code === err.PERMISSION_DENIED
            ? "Location permission was denied. Enter your location below."
            : err.code === err.POSITION_UNAVAILABLE
              ? "Location is unavailable right now. Enter it manually below."
              : err.code === err.TIMEOUT
                ? "Location request timed out. Try again or enter it manually."
                : "Could not detect your location.";
        setGeoError(msg);
        setShowFallback(true);
      },
      { timeout: 10_000, enableHighAccuracy: false, maximumAge: 300_000 },
    );
  };

  const handleManualSubmit = async () => {
    if (!mCity && !mState && !mZip) return;
    setManualBusy(true);
    setGeoError(null);
    try {
      const res = await geocodeAddress({
        data: {
          city: mCity || undefined,
          state: mState || undefined,
          zip: mZip || undefined,
          country: "USA",
        },
      });
      if (res) {
        setOrigin(res);
        setShowFallback(false);
      } else {
        setGeoError("We couldn't find that location. Double-check and retry.");
      }
    } catch (err) {
      setGeoError(err instanceof Error ? err.message : "Lookup failed");
    } finally {
      setManualBusy(false);
    }
  };

  const handleSuggestionPick = async (placeId: string, label: string) => {
    setShowSuggest(false);
    setInput(label);
    try {
      const res = await geocodePlaceId({ data: { placeId } });
      if (res) {
        setOrigin(res);
        setShowFallback(false);
      }
    } catch {
      // ignore — the text query still applies
    }
  };

  const clearOrigin = () => setOrigin(null);

  const results = useQuery<BrowseResults>({
    queryKey: ["browse-search", debounced, page, origin?.lat ?? null, origin?.lng ?? null],
    queryFn: () =>
      searchBrowse({
        data: {
          q: debounced,
          page,
          originLat: origin?.lat ?? null,
          originLng: origin?.lng ?? null,
          maxMiles: 50,
        },
      }),
    placeholderData: keepPreviousData,
  });

  const data = results.data;
  const totalPages = data
    ? Math.max(1, Math.ceil(Math.max(data.totalFarms, data.totalListings) / data.pageSize))
    : 1;

  const isEmpty =
    !!data && data.farms.length === 0 && data.listings.length === 0 && !results.isFetching;

  return (
    <SiteLayout>
      <h1 className="sr-only">Browse verified American farms and listings</h1>

      <div className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1" ref={suggestBoxRef}>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setShowSuggest(true);
                }}
                onFocus={() => setShowSuggest(true)}
                placeholder="Search by city, ZIP, farm or product…"
                aria-label="Search farms and listings"
                className="pl-9"
                autoComplete="off"
              />
              {input && (
                <button
                  onClick={() => {
                    setInput("");
                    setShowSuggest(false);
                  }}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
              {showSuggest && suggestions.length > 0 && (
                <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-lg">
                  {suggestions.slice(0, 6).map((s) => (
                    <li key={s.placeId}>
                      <button
                        type="button"
                        onClick={() =>
                          handleSuggestionPick(
                            s.placeId,
                            `${s.primary}${s.secondary ? `, ${s.secondary}` : ""}`,
                          )
                        }
                        className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                      >
                        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span>
                          <span className="font-medium">{s.primary}</span>
                          {s.secondary && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              {s.secondary}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={handleDetect}
              disabled={geoLoading}
              className="shrink-0"
            >
              {geoLoading ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Detecting…
                </>
              ) : (
                <>
                  <Crosshair className="mr-1.5 h-4 w-4" /> Detect
                </>
              )}
            </Button>

            {(results.isFetching || autoLoading) && (
              <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…
              </span>
            )}
          </div>

          {origin && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3" /> Showing results within 50 mi of{" "}
              <strong className="text-foreground">{origin.formatted}</strong>
              <button
                onClick={clearOrigin}
                className="ml-2 rounded p-0.5 hover:text-foreground"
                aria-label="Clear location"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          {geoError && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {geoError}
            </div>
          )}

          {showFallback && !origin && (
            <div className="rounded-md border border-border bg-background/60 p-3">
              <p className="mb-2 text-xs font-semibold text-muted-foreground">
                Enter your location manually
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_120px_140px_auto]">
                <div>
                  <Label htmlFor="m-city" className="sr-only">
                    City
                  </Label>
                  <Input
                    id="m-city"
                    value={mCity}
                    onChange={(e) => setMCity(e.target.value)}
                    placeholder="City"
                  />
                </div>
                <div>
                  <Label htmlFor="m-state" className="sr-only">
                    State
                  </Label>
                  <Input
                    id="m-state"
                    value={mState}
                    onChange={(e) => setMState(e.target.value)}
                    placeholder="State"
                    maxLength={2}
                  />
                </div>
                <div>
                  <Label htmlFor="m-zip" className="sr-only">
                    ZIP
                  </Label>
                  <Input
                    id="m-zip"
                    value={mZip}
                    onChange={(e) => setMZip(e.target.value)}
                    placeholder="ZIP"
                    inputMode="numeric"
                  />
                </div>
                <Button onClick={handleManualSubmit} disabled={manualBusy}>
                  {manualBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search this area"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 space-y-10">
        {!data && results.isLoading && (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
          </div>
        )}

        {data && (
          <>
            <section>
              <SectionHeader
                icon={<Sprout className="h-4 w-4" />}
                label="Farms"
                count={data.totalFarms}
              />
              {data.farms.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">No farms match your search.</p>
              ) : (
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {data.farms.map((f) => (
                    <FarmResultCard key={f.user_id} farm={f} />
                  ))}
                </div>
              )}
            </section>

            <section>
              <SectionHeader
                icon={<Package className="h-4 w-4" />}
                label="Listings"
                count={data.totalListings}
              />
              {data.listings.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">No listings match your search.</p>
              ) : (
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {data.listings.map((l) => (
                    <ListingResultCard key={l.id} listing={l} />
                  ))}
                </div>
              )}
            </section>

            {isEmpty && (
              <div className="rounded-xl border border-dashed border-border bg-card/50 p-10 text-center">
                <p className="font-semibold">No results found</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Try a different ZIP, city, farm or product name.
                </p>
              </div>
            )}

            {totalPages > 1 && (
              <nav className="flex items-center justify-center gap-2 pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4" /> Previous
                </Button>
                <span className="px-3 text-sm text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </nav>
            )}
          </>
        )}

        {results.error && (
          <p className="text-center text-sm text-destructive">
            Search failed: {(results.error as Error).message}
          </p>
        )}
      </div>
    </SiteLayout>
  );
}

function SectionHeader({
  icon,
  label,
  count,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <div className="flex items-baseline justify-between border-b border-border pb-2">
      <h2 className="flex items-center gap-2 text-lg font-bold">
        {icon} {label}
      </h2>
      <span className="text-xs text-muted-foreground">
        <strong className="text-foreground">{count}</strong> result
        {count === 1 ? "" : "s"}
      </span>
    </div>
  );
}

function FarmResultCard({ farm }: { farm: BrowseResults["farms"][number] }) {
  return (
    <Link
      to="/farm/$id"
      params={{ id: farm.user_id }}
      className="block rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted/40"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold leading-tight">{farm.farm_name}</h3>
        {farm.verification_status === "verified" && (
          <BadgeCheck className="h-4 w-4 shrink-0 text-primary" />
        )}
      </div>
      {(farm.city || farm.state) && (
        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="h-3 w-3" />
          {[farm.city, farm.state].filter(Boolean).join(", ")}
          {farm.distance_mi != null && (
            <span className="ml-1">· {farm.distance_mi.toFixed(1)} mi</span>
          )}
        </p>
      )}
      {farm.description && (
        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{farm.description}</p>
      )}
      {farm.certifications.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {farm.certifications.slice(0, 3).map((c) => (
            <span
              key={c}
              className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
            >
              {c}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}

function ListingResultCard({ listing }: { listing: BrowseResults["listings"][number] }) {
  const price = (listing.price_cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card transition-colors hover:bg-muted/40">
      <Link to="/farm/$id" params={{ id: listing.farmer_id }} className="block">
        {listing.images[0] ? (
          <img
            src={listing.images[0]}
            alt={listing.title}
            loading="lazy"
            className="aspect-[4/3] w-full object-cover"
          />
        ) : (
          <div className="aspect-[4/3] w-full bg-muted" />
        )}
        <div className="p-4 pb-2">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold leading-tight">{listing.title}</h3>
            <span className="shrink-0 text-sm font-bold text-primary">
              {price}
              <span className="text-xs text-muted-foreground">/{listing.unit}</span>
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {listing.category}
            {listing.farm_name ? ` · ${listing.farm_name}` : ""}
            {listing.distance_mi != null ? ` · ${listing.distance_mi.toFixed(1)} mi` : ""}
          </p>
        </div>
      </Link>
      <div className="px-4 pb-4 pt-1">
        <ChatNegotiateButton listing={listing} />
      </div>
    </div>
  );
}
