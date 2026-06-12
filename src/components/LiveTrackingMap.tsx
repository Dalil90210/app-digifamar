/// <reference types="google.maps" />
import { useEffect, useRef, useState } from "react";

interface LiveTrackingMapProps {
  farmer: { lat: number; lng: number } | null;
  destination: { lat: number; lng: number; label?: string };
  farmerLabel?: string;
}

// ─────────────────────────────────────────────────────────────────
// Google Maps JS API loader (singleton, async)
// ─────────────────────────────────────────────────────────────────

const MANAGED_KEY = import.meta.env
  .VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY as string | undefined;
const TRACKING_ID = import.meta.env
  .VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID as string | undefined;
const OVERRIDE_STORAGE_KEY = "dfm:gmaps_browser_key_override";
function getBrowserKey(): string | undefined {
  if (typeof window !== "undefined") {
    const o = window.localStorage?.getItem(OVERRIDE_STORAGE_KEY);
    if (o) return o;
  }
  return MANAGED_KEY;
}

declare global {
  interface Window {
    google?: typeof google;
    __dfmGmapsLoader?: Promise<typeof google>;
    __dfmGmapsInit?: () => void;
  }
}

function loadGoogleMaps(): Promise<typeof google> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("SSR — no window"));
  }
  if (window.google?.maps) return Promise.resolve(window.google);
  if (window.__dfmGmapsLoader) return window.__dfmGmapsLoader;
  const BROWSER_KEY = getBrowserKey();
  if (!BROWSER_KEY) {
    return Promise.reject(new Error("Google Maps browser key missing"));
  }

  window.__dfmGmapsLoader = new Promise((resolve, reject) => {
    window.__dfmGmapsInit = () => {
      if (window.google?.maps) resolve(window.google);
      else reject(new Error("Google Maps failed to initialise"));
    };
    const channel = TRACKING_ID ? `&channel=${TRACKING_ID}` : "";
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${BROWSER_KEY}&loading=async&callback=__dfmGmapsInit${channel}`;
    s.async = true;
    s.defer = true;
    s.onerror = () => reject(new Error("Failed to load Google Maps script"));
    document.head.appendChild(s);
  });
  return window.__dfmGmapsLoader;
}

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

export function LiveTrackingMap({
  farmer,
  destination,
  farmerLabel = "Farmer",
}: LiveTrackingMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const farmerMarkerRef = useRef<google.maps.Marker | null>(null);
  const destMarkerRef = useRef<google.maps.Marker | null>(null);
  const routeRef = useRef<google.maps.Polyline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // One-time init
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((g) => {
        if (cancelled || !containerRef.current) return;
        const map = new g.maps.Map(containerRef.current, {
          center: { lat: destination.lat, lng: destination.lng },
          zoom: 13,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "greedy",
          clickableIcons: false,
          styles: [
            { featureType: "poi", stylers: [{ visibility: "off" }] },
            { featureType: "transit", stylers: [{ visibility: "off" }] },
          ],
        });

        destMarkerRef.current = new g.maps.Marker({
          map,
          position: { lat: destination.lat, lng: destination.lng },
          title: destination.label ?? "You",
          icon: {
            path: g.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: "#1d4ed8",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 3,
          },
        });

        mapRef.current = map;
        setReady(true);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [destination.lat, destination.lng, destination.label]);

  // Farmer marker + route + auto-fit on each update
  useEffect(() => {
    const g = window.google;
    const map = mapRef.current;
    if (!ready || !g || !map || !farmer) return;

    const pos = { lat: farmer.lat, lng: farmer.lng };

    if (!farmerMarkerRef.current) {
      farmerMarkerRef.current = new g.maps.Marker({
        map,
        position: pos,
        title: farmerLabel,
        icon: {
          path: g.maps.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: "#16a34a",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 3,
        },
        zIndex: 10,
      });
    } else {
      farmerMarkerRef.current.setPosition(pos);
    }

    const path = [pos, { lat: destination.lat, lng: destination.lng }];
    if (!routeRef.current) {
      routeRef.current = new g.maps.Polyline({
        map,
        path,
        geodesic: true,
        strokeOpacity: 0,
        icons: [
          {
            icon: {
              path: "M 0,-1 0,1",
              strokeOpacity: 0.9,
              strokeColor: "#16a34a",
              scale: 3,
            },
            offset: "0",
            repeat: "12px",
          },
        ],
      });
    } else {
      routeRef.current.setPath(path);
    }

    const bounds = new g.maps.LatLngBounds();
    bounds.extend(pos);
    bounds.extend({ lat: destination.lat, lng: destination.lng });
    map.fitBounds(bounds, 48);
  }, [farmer, destination.lat, destination.lng, farmerLabel, ready]);

  if (error) {
    return (
      <div
        className="h-56 w-full rounded-xl border border-border bg-muted/40 flex items-center justify-center px-4 text-center text-xs text-muted-foreground"
        role="img"
        aria-label="Live tracking map unavailable"
      >
        Live map unavailable — {error}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-56 w-full rounded-xl overflow-hidden border border-border bg-muted"
      role="img"
      aria-label="Live farmer location map"
    />
  );
}
