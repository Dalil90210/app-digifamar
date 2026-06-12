import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/settings/maps")({
  head: () => ({
    meta: [
      { title: "Maps Platform Settings — DiGiFaMaR" },
      { name: "description", content: "Manage the Google Maps Platform API key used on this domain." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MapsSettingsPage,
});

const MANAGED_KEY = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY as
  | string
  | undefined;
const STORAGE_KEY = "dfm:gmaps_browser_key_override";

function mask(key: string | undefined | null) {
  if (!key) return "—";
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

function MapsSettingsPage() {
  const [hostname, setHostname] = useState("");
  const [override, setOverride] = useState("");
  const [savedOverride, setSavedOverride] = useState<string | null>(null);
  const [loadStatus, setLoadStatus] = useState<"checking" | "ok" | "blocked" | "no-key">(
    "checking",
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    setHostname(window.location.hostname);
    const stored = window.localStorage.getItem(STORAGE_KEY);
    setSavedOverride(stored);
    setOverride(stored ?? "");
  }, []);

  const activeKey = savedOverride || MANAGED_KEY;
  const usingOverride = !!savedOverride;

  // Probe the active key with a tiny Geocode-style script test
  useEffect(() => {
    if (!activeKey) {
      setLoadStatus("no-key");
      return;
    }
    setLoadStatus("checking");
    const img = new Image();
    // Static Maps will 200 only if key + referrer are valid for this domain.
    img.onload = () => setLoadStatus("ok");
    img.onerror = () => setLoadStatus("blocked");
    img.src = `https://maps.googleapis.com/maps/api/staticmap?center=0,0&zoom=1&size=1x1&key=${encodeURIComponent(
      activeKey,
    )}`;
  }, [activeKey]);

  const save = () => {
    const trimmed = override.trim();
    if (!trimmed) {
      window.localStorage.removeItem(STORAGE_KEY);
      setSavedOverride(null);
      toast.success("Custom key cleared — using managed key");
      return;
    }
    if (!/^AIza[0-9A-Za-z_-]{20,}$/.test(trimmed)) {
      toast.error("That doesn't look like a Google API key (should start with AIza…)");
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, trimmed);
    setSavedOverride(trimmed);
    toast.success("Saved. Reload any open map to apply.");
  };

  const clear = () => {
    window.localStorage.removeItem(STORAGE_KEY);
    setSavedOverride(null);
    setOverride("");
    toast.success("Custom key cleared");
  };

  const isCustomDomain =
    hostname &&
    !hostname.endsWith(".lovable.app") &&
    !hostname.endsWith(".lovableproject.com") &&
    hostname !== "localhost";

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl space-y-4 p-4">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Maps Platform</h1>
          <p className="text-sm text-muted-foreground">
            Configure the Google Maps API key used by this site.
          </p>
        </header>

        <Card className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Current domain</span>
            <span className="font-mono text-sm">{hostname || "—"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Domain type</span>
            <Badge variant={isCustomDomain ? "default" : "secondary"}>
              {isCustomDomain ? "Custom domain" : "Lovable domain"}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Active key</span>
            <span className="font-mono text-sm">{mask(activeKey)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Source</span>
            <Badge variant={usingOverride ? "default" : "secondary"}>
              {usingOverride ? "Custom (this browser)" : "Managed by Lovable"}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Status</span>
            <Badge
              variant={
                loadStatus === "ok"
                  ? "default"
                  : loadStatus === "checking"
                    ? "secondary"
                    : "destructive"
              }
            >
              {loadStatus === "ok" && "Working on this domain"}
              {loadStatus === "checking" && "Checking…"}
              {loadStatus === "blocked" && "Blocked — referrer or key invalid"}
              {loadStatus === "no-key" && "No key configured"}
            </Badge>
          </div>
        </Card>

        <Card className="space-y-3 p-4">
          <div className="space-y-1">
            <Label htmlFor="gmaps-key">Your Google Maps API key</Label>
            <p className="text-xs text-muted-foreground">
              Paste a key from your own Google Cloud project. It's stored locally in this
              browser and only used for the Maps JavaScript API.
            </p>
          </div>
          <Input
            id="gmaps-key"
            type="text"
            autoComplete="off"
            placeholder="AIza…"
            value={override}
            onChange={(e) => setOverride(e.target.value)}
            className="font-mono"
          />
          <div className="flex gap-2">
            <Button onClick={save}>Save key</Button>
            {savedOverride && (
              <Button variant="outline" onClick={clear}>
                Use managed key
              </Button>
            )}
          </div>
          {isCustomDomain && (
            <p className="text-xs text-muted-foreground">
              For <span className="font-mono">{hostname}</span> to work, add both
              <span className="font-mono"> https://{hostname}/*</span> and
              <span className="font-mono"> https://*.{hostname.split(".").slice(-2).join(".")}/*</span>{" "}
              to your key's HTTP referrer allowlist in Google Cloud Console.
            </p>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
