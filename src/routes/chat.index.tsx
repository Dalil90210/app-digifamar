import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/chat/")({
  head: () => ({
    meta: [
      { title: "Messages — DiGiFaMaR" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ChatList,
});

// ─────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────

interface Conversation {
  id: string;
  buyer_id: string;
  farmer_id: string;
  farm_name: string | null;
  created_at: string;
  last_message_at: string;
}

interface LastMessage {
  conversation_id: string;
  body: string;
  created_at: string;
  is_read: boolean;
  sender_id: string;
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

function formatTimestamp(ts: string): string {
  const date = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (diffDays < 1)
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffDays < 2) return "Yesterday";
  if (diffDays < 7)
    return date.toLocaleDateString([], { weekday: "short" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

// ─────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────

function ChatList() {
  const { user } = useAuth();
  const sb = supabase as any;

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [lastMessages, setLastMessages] = useState<
    Record<string, LastMessage>
  >({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const { data: convs } = await sb
          .from("conversations")
          .select("id, buyer_id, farmer_id, farm_name, created_at, last_message_at")
          .or(`buyer_id.eq.${user.id},farmer_id.eq.${user.id}`)
          .order("last_message_at", { ascending: false });

        if (cancelled) return;
        const list: Conversation[] = convs ?? [];
        setConversations(list);

        if (list.length === 0) return;

        const ids = list.map((c) => c.id);
        const { data: msgs } = await sb
          .from("messages")
          .select("conversation_id, body, created_at, is_read, sender_id")
          .in("conversation_id", ids)
          .order("created_at", { ascending: false });

        if (cancelled) return;
        const byConv: Record<string, LastMessage> = {};
        for (const m of (msgs ?? []) as LastMessage[]) {
          if (!byConv[m.conversation_id]) byConv[m.conversation_id] = m;
        }
        setLastMessages(byConv);
      } catch {
        // table may not exist yet
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <RequireAuth>
      <AppShell>
        <div className="min-h-screen bg-[#060F06] text-[#F0FFF0]">
          <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
            <h1 className="text-2xl font-extrabold mb-6 flex items-center gap-2">
              <MessageSquare className="h-6 w-6 text-[#4ADE80]" />
              Messages
            </h1>

            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            ) : conversations.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="space-y-2">
                {conversations.map((conv) => {
                  const last = lastMessages[conv.id];
                  const hasUnread =
                    last && !last.is_read && last.sender_id !== user?.id;

                  return (
                    <Link
                      key={conv.id}
                      to="/chat/$productId"
                      params={{ productId: conv.id }}
                      className="flex items-center gap-4 rounded-2xl border border-[#1E3A1E] bg-[#132013] p-4 hover:border-[#4ADE80]/40 hover:bg-[#1A2E1A] transition-colors"
                    >
                      {/* Farm avatar */}
                      <div className="relative shrink-0">
                        <div className="w-12 h-12 rounded-full bg-[#4ADE80]/15 border border-[#4ADE80]/25 flex items-center justify-center">
                          <span className="text-sm font-bold text-[#4ADE80]">
                            {getInitials(conv.farm_name ?? "Farm")}
                          </span>
                        </div>
                        {hasUnread && (
                          <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-[#4ADE80] border-2 border-[#060F06]" />
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p
                            className={`font-semibold truncate ${
                              hasUnread
                                ? "text-[#F0FFF0]"
                                : "text-[#F0FFF0]/80"
                            }`}
                          >
                            {conv.farm_name ?? "Farm"}
                          </p>
                          {last && (
                            <span className="text-[10px] text-[#7AAB7A] shrink-0">
                              {formatTimestamp(last.created_at)}
                            </span>
                          )}
                        </div>
                        <p
                          className={`text-sm truncate mt-0.5 ${
                            hasUnread
                              ? "text-[#F0FFF0]/70 font-medium"
                              : "text-[#7AAB7A]"
                          }`}
                        >
                          {last
                            ? last.body.slice(0, 40) +
                              (last.body.length > 40 ? "…" : "")
                            : "No messages yet"}
                        </p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </AppShell>
    </RequireAuth>
  );
}

// ─────────────────────────────────────────────────────────────────
// EMPTY STATE
// ─────────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-full bg-[#132013] border border-[#1E3A1E] flex items-center justify-center mb-4">
        <MessageSquare className="h-7 w-7 text-[#7AAB7A]" />
      </div>
      <p className="text-[#F0FFF0] font-semibold mb-2">No messages yet</p>
      <p className="text-sm text-[#7AAB7A] max-w-xs leading-relaxed">
        Start a conversation from any farm profile or product page.
      </p>
      <Link
        to="/market"
        className="mt-6 text-sm font-semibold text-[#4ADE80] hover:underline"
      >
        Browse the marketplace →
      </Link>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// SKELETON
// ─────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-[#1E3A1E] bg-[#132013] p-4 animate-pulse">
      <div className="w-12 h-12 rounded-full bg-[#1E3A1E] shrink-0" />
      <div className="flex-1 space-y-2.5">
        <div className="flex justify-between">
          <div className="h-3.5 w-28 rounded bg-[#1E3A1E]" />
          <div className="h-3 w-12 rounded bg-[#1E3A1E]" />
        </div>
        <div className="h-3 w-44 rounded bg-[#1E3A1E]" />
      </div>
    </div>
  );
}
