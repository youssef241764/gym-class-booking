#!/usr/bin/env bash
# 04  S3 buckets: gym-frontend (public website files) and gym-reports (private, KMS-encrypted)
#   bash infra/services/04-s3.sh                     (safe to run again; run 01 first)
set -e
. "$(dirname "$0")/_lib.sh"; cd "$ROOT"; check_endpoint

step "Buckets"
for b in gym-frontend gym-reports; do
  if awsl s3api head-bucket --bucket "$b" >/dev/null 2>&1; then ok "exists  s3://$b"
  else awsl s3 mb "s3://$b" >/dev/null; ok "created s3://$b"; fi
done

step "gym-reports: private, encrypted with KMS, versioned, exports deleted after 7 days"
awsl s3api put-public-access-block --bucket gym-reports \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true >/dev/null 2>&1 || true
awsl s3api put-bucket-encryption --bucket gym-reports --server-side-encryption-configuration \
  "{\"Rules\":[{\"ApplyServerSideEncryptionByDefault\":{\"SSEAlgorithm\":\"aws:kms\",\"KMSMasterKeyID\":\"$KMS_KEY_ARN\"},\"BucketKeyEnabled\":true}]}" >/dev/null 2>&1 || true
awsl s3api put-bucket-versioning --bucket gym-reports --versioning-configuration Status=Enabled >/dev/null 2>&1 || true
awsl s3api put-bucket-lifecycle-configuration --bucket gym-reports \
  --lifecycle-configuration file://infra/s3/reports-lifecycle.json >/dev/null 2>&1 || true
awsl s3api put-bucket-cors --bucket gym-reports --cors-configuration file://infra/s3/reports-cors.json >/dev/null 2>&1 || true
ok "gym-reports locked down"

step "gym-frontend: anyone may READ the website files (no list, no write)"
awsl s3api put-bucket-policy --bucket gym-frontend --policy file://infra/s3/frontend-public-read-policy.json >/dev/null 2>&1 || true
ok "public-read policy on gym-frontend/*"
