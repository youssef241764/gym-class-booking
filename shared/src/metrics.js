'use strict';
// Custom CloudWatch metrics (namespace GymBooking). Fire-and-forget: a metrics
// failure is logged but never fails the business request.

const { PutMetricDataCommand } = require('@aws-sdk/client-cloudwatch');
const aws = require('./aws');
const config = require('./config');
const log = require('./logger');

function putMetric(name, value = 1, dimensions = {}) {
  const Dimensions = [{ Name: 'Service', Value: config.serviceName },
    ...Object.entries(dimensions).map(([Name, Value]) => ({ Name, Value: String(Value) }))];
  return aws.cloudWatch().send(new PutMetricDataCommand({
    Namespace: config.metricsNamespace,
    MetricData: [{ MetricName: name, Value: value, Unit: 'Count', Dimensions, Timestamp: new Date() }],
  })).catch((err) => log.warn('METRIC_FAILED', { metric: name, reason: err.name }));
}

module.exports = { putMetric };
