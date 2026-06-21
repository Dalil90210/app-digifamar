import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Loader2, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { startListingChat, type ListingForChat } from "@/lib/chat/start-conversation";

/**
 * Opens the real buyer ↔ farmer negotiation chat for a Supabase listing, passing
 * the product context so the chat pre-fills and can create a real order on
 * accept. Redirects to sign-in when logged out. Shared by Browse and the farm
 * detail page.
 */
export function ChatNegotiateButton({
  listing,
  className = "w-full",
  label = "Chat & negotiate",
}: {
  listing: ListingForChat;
  className?: string;
  label?: string;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    if (!user) {
      navigate({ to: "/auth", search: { tab: "signin" } });
      return;
    }
    setBusy(true);
    try {
      const convId = await startListingChat(listing, user.id);
      if (!convId) {
        toast.error("Couldn't open chat. Please try again.");
        return;
      }
      navigate({
        to: "/chat/$productId",
        params: { productId: convId },
        search: {
          productId: listing.id,
          productName: listing.title,
          unitPriceCents: listing.price_cents,
          unit: listing.unit,
          qty: 1,
        },
      });
    } catch {
      toast.error("Couldn't open chat. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button onClick={handleClick} disabled={busy} size="sm" variant="outline" className={className}>
      {busy ? (
        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
      ) : (
        <MessageSquare className="mr-1.5 h-4 w-4" />
      )}
      {label}
    </Button>
  );
}
