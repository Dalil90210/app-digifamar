import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Send,
  ArrowLeft,
  BadgeCheck,
  ShieldCheck,
  Truck,
  Lock,
  CreditCard,
  Building2,
  Wallet,
  Loader2,
  Eye,
  EyeOff,
  KeyRound,
  Check,
  CheckCircle2,
  MessageSquare,
  PartyPopper,
  Navigation,
  MapPin,
  AlertTriangle,
  RefreshCw,
  FlaskConical,
} from "lucide-react";
import { z } from "zod";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { LiveTrackingMap } from "@/components/LiveTrackingMap";
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
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useGeolocation } from "@/hooks/use-geolocation";
import { supabase } from "@/integrations/supabase/client";
import { deliveryFeeCents, haversineMiles } from "@/lib/chat/delivery";
import { formatCents } from "@/lib/cart/fees";
import {
  scanForContactInfo,
  describeCategories,
  CONTACT_BLOCK_WARNING,
} from "@/lib/chat/contact-guard";

// ─────────────────────────────────────────────────────────────────
// ROUTE
// ─────────────────────────────────────────────────────────────────

// Product context is carried in the URL when a buyer opens a chat straight from
// a product/farm page, so the very first message can be pre-filled.
const searchSchema = z.object({
  productId: z.string().optional(),
  productName: z.string().optional(),
  unitPriceCents: z.coerce.number().int().min(0).optional(),
  unit: z.string().optional(),
  qty: z.coerce.number().int().min(1).max(9999).optional(),
});

export const Route = createFileRoute("/chat/$productId")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [{ title: "Chat — DiGiFaMaR" }, { name: "robots", content: "noindex" }],
  }),
  component: ChatThread,
});

// ─────────────────────────────────────────────────────────────────
// TYPES (the chat tables are not in the generated client types yet, so we
// describe the rows we read here and talk to Supabase through an `any` handle.)
// ─────────────────────────────────────────────────────────────────

type NegotiationStatus = "negotiating" | "accepted";
type EscrowStatus = "none" | "held" | "released";
type PaymentMethod = "card" | "paypal" | "bank";

interface Conversation {
  id: string;
  buyer_id: string;
  farmer_id: string;
  farm_name: string | null;
  product_id: string | null;
  product_name: string | null;
  qty: number | null;
  unit: string | null;
  unit_price_cents: number | null;
  negotiation_status: NegotiationStatus;
  negotiated_price_cents: number | null;
  distance_mi: number | null;
  delivery_fee_cents: number | null;
  escrow_status: EscrowStatus;
  escrow_total_cents: number | null;
  payment_method: PaymentMethod | null;
  order_id: string | null;
  delivery_status: DeliveryStatus;
  delivery_started_at: string | null;
}

type DeliveryStatus = "idle" | "in_transit" | "arrived";

interface LatLng {
  lat: number;
  lng: number;
  ts: number;
}

interface DbMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  kind: "text" | "system" | "prefill";
  metadata: Record<string, unknown> | null;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Real Supabase rows use UUIDs; the simulated/mock path uses "DFM-XXXX" ids. */
const isUuid = (s: string | null | undefined): s is string => !!s && UUID_RE.test(s);

const otpKey = (conversationId: string) => `digifamar.otp.${conversationId}`;

/**
 * Pull the human-readable error our edge functions return ({ success:false,
 * error }) out of a supabase.functions.invoke failure, falling back to a generic
 * message when the body can't be read.
 */
async function readFnError(error: unknown, fallback: string): Promise<string> {
  const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } })?.context;
  if (ctx?.json) {
    try {
      const body = await ctx.json();
      if (body?.error) return body.error;
    } catch {
      /* not JSON — use fallback */
    }
  }
  return fallback;
}

function generateOtp(): string {
  if (typeof window !== "undefined" && window.crypto?.getRandomValues) {
    const buf = new Uint32Array(1);
    window.crypto.getRandomValues(buf);
    return String(buf[0] % 1_000_000).padStart(6, "0");
  }
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
}

const QUICK_REPLIES = [
  "Could you do a discount for this quantity?",
  "When's your earliest delivery?",
  "Is this freshly harvested?",
];

// ─────────────────────────────────────────────────────────────────
// ESCROW STATUS STEPPER
// ─────────────────────────────────────────────────────────────────

const ESCROW_STAGES = [
  { key: "negotiate", label: "Negotiate", Icon: MessageSquare },
  { key: "accepted", label: "Accepted", Icon: ShieldCheck },
  { key: "escrow", label: "In Escrow", Icon: Lock },
  { key: "released", label: "Released", Icon: PartyPopper },
] as const;

/** Compact 4-step progress bar shown once a deal is in progress (0..3). */
function EscrowStepper({ stage }: { stage: number }) {
  return (
    <div className="shrink-0 border-b border-[#1E3A1E] bg-[#060F06] px-4 pt-3 pb-2">
      <div className="flex items-start">
        {ESCROW_STAGES.map((s, i) => {
          const done = i < stage;
          const active = i === stage;
          const Icon = done ? Check : s.Icon;
          const isLast = i === ESCROW_STAGES.length - 1;
          return (
            <Fragment key={s.key}>
              <div className="flex w-14 shrink-0 flex-col items-center gap-1 sm:w-16">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full border transition-all duration-300 ${
                    done
                      ? "border-[#4ADE80] bg-[#4ADE80] text-black"
                      : active
                        ? "border-[#F97316] bg-[#F97316]/15 text-[#F97316] ring-2 ring-[#F97316]/25"
                        : "border-[#1E3A1E] bg-[#0C1A0C] text-[#7AAB7A]"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <span
                  className={`text-center text-[10px] font-medium leading-tight ${
                    done ? "text-[#4ADE80]" : active ? "text-[#F97316]" : "text-[#7AAB7A]"
                  }`}
                >
                  {s.label}
                </span>
              </div>
              {!isLast && (
                <div className="mt-4 h-0.5 flex-1 overflow-hidden rounded bg-[#1E3A1E]">
                  <div
                    className={`h-full rounded bg-[#4ADE80] transition-all duration-500 ${
                      i < stage ? "w-full" : "w-0"
                    }`}
                  />
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

/** Shimmer placeholders shown while the thread loads. */
function ChatSkeleton() {
  return (
    <div className="space-y-4 py-2">
      {[
        { mine: false, w: "w-40" },
        { mine: true, w: "w-52" },
        { mine: false, w: "w-32" },
        { mine: true, w: "w-44" },
      ].map((b, i) => (
        <div key={i} className={`flex ${b.mine ? "justify-end" : "justify-start"}`}>
          <div className={`h-9 ${b.w} animate-pulse rounded-2xl bg-[#132013]`} />
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// DELIVERY TIMELINE
// ─────────────────────────────────────────────────────────────────

/** Auto-mark "arrived" once the farmer is within ~130 m of the buyer. */
const ARRIVAL_RADIUS_MI = 0.08;

function DeliveryTimeline({
  deliveryStatus,
  released,
  startedAt,
}: {
  deliveryStatus: DeliveryStatus;
  released: boolean;
  startedAt?: string | null;
}) {
  const enRoute = deliveryStatus === "in_transit";
  const arrived = deliveryStatus === "arrived" || released;
  const steps = [
    {
      key: "started",
      label: "Out for delivery",
      Icon: Truck,
      done: deliveryStatus !== "idle",
      active: enRoute,
    },
    { key: "enroute", label: "En route", Icon: Navigation, done: arrived, active: enRoute },
    {
      key: "arrival",
      label: "Arrived",
      Icon: MapPin,
      done: released,
      active: deliveryStatus === "arrived",
    },
    { key: "released", label: "Released", Icon: PartyPopper, done: released, active: released },
  ];

  return (
    <div className="rounded-2xl border border-[#1E3A1E] bg-[#0C1A0C] p-3">
      <div className="flex items-start">
        {steps.map((s, i) => {
          const isLast = i === steps.length - 1;
          const Icon = s.done ? Check : s.Icon;
          const tone = s.done ? "text-[#4ADE80]" : s.active ? "text-[#F97316]" : "text-[#7AAB7A]";
          return (
            <Fragment key={s.key}>
              <div className="flex w-14 shrink-0 flex-col items-center gap-1 sm:w-16">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full border transition-all duration-300 ${
                    s.done
                      ? "border-[#4ADE80] bg-[#4ADE80] text-black"
                      : s.active
                        ? "border-[#F97316] bg-[#F97316]/15 text-[#F97316] ring-2 ring-[#F97316]/25"
                        : "border-[#1E3A1E] bg-[#060F06]"
                  }`}
                >
                  <Icon className={`h-4 w-4 ${s.done ? "text-black" : tone}`} />
                </div>
                <span className={`text-center text-[10px] font-medium leading-tight ${tone}`}>
                  {s.label}
                </span>
              </div>
              {!isLast && (
                <div className="mt-4 h-0.5 flex-1 overflow-hidden rounded bg-[#1E3A1E]">
                  <div
                    className={`h-full rounded bg-[#4ADE80] transition-all duration-500 ${
                      s.done ? "w-full" : "w-0"
                    }`}
                  />
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
      {startedAt && deliveryStatus !== "idle" && (
        <p className="mt-2 text-center text-[10px] text-[#7AAB7A]">
          Started {formatTime(startedAt)}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// TRACKING FALLBACK CARDS
// ─────────────────────────────────────────────────────────────────

/** Buyer-side prompt when we don't yet have their location for the map.
 *  Offers GPS retry AND a manual ZIP/city fallback so a denied permission is
 *  never a dead end. */
function LocationPermissionCard({ geo }: { geo: ReturnType<typeof useGeolocation> }) {
  const [manual, setManual] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const denied = geo.error === "permission_denied" || geo.error === "http_blocked";

  const submitManual = async () => {
    const value = manual.trim();
    if (!value || submitting) return;
    setSubmitting(true);
    try {
      await geo.setManualLocation(value);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-2xl border border-dashed border-[#1E3A1E] bg-[#0a160a] p-4 sm:p-5">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#4ADE80]/10">
          {geo.loading ? (
            <Loader2 className="h-5 w-5 animate-spin text-[#4ADE80]" />
          ) : (
            <MapPin className="h-5 w-5 text-[#4ADE80]" />
          )}
        </div>
        <p className="text-sm font-semibold text-[#F0FFF0]">
          {geo.loading
            ? "Finding your location…"
            : denied
              ? "Location is turned off"
              : "Where should we deliver?"}
        </p>
        <p className="max-w-[18rem] text-[11px] leading-relaxed text-[#7AAB7A]">
          {denied
            ? "You blocked location access. Allow it in your browser settings and retry — or just enter your ZIP code below to track the delivery."
            : "Share your location to follow the farmer live with an accurate ETA — or enter your ZIP code below."}
        </p>
      </div>

      {/* Manual ZIP / city fallback */}
      <div className="mt-3 flex gap-2">
        <Input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submitManual();
            }
          }}
          placeholder="ZIP code or city"
          aria-label="Delivery ZIP code or city"
          className="h-10 flex-1 bg-[#132013] border-[#1E3A1E] text-[#F0FFF0] placeholder:text-[#7AAB7A]/50 focus:border-[#4ADE80]"
        />
        <Button
          onClick={() => void submitManual()}
          disabled={!manual.trim() || submitting || geo.loading}
          className="h-10 bg-[#4ADE80] px-4 font-semibold text-black hover:bg-[#22C55E] disabled:opacity-40"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Use"}
        </Button>
      </div>
      {geo.error === "lookup_failed" && (
        <p className="mt-1.5 text-[11px] text-[#F97316]">
          We couldn't find that place — try a 5-digit ZIP code.
        </p>
      )}

      {!geo.loading && (
        <button
          type="button"
          onClick={geo.detect}
          className="mt-3 flex w-full items-center justify-center gap-1.5 text-[11px] font-semibold text-[#4ADE80] hover:underline"
        >
          <Navigation className="h-3.5 w-3.5" /> Use my current location instead
        </button>
      )}
    </div>
  );
}

/** Farmer-side panel confirming their location is being shared. */
function FarmerSharingCard({ sharing }: { sharing: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-[#1E3A1E] bg-[#0a160a] px-4 py-8 text-center sm:py-10">
      <div className="relative flex h-11 w-11 items-center justify-center rounded-full bg-[#4ADE80]/10">
        <Navigation className="h-5 w-5 text-[#4ADE80]" />
        {sharing && (
          <span className="absolute inset-0 animate-ping rounded-full border border-[#4ADE80]/40" />
        )}
      </div>
      <p className="text-sm font-semibold text-[#F0FFF0]">
        {sharing ? "Sharing your live location" : "Starting location sharing…"}
      </p>
      <p className="max-w-[16rem] text-[11px] leading-relaxed text-[#7AAB7A]">
        The buyer can see you moving toward them in real time. Keep this screen open until you
        arrive.
      </p>
    </div>
  );
}

/** Shown when the conversation fails to load (network/DB error). */
function ChatErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#F97316]/10">
        <AlertTriangle className="h-6 w-6 text-[#F97316]" />
      </div>
      <p className="text-sm font-semibold text-[#F0FFF0]">Couldn't load this conversation</p>
      <p className="max-w-xs text-xs text-[#7AAB7A]">
        Something went wrong reaching the server. Check your connection and try again.
      </p>
      <Button
        onClick={onRetry}
        size="sm"
        className="mt-1 bg-[#4ADE80] font-semibold text-black hover:bg-[#22C55E]"
      >
        <RefreshCw className="mr-1.5 h-4 w-4" /> Retry
      </Button>
    </div>
  );
}

/** Shown when the conversation doesn't exist or the user has no access. */
function ChatNotFoundState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#132013]">
        <MessageSquare className="h-6 w-6 text-[#7AAB7A]" />
      </div>
      <p className="text-sm font-semibold text-[#F0FFF0]">Conversation not found</p>
      <p className="max-w-xs text-xs text-[#7AAB7A]">
        It may have been removed, or you don't have access to it.
      </p>
      <Link to="/chat" className="mt-1 text-sm font-semibold text-[#4ADE80] hover:underline">
        Back to messages
      </Link>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────

function ChatThread() {
  const { productId: conversationId } = Route.useParams();
  const search = Route.useSearch();
  const { user } = useAuth();
  const geo = useGeolocation();
  const sb = supabase as any;

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [farmerCoords, setFarmerCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [messages, setMessages] = useState<DbMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Negotiation / escrow UI
  const [showAccept, setShowAccept] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [showPay, setShowPay] = useState(false);
  const [payMethod, setPayMethod] = useState<PaymentMethod>("card");
  const [paying, setPaying] = useState(false);
  const [showOtp, setShowOtp] = useState(false);
  const [otp, setOtp] = useState<string | null>(null);
  const [otpInput, setOtpInput] = useState("");
  const [releasing, setReleasing] = useState(false);

  // Live delivery tracking
  const [farmerLoc, setFarmerLoc] = useState<LatLng | null>(null);
  const [eta, setEta] = useState<{ miles: number; minutes: number; progress: number } | null>(null);
  const [startingDelivery, setStartingDelivery] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const seededRef = useRef(false);
  const deliveryChannelRef = useRef<RealtimeChannel | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const locHistoryRef = useRef<LatLng[]>([]);
  const speedRef = useRef<number | null>(null); // smoothed mph
  const arrivedSentRef = useRef(false);
  const initialDistRef = useRef<number | null>(null); // baseline for progress bar

  const isBuyer = !!user && !!conversation && user.id === conversation.buyer_id;

  // ── Load conversation (with farmer location) + messages ─────────────────────
  const loadConversation = useCallback(async () => {
    const { data } = await sb
      .from("conversations")
      .select(
        "id, buyer_id, farmer_id, farm_name, product_id, product_name, qty, unit, unit_price_cents, negotiation_status, negotiated_price_cents, distance_mi, delivery_fee_cents, escrow_status, escrow_total_cents, payment_method, order_id, delivery_status, delivery_started_at",
      )
      .eq("id", conversationId)
      .maybeSingle();
    if (data) setConversation(data as Conversation);
    return data as Conversation | null;
  }, [conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setLoadError(false);
      try {
        const conv = await loadConversation();
        if (cancelled) return;

        const [msgsRes, otpRaw] = await Promise.all([
          sb
            .from("messages")
            .select("id, conversation_id, sender_id, body, kind, metadata, created_at")
            .eq("conversation_id", conversationId)
            .order("created_at", { ascending: true }),
          Promise.resolve(
            typeof window !== "undefined"
              ? window.localStorage.getItem(otpKey(conversationId))
              : null,
          ),
        ]);
        if (cancelled) return;
        setMessages((msgsRes.data ?? []) as DbMessage[]);
        if (otpRaw) setOtp(otpRaw);

        // Pull the farmer's coordinates for distance/delivery-fee calculation.
        if (conv?.farmer_id) {
          const { data: prof } = await sb
            .from("farmer_profiles")
            .select("lat, lng, farm_name")
            .eq("user_id", conv.farmer_id)
            .maybeSingle();
          if (!cancelled && prof?.lat != null && prof?.lng != null) {
            setFarmerCoords({ lat: prof.lat, lng: prof.lng });
          }
        }
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId, loadConversation, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Realtime: append new messages; refetch deal state on system events ──────
  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`chat:${conversationId}`)
      .on(
        "postgres_changes" as any,
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload: any) => {
          const incoming = payload.new as DbMessage;
          setMessages((prev) =>
            prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming],
          );
          // A system card means the conversation's negotiation/escrow state just
          // changed — pull the fresh row so both sides stay in sync.
          if (incoming.kind === "system") void loadConversation();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId, loadConversation]);

  // ── Seed product context + the pre-filled opening message (buyer only) ──────
  useEffect(() => {
    if (loading || seededRef.current || !user || !conversation) return;
    if (user.id !== conversation.buyer_id) return;
    seededRef.current = true;

    (async () => {
      // 1) Persist product context arriving via the URL onto the conversation.
      if (!conversation.product_name && search.productName) {
        const patch = {
          product_id: search.productId ?? conversation.product_id,
          product_name: search.productName,
          qty: search.qty ?? 1,
          unit: search.unit ?? null,
          unit_price_cents: search.unitPriceCents ?? null,
        };
        await sb.from("conversations").update(patch).eq("id", conversationId);
        setConversation((c) => (c ? { ...c, ...patch } : c));
      }

      // 2) Pre-fill the opening message if the thread is empty.
      const name = search.productName ?? conversation.product_name;
      const qty = search.qty ?? conversation.qty ?? 1;
      const price = search.unitPriceCents ?? conversation.unit_price_cents ?? null;
      if (messages.length === 0 && name) {
        const priceLabel = price != null ? ` at ${formatCents(price)} ea` : "";
        await sb.from("messages").insert({
          conversation_id: conversationId,
          sender_id: user.id,
          kind: "prefill",
          body: `Hi! I'd like to buy ${qty} × ${name}${priceLabel}. Can we agree on a price?`,
          metadata: { product_name: name, qty, unit_price_cents: price },
        });
      }
    })();
  }, [loading, user, conversation, search, conversationId, messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mark the other party's messages read ────────────────────────────────────
  useEffect(() => {
    if (!user || !conversationId || messages.length === 0) return;
    void sb
      .from("messages")
      .update({ is_read: true })
      .eq("conversation_id", conversationId)
      .neq("sender_id", user.id)
      .eq("is_read", false);
  }, [messages, user, conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Autoscroll ──────────────────────────────────────────────────────────────
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  // ── Derived pricing ─────────────────────────────────────────────────────────
  const qty = conversation?.qty ?? 1;
  const subtotalCents =
    conversation?.negotiated_price_cents ??
    (conversation?.unit_price_cents != null ? conversation.unit_price_cents * qty : 0);

  const distanceMi = useMemo(() => {
    if (conversation?.distance_mi != null) return conversation.distance_mi;
    if (!farmerCoords || geo.lat == null || geo.lng == null) return null;
    return haversineMiles(farmerCoords.lat, farmerCoords.lng, geo.lat, geo.lng);
  }, [conversation?.distance_mi, farmerCoords, geo.lat, geo.lng]);

  const deliveryCents = conversation?.delivery_fee_cents ?? deliveryFeeCents(distanceMi);
  const totalCents = conversation?.escrow_total_cents ?? subtotalCents + deliveryCents;

  const postSystem = useCallback(
    async (body: string, metadata: Record<string, unknown> = {}) => {
      if (!user) return;
      await sb.from("messages").insert({
        conversation_id: conversationId,
        sender_id: user.id,
        kind: "system",
        body,
        metadata,
      });
    },
    [user, conversationId], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ── Send a chat message ─────────────────────────────────────────────────────
  const handleSend = async () => {
    const text = input.trim();
    if (!text || !user || sending) return;

    // Critical Rule: keep personal contact info off the platform.
    const scan = scanForContactInfo(text);
    if (scan.hasContactInfo) {
      toast.error("Message blocked", {
        description: `${CONTACT_BLOCK_WARNING} (Detected: ${describeCategories(scan.categories)}.)`,
      });
      return;
    }

    setSending(true);
    setInput("");
    try {
      await sb.from("messages").insert({
        conversation_id: conversationId,
        sender_id: user.id,
        kind: "text",
        body: text,
      });
      await sb
        .from("conversations")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", conversationId);
    } catch {
      setInput(text); // restore so the user can retry
      toast.error("Message not sent", {
        description: "Check your connection and try again.",
      });
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── Accept price → lock negotiation, compute delivery, create the order ─────
  const handleAcceptPrice = async () => {
    if (!conversation || accepting || !user) return;
    setAccepting(true);
    try {
      const locked = subtotalCents;
      const dist = distanceMi;
      const fee = deliveryFeeCents(dist);

      // When the conversation is tied to a REAL Supabase listing, create a real
      // order row. The validate_order_insert trigger resolves farmer_id and
      // recomputes platform/escrow fees + total server-side. For mock farms
      // (no real listing) we fall back to a simulated total on the conversation.
      let realOrderId: string | null = null;
      let realTotal: number | null = null;
      if (isUuid(conversation.product_id)) {
        const { data: listing } = await sb
          .from("listings")
          .select("id")
          .eq("id", conversation.product_id)
          .maybeSingle();
        if (listing?.id) {
          const { data: profile } = await sb
            .from("profiles")
            .select("phone")
            .eq("id", user.id)
            .maybeSingle();
          const { data: order, error: orderErr } = await sb
            .from("orders")
            .insert({
              buyer_id: user.id,
              listing_id: listing.id,
              qty,
              // Only override the listing price when an actual amount was locked.
              negotiated_price_cents: locked > 0 ? locked : null,
              delivery_fee_cents: fee,
              distance_mi: dist,
              conversation_id: conversationId,
              phone: profile?.phone ?? null,
            })
            .select("id, total_cents")
            .single();
          if (!orderErr && order?.id) {
            realOrderId = order.id;
            realTotal = order.total_cents;
          }
        }
      }

      const total = realTotal ?? locked + fee;
      const patch: Record<string, unknown> = {
        negotiation_status: "accepted",
        negotiated_price_cents: locked,
        distance_mi: dist,
        delivery_fee_cents: fee,
        escrow_total_cents: total,
      };
      if (realOrderId) patch.order_id = realOrderId;
      await sb.from("conversations").update(patch).eq("id", conversationId);
      setConversation((c) => (c ? { ...c, ...patch } : c));
      await postSystem(
        `✓ Price locked at ${formatCents(locked)}. Delivery ${
          dist != null ? `(${dist.toFixed(1)} mi) ` : ""
        }${formatCents(fee)}. Order total ${formatCents(total)}.`,
        { event: "price_accepted", total_cents: total, order_id: realOrderId },
      );
      setShowAccept(false);
      toast.success("Price accepted", {
        description: `Order total ${formatCents(total)} — continue to escrow payment.`,
      });
    } catch {
      toast.error("Couldn't lock the price. Try again.");
    } finally {
      setAccepting(false);
    }
  };

  // ── Pay into escrow → confirm payment, send OTP, notify both sides ──────────
  const handlePay = async () => {
    if (!conversation || paying || !user) return;
    setPaying(true);
    try {
      const realOrderId = isUuid(conversation.order_id) ? conversation.order_id : null;
      const mockOrderId = realOrderId
        ? null
        : `DFM-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      let code: string | null = null;

      if (realOrderId) {
        // REAL flow: confirm the (simulated) payment → moves the order into
        // escrow via the service role, then text the buyer a real OTP whose
        // hash is stored in order_otps.
        const { error: confirmErr } = await supabase.functions.invoke("confirm-escrow", {
          body: { order_id: realOrderId },
        });
        if (confirmErr) {
          const msg = await readFnError(confirmErr, "We couldn't confirm your payment.");
          toast.error("Payment failed", { description: `${msg} No funds were charged.` });
          return; // leave escrow un-held so the buyer can retry
        }

        const { data: profile } = await sb
          .from("profiles")
          .select("phone")
          .eq("id", user.id)
          .maybeSingle();
        const phone = (profile?.phone as string | null)?.trim();
        if (phone) {
          const { data: otpRes, error: otpErr } = await supabase.functions.invoke("send-otp", {
            body: { phone_number: phone, order_id: realOrderId },
          });
          if (otpErr) {
            toast.warning("Payment is held, but the SMS code didn't send.", {
              description: "You can request it again from this chat once delivery starts.",
            });
          } else {
            // dev_code is only echoed when no real SMS gateway is configured.
            code = (otpRes?.data?.dev_code as string | undefined) ?? null;
          }
        } else {
          toast.warning("Add a phone number in your profile to receive the SMS code.");
        }
      } else {
        // SIMULATED flow (mock farm / no real listing): fake gateway + OTP.
        await new Promise((r) => setTimeout(r, 1200));
        code = generateOtp();
      }

      const patch: Record<string, unknown> = {
        escrow_status: "held",
        payment_method: payMethod,
        escrow_total_cents: totalCents,
      };
      if (mockOrderId) patch.order_id = mockOrderId;
      await sb.from("conversations").update(patch).eq("id", conversationId);
      setConversation((c) => (c ? { ...c, ...patch } : c));

      // The 6-digit release code stays on the buyer's device only — never in
      // the shared thread. (For real orders it also lives hashed in order_otps.)
      if (code && typeof window !== "undefined") {
        window.localStorage.setItem(otpKey(conversationId), code);
        setOtp(code);
        setShowOtp(true);
      }

      const ref = (realOrderId ?? mockOrderId ?? "").slice(0, 8).toUpperCase();
      await postSystem(
        `🔒 Payment received and held in Escrow (${formatCents(totalCents)})${
          ref ? ` · Order #${ref}` : ""
        }.`,
        { event: "escrow_held", total_cents: totalCents, method: payMethod, order_id: realOrderId },
      );

      setShowPay(false);
      toast.success("Payment held in escrow", {
        description: code
          ? `A 6-digit release code was sent to your phone (demo code ${code}).`
          : "A 6-digit release code was sent to your phone.",
      });
    } catch {
      toast.error("Payment failed. Funds were not charged.");
    } finally {
      setPaying(false);
    }
  };

  // ── Live delivery tracking ──────────────────────────────────────────────────
  const isFarmer = !!user && !!conversation && user.id === conversation.farmer_id;
  const deliveryStatus: DeliveryStatus = conversation?.delivery_status ?? "idle";
  // The buyer's current location is the delivery destination.
  const destination = useMemo(
    () => (geo.lat != null && geo.lng != null ? { lat: geo.lat, lng: geo.lng } : null),
    [geo.lat, geo.lng],
  );

  const stopWatch = useCallback(() => {
    if (watchIdRef.current != null && typeof navigator !== "undefined") {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  // Broadcast channel: the farmer pushes location ticks; the buyer receives them.
  // Ephemeral (no DB writes), keyed by the unguessable conversation UUID.
  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase.channel(`delivery:${conversationId}`);
    channel
      .on("broadcast", { event: "location" }, (msg: { payload?: Partial<LatLng> }) => {
        const p = msg.payload;
        if (!p || typeof p.lat !== "number" || typeof p.lng !== "number") return;
        setFarmerLoc({ lat: p.lat, lng: p.lng, ts: p.ts ?? Date.now() });
      })
      .subscribe();
    deliveryChannelRef.current = channel;
    return () => {
      deliveryChannelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [conversationId]);

  // Farmer: start sharing live location.
  const startWatch = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast.error("Live tracking unavailable", {
        description: "This device doesn't support geolocation.",
      });
      return;
    }
    if (watchIdRef.current != null) return; // already watching
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const loc: LatLng = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          ts: Date.now(),
        };
        setFarmerLoc(loc);
        deliveryChannelRef.current?.send({
          type: "broadcast",
          event: "location",
          payload: loc,
        });
      },
      (err) => toast.error("Location error", { description: err.message }),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    );
  }, []);

  // Farmer: resume sharing automatically while a delivery is in progress
  // (survives a page reload); stop once it's no longer in transit.
  useEffect(() => {
    if (isFarmer && deliveryStatus === "in_transit") startWatch();
    else stopWatch();
  }, [isFarmer, deliveryStatus, startWatch, stopWatch]);

  useEffect(() => stopWatch, [stopWatch]); // stop on unmount

  // Mark the order as arrived (farmer button or buyer geofence).
  const markArrived = useCallback(async () => {
    if (!conversation || conversation.delivery_status === "arrived") return;
    const patch = { delivery_status: "arrived" as const };
    await sb.from("conversations").update(patch).eq("id", conversationId);
    setConversation((c) => (c ? { ...c, ...patch } : c));
    stopWatch();
    await postSystem("📍 The farmer has arrived. Enter your release code to complete the order.");
    toast.success("Farmer has arrived", {
      description: "Inspect your order, then enter your release code.",
    });
  }, [conversation, conversationId, postSystem, stopWatch]); // eslint-disable-line react-hooks/exhaustive-deps

  // ETA from the farmer's recent location history → destination, plus geofence
  // auto-arrival on the buyer side.
  useEffect(() => {
    if (!farmerLoc || !destination || deliveryStatus !== "in_transit") {
      if (deliveryStatus !== "in_transit") {
        locHistoryRef.current = [];
        speedRef.current = null;
        initialDistRef.current = null;
        setEta(null);
      }
      return;
    }

    const hist = locHistoryRef.current;
    if (!hist.length || hist[hist.length - 1].ts !== farmerLoc.ts) hist.push(farmerLoc);
    const cutoff = farmerLoc.ts - 60_000;
    while (hist.length && hist[0].ts < cutoff) hist.shift();
    if (hist.length > 12) hist.splice(0, hist.length - 12);

    let instMph: number | null = null;
    if (hist.length >= 2) {
      const a = hist[0];
      const b = hist[hist.length - 1];
      const dtHours = (b.ts - a.ts) / 3_600_000;
      if (dtHours > 0) instMph = haversineMiles(a.lat, a.lng, b.lat, b.lng) / dtHours;
    }
    if (instMph != null && Number.isFinite(instMph)) {
      const clamped = Math.min(60, Math.max(2, instMph));
      speedRef.current =
        speedRef.current == null ? clamped : speedRef.current * 0.65 + clamped * 0.35;
    }
    const mph = speedRef.current ?? 20;
    const miles = haversineMiles(farmerLoc.lat, farmerLoc.lng, destination.lat, destination.lng);
    // Capture the largest distance seen as the baseline for the progress bar.
    if (initialDistRef.current == null || miles > initialDistRef.current) {
      initialDistRef.current = miles;
    }
    const init = initialDistRef.current;
    const progress = init && init > 0 ? Math.min(1, Math.max(0, 1 - miles / init)) : 0;
    setEta({ miles, minutes: Math.max(1, Math.round((miles / mph) * 60)), progress });

    if (isBuyer && miles <= ARRIVAL_RADIUS_MI && !arrivedSentRef.current) {
      arrivedSentRef.current = true;
      void markArrived();
    }
  }, [farmerLoc, destination, deliveryStatus, isBuyer, markArrived]);

  const handleStartDelivery = async () => {
    if (!conversation || startingDelivery) return;
    setStartingDelivery(true);
    try {
      const patch = {
        delivery_status: "in_transit" as const,
        delivery_started_at: new Date().toISOString(),
      };
      await sb.from("conversations").update(patch).eq("id", conversationId);
      setConversation((c) => (c ? { ...c, ...patch } : c));
      startWatch();
      await postSystem(
        "🚚 Delivery started — the farmer is on the way. Live location sharing is on.",
      );
      toast.success("Delivery started", {
        description: "Sharing your live location with the buyer.",
      });
    } catch {
      toast.error("Couldn't start delivery. Try again.");
    } finally {
      setStartingDelivery(false);
    }
  };

  // ── Confirm delivery → release escrow to the farmer (buyer enters OTP) ──────
  const handleConfirmDelivery = async () => {
    if (!conversation || releasing || !user) return;
    const clean = otpInput.replace(/\D/g, "");
    if (clean.length !== 6) {
      toast.error("Enter all 6 digits of your release code.");
      return;
    }
    setReleasing(true);
    try {
      const realOrderId = isUuid(conversation.order_id) ? conversation.order_id : null;

      if (realOrderId) {
        // REAL flow: verify-otp checks the hashed code AND releases escrow to the
        // farmer (payout + order → released) in one trusted step.
        const { data, error } = await supabase.functions.invoke("verify-otp", {
          body: { order_id: realOrderId, otp: clean },
        });
        if (error || data?.success === false) {
          const msg = await readFnError(
            error,
            "Incorrect or expired code. Double-check and try again.",
          );
          toast.error("Couldn't release payment", { description: msg });
          return;
        }
      } else {
        // SIMULATED flow: compare against the locally-stored code.
        const stored =
          typeof window !== "undefined"
            ? window.localStorage.getItem(otpKey(conversationId))
            : null;
        await new Promise((r) => setTimeout(r, 500));
        if (!stored || clean !== stored) {
          toast.error("Incorrect code. Double-check and try again.");
          return;
        }
      }

      const patch: Record<string, unknown> = { escrow_status: "released" };
      await sb.from("conversations").update(patch).eq("id", conversationId);
      setConversation((c) => (c ? { ...c, ...patch } : c));
      await postSystem(
        `🎉 Delivery confirmed — ${formatCents(totalCents)} released from escrow to the farmer.`,
        { event: "escrow_released", total_cents: totalCents },
      );
      setOtpInput("");
      if (typeof window !== "undefined") window.localStorage.removeItem(otpKey(conversationId));
      toast.success("Payment released", {
        description: `${formatCents(totalCents)} sent to the farmer. Thanks for your order!`,
      });
    } catch {
      toast.error("Couldn't release payment. Please try again.");
    } finally {
      setReleasing(false);
    }
  };

  const farmName = conversation?.farm_name ?? "Farm";
  const accepted = conversation?.negotiation_status === "accepted";
  const escrowHeld = conversation?.escrow_status === "held";
  const released = conversation?.escrow_status === "released";
  const stage = released ? 3 : escrowHeld ? 2 : accepted ? 1 : 0;
  const statusLabel = released
    ? "Completed"
    : conversation?.delivery_status === "arrived"
      ? "Arrived"
      : conversation?.delivery_status === "in_transit"
        ? "Out for delivery"
        : escrowHeld
          ? "In escrow"
          : accepted
            ? "Price locked"
            : conversation?.product_name
              ? "Negotiating"
              : null;

  return (
    <RequireAuth>
      <AppShell>
        <div className="min-h-screen bg-[#060F06]">
          <div className="mx-auto flex h-[calc(100dvh-3.5rem)] max-w-2xl flex-col">
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-[#1E3A1E] bg-[#060F06]/90 px-4 py-3 backdrop-blur shrink-0">
              <Link
                to="/chat"
                className="rounded-full p-2 text-[#7AAB7A] hover:bg-[#132013] hover:text-[#F0FFF0] transition-colors"
                aria-label="Back to messages"
              >
                <ArrowLeft className="h-5 w-5" />
              </Link>
              <div className="w-10 h-10 rounded-full bg-[#4ADE80]/15 border border-[#4ADE80]/25 flex items-center justify-center shrink-0">
                <span className="text-sm font-bold text-[#4ADE80]">{getInitials(farmName)}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-[#F0FFF0] truncate">{farmName}</p>
                <span className="inline-flex items-center gap-1 text-xs text-[#4ADE80]">
                  <BadgeCheck className="h-3.5 w-3.5" /> Verified
                  {statusLabel && <span className="text-[#7AAB7A]">· {statusLabel}</span>}
                </span>
              </div>
            </div>

            {/* Order context strip */}
            {conversation?.product_name && (
              <div className="shrink-0 border-b border-[#1E3A1E] bg-[#0C1A0C] px-4 py-2.5 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] uppercase tracking-wide text-[#7AAB7A]">
                    {accepted ? "Price locked" : "Negotiating"}
                  </p>
                  <p className="text-sm font-semibold text-[#F0FFF0] truncate">
                    {qty} × {conversation.product_name}
                    {conversation.unit_price_cents != null && (
                      <span className="text-[#7AAB7A] font-normal">
                        {" "}
                        · {formatCents(conversation.unit_price_cents)}
                        {conversation.unit ? `/${conversation.unit}` : ""}
                      </span>
                    )}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase text-[#7AAB7A] tracking-wide">
                    {accepted ? "Total" : "Subtotal"}
                  </p>
                  <p className="text-sm font-bold text-[#4ADE80]">
                    {formatCents(accepted ? totalCents : subtotalCents)}
                  </p>
                </div>
              </div>
            )}

            {/* Escrow status stepper — visible once a deal is underway */}
            {conversation?.product_name && <EscrowStepper stage={stage} />}

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {loading ? (
                <ChatSkeleton />
              ) : loadError ? (
                <ChatErrorState onRetry={() => setReloadKey((k) => k + 1)} />
              ) : !conversation ? (
                <ChatNotFoundState />
              ) : messages.length === 0 ? (
                <div className="flex items-center justify-center h-full text-center">
                  <p className="text-sm text-[#7AAB7A]">No messages yet. Say hello!</p>
                </div>
              ) : (
                messages.map((msg) => {
                  if (msg.kind === "prefill") {
                    const meta = (msg.metadata ?? {}) as {
                      product_name?: string;
                      qty?: number;
                      unit_price_cents?: number;
                    };
                    return (
                      <div key={msg.id} className="flex justify-center">
                        <div className="max-w-[85%] rounded-2xl border border-[#4ADE80]/30 bg-[#4ADE80]/5 p-3 text-center">
                          <p className="text-[11px] uppercase tracking-wide text-[#4ADE80] font-bold mb-1">
                            Product inquiry
                          </p>
                          {meta.product_name && (
                            <p className="text-sm text-[#F0FFF0]">
                              <strong>
                                {meta.qty} × {meta.product_name}
                              </strong>
                              {meta.unit_price_cents != null && (
                                <span className="text-[#7AAB7A]">
                                  {" "}
                                  · {formatCents(meta.unit_price_cents)} ea
                                </span>
                              )}
                            </p>
                          )}
                          <p className="mt-1 text-xs text-[#7AAB7A]">{msg.body}</p>
                        </div>
                      </div>
                    );
                  }
                  if (msg.kind === "system") {
                    return (
                      <div key={msg.id} className="flex justify-center">
                        <div className="max-w-[90%] rounded-full border border-[#F97316]/30 bg-[#F97316]/10 px-3 py-1.5 text-center text-xs text-[#FDBA74] font-medium">
                          {msg.body}
                        </div>
                      </div>
                    );
                  }
                  const mine = msg.sender_id === user?.id;
                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
                    >
                      <div
                        className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${
                          mine
                            ? "bg-[#2D7A2E] text-white rounded-br-sm"
                            : "bg-[#132013] text-[#F0FFF0] border border-[#1E3A1E] rounded-bl-sm"
                        }`}
                      >
                        {msg.body}
                      </div>
                      <span className="mt-0.5 text-[10px] text-[#7AAB7A]/60 px-1">
                        {formatTime(msg.created_at)}
                      </span>
                    </div>
                  );
                })
              )}

              {/* Live delivery tracking — timeline + map, visible to both */}
              {(escrowHeld || released) && (deliveryStatus !== "idle" || released) && (
                <div className="space-y-3 pt-1">
                  <DeliveryTimeline
                    deliveryStatus={deliveryStatus}
                    released={released}
                    startedAt={conversation?.delivery_started_at}
                  />
                  {(deliveryStatus === "in_transit" || deliveryStatus === "arrived") && (
                    <div className="overflow-hidden rounded-2xl border border-[#1E3A1E] bg-[#0C1A0C]">
                      {/* Header: who's coming + big ETA */}
                      <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <div
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                              deliveryStatus === "arrived"
                                ? "bg-[#22C55E]/15 text-[#22C55E]"
                                : "bg-[#4ADE80]/15 text-[#4ADE80]"
                            }`}
                          >
                            {deliveryStatus === "arrived" ? (
                              <MapPin className="h-4 w-4" />
                            ) : (
                              <Truck className="h-4 w-4" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-[#F0FFF0]">
                              {deliveryStatus === "arrived"
                                ? "Your farmer has arrived"
                                : `${farmName.split(" ")[0]} is on the way`}
                            </p>
                            <p className="truncate text-[11px] text-[#7AAB7A]">
                              {deliveryStatus === "arrived"
                                ? "Enter your release code to complete the order"
                                : eta
                                  ? `Arriving in about ${eta.minutes} min`
                                  : "Connecting to live location…"}
                            </p>
                          </div>
                        </div>
                        {eta && deliveryStatus === "in_transit" && (
                          <div className="shrink-0 text-right">
                            <p className="text-xl font-extrabold leading-none tabular-nums text-[#4ADE80]">
                              {eta.minutes}
                              <span className="ml-0.5 text-[11px] font-semibold text-[#7AAB7A]">
                                min
                              </span>
                            </p>
                            <p className="text-[10px] tabular-nums text-[#7AAB7A]">
                              {eta.miles.toFixed(1)} mi away
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Map / location fallbacks */}
                      <div className="px-3 pb-3">
                        {destination ? (
                          <LiveTrackingMap
                            farmer={farmerLoc}
                            destination={destination}
                            farmerLabel={farmName}
                            etaLabel={
                              eta ? `${eta.miles.toFixed(1)} mi · ~${eta.minutes} min` : undefined
                            }
                            arrived={deliveryStatus === "arrived"}
                          />
                        ) : isFarmer ? (
                          <FarmerSharingCard sharing={!!farmerLoc} />
                        ) : (
                          <LocationPermissionCard geo={geo} />
                        )}

                        {/* Progress bar */}
                        {destination && deliveryStatus === "in_transit" && eta && (
                          <div className="mt-3">
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#132013]">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-[#4ADE80] to-[#22C55E] transition-[width] duration-700 ease-out"
                                style={{ width: `${Math.round(eta.progress * 100)}%` }}
                              />
                            </div>
                            <div className="mt-1 flex justify-between text-[10px] tabular-nums text-[#7AAB7A]">
                              <span>{Math.round(eta.progress * 100)}% of the way</span>
                              <span className="flex items-center gap-1">
                                <span
                                  className={`inline-block h-1.5 w-1.5 rounded-full ${farmerLoc ? "animate-pulse bg-[#4ADE80]" : "bg-[#7AAB7A]/50"}`}
                                />
                                {farmerLoc ? "Live" : "Waiting for signal"}
                              </span>
                            </div>
                          </div>
                        )}
                        {destination && !farmerLoc && deliveryStatus === "in_transit" && (
                          <p className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-[#7AAB7A]">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Waiting for the farmer's first location update…
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Quick replies */}
            {conversation && !loadError && (
              <div className="shrink-0 flex gap-2 overflow-x-auto px-4 pb-2 scrollbar-none">
                {QUICK_REPLIES.map((reply) => (
                  <button
                    key={reply}
                    onClick={() => {
                      setInput(reply);
                      inputRef.current?.focus();
                    }}
                    className="shrink-0 rounded-full border border-[#1E3A1E] bg-[#132013] px-3 py-1.5 text-xs text-[#7AAB7A] hover:border-[#4ADE80]/50 hover:text-[#4ADE80] transition-colors whitespace-nowrap"
                  >
                    {reply}
                  </button>
                ))}
              </div>
            )}

            {/* Accept Price — buyer only, while still negotiating */}
            {isBuyer && conversation?.product_name && !accepted && (
              <div className="shrink-0 border-t border-[#1E3A1E] bg-[#0C1A0C] px-4 py-3">
                <Button
                  onClick={() => setShowAccept(true)}
                  className="w-full h-11 bg-[#F97316] text-white hover:bg-[#EA580C] font-semibold"
                >
                  <ShieldCheck className="h-4 w-4 mr-2" />
                  Accept Price · {formatCents(subtotalCents)}
                </Button>
              </div>
            )}

            {/* Pay into escrow — buyer only, after acceptance, before payment */}
            {isBuyer && accepted && conversation?.escrow_status === "none" && (
              <div className="shrink-0 border-t border-[#1E3A1E] bg-[#0C1A0C] px-4 py-3">
                <Button
                  onClick={() => setShowPay(true)}
                  className="w-full h-11 bg-[#F97316] text-white hover:bg-[#EA580C] font-semibold"
                >
                  <Lock className="h-4 w-4 mr-2" />
                  Pay into Escrow · {formatCents(totalCents)}
                </Button>
                <p className="mt-1.5 text-[11px] text-center text-[#7AAB7A]">
                  Funds are held safely until you confirm delivery.
                </p>
              </div>
            )}

            {/* Escrow held — visible to BOTH participants */}
            {escrowHeld && (
              <div className="shrink-0 border-t border-[#4ADE80]/30 bg-[#4ADE80]/10 px-4 py-3 space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[#4ADE80]">
                    <Lock className="h-4 w-4" />
                    Payment received and held in Escrow
                    <span className="text-xs text-[#7AAB7A] font-normal">
                      · {formatCents(totalCents)}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-[#F59E0B]/40 bg-[#F59E0B]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#F59E0B]">
                      <FlaskConical className="h-3 w-3" /> Test
                    </span>
                  </div>
                  {isBuyer && otp && (
                    <button
                      onClick={() => setShowOtp((v) => !v)}
                      className="flex items-center gap-1.5 rounded-full border border-[#4ADE80]/40 bg-[#060F06] px-3 py-1 text-xs font-mono font-bold text-[#4ADE80] hover:bg-[#4ADE80]/5"
                      aria-label={showOtp ? "Hide release code" : "Reveal release code"}
                    >
                      {showOtp ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      {showOtp ? otp : "•• •• ••"}
                    </button>
                  )}
                </div>

                {isBuyer ? (
                  <div className="rounded-xl border border-[#4ADE80]/25 bg-[#060F06] p-3 space-y-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-[#F0FFF0]">
                      <KeyRound className="h-3.5 w-3.5 text-[#4ADE80]" />
                      Confirm delivery to release payment
                    </div>
                    <p className="flex items-center gap-1.5 text-[11px] font-medium text-[#F97316]">
                      <Navigation className="h-3.5 w-3.5 shrink-0" />
                      {deliveryStatus === "idle"
                        ? "Waiting for the farmer to start delivery…"
                        : deliveryStatus === "arrived"
                          ? "The farmer has arrived — enter your code below."
                          : `The farmer is on the way${eta ? ` · ~${eta.minutes} min away` : ""}.`}
                    </p>
                    <p className="text-[11px] text-[#7AAB7A]">
                      When your order arrives, enter the 6-digit code sent to your phone to release{" "}
                      {formatCents(totalCents)} to the farmer.
                    </p>
                    <div className="flex gap-2">
                      <Input
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={6}
                        value={otpInput}
                        onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        placeholder="••••••"
                        aria-label="6-digit release code"
                        className="flex-1 h-11 text-center font-mono text-lg tracking-[0.4em] bg-[#132013] border-[#1E3A1E] text-[#F0FFF0] placeholder:text-[#7AAB7A]/40 focus:border-[#4ADE80]"
                      />
                      <Button
                        onClick={handleConfirmDelivery}
                        disabled={otpInput.length !== 6 || releasing}
                        className="h-11 px-5 bg-[#4ADE80] hover:bg-[#22C55E] text-black font-semibold disabled:opacity-40"
                      >
                        {releasing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Release"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {deliveryStatus === "idle" && (
                      <>
                        <Button
                          onClick={handleStartDelivery}
                          disabled={startingDelivery}
                          className="h-11 w-full bg-[#F97316] font-semibold text-white hover:bg-[#EA580C] disabled:opacity-50"
                        >
                          {startingDelivery ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Truck className="mr-2 h-4 w-4" />
                          )}
                          Start Delivery
                        </Button>
                        <p className="text-center text-[11px] text-[#7AAB7A]">
                          Your live location will be shared with the buyer.
                        </p>
                      </>
                    )}
                    {deliveryStatus === "in_transit" && (
                      <>
                        <Button
                          onClick={() => void markArrived()}
                          variant="outline"
                          className="h-11 w-full border-[#4ADE80]/40 font-semibold text-[#4ADE80] hover:bg-[#4ADE80]/10"
                        >
                          <MapPin className="mr-2 h-4 w-4" /> I've Arrived
                        </Button>
                        <p className="flex items-center justify-center gap-1.5 text-[11px] text-[#7AAB7A]">
                          <Navigation className="h-3.5 w-3.5 animate-pulse" /> Sharing your live
                          location…
                        </p>
                      </>
                    )}
                    {deliveryStatus === "arrived" && (
                      <p className="flex items-center gap-1.5 text-[11px] text-[#7AAB7A]">
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                        Waiting for the buyer to enter their release code…
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Escrow released — celebratory, visible to BOTH participants */}
            {released && (
              <div className="shrink-0 border-t border-[#4ADE80]/40 bg-[#4ADE80]/15 px-4 py-3">
                <div className="flex items-center justify-center gap-2 text-sm font-semibold text-[#4ADE80]">
                  <CheckCircle2 className="h-4 w-4" />
                  Payment released to the farmer
                  <PartyPopper className="h-4 w-4" />
                </div>
                <p className="mt-1 text-center text-[11px] text-[#7AAB7A]">
                  {formatCents(totalCents)} released from escrow
                  {isUuid(conversation?.order_id ?? null)
                    ? ` · Order #${conversation!.order_id!.slice(0, 8).toUpperCase()}`
                    : ""}
                </p>
              </div>
            )}

            {/* Input bar */}
            {conversation && !loadError && (
              <div className="shrink-0 border-t border-[#1E3A1E] bg-[#060F06] px-4 py-3">
                <div className="flex items-center gap-2">
                  <Input
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type a message…"
                    className="flex-1 h-11 rounded-2xl bg-[#132013] border-[#1E3A1E] text-[#F0FFF0] placeholder:text-[#7AAB7A]/50 focus:border-[#4ADE80]"
                  />
                  <Button
                    onClick={handleSend}
                    disabled={!input.trim() || sending}
                    size="icon"
                    className="h-11 w-11 rounded-2xl bg-[#4ADE80] hover:bg-[#22C55E] text-black disabled:opacity-40"
                    aria-label="Send"
                  >
                    {sending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Accept Price sheet — distance, delivery fee, final total */}
        <Sheet open={showAccept} onOpenChange={(o) => !accepting && setShowAccept(o)}>
          <SheetContent side="bottom" className="rounded-t-2xl">
            <SheetHeader className="text-left">
              <SheetTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-[#F97316]" />
                Confirm order total
              </SheetTitle>
              <SheetDescription>
                The delivery fee is calculated from the farm to your current location.
              </SheetDescription>
            </SheetHeader>

            <div className="mt-5 space-y-4">
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center gap-2 text-sm font-semibold mb-2">
                  <Truck className="h-4 w-4 text-[#F97316]" />
                  Delivery distance
                </div>
                {geo.loading ? (
                  <p className="text-sm text-muted-foreground">Detecting your location…</p>
                ) : distanceMi != null ? (
                  <p className="text-sm">
                    <strong>{distanceMi.toFixed(1)} mi</strong>
                    <span className="text-muted-foreground"> from the farm to you</span>
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Couldn't detect a location — using the minimum delivery fee.
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-border bg-card p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {qty} × {conversation?.product_name}
                  </span>
                  <span>{formatCents(subtotalCents)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Delivery</span>
                  <span>{formatCents(deliveryFeeCents(distanceMi))}</span>
                </div>
                <div className="border-t border-border pt-2 mt-2 flex justify-between text-base font-bold">
                  <span>Final total</span>
                  <span className="text-[#F97316]">
                    {formatCents(subtotalCents + deliveryFeeCents(distanceMi))}
                  </span>
                </div>
              </div>
            </div>

            <SheetFooter className="mt-5 flex-row gap-2">
              <Button
                variant="outline"
                onClick={() => setShowAccept(false)}
                disabled={accepting}
                className="flex-1"
              >
                Keep negotiating
              </Button>
              <Button
                onClick={handleAcceptPrice}
                disabled={accepting}
                className="flex-1 bg-[#F97316] text-white hover:bg-[#EA580C]"
              >
                {accepting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>Accept · {formatCents(subtotalCents + deliveryFeeCents(distanceMi))}</>
                )}
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        {/* Escrow payment sheet — Card / PayPal / Bank */}
        <Sheet open={showPay} onOpenChange={(o) => !paying && setShowPay(o)}>
          <SheetContent side="bottom" className="rounded-t-2xl">
            <SheetHeader className="text-left">
              <SheetTitle className="flex flex-wrap items-center gap-2">
                <Lock className="h-5 w-5 text-[#F97316]" />
                Escrow payment
                <span className="inline-flex items-center gap-1 rounded-full border border-[#F59E0B]/40 bg-[#F59E0B]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#F59E0B]">
                  <FlaskConical className="h-3 w-3" /> Test mode
                </span>
              </SheetTitle>
              <SheetDescription>
                Choose a payment method. Funds are held by DiGiFaMaR until you confirm delivery.
              </SheetDescription>
            </SheetHeader>

            <div className="mt-5 space-y-4">
              {/* Test-mode banner — payment is simulated */}
              <div className="flex items-start gap-2 rounded-xl border border-[#F59E0B]/30 bg-[#F59E0B]/10 p-3 text-xs text-[#92660C] dark:text-[#FCD34D]">
                <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-[#F59E0B]" />
                <span>
                  <strong>Test mode:</strong> no real payment is processed. We simulate a successful
                  charge so you can try the full escrow → delivery → release flow.
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: "card", label: "Card", sub: "Visa · Mastercard", Icon: CreditCard },
                    { id: "paypal", label: "PayPal", sub: "PayPal balance", Icon: Wallet },
                    { id: "bank", label: "Bank", sub: "Direct transfer", Icon: Building2 },
                  ] as const
                ).map(({ id, label, sub, Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setPayMethod(id)}
                    className={`rounded-xl border p-3 text-left transition-colors ${
                      payMethod === id
                        ? "border-[#F97316] bg-[#F97316]/5"
                        : "border-border bg-card hover:border-[#F97316]/40"
                    }`}
                  >
                    <Icon className="h-5 w-5 text-[#F97316] mb-2" />
                    <p className="text-sm font-semibold">{label}</p>
                    <p className="text-[10px] text-muted-foreground leading-tight">{sub}</p>
                  </button>
                ))}
              </div>

              <div className="rounded-xl border border-border bg-card p-4 space-y-1.5 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Product</span>
                  <span>{formatCents(subtotalCents)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Delivery</span>
                  <span>{formatCents(deliveryCents)}</span>
                </div>
                {totalCents - subtotalCents - deliveryCents > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Platform + escrow fees</span>
                    <span>{formatCents(totalCents - subtotalCents - deliveryCents)}</span>
                  </div>
                )}
                <div className="border-t border-border pt-2 mt-1 flex justify-between font-bold text-base">
                  <span>Held in escrow</span>
                  <span className="text-[#F97316]">{formatCents(totalCents)}</span>
                </div>
              </div>

              <p className="text-[11px] text-center text-muted-foreground">
                A 6-digit release code will be texted to your phone after payment. Demo only — no
                real charge is made.
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
                onClick={handlePay}
                disabled={paying}
                className="flex-1 bg-[#F97316] text-white hover:bg-[#EA580C]"
              >
                {paying ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Processing…
                  </>
                ) : (
                  <>Pay {formatCents(totalCents)}</>
                )}
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </AppShell>
    </RequireAuth>
  );
}
