const { ScanCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand, DeleteConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
const fields = ['id', 'title', 'status', 'owner', 'createdAt', 'updatedAt'];
const ticketFrom = image => Object.fromEntries(fields.map(key => [key, image?.[key]?.S]));
const permitted = (connection, owner) => connection.owner === owner || (connection.groups || '').split(',').includes('Agents');
const gone = error => error.name === 'GoneException' || error.$metadata?.httpStatusCode === 410;
function createHandler({ doc, management } = {}) {
  return async event => {
    const TableName = process.env.CONNECTIONS_TABLE, connections = [], managers = new Map();
    // ponytail: paginated scan suits this demo; index connections by owner for larger deployments.
    let cursor;
    do {
      const result = await doc.send(new ScanCommand({ TableName, Limit: 50, ExclusiveStartKey: cursor, ConsistentRead: true }));
      connections.push(...(result.Items || [])); cursor = result.LastEvaluatedKey;
    } while (cursor);
    const managerFor = endpoint => {
      if (management) return management;
      if (!managers.has(endpoint)) managers.set(endpoint, new ApiGatewayManagementApiClient({ endpoint }));
      return managers.get(endpoint);
    };
    for (const record of event.Records) {
      if (!['INSERT', 'MODIFY', 'REMOVE'].includes(record.eventName)) continue;
      const fresh = ticketFrom(record.dynamodb.NewImage), old = ticketFrom(record.dynamodb.OldImage);
      const ticket = record.eventName === 'REMOVE' ? old : fresh;
      if (!ticket.id || !ticket.owner) continue;
      const commentsChanged = (record.dynamodb.NewImage?.comments?.L?.length || 0) !== (record.dynamodb.OldImage?.comments?.L?.length || 0);
      if (record.eventName === 'MODIFY' && !commentsChanged && ['title','status','owner'].every(k => fresh[k] === old[k])) continue;
      for (let offset = 0; offset < connections.length; offset += 10) {
        await Promise.all(connections.slice(offset, offset + 10).map(async connection => {
          const remove = () => doc.send(new DeleteCommand({ TableName, Key: { connectionId: connection.connectionId } }));
          if (!connection.endpoint || !Number.isFinite(Number(connection.expiresAt)) || Number(connection.expiresAt) <= Math.floor(Date.now() / 1000)) {
            await remove();
            if (connection.endpoint) try { await managerFor(connection.endpoint).send(new DeleteConnectionCommand({ ConnectionId: connection.connectionId })); } catch (e) { if (!gone(e)) throw e; }
            return;
          }
          let message;
          if (record.eventName === 'REMOVE' && permitted(connection, old.owner)) message = { type: 'ticketRemoved', eventId: record.eventID, ticketId: old.id };
          else if (record.eventName !== 'REMOVE' && permitted(connection, fresh.owner)) message = {
            type: 'ticketChanged', eventId: record.eventID, change: record.eventName === 'INSERT' ? 'created' : commentsChanged ? 'commentAdded' : 'updated',
            ticket: fresh, commentsChanged
          };
          else if (old.owner && old.owner !== fresh.owner && permitted(connection, old.owner)) message = { type: 'ticketRemoved', eventId: record.eventID, ticketId: old.id };
          if (!message) return;
          try { await managerFor(connection.endpoint).send(new PostToConnectionCommand({ ConnectionId: connection.connectionId, Data: Buffer.from(JSON.stringify(message)) })); }
          catch (e) { if (gone(e)) await remove(); else throw e; }
        }));
      }
    }
    return { processed: event.Records.length };
  };
}
module.exports = { createHandler };
