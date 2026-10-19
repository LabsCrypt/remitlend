# Webhook Signature Verification

Deliveries with a configured subscription secret include an
`X-RemitLend-Signature` header. The timestamp limits how long a captured request
can be replayed.

## Header format

```
X-RemitLend-Signature: t=<unix-seconds>,v1=<hex-encoded-hmac>
```

The HMAC-SHA256 input is the timestamp, a period, and the exact raw request body:
`<timestamp>.<raw-body>`. Reject timestamps older than five minutes before
comparing the digest.

## Verification recipe

```js
import crypto from "node:crypto";

function verifySignature(secret, rawBody, header, now = Date.now()) {
  const match = /^t=(\\d+),v1=([a-f0-9]{64})$/.exec(header ?? "");
  if (!match) return false;

  const [, timestamp, signature] = match;
  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isSafeInteger(timestampMs) || Math.abs(now - timestampMs) > 5 * 60_000) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest();
  const received = Buffer.from(signature, "hex");
  return received.length === expected.length && crypto.timingSafeEqual(expected, received);
}
```

Verify the raw body before JSON parsing. Use a constant-time digest comparison.
The signing secret is per subscription. Each retry is signed with a fresh
timestamp and must be checked independently.
