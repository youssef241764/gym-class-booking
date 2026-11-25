# Integrated tests - Gym Class Booking System

Target: PC: npm run local (server.js on ports 3001-3004) + AWS emulator  
Run at: 2026-11-25T13:39:12.411Z  
Result: 59/59 passed

| ID | Scenario | Expected | Actual | Result |
|---|---|---|---|---|
| INT-01 | Register a new member account | 201, role member | 201 | PASS |
| INT-02 | Register the same email again | 409 EMAIL_IN_USE | 409 EMAIL_IN_USE | PASS |
| INT-03 | Login with the new account | 200 + access token | 200 | PASS |
| INT-04 | Trainer creates and publishes a class (capacity 2) | 201 PUBLISHED | 201 | PASS |
| INT-05 | Second class in the same studio at an overlapping time | 409 R6_STUDIO_CLASH | 409 SCHEDULING_RULES_FAILED | PASS |
| INT-06 | Same trainer, 5 minutes after her class ends (10-min changeover) | 409 R5_TRAINER_CLASH | 409 SCHEDULING_RULES_FAILED | PASS |
| INT-07 | Class on a public holiday (Nager.Date API) | 409 R7_HOLIDAY | 409 SCHEDULING_RULES_FAILED | PASS |
| INT-08 | Admin overrides the holiday rule | 201 holidayCheck HOLIDAY_OVERRIDDEN | 201 | PASS |
| INT-09 | Class that ends after closing time (23:00) | 409 R3_OPENING_HOURS | 409 SCHEDULING_RULES_FAILED | PASS |
| INT-10 | Capacity larger than the studio (Studio B = 15) | 409 R4_CAPACITY | 409 SCHEDULING_RULES_FAILED | PASS |
| INT-11 | Recurring series (7 days), holiday date skipped | 201 created + skipped list | 201 | PASS |
| INT-12 | Member books a place | 201 CONFIRMED | 201 | PASS |
| INT-13 | Second member takes the last place | 201 | 201 | PASS |
| INT-14 | Third member tries to book the full class | 409 CLASS_FULL | 409 CLASS_FULL | PASS |
| INT-15 | Third member joins the waitlist | 201 position 1 | 201 | PASS |
| INT-16 | Member books the same class twice | 409 ALREADY_BOOKED | 409 ALREADY_BOOKED | PASS |
| INT-17 | Booked member tries to join the waitlist | 409 ALREADY_BOOKED | 409 ALREADY_BOOKED | PASS |
| INT-18 | Three simultaneous bookings for one remaining seat | exactly one 201, others 409 | one winner | PASS |
| INT-19 | Public timetable shows live availability from Booking | 200, booked 2 / capacity 2, no trainerId exposed | 200 | PASS |
| INT-20 | Reduce capacity below confirmed bookings (asks Booking) | 409 CAPACITY_BELOW_BOOKINGS | 409 CAPACITY_BELOW_BOOKINGS | PASS |
| INT-21 | Increase capacity to 3 | 200, ClassCapacityChanged event | 200 | PASS |
| INT-22 | Waitlisted member is promoted automatically (event-driven) | booking source WAITLIST | 200 | PASS |
| INT-23 | Promoted member gets an in-app notification + Brevo email | WAITLIST_PROMOTED, emailStatus SENT | 200 | PASS |
| INT-24 | Class full again (3/3): new member joins the waitlist | 201 position 1 | 201 | PASS |
| INT-25 | Member tries to cancel someone else's booking (IDOR) | 403 NOT_BOOKING_OWNER | 403 NOT_BOOKING_OWNER | PASS |
| INT-26 | Member cancels own booking 3 days ahead -> seat goes to the waitlist | 200 CANCELLED (not late), 1 promoted | 200 | PASS |
| INT-27 | Member cancels 1 hour before start | 200 LATE_CANCELLED | 200 | PASS |
| INT-28 | Late cancellation becomes a strike in Attendance (event-driven) | LATE_CANCEL strike | 200 | PASS |
| INT-29 | Check-in code before the window opens (15 min before) | 409 ATTENDANCE_NOT_OPEN | 409 ATTENDANCE_NOT_OPEN | PASS |
| INT-30 | Trainer who is not assigned to the class issues a code | 403 NOT_ASSIGNED_TRAINER | 403 NOT_ASSIGNED_TRAINER | PASS |
| INT-31 | Assigned trainer issues a one-time check-in code | 201 + 6-digit code | 201 | PASS |
| INT-32 | Member enters a wrong code | 400 INVALID_CHECKIN_CODE | 400 INVALID_CHECKIN_CODE | PASS |
| INT-33 | Member checks in with the right code | 201 PRESENT | 201 | PASS |
| INT-34 | Member without a booking (cancelled) uses the code | 403 NOT_BOOKED | 403 NOT_BOOKED | PASS |
| INT-35 | Trainer marks a member who is not on the roster | 400 NOT_BOOKED | 400 NOT_BOOKED | PASS |
| INT-36 | Close the session before it ends | 409 SESSION_NOT_ENDED | 409 SESSION_NOT_ENDED | PASS |
| INT-37 | Attendance sheet merges the Booking roster with records | 200, hana PRESENT, tester UNMARKED | 200 | PASS |
| INT-38 | Close the session after it ends -> unmarked member becomes NO_SHOW | 200 present 1, noShow 1 | 200 | PASS |
| INT-39 | Close the same session twice | 409 SESSION_ALREADY_CLOSED | 409 SESSION_ALREADY_CLOSED | PASS |
| INT-40 | Class service marks the class COMPLETED (SessionClosed event) | status COMPLETED | 200 | PASS |
| INT-41 | No-show member sees the strike on their reliability page | 1 NO_SHOW strike | 200 | PASS |
| INT-42 | Third strike (1 no-show + 2 late cancels) suspends the member | suspended true, 3 strikes | 200 | PASS |
| INT-43 | Suspended member tries to book (Booking asks Attendance) | 403 MEMBER_SUSPENDED | 403 MEMBER_SUSPENDED | PASS |
| INT-44 | Suspension notification delivered (Attendance -> EventBridge -> Booking notifier) | MEMBER_SUSPENDED notification | 200 | PASS |
| INT-45 | Trainer tries an admin-only correction | 403 ROLE_NOT_ALLOWED | 403 ROLE_NOT_ALLOWED | PASS |
| INT-46 | Admin corrects NO_SHOW -> EXCUSED within 48 h | 200 previousStatus NO_SHOW | 200 | PASS |
| INT-47 | Correction removes the strike and lifts the automatic suspension | 2 strikes, suspended false | 200 | PASS |
| INT-48 | Member can book again after the suspension is lifted | 201 | 201 | PASS |
| INT-49 | Trainer report (own classes only) with fill / attendance / no-show rates | 200, C1 attendanceRate 50%, only Sara's classes | 200 | PASS |
| INT-50 | Trainer requests another trainer's report | 403 TRAINER_OWN_REPORTS_ONLY | 403 TRAINER_OWN_REPORTS_ONLY | PASS |
| INT-51 | Admin exports CSV (S3 SSE-KMS + 5-minute pre-signed URL) | 201 + url | 201 | PASS |
| INT-52 | Download the exported CSV through the pre-signed URL | CSV with header row | CSV ok | PASS |
| INT-53 | Trainer reschedules a booked class | 200 new startTime | 200 | PASS |
| INT-54 | Booked member notified of the new time (ClassRescheduled event) | CLASS_RESCHEDULED | 200 | PASS |
| INT-55 | Trainer cancels the class | 200 CANCELLED | 200 | PASS |
| INT-56 | Bookings are cancelled by the gym (ClassCancelled event) | CANCELLED_BY_GYM | 200 | PASS |
| INT-57 | Booking a cancelled class | 409 CLASS_NOT_BOOKABLE | 409 CLASS_NOT_BOOKABLE | PASS |
| INT-58 | Admin audit log shows actions from all services | CLASS_CREATED, BOOKING_CREATED, MEMBER_CHECKED_IN ... | 200 | PASS |
| INT-59 | Emails sent through Brevo API with the key from Secrets Manager | >= 1 call with api-key header | 4 calls | PASS |
