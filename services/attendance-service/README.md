# Attendance & Reliability service

Part of the **Gym Class Booking System** (Group 33, Cloud Computing & Cloud Security 26CSCN29H).
Owner: **Youssef Khaled Mokhtar (245609)**. Team repository (website, shared code, infrastructure, docs): https://github.com/youssef241764/gym-class-booking

## Functions
- F1 Attendance sheet and trainer marking
- F2 One-time 6-digit check-in code (hashed, 10 minutes, 5 attempts)
- F3 Close session → no-shows → strikes (plus automatic close every 15 minutes)
- F4 Strike / suspension policy, admin correction and lift
- F5 Reports and KMS-encrypted CSV export; admin audit-log viewer

## Endpoints (API Gateway routes, `infra/api-routes.txt`)
- `GET /api/health`
- `GET /api/attendance/{classId}`
- `PUT /api/attendance/{classId}`
- `POST /api/attendance/{classId}/code`
- `POST /api/attendance/{classId}/check-in`
- `POST /api/attendance/{classId}/close`
- `PATCH /api/attendance/{classId}/{memberId}`
- `GET /api/reliability/me`
- `GET /api/reliability/{memberId}`
- `POST /api/reliability/{memberId}/lift`
- `GET /api/reports/classes`
- `POST /api/reports/export`
- `GET /api/audit`

Contract, roles and status codes: `docs/api-contract.md` in the team repository.

## Folder layout (Labs 4 and 7)
| Path | What it is |
|---|---|
| `app.js` | Builds the Express app (no listen) |
| `server.js` | Runs it on your PC: `npm run dev` → http://localhost:3004 |
| `lambda.js` | The same app on AWS Lambda (handler `lambda.handler`) |
| `routes/attendance.js` | Method + path + who may call it (auth middleware) |
| `controllers/attendance.js` | Reads the request, validates it, calls the services, chooses the status code |
| `services/` | Business rules and DynamoDB access |
| `workers.js` | SQS messages and scheduled jobs |
| `events/` | Saved Lambda test events (Lab 7, Part 6) |
| `requests.http` | REST Client tests on your PC |
| `infra/iam-policy.json` | This service's least-privilege IAM policy |
| `infra/api-routes.txt` | The only routes API Gateway publishes for this service |
| `infra/ssm-policy.json` | Business rules stored in SSM Parameter Store |
| `.env.example` | Settings to copy into `.env` (never commit `.env`) |

**AWS services used:** Lambda, API Gateway, IAM, CloudWatch Logs, DynamoDB `gym-attendance`, `gym-attendance-sessions`, `gym-strikes`, `gym-member-standing`; S3 `gym-reports` + KMS; EventBridge schedule; CloudWatch metrics; SSM `/gym/attendance-service/policy`.

## Run it
This repository is used inside the team repository (it needs the shared `gym-shared` package from `../../shared`):
```bash
git clone https://github.com/youssef241764/gym-class-booking.git
cd gym-class-booking
bash infra/get-services.sh      # clones this repo into services/attendance-service
npm run install-all
npm run preview                 # on your PC (no Docker)     or:  npm run cloud   (Floci)
```
Only this service: `cd services/attendance-service && npm run dev`, `npm run events`, `npm run zip`, and on Floci `bash infra/deploy-backend.sh attendance-service` (from the team repository).
