'use strict';
// Re-export of the AWS SDK v3 command classes used by the services, so each
// service depends on a single version of the SDK (installed with gym-shared).
module.exports = {
  ddb: require('@aws-sdk/lib-dynamodb'),
  s3: require('@aws-sdk/client-s3'),
  presign: require('@aws-sdk/s3-request-presigner'),
  sqs: require('@aws-sdk/client-sqs'),
  zod: require('zod'),
};
