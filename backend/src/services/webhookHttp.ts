import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';
import { isIP } from 'node:net';
import { resolvePublicAddress } from '../utils/webhookUrlSecurity.js';

export interface WebhookHttpResponse {
  ok: boolean;
  status: number;
}

export async function postWebhook(
  callbackUrl: string,
  body: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<WebhookHttpResponse> {
  const url = new URL(callbackUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Webhook callback URL must use HTTP or HTTPS');
  }

  // Resolve and validate immediately before every attempt, then pin the socket
  // to that exact IP so the HTTP client cannot perform a second, rebound DNS
  // lookup. This runs on dispatch, retries and manual re-sends alike, so a
  // record repointed at a private address after registration is still refused.
  const resolved = await resolvePublicAddress(url.hostname);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();

  const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;
  const lookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [{ address: resolved.address, family: resolved.family }]);
    } else {
      callback(null, resolved.address, resolved.family);
    }
  };

  try {
    return await new Promise<WebhookHttpResponse>((resolve, reject) => {
      const request = transport(
        url,
        {
          method: 'POST',
          headers,
          signal: controller.signal,
          lookup,
          ...(url.protocol === 'https:' && isIP(url.hostname.replace(/^\[|\]$/g, '')) === 0
            ? { servername: url.hostname }
            : {}),
        },
        (response) => {
          response.resume();
          const status = response.statusCode ?? 0;
          // Redirects are never followed (node's http/https client does not
          // follow them; we make that explicit with the equivalent of
          // `redirect: 'manual'`). A 3xx could point at a private address that
          // was never validated, so refuse it instead of chasing it.
          if (status >= 300 && status < 400) {
            reject(
              new Error(
                `Webhook callback URL responded with a redirect (status ${status}); redirects are not followed`,
              ),
            );
            return;
          }
          resolve({ ok: status >= 200 && status < 300, status });
        },
      );
      request.on('error', reject);
      request.end(body);
    });
  } finally {
    clearTimeout(timeout);
  }
}
