# Log and monitoring evidence

Collected: 2026-11-25T14:49:31.088Z from CloudWatch Logs/Metrics (endpoint http://localhost:4566)

## 1. Log query: security-relevant events in the last 6 hours

Query (per log group `/gym/<service>`): filter pattern `"<EVENT>"`, parsed as JSON, counted by `event`.

| Service | HTTP_403 | AUTH_FAILED | AUTH_MISSING | LOGIN_FAILED | LOGIN_THROTTLED | VALIDATION_FAILED | INTERNAL_ACCESS_DENIED | CHECKIN_CODE_INVALID | ACCESS_DENIED |
|---|---|---|---|---|---|---|---|---|---|
| identity | 1 | 2 | 0 | 6 | 1 | 2 | 0 | 0 | 1 |
| class-service | 3 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 3 |
| booking-service | 5 | 0 | 1 | 0 | 0 | 0 | 1 | 0 | 3 |
| attendance-service | 6 | 0 | 1 | 0 | 0 | 0 | 1 | 1 | 4 |

## 2. Sample log lines (sensitive values already redacted by the logger)

```json
{"ts":"2026-11-25T14:49:25.946Z","level":"warn","service":"identity","event":"HTTP_403","security":true,"requestId":"gw-1795618165944","path":"/api/users/e5845bb0-3bb4-404c-b72f-fdc630c34314/role","userId":"ba807e00-5b22-4acf-8f5c-2c29efa9f728"}
{"ts":"2026-11-25T14:49:26.226Z","level":"warn","service":"identity","event":"LOGIN_FAILED","security":true,"requestId":"gw-1795618166210","emailHash":"28bd5102d4e5","failures":1}
{"ts":"2026-11-25T14:49:26.204Z","level":"warn","service":"identity","event":"LOGIN_THROTTLED","security":true,"requestId":"gw-1795618166200","emailHash":"c9f28710b8dc"}
{"ts":"2026-11-25T14:49:26.004Z","level":"warn","service":"class-service","event":"HTTP_403","security":true,"requestId":"gw-1795618166003","path":"/api/classes","userId":"eef77d51-24ba-441d-b70b-fb50e274ee30"}
{"ts":"2026-11-25T14:49:26.056Z","level":"warn","service":"booking-service","event":"HTTP_403","security":true,"requestId":"gw-1795618166055","path":"/internal/booking-counts"}
{"ts":"2026-11-25T14:49:26.056Z","level":"warn","service":"booking-service","event":"INTERNAL_ACCESS_DENIED","security":true,"requestId":"gw-1795618166055","path":"/internal/booking-counts","caller":"unknown"}
{"ts":"2026-11-25T14:49:26.050Z","level":"warn","service":"attendance-service","event":"HTTP_403","security":true,"requestId":"gw-1795618166049","path":"/internal/members/e5845bb0-3bb4-404c-b72f-fdc630c34314/eligibility"}
{"ts":"2026-11-25T14:49:26.050Z","level":"warn","service":"attendance-service","event":"INTERNAL_ACCESS_DENIED","security":true,"requestId":"gw-1795618166049","path":"/internal/members/e5845bb0-3bb4-404c-b72f-fdc630c34314/eligibility","caller":"unknown"}
```

## 3. Suspicious pattern: users with repeated access-denied decisions

| User (Cognito sub) | ACCESS_DENIED count |
|---|---|
| ba807e00-5b22-4acf-8f5c-2c29efa9f728 | 4 |
| eef77d51-24ba-441d-b70b-fb50e274ee30 | 4 |
| 99e0a157-223a-4681-8c0d-832f981f2380 | 2 |
| e5845bb0-3bb4-404c-b72f-fdc630c34314 | 1 |

## 4. Custom metrics (namespace GymBooking, last 6 hours, Sum)

| Metric | Dimensions | Sum |
|---|---|---|
| BookingsCreated | Service=booking-service | 7 |
| BookingRejectedFull | Service=booking-service | 3 |
| WaitlistPromotions | Service=booking-service | 2 |
| CheckInFailures | Service=attendance-service | 1 |
| NoShowsRecorded | Service=attendance-service | 2 |
| MembersSuspended | Service=attendance-service | 1 |

## 5. Alarms

| Alarm | Metric | Threshold (5 min) | State |
|---|---|---|---|
| gym-access-denied-spike | GymBooking/Security/AccessDenied | >= 5 | OK |
| gym-auth-failure-spike | GymBooking/Security/AuthFailures | >= 5 | OK |
| gym-server-errors | GymBooking/Security/ServerErrors | >= 1 | OK |
| gym-internal-access-denied | GymBooking/Security/InternalAccessDenied | >= 1 | OK |
| gym-checkin-bruteforce | GymBooking/CheckInFailures | >= 10 | OK |
