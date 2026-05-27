# API Idempotency

Write endpoints that opt into `idempotencyMiddleware` accept an
`Idempotency-Key` request header. Clients should reuse the same key when
retrying the same logical write after a timeout or transient network failure.

## Replay Headers

Responses include `X-Idempotent-Replayed` when an idempotency key is present:

- `false` means the request ran normally and the response can be cached for
  later retries.
- `true` means the request matched a cached response for the same key and the
  body was replayed without running the write handler again.

Cached replays also keep the legacy `X-Idempotency-Cache: HIT` response header.
The replay header is the stable value API consumers should use when deciding
whether to suppress duplicate success toasts or transaction counters.
Both idempotency response headers are exposed through CORS so browser clients
can read them from `fetch()` responses.

Clients should generate a fresh idempotency key for every new write attempt.
Do not reuse a key for a different loan, pool, or transaction operation.
