import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  Building2,
  CheckCircle2,
  Circle,
  CreditCard,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  MapPin,
  Navigation,
  PartyPopper,
  Send,
  ShieldCheck,
  Truck,
  UserCog,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { getFarm, getProduct } from "@/lib/mock-data";
import {
  scanForContactInfo,
  describeCategories,
  CONTACT_BLOCK_WARNING,
} from "@/lib/chat/contact-guard";
import { haversineDistance, useGeolocation } from "@/hooks/use-geolocation";
import { LiveTrackingMap } from "@/components/LiveTrackingMap";


// ─────────────────────────────────────────────────────────────────
// ROUTE
// ─────────────────────────────────────────────────────────────────

const searchSchema = z.object({
  productId: z.string().optional(),
  qty: z.coerce.number().int().min(1).max(999).optional(),
});

export const Route = createFileRoute("/chat/farm/$farmId")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Chat with farmer — DiGiFaMaR" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: FarmChatPage,
});

// ─────────────────────────────────────────────────────────────────
// LOCAL STORAGE STORE (demo / Phase 1 only)
// ─────────────────────────────────────────────────────────────────

type Role = "buyer" | "farmer";

interface ChatMsg {
  id: string;
  role: Role;
  text: string;
  ts: number;
  /** "prefill" for the auto product/qty card, otherwise plain text */
  kind?: "prefill" | "text" | "system";
  meta?: { productId?: string; qty?: number; productName?: string; unitPrice?: number };
}

type EscrowStatus = "none" | "held" | "released";

interface EscrowState {
  status: EscrowStatus;
  orderId: string;
  total: number;
  method: "card" | "paypal" | "bank";
  otp: string; // visible to buyer only
  paidAt: number;
  releasedAt?: number;
}

type DeliveryStatus = "idle" | "in_transit" | "arrived" | "released";

interface DeliveryState {
  status: DeliveryStatus;
  startedAt?: number;
  arrivedAt?: number;
  releasedAt?: number;
  farmerLocation?: { lat: number; lng: number; ts: number };
  /** Distance (miles) at the very first GPS fix — used for progress bar. */
  initialDistance?: number;
}

/** Auto-mark "arrived" when farmer is within ~130m of the buyer. */
const ARRIVAL_RADIUS_MI = 0.08;

const storageKey = (farmId: string, productId?: string) =>
  `digifamar.chat.${farmId}.${productId ?? "general"}`;
const escrowKey = (farmId: string, productId?: string) =>
  `digifamar.escrow.${farmId}.${productId ?? "general"}`;
const deliveryKey = (farmId: string, productId?: string) =>
  `digifamar.delivery.${farmId}.${productId ?? "general"}`;


function loadMessages(farmId: string, productId?: string): ChatMsg[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(farmId, productId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatMsg[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveMessages(farmId: string, productId: string | undefined, msgs: ChatMsg[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(farmId, productId), JSON.stringify(msgs));
  } catch {
    /* quota or private mode — ignore */
  }
}

function loadEscrow(farmId: string, productId?: string): EscrowState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(escrowKey(farmId, productId));
    return raw ? (JSON.parse(raw) as EscrowState) : null;
  } catch {
    return null;
  }
}

function saveEscrow(farmId: string, productId: string | undefined, e: EscrowState | null) {
  if (typeof window === "undefined") return;
  try {
    if (e) window.localStorage.setItem(escrowKey(farmId, productId), JSON.stringify(e));
    else window.localStorage.removeItem(escrowKey(farmId, productId));
  } catch {
    /* ignore */
  }
}

function loadDelivery(farmId: string, productId?: string): DeliveryState {
  if (typeof window === "undefined") return { status: "idle" };
  try {
    const raw = window.localStorage.getItem(deliveryKey(farmId, productId));
    return raw ? (JSON.parse(raw) as DeliveryState) : { status: "idle" };
  } catch {
    return { status: "idle" };
  }
}

function saveDelivery(
  farmId: string,
  productId: string | undefined,
  d: DeliveryState | null,
) {
  if (typeof window === "undefined") return;
  try {
    if (d) window.localStorage.setItem(deliveryKey(farmId, productId), JSON.stringify(d));
    else window.localStorage.removeItem(deliveryKey(farmId, productId));
  } catch {
    /* ignore */
  }
}

function generateOtp(): string {
  if (typeof window !== "undefined" && window.crypto?.getRandomValues) {
    const buf = new Uint32Array(1);
    window.crypto.getRandomValues(buf);
    return String(buf[0] % 1_000_000).padStart(6, "0");
  }
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
}

// ─────────────────────────────────────────────────────────────────
// FEE CALC
// ─────────────────────────────────────────────────────────────────

const DELIVERY_RATE_PER_MILE = 1.5;
const DELIVERY_MIN = 5;
const DELIVERY_BASE = 2.99;

function computeDelivery(distanceMi: number | null) {
  if (distanceMi == null || !Number.isFinite(distanceMi))
    return { distance: null as number | null, fee: DELIVERY_MIN };
  const fee = Math.max(DELIVERY_MIN, DELIVERY_BASE + distanceMi * DELIVERY_RATE_PER_MILE);
  return { distance: distanceMi, fee: Math.round(fee * 100) / 100 };
}

// ─────────────────────────────────────────────────────────────────
// FORMAT
// ─────────────────────────────────────────────────────────────────

const formatTime = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const initials = (name: string) =>
  name.split(" ").slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");

// ─────────────────────────────────────────────────────────────────
// DELIVERY TIMELINE
// ─────────────────────────────────────────────────────────────────

function DeliveryTimeline({
  status,
  startedAt,
  arrivedAt,
  releasedAt,
}: {
  status: DeliveryStatus;
  startedAt?: number;
  arrivedAt?: number;
  releasedAt?: number;
}) {
  const steps: {
    key: string;
    label: string;
    icon: typeof Circle;
    done: boolean;
    active: boolean;
    ts?: number;
  }[] = [
    {
      key: "started",
      label: "Delivery Started",
      icon: Truck,
      done: status !== "idle",
      active: status === "in_transit",
      ts: startedAt,
    },
    {
      key: "enroute",
      label: "Farmer En Route",
      icon: Navigation,
      done: status === "arrived" || status === "released",
      active: status === "in_transit",
      ts: startedAt,
    },
    {
      key: "arrival",
      label: "Arrival Confirmed",
      icon: MapPin,
      done: status === "released",
      active: status === "arrived",
      ts: arrivedAt,
    },
    {
      key: "released",
      label: "Payment Released",
      icon: PartyPopper,
      done: status === "released",
      active: status === "released",
      ts: releasedAt,
    },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card p-3 shadow-sm">
      <div className="flex items-center justify-between">
        {steps.map((s, i) => {
          const isLast = i === steps.length - 1;
          const Icon = s.done || s.active ? s.icon : Circle;
          const iconColor = s.done
            ? "text-leaf"
            : s.active
              ? "text-primary"
              : "text-muted-foreground";
          const labelColor = s.done
            ? "text-leaf"
            : s.active
              ? "text-primary"
              : "text-muted-foreground";
          return (
            <div key={s.key} className="flex items-center gap-1.5 flex-1">
              <div className="flex flex-col items-center gap-1 min-w-0 flex-1">
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-full border ${
                    s.done
                      ? "border-leaf bg-leaf/10"
                      : s.active
                        ? "border-primary bg-primary/10"
                        : "border-muted bg-muted/30"
                  }`}
                >
                  <Icon className={`h-3.5 w-3.5 ${iconColor}`} />
                </div>
                <span className={`text-[10px] font-medium leading-tight text-center ${labelColor}`}>
                  {s.label}
                </span>
                {s.ts && (
                  <span className="text-[9px] text-muted-foreground tabular-nums">
                    {formatTime(s.ts)}
                  </span>
                )}
              </div>
              {!isLast && (
                <div
                  className={`h-px w-full max-w-6 mx-0.5 ${
                    s.done ? "bg-leaf/60" : "bg-border"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────

function FarmChatPage() {
  const { farmId } = Route.useParams();
  const { productId, qty } = Route.useSearch();
  

  const farm = getFarm(farmId);
  const product = productId ? getProduct(productId) : undefined;
  const quantity = qty ?? 1;

  const geo = useGeolocation();
  const [messages, setMessages] = useState<ChatMsg[]>(() =>
    loadMessages(farmId, productId),
  );
  const [input, setInput] = useState("");
  const [role, setRole] = useState<Role>("buyer");
  const [showAccept, setShowAccept] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [escrow, setEscrow] = useState<EscrowState | null>(() =>
    loadEscrow(farmId, productId),
  );
  const [showPay, setShowPay] = useState(false);
  const [payMethod, setPayMethod] = useState<"card" | "paypal" | "bank">("card");
  const [paying, setPaying] = useState(false);
  const [showOtp, setShowOtp] = useState(false);
  const [deliveryState, setDeliveryState] = useState<DeliveryState>(() =>
    loadDelivery(farmId, productId),
  );
  const [otpInput, setOtpInput] = useState("");
  const [verifying, setVerifying] = useState(false);
  const watchIdRef = useRef<number | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Persist delivery changes
  useEffect(() => {
    saveDelivery(farmId, productId, deliveryState);
  }, [deliveryState, farmId, productId]);

  // Cross-tab sync: pick up delivery + escrow updates from the other role.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === deliveryKey(farmId, productId) && e.newValue) {
        try {
          setDeliveryState(JSON.parse(e.newValue) as DeliveryState);
        } catch { /* ignore */ }
      }
      if (e.key === escrowKey(farmId, productId) && e.newValue) {
        try {
          setEscrow(JSON.parse(e.newValue) as EscrowState);
        } catch { /* ignore */ }
      }
      if (e.key === storageKey(farmId, productId) && e.newValue) {
        try {
          setMessages(JSON.parse(e.newValue) as ChatMsg[]);
        } catch { /* ignore */ }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [farmId, productId]);

  // Buyer's delivery destination — their geolocation if available, else farm.
  const destination = useMemo(() => {
    if (geo.lat != null && geo.lng != null) {
      return { lat: geo.lat, lng: geo.lng, label: "You" };
    }
    return farm ? { lat: farm.lat, lng: farm.lng, label: farm.name } : null;
  }, [geo.lat, geo.lng, farm]);

  // Live ETA derived from real GPS history: compute moving speed (mph) over
  // the last ~60s of fixes, smooth it with an EMA, and project an ETA that
  // doesn't jitter wildly between updates.
  const locHistoryRef = useRef<Array<{ lat: number; lng: number; ts: number }>>([]);
  const smoothedSpeedRef = useRef<number | null>(null); // mph
  const smoothedEtaRef = useRef<number | null>(null);   // minutes
  const [eta, setEta] = useState<{ miles: number; minutes: number; mph: number } | null>(null);

  useEffect(() => {
    const loc = deliveryState.farmerLocation;
    if (!loc || !destination) {
      locHistoryRef.current = [];
      smoothedSpeedRef.current = null;
      smoothedEtaRef.current = null;
      setEta(null);
      return;
    }

    // Append to history (drop duplicates + entries older than 60s).
    const hist = locHistoryRef.current;
    const last = hist[hist.length - 1];
    if (!last || last.ts !== loc.ts) {
      hist.push(loc);
    }
    const cutoff = loc.ts - 60_000;
    while (hist.length && hist[0].ts < cutoff) hist.shift();
    // Keep at most ~12 fixes
    if (hist.length > 12) hist.splice(0, hist.length - 12);

    // Instantaneous speed from oldest retained fix to newest (mph).
    let instMph: number | null = null;
    if (hist.length >= 2) {
      const a = hist[0];
      const b = hist[hist.length - 1];
      const dtHours = (b.ts - a.ts) / 3_600_000;
      if (dtHours > 0) {
        const dMiles = haversineDistance(a.lat, a.lng, b.lat, b.lng);
        instMph = dMiles / dtHours;
      }
    }

    // EMA smoothing on speed (α=0.35). Fall back to 20 mph until we have data.
    const FALLBACK_MPH = 20;
    if (instMph != null && Number.isFinite(instMph)) {
      // Clamp to a plausible delivery range so a stray GPS jump can't blow it up.
      const clamped = Math.min(60, Math.max(2, instMph));
      smoothedSpeedRef.current =
        smoothedSpeedRef.current == null
          ? clamped
          : smoothedSpeedRef.current * 0.65 + clamped * 0.35;
    }
    const mph = smoothedSpeedRef.current ?? FALLBACK_MPH;

    const miles = haversineDistance(loc.lat, loc.lng, destination.lat, destination.lng);
    const rawMinutes = (miles / mph) * 60;

    // Smooth the ETA itself so the displayed number eases between updates.
    smoothedEtaRef.current =
      smoothedEtaRef.current == null
        ? rawMinutes
        : smoothedEtaRef.current * 0.6 + rawMinutes * 0.4;

    const minutes = Math.max(1, Math.round(smoothedEtaRef.current));
    setEta({ miles, minutes, mph });

    // Capture the very first measured distance as the baseline for the
    // progress bar, and auto-mark "arrived" when the farmer is inside the
    // geofence around the buyer's destination.
    setDeliveryState((d) => {
      const next: DeliveryState = { ...d };
      let changed = false;
      if (next.initialDistance == null || next.initialDistance < miles) {
        next.initialDistance = Math.max(miles, next.initialDistance ?? 0);
        changed = true;
      }
      if (next.status === "in_transit" && miles <= ARRIVAL_RADIUS_MI) {
        next.status = "arrived";
        next.arrivedAt = Date.now();
        changed = true;
      }
      return changed ? next : d;
    });
  }, [deliveryState.farmerLocation, destination]);

  // System message + toast when auto-arrival fires.
  const prevStatusRef = useRef<DeliveryStatus>(deliveryState.status);
  useEffect(() => {
    if (prevStatusRef.current === "in_transit" && deliveryState.status === "arrived") {
      setMessages((prev) => [
        ...prev,
        {
          id: `sys-arrive-${Date.now()}`,
          role: "farmer",
          kind: "system",
          text: "📍 Farmer has arrived. Please inspect the goods and enter the release code.",
          ts: Date.now(),
        },
      ]);
      toast.success("Farmer has arrived", {
        description: "Enter the 6-digit release code to complete delivery.",
      });
    }
    prevStatusRef.current = deliveryState.status;
  }, [deliveryState.status]);

  // Progress along the route (0..1).
  const progress = useMemo(() => {
    const init = deliveryState.initialDistance;
    if (!init || init <= 0 || !eta) return null;
    if (deliveryState.status === "arrived" || deliveryState.status === "released") return 1;
    return Math.min(1, Math.max(0, 1 - eta.miles / init));
  }, [deliveryState.initialDistance, deliveryState.status, eta]);

  const pushSystem = useCallback(
    (text: string, who: Role = "buyer") => {
      setMessages((prev) => [
        ...prev,
        { id: `sys-${who}-${Date.now()}-${Math.random()}`, role: who, kind: "system", text, ts: Date.now() },
      ]);
    },
    [],
  );

  // Stop GPS watch helper
  const stopWatch = useCallback(() => {
    if (watchIdRef.current != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  useEffect(() => stopWatch, [stopWatch]);

  // Auto-stop watch when delivery completes
  useEffect(() => {
    if (deliveryState.status === "released" || deliveryState.status === "idle") {
      stopWatch();
    }
  }, [deliveryState.status, stopWatch]);

  const handleStartDelivery = useCallback(() => {
    if (!("geolocation" in navigator)) {
      toast.error("Live tracking unavailable", {
        description: "Your browser does not support geolocation.",
      });
      return;
    }
    const startedAt = Date.now();
    setDeliveryState((d) => ({ ...d, status: "in_transit", startedAt }));
    pushSystem("🚚 Delivery started — farmer is on the way.", "farmer");
    toast.success("Delivery started", {
      description: "Sharing your live location with the buyer.",
    });
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setDeliveryState((d) => ({
          ...d,
          status: d.status === "released" ? d.status : "in_transit",
          farmerLocation: {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            ts: Date.now(),
          },
        }));
      },
      (err) => {
        toast.error("Location error", { description: err.message });
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    );
  }, [pushSystem]);

  const handleMarkArrived = useCallback(() => {
    setDeliveryState((d) => ({ ...d, status: "arrived", arrivedAt: Date.now() }));
    pushSystem("📍 Farmer has arrived. Please inspect the goods and enter the release code.", "farmer");
  }, [pushSystem]);

  const handleVerifyOtp = useCallback(async () => {
    if (!escrow) return;
    const clean = otpInput.replace(/\D/g, "");
    if (clean.length !== 6) {
      toast.error("Enter all 6 digits");
      return;
    }
    setVerifying(true);
    await new Promise((r) => setTimeout(r, 600));
    if (clean !== escrow.otp) {
      setVerifying(false);
      toast.error("Incorrect code", { description: "Double-check the 6-digit code from the buyer." });
      return;
    }
    const releasedAt = Date.now();
    const nextEscrow: EscrowState = { ...escrow, status: "released", releasedAt };
    setEscrow(nextEscrow);
    saveEscrow(farmId, productId, nextEscrow);
    setDeliveryState((d) => ({ ...d, status: "released", releasedAt }));
    pushSystem("✅ Delivery completed.", "buyer");
    pushSystem(`🎉 Payment Released — $${escrow.total.toFixed(2)} sent to the farmer.`, "buyer");
    setVerifying(false);
    setOtpInput("");
    stopWatch();
    toast.success("Payment Released", {
      description: `$${escrow.total.toFixed(2)} released from escrow to the farmer.`,
    });
  }, [escrow, otpInput, farmId, productId, pushSystem, stopWatch]);




  // Pre-fill the very first message when a product context is present
  useEffect(() => {
    if (!farm) return;
    if (messages.length > 0) return;
    const seed: ChatMsg[] = [];
    if (product) {
      seed.push({
        id: `prefill-${Date.now()}`,
        role: "buyer",
        kind: "prefill",
        text: `Hi! I'd like to buy ${quantity} × ${product.name} at $${product.price.toFixed(
          2,
        )}/${product.unit}. Can we agree on a price?`,
        ts: Date.now(),
        meta: {
          productId: product.id,
          qty: quantity,
          productName: product.name,
          unitPrice: product.price,
        },
      });
      seed.push({
        id: `farmer-greeting-${Date.now() + 1}`,
        role: "farmer",
        kind: "text",
        text: `Hi! Thanks for reaching out about the ${product.name}. ${quantity} ${product.unit}${quantity > 1 ? "s" : ""} is no problem — happy to discuss price.`,
        ts: Date.now() + 1,
      });
    } else {
      seed.push({
        id: `greeting-${Date.now()}`,
        role: "farmer",
        kind: "text",
        text: `Hi! Welcome to ${farm.name}. How can I help you today?`,
        ts: Date.now(),
      });
    }
    setMessages(seed);
    saveMessages(farmId, productId, seed);
  }, [farm, product, quantity, farmId, productId, messages.length]);

  // Persist whenever messages change
  useEffect(() => {
    saveMessages(farmId, productId, messages);
  }, [messages, farmId, productId]);

  // Autoscroll
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  // Keep input focused
  useEffect(() => {
    inputRef.current?.focus();
  }, [role]);

  const distanceMi = useMemo(() => {
    if (!farm || geo.lat == null || geo.lng == null) return null;
    return haversineDistance(geo.lat, geo.lng, farm.lat, farm.lng);
  }, [farm, geo.lat, geo.lng]);

  const subtotal = product ? product.price * quantity : 0;
  const delivery = computeDelivery(distanceMi);
  const total = subtotal + delivery.fee;

  if (!farm) {
    return (
      <AppShell>
        <div className="p-10 text-center text-muted-foreground">
          Farm not found.{" "}
          <Link to="/browse" className="text-primary underline">
            Browse farms
          </Link>
        </div>
      </AppShell>
    );
  }

  const send = () => {
    const text = input.trim();
    if (!text) return;

    // Critical Rule: keep buyer/farmer contact details off the wire.
    const scan = scanForContactInfo(text);
    if (scan.hasContactInfo) {
      toast.error("Message blocked", {
        description: `${CONTACT_BLOCK_WARNING} (Detected: ${describeCategories(
          scan.categories,
        )}.)`,
      });
      return; // keep the text so the sender can rephrase
    }

    setMessages((prev) => [
      ...prev,
      { id: `${role}-${Date.now()}`, role, text, ts: Date.now(), kind: "text" },
    ]);
    setInput("");
    inputRef.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const quickReplies =
    role === "buyer"
      ? [
          "Could you do a small discount for this quantity?",
          "What's your earliest delivery?",
          "Is this freshly harvested?",
        ]
      : [
          `I can do $${product ? (product.price * 0.95).toFixed(2) : "—"}/${product?.unit ?? "unit"} for that quantity.`,
          "Fresh-picked this morning — ready to ship.",
          "Sure, that works. Lock it in?",
        ];

  return (
    <AppShell>
      <div className="min-h-screen bg-background">
        <div className="mx-auto flex h-[calc(100dvh-3.5rem)] max-w-2xl flex-col">
          {/* Header */}
          <div className="flex items-center gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur shrink-0">
            <Link
              to="/farm/$id"
              params={{ id: farm.id }}
              className="rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              aria-label="Back to farm"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>

            <div className="w-10 h-10 rounded-full bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
              <span className="text-sm font-bold text-primary">
                {initials(farm.name)}
              </span>
            </div>

            <div className="flex-1 min-w-0">
              <p className="font-semibold truncate flex items-center gap-1">
                {farm.name}
                {farm.verified && (
                  <BadgeCheck className="h-3.5 w-3.5 text-primary shrink-0" />
                )}
              </p>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" />
                {farm.location}
              </span>
            </div>

            {/* Role toggle so you can demo both sides */}
            <button
              onClick={() => setRole((r) => (r === "buyer" ? "farmer" : "buyer"))}
              className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium hover:border-primary/50 transition-colors"
              title="Switch view (demo)"
            >
              <UserCog className="h-3.5 w-3.5" />
              {role === "buyer" ? "You: Buyer" : "You: Farmer"}
            </button>
          </div>

          {/* Order context strip */}
          {product && (
            <div className="shrink-0 border-b border-border bg-leaf-soft/40 px-4 py-2.5 flex items-center gap-3">
              <img
                src={product.image}
                alt=""
                className="h-10 w-10 rounded-md object-cover"
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">Negotiating</p>
                <p className="text-sm font-semibold truncate">
                  {quantity} × {product.name}{" "}
                  <span className="text-muted-foreground font-normal">
                    · ${product.price.toFixed(2)}/{product.unit}
                  </span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase text-muted-foreground tracking-wide">
                  Subtotal
                </p>
                <p className="text-sm font-bold text-primary">
                  ${subtotal.toFixed(2)}
                </p>
              </div>
            </div>
          )}

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {/* Delivery timeline — visible to both once delivery begins */}
            {deliveryState.status !== "idle" && (
              <div className="flex justify-center">
                <div className="w-full max-w-lg">
                  <DeliveryTimeline
                    status={deliveryState.status}
                    startedAt={deliveryState.startedAt}
                    arrivedAt={deliveryState.arrivedAt}
                    releasedAt={deliveryState.releasedAt}
                  />
                </div>
              </div>
            )}
            {messages.map((m) => {
              const mine = m.role === role;
              if (m.kind === "prefill" && m.meta?.productName) {
                return (
                  <div key={m.id} className="flex justify-center">
                    <div className="max-w-[85%] rounded-2xl border border-primary/30 bg-primary/5 p-3 text-center">
                      <p className="text-[11px] uppercase tracking-wide text-primary font-bold mb-1">
                        Product inquiry
                      </p>
                      <p className="text-sm">
                        <strong>{m.meta.qty} × {m.meta.productName}</strong>
                        {m.meta.unitPrice != null && (
                          <span className="text-muted-foreground">
                            {" "}· ${m.meta.unitPrice.toFixed(2)} ea
                          </span>
                        )}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{m.text}</p>
                    </div>
                  </div>
                );
              }
              if (m.kind === "system") {
                return (
                  <div key={m.id} className="flex justify-center">
                    <div className="max-w-[90%] rounded-full border border-primary/25 bg-primary/5 px-3 py-1.5 text-center text-xs text-primary font-medium">
                      {m.text}
                    </div>
                  </div>
                );
              }
              return (
                <div
                  key={m.id}
                  className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
                >
                  <div
                    className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${
                      mine
                        ? "bg-primary text-primary-foreground rounded-br-sm"
                        : "bg-card border border-border rounded-bl-sm"
                    }`}
                  >
                    {m.text}
                  </div>
                  <span className="mt-0.5 text-[10px] text-muted-foreground px-1">
                    {m.role === "farmer" ? farm.name.split(" ")[0] : "You"} ·{" "}
                    {formatTime(m.ts)}
                  </span>
                </div>
              );
            })}

            {/* Live tracking map (rendered inline in chat) */}
            {(deliveryState.status === "in_transit" || deliveryState.status === "arrived") && destination && (
              <div className="rounded-2xl border border-primary/30 bg-card p-3 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                    <Navigation className="h-3.5 w-3.5" />
                    {deliveryState.status === "arrived" ? "Farmer has arrived" : "Live tracking"}
                    <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-leaf animate-pulse" />
                  </div>
                  {eta && deliveryState.status === "in_transit" && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {eta.miles.toFixed(1)} mi · ~{eta.minutes} min
                      <span className="ml-1 opacity-70">· {Math.round(eta.mph)} mph</span>
                    </span>
                  )}
                </div>
                <LiveTrackingMap
                  farmer={deliveryState.farmerLocation ?? null}
                  destination={destination}
                  farmerLabel={farm.name}
                />
                {progress != null && (
                  <div className="mt-3">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-leaf transition-all duration-700 ease-out"
                        style={{ width: `${Math.round(progress * 100)}%` }}
                      />
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
                      <span>
                        {deliveryState.initialDistance
                          ? `${(deliveryState.initialDistance - (eta?.miles ?? 0)).toFixed(1)} mi travelled`
                          : "Tracking…"}
                      </span>
                      <span>{Math.round(progress * 100)}% to destination</span>
                    </div>
                  </div>
                )}
                {!deliveryState.farmerLocation && (
                  <p className="mt-2 text-[11px] text-muted-foreground text-center">
                    Waiting for farmer's first location update…
                  </p>
                )}
              </div>
            )}
          </div>



          {/* Quick replies */}
          <div className="shrink-0 flex gap-2 overflow-x-auto px-4 pb-2 scrollbar-none">
            {quickReplies.map((q) => (
              <button
                key={q}
                onClick={() => setInput(q)}
                className="shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors whitespace-nowrap"
              >
                {q}
              </button>
            ))}
          </div>

          {/* Accept price bar (buyer only) */}
          {role === "buyer" && product && !accepted && (
            <div className="shrink-0 border-t border-border bg-card px-4 py-3">
              <Button
                onClick={() => setShowAccept(true)}
                className="w-full h-11 bg-primary text-primary-foreground hover:bg-primary-hover font-semibold"
              >
                <ShieldCheck className="h-4 w-4 mr-2" />
                Accept Price · ${subtotal.toFixed(2)}
              </Button>
            </div>
          )}

          {/* Escrow status banner — visible to both roles once funds are held */}
          {escrow?.status === "held" && (
            <div className="shrink-0 border-t border-primary/30 bg-primary/10 px-4 py-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                  <Lock className="h-4 w-4" />
                  Funds Secured in Escrow
                  <span className="text-xs text-muted-foreground font-normal">
                    · ${escrow.total.toFixed(2)} · {escrow.method === "card" ? "Card" : escrow.method === "paypal" ? "PayPal" : "Bank transfer"}
                  </span>
                </div>
                {role === "buyer" && (
                  <button
                    onClick={() => setShowOtp((v) => !v)}
                    className="flex items-center gap-1.5 rounded-full border border-primary/40 bg-background px-3 py-1 text-xs font-mono font-bold text-primary hover:bg-primary/5"
                    aria-label={showOtp ? "Hide release code" : "Reveal release code"}
                  >
                    {showOtp ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    {showOtp ? escrow.otp : "•• •• ••"}
                  </button>
                )}
              </div>
              {role === "buyer" && showOtp && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Share this 6-digit code with the farmer ONLY when your order is delivered. This releases the funds.
                </p>
              )}
            </div>
          )}

          {/* PHASE 3 — Delivery action panel */}
          {escrow?.status === "held" && deliveryState.status === "idle" && role === "farmer" && (
            <div className="shrink-0 border-t border-border bg-card px-4 py-3">
              <Button
                onClick={handleStartDelivery}
                className="w-full h-11 bg-primary text-primary-foreground hover:bg-primary-hover font-semibold"
              >
                <Truck className="h-4 w-4 mr-2" />
                Start Delivery
              </Button>
              <p className="mt-1.5 text-[11px] text-center text-muted-foreground">
                Your live location will be shared with the buyer.
              </p>
            </div>
          )}
          {escrow?.status === "held" && deliveryState.status === "idle" && role === "buyer" && (
            <div className="shrink-0 border-t border-border bg-card px-4 py-3 text-center text-xs text-muted-foreground">
              <Loader2 className="inline h-3.5 w-3.5 mr-1 animate-spin" />
              Waiting for farmer to start delivery…
            </div>
          )}

          {deliveryState.status === "in_transit" && role === "farmer" && (
            <div className="shrink-0 border-t border-border bg-card px-4 py-3">
              <Button
                onClick={handleMarkArrived}
                variant="outline"
                className="w-full h-11 font-semibold border-primary/40 text-primary hover:bg-primary/5"
              >
                <MapPin className="h-4 w-4 mr-2" />
                I've Arrived
              </Button>
            </div>
          )}

          {/* Buyer OTP entry — once farmer has arrived */}
          {deliveryState.status === "arrived" && escrow?.status === "held" && role === "buyer" && (
            <div className="shrink-0 border-t border-border bg-card px-4 py-3 space-y-2">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-primary">
                <KeyRound className="h-4 w-4" />
                Enter 6-digit release code
              </div>
              <p className="text-[11px] text-muted-foreground">
                Inspect the goods, then enter the code to release ${escrow.total.toFixed(2)} from escrow.
              </p>
              <div className="flex gap-2">
                <Input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={otpInput}
                  onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="••••••"
                  className="flex-1 h-11 text-center font-mono text-lg tracking-[0.4em]"
                />
                <Button
                  onClick={handleVerifyOtp}
                  disabled={otpInput.length !== 6 || verifying}
                  className="h-11 bg-primary text-primary-foreground hover:bg-primary-hover font-semibold"
                >
                  {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : "Release"}
                </Button>
              </div>
            </div>
          )}

          {deliveryState.status === "arrived" && role === "farmer" && (
            <div className="shrink-0 border-t border-border bg-card px-4 py-3 text-center text-xs text-muted-foreground">
              Waiting for buyer to enter the 6-digit release code…
            </div>
          )}

          {/* Released — final celebratory state */}
          {(escrow?.status === "released" || deliveryState.status === "released") && (
            <div className="shrink-0 border-t border-leaf/40 bg-leaf-soft px-4 py-3">
              <div className="flex items-center justify-center gap-2 text-sm font-semibold text-primary">
                <CheckCircle2 className="h-4 w-4" />
                Payment Released
                <PartyPopper className="h-4 w-4" />
              </div>
              {escrow && (
                <p className="mt-1 text-[11px] text-center text-muted-foreground">
                  ${escrow.total.toFixed(2)} released to the farmer · Order #{escrow.orderId}
                </p>
              )}
            </div>
          )}



          {/* Pay into escrow CTA (buyer only, post price-accept, pre-payment) */}
          {role === "buyer" && accepted && !escrow && (
            <div className="shrink-0 border-t border-border bg-card px-4 py-3">
              <Button
                onClick={() => setShowPay(true)}
                className="w-full h-11 bg-primary text-primary-foreground hover:bg-primary-hover font-semibold"
              >
                <Lock className="h-4 w-4 mr-2" />
                Pay into Escrow · ${total.toFixed(2)}
              </Button>
              <p className="mt-1.5 text-[11px] text-center text-muted-foreground">
                Funds are held safely until you confirm delivery.
              </p>
            </div>
          )}

          {/* Input bar */}
          <div className="shrink-0 border-t border-border bg-background px-4 py-3">
            <div className="flex items-center gap-2">
              <Input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKey}
                placeholder={`Message as ${role}…`}
                className="flex-1 h-11 rounded-2xl"
              />
              <Button
                onClick={send}
                disabled={!input.trim()}
                size="icon"
                className="h-11 w-11 rounded-2xl"
                aria-label="Send"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Accept Price → distance + delivery + total sheet */}
      <Sheet open={showAccept} onOpenChange={setShowAccept}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader className="text-left">
            <SheetTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Confirm order total
            </SheetTitle>
            <SheetDescription>
              Delivery fee is calculated from your current location to the farm.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-5 space-y-4">
            {/* Distance card */}
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 text-sm font-semibold mb-2">
                <Truck className="h-4 w-4 text-primary" />
                Delivery distance
              </div>
              {geo.loading && (
                <p className="text-sm text-muted-foreground">
                  Detecting your location…
                </p>
              )}
              {!geo.loading && distanceMi != null && (
                <p className="text-sm">
                  <strong>{distanceMi.toFixed(1)} mi</strong>
                  <span className="text-muted-foreground">
                    {" "}from {farm.location} to you
                  </span>
                </p>
              )}
              {!geo.loading && distanceMi == null && (
                <p className="text-sm text-muted-foreground">
                  Couldn't detect your location — using minimum delivery fee.
                </p>
              )}
            </div>

            {/* Line items */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-2 text-sm">
              {product && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {quantity} × {product.name}
                  </span>
                  <span>${subtotal.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Delivery
                  {distanceMi != null && (
                    <span className="text-xs">
                      {" "}({distanceMi.toFixed(1)} mi × ${DELIVERY_RATE_PER_MILE}/mi)
                    </span>
                  )}
                </span>
                <span>${delivery.fee.toFixed(2)}</span>
              </div>
              <div className="border-t border-border pt-2 mt-2 flex justify-between text-base font-bold">
                <span>Total</span>
                <span className="text-primary">${total.toFixed(2)}</span>
              </div>
            </div>

            <p className="text-xs text-muted-foreground text-center">
              Next: escrow payment + 6-digit release code (coming in Phase 2).
            </p>
          </div>

          <SheetFooter className="mt-5 flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => setShowAccept(false)}
              className="flex-1"
            >
              Keep negotiating
            </Button>
            <Button
              onClick={() => {
                setAccepted(true);
                setShowAccept(false);
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `system-${Date.now()}`,
                    role: "buyer",
                    kind: "system",
                    text: `✓ Price accepted. Order total: $${total.toFixed(2)} (${distanceMi != null ? `${distanceMi.toFixed(1)} mi delivery` : "min delivery"}).`,
                    ts: Date.now(),
                  },
                ]);
              }}
              className="flex-1 bg-primary text-primary-foreground hover:bg-primary-hover"
            >
              Accept · ${total.toFixed(2)}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Pay into Escrow sheet */}
      <Sheet open={showPay} onOpenChange={(o) => !paying && setShowPay(o)}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader className="text-left">
            <SheetTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-primary" />
              Escrow payment
            </SheetTitle>
            <SheetDescription>
              Choose a payment method. Funds are held by DiGiFaMaR until you confirm delivery.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-5 space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: "card", label: "Card", sub: "Visa, Mastercard", Icon: CreditCard },
                  { id: "paypal", label: "PayPal", sub: "PayPal balance", Icon: Wallet },
                  { id: "bank", label: "Bank Transfer", sub: "Direct deposit", Icon: Building2 },
                ] as const
              ).map(({ id, label, sub, Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setPayMethod(id)}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    payMethod === id
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:border-primary/40"
                  }`}
                >
                  <Icon className="h-5 w-5 text-primary mb-2" />
                  <p className="text-sm font-semibold">{label}</p>
                  <p className="text-[11px] text-muted-foreground leading-tight">{sub}</p>
                </button>
              ))}
            </div>

            <div className="rounded-xl border border-border bg-card p-4 space-y-1.5 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span>${subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Delivery</span>
                <span>${delivery.fee.toFixed(2)}</span>
              </div>
              <div className="border-t border-border pt-2 mt-1 flex justify-between font-bold text-base">
                <span>Held in escrow</span>
                <span className="text-primary">${total.toFixed(2)}</span>
              </div>
            </div>

            <p className="text-[11px] text-center text-muted-foreground">
              A 6-digit release code will be sent to your phone after payment. Demo only — no real charge.
            </p>
          </div>

          <SheetFooter className="mt-5 flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => setShowPay(false)}
              disabled={paying}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              disabled={paying}
              onClick={async () => {
                setPaying(true);
                await new Promise((r) => setTimeout(r, 1200));
                const otp = generateOtp();
                const orderId = `DFM-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
                const next: EscrowState = {
                  status: "held",
                  orderId,
                  total,
                  method: payMethod,
                  otp,
                  paidAt: Date.now(),
                };
                setEscrow(next);
                saveEscrow(farmId, productId, next);
                const now = Date.now();
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `sys-paid-${now}`,
                    role: "buyer",
                    kind: "system",
                    text: `🔒 Payment has been received into escrow ($${total.toFixed(2)}). Waiting for farmer to start delivery.`,
                    ts: now,
                  },
                  {
                    id: `sys-farmer-${now + 1}`,
                    role: "farmer",
                    kind: "system",
                    text: `💰 Payment received into escrow. Ready to start delivery. Order #${orderId}.`,
                    ts: now + 1,
                  },
                ]);
                setPaying(false);
                setShowPay(false);
                setShowOtp(true);
                toast.success("Payment held in escrow", {
                  description: `SMS sent to your phone with release code ${otp}.`,
                });
              }}
              className="flex-1 bg-primary text-primary-foreground hover:bg-primary-hover"
            >
              {paying ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing…
                </>
              ) : (
                <>Pay ${total.toFixed(2)}</>
              )}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

    </AppShell>
  );
}
