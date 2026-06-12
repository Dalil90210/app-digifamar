import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Send, ArrowLeft, BadgeCheck } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  scanForContactInfo,
  describeCategories,
  CONTACT_BLOCK_WARNING,
} from "@/lib/chat/contact-guard";

export const Route = createFileRoute("/chat/$productId")({
  head: () => ({
    meta: [
      { title: "Chat — DiGiFaMaR" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ChatThread,
});

// ─────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────

interface DbMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  is_read: boolean;
}

interface Conversation {
  id: string;
  farm_name: string;
  buyer_id: string;
  farmer_id: string;
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

const QUICK_REPLIES = [
  "What's the minimum order?",
  "Can you deliver by tomorrow?",
  "Is this certified organic?",
  "What's the bulk price for 10+ lbs?",
];

// ─────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────

function ChatThread() {
  const { productId: conversationId } = Route.useParams();
  const { user } = useAuth();
  const sb = supabase as any;

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<DbMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Scroll to bottom whenever messages change
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  // Fetch conversation + initial messages
  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const [convRes, msgsRes] = await Promise.all([
          sb
            .from("conversations")
            .select("id, farm_name, buyer_id, farmer_id")
            .eq("id", conversationId)
            .maybeSingle(),
          sb
            .from("messages")
            .select("id, conversation_id, sender_id, content, created_at, is_read")
            .eq("conversation_id", conversationId)
            .order("created_at", { ascending: true }),
        ]);

        if (cancelled) return;
        if (convRes.data) setConversation(convRes.data as Conversation);
        setMessages((msgsRes.data ?? []) as DbMessage[]);
      } catch {
        // tables may not exist yet
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mark unread messages as read
  useEffect(() => {
    if (!user || !conversationId || messages.length === 0) return;
    sb.from("messages")
      .update({ is_read: true })
      .eq("conversation_id", conversationId)
      .neq("sender_id", user.id)
      .eq("is_read", false);
  }, [messages, user, conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Supabase Realtime subscription
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
          setMessages((prev) => {
            // Avoid duplicate if we already added optimistically
            if (prev.some((m) => m.id === incoming.id)) return prev;
            return [...prev, incoming];
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !user || sending) return;

    // Critical Rule: never let personal contact info leave the platform.
    const scan = scanForContactInfo(text);
    if (scan.hasContactInfo) {
      toast.error("Message blocked", {
        description: `${CONTACT_BLOCK_WARNING} (Detected: ${describeCategories(
          scan.categories,
        )}.)`,
      });
      return; // keep the text in the box so the user can edit it
    }

    setSending(true);
    setInput("");
    try {
      await sb.from("messages").insert({
        conversation_id: conversationId,
        sender_id: user.id,
        content: text,
        is_read: false,
      });
      // Realtime subscription will append the message
    } catch {
      setInput(text); // restore on failure
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

  const farmName = conversation?.farm_name ?? "Farm";

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

              {/* Farm avatar */}
              <div className="w-10 h-10 rounded-full bg-[#4ADE80]/15 border border-[#4ADE80]/25 flex items-center justify-center shrink-0">
                <span className="text-sm font-bold text-[#4ADE80]">
                  {getInitials(farmName)}
                </span>
              </div>

              <div className="flex-1 min-w-0">
                <p className="font-semibold text-[#F0FFF0] truncate">
                  {farmName}
                </p>
                <span className="inline-flex items-center gap-1 text-xs text-[#4ADE80]">
                  <BadgeCheck className="h-3.5 w-3.5" /> Verified
                </span>
              </div>
            </div>

            {/* Messages */}
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
            >
              {loading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-[#7AAB7A] text-sm">Loading…</div>
                </div>
              ) : messages.length === 0 ? (
                <div className="flex items-center justify-center h-full text-center">
                  <p className="text-sm text-[#7AAB7A]">
                    No messages yet. Say hello!
                  </p>
                </div>
              ) : (
                messages.map((msg) => {
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
                        {msg.content}
                      </div>
                      <span className="mt-0.5 text-[10px] text-[#7AAB7A]/60 px-1">
                        {formatTime(msg.created_at)}
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            {/* Quick reply chips */}
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

            {/* Input bar */}
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
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </AppShell>
    </RequireAuth>
  );
}
