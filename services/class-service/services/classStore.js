'use strict';
// Data access for the Class & Schedule service.
// Tables (DynamoDB):
//   gym-classes  PK classId
//     GSI byTrainer (trainerId, startTime)   - trainer clash detection, "my classes"
//     GSI byStudio  (studioId,  startTime)   - studio clash detection
//     GSI byStatus  (status,    startTime)   - published timetable by date range
//   gym-studios  PK studioId

const { aws, sdk } = require('gym-shared');

const { GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand, ScanCommand, BatchGetCommand } = sdk.ddb;
const ddb = () => aws.ddbDoc();
const CLASSES = process.env.CLASSES_TABLE || 'gym-classes';
const STUDIOS = process.env.STUDIOS_TABLE || 'gym-studios';

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
  async getClass(classId) {
    return (await ddb().send(new GetCommand({ TableName: CLASSES, Key: { classId } }))).Item || null;
  },
  async putClass(item) {
    await ddb().send(new PutCommand({ TableName: CLASSES, Item: item, ConditionExpression: 'attribute_not_exists(classId)' }));
    return item;
  },
  // Optimistic concurrency: the update only succeeds if nobody changed the
  // class since we read it (version check).
  async updateClass(classId, expectedVersion, changes) {
    const names = { '#v': 'version' };
    const values = { ':expected': expectedVersion, ':one': 1 };
    const sets = ['#v = #v + :one'];
    for (const [k, v] of Object.entries(changes)) {
      names[`#${k}`] = k;
      values[`:${k}`] = v;
      sets.push(`#${k} = :${k}`);
    }
    const res = await ddb().send(new UpdateCommand({
      TableName: CLASSES, Key: { classId }, UpdateExpression: `SET ${sets.join(', ')}`,
      ConditionExpression: '#v = :expected', ExpressionAttributeNames: names, ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    }));
    return res.Attributes;
  },
  async deleteClass(classId) {
    await ddb().send(new DeleteCommand({ TableName: CLASSES, Key: { classId }, ConditionExpression: '#s = :d', ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: { ':d': 'DRAFT' } }));
  },
  async byTrainer(trainerId, fromIso, toIso) {
    return queryAll({
      TableName: CLASSES, IndexName: 'byTrainer',
      KeyConditionExpression: 'trainerId = :t AND startTime BETWEEN :a AND :b',
      ExpressionAttributeValues: { ':t': trainerId, ':a': fromIso, ':b': toIso },
    });
  },
  async byStudio(studioId, fromIso, toIso) {
    return queryAll({
      TableName: CLASSES, IndexName: 'byStudio',
      KeyConditionExpression: 'studioId = :s AND startTime BETWEEN :a AND :b',
      ExpressionAttributeValues: { ':s': studioId, ':a': fromIso, ':b': toIso },
    });
  },
  async byStatus(status, fromIso, toIso) {
    return queryAll({
      TableName: CLASSES, IndexName: 'byStatus',
      KeyConditionExpression: '#s = :s AND startTime BETWEEN :a AND :b',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':s': status, ':a': fromIso, ':b': toIso },
    });
  },
  async batchGet(ids) {
    const out = [];
    const unique = [...new Set(ids)];
    for (let i = 0; i < unique.length; i += 100) {
      const res = await ddb().send(new BatchGetCommand({ RequestItems: { [CLASSES]: { Keys: unique.slice(i, i + 100).map((classId) => ({ classId })) } } }));
      out.push(...((res.Responses && res.Responses[CLASSES]) || []));
    }
    return out;
  },
  async getStudio(studioId) {
    return (await ddb().send(new GetCommand({ TableName: STUDIOS, Key: { studioId } }))).Item || null;
  },
  async listStudios() {
    return (await ddb().send(new ScanCommand({ TableName: STUDIOS }))).Items || [];
  },
  async putStudio(item) {
    await ddb().send(new PutCommand({ TableName: STUDIOS, Item: item }));
    return item;
  },
};
