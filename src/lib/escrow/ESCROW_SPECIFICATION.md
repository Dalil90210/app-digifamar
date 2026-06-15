# DiGiFaMaR Escrow Payments Specification

## Overview

DiGiFaMaR's escrow system protects both buyers and farmers by holding funds in escrow during transactions. Funds are released only when delivery is confirmed via a 6-digit private release code.

---

## Architecture

### Current Components

```
src/lib/escrow/
├── dto.ts                    # Data Transfer Objects (Zod schemas)
├── escrow.functions.ts       # Server functions (controllers)
├── service.server.ts         # Business logic layer
└── [FUTURE] escrow.db.ts    # Database operations (persistence)

src/lib/escrow-store.server.ts  # In-memory mock store (temporary)
src/lib/escrow-store.test.ts    # Mock store tests
```

### Key Modules

#### 1. **DTO Layer** (`dto.ts`)

Defines strict input/output contracts using Zod:

```typescript
// Escrow states throughout lifecycle
EscrowState = "held" | "released" | "refunded" | "disputed"

// Input: Buyer holds funds for an order
HoldFundsDto {
  orderId: string,
  amountCents: number (1-100,000,000)
}

// Output: Complete escrow record
EscrowDto {
  id: string,
  orderId: string,
  amountCents: number,
  state: EscrowState,
  heldAt: string (ISO timestamp),
  resolvedAt: string | null (ISO timestamp)
}
```

#### 2. **Service Layer** (`service.server.ts`)

Implements state machine and business rules:

- **hold(userId, input)** → Buyer places funds in escrow
  - Validates buyer role via order
  - Creates escrow record with `state: "held"`
  - Funds are now protected

- **release(userId, id)** → Buyer releases funds to farmer (after delivery confirmation)
  - Only buyer can release
  - Transitions from `held` → `released`
  - Farmer receives payment

- **refund(userId, id)** → Farmer returns funds to buyer (if delivery fails)
  - Only farmer can refund
  - Transitions from `held` → `refunded`
  - Buyer receives refund

- **dispute(userId, id)** → Either party escalates to support
  - Either buyer or farmer can initiate
  - Transitions from `held` → `disputed`
  - Requires manual resolution by admin/mediator

#### 3. **Function Controllers** (`escrow.functions.ts`)

Server functions with middleware and validation:

```typescript
holdEscrowFn()     → POST /api/escrow/hold
releaseEscrowFn()  → POST /api/escrow/release
refundEscrowFn()   → POST /api/escrow/refund
disputeEscrowFn()  → POST /api/escrow/dispute
```

All require Supabase authentication via middleware.

---

## Lifecycle & State Machine

```
[HELD]
  ├─→ release() (buyer) ──→ [RELEASED] → Funds to farmer
  ├─→ refund() (farmer) ──→ [REFUNDED] → Funds to buyer
  └─→ dispute() (either) ──→ [DISPUTED] → Awaiting admin decision
```

### Constraints

- ✅ Once escrow is created, it **enters `held` state**
- ✅ State transitions are **unidirectional** (no going back)
- ✅ Only one final resolution per escrow
- ✅ Role-based access control: buyer vs. farmer
- ✅ Timestamps track exact moment of each transition

---

## Security & Trust Model

### 6-Digit Release Code Pattern (from escrow-store.server.ts)

**Current (Mock) Implementation:**
```typescript
// Cryptographically secure 6-digit code
function generateReleaseCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0] % 1_000_000).padStart(6, "0");
}
```

**Why This Works:**
- Buyer receives code (SMS, email, in-app)
- Farmer delivers product
- Buyer verifies quality/quantity
- Buyer shares code with farmer
- Farmer enters code → funds release
- Prevents accidental/fraudulent releases
- Buyer controls final approval step

### Role-Based Authorization

```typescript
function assertOrderRole(userId: string, orderId: string): Role {
  const order = OrdersService._internalFindById(orderId);
  if (order.buyerId === userId) return "buyer";
  if (order.farmerId === userId) return "farmer";
  throw new Error("Forbidden");  // Rejects unauthorized parties
}
```

**Authorization Matrix:**

| Action | Buyer | Farmer | Admin |
|--------|-------|--------|-------|
| Hold (create escrow) | ✅ | ❌ | ✅ |
| Release (to farmer) | ✅ | ❌ | ✅ |
| Refund (to buyer) | ❌ | ✅ | ✅ |
| Dispute (escalate) | ✅ | ✅ | ✅ |

---

## Current Gaps (MVP → Production)

### 1. **Persistence** ⚠️ CRITICAL

- ✅ **Current:** In-memory Map (resets on server restart)
- ❌ **Needed:** Supabase PostgreSQL table

**Schema:**
```sql
CREATE TABLE escrows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  amount_cents INT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('held', 'released', 'refunded', 'disputed')),
  held_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(order_id)  -- One escrow per order
);

CREATE INDEX idx_escrows_order_id ON escrows(order_id);
CREATE INDEX idx_escrows_state ON escrows(state);
```

### 2. **Payment Gateway Integration** ⚠️ CRITICAL

- ✅ **Current:** Mock (no real payment processor)
- ❌ **Needed:** Stripe Connect / ACH

**Flow:**
```
Buyer → Escrow.com or Stripe → Held
Buyer approves (6-digit code) → Release to Farmer's Account
Farmer → Bank Account
```

### 3. **Dispute Resolution** ⚠️ HIGH PRIORITY

- ✅ **Current:** State machine supports `disputed` state
- ❌ **Needed:** 
  - Admin dashboard to review disputes
  - Evidence submission (photos, chat logs)
  - Automatic mediation rules
  - Manual override by support team

### 4. **Time-Based Releases** ⚠️ HIGH PRIORITY

- ✅ **Current:** None
- ❌ **Needed:**
  - Auto-refund if not released within 72 hours (per website promise)
  - Automatic dispute escalation after 7 days

```typescript
// Cron job / scheduled function
async function auto_refund_expired_escrows() {
  const holdLimit = 72 * 60 * 60 * 1000; // 72 hours in ms
  const now = Date.now();
  
  const expired = escrows.filter(e => 
    e.state === "held" && 
    now - new Date(e.heldAt).getTime() > holdLimit
  );
  
  for (const e of expired) {
    await EscrowService.refund(SYSTEM_USER, e.id);
  }
}
```

### 5. **Audit Logging** ⚠️ MEDIUM PRIORITY

- ✅ **Current:** None
- ❌ **Needed:** Immutable log of all escrow events

```typescript
export type EscrowAuditLog = {
  id: UUID,
  escrowId: UUID,
  action: "held" | "released" | "refunded" | "disputed",
  actorId: UUID,
  actorRole: "buyer" | "farmer" | "admin",
  timestamp: ISO 8601,
  details?: object
}
```

### 6. **Notifications** ⚠️ MEDIUM PRIORITY

- ✅ **Current:** None
- ❌ **Needed:** SMS/Email/In-app alerts

**Key Events:**
- "Funds held in escrow (Order #DFM-123456)"
- "Release code sent (valid for 72 hours)"
- "Funds released to farmer!"
- "Refund processed back to your card"
- "Dispute escalated to support team"

---

## Testing Strategy

### Unit Tests (Current: escrow-store.test.ts)

✅ **Existing coverage:**
- Order creation with 6-digit code
- Unique ID generation
- Successful release with correct code
- Rejection of invalid code
- Double-release prevention
- Authorization checks (non-buyer rejection)
- 404 for unknown orders

### Integration Tests (Needed)

```typescript
// Test full flow with real order + user
describe("Escrow Integration", () => {
  it("completes full buyer → farmer transaction", async () => {
    const buyer = await createTestUser("buyer");
    const farmer = await createTestUser("farmer");
    const order = await createTestOrder(buyer.id, farmer.id, 5000); // $50
    
    // 1. Buyer holds funds
    const escrow = await holdEscrowFn.invoke(
      { orderId: order.id, amountCents: 5000 },
      { userId: buyer.id }
    );
    expect(escrow.state).toBe("held");
    
    // 2. Farmer delivers
    await updateOrderStatus(order.id, "shipped");
    
    // 3. Buyer releases with code
    const released = await releaseEscrowFn.invoke(
      { id: escrow.id },
      { userId: buyer.id }
    );
    expect(released.state).toBe("released");
    
    // 4. Verify farmer received funds
    const farmer_balance = await getBalanceForUser(farmer.id);
    expect(farmer_balance.receivedCents).toBeGreaterThanOrEqual(4500); // 90% (keeping 10%)
  });
});
```

---

## Implementation Roadmap

### Phase 1: **MVP Foundation** (Current)
- [x] DTO schemas (Zod)
- [x] Service state machine
- [x] Server functions with auth
- [x] In-memory mock store
- [x] Unit tests

### Phase 2: **Persistence & Payments** (PRIORITY)
- [ ] Supabase PostgreSQL schema
- [ ] escrow.db.ts (CRUD operations)
- [ ] Stripe Connect integration
- [ ] escrow.payments.ts (payment processor wrapper)
- [ ] Integration tests

### Phase 3: **Time-Based Features**
- [ ] Scheduled cron jobs for auto-refund (72hr)
- [ ] Dispute escalation timer (7 days)
- [ ] Background jobs framework (Bull Queue or similar)

### Phase 4: **Dispute Resolution**
- [ ] Admin dashboard for disputes
- [ ] Evidence submission forms
- [ ] Mediation workflow
- [ ] Manual override controls

### Phase 5: **Observability**
- [ ] Audit logging table
- [ ] Notification service (email/SMS/in-app)
- [ ] Metrics & dashboards (escrow success rate, avg release time, etc.)
- [ ] Error tracking & alerting

---

## API Contracts (TanStack React Router)

### POST /api/escrow/hold
```json
{
  "orderId": "order_abc123",
  "amountCents": 5000
}
```
→ Returns `EscrowDto`

### POST /api/escrow/release
```json
{
  "id": "esc_xyz789"
}
```
→ Returns `EscrowDto` with `state: "released"`

### POST /api/escrow/refund
```json
{
  "id": "esc_xyz789"
}
```
→ Returns `EscrowDto` with `state: "refunded"`

### POST /api/escrow/dispute
```json
{
  "id": "esc_xyz789"
}
```
→ Returns `EscrowDto` with `state: "disputed"`

---

## Key Files to Create Next

1. **src/lib/escrow/escrow.db.ts** → Supabase queries
2. **src/lib/escrow/escrow.payments.ts** → Stripe/Payment integration
3. **src/lib/escrow/escrow.notifications.ts** → Email/SMS alerts
4. **src/lib/escrow/escrow.scheduled.ts** → Cron jobs
5. **supabase/migrations/001_create_escrows_table.sql** → DB schema
6. **src/lib/escrow/escrow.integration.test.ts** → End-to-end tests

---

## Summary

The DiGiFaMaR escrow system is **architecturally sound** but needs:

1. **Persistence** (Supabase)
2. **Real payments** (Stripe)
3. **Time-based automation** (Cron jobs)
4. **Dispute handling** (Admin workflows)
5. **Observability** (Logging, notifications)

This specification provides the foundation for a **production-grade escrow system** that protects both farmers and buyers while enabling trust at scale.
