'use strict';
// Lazily-created AWS SDK v3 clients. All of them honour AWS_ENDPOINT_URL so the
// same code runs against Floci locally and against real AWS without changes.
// No credentials are set here: the SDK default provider chain is used
// (Lambda execution role in Floci/AWS, environment variables locally).

const config = require('./config');

const cache = {};
function base(extra = {}) {
  const c = { region: config.region, ...extra };
  if (config.endpoint) c.endpoint = config.endpoint;
  return c;
}
function lazy(name, factory) {
  if (!cache[name]) cache[name] = factory();
  return cache[name];
}

module.exports = {
  ddbDoc() {
    return lazy('ddbDoc', () => {
      const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
      const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
      return DynamoDBDocumentClient.from(new DynamoDBClient(base()), {
        marshallOptions: { removeUndefinedValues: true },
      });
    });
  },
  secrets() {
    return lazy('secrets', () => {
      const { SecretsManagerClient } = require('@aws-sdk/client-secrets-manager');
      return new SecretsManagerClient(base());
    });
  },
  eventBridge() {
    return lazy('eb', () => {
      const { EventBridgeClient } = require('@aws-sdk/client-eventbridge');
      return new EventBridgeClient(base());
    });
  },
  sqs() {
    return lazy('sqs', () => {
      const { SQSClient } = require('@aws-sdk/client-sqs');
      return new SQSClient(base());
    });
  },
  ssm() {
    return lazy('ssm', () => {
      const { SSMClient } = require('@aws-sdk/client-ssm');
      return new SSMClient(base());
    });
  },
  cloudWatch() {
    return lazy('cw', () => {
      const { CloudWatchClient } = require('@aws-sdk/client-cloudwatch');
      return new CloudWatchClient(base());
    });
  },
  cloudWatchLogs() {
    return lazy('cwl', () => {
      const { CloudWatchLogsClient } = require('@aws-sdk/client-cloudwatch-logs');
      return new CloudWatchLogsClient(base());
    });
  },
  s3() {
    return lazy('s3', () => {
      const { S3Client } = require('@aws-sdk/client-s3');
      // Path-style addressing: emulators cannot resolve bucket sub-domains.
      return new S3Client(base({ forcePathStyle: true }));
    });
  },
  // Client used only to *sign* URLs handed to the browser. Inside a Lambda
  // container the endpoint is http://floci:4566, which a browser cannot reach,
  // so presigned URLs are generated against PUBLIC_AWS_ENDPOINT_URL instead.
  s3Public() {
    return lazy('s3Public', () => {
      const { S3Client } = require('@aws-sdk/client-s3');
      const c = { region: config.region, forcePathStyle: true };
      const pub = process.env.PUBLIC_AWS_ENDPOINT_URL || config.endpoint;
      if (pub) c.endpoint = pub;
      return new S3Client(c);
    });
  },
};
