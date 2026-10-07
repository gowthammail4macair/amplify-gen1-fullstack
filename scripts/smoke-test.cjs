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
const notifications = new WeakMap();
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
  const response = await fetch(restBase + path, { method, headers: { ...(token ? { Authorization: token } : {}), 'Content-Type': 'application/json' }, ...(input && !['GET','HEAD'].includes(method) ? { body: JSON.stringify(input) } : {}), signal: AbortSignal.timeout(30000) });
  return { status: response.status, body: await response.json() };
}
async function gql(token, query, variables = {}) {
  const response = await fetch(gqlUrl, { method: 'POST', headers: { Authorization: token, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(30000) });
  return response.json();
}
function connect(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(outputs.custom.websocket.endpoint + '?token=' + encodeURIComponent(token));
    notifications.set(ws, []);
    ws.addEventListener('message', event => {
      const value = JSON.parse(event.data);
      if (['ticketChanged','ticketRemoved'].includes(value.type)) notifications.get(ws).push(value);
    });
    const timer = setTimeout(() => { ws.close(); reject(new Error('WebSocket connect timeout')); }, 20000);
    ws.addEventListener('open', () => { clearTimeout(timer); sockets.push(ws); resolve(ws); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('WebSocket authorization/connection failed')); }, { once: true });
  });
}
function message(ws, value) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {ws.removeEventListener('message',receive);reject(new Error('WebSocket response timeout'));}, 20000);
    function receive(e) {
      const value = JSON.parse(e.data);
      if (!['ticket','error'].includes(value.type)) return;
      clearTimeout(timer);ws.removeEventListener('message',receive);resolve(value);
    }
    ws.addEventListener('message', receive);
    ws.send(JSON.stringify(value));
  });
}
async function pushed(ws, id, predicate = () => true) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const event = notifications.get(ws).find(e => e.ticket?.id === id && predicate(e));
    if (event) return event;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('No WebSocket push received for ticket ' + id);
}
(async () => {
  let owner, other, agent, peerAgent, ticket, graphqlTicket;
  try {
    await test('Cognito SRP login: two owners and two Agents members', async () => { owner = await user('owner'); other = await user('other'); agent = await user('agent', true); peerAgent = await user('peer-agent', true); });
    await test('REST rejects missing and malformed Cognito tokens', async () => { for (const t of ['', 'invalid']) assert.ok([401,403].includes((await rest(t, 'GET', '/tickets')).status)); });
    await test('REST preflight supports the hosted website and localhost, excluding other origins', async () => {
      const { allowedOrigins } = require('../frontend/origins.cjs');
      for (const origin of allowedOrigins) for (const path of ['/tickets', '/tickets/any-id', '/tickets/any-id/comments', '/admin/tickets']) {
        const r = await fetch(restBase + path, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Authorization,Content-Type' } });
        assert.equal(r.status, 204); assert.equal(r.headers.get('access-control-allow-origin'), origin);
      }
      const unlisted = await fetch(restBase + '/tickets', { method: 'OPTIONS', headers: { Origin: 'https://unlisted.example.invalid' } });
      assert.equal(unlisted.headers.get('access-control-allow-origin'), null);
    });
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
    await test('Personal REST/GraphQL lists separate two Agents; Agent queue includes only Agents tickets', async () => {
      const mine=await rest(agent,'POST','/tickets',{title:'Agent queue smoke '+runId});assert.equal(mine.status,201,JSON.stringify(mine));tickets.push(mine.body.id);
      const peer=await gql(peerAgent,'mutation($input:CreateTicketInput!){createTicket(input:$input){id title status owner}}',{input:{title:'Peer Agent queue smoke '+runId,status:'OPEN'}});
      assert.ok(peer.data?.createTicket?.id,JSON.stringify(peer));tickets.push(peer.data.createTicket.id);
      const listRest=async(token,path)=>{
        const items=[];let cursor;
        do{const result=await rest(token,'GET',path+(cursor?'?nextToken='+encodeURIComponent(cursor):''));assert.equal(result.status,200,JSON.stringify(result));items.push(...result.body.items);cursor=result.body.nextToken;}while(cursor);
        return items;
      };
      const personal=await listRest(agent,'/tickets');
      assert.ok(personal.some(t=>t.id===mine.body.id));assert.ok(personal.every(t=>t.owner===mine.body.owner));
      const peerPersonal=await listRest(peerAgent,'/tickets');
      assert.ok(peerPersonal.some(t=>t.id===peer.data.createTicket.id));assert.ok(peerPersonal.every(t=>t.owner===peer.data.createTicket.owner));
      const ownGraphql=[];let cursor;
      do{
        const result=await gql(agent,'query($filter:ModelTicketFilterInput,$nextToken:String){listTickets(filter:$filter,nextToken:$nextToken,limit:50){items{id owner} nextToken}}',{filter:{owner:{eq:mine.body.owner}},nextToken:cursor||null});
        assert.ok(!result.errors,JSON.stringify(result));ownGraphql.push(...result.data.listTickets.items.filter(Boolean));cursor=result.data.listTickets.nextToken;
      }while(cursor);
      assert.ok(ownGraphql.some(t=>t.id===mine.body.id));assert.ok(ownGraphql.every(t=>t.owner===mine.body.owner));
      const queue=await listRest(agent,'/admin/tickets');
      assert.ok(queue.some(t=>t.id===mine.body.id));assert.ok(queue.some(t=>t.id===peer.data.createTicket.id));
      assert.ok(!queue.some(t=>[ticket.id,graphqlTicket.id].includes(t.id)));
      const members=[];let memberCursor;
      do{const result=await send('ListUsersInGroup',{GroupName:'Agents',NextToken:memberCursor});members.push(...result.Users);memberCursor=result.NextToken;}while(memberCursor);
      const owners=new Set(members.map(u=>u.Attributes.find(a=>a.Name==='sub').Value+'::'+u.Username));
      assert.ok(queue.every(t=>owners.has(t.owner)));
      assert.deepEqual(new Set((await listRest(peerAgent,'/admin/tickets')).map(t=>t.id)),new Set(queue.map(t=>t.id)));
      assert.equal((await rest(owner,'GET','/admin/tickets')).status,403);
    });
    await test('AppSync custom Lambda summary/close and cross-owner denial', async () => {
      const query = 'query($id:ID!){ticketSummary(id:$id){id summary status}}';
      const r = await gql(owner, query, { id: ticket.id }); assert.ok(r.data?.ticketSummary?.summary, JSON.stringify(r));
      const denied = await gql(other, query, { id: ticket.id }); assert.ok(denied.errors?.length && !denied.data?.ticketSummary);
      const closed = await gql(owner, 'mutation($id:ID!){closeTicket(id:$id){id status}}', { id: ticket.id }); assert.equal(closed.data?.closeTicket?.status, 'CLOSED', JSON.stringify(closed));
      assert.equal((await rest(owner, 'GET', '/tickets/' + ticket.id)).body.status, 'CLOSED');
    });
    await test('WebSocket rejects invalid Cognito JWT at $connect', async () => { await assert.rejects(connect('invalid')); });
    await test('REST and GraphQL comments persist with verified authors and ticket authorization', async () => {
      const r = await rest(owner,'POST','/tickets/'+ticket.id+'/comments',{body:'REST comment '+runId,author:'spoof',authorId:'spoof'});
      assert.equal(r.status,201,JSON.stringify(r));assert.notEqual(r.body.authorId,'spoof');assert.notEqual(r.body.author,'spoof');
      const fields='id body authorId author createdAt';
      let result=await gql(owner,'query($id:ID!){listTicketComments(id:$id){'+fields+'}}',{id:ticket.id});
      assert.equal(result.data?.listTicketComments?.[0]?.id,r.body.id,JSON.stringify(result));
      result=await gql(owner,'mutation($id:ID!,$body:String!){addTicketComment(id:$id,body:$body){'+fields+'}}',{id:ticket.id,body:'GraphQL comment '+runId});
      assert.ok(result.data?.addTicketComment?.id,JSON.stringify(result));
      const updated=await gql(owner,'mutation($input:UpdateTicketInput!){updateTicket(input:$input){id status}}',{input:{id:ticket.id,title:'Live smoke '+runId+' updated'}});
      assert.equal(updated.data?.updateTicket?.status,'CLOSED',JSON.stringify(updated));
      assert.equal((await rest(owner,'GET','/tickets/'+ticket.id+'/comments')).body.items.length,2);
      for(const method of ['GET','POST'])assert.equal((await rest(other,method,'/tickets/'+ticket.id+'/comments',{body:'forbidden'})).status,403);
      for(const query of ['query($id:ID!){listTicketComments(id:$id){id}}','mutation($id:ID!){addTicketComment(id:$id,body:"forbidden"){id}}']){
        const denied=await gql(other,query,{id:ticket.id});assert.ok(denied.errors?.length,JSON.stringify(denied));
      }
      assert.equal((await rest(owner,'POST','/tickets/'+ticket.id+'/comments',{body:''})).status,400);
    });
    await test('WebSocket owner response, other-owner denial and Agents access', async () => {
      const ownSocket = await connect(owner), otherSocket = await connect(other), agentSocket = await connect(agent);
      const r = await message(ownSocket, { action: 'getTicket', id: ticket.id }); assert.equal(r.type, 'ticket', JSON.stringify(r)); assert.equal(r.ticket.status, 'CLOSED');
      const denied = await message(otherSocket, { action: 'getTicket', id: ticket.id }); assert.equal(denied.type, 'error'); assert.equal(denied.message, 'Forbidden');
      assert.equal((await message(agentSocket, { action: 'getTicket', id: ticket.id })).type, 'ticket');
      assert.equal((await message(ownSocket, { action: 'bad' })).type, 'error');
      await test('WebSocket pushes REST ticket creation and status updates to owner and Agents', async()=>{
        const created=await rest(owner,'POST','/tickets',{title:'Push REST '+runId});assert.equal(created.status,201,JSON.stringify(created));tickets.push(created.body.id);
        await pushed(ownSocket,created.body.id,e=>e.change==='created');await pushed(agentSocket,created.body.id,e=>e.change==='created');
        const updated=await rest(owner,'PATCH','/tickets/'+created.body.id,{status:'IN_PROGRESS'});assert.equal(updated.status,200);
        await pushed(ownSocket,created.body.id,e=>e.ticket.status==='IN_PROGRESS');await pushed(agentSocket,created.body.id,e=>e.ticket.status==='IN_PROGRESS');
      });
      await test('WebSocket pushes generated GraphQL creates/updates and custom Lambda status changes', async()=>{
        let r=await gql(owner,'mutation($input:CreateTicketInput!){createTicket(input:$input){id status}}',{input:{title:'Push GraphQL '+runId,status:'OPEN'}});
        const id=r.data?.createTicket?.id;assert.ok(id,JSON.stringify(r));tickets.push(id);
        await pushed(ownSocket,id,e=>e.change==='created');await pushed(agentSocket,id,e=>e.change==='created');
        r=await gql(owner,'mutation($input:UpdateTicketInput!){updateTicket(input:$input){id status}}',{input:{id,status:'IN_PROGRESS'}});
        assert.equal(r.data?.updateTicket?.status,'IN_PROGRESS',JSON.stringify(r));await pushed(ownSocket,id,e=>e.ticket.status==='IN_PROGRESS');
        r=await gql(owner,'mutation($id:ID!){closeTicket(id:$id){id status}}',{id});assert.equal(r.data?.closeTicket?.status,'CLOSED',JSON.stringify(r));
        await pushed(ownSocket,id,e=>e.ticket.status==='CLOSED');await pushed(agentSocket,id,e=>e.ticket.status==='CLOSED');
        r=await rest(owner,'POST','/tickets/'+id+'/comments',{body:'Push comment '+runId});assert.equal(r.status,201);
        await pushed(ownSocket,id,e=>e.change==='commentAdded'&&e.commentsChanged);await pushed(agentSocket,id,e=>e.change==='commentAdded');
      });
      await test('WebSocket push does not expose another owner tickets or comment bodies',async()=>{
        await new Promise(resolve=>setTimeout(resolve,1000));
        assert.ok(!notifications.get(otherSocket).some(e=>tickets.includes(e.ticket?.id)||tickets.includes(e.ticketId)));
        assert.ok(notifications.get(ownSocket).length>0);
        assert.ok(notifications.get(ownSocket).every(e=>!e.ticket?.comments));
      });
    });
    await test('AppSync generated delete resolver removes ticket', async () => { const r = await gql(owner, 'mutation($input:DeleteTicketInput!){deleteTicket(input:$input){id}}', { input: { id: graphqlTicket.id } }); assert.equal(r.data?.deleteTicket?.id, graphqlTicket.id, JSON.stringify(r)); });
    await test('REST cross-owner delete denied; owner delete succeeds', async () => { assert.equal((await rest(other, 'DELETE', '/tickets/' + ticket.id)).status, 403); assert.equal((await rest(owner, 'DELETE', '/tickets/' + ticket.id)).status, 200); assert.equal((await rest(owner, 'GET', '/tickets/' + ticket.id)).status, 404); });
  } finally {
    for (const ws of sockets) ws.close();
    const ticketCleanup=[];
    for (const id of tickets) if (agent || owner) {
      const removed=await rest(agent || owner, 'DELETE', '/tickets/' + id).catch(() => ({status:0}));
      ticketCleanup.push({id,status:removed.status});
    }
    const cleanup = await Promise.allSettled(users.map(Username => send('AdminDeleteUser', { Username })));
    fs.mkdirSync('evidence', { recursive: true });
    const report = { timestamp: new Date().toISOString(), scope: 'Live AWS HTTPS, Cognito SRP and WebSocket integration', checks, cleanup: { users: cleanup.map(r => r.status), socketsClosed: sockets.length, ticketIds: tickets, ticketResults: ticketCleanup }, endpoints: { rest: restBase, graphql: gqlUrl, websocket: outputs.custom.websocket.endpoint } };
    fs.writeFileSync('evidence/live-smoke.json', JSON.stringify(report, null, 2) + '\n');
    if (cleanup.some(r => r.status !== 'fulfilled')) throw new Error('Smoke test user cleanup failed');
    if (ticketCleanup.some(r => ![200,404].includes(r.status))) throw new Error('Smoke test ticket cleanup failed');
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
