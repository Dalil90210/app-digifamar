/// <reference types="google.maps" />
import { useEffect, useRef, useState } from "react";
import { Loader2, Navigation } from "lucide-react";

interface LiveTrackingMapProps {
  farmer: { lat: number; lng: number } | null;
  destination: { lat: number; lng: number; label?: string };
  farmerLabel?: string;
  /** Short label rendered in the floating pill, e.g. "2.4 mi · ~7 min". */
  etaLabel?: string;
  /** When true the farmer has arrived — pulse stops and styling shifts. */
  arrived?: boolean;
}

// ─────────────────────────────────────────────────────────────────
// Google Maps JS API loader (singleton, async)
// ─────────────────────────────────────────────────────────────────

const MANAGED_KEY = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY as
  | string
  | undefined;
const TRACKING_ID = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID as
  | string
  | undefined;
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
// On-brand dark map theme (Forest Green palette)
// ─────────────────────────────────────────────────────────────────

const DARK_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#0a160a" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#060f06" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#6f9a6f" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#1E3A1E" }] },
  { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: "#0c1a0c" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1c2f1c" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#132013" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#5f855f" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#26492a" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#05110a" }] },
];

const FARMER_GREEN = "#4ADE80";
const DEST_BLUE = "#3B82F6";

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

export function LiveTrackingMap({
  farmer,
  destination,
  farmerLabel = "Farmer",
  etaLabel,
  arrived = false,
}: LiveTrackingMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const farmerMarkerRef = useRef<google.maps.Marker | null>(null);
  const pulseMarkerRef = useRef<google.maps.Marker | null>(null);
  const destMarkerRef = useRef<google.maps.Marker | null>(null);
  const glowRef = useRef<google.maps.Polyline | null>(null);
  const routeRef = useRef<google.maps.Polyline | null>(null);
  const dispPosRef = useRef<{ lat: number; lng: number } | null>(null);
  const tweenRaf = useRef<number | null>(null);
  const pulseRaf = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // One-time init ----------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((g) => {
        if (cancelled || !containerRef.current) return;
        const map = new g.maps.Map(containerRef.current, {
          center: { lat: destination.lat, lng: destination.lng },
          zoom: 13,
          disableDefaultUI: true,
          zoomControl: false,
          gestureHandling: "greedy",
          clickableIcons: false,
          backgroundColor: "#0a160a",
          styles: DARK_STYLE,
        });

        // Destination = the buyer ("you are here" blue dot with a soft halo).
        new g.maps.Marker({
          map,
          position: { lat: destination.lat, lng: destination.lng },
          clickable: false,
          icon: {
            path: g.maps.SymbolPath.CIRCLE,
            scale: 15,
            fillColor: DEST_BLUE,
            fillOpacity: 0.18,
            strokeWeight: 0,
          },
          zIndex: 1,
        });
        destMarkerRef.current = new g.maps.Marker({
          map,
          position: { lat: destination.lat, lng: destination.lng },
          title: destination.label ?? "You",
          icon: {
            path: g.maps.SymbolPath.CIRCLE,
            scale: 6,
            fillColor: DEST_BLUE,
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2.5,
          },
          zIndex: 2,
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

  // Continuous radar pulse under the farmer marker. Keyed on presence (not the
  // changing coords) so the animation stays smooth across location updates —
  // the movement effect repositions the pulse marker as the farmer moves.
  const hasFarmer = !!farmer;
  useEffect(() => {
    const g = window.google;
    if (!ready || !g || !hasFarmer || arrived) {
      if (pulseRaf.current) cancelAnimationFrame(pulseRaf.current);
      pulseMarkerRef.current?.setVisible(false);
      return;
    }
    pulseMarkerRef.current?.setVisible(true);
    const start = performance.now();
    const loop = (t: number) => {
      const phase = ((t - start) % 1700) / 1700; // 0..1
      pulseMarkerRef.current?.setIcon({
        path: g.maps.SymbolPath.CIRCLE,
        scale: 10 + phase * 22,
        fillColor: FARMER_GREEN,
        fillOpacity: 0.3 * (1 - phase),
        strokeWeight: 0,
      });
      pulseRaf.current = requestAnimationFrame(loop);
    };
    pulseRaf.current = requestAnimationFrame(loop);
    return () => {
      if (pulseRaf.current) cancelAnimationFrame(pulseRaf.current);
    };
  }, [ready, hasFarmer, arrived]);

  // Farmer marker + route + smooth movement on each update ----------------
  useEffect(() => {
    const g = window.google;
    const map = mapRef.current;
    if (!ready || !g || !map || !farmer) return;

    const target = { lat: farmer.lat, lng: farmer.lng };
    const dest = { lat: destination.lat, lng: destination.lng };

    // Lazily create the farmer + pulse markers and the route polylines.
    if (!farmerMarkerRef.current) {
      dispPosRef.current = target;
      pulseMarkerRef.current = new g.maps.Marker({
        map,
        position: target,
        clickable: false,
        zIndex: 8,
        icon: {
          path: g.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: FARMER_GREEN,
          fillOpacity: 0.25,
          strokeWeight: 0,
        },
      });
      farmerMarkerRef.current = new g.maps.Marker({
        map,
        position: target,
        title: farmerLabel,
        zIndex: 10,
        icon: {
          path: g.maps.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: FARMER_GREEN,
          fillOpacity: 1,
          strokeColor: "#06140a",
          strokeWeight: 3,
        },
      });
      glowRef.current = new g.maps.Polyline({
        map,
        path: [target, dest],
        geodesic: true,
        strokeColor: FARMER_GREEN,
        strokeOpacity: 0.18,
        strokeWeight: 9,
      });
      routeRef.current = new g.maps.Polyline({
        map,
        path: [target, dest],
        geodesic: true,
        strokeColor: FARMER_GREEN,
        strokeOpacity: 0.95,
        strokeWeight: 3.5,
      });
    }

    // Tween the marker from its current displayed position to the new fix so
    // movement glides instead of teleporting.
    const from = dispPosRef.current ?? target;
    const startT = performance.now();
    const DURATION = 850;
    if (tweenRaf.current) cancelAnimationFrame(tweenRaf.current);
    const step = (now: number) => {
      const p = Math.min(1, (now - startT) / DURATION);
      const e = easeOutCubic(p);
      const lat = from.lat + (target.lat - from.lat) * e;
      const lng = from.lng + (target.lng - from.lng) * e;
      const pos = { lat, lng };
      dispPosRef.current = pos;
      farmerMarkerRef.current?.setPosition(pos);
      pulseMarkerRef.current?.setPosition(pos);
      const path = [pos, dest];
      glowRef.current?.setPath(path);
      routeRef.current?.setPath(path);
      if (p < 1) tweenRaf.current = requestAnimationFrame(step);
    };
    tweenRaf.current = requestAnimationFrame(step);

    // Keep both points comfortably in view (padded so they never hug edges).
    const bounds = new g.maps.LatLngBounds();
    bounds.extend(target);
    bounds.extend(dest);
    map.fitBounds(bounds, { top: 56, right: 56, bottom: 56, left: 56 });

    return () => {
      if (tweenRaf.current) cancelAnimationFrame(tweenRaf.current);
    };
  }, [farmer, destination.lat, destination.lng, farmerLabel, ready]);

  // Recolour the farmer marker + route once arrived -----------------------
  useEffect(() => {
    const g = window.google;
    if (!ready || !g || !arrived) return;
    farmerMarkerRef.current?.setIcon({
      path: g.maps.SymbolPath.CIRCLE,
      scale: 9,
      fillColor: "#22C55E",
      fillOpacity: 1,
      strokeColor: "#ffffff",
      strokeWeight: 3,
    });
    routeRef.current?.setOptions({ strokeOpacity: 0.4 });
    glowRef.current?.setOptions({ strokeOpacity: 0.08 });
  }, [arrived, ready]);

  if (error) {
    return (
      <div
        className="flex h-52 w-full items-center justify-center rounded-2xl border border-[#1E3A1E] bg-[#0c1a0c] px-4 text-center text-xs text-[#7AAB7A] sm:h-64"
        role="img"
        aria-label="Live tracking map unavailable"
      >
        Live map unavailable — {error}
      </div>
    );
  }

  return (
    <div className="relative h-52 w-full overflow-hidden rounded-2xl border border-[#1E3A1E] bg-[#0a160a] shadow-[0_8px_30px_-12px_rgba(0,0,0,0.8)] sm:h-64">
      <div
        ref={containerRef}
        className="h-full w-full"
        role="img"
        aria-label="Live farmer location map"
      />

      {/* Subtle top/bottom vignette for legibility of overlays */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-[#060f06]/70 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[#060f06]/70 to-transparent" />

      {/* Loading shimmer until the map is ready */}
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0a160a]">
          <span className="flex items-center gap-2 text-xs text-[#7AAB7A]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading map…
          </span>
        </div>
      )}

      {/* Floating ETA / status pill */}
      {ready && (
        <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-1.5 rounded-full border border-[#1E3A1E] bg-[#060f06]/85 px-3 py-1.5 text-xs font-semibold text-[#F0FFF0] shadow-lg backdrop-blur">
          <span
            className={`inline-block h-2 w-2 rounded-full ${arrived ? "bg-[#22C55E]" : "animate-pulse bg-[#4ADE80]"}`}
          />
          {arrived ? (
            "Arrived"
          ) : (
            <>
              <Navigation className="h-3 w-3 text-[#4ADE80]" />
              {etaLabel ?? "Live"}
            </>
          )}
        </div>
      )}
    </div>
  );
}
