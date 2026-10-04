const { identity, assertAccess, HttpError } = require('./domain.cjs');
const { createDatabase } = require('./database.cjs');
function createHandler(db = createDatabase()) {
  return async event => {
    const user = identity(event.identity?.claims);
    const field = event.fieldName || event.info?.fieldName;
    if (field === 'ticketSummary') {
      const ticket = await db.get(event.arguments.id); assertAccess(ticket, user);
      return { id: ticket.id, title: ticket.title, status: ticket.status, summary: `${ticket.title} [${ticket.status}]` };
    }
    if (field === 'closeTicket') {
      const ticket = await db.get(event.arguments.id); assertAccess(ticket, user);
      return db.update(ticket, { status: 'CLOSED' });
    }
    throw new HttpError(400, 'Unknown GraphQL operation');
  };
}
module.exports = { createHandler, handler: createHandler() };
