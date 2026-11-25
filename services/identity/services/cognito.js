'use strict';
// Amazon Cognito client. On Floci the endpoint comes from AWS_ENDPOINT_URL;
// on Lambda the IAM role gives permission, so no keys are in the code.

const { CognitoIdentityProviderClient } = require('@aws-sdk/client-cognito-identity-provider');
const { config } = require('gym-shared');

const client = new CognitoIdentityProviderClient({ region: config.region, ...(config.endpoint ? { endpoint: config.endpoint } : {}) });

module.exports = {
  client,
  send: (command) => client.send(command),
  poolId: () => config.cognito.userPoolId,
  clientId: () => config.cognito.clientId,
};
