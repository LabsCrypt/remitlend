import http from 'k6/http';
import { check, sleep, fail } from 'k6';

export const options = {
  vus: 10,
  duration: '30s',
  thresholds: {
    checks: ['rate >= 0.99'],
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

function buildHeaders() {
  const jwtToken = __ENV.JWT_TOKEN;
  if (!jwtToken) {
    fail('JWT_TOKEN must be set to a valid lender/admin bearer token before running this load test.');
  }

  const headers = {
    Authorization: `Bearer ${jwtToken}`,
  };

  const apiKey = __ENV.INTERNAL_API_KEY || __ENV.API_KEY;
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }

  return headers;
}

export default function () {
  const BASE_URL = __ENV.TARGET_URL || 'http://localhost:3000';
  const walletPublicKey = __ENV.WALLET_PUBLIC_KEY || __ENV.WALLET_SEED;

  if (!walletPublicKey) {
    fail('WALLET_PUBLIC_KEY (or the legacy WALLET_SEED) must be set to the public key matching JWT_TOKEN.');
  }

  const headers = buildHeaders();
  const endpoints = [
    `${BASE_URL}/api/v1/pool/stats`,
    `${BASE_URL}/api/v1/loans`,
    `${BASE_URL}/api/v1/score/${walletPublicKey}`,
  ];

  for (const endpoint of endpoints) {
    const res = http.get(endpoint, { headers });
    check(res, {
      [`${endpoint} returns 200`]: (r) => r.status === 200,
    });
  }

  sleep(1);
}
