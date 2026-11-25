# Security test table - Gym Class Booking System

Target: PC: npm run local (server.js on ports 3001-3004) + AWS emulator  
Run at: 2026-11-25T13:39:13.888Z  
Result: 27/27 passed

| ID | Scenario | Expected | Actual | Result |
|---|---|---|---|---|
| SEC-01 | Unauthenticated request to a protected endpoint (my bookings) | 401 UNAUTHENTICATED | 401 UNAUTHENTICATED | PASS |
| SEC-02 | Unauthenticated request to reports | 401 | 401 UNAUTHENTICATED | PASS |
| SEC-03 | Member edits their JWT to add the 'admin' group (signature no longer valid) | 401 invalid token | 401 UNAUTHENTICATED | PASS |
| SEC-04 | Unsigned token with alg 'none' | 401 | 401 UNAUTHENTICATED | PASS |
| SEC-05 | Member tries to create a class (trainer/admin only) | 403 ROLE_NOT_ALLOWED | 403 ROLE_NOT_ALLOWED | PASS |
| SEC-06 | Trainer tries to make a member an admin | 403 ROLE_NOT_ALLOWED | 403 ROLE_NOT_ALLOWED | PASS |
| SEC-07 | Trainer tries to read the audit log (admin only) | 403 | 403 ROLE_NOT_ALLOWED | PASS |
| SEC-08 | Member cancels another member's booking by changing the ID (IDOR) | 403 NOT_BOOKING_OWNER | 403 NOT_BOOKING_OWNER | PASS |
| SEC-09 | Trainer edits another trainer's class | 403 NOT_ASSIGNED_TRAINER | 403 NOT_ASSIGNED_TRAINER | PASS |
| SEC-10 | Trainer reads the roster of another trainer's class | 403 | 403 NOT_ASSIGNED_TRAINER | PASS |
| SEC-11 | Trainer schedules a class in another trainer's name | 403 TRAINER_CAN_ONLY_SCHEDULE_SELF | 403 TRAINER_CAN_ONLY_SCHEDULE_SELF | PASS |
| SEC-12 | Invalid class fields (short title, bad date, negative duration, zero capacity) | 400 VALIDATION_FAILED | 400 VALIDATION_FAILED | PASS |
| SEC-13 | Self-registration with an extra field role='admin' (mass assignment) | 400 (unknown field rejected) | 400 VALIDATION_FAILED | PASS |
| SEC-14 | Malformed JSON body | 400 MALFORMED_JSON | 400 MALFORMED_JSON | PASS |
| SEC-15 | Unsupported content type (text/plain) | 415 | 415 UNSUPPORTED_MEDIA_TYPE | PASS |
| SEC-16 | Injection-style value in a path parameter | 400 VALIDATION_FAILED | 400 VALIDATION_FAILED | PASS |
| SEC-17 | Weak password at registration | 400 | 400 VALIDATION_FAILED | PASS |
| SEC-18 | Browser/attacker calls an internal endpoint without the service key | 403 INTERNAL_ONLY | 403 INTERNAL_ONLY | PASS |
| SEC-19 | Internal endpoint with a guessed service key | 403 | 403 INTERNAL_ONLY | PASS |
| SEC-20 | Six wrong passwords for one account | five 401 then 429 (temporary cool-down) | 401,401,401,401,401,429 | PASS |
| SEC-21 | Login error does not reveal whether the email exists | 401 same generic message | 401 UNAUTHENTICATED | PASS |
| SEC-22 | Cross-origin request from an unknown site | no Access-Control-Allow-Origin header | header absent | PASS |
| SEC-23 | Anonymous class view hides internal fields | no trainerId / createdBy / version | 200 | PASS |
| SEC-24 | Admin user list contains no password/hash/token fields | no sensitive fields | clean | PASS |
| SEC-25 | Secret exposure review: scan repository files for keys, passwords, tokens | 0 findings; .env files git-ignored | 0 findings | PASS |
| SEC-26 | Application logs contain no JWTs or passwords | none found | clean | PASS |
| SEC-27 | 1010 quick requests from one IP (limit 1000/min), faking X-Forwarded-For | some 429 RATE_LIMITED with Retry-After | 958x200, 52x429 | PASS |
