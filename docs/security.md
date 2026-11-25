# Security Controls (Lab 8 style)

For each layer, this table shows **what** protects the system, **where** in the code or infrastructure, and **how to prove it**. The test IDs refer to `tests/results/security-results.md` (SEC) and `docs/aws-api-tests.http` (T).

| Layer | Control | Where | Prove it |
|---|---|---|---|
| Identity | Amazon Cognito user pool: passwords of 10+ characters with upper case, lower case and a digit; passwords never touch our database | `infra/services/03-cognito.sh`, `services/identity/controllers/users.js` | SEC-17 weak password → 400 |
| Authentication | Every protected route checks the RS256 signature of the access token against the pool's JWKS, plus issuer, client and expiry. `alg:none` and edited tokens fail | `shared/src/auth.js` (`authenticate`) | SEC-01–04 → 401, T5 |
| Authorization (role) | The role comes from the signed `cognito:groups` claim. Routes declare `auth.requireRole(...)`; hiding a button is not enough | `services/*/routes/*.js` | SEC-05–07 → 403, T7 |
| Authorization (owner) | Object-level checks: own booking, assigned trainer, trainer's own reports | `services/*/controllers/*.js` (`denyNotOwner`) | SEC-08–11 → 403 (IDOR) |
| Validation | Strict zod schemas on body, query and params. Unknown fields are rejected (no mass assignment) | `services/*/controllers/*.js`, `shared/src/validate.js` | SEC-12–16, T6 → 400 |
| Content type and size | JSON only (415), body ≤ 20 KB (413), malformed JSON → 400 | `shared/src/app.js` | SEC-14, SEC-15 |
| Rate limiting | (1) App limiter: `RATE_LIMIT_MAX` requests per IP per minute → 429 + `Retry-After`; the IP comes from API Gateway, so a fake `X-Forwarded-For` does not help. (2) API Gateway stage throttling 25 req/s, burst 50. (3) Login: 5 failures in 15 min → 429. (4) Check-in code: 5 attempts | `shared/src/rateLimit.js`, `infra/deploy-backend.sh`, `services/identity/services/loginThrottle.js`, attendance service | SEC-27, SEC-20 |
| Brute force and enumeration | The same generic message for a wrong password and an unknown e-mail. E-mails are stored hashed in the throttle table | identity controller | SEC-21 |
| Security headers | helmet: `X-Content-Type-Options: nosniff`, `X-Frame-Options`, `Strict-Transport-Security` and others. The website has a strict Content-Security-Policy | `shared/src/app.js`, `frontend/index.html` | `curl -sI <api>/api/health` |
| XSS | The frontend writes user text with `textContent` only, never `innerHTML`; the CSP allows no inline scripts | `frontend/js/ui.js` | View source / CSP header |
| CORS | Only the website's address may call the APIs (`CORS_ORIGINS`) | `shared/src/app.js`, Lambda settings | SEC-22, T10/T11, check-deployment T6/T7 |
| Network surface | API Gateway lists explicit routes only. `/internal/*` is not published: services call each other by Lambda invoke | `services/*/infra/api-routes.txt` | T8, T9 → 404 |
| Service-to-service | (1) IAM: a role may invoke only the functions it needs. (2) A 256-bit `x-internal-key` per service, from Secrets Manager, compared in constant time | `services/*/infra/iam-policy.json` (`CallOtherServices`), `shared/src/internal.js` | SEC-18, SEC-19 → 403 |
| Least privilege (IAM) | One role per service. It reaches only its own tables (with explicit actions), its own queues, its own SSM parameter, and the keys it needs. Audit is append-only: `PutItem`, no update or delete | `services/*/infra/iam-policy.json`, `infra/services/07-iam.sh` | `awsl iam get-policy-version …` |
| Secrets | No secret in code, `.env.example` or the website. Internal keys and the Brevo key live in Secrets Manager. `.env` and `infra/.generated/` are git-ignored | `infra/services/01-kms-secrets-ssm.sh`, `.gitignore` | SEC-25 secret scan, check-deployment (`.env` not in bucket) |
| Encryption | Reports bucket: SSE-KMS (`alias/gym-reports`), no public access, versioning, 7-day expiry; downloads use 5-minute pre-signed URLs. SQS queues encrypted | `infra/services/04-s3.sh`, `05-sqs.sh` | INT-51, INT-52 |
| Logging (privacy) | One JSON line per request: time, method, path, status, ms and request id. Never bodies, tokens or passwords; e-mails are hashed | `shared/src/logger.js`, `shared/src/app.js` | SEC-26 log scan |
| Audit trail | Who did what, when, with what outcome, from all services. Append-only table with a viewer for admins | `shared/src/audit.js`, `GET /api/audit` | INT-58 |
| Monitoring | Metric filters (403s, auth failures, server errors, internal access denied) → 5 CloudWatch alarms → SNS `gym-alerts` | `infra/services/08-cloudwatch.sh` | `tests/results/monitoring-evidence.md` |
| Resilience | DLQ on every queue (5 tries); idempotent event handling; atomic seat booking (DynamoDB transaction); point-in-time recovery on business tables | `05-sqs.sh`, booking service, `02-dynamodb.sh` | INT-18 (3 bookings for 1 seat) |
| Errors | 500 answers say "Something went wrong" with a request id; the stack trace goes only to the logs | `shared/src/app.js` | — |

## Threats we considered (STRIDE, short)

| Threat | Example | Mitigation |
|---|---|---|
| **S**poofing | Fake or edited token, or `role: "admin"` in the body | Signature check; role from the token; strict schemas |
| **T**ampering | Change another member's booking ID | Ownership checks (IDOR) |
| **R**epudiation | "I never cancelled that class" | Append-only audit log with actor, role and request id |
| **I**nformation disclosure | Stack traces, other members' data, secrets in Git | Generic errors, public vs staff views, secret scan, Secrets Manager |
| **D**enial of service | Flooding the login or booking API | Rate limiter, API Gateway throttling, login throttle, body limit |
| **E**levation of privilege | Trainer makes themself admin; browser calls `/internal` | Admin-only role change; internal routes not published, plus IAM and key |

## Shared responsibility

AWS (Floci plays AWS here) secures the hardware, network, Lambda runtime and managed services.

We secure everything we write and configure:

- code and dependencies, input validation and authorization;
- IAM policies and CORS;
- which bucket is public;
- where secrets live;
- what we log.
