import http from 'k6/http';
import exec from 'k6/execution';
import { check, sleep } from 'k6';

// Baseline load test for the authenticated borrower/lender read paths.
//
// Every endpoint below sits behind `requireJwtAuth`, so the run needs real
// credentials (see .github/workflows/loadtest.yml for how to supply them):
//
//   TARGET_URL          Base URL of the deployment under test.
//   LOADTEST_JWT        JWT of a borrower wallet (scopes read:loans, read:score).
//   LOADTEST_WALLET     Stellar public key that LOADTEST_JWT was issued for. The
//                       loans/score routes reject any other wallet.
//   LOADTEST_LENDER_JWT Optional. JWT of a lender/admin wallet; when set,
//                       GET /pool/stats is exercised too (needs read:pool).

const BASE_URL = __ENV.TARGET_URL || 'http://localhost:3000';
const BORROWER_JWT = __ENV.LOADTEST_JWT;
const WALLET = __ENV.LOADTEST_WALLET;
const LENDER_JWT = __ENV.LOADTEST_LENDER_JWT;

// Any non-200 (401, 403, 404, 5xx...) counts as a failed request, so
// `http_req_failed` can no longer stay green while the endpoints reject us.
http.setResponseCallback(http.expectedStatuses(200));

export const options = {
  vus: 50,
  duration: '60s',
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
    // check() results gate the run: a failing check fails the k6 exit code.
    checks: ['rate>0.99'],
  },
};

function authHeaders(token) {
  return { headers: { Authorization: `Bearer ${token}` } };
}

function buildTargets() {
  const targets = [
    {
      name: 'borrower loans',
      url: `${BASE_URL}/api/v1/loans/borrower/${WALLET}`,
      params: authHeaders(BORROWER_JWT),
    },
    {
      name: 'score',
      url: `${BASE_URL}/api/v1/score/${WALLET}`,
      params: authHeaders(BORROWER_JWT),
    },
  ];
  if (LENDER_JWT) {
    targets.push({
      name: 'pool stats',
      url: `${BASE_URL}/api/v1/pool/stats`,
      params: authHeaders(LENDER_JWT),
    });
  }
  return targets;
}

// Fail fast, before any load is generated, if credentials are missing or the
// endpoints reject them. Otherwise the run would only measure 401 latency.
export function setup() {
  if (!BORROWER_JWT || !WALLET) {
    exec.test.abort('LOADTEST_JWT and LOADTEST_WALLET are required (see loadtest.yml)');
  }
  for (const target of buildTargets()) {
    const res = http.get(target.url, target.params);
    if (res.status !== 200) {
      exec.test.abort(
        `Preflight ${target.name} returned ${res.status}; check credentials and TARGET_URL`,
      );
    }
  }
}

export default function () {
  for (const target of buildTargets()) {
    const res = http.get(target.url, target.params);
    check(res, {
      [`${target.name}: status is 200`]: (r) => r.status === 200,
    });
  }

  sleep(1);
}
