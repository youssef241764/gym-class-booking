# Log and monitoring evidence

Collected: 2026-11-25T13:39:14.048Z from CloudWatch Logs/Metrics (endpoint http://localhost:4566)

## 1. Log query: security-relevant events in the last 6 hours

Query (per log group `/gym/<service>`): filter pattern `"<EVENT>"`, parsed as JSON, counted by `event`.

| Service | HTTP_403 | AUTH_FAILED | AUTH_MISSING | LOGIN_FAILED | LOGIN_THROTTLED | VALIDATION_FAILED | INTERNAL_ACCESS_DENIED | CHECKIN_CODE_INVALID | ACCESS_DENIED |
|---|---|---|---|---|---|---|---|---|---|
| identity | 4 | 8 | 2 | 25 | 4 | 13 | 0 | 0 | 4 |
| class-service | 15 | 0 | 1 | 0 | 0 | 11 | 0 | 0 | 15 |
| booking-service | 25 | 0 | 9 | 0 | 0 | 0 | 7 | 0 | 14 |
| attendance-service | 27 | 0 | 7 | 0 | 0 | 0 | 6 | 4 | 17 |

## 2. Sample log lines (sensitive values already redacted by the logger)

```json
{"ts":"2026-11-25T13:36:27.086Z","level":"warn","service":"identity","event":"HTTP_403","security":true,"requestId":"gw-1795613787085","path":"/api/users/f9ea4a2f-b566-4c95-b61a-490716ca05dc/role","userId":"cdbde71b-5a5a-4ad0-8503-afccf191e48e"}
{"ts":"2026-11-25T13:36:27.399Z","level":"warn","service":"identity","event":"LOGIN_FAILED","security":true,"requestId":"gw-1795613787380","emailHash":"a5e22db40863","failures":1}
{"ts":"2026-11-25T13:36:27.371Z","level":"warn","service":"identity","event":"LOGIN_THROTTLED","security":true,"requestId":"gw-1795613787363","emailHash":"e306e8fb1139"}
{"ts":"2026-11-25T13:39:12.778Z","level":"warn","service":"class-service","event":"HTTP_403","security":true,"requestId":"a8bd4e15-9307-4cfe-9fb7-60a2d89a16e5","path":"/api/classes","userId":"087ba30d-260c-4353-ac53-ed5fa9ade04a"}
{"ts":"2026-11-25T13:39:12.799Z","level":"warn","service":"booking-service","event":"HTTP_403","security":true,"requestId":"41597253-7c8d-4131-ab70-473156002bcd","path":"/internal/booking-counts"}
{"ts":"2026-11-25T13:39:12.799Z","level":"warn","service":"booking-service","event":"INTERNAL_ACCESS_DENIED","security":true,"requestId":"41597253-7c8d-4131-ab70-473156002bcd","path":"/internal/booking-counts","caller":"unknown"}
{"ts":"2026-11-25T13:39:12.797Z","level":"warn","service":"attendance-service","event":"HTTP_403","security":true,"requestId":"aeaead06-b2b2-4a39-8162-5e4937349fbc","path":"/internal/members/f9ea4a2f-b566-4c95-b61a-490716ca05dc/eligibility"}
{"ts":"2026-11-25T13:39:12.796Z","level":"warn","service":"attendance-service","event":"INTERNAL_ACCESS_DENIED","security":true,"requestId":"aeaead06-b2b2-4a39-8162-5e4937349fbc","path":"/internal/members/f9ea4a2f-b566-4c95-b61a-490716ca05dc/eligibility","caller":"unknown"}
```

## 3. Suspicious pattern: users with repeated access-denied decisions

| User (Cognito sub) | ACCESS_DENIED count |
|---|---|
| 087ba30d-260c-4353-ac53-ed5fa9ade04a | 19 |
| cdbde71b-5a5a-4ad0-8503-afccf191e48e | 17 |
| 23d20cec-b47f-4494-aa61-014c3860813f | 9 |
| f9ea4a2f-b566-4c95-b61a-490716ca05dc | 5 |

## 4. Custom metrics (namespace GymBooking, last 6 hours, Sum)

| Metric | Dimensions | Sum |
|---|---|---|
| BookingsCreated | Service=booking-service | 29 |
| BookingRejectedFull | Service=booking-service | 12 |
| WaitlistPromotions | Service=booking-service | 8 |
| CheckInFailures | Service=attendance-service | 4 |
| NoShowsRecorded | Service=attendance-service | 8 |
| MembersSuspended | Service=attendance-service | 4 |

## 5. Alarms

| Alarm | Metric | Threshold (5 min) | State |
|---|---|---|---|
| gym-access-denied-spike | GymBooking/Security/AccessDenied | >= 5 | OK |
| gym-auth-failure-spike | GymBooking/Security/AuthFailures | >= 5 | OK |
| gym-server-errors | GymBooking/Security/ServerErrors | >= 1 | OK |
| gym-internal-access-denied | GymBooking/Security/InternalAccessDenied | >= 1 | OK |
| gym-checkin-bruteforce | GymBooking/CheckInFailures | >= 10 | OK |
