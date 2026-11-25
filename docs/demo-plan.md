# Demo Plan and Video Script

The demo video can be at most 5 minutes. It needs no commentary, and the link must be set to "anyone with the link can view". The same order is used for the live demo in week 12.

Timing: Lambda uses the real clock, so the class in A1 is set to start 35 minutes after you create it (the minimum lead time is 30 minutes). Record A1–A7, pause, record A8–A9 once check-in opens (15 minutes before the start), then record A10–A11 after the class ends. Cut the waits out when editing.

**Before recording**
- Floci is running and deployed (`npm run cloud` gives `0 failed`).
- Chrome is open at `http://localhost:4566/gym-frontend/index.html`, and the footer shows **API online: lambda (production)**.
- Floci Dash is open in a second tab: `http://localhost:4566/_floci/ui`.
- The demo passwords are in `infra/.generated/seed-credentials.txt`. Never show that file on screen.
- Record with QuickTime › File › New Screen Recording, or press ⌘⇧5.

## Part A: main end-to-end scenario (about 3 minutes)

| # | Who | Action | What the viewer sees | Service |
|---|---|---|---|---|
| A1 | Sara (trainer) | Sign in › **New class**: "Morning Yoga", yoga, Studio A, start **35 minutes from now**, 15 min, capacity 2, Publish | 201: the class is created and published | Class & Schedule |
| A2 | Sara | Try a second class in Studio A at the same time | 409 `SCHEDULING_RULES_FAILED`: studio clash (R4) shown in the form | Class & Schedule |
| A3 | Ali (member) | Sign out, sign in as Ali › **Timetable** › Morning Yoga › **Book** | "Booked", 1 of 2 places left | Booking ⇄ Class |
| A4 | Nour (member) | Sign in as Nour › Book the same class | Class is now full (2 of 2) | Booking |
| A5 | Hana (member) | Sign in as Hana › Book › **Join waitlist** | 409 `CLASS_FULL`, then "Waitlist position 1" | Booking |
| A6 | Nour | **My bookings** › Cancel | Seat freed; Hana is promoted automatically | Booking (waitlist promotion) |
| A7 | Hana | **My bookings** + notifications | Booking with source WAITLIST, plus a "promoted" notification | Booking |
| A8 | Sara | (once it is 15 minutes before the start) **My classes** › Morning Yoga › **Attendance** › Issue check-in code | A 6-digit code, valid 10 minutes | Attendance ⇄ Booking (roster) |
| A9 | Ali | **Check in** › enter the code | PRESENT recorded | Attendance |
| A10 | Sara | Mark Hana PRESENT › **Close session** (after the class has ended) | Unmarked members become NO_SHOW and get a strike; the class becomes COMPLETED | Attendance → EventBridge → Class |
| A11 | Admin | **Reports** › Export CSV | Fill / attendance / no-show rates; KMS-encrypted CSV download | Attendance |

## Part B: security scenarios (about 1.5 minutes)

| # | Scenario | Expected |
|---|---|---|
| B1 | Signed out, open `#/my-bookings` | Redirected to sign-in. The API answers 401 (show it in DevTools › Network) |
| B2 | Ali (member) types `#/trainer/new` in the address bar, then sends the same request directly (`docs/aws-api-tests.http` T7 with Ali's token) | The page refuses, and the backend answers 403 `ROLE_NOT_ALLOWED`: the check is on the server, not just a hidden menu |
| B3 | Register with name "X", e-mail "abc" and password "short" | 400 `VALIDATION_FAILED`, with a message for each field |
| B4 | Sign in with a wrong password 6 times | 401 five times, then 429 `TOO_MANY_ATTEMPTS` |
| B5 | Ali cancels Nour's booking (send the request from DevTools, or run `docs/aws-api-tests.http` with Ali's token) | 403 `NOT_BOOKING_OWNER` |
| B6 | Open `$BOOKINGS_API_URL/internal/booking-counts` | 404 from API Gateway: internal routes are not published |

## Part C: evidence (about 30 seconds)

1. Floci Dash › CloudWatch Logs › `/gym/identity`, filtered on `LOGIN_FAILED`. These are the failed sign-ins from B4; e-mails appear only as hashes.
2. Floci Dash › CloudWatch › Alarms: `gym-auth-failure-spike` and the four other alarms.
3. Terminal: `bash infra/check-deployment.sh` → `Result: 25 passed, 0 failed`.

## Live discussion: what each student shows for his own service

- **The request flow:** browser › `frontend/js/views/<file>.js` › API Gateway route › `routes/` › `controllers/` (validation) › `services/` (rules + DynamoDB) › response.
- **One saved Lambda event:** `bash infra/invoke-events.sh <service>`.
- **The IAM policy** (`services/<service>/infra/iam-policy.json`), and why it does not use `*`.
- **One invalid and one unauthorized request** for his service, with their status codes.
- **His service's log group** in Floci Dash.
