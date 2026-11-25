# Class & Schedule service

Part of the **Gym Class Booking System** (Group 33, Cloud Computing & Cloud Security 26CSCN29H).
Owner: **Youssef Ahmed Ibrahim (241764)**. Team repository (website, shared code, infrastructure, docs): https://github.com/youssef241764/gym-class-booking

## Functions
- F1 Create a class checked against 7 scheduling rules (opening hours, lead time, trainer clash, studio clash, capacity, changeover, public holidays from Nager.Date)
- F2 Weekly recurring series (skips dates that break a rule)
- F3 Update / reschedule / publish with a version check
- F4 Cancel a class (event `ClassCancelled` → Booking cancels the bookings)
- F5 Timetable with live places from the Booking service

## Endpoints (API Gateway routes, `infra/api-routes.txt`)
- `GET /api/health`
- `GET /api/classes`
- `GET /api/classes/{id}`
- `POST /api/classes`
- `POST /api/classes/series`
- `PATCH /api/classes/{id}`
- `POST /api/classes/{id}/publish`
- `POST /api/classes/{id}/cancel`
- `DELETE /api/classes/{id}`
- `GET /api/studios`
- `POST /api/studios`

Contract, roles and status codes: `docs/api-contract.md` in the team repository.

## Folder layout (Labs 4 and 7)
| Path | What it is |
|---|---|
| `app.js` | Builds the Express app (no listen) |
| `server.js` | Runs it on your PC: `npm run dev` → http://localhost:3002 |
| `lambda.js` | The same app on AWS Lambda (handler `lambda.handler`) |
| `routes/classes.js` | Method + path + who may call it (auth middleware) |
| `controllers/classes.js` | Reads the request, validates it, calls the services, chooses the status code |
| `services/` | Business rules and DynamoDB access |
| `workers.js` | SQS messages and scheduled jobs |
| `events/` | Saved Lambda test events (Lab 7, Part 6) |
| `requests.http` | REST Client tests on your PC |
| `infra/iam-policy.json` | This service's least-privilege IAM policy |
| `infra/api-routes.txt` | The only routes API Gateway publishes for this service |
| `infra/ssm-policy.json` | Business rules stored in SSM Parameter Store |
| `.env.example` | Settings to copy into `.env` (never commit `.env`) |

**AWS services used:** Lambda, API Gateway, IAM, CloudWatch Logs, DynamoDB `gym-classes` (3 indexes), `gym-studios`; EventBridge producer; SQS `gym-class-events`; SSM `/gym/class-service/policy`.

## Run it
This repository is used inside the team repository (it needs the shared `gym-shared` package from `../../shared`):
```bash
git clone https://github.com/youssef241764/gym-class-booking.git
cd gym-class-booking
bash infra/get-services.sh      # clones this repo into services/class-service
npm run install-all
npm run preview                 # on your PC (no Docker)     or:  npm run cloud   (Floci)
```
Only this service: `cd services/class-service && npm run dev`, `npm run events`, `npm run zip`, and on Floci `bash infra/deploy-backend.sh class-service` (from the team repository).
