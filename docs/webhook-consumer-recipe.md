# Webhook Consumer Recipe

How to consume signed, ordered, exactly-once webhook deliveries from RemitLend.

---

## 1. Register a subscription

```bash
curl -X POST https://api.remitlend.io/api/admin/webhooks \
  -H "x-api-key: <YOUR_ADMIN_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "callbackUrl": "https://your-server.example.com/hooks/remitlend",
    "eventTypes": ["LoanRequested", "LoanApproved", "LoanRepaid", "LoanDefaulted"]
  }'
```

Response:

```json
{
  "success": true,
  "data": {
    "subscription": { "id": 42, "callbackUrl": "...", "eventTypes": [...] }
  }
}
```

Save the `id` — you will need it to view deliveries and rotate keys.

---

## 2. Understand the request your server receives

Every delivery is a `POST` with `Content-Type: application/json` and the following headers:

| Header | Purpose |
|--------|---------|
| `X-Webhook-Id` | `canonical_event_id` — stable SHA-256 derived from `(ledger, txHash, eventIndex)`. Same value on every retry. |
| `X-Webhook-Subscription-Sequence` | Monotonic integer assigned once at enqueue time. Process in order; reject gaps. |
| `X-Webhook-Timestamp` | Unix milliseconds when the delivery was sent. |
| `X-Webhook-Nonce` | 64-char hex random value. Unique per delivery attempt. |
| `X-Webhook-Key-Id` | Identifies which signing key was used. Needed during key rotation. |
| `X-Webhook-Signature` | `v1=<hmac-sha256-hex>` |

Body shape:

```json
{
  "id": "<canonical_event_id>",
  "sequence": 17,
  "type": "LoanRepaid",
  "data": {
    "eventId": "...",
    "loanId": 4,
    "address": "G...",
    "amount": "1000000",
    "ledger": 12345678,
    "txHash": "abc123..."
  }
}
```

---

## 3. Verify the signature

```typescript
import crypto from "node:crypto";

const REPLAY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

function verifyWebhook(
  rawBody: string,
  secret: string,
  headers: Record<string, string>,
): boolean {
  const timestamp = Number(headers["x-webhook-timestamp"]);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > REPLAY_WINDOW_MS) {
    return false; // reject stale or replayed requests
  }

  const nonce = headers["x-webhook-nonce"];
  const message = `${timestamp}.${nonce}.${rawBody}`;
  const expected = crypto.createHmac("sha256", secret).update(message).digest("hex");
  const received = (headers["x-webhook-signature"] ?? "").replace(/^v1=/, "");

  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
}
```

> **Always verify before processing.** Reject any request that fails verification with HTTP 401.

---

## 4. Implement idempotent, ordered processing

```typescript
import type { Request, Response } from "express";

// Persistent set of seen canonical_event_ids (Redis, DB unique constraint, etc.)
const processedIds = new Set<string>();
// Track expected sequence per subscription
const expectedSeq = new Map<number, number>();

app.post("/hooks/remitlend", express.raw({ type: "application/json" }), (req: Request, res: Response) => {
  const rawBody = req.body.toString("utf8");
  const secret  = process.env.REMITLEND_WEBHOOK_SECRET!;

  if (!verifyWebhook(rawBody, secret, req.headers as Record<string, string>)) {
    return res.status(401).send("Invalid signature");
  }

  const webhookId = req.headers["x-webhook-id"] as string;
  const sequence  = Number(req.headers["x-webhook-subscription-sequence"]);

  // Exactly-once: skip already-processed events
  if (processedIds.has(webhookId)) {
    return res.status(200).send("Already processed");
  }

  // Ordered: reject out-of-order delivery
  const subscriptionId = 42; // derive from your routing config
  const expected = expectedSeq.get(subscriptionId) ?? 1;
  if (sequence !== expected) {
    // Gap detected — return 4xx so the platform retries later
    return res.status(409).json({ error: `Expected sequence ${expected}, got ${sequence}` });
  }

  const payload = JSON.parse(rawBody);

  // ── YOUR BUSINESS LOGIC HERE ──────────────────────────────────────────────
  console.log("Processing event", payload.type, payload.data);
  // ─────────────────────────────────────────────────────────────────────────

  processedIds.add(webhookId);
  expectedSeq.set(subscriptionId, expected + 1);

  return res.status(200).send("OK");
});
```

Return **2xx** to acknowledge. Any non-2xx response causes a retry at ~5 min, ~15 min, ~45 min (up to 4 total attempts). After 4 failures the delivery is dead-lettered with status `dead`.

---

## 5. Replay window and nonce deduplication

The `X-Webhook-Timestamp` header is Unix milliseconds. Any request older than **5 minutes** from wall clock time must be rejected. The `X-Webhook-Nonce` is unique per delivery attempt — store it in a short-lived cache (e.g., Redis TTL 10 min) to reject exact replays within the window.

---

## 6. Key rotation

Rotate your signing key periodically or after a suspected compromise:

```bash
curl -X POST https://api.remitlend.io/api/admin/webhooks/42/keys/rotate \
  -H "x-api-key: <YOUR_ADMIN_KEY>"
```

Response:

```json
{
  "success": true,
  "data": {
    "keyId": "wk_abc123...",
    "rawSecret": "deadbeef...",
    "message": "Store this secret securely — it will not be shown again."
  }
}
```

After rotation:

1. The old key enters **retiring** state and remains valid for **24 hours** so in-flight retries drain.
2. The new key is **active** immediately.
3. Check `X-Webhook-Key-Id` to determine which secret to use for verification during the overlap window.
4. After 24 hours the old key is revoked automatically.

---

## 7. Delivery ledger (audit trail)

View the ordered delivery ledger for your subscription:

```bash
# Paginated (cursor-based, by subscription_sequence)
curl "https://api.remitlend.io/api/admin/webhooks/42/deliveries/ledger?limit=100" \
  -H "x-api-key: <YOUR_ADMIN_KEY>"

# Real-time SSE stream (pushes rows as they change)
curl -N "https://api.remitlend.io/api/admin/webhooks/42/deliveries/stream" \
  -H "x-api-key: <YOUR_ADMIN_KEY>"
```

Each row in the ledger includes:

| Field | Description |
|-------|-------------|
| `subscription_sequence` | Monotonic sequence number |
| `canonical_event_id` | Stable event identifier (SHA-256) |
| `status` | `pending`, `inflight`, `delivered`, `failed`, `dead` |
| `attempt_count` | Number of attempts so far |
| `last_status_code` | Last HTTP response code from your endpoint |
| `last_error` | Error message if the last attempt threw |
| `delivered_at` | Timestamp of successful delivery |
| `next_retry_at` | When the next retry is scheduled |

The ledger is also viewable in the RemitLend admin UI at:
`/admin/webhooks/<id>/deliveries`

---

## 8. Supported event types

See [webhooks.md](./webhooks.md) for the full list of event types and their payload schemas.
