const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand, DeleteConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
const { createDatabase } = require('./database.cjs');
const { assertAccess, HttpError } = require('./domain.cjs');
function createHandler({ db = createDatabase(), doc = DynamoDBDocumentClient.from(new DynamoDBClient({})), management } = {}) {
  return async event => {
    if (Array.isArray(event.Records)) return require('./notifications.cjs').createHandler({ doc, management })(event);
    const { routeKey, connectionId, domainName, stage } = event.requestContext;
    const TableName = process.env.CONNECTIONS_TABLE;
    const manager = management || new ApiGatewayManagementApiClient({ endpoint: `https://${domainName}/${stage}` });
    const remove = () => doc.send(new DeleteCommand({ TableName, Key: { connectionId } }));
    if (routeKey === '$disconnect') { await remove(); return { statusCode: 200, body: '' }; }
    if (routeKey === '$connect') {
      const a = event.requestContext.authorizer;
      if (!a?.owner || Number(a.expiresAt) <= Math.floor(Date.now() / 1000)) return { statusCode: 401, body: 'Unauthorized' };
      await doc.send(new PutCommand({ TableName, Item: { connectionId, owner: a.owner, groups: a.groups || '', expiresAt: Number(a.expiresAt),
        endpoint: `https://${domainName}/${stage}` } }));
      return { statusCode: 200, body: '' };
    }
    const connection = (await doc.send(new GetCommand({ TableName, Key: { connectionId }, ConsistentRead: true }))).Item;
    if (!connection || connection.expiresAt <= Math.floor(Date.now() / 1000)) {
      await remove();
      try { await manager.send(new DeleteConnectionCommand({ ConnectionId: connectionId })); } catch (e) { if (e.name !== 'GoneException') throw e; }
      return { statusCode: 401, body: 'Reconnect with a fresh token' };
    }
    let message;
    try {
      const input = JSON.parse(event.body || '{}');
      if (input.action === 'ping') message = { type: 'pong' };
      else {
        if (routeKey !== 'getTicket' || input.action !== 'getTicket' || typeof input.id !== 'string' || !input.id) throw new HttpError(400, 'Unknown WebSocket action');
        const ticket = await db.get(input.id);
        assertAccess(ticket, { owner: connection.owner, groups: (connection.groups || '').split(',') });
        const { comments, ...metadata } = ticket;
        message = { type: 'ticket', ticket: metadata };
      }
    } catch (error) {
      message = { type: 'error', message: error instanceof SyntaxError ? 'Invalid JSON' : error.statusCode ? error.message : 'Internal server error' };
    }
    try { await manager.send(new PostToConnectionCommand({ ConnectionId: connectionId, Data: Buffer.from(JSON.stringify(message)) })); }
    catch (error) { if (error.name === 'GoneException') await remove(); else throw error; }
    return { statusCode: 200, body: '' };
  };
}
module.exports = { createHandler, handler: createHandler() };
