# End-to-end tests on the deployed system (Floci, real time)

Target: Lambda + API Gateway on Floci  
Run at: 2026-11-25T17:56:00.399Z  
Result: 53/53 passed

| ID | Scenario | Expected | Actual | Result |
|---|---|---|---|---|
| E2E-01 | Register a new member (identity Lambda -> Cognito + DynamoDB) | 201 role member | 201 | PASS |
| E2E-02 | Register the same email again | 409 EMAIL_IN_USE | 409 EMAIL_IN_USE | PASS |
| E2E-03 | Login with a wrong password | 401 | 401 UNAUTHENTICATED | PASS |
| E2E-04 | Login with the right password | 200 + access token | 200 | PASS |
| E2E-05 | Member tries to create a class | 403 ROLE_NOT_ALLOWED | 403 ROLE_NOT_ALLOWED | PASS |
| E2E-06 | Create a class without a token | 401 | 401 UNAUTHENTICATED | PASS |
| E2E-07 | Create a class with invalid fields | 400 VALIDATION_FAILED | 400 VALIDATION_FAILED | PASS |
| E2E-08 | Class starting in 5 minutes (30-minute lead time rule) | 409 SCHEDULING_RULES_FAILED (R1) | 409 SCHEDULING_RULES_FAILED | PASS |
| E2E-09 | Trainer creates and publishes a class starting in ~32 minutes | 201 PUBLISHED | 201 | PASS |
| E2E-10 | Another class in the same studio at an overlapping time | 409 SCHEDULING_RULES_FAILED (R6) | 409 SCHEDULING_RULES_FAILED | PASS |
| E2E-11 | Capacity larger than the studio | 409 SCHEDULING_RULES_FAILED (R4) | 409 SCHEDULING_RULES_FAILED | PASS |
| E2E-12 | Member books a place (Booking asks Class: bookable? and Attendance: suspended?) | 201 CONFIRMED | 201 | PASS |
| E2E-13 | Second member takes the last place | 201 | 201 | PASS |
| E2E-14 | Third member tries to book the full class | 409 CLASS_FULL | 409 CLASS_FULL | PASS |
| E2E-15 | Third member joins the waitlist | 201 position 1 | 201 | PASS |
| E2E-16 | Member books the same class twice | 409 ALREADY_BOOKED | 409 ALREADY_BOOKED | PASS |
| E2E-17 | Booking with a malformed class id | 400 VALIDATION_FAILED | 400 VALIDATION_FAILED | PASS |
| E2E-18 | Member cancels someone else's booking (IDOR) | 403 NOT_BOOKING_OWNER | 403 NOT_BOOKING_OWNER | PASS |
| E2E-19 | Public timetable shows live availability from Booking (no trainerId exposed) | 200 booked 2/2 | 200 | PASS |
| E2E-20 | Reduce capacity below confirmed bookings (Class asks Booking) | 409 CAPACITY_BELOW_BOOKINGS | 409 CAPACITY_BELOW_BOOKINGS | PASS |
| E2E-21 | Another trainer edits Sara's class | 403 | 403 NOT_ASSIGNED_TRAINER | PASS |
| E2E-22 | Assigned trainer increases capacity to 3 | 200 capacity 3 | 200 | PASS |
| E2E-23 | Waitlisted member promoted (ClassCapacityChanged -> EventBridge -> SQS -> Booking) | CONFIRMED, source WAITLIST | 200 | PASS |
| E2E-24 | Promoted member gets an in-app notification (Brevo e-mail status recorded) | WAITLIST_PROMOTED | 200 | PASS |
| E2E-25 | Member cancels ~30 minutes before the start (< 2 h) | 200 LATE_CANCELLED | 200 | PASS |
| E2E-26 | Late cancellation becomes a strike in Attendance (BookingLateCancelled event) | LATE_CANCEL strike | 200 | PASS |
| E2E-27 | Member sees own strike on the reliability page | 200 strikeCount 1 | 200 | PASS |
| E2E-28 | Member reads another member's reliability record | 403 | 403 ROLE_NOT_ALLOWED | PASS |
| E2E-29 | Check-in code requested 30 minutes before the class (window opens at 15) | 409 ATTENDANCE_NOT_OPEN | 409 ATTENDANCE_NOT_OPEN | PASS |
| E2E-30 | Attendance sheet built from the Booking roster | 200, 2 rows UNMARKED | 200 | PASS |
| E2E-31 | Member opens the attendance sheet | 403 | 403 ROLE_NOT_ALLOWED | PASS |
| E2E-32 | Trainer report (own classes only) | 200, only Sara | 200 | PASS |
| E2E-33 | Trainer requests another trainer's report | 403 TRAINER_OWN_REPORTS_ONLY | 403 TRAINER_OWN_REPORTS_ONLY | PASS |
| E2E-34 | Admin exports CSV to S3 (SSE-KMS) and gets a 5-minute pre-signed URL | 201 + signed url | 201 | PASS |
| E2E-35 | Download the CSV through the pre-signed URL | CSV header row | CSV ok | PASS |
| E2E-36 | Trainer's CSV export is scoped to his own classes (no Sara classes) | 201, no Sara Trainer rows | 201 | PASS |
| E2E-37 | Trainer creates a second class (2 days ahead) | 201 | 201 | PASS |
| E2E-38 | Member books it | 201 | 201 | PASS |
| E2E-39 | Trainer reschedules the booked class | 200 | 200 | PASS |
| E2E-40 | Edit with an out-of-date version (optimistic locking) | 409 | 409 STALE_VERSION | PASS |
| E2E-41 | Booked member notified of the new time (ClassRescheduled event) | CLASS_RESCHEDULED | 200 | PASS |
| E2E-42 | Trainer cancels the class | 200 CANCELLED | 200 | PASS |
| E2E-43 | Bookings cancelled by the gym (ClassCancelled event) | CANCELLED_BY_GYM | 200 | PASS |
| E2E-44 | Booking a cancelled class | 409 CLASS_NOT_BOOKABLE | 409 CLASS_NOT_BOOKABLE | PASS |
| E2E-45 | Admin audit log has actions from every service | USER_REGISTERED, CLASS_CREATED, BOOKING_CREATED | 200 | PASS |
| E2E-46 | Trainer opens the audit log | 403 | 403 ROLE_NOT_ALLOWED | PASS |
| E2E-47 | Trainer not assigned to the class issues a code | 403 NOT_ASSIGNED_TRAINER | 403 NOT_ASSIGNED_TRAINER | PASS |
| E2E-48 | Assigned trainer issues a one-time check-in code | 201 + 6 digits | 201 | PASS |
| E2E-49 | Member enters a wrong code | 400 INVALID_CHECKIN_CODE | 400 INVALID_CHECKIN_CODE | PASS |
| E2E-50 | Member checks in with the right code | 201 PRESENT | 201 | PASS |
| E2E-51 | Member whose booking was cancelled uses the code | 403 NOT_BOOKED | 403 NOT_BOOKED | PASS |
| E2E-52 | Close the session before it ends | 409 SESSION_NOT_ENDED | 409 SESSION_NOT_ENDED | PASS |
| E2E-53 | Attendance sheet shows the checked-in member | 200, m1 PRESENT | 200 | PASS |
