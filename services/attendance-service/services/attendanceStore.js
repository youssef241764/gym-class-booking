'use strict';
// Data access for the Attendance & Reliability service.
// Tables (DynamoDB):
//   gym-attendance           PK classId, SK memberId  { status, method, recordedBy, recordedAt }
//                            GSI byMember (memberId, recordedAt)
//   gym-attendance-sessions  PK pk:
//        "SESSION#<classId>"            { codeHash, codeExpiresAt, closedAt, summary }
//        "ATTEMPT#<classId>#<memberId>" { attempts, expiresAt (TTL) }  - brute-force guard
//   gym-strikes              PK memberId, SK sk "<type>#<classId>"  { type, at, expiresAt (TTL 30d) }
//   gym-member-standing      PK memberId { suspendedUntil, reason, strikesAtSuspension, liftedBy }
//   gym-audit                (shared, read here for the admin audit viewer)

const { aws, sdk, config } = require('gym-shared');

const { GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand, BatchWriteCommand } = sdk.ddb;
const ddb = () => aws.ddbDoc();
const T = {
  attendance: process.env.ATTENDANCE_TABLE || 'gym-attendance',
  sessions: process.env.SESSIONS_TABLE || 'gym-attendance-sessions',
  strikes: process.env.STRIKES_TABLE || 'gym-strikes',
  standing: process.env.STANDING_TABLE || 'gym-member-standing',
  audit: config.tables.audit,
};

async function queryAll(params) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const res = await ddb().send(new QueryCommand({ ...params, ExclusiveStartKey }));
    items.push(...(res.Items || []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

module.exports = {
  T,
  async session(classId) {
    return (await ddb().send(new GetCommand({ TableName: T.sessions, Key: { pk: `SESSION#${classId}` } }))).Item || null;
  },
  async updateSession(classId, expr, names, values, condition) {
    return ddb().send(new UpdateCommand({
      TableName: T.sessions, Key: { pk: `SESSION#${classId}` }, UpdateExpression: expr,
      ExpressionAttributeNames: names, ExpressionAttributeValues: values, ConditionExpression: condition, ReturnValues: 'ALL_NEW',
    }));
  },
  async attempts(classId, memberId) {
    const it = (await ddb().send(new GetCommand({ TableName: T.sessions, Key: { pk: `ATTEMPT#${classId}#${memberId}` } }))).Item;
    return it ? it.attempts : 0;
  },
  async addAttempt(classId, memberId, ttlSec) {
    const res = await ddb().send(new UpdateCommand({
      TableName: T.sessions, Key: { pk: `ATTEMPT#${classId}#${memberId}` },
      UpdateExpression: 'SET attempts = if_not_exists(attempts, :z) + :one, expiresAt = :exp',
      ExpressionAttributeValues: { ':z': 0, ':one': 1, ':exp': Math.floor(Date.now() / 1000) + ttlSec }, ReturnValues: 'ALL_NEW',
    }));
    return res.Attributes.attempts;
  },
  recordsForClass(classId) {
    return queryAll({ TableName: T.attendance, KeyConditionExpression: 'classId = :c', ExpressionAttributeValues: { ':c': classId } });
  },
  recordsForMember(memberId) {
    return queryAll({ TableName: T.attendance, IndexName: 'byMember', KeyConditionExpression: 'memberId = :m', ExpressionAttributeValues: { ':m': memberId }, ScanIndexForward: false });
  },
  async getRecord(classId, memberId) {
    return (await ddb().send(new GetCommand({ TableName: T.attendance, Key: { classId, memberId } }))).Item || null;
  },
  putRecord(item, condition) {
    return ddb().send(new PutCommand({ TableName: T.attendance, Item: item, ...(condition || {}) }));
  },
  async putRecords(items) {
    for (let i = 0; i < items.length; i += 25) {
      await ddb().send(new BatchWriteCommand({ RequestItems: { [T.attendance]: items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } })) } }));
    }
  },
  strikesFor(memberId) {
    return queryAll({ TableName: T.strikes, KeyConditionExpression: 'memberId = :m', ExpressionAttributeValues: { ':m': memberId } });
  },
  // Idempotent: the sort key is "<type>#<classId>", so a replayed event cannot double-count.
  putStrike(item) {
    return ddb().send(new PutCommand({ TableName: T.strikes, Item: item }));
  },
  deleteStrike(memberId, sk) {
    return ddb().send(new DeleteCommand({ TableName: T.strikes, Key: { memberId, sk } }));
  },
  async standing(memberId) {
    return (await ddb().send(new GetCommand({ TableName: T.standing, Key: { memberId } }))).Item || null;
  },
  putStanding(item) {
    return ddb().send(new PutCommand({ TableName: T.standing, Item: item }));
  },
  auditForDay(day, limit = 200) {
    return ddb().send(new QueryCommand({ TableName: T.audit, KeyConditionExpression: '#d = :d', ExpressionAttributeNames: { '#d': 'day' }, ExpressionAttributeValues: { ':d': day }, ScanIndexForward: false, Limit: limit }))
      .then((r) => r.Items || []);
  },
};
