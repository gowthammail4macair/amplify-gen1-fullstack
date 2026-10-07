const { randomUUID } = require('node:crypto');
class HttpError extends Error {
  constructor(statusCode, message) { super(message); this.statusCode = statusCode; }
}
const statuses = new Set(['OPEN', 'IN_PROGRESS', 'CLOSED']);
function identity(claims) {
  const sub = claims?.sub;
  const username = claims?.['cognito:username'] || claims?.username;
  if (!sub || !username) throw new HttpError(401, 'Authentication required');
  let groups = claims['cognito:groups'] || [];
  if (typeof groups === 'string') groups = groups.replace(/[\[\]"]/g, '').split(',').map(x => x.trim());
  return { owner: `${sub}::${username}`, sub, name: String(claims.email || username).slice(0, 256), groups, expiresAt: Number(claims.exp || 0) };
}
function assertAccess(ticket, user) {
  if (!ticket) throw new HttpError(404, 'Ticket not found');
  if (ticket.owner !== user.owner && !user.groups.includes('Agents')) throw new HttpError(403, 'Forbidden');
}
function newTicket(input, user) {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title || title.length > 200) throw new HttpError(400, 'Title must contain 1 to 200 characters');
  const now = new Date().toISOString();
  return { id: randomUUID(), title, status: 'OPEN', owner: user.owner, createdAt: now, updatedAt: now, __typename: 'Ticket' };
}
function patch(input) {
  const result = {};
  if (input.title !== undefined) {
    if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 200) throw new HttpError(400, 'Invalid title');
    result.title = input.title.trim();
  }
  if (input.status !== undefined) {
    if (!statuses.has(input.status)) throw new HttpError(400, 'Invalid status');
    result.status = input.status;
  }
  if (!Object.keys(result).length) throw new HttpError(400, 'Supply title or status');
  return result;
}
function newComment(input, user, ticket) {
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (!body || Buffer.byteLength(body, 'utf8') > 2000) throw new HttpError(400, 'Enter a comment of at most 2000 UTF-8 bytes');
  // ponytail: bounded comments stay on the ticket; use a separate table if long threads are needed.
  if ((ticket.comments || []).length >= 100) throw new HttpError(400, 'This ticket has reached its 100-comment limit');
  return { id: randomUUID(), body, authorId: user.sub, author: user.name, createdAt: new Date().toISOString() };
}
module.exports = { HttpError, identity, assertAccess, newTicket, patch, newComment };
