-- Live delivery tracking state on the conversation.
--
-- The farmer's moving GPS position is streamed buyer-side over a Supabase
-- Realtime *broadcast* channel (delivery:<conversation_id>) — ephemeral and
-- high-frequency, so it is never written to the database. Only the coarse
-- delivery STATUS is persisted here so both parties see a consistent timeline
-- across reloads; status changes also post a system message, which is what
-- nudges the other side to refetch. Additive and idempotent.

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS delivery_status text NOT NULL DEFAULT 'idle'
    CHECK (delivery_status IN ('idle','in_transit','arrived')),
  ADD COLUMN IF NOT EXISTS delivery_started_at timestamptz;

-- Participants advance the delivery status (farmer starts/arrives; the buyer's
-- client may auto-mark arrival when the farmer reaches the geofence).
GRANT UPDATE (delivery_status, delivery_started_at) ON public.conversations TO authenticated;
