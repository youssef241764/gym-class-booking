# API Test Plan

Lab 3 asked for a test plan written before the code, and Lab 4 for testing it against the contract. This plan has four levels, from quickest to most complete.

| Level | What | How to run | Where the results go |
|---|---|---|---|
| 1. Saved Lambda events | One request per file in `services/<service>/events/`, sent to the real Lambda handler | On your PC: `cd services/<service> && npm run events`. On Floci: `bash infra/invoke-events.sh <service>` | Terminal (screenshot) |
| 2. REST Client | Hand tests per service (`services/<service>/requests.http`) and for the cloud (`docs/aws-api-tests.http`, T1–T11) | VS Code → REST Client → *Send Request* | Screenshots in `evidence/` |
| 3. Integration suite | 59 scripted cases across all services: normal and invalid workflows, events, time-based rules | `npm run test:integration` | `tests/results/integration-results.md` |
| 4. Security suite | 27 attack cases: authentication, authorization, IDOR, validation, internal keys, brute force, rate limit, CORS, data exposure, secret scan | `npm run test:security` | `tests/results/security-results.md` |
| + Deployment check | 20+ checks on Floci: functions, routes, CORS, website, private buckets | `bash infra/check-deployment.sh` | Terminal (screenshot) |

## Level 1: saved events (expected results)

| Service | Event file | Request | Expected |
|---|---|---|---|
| identity | `1-health` | GET /api/health | 200, runtime `lambda` (Floci) or `pc` |
| identity | `2-register` | POST /api/auth/register | 201 the first time, 409 `EMAIL_IN_USE` after that |
| identity | `3-register-invalid` | POST with a bad name, e-mail and password | 400 `VALIDATION_FAILED` |
| identity | `4-login-wrong-password` | POST /api/auth/login | 401, generic message |
| identity | `5-users-without-token` | GET /api/users | 401 |
| class-service | `1-health` | GET /api/health | 200 |
| class-service | `2-list-classes` | GET /api/classes | 200 + array |
| class-service | `3-list-classes-invalid-filter` | GET /api/classes?category=karate | 400 |
| class-service | `4-create-class-without-token` | POST /api/classes | 401 |
| class-service | `5-unknown-class` | GET /api/classes/{unknown id} | 404 `NOT_FOUND` |
| booking-service | `1-health` | GET /api/health | 200 |
| booking-service | `2-my-bookings-without-token` | GET /api/bookings/mine | 401 |
| booking-service | `3-book-without-token` | POST /api/bookings | 401 |
| booking-service | `4-internal-without-key` | POST /internal/booking-counts | 403 `INTERNAL_ONLY` |
| attendance-service | `1-health` | GET /api/health | 200 |
| attendance-service | `2-my-reliability-without-token` | GET /api/reliability/me | 401 |
| attendance-service | `3-check-in-without-token` | POST /api/attendance/{id}/check-in | 401 |
| attendance-service | `4-internal-without-key` | GET /internal/members/{id}/eligibility | 403 `INTERNAL_ONLY` |

## Level 3: what the integration suite covers

| Area | Cases | Example |
|---|---|---|
| Identity | INT-01 – INT-03 | Register, duplicate e-mail → 409, sign in |
| Class & Schedule | INT-04 – INT-11 | Studio clash, trainer changeover, holiday rule R7 (Nager.Date) → 409, admin override, closing time, capacity, recurring series |
| Booking & Waitlist | INT-12 – INT-28 | Last seat, class full → waitlist, 3 simultaneous bookings for 1 seat, capacity change → automatic promotion + Brevo e-mail, IDOR, late cancel → strike |
| Attendance & Reliability | INT-29 – INT-48 | Check-in window, wrong code, wrong trainer, close session → no-show → strike, 3 strikes → suspension → booking refused, admin correction |
| Reports | INT-49 – INT-52 | Trainer sees own classes only, encrypted CSV export + pre-signed download |
| Cross-service events + audit | INT-53 – INT-59 | Reschedule/cancel → bookings updated and members notified, audit log from all services, Brevo calls |

The suite moves time forward with a **test clock**: services started with `ALLOW_TEST_CLOCK=true` read an offset from a file. Lambda ignores this setting.

The external APIs are replaced by local stand-ins (`tests/stubs.mjs`) only when the test machine has no internet.

## Running the suites

```bash
# terminal 1: AWS resources (Floci, or the no-Docker preview emulator) + demo data
bash infra/setup-all.sh
# terminal 2: stand-ins for Nager.Date and Brevo (only needed without internet)
STUB_HOLIDAY_DATE=2026-12-01 node tests/stubs.mjs   # any date 3-6 days ahead (YYYY-MM-DD)
# terminal 3: the four services on your PC with the test clock
RATE_LIMIT_MAX=1000 ALLOW_TEST_CLOCK=true HOLIDAY_API_URL=http://localhost:4590 BREVO_API_URL=http://localhost:4591/v3/smtp/email npm run local
# terminal 4
RATE_LIMIT_MAX=1000 npm run test:integration && RATE_LIMIT_MAX=1000 npm run test:security && npm run evidence:monitoring
```

To run the same suites through the **Lambda handler** (`lambda.js` via serverless-http, exactly as on Lambda), start `node tests/lambda-gateway.mjs <service>` for each service instead of `npm run local`. That script plays API Gateway: it opens only the routes in `services/*/infra/api-routes.txt` and answers `404 {"message":"Not Found"}` for any other route.

The security suite can also target the deployed APIs: `GYM_TARGET=floci npm run test:security`.

## Latest results

| Suite | Target | Result |
|---|---|---|
| Integration | Lambda handler via the API Gateway harness | 59 / 59 passed |
| Integration | Services on the PC (`server.js`) | 59 / 59 passed |
| Security | Lambda handler via the API Gateway harness | 27 / 27 passed |
| Security | Services on the PC | 27 / 27 passed |

Full tables are in `tests/results/lambda-handler/` and `tests/results/pc/`. The files directly in `tests/results/` are from the latest run.

After deploying to Floci, add a row for `GYM_TARGET=floci npm run test:security`.
