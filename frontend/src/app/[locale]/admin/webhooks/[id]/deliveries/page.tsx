"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useUserStore } from "../../../../../stores/useUserStore";
import { useSSE } from "../../../../../hooks/useSSE";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type DeliveryStatus = "pending" | "inflight" | "delivered" | "failed" | "dead";

interface DeliveryRow {
  id: number;
  canonical_event_id: string;
  subscription_sequence: number;
  status: DeliveryStatus;
  attempt_count: number;
  last_status_code: number | null;
  last_error: string | null;
  event_type: string;
  delivered_at: string | null;
  next_retry_at: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_COLORS: Record<DeliveryStatus, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  inflight: "bg-blue-100 text-blue-800",
  delivered: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  dead: "bg-gray-200 text-gray-700",
};

function fmt(iso: string | null) {
  if (!iso) return "-";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(iso));
}

function truncate(s: string, n = 20) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export default function WebhookDeliveryLedgerPage() {
  const { id } = useParams<{ id: string }>();
  const subscriptionId = Number(id);
  const apiKey = useUserStore((s) => (s as unknown as { adminApiKey?: string }).adminApiKey ?? "");

  const [deliveries, setDeliveries] = useState<Map<number, DeliveryRow>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [rotateResult, setRotateResult] = useState<{ keyId: string; rawSecret: string } | null>(null);
  const [rotating, setRotating] = useState(false);
  const fetchedRef = useRef(false);

  const applyUpdate = useCallback((row: DeliveryRow) => {
    setDeliveries((prev) => {
      const next = new Map(prev);
      next.set(row.subscription_sequence, row);
      return next;
    });
  }, []);

  const fetchPage = useCallback(
    async (cursor?: number) => {
      const params = new URLSearchParams({ limit: "100" });
      if (cursor !== undefined) params.set("cursor", String(cursor));

      const res = await fetch(
        `${API_URL}/api/admin/webhooks/${subscriptionId}/deliveries/ledger?${params}`,
        { headers: { "x-api-key": apiKey } },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<{
        success: boolean;
        data: { deliveries: DeliveryRow[]; nextCursor: number | null };
      }>;
    },
    [subscriptionId, apiKey],
  );

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    fetchPage()
      .then((body) => {
        setDeliveries(new Map(body.data.deliveries.map((r) => [r.subscription_sequence, r])));
        setNextCursor(body.data.nextCursor);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [fetchPage]);

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const body = await fetchPage(nextCursor);
      setDeliveries((prev) => {
        const next = new Map(prev);
        for (const r of body.data.deliveries) next.set(r.subscription_sequence, r);
        return next;
      });
      setNextCursor(body.data.nextCursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  };

  const sseUrl = `${API_URL}/api/admin/webhooks/${subscriptionId}/deliveries/stream`;
  useSSE<DeliveryRow>({ url: sseUrl, onMessage: applyUpdate });

  const rotateKey = async () => {
    setRotating(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/webhooks/${subscriptionId}/keys/rotate`, {
        method: "POST",
        headers: { "x-api-key": apiKey },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { data: { keyId: string; rawSecret: string } };
      setRotateResult(body.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRotating(false);
    }
  };

  const sorted = [...deliveries.values()].sort(
    (a, b) => a.subscription_sequence - b.subscription_sequence,
  );

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Webhook Delivery Ledger</h1>
          <p className="text-sm text-gray-500 mt-1">
            Subscription <span className="font-mono font-semibold">#{subscriptionId}</span> —
            ordered by <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">subscription_sequence</code>
          </p>
        </div>
        <button
          onClick={rotateKey}
          disabled={rotating}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm
                     font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition"
        >
          {rotating ? "Rotating…" : "Rotate Signing Key"}
        </button>
      </div>

      {rotateResult && (
        <div className="mb-6 rounded-lg border border-yellow-300 bg-yellow-50 p-4 text-sm">
          <p className="font-semibold text-yellow-800 mb-2">New signing key — store the secret now, it will not be shown again.</p>
          <p className="font-mono text-xs text-gray-700 break-all">
            <span className="text-gray-500">Key ID: </span>{rotateResult.keyId}
          </p>
          <p className="font-mono text-xs text-gray-700 break-all mt-1">
            <span className="text-gray-500">Secret: </span>{rotateResult.rawSecret}
          </p>
          <button
            onClick={() => setRotateResult(null)}
            className="mt-2 text-xs text-yellow-700 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400 text-sm">
          Loading delivery ledger…
        </div>
      ) : sorted.length === 0 ? (
        <div className="flex items-center justify-center py-20 text-gray-400 text-sm">
          No deliveries yet for this subscription.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {["#Seq", "Event ID", "Type", "Status", "Attempts", "HTTP", "Delivered At", "Next Retry", "Created"].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {sorted.map((row) => (
                  <tr key={row.subscription_sequence} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3 font-mono text-gray-700">{row.subscription_sequence}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500" title={row.canonical_event_id}>
                      {truncate(row.canonical_event_id, 16)}
                    </td>
                    <td className="px-4 py-3 text-gray-800">{row.event_type}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLORS[row.status]}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-gray-600">{row.attempt_count}</td>
                    <td className="px-4 py-3 text-center text-gray-600">
                      {row.last_status_code ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmt(row.delivered_at)}</td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmt(row.next_retry_at)}</td>
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{fmt(row.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {nextCursor !== null && (
            <div className="mt-4 flex justify-center">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="rounded-lg border border-gray-300 px-5 py-2 text-sm font-medium
                           text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
