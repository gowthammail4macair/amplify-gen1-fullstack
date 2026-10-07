const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
function createDatabase(doc = client, table = process.env.TICKET_TABLE) {
  return {
    async get(id) { return (await doc.send(new GetCommand({ TableName: table, Key: { id }, ConsistentRead: true }))).Item; },
    async create(ticket) { await doc.send(new PutCommand({ TableName: table, Item: ticket, ConditionExpression: 'attribute_not_exists(id)' })); return ticket; },
    async list(user, cursor, agentOwners) {
      let start;
      if (cursor) {
        try {
          const value = JSON.parse(Buffer.from(cursor, 'base64url').toString());
          if (!value || typeof value.id !== 'string' || Object.keys(value).some(k => k !== 'id')) throw new Error();
          start = value;
        } catch { const { HttpError } = require('./domain.cjs'); throw new HttpError(400, 'Invalid cursor'); }
      }
      const owners = new Set(agentOwners || [user.owner]);
      if (!owners.size) return { items: [], nextToken: null };
      const result = await doc.send(new ScanCommand({ TableName: table, Limit: 50, ExclusiveStartKey: start, ConsistentRead: true,
        ...(agentOwners ? {} : { FilterExpression: '#owner = :owner', ExpressionAttributeNames: { '#owner': 'owner' }, ExpressionAttributeValues: { ':owner': user.owner } }) }));
      // ponytail: filter each bounded Agent page in memory; an owner index can replace the demo scan at scale.
      return { items: (result.Items || []).filter(ticket => owners.has(ticket.owner)), nextToken: result.LastEvaluatedKey ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64url') : null };
    },
    async update(ticket, changes) {
      const fields = { ...changes, updatedAt: new Date().toISOString() };
      const names = { '#owner': 'owner' }, values = { ':owner': ticket.owner };
      const setters = Object.entries(fields).map(([key, value], i) => { names[`#f${i}`] = key; values[`:v${i}`] = value; return `#f${i} = :v${i}`; });
      return (await doc.send(new UpdateCommand({ TableName: table, Key: { id: ticket.id }, UpdateExpression: `SET ${setters.join(', ')}`,
        ConditionExpression: 'attribute_exists(id) AND #owner = :owner', ExpressionAttributeNames: names, ExpressionAttributeValues: values, ReturnValues: 'ALL_NEW' }))).Attributes;
    },
    async addComment(ticket, comment) {
      await doc.send(new UpdateCommand({ TableName: table, Key: { id: ticket.id },
        UpdateExpression: 'SET #comments = list_append(if_not_exists(#comments, :empty), :comment), #updated = :now',
        ConditionExpression: 'attribute_exists(id) AND #owner = :owner AND (attribute_not_exists(#comments) OR size(#comments) < :limit)',
        ExpressionAttributeNames: { '#owner': 'owner', '#comments': 'comments', '#updated': 'updatedAt' },
        ExpressionAttributeValues: { ':owner': ticket.owner, ':empty': [], ':comment': [comment], ':now': comment.createdAt, ':limit': 100 } }));
      return comment;
    },
    async delete(ticket) { await doc.send(new DeleteCommand({ TableName: table, Key: { id: ticket.id }, ConditionExpression: 'attribute_exists(id) AND #owner = :owner', ExpressionAttributeNames: { '#owner': 'owner' }, ExpressionAttributeValues: { ':owner': ticket.owner } })); }
  };
}
module.exports = { createDatabase };
