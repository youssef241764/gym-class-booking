# Deployment on Floci: Steps and Record

This follows Lab 7 (Lambda, DynamoDB, IAM, API Gateway and S3) and Lab 8 (one script per AWS service, then a check script). Every step can be done two ways, as in the labs:

- **Way A:** click it in Floci Dash at http://localhost:4566/_floci/ui.
- **Way B:** type the AWS CLI command in a terminal. Use Git Bash on Windows or Terminal on macOS.

Both ways build exactly the same thing. The scripts in `infra/` are Way B written down, so they can be re-run and explained line by line.

## 0. Before you start (once per laptop)

| Tool | Check | Install |
|---|---|---|
| Docker Desktop (running) | `docker version` | docker.com → Docker Desktop (Windows / Mac Apple silicon or Intel) |
| Node.js 20+ | `node -v` | nodejs.org (LTS) |
| AWS CLI v2 | `aws --version` | Windows: AWS CLI MSI. macOS: `brew install awscli` or the .pkg from AWS |
| Git Bash (Windows only) | | git-scm.com |

```bash
npm run install-all                                    # npm install in every folder
docker compose -f infra/floci/docker-compose.yml up -d  # start Floci (Floci Dash starts with it)
source infra/services/_lib.sh                          # dummy keys + the awsl command (every new terminal)
awsl sts get-caller-identity --query Account --output text   # -> 000000000000
```

> `awsl` is short for `aws --endpoint-url http://localhost:4566`. If you set up the `floci` profile in Lab 7, then `export AWS_PROFILE=floci` with plain `aws` does the same.

## 1. Build the AWS resources: `bash infra/setup-all.sh`

`setup-all.sh` runs these scripts in order. Each one is safe to run again.

| Script | Builds | Way A in Floci Dash |
|---|---|---|
| `01-kms-secrets-ssm.sh` | KMS key `alias/gym-reports`; secrets `gym/<service>/internal-key` and `gym/booking-service/brevo-api-key`; parameters `/gym/<service>/policy` | KMS › Create key · Secrets Manager › Store a new secret · SSM › Create parameter |
| `02-dynamodb.sh` | 13 tables from `infra/dynamodb/tables/*.json`, TTL and point-in-time recovery | DynamoDB › Create table (key names from the JSON file) |
| `03-cognito.sh` | User pool `gym-users-pool`, app client `gym-web`, groups `admin`, `trainer`, `member` | Cognito › Create user pool |
| `04-s3.sh` | `gym-frontend` (public read), `gym-reports` (private, KMS, versioned, lifecycle) | S3 › Create bucket |
| `05-sqs.sh` | 4 queues, each with a DLQ | SQS › Create queue |
| `06-eventbridge.sh` | Bus `gym-events`, 4 rules → queues, queue policies, archive | EventBridge › Create rule |
| `07-iam.sh` | Role `gym-<service>-role` + policy `gym-<service>-access` for each service | IAM › Roles / Policies (paste the JSON from `services/<service>/infra/iam-policy.json`) |
| `08-cloudwatch.sh` | Log groups, metric filters, 5 alarms, SNS topic `gym-alerts` | CloudWatch |
| `09-seed.sh` | 6 demo users (Cognito + `gym-users`) and 3 studios | Cognito › Users · DynamoDB › Put item |
| `write-env.sh` | `services/*/.env` for running on your PC | – |

The demo passwords are printed at the end of `09-seed.sh`. They are also saved in `infra/.generated/seed-credentials.txt`, which is git-ignored.

Example from `07-iam.sh` (Lab 7, Part 3):

```bash
awsl iam create-role --role-name gym-booking-service-role \
  --assume-role-policy-document file://infra/iam/trust-policy.json
awsl iam create-policy --policy-name gym-booking-service-access \
  --policy-document file://services/booking-service/infra/iam-policy.json
awsl iam attach-role-policy --role-name gym-booking-service-role \
  --policy-arn arn:aws:iam::000000000000:policy/gym-booking-service-access
```

## 2. Deploy each backend: `bash infra/deploy-backend.sh <service>`

**Each owner deploys their own service.** `all` deploys the four together.

```bash
bash infra/deploy-backend.sh class-service        # Youssef Ahmed
bash infra/deploy-backend.sh booking-service      # Youssef Amr
bash infra/deploy-backend.sh attendance-service   # Youssef Khaled
bash infra/deploy-backend.sh identity             # team
```

What the script does for one service. These are the Lab 7 commands with our names:

```bash
cd services/booking-service && npm install && npm run zip && cd ../..   # -> lambda.zip

awsl lambda create-function --function-name gym-booking-service \
  --runtime nodejs24.x --handler lambda.handler \
  --role arn:aws:iam::000000000000:role/gym-booking-service-role \
  --zip-file fileb://services/booking-service/lambda.zip --timeout 20 \
  --environment file://infra/.generated/lambda-env-booking-service.json

API_ID=$(awsl apigatewayv2 create-api --name gym-booking-service-api --protocol-type HTTP --query ApiId --output text)
INTEGRATION_ID=$(awsl apigatewayv2 create-integration --api-id $API_ID \
  --integration-type AWS_PROXY --payload-format-version 2.0 \
  --integration-uri arn:aws:lambda:us-east-1:000000000000:function:gym-booking-service \
  --query IntegrationId --output text)
# one create-route per line of services/booking-service/infra/api-routes.txt, e.g.
awsl apigatewayv2 create-route --api-id $API_ID --route-key "POST /api/bookings" --target integrations/$INTEGRATION_ID
awsl apigatewayv2 create-stage --api-id $API_ID --stage-name '$default' --auto-deploy
awsl lambda add-permission --function-name gym-booking-service --statement-id apigw-invoke \
  --action lambda:InvokeFunction --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:us-east-1:000000000000:$API_ID/*"
echo http://$API_ID.execute-api.localhost.floci.io:4566
```

The script also connects the service's SQS queues to its function (event source mappings). For the attendance service it adds the 15-minute EventBridge schedule.

**Lambda settings per function**

| Setting | Value |
|---|---|
| Runtime | `nodejs24.x` |
| Handler | `lambda.handler` |
| Timeout | 20 s |
| Memory | 256 MB |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | `http://localhost:4566` |
| Cognito | `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID` |
| Other services | `CLASS_SERVICE_FUNCTION`, `BOOKING_SERVICE_FUNCTION`, `ATTENDANCE_SERVICE_FUNCTION` |

No keys are set on the function: on Lambda, the IAM role gives permission.

**Test with saved events (Lab 7, Part 6):** run `bash infra/invoke-events.sh booking-service`. The expected status codes are in `docs/api-test-plan.md`.

## 3. Put the website on S3: `bash infra/deploy-frontend.sh`

The script writes the four API URLs into `frontend/js/config.js`, then uploads the site:

```bash
awsl s3 sync frontend s3://gym-frontend --exclude "package.json" --exclude "node_modules/*"
awsl s3 cp frontend/css s3://gym-frontend/css --recursive --content-type text/css
awsl s3 cp frontend/js s3://gym-frontend/js --recursive --content-type text/javascript
```

Open **http://localhost:4566/gym-frontend/index.html**. Type `localhost`, not `127.0.0.1`. The footer must show **API online: lambda (production)**.

## 4. Check everything: `bash infra/check-deployment.sh`

Expected ending: `Result: N passed, 0 failed`. The script covers:

- Floci, the tables, the user pool, and the four roles with their policies;
- each function is Active and its `/api/health` answers `runtime: lambda`;
- validation 400, unknown route 404 from API Gateway, no-token 401, `/internal` not reachable;
- CORS allowed for our website and refused for evil.example;
- the website files are served, there is no `.env` in the bucket, and `gym-reports` is private.

Then: `GYM_TARGET=floci npm run test:security`.

## 5. Record (fill in on your own laptop)

| Item | Value |
|---|---|
| Date / who deployed | 25 Nov 2026, Youssef Ahmed Ibrahim (all four services on one laptop) |
| identity API ID / URL | c4dc524553 / http://c4dc524553.execute-api.localhost.floci.io:4566 |
| class-service API ID / URL | 04e2cdcad1 / http://04e2cdcad1.execute-api.localhost.floci.io:4566 |
| booking-service API ID / URL | 39dd76a2a0 / http://39dd76a2a0.execute-api.localhost.floci.io:4566 |
| attendance-service API ID / URL | 316839148b / http://316839148b.execute-api.localhost.floci.io:4566 |
| Website URL | http://localhost:4566/gym-frontend/index.html |
| `check-deployment.sh` result | 25 passed, 0 failed |
| `test:security` against Floci | 27 / 27 |
| `test:e2e:floci:live` against Floci | see `tests/results/floci/floci-e2e-live-results.md` |

API IDs change when the stack is rebuilt. `source infra/gym-vars.sh` prints the IDs and URLs.

## Common problems

| Problem | Likely cause | Fix |
|---|---|---|
| `Nothing answers on http://localhost:4566` | Floci is not running | Start Docker Desktop, then `docker compose -f infra/floci/docker-compose.yml up -d` |
| `localhost.floci.io` cannot be found | No internet / DNS | Use the same address ending in `.execute-api.localhost:4566` |
| API answers 500 | Error in the code or a missing setting | `awsl logs tail /aws/lambda/gym-<service> --since 10m` |
| Website shows "API offline" | `config.js` is old or a URL is missing | `bash infra/deploy-frontend.sh`, then Ctrl+F5 (Cmd+Shift+R on Mac) |
| CORS error in the browser console | Page opened from `127.0.0.1`, or a different port | Open `http://localhost:4566/gym-frontend/index.html` |
| `/c/Users/...` path errors (Windows) | Git Bash path conversion | `export MSYS_NO_PATHCONV=1`; `_lib.sh` sets it |
| Lambda stays Pending | First start pulls the Node.js image | Wait a minute, then run the deploy script again |

## Real AWS instead of Floci

The commands and code are the same. Use a real AWS profile and account, then replace `000000000000` with your account ID in `infra/iam/trust-policy.json` and `services/*/infra/iam-policy.json`.

On real AWS, API Gateway gives each API a real internet address, and `CORS_ORIGINS` is the S3 website address.
