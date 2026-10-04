const { HttpError, identity, assertAccess, newTicket, patch } = require('./domain.cjs');
const { createDatabase } = require('./database.cjs');
function createHandler(db = createDatabase()) {
  return async event => {
    const allowedOrigins = process.env.ALLOWED_ORIGINS ? JSON.parse(process.env.ALLOWED_ORIGINS) : [process.env.ALLOWED_ORIGIN || 'http://localhost:3000'];
    const origin = event.headers?.origin || event.headers?.Origin;
    const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Headers': 'Authorization,Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', Vary: 'Origin' };
    if (allowedOrigins.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
    const reply = (statusCode, body) => ({ statusCode, headers, body: statusCode === 204 ? '' : JSON.stringify(body) });
    // Preflight is public; every data operation still requires verified authorizer claims.
    if (event.httpMethod === 'OPTIONS') return reply(204);
    try {
      const auth = event.requestContext?.authorizer;
      const user = identity(auth?.claims || (auth?.sub ? { sub: auth.sub, username: auth.username, 'cognito:groups': auth.groups } : null));
      const path = event.path.replace(/\/$/, '');
      const method = event.httpMethod;
      if (path === '/admin/tickets' && method === 'GET') {
        if (!user.groups.includes('Agents')) throw new HttpError(403, 'Agents group required');
        return reply(200, await db.list(user, event.queryStringParameters?.nextToken));
      }
      if (path === '/tickets' && method === 'GET') return reply(200, await db.list(user, event.queryStringParameters?.nextToken));
      let input;
      if (['POST', 'PATCH'].includes(method)) {
        try { input = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString() : event.body || '{}'); } catch { throw new HttpError(400, 'Invalid JSON'); }
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Expected JSON object');
      }
      if (path === '/tickets' && method === 'POST') return reply(201, await db.create(newTicket(input, user)));
      const match = /^\/tickets\/([^/]+)$/.exec(path);
      if (match && ['GET', 'PATCH', 'DELETE'].includes(method)) {
        const ticket = await db.get(match[1]); assertAccess(ticket, user);
        if (method === 'GET') return reply(200, ticket);
        if (method === 'PATCH') return reply(200, await db.update(ticket, patch(input)));
        await db.delete(ticket); return reply(200, { deleted: true, id: ticket.id });
      }
      throw new HttpError(404, 'Route not found');
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') return reply(409, { message: 'Ticket changed; retry the request' });
      if (!error.statusCode) console.error('REST request failed', { name: error.name });
      return reply(error.statusCode || 500, { message: error.statusCode ? error.message : 'Internal server error' });
    }
  };
}
module.exports = { createHandler, handler: createHandler() };
