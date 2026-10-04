// Real AWS integration checks. Test identities and records are removed in finally.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const cognito = require('@aws-sdk/client-cognito-identity-provider');
const { CognitoUserPool, CognitoUser, AuthenticationDetails } = require('amazon-cognito-identity-js');
const outputs = JSON.parse(fs.readFileSync('amplify_outputs.json', 'utf8'));
const region = outputs.auth.aws_region;
const poolId = outputs.auth.user_pool_id, clientId = outputs.auth.user_pool_client_id;
const admin = new cognito.CognitoIdentityProviderClient({ region });
const pool = new CognitoUserPool({ UserPoolId: poolId, ClientId: clientId });
const runId = randomUUID().slice(0, 8), users = [], tickets = [], sockets = [], checks = [];
const restBase = outputs.custom.rest.endpoint.replace(/\/$/, '');
const gqlUrl = outputs.data.url;
const send = (name, input) => admin.send(new cognito[name + 'Command']({ UserPoolId: poolId, ...input }));
async function test(name, fn) { await fn(); checks.push({ name, status: 'passed' }); console.log('PASS', name); }
async function user(label, agent = false) {
  const email = `smoke-${runId}-${label}@example.invalid`;
  const password = `Smoke!A9${randomUUID()}`;
  await send('AdminCreateUser', { Username: email, MessageAction: 'SUPPRESS', UserAttributes: [{ Name: 'email', Value: email }, { Name: 'email_verified', Value: 'true' }] });
  users.push(email);
  await send('AdminSetUserPassword', { Username: email, Password: password, Permanent: true });
  if (agent) await send('AdminAddUserToGroup', { Username: email, GroupName: 'Agents' });
  return new Promise((resolve, reject) => {
    new CognitoUser({ Username: email, Pool: pool }).authenticateUser(new AuthenticationDetails({ Username: email, Password: password }), {
      onSuccess: session => resolve(session.getIdToken().getJwtToken()), onFailure: e => reject(new Error('Cognito SRP authentication failed: ' + e.name))
    });
  });
}
async function rest(token, method, path, input) {
  const response = await fetch(restBase + path, { method, headers: { ...(token ? { Authorization: token } : {}), 'Content-Type': 'application/json' }, ...(input ? { body: JSON.stringify(input) } : {}), signal: AbortSignal.timeout(30000) });
  return { status: response.status, body: await response.json() };
}
async function gql(token, query, variables = {}) {
  const response = await fetch(gqlUrl, { method: 'POST', headers: { Authorization: token, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(30000) });
  return response.json();
}
function connect(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(outputs.custom.websocket.endpoint + '?token=' + encodeURIComponent(token));
    const timer = setTimeout(() => { ws.close(); reject(new Error('WebSocket connect timeout')); }, 20000);
    ws.addEventListener('open', () => { clearTimeout(timer); sockets.push(ws); resolve(ws); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('WebSocket authorization/connection failed')); }, { once: true });
  });
}
function message(ws, value) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket response timeout')), 20000);
    ws.addEventListener('message', e => { clearTimeout(timer); resolve(JSON.parse(e.data)); }, { once: true });
    ws.send(JSON.stringify(value));
  });
}
(async () => {
  let owner, other, agent, ticket, graphqlTicket;
  try {
    await test('Cognito SRP login: two owners and an Agents member', async () => { owner = await user('owner'); other = await user('other'); agent = await user('agent', true); });
    await test('REST rejects missing and malformed Cognito tokens', async () => { for (const t of ['', 'invalid']) assert.ok([401,403].includes((await rest(t, 'GET', '/tickets')).status)); });
    await test('REST creates a ticket with owner identity', async () => { const r = await rest(owner, 'POST', '/tickets', { title: 'Live smoke ' + runId }); assert.equal(r.status, 201, JSON.stringify(r)); ticket = r.body; tickets.push(ticket.id); assert.ok(ticket.owner.includes('::')); });
    await test('REST owner read/update and cross-owner denial', async () => { assert.equal((await rest(owner, 'GET', '/tickets/' + ticket.id)).status, 200); assert.equal((await rest(other, 'GET', '/tickets/' + ticket.id)).status, 403); assert.equal((await rest(other, 'PATCH', '/tickets/' + ticket.id, { title: 'forbidden' })).status, 403); assert.equal((await rest(owner, 'PATCH', '/tickets/' + ticket.id, { status: 'IN_PROGRESS' })).status, 200); });
    await test('REST custom Lambda authorizer: Agents allowed, owner denied', async () => { assert.equal((await rest(owner, 'GET', '/admin/tickets')).status, 403); assert.equal((await rest(agent, 'GET', '/admin/tickets')).status, 200); });
    const readQuery = 'query($id:ID!){getTicket(id:$id){id title status owner}}';
    await test('AppSync default resolver reads REST writes and enforces ownership', async () => { const r = await gql(owner, readQuery, { id: ticket.id }); assert.equal(r.data?.getTicket?.status, 'IN_PROGRESS', JSON.stringify(r)); const denied = await gql(other, readQuery, { id: ticket.id }); assert.ok(!denied.data?.getTicket); });
    await test('AppSync generated create/update resolvers write shared DynamoDB', async () => {
      let r = await gql(owner, 'mutation($input:CreateTicketInput!){createTicket(input:$input){id title status owner}}', { input: { title: 'GraphQL smoke ' + runId, status: 'OPEN' } });
      assert.ok(r.data?.createTicket?.id, JSON.stringify(r)); graphqlTicket = r.data.createTicket; tickets.push(graphqlTicket.id);
      r = await gql(owner, 'mutation($input:UpdateTicketInput!){updateTicket(input:$input){id status}}', { input: { id: graphqlTicket.id, status: 'IN_PROGRESS' } });
      assert.equal(r.data?.updateTicket?.status, 'IN_PROGRESS', JSON.stringify(r)); assert.equal((await rest(owner, 'GET', '/tickets/' + graphqlTicket.id)).body.status, 'IN_PROGRESS');
    });
    await test('AppSync custom Lambda summary/close and cross-owner denial', async () => {
      const query = 'query($id:ID!){ticketSummary(id:$id){id summary status}}';
      const r = await gql(owner, query, { id: ticket.id }); assert.ok(r.data?.ticketSummary?.summary, JSON.stringify(r));
      const denied = await gql(other, query, { id: ticket.id }); assert.ok(denied.errors?.length && !denied.data?.ticketSummary);
      const closed = await gql(owner, 'mutation($id:ID!){closeTicket(id:$id){id status}}', { id: ticket.id }); assert.equal(closed.data?.closeTicket?.status, 'CLOSED', JSON.stringify(closed));
      assert.equal((await rest(owner, 'GET', '/tickets/' + ticket.id)).body.status, 'CLOSED');
    });
    await test('WebSocket rejects invalid Cognito JWT at $connect', async () => { await assert.rejects(connect('invalid')); });
    await test('WebSocket owner response, other-owner denial and Agents access', async () => {
      const ownSocket = await connect(owner), otherSocket = await connect(other), agentSocket = await connect(agent);
      const r = await message(ownSocket, { action: 'getTicket', id: ticket.id }); assert.equal(r.type, 'ticket', JSON.stringify(r)); assert.equal(r.ticket.status, 'CLOSED');
      const denied = await message(otherSocket, { action: 'getTicket', id: ticket.id }); assert.equal(denied.type, 'error'); assert.equal(denied.message, 'Forbidden');
      assert.equal((await message(agentSocket, { action: 'getTicket', id: ticket.id })).type, 'ticket');
      assert.equal((await message(ownSocket, { action: 'bad' })).type, 'error');
    });
    await test('AppSync generated delete resolver removes ticket', async () => { const r = await gql(owner, 'mutation($input:DeleteTicketInput!){deleteTicket(input:$input){id}}', { input: { id: graphqlTicket.id } }); assert.equal(r.data?.deleteTicket?.id, graphqlTicket.id, JSON.stringify(r)); });
    await test('REST cross-owner delete denied; owner delete succeeds', async () => { assert.equal((await rest(other, 'DELETE', '/tickets/' + ticket.id)).status, 403); assert.equal((await rest(owner, 'DELETE', '/tickets/' + ticket.id)).status, 200); assert.equal((await rest(owner, 'GET', '/tickets/' + ticket.id)).status, 404); });
  } finally {
    for (const ws of sockets) ws.close();
    for (const id of tickets) if (owner) await rest(owner, 'DELETE', '/tickets/' + id).catch(() => {});
    const cleanup = await Promise.allSettled(users.map(Username => send('AdminDeleteUser', { Username })));
    fs.mkdirSync('evidence', { recursive: true });
    const report = { timestamp: new Date().toISOString(), scope: 'Live AWS HTTPS, Cognito SRP and WebSocket integration', checks, cleanup: { users: cleanup.map(r => r.status), socketsClosed: sockets.length, ticketIds: tickets }, endpoints: { rest: restBase, graphql: gqlUrl, websocket: outputs.custom.websocket.endpoint } };
    fs.writeFileSync('evidence/live-smoke.json', JSON.stringify(report, null, 2) + '\n');
    if (cleanup.some(r => r.status !== 'fulfilled')) throw new Error('Smoke test user cleanup failed');
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
