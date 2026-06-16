-- supabase/migrations/001_create_escrows_table.sql
-- DiGiFaMaR escrow persistence layer.
--
-- Design principles (these are the reason it's safe to move real money on it):
--   * Clients can only READ their own escrows. Every state change — i.e. every
--     time money is released or refunded — happens server-side via the service
--     role through escrow_transition(). A buyer can never flip their own escrow
--     to 'released' directly; the server does it only after validating the OTP.
--   * Transitions are atomic and race-guarded (row lock + expected-state check),
--     so two concurrent release attempts can't double-spend.
--   * Every transition writes an immutable audit row in escrow_events.
--
-- Columns beyond your DTO (buyer_id, farmer_id, stripe_*, version, timestamps)
-- are required for RLS, the Stripe layer, and concurrency. If your spec already
-- names these differently, reconcile — the DTO mapping lives in escrow.db.ts.

-- ── State machine ───────────────────────────────────────────────────────────
create type escrow_state as enum ('held', 'released', 'refunded', 'disputed');

-- ── Core table ──────────────────────────────────────────────────────────────
create table public.escrows (
  id            uuid primary key default gen_random_uuid(),
  order_id      text   not null,
  buyer_id      uuid   not null references auth.users (id),
  farmer_id     uuid   not null references auth.users (id),
  amount_cents  bigint not null check (amount_cents > 0),   -- integer cents, never floats
  state         escrow_state not null default 'held',

  -- Stripe linkage, populated by the payment layer (next step)
  stripe_payment_intent_id text,
  stripe_transfer_id       text,
  stripe_refund_id         text,

  held_at       timestamptz not null default now(),
  resolved_at   timestamptz,                                -- set on released/refunded only
  version       integer     not null default 1,             -- optimistic-lock counter
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- One escrow per order. Relax to a partial unique index on
  -- (order_id) where state in ('held','disputed') if an order can be re-escrowed.
  constraint escrows_order_unique unique (order_id)
);

create index escrows_state_idx  on public.escrows (state);
create index escrows_buyer_idx  on public.escrows (buyer_id);
create index escrows_farmer_idx on public.escrows (farmer_id);

-- ── Append-only audit trail ─────────────────────────────────────────────────
create table public.escrow_events (
  id         uuid primary key default gen_random_uuid(),
  escrow_id  uuid not null references public.escrows (id),
  from_state escrow_state,
  to_state   escrow_state not null,
  actor      text not null,            -- 'buyer:<uid>' | 'system' | 'admin:<uid>'
  reason     text,
  metadata   jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index escrow_events_escrow_idx on public.escrow_events (escrow_id, created_at);

-- ── updated_at trigger ─────────────��────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

create trigger escrows_set_updated_at
  before update on public.escrows
  for each row execute function public.set_updated_at();

-- ── Atomic, race-safe transition ────────────────────────────────────────────
-- Locks the row, verifies it's in the state the caller expected (idempotency /
-- double-release guard), enforces the legal state machine, updates, and writes
-- the audit event — all in one transaction.
create or replace function public.escrow_transition(
  p_escrow_id      uuid,
  p_expected_state escrow_state,
  p_new_state      escrow_state,
  p_actor          text,
  p_reason         text  default null,
  p_metadata       jsonb default '{}'
)
returns public.escrows
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.escrows;
begin
  select * into v_row from public.escrows where id = p_escrow_id for update;

  if not found then
    raise exception 'escrow % not found', p_escrow_id using errcode = 'no_data_found';
  end if;

  if v_row.state <> p_expected_state then
    raise exception 'escrow % is % (expected %)', p_escrow_id, v_row.state, p_expected_state
      using errcode = 'check_violation';
  end if;

  if not (
       (p_expected_state = 'held'     and p_new_state in ('released','refunded','disputed'))
    or (p_expected_state = 'disputed' and p_new_state in ('released','refunded'))
  ) then
    raise exception 'illegal transition % -> %', p_expected_state, p_new_state
      using errcode = 'check_violation';
  end if;

  update public.escrows
     set state       = p_new_state,
         resolved_at = case when p_new_state in ('released','refunded') then now() else resolved_at end,
         version     = version + 1
   where id = p_escrow_id
  returning * into v_row;

  insert into public.escrow_events (escrow_id, from_state, to_state, actor, reason, metadata)
  values (p_escrow_id, p_expected_state, p_new_state, p_actor, p_reason, p_metadata);

  return v_row;
end; $$;

-- ── Lock everything down ────────────────────────────────────────────────────
alter table public.escrows       enable row level security;
alter table public.escrow_events enable row level security;

-- Buyers and farmers may READ escrows they're party to. No write policies exist,
-- so authenticated/anon clients cannot insert or update — only the service role
-- (which bypasses RLS) can, and it does so via escrow_transition().
create policy escrows_select_party on public.escrows
  for select to authenticated
  using (buyer_id = auth.uid() or farmer_id = auth.uid());

create policy escrow_events_select_party on public.escrow_events
  for select to authenticated
  using (exists (
    select 1 from public.escrows e
    where e.id = escrow_events.escrow_id
      and (e.buyer_id = auth.uid() or e.farmer_id = auth.uid())
  ));

grant select on public.escrows       to authenticated;
grant select on public.escrow_events to authenticated;

-- The transition function is server-only: no client role may execute it.
revoke all on function public.escrow_transition(uuid, escrow_state, escrow_state, text, text, jsonb)
  from public, anon, authenticated;
grant  execute on function public.escrow_transition(uuid, escrow_state, escrow_state, text, text, jsonb)
  to service_role;
