const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, sign } = require('node:crypto');
const { createHandler: rest } = require('../src/rest.cjs');
const { createHandler: auth } = require('../src/authorizer.cjs');
const { createHandler: workflow } = require('../src/workflow.cjs');
const { createHandler: socket } = require('../src/websocket.cjs');
const { createDatabase } = require('../src/database.cjs');
const { createAgentOwners } = require('../src/agents.cjs');
const { CognitoJwtVerifier } = require('aws-jwt-verify');
const owner = 'alice-sub::alice';
const claims = { sub: 'alice-sub', 'cognito:username': 'alice', exp: Math.floor(Date.now()/1000)+600 };
const foreign = { sub: 'bob-sub', 'cognito:username': 'bob', exp: claims.exp };
function database() {
  const items = new Map([['one', { id:'one', title:'Printer broken', status:'OPEN', owner }]]);
  return { items, async get(id) { return items.get(id); }, async list(user, cursor, owners=[user.owner]) { return { items: [...items.values()].filter(x => owners.includes(x.owner)), nextToken:null }; },
    async create(x) { items.set(x.id,x); return x; }, async update(x,p) { const v={...x,...p};items.set(x.id,v);return v; }, async delete(x) { items.delete(x.id); } };
}
function event(method, path, c=claims, body) { return {httpMethod:method,path,body:body===undefined?undefined:JSON.stringify(body), requestContext:{authorizer:{claims:c}}}; }
test('REST create assigns verified owner and ignores submitted owner/status',async()=>{ const db=database();const r=await rest(db)(event('POST','/tickets',claims,{title:'Network issue',owner:'bob',status:'CLOSED'}));assert.equal(r.statusCode,201);const x=JSON.parse(r.body);assert.equal(x.owner,owner);assert.equal(x.status,'OPEN');assert.ok(db.items.has(x.id)); });
test('REST list exposes only the authenticated user tickets',async()=>{const db=database();db.items.set('two',{id:'two',owner:'bob-sub::bob'});const r=await rest(db)(event('GET','/tickets'));assert.equal(JSON.parse(r.body).items.length,1);});
test('REST rejects requests without verified claims',async()=>assert.equal((await rest(database())({httpMethod:'GET',path:'/tickets',requestContext:{}})).statusCode,401));
test('REST rejects another owner reading/updating/deleting a ticket',async()=>{const h=rest(database());for(const method of ['GET','PATCH','DELETE']) assert.equal((await h(event(method,'/tickets/one',foreign,{status:'CLOSED'}))).statusCode,403);});
test('REST rejects ordinary users at the custom-authorized admin route',async()=>assert.equal((await rest(database())(event('GET','/admin/tickets'))).statusCode,403));
test('REST separates an Agent personal list from tickets owned by all Agents',async()=>{
  const db=database(), agentOwner='bob-sub::bob', peerOwner='carol-sub::carol';
  db.items.set('mine',{id:'mine',owner:agentOwner});db.items.set('peer',{id:'peer',owner:peerOwner});
  const h=rest(db,async()=>[agentOwner,peerOwner]),c={...foreign,'cognito:groups':['Agents']};
  assert.deepEqual(JSON.parse((await h(event('GET','/tickets',c))).body).items.map(x=>x.id),['mine']);
  assert.deepEqual(JSON.parse((await h(event('GET','/admin/tickets',c))).body).items.map(x=>x.id),['mine','peer']);
  assert.equal((await h(event('GET','/tickets/one',c))).statusCode,200);
});
test('Agent directory paginates every group member without relying on email or one page',async()=>{
  const calls=[],users=[{Username:'bob',Attributes:[{Name:'sub',Value:'bob-sub'}]},{Username:'carol',Attributes:[{Name:'sub',Value:'carol-sub'}]}];
  const members=createAgentOwners({send:async c=>{calls.push(c.input);return calls.length===1?{Users:[users[0]],NextToken:'next'}:{Users:[users[1],users[0],{Username:'missing-sub'}]};}},'pool');
  assert.deepEqual(await members(),['bob-sub::bob','carol-sub::carol']);
  assert.equal(calls[0].GroupName,'Agents');assert.equal(calls[0].UserPoolId,'pool');assert.equal(calls[1].NextToken,'next');
});
test('Agent listing fails closed if membership lookup fails and rejects customers before lookup',async()=>{
  let lookups=0,scans=0;const h=rest({list:async()=>{scans++;return{items:[]};}},async()=>{lookups++;throw new Error('directory unavailable');});
  assert.equal((await h(event('GET','/admin/tickets'))).statusCode,403);assert.equal(lookups,0);
  assert.equal((await h(event('GET','/admin/tickets',{...foreign,'cognito:groups':['Agents']}))).statusCode,500);assert.equal(scans,0);
});
test('REST validates JSON, title and status',async()=>{const h=rest(database());for(const data of [{title:''},{title:'x'.repeat(201)},null,[]])assert.equal((await h(event('POST','/tickets',claims,data))).statusCode,400);assert.equal((await h(event('PATCH','/tickets/one',claims,{status:'INVALID'}))).statusCode,400);const e=event('POST','/tickets');e.body='{oops';assert.equal((await h(e)).statusCode,400);});
test('REST update/delete operate on the same data as GraphQL custom workflow',async()=>{const db=database();const h=rest(db);assert.equal((await h(event('PATCH','/tickets/one',claims,{status:'IN_PROGRESS'}))).statusCode,200);const result=await workflow(db)({info:{fieldName:'closeTicket'},arguments:{id:'one'},identity:{claims}});assert.equal(result.status,'CLOSED');assert.equal(JSON.parse((await h(event('GET','/tickets/one'))).body).status,'CLOSED');assert.equal((await h(event('DELETE','/tickets/one'))).statusCode,200);assert.equal((await h(event('GET','/tickets/one'))).statusCode,404);});
test('REST handles conditional-write conflict without leaking internal errors',async()=>{const db=database();db.update=async()=>{throw Object.assign(new Error('details'),{name:'ConditionalCheckFailedException'});};assert.equal((await rest(db)(event('PATCH','/tickets/one',claims,{status:'CLOSED'}))).statusCode,409);});
test('GraphQL summary supports Gen 1 @function event shape',async()=>{const result=await workflow(database())({fieldName:'ticketSummary',arguments:{id:'one'},identity:{claims}});assert.equal(result.summary,'Printer broken [OPEN]');});
test('GraphQL custom resolver rejects another owner and missing identity',async()=>{const h=workflow(database());await assert.rejects(h({fieldName:'closeTicket',arguments:{id:'one'},identity:{claims:foreign}}),{statusCode:403});await assert.rejects(h({fieldName:'ticketSummary',arguments:{id:'one'}}),{statusCode:401});});
test('REST Lambda authorizer denies normal users and permits Agents with an exact ARN policy',async()=>{const methodArn='arn:aws:execute-api:us-east-1:123456789012:abc/dev/GET/admin/tickets';let r=await auth(async()=>claims)({authorizationToken:'Bearer token',methodArn});assert.equal(r.policyDocument.Statement[0].Effect,'Deny');r=await auth(async()=>({...claims,'cognito:groups':['Agents']}))({authorizationToken:'token',methodArn});assert.equal(r.policyDocument.Statement[0].Effect,'Allow');assert.equal(r.policyDocument.Statement[0].Resource,methodArn);});
test('WebSocket Lambda authorizer verifies Cognito token from the connect query parameter',async()=>{let seen;const r=await auth(async token=>{seen=token;return claims;})({queryStringParameters:{token:'valid'},methodArn:'socket/$connect',requestContext:{routeKey:'$connect'}});assert.equal(seen,'valid');assert.equal(r.context.owner,owner);assert.equal(r.policyDocument.Statement[0].Effect,'Allow');});
test('Lambda authorizer fails closed for missing, expired or invalid tokens',async()=>{for(const e of [{},{authorizationToken:'invalid'}])await assert.rejects(auth(async()=>{throw new Error('bad');})(e),/Unauthorized/);});
test('real Cognito JWT verification checks signature, issuer, audience, token_use and expiry offline',async()=>{
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});const pool='us-east-1_fixture123';const client='fixtureclient';const jwk={...publicKey.export({format:'jwk'}),kid:'one',alg:'RS256',use:'sig'};
 const verifier=CognitoJwtVerifier.create({userPoolId:pool,clientId:client,tokenUse:'id'});verifier.cacheJwks({keys:[jwk]});
 const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const jwt=payload=>{const msg=encode({kid:'one',alg:'RS256'})+'.'+encode(payload);return msg+'.'+sign('RSA-SHA256',Buffer.from(msg),privateKey).toString('base64url');};
 const payload={...claims,iss:`https://cognito-idp.us-east-1.amazonaws.com/${pool}`,aud:client,token_use:'id'};
 assert.equal((await verifier.verify(jwt(payload))).sub,claims.sub);
 for(const bad of [{...payload,aud:'wrong'},{...payload,iss:'https://example.com'},{...payload,token_use:'access'},{...payload,exp:1}])await assert.rejects(verifier.verify(jwt(bad)));
 const parts=jwt(payload).split('.');parts[1]=encode({...payload,sub:'attacker'});await assert.rejects(verifier.verify(parts.join('.')));
});
function websocketFixture() {
 const records=new Map(),messages=[];let disconnected=false;
 const doc={async send(command){const x=command.input;if(command.constructor.name==='PutCommand'){records.set(x.Item.connectionId,x.Item);return{};}if(command.constructor.name==='GetCommand')return{Item:records.get(x.Key.connectionId)};if(command.constructor.name==='DeleteCommand'){records.delete(x.Key.connectionId);return{};}throw new Error(command.constructor.name);}};
 const management={async send(command){if(command.constructor.name==='DeleteConnectionCommand')disconnected=true;else messages.push(JSON.parse(Buffer.from(command.input.Data).toString()));return{};}};
 const db=database();const h=socket({db,doc,management});
 const call=(routeKey,body,authorizer)=>h({body:body?JSON.stringify(body):'',requestContext:{routeKey,connectionId:'c1',domainName:'example.com',stage:'dev',authorizer}});
 return{records,messages,db,call,isDisconnected:()=>disconnected};
}
test('WebSocket connects, looks up a ticket and disconnects',async()=>{const f=websocketFixture();await f.call('$connect',null,{owner,groups:'',expiresAt:claims.exp});await f.call('getTicket',{action:'getTicket',id:'one'});assert.equal(f.messages[0].ticket.id,'one');await f.call('$disconnect');assert.equal(f.records.size,0);});
test('WebSocket refuses another owner on each message',async()=>{const f=websocketFixture();await f.call('$connect',null,{owner:'bob-sub::bob',groups:'',expiresAt:claims.exp});await f.call('getTicket',{action:'getTicket',id:'one'});assert.equal(f.messages[0].type,'error');assert.equal(f.messages[0].message,'Forbidden');});
test('WebSocket expired sessions are removed and disconnected',async()=>{const f=websocketFixture();f.records.set('c1',{connectionId:'c1',owner,expiresAt:1});assert.equal((await f.call('getTicket',{action:'getTicket',id:'one'})).statusCode,401);assert.equal(f.records.size,0);assert.equal(f.isDisconnected(),true);});
test('WebSocket rejects unauthenticated connect and unknown action',async()=>{const f=websocketFixture();assert.equal((await f.call('$connect')).statusCode,401);await f.call('$connect',null,{owner,expiresAt:claims.exp});await f.call('$default',{action:'other'});assert.equal(f.messages[0].type,'error');});
test('DynamoDB personal list filters even Agents and paginates without trusting cursor shape',async()=>{let input;const db=createDatabase({async send(c){input=c.input;return{Items:[],LastEvaluatedKey:{id:'next'}};}},'TicketTable');const r=await db.list({owner,groups:['Agents']});assert.equal(input.FilterExpression,'#owner = :owner');assert.equal(input.ExpressionAttributeValues[':owner'],owner);assert.deepEqual(JSON.parse(Buffer.from(r.nextToken,'base64url')),{id:'next'});await assert.rejects(db.list({owner,groups:[]},Buffer.from('{"id":"one","owner":"evil"}').toString('base64url')),{statusCode:400});});
test('DynamoDB Agent pages exclude customer tickets and retain cursors through empty filtered pages',async()=>{
  const calls=[],members=['bob-sub::bob','carol-sub::carol'];
  const db=createDatabase({send:async c=>{calls.push(c.input);return calls.length===1?{Items:[{id:'customer',owner}],LastEvaluatedKey:{id:'customer'}}:{Items:[{id:'mine',owner:members[0]},{id:'peer',owner:members[1]},{id:'customer2',owner}]};}},'TicketTable');
  const first=await db.list({owner:members[0]},null,members);assert.deepEqual(first.items,[]);assert.ok(first.nextToken);
  const second=await db.list({owner:members[0]},first.nextToken,members);assert.deepEqual(second.items.map(t=>t.id),['mine','peer']);assert.equal(second.nextToken,null);
  assert.deepEqual(calls[1].ExclusiveStartKey,{id:'customer'});assert.equal(calls[0].Limit,50);
  assert.deepEqual(await db.list({owner},null,[]),{items:[],nextToken:null});assert.equal(calls.length,2);
});
test('DynamoDB update/delete use conditional ownership protection',async()=>{const calls=[];const db=createDatabase({async send(c){calls.push(c.input);return{Attributes:{id:'one'}};}},'TicketTable');await db.update({id:'one',owner},{status:'CLOSED'});await db.delete({id:'one',owner});for(const x of calls){assert.equal(x.ConditionExpression,'attribute_exists(id) AND #owner = :owner');assert.equal(x.ExpressionAttributeValues[':owner'],owner);}});

test('REST public preflight and authenticated replies use the configured origin allowlist', async()=>{
  const previous=process.env.ALLOWED_ORIGINS;
  process.env.ALLOWED_ORIGINS=JSON.stringify(['http://localhost:3000','https://hosted.example.invalid']);
  try {
    const h=rest(database());
    for(const origin of ['http://localhost:3000','https://hosted.example.invalid']) {
      const preflight=await h({httpMethod:'OPTIONS',path:'/tickets',headers:{Origin:origin},requestContext:{}});
      assert.equal(preflight.statusCode,204);assert.equal(preflight.body,'');
      assert.equal(preflight.headers['Access-Control-Allow-Origin'],origin);
      assert.ok(preflight.headers['Access-Control-Allow-Methods'].includes('PATCH'));
      const response=await h({...event('GET','/tickets'),headers:{origin}});
      assert.equal(response.statusCode,200);assert.equal(response.headers['Access-Control-Allow-Origin'],origin);
      assert.equal(response.headers.Vary,'Origin');
    }
    const unlisted=await h({httpMethod:'OPTIONS',path:'/tickets',headers:{Origin:'https://unlisted.example.invalid'}});
    assert.equal(unlisted.headers['Access-Control-Allow-Origin'],undefined);
    const denied=await h({httpMethod:'GET',path:'/tickets',headers:{Origin:'https://hosted.example.invalid'}});
    assert.equal(denied.statusCode,401);assert.equal(denied.headers['Access-Control-Allow-Origin'],'https://hosted.example.invalid');
  } finally {if(previous===undefined)delete process.env.ALLOWED_ORIGINS;else process.env.ALLOWED_ORIGINS=previous;}
});
