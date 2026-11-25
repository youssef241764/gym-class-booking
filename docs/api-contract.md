# API Contract — Gym Class Booking System

This is the specification the frontend and the four backends are built against, as in Labs 3 and 4.
Each service has its own API Gateway HTTP API on Floci. On your PC each one runs on its own port.

| Service | Owner | On your PC | On Floci (API Gateway) |
|---|---|---|---|
| identity | Team (lead: Youssef Khaled) | `http://localhost:3001` | `http://<ID>.execute-api.localhost.floci.io:4566` |
| class-service | Youssef Ahmed Ibrahim (241764) | `http://localhost:3002` | as above, own API ID |
| booking-service | Youssef Amr Sayed (248183) | `http://localhost:3003` | as above, own API ID |
| attendance-service | Youssef Khaled Mokhtar (245609) | `http://localhost:3004` | as above, own API ID |

`bash infra/deploy-backend.sh <service>` prints each API ID. `source infra/gym-vars.sh` loads the IDs into your terminal.

## Rules that apply to every endpoint

- **Requests:** JSON only. A `POST`, `PUT` or `PATCH` that is not `Content-Type: application/json` gets **415**. The body limit is 20 KB.
- **Authentication:** `Authorization: Bearer <Cognito access token>`. You get the token from `POST /api/auth/login`. A missing, forged or expired token gets **401**.
- **Roles:** the role comes from the token's signed `cognito:groups` claim (`member`, `trainer`, `admin`), never from the request. A wrong role gets **403** `ROLE_NOT_ALLOWED`.
- **Ownership:** a member may only touch their own bookings, and a trainer only their own classes. Anything else gets **403** (for example `NOT_BOOKING_OWNER` or `NOT_ASSIGNED_TRAINER`).
- **Validation:** every body, query and path value is checked on the server. Unknown fields are rejected, which blocks mass assignment. A failure gets **400** `VALIDATION_FAILED` with a `details` list.
- **CORS:** only the website's own address is allowed: `http://localhost:8080` on your PC and `http://localhost:4566` on Floci.
- **Health:** `GET /api/health` → `200 {"status":"ok","service":"…","environment":"production","runtime":"lambda"}`. The runtime is `pc` on your laptop.

### Error format (all services)

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "Request validation failed",
             "details": [{ "field": "email", "message": "Invalid email" }], "requestId": "…" } }
```

| Status | When | Example codes |
|---|---|---|
| 400 | Invalid data | `VALIDATION_FAILED`, `MALFORMED_JSON`, `WEAK_PASSWORD`, `INVALID_CHECKIN_CODE` |
| 401 | No or bad token | `UNAUTHENTICATED` |
| 403 | Signed in, but not allowed | `ROLE_NOT_ALLOWED`, `NOT_BOOKING_OWNER`, `MEMBER_SUSPENDED`, `INTERNAL_ONLY` |
| 404 | The item does not exist | `NOT_FOUND`, `ROUTE_NOT_FOUND`. API Gateway itself answers `{"message":"Not Found"}` for routes it does not have. |
| 409 | A business rule says no | `CLASS_FULL`, `ALREADY_BOOKED`, `SCHEDULING_RULES_FAILED`, `SESSION_ALREADY_CLOSED` |
| 413 | Body over 20 KB | `PAYLOAD_TOO_LARGE` |
| 415 | Body is not JSON | `UNSUPPORTED_MEDIA_TYPE` |
| 429 | Too many attempts | `TOO_MANY_ATTEMPTS` (login, check-in code) |
| 500 | Unexpected failure (details are in the logs only) | `INTERNAL_ERROR` |
| 503 | Another service is down | `DEPENDENCY_UNAVAILABLE` |

## identity (team-shared): wraps Amazon Cognito

| Method | Path | Who | Success | Main errors |
|---|---|---|---|---|
| POST | `/api/auth/register` | anyone | 201 `{user}`, always role `member` | 400, 409 `EMAIL_IN_USE` |
| POST | `/api/auth/login` | anyone | 200 `{accessToken, expiresIn, user}` | 400, 401 (generic message), 403 `ACCOUNT_DISABLED`, 429 after 5 failures in 15 min |
| POST | `/api/auth/logout` | signed in | 204 (Cognito global sign-out) | 401 |
| GET | `/api/users/me` | signed in | 200 `{user}` | 401 |
| GET | `/api/trainers` | signed in | 200 `{trainers:[{id,name}]}` | 401 |
| GET | `/api/users?role=&q=` | admin | 200 `{users}` | 401, 403 |
| PATCH | `/api/users/{id}/role` | admin | 200, the user is signed out everywhere | 400, 403, 404, 409 `CANNOT_CHANGE_OWN_ROLE` |
| PATCH | `/api/users/{id}/status` | admin | 200 (`active`/`disabled`) | 400, 403, 404, 409 `CANNOT_DISABLE_SELF` |

Example: `POST /api/auth/register`

```json
{ "name": "Laila Hassan", "email": "laila@example.com", "password": "StrongPass2026" }
```
→ `201 {"user":{"id":"<uuid>","name":"Laila Hassan","email":"laila@example.com","role":"member"}}`

## class-service: Class & Schedule (Youssef Ahmed Ibrahim)

| Method | Path | Who | Success | Main errors |
|---|---|---|---|---|
| GET | `/api/classes?from=&to=&category=&trainerId=&status=&scope=mine` | anyone (public fields only); staff see more | 200 `{classes}` with live places | 400 |
| GET | `/api/classes/{id}` | anyone | 200 `{class}` | 404 |
| POST | `/api/classes` | trainer, admin | 201 `{class}` (DRAFT or PUBLISHED) | 400, 403, 409 `SCHEDULING_RULES_FAILED` (R1–R7: opening hours, lead time, trainer clash, studio clash, capacity, changeover, public holiday) |
| POST | `/api/classes/series` | trainer, admin | 201 `{created, skipped}` | 400 `SERIES_TOO_LONG`, 409 `NOTHING_CREATED` |
| PATCH | `/api/classes/{id}` | assigned trainer, admin | 200 (needs `version`) | 400, 403, 409 `STALE_VERSION`, `CAPACITY_BELOW_BOOKINGS` |
| POST | `/api/classes/{id}/publish` | assigned trainer, admin | 200 | 409 `INVALID_TRANSITION` |
| POST | `/api/classes/{id}/cancel` | assigned trainer, admin | 200; event `ClassCancelled` | 409 `CLASS_ALREADY_STARTED` |
| DELETE | `/api/classes/{id}` | assigned trainer, admin | 204 (drafts only) | 409 `ONLY_DRAFTS_DELETABLE` |
| GET | `/api/studios` | signed in | 200 `{studios}` | 401 |
| POST | `/api/studios` | admin | 201 `{studio}` | 400, 403 |

## booking-service: Booking & Waitlist (Youssef Amr Sayed)

| Method | Path | Who | Success | Main errors |
|---|---|---|---|---|
| POST | `/api/bookings` | member | 201 `{booking, warnings}` (seat taken atomically) | 400, 403 `MEMBER_SUSPENDED`, 409 `CLASS_FULL`, `ALREADY_BOOKED`, `BOOKING_LIMIT_REACHED`, `BOOKING_WINDOW_NOT_OPEN` |
| GET | `/api/bookings/mine` | member | 200 `{bookings}` | 401 |
| GET | `/api/bookings?classId=` | assigned trainer, admin | 200 `{bookings, waitlist}` | 403 `NOT_ASSIGNED_TRAINER` |
| DELETE | `/api/bookings/{bookingId}` | owner, admin | 200 `{booking, lateCancellation, promotedFromWaitlist}` | 403 `NOT_BOOKING_OWNER`, 409 `BOOKING_NOT_ACTIVE` |
| POST | `/api/waitlist` | member | 201 `{entry}` | 409 `SEATS_AVAILABLE`, `WAITLIST_FULL`, `ALREADY_ON_WAITLIST` |
| GET | `/api/waitlist/mine` | member | 200 `{waitlist}` with positions | 401 |
| DELETE | `/api/waitlist/{classId}` | member (own); admin with `?memberId=` | 204 | 403 |
| GET | `/api/notifications/mine` | signed in | 200 `{notifications}` | 401 |

## attendance-service: Attendance & Reliability (Youssef Khaled Mokhtar)

| Method | Path | Who | Success | Main errors |
|---|---|---|---|---|
| GET | `/api/attendance/{classId}` | assigned trainer, admin | 200 `{class, rows}` (roster + marks) | 403, 409 `ATTENDANCE_NOT_OPEN` |
| PUT | `/api/attendance/{classId}` | assigned trainer, admin | 200 `{recorded}` | 400, 409 `SESSION_CLOSED` |
| POST | `/api/attendance/{classId}/code` | assigned trainer, admin | 201 `{code, expiresAt}` (6 digits, 10 min, stored hashed) | 409 |
| POST | `/api/attendance/{classId}/check-in` | booked member | 201 PRESENT/LATE | 400 `INVALID_CHECKIN_CODE`, 403 `NOT_BOOKED`, 409 `ALREADY_CHECKED_IN`, 429 |
| POST | `/api/attendance/{classId}/close` | assigned trainer, admin | 200 `{summary}`; unmarked → NO_SHOW → strike; event `SessionClosed` | 409 `SESSION_NOT_ENDED`, `SESSION_ALREADY_CLOSED` |
| PATCH | `/api/attendance/{classId}/{memberId}` | admin | 200 (correction with reason, within 48 h) | 409 `CORRECTION_WINDOW_PASSED` |
| GET | `/api/reliability/me` | member | 200 strikes, suspension, attendance rate, history | 401 |
| GET | `/api/reliability/{memberId}` | trainer, admin | 200 | 403 |
| POST | `/api/reliability/{memberId}/lift` | admin | 200 | 409 `NOT_SUSPENDED` |
| GET | `/api/reports/classes?from=&to=&trainerId=` | trainer (own), admin | 200 fill / attendance / no-show rates | 400, 403 `TRAINER_OWN_REPORTS_ONLY` |
| POST | `/api/reports/export` | trainer (own classes only), admin | 201 `{url}` (CSV in S3, SSE-KMS, link valid 5 min) | 400, 403 |
| GET | `/api/audit?day=YYYY-MM-DD&action=&service=` | admin | 200 `{entries}` | 403 |

## Internal endpoints (service to service, not in API Gateway)

| Service | Path | Used by |
|---|---|---|
| class-service | `GET /internal/classes/{id}`, `POST /internal/classes/batch`, `GET /internal/classes` | booking, attendance |
| booking-service | `GET /internal/classes/{classId}/roster`, `POST /internal/booking-counts` | class, attendance |
| attendance-service | `GET /internal/members/{memberId}/eligibility` | booking |

These routes are **not** listed in `services/*/infra/api-routes.txt`, so from the internet they answer `404` from API Gateway.

In the cloud, one Lambda calls another directly with `lambda:Invoke`. Each role may invoke only the functions it needs (`CallOtherServices` in `services/*/infra/iam-policy.json`).

Every call must also carry `x-internal-key`, the receiving service's random key from Secrets Manager. A wrong key gets `403 INTERNAL_ONLY`.

## Events (asynchronous, EventBridge bus `gym-events` → SQS)

| Event | From | Queue | What happens |
|---|---|---|---|
| `ClassCancelled`, `ClassRescheduled`, `ClassCapacityChanged` | class-service | `gym-booking-events` | Booking cancels or updates bookings, promotes the waitlist and notifies members |
| `BookingLateCancelled` | booking-service | `gym-attendance-events` | Attendance adds a LATE_CANCEL strike |
| `SessionClosed` | attendance-service | `gym-class-events` | Class marks the class COMPLETED |
| `MemberSuspended` | attendance-service | `gym-notifications` | Booking notifies the member (in the app and by Brevo e-mail) |
