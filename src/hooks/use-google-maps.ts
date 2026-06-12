// Lightweight Google Maps JS API loader + Places Autocomplete (New) hook.
// Uses the Lovable-managed browser key (referrer-restricted, safe to embed).

import { useEffect, useRef, useState } from "react";

const MANAGED_KEY = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY as
  | string
  | undefined;
const TRACKING_ID = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID as
  | string
  | undefined;
const OVERRIDE_STORAGE_KEY = "dfm:gmaps_browser_key_override";

function getBrowserKey(): string | undefined {
  if (typeof window !== "undefined") {
    const override = window.localStorage?.getItem(OVERRIDE_STORAGE_KEY);
    if (override) return override;
  }
  return MANAGED_KEY;
}

declare global {
  interface Window {
    google?: typeof google;
    __dgfMapsLoader?: Promise<void>;
    __dgfMapsCallback?: () => void;
  }
}

/** Loads the Maps JS API (with places library) exactly once. */
export function loadGoogleMaps(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.google?.maps && typeof window.google.maps.importLibrary === "function") return Promise.resolve();
  if (window.__dgfMapsLoader) return window.__dgfMapsLoader;
  const BROWSER_KEY = getBrowserKey();
  if (!BROWSER_KEY) {
    return Promise.reject(new Error("Google Maps browser key not configured"));
  }
  window.__dgfMapsLoader = new Promise<void>((resolve, reject) => {
    window.__dgfMapsCallback = () => resolve();
    const params = new URLSearchParams({
      key: BROWSER_KEY,
      v: "weekly",
      libraries: "places",
      loading: "async",
      callback: "__dgfMapsCallback",
    });
    if (TRACKING_ID) params.set("channel", TRACKING_ID);
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    s.async = true;
    s.defer = true;
    s.onerror = () => reject(new Error("Failed to load Google Maps script"));
    document.head.appendChild(s);
  });
  return window.__dgfMapsLoader;
}

export type PlaceSuggestion = {
  placeId: string;
  primary: string;
  secondary: string;
};

/** US-restricted Places Autocomplete (New) suggestions for a query string. */
export function usePlacesAutocomplete(input: string, debounceMs = 250) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);

  useEffect(() => {
    const query = input.trim();
    if (query.length < 2) {
      setSuggestions([]);
      setError(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        await loadGoogleMaps();
        const places = (await google.maps.importLibrary(
          "places",
        )) as google.maps.PlacesLibrary;
        if (!tokenRef.current) {
          tokenRef.current = new places.AutocompleteSessionToken();
        }
        const { suggestions: raw } =
          await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
            input: query,
            sessionToken: tokenRef.current,
            includedRegionCodes: ["us"],
          });
        if (cancelled) return;
        const mapped: PlaceSuggestion[] = raw
          .map((s) => s.placePrediction)
          .filter((p): p is google.maps.places.PlacePrediction => !!p)
          .map((p) => ({
            placeId: p.placeId,
            primary: p.mainText?.text ?? p.text.text,
            secondary: p.secondaryText?.text ?? "",
          }));
        setSuggestions(mapped);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Autocomplete failed");
          setSuggestions([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, debounceMs);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [input, debounceMs]);

  return { suggestions, loading, error };
}
