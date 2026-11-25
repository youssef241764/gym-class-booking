# Evidence

Put screenshots here, as in every lab's "Evidence to Submit/Keep" part. Name them as below so the report can refer to them.

| # | File name | What it must show | How |
|---|---|---|---|
| 1 | `01-versions.png` | `node -v`, `npm -v`, `git --version`, `aws --version`, `docker version` | Terminal |
| 2 | `02-floci-running.png` | `awsl sts get-caller-identity` → 000000000000, and Floci Dash *Connected, us-east-1* | `source infra/services/_lib.sh` |
| 3 | `03-setup-all.png` | The end of `bash infra/setup-all.sh` (users and studios seeded) | Terminal |
| 4 | `04-dynamodb-tables.png` | The 13 `gym-*` tables, and one table's items | Floci Dash › DynamoDB, or `awsl dynamodb list-tables` |
| 5 | `05-iam-policy.png` | `gym-booking-service-role` with `gym-booking-service-access` attached, plus the JSON | Floci Dash › IAM, or `awsl iam get-policy-version …` |
| 6 | `06-cognito-users.png` | The user pool with the 6 users and 3 groups | Floci Dash › Cognito |
| 7 | `07-deploy-<service>.png` | The end of `bash infra/deploy-backend.sh <your-service>`: API URL and `/api/health` → `runtime: lambda` (**each student, own service**) | Terminal |
| 8 | `08-lambda-functions.png` | The four functions: Active, Node.js 24, handler `lambda.handler` | Floci Dash › Lambda |
| 9 | `09-api-routes.png` | One API's routes list and stage `$default` | Floci Dash › API Gateway |
| 10 | `10-invoke-events.png` | `bash infra/invoke-events.sh <your-service>` with the expected status codes | Terminal |
| 11 | `11-rest-client.png` | `docs/aws-api-tests.http`: T2 (200 + token), T5 (401), T7 (403), T8 (404 from API Gateway) | VS Code REST Client |
| 12 | `12-website-s3.png` | The site at `http://localhost:4566/gym-frontend/index.html` with the footer *API online: lambda (production)* | Browser |
| 13 | `13-network-tab.png` | F12 › Network while booking: OPTIONS 204, then POST 201 | Browser DevTools |
| 14 | `14-check-deployment.png` | `bash infra/check-deployment.sh` → `0 failed` | Terminal |
| 15 | `15-logs.png` | `awsl logs tail /aws/lambda/gym-booking-service --since 15m`: one line per request, no bodies or tokens | Terminal |
| 16 | `16-alarms.png` | The CloudWatch alarms, plus `tests/results/monitoring-evidence.md` | Floci Dash › CloudWatch |
| 17 | `17-tests.png` | `npm run test:integration` (59/59) and `npm run test:security` (27/27) | Terminal |
| 18 | `18-sqs-dlq.png` | The queues and their DLQs | Floci Dash › SQS |
| 19 | `19-github-commits.png` | Your own commits on your service folder (individual ownership) | GitHub |

Per-role screenshots of the website for the report (member, trainer and admin views) can go in `evidence/ui/`.

## Captured on 25 Nov 2026 (used in the final report)

- `cloud/` — Floci console screenshots (Lambda, DynamoDB, S3, Cognito, IAM, SQS, EventBridge, Secrets Manager, KMS, SSM, CloudWatch Logs and alarms, SNS).
- `ui/` — the deployed website for each role (member, trainer, admin), taken with Chrome against `http://localhost:4566/gym-frontend/index.html`.
- `terminal/` — real command and API output against Floci: deployment check, security requests, CloudWatch log queries and alarms, IAM policy, API Gateway routes, secret scan, class-service deployment.

No passwords, tokens or API keys appear in any of them.
