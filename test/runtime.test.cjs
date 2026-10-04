const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, sign } = require('node:crypto');
const { createHandler: rest } = require('../src/rest.cjs');
const { createHandler: auth } = require('../src/authorizer.cjs');
const { createHandler: workflow } = require('../src/workflow.cjs');
const { createHandler: socket } = require('../src/websocket.cjs');
const { createDatabase } = require('../src/database.cjs');
const { CognitoJwtVerifier } = require('aws-jwt-verify');
const owner = 'alice-sub::alice';
const claims = { sub: 'alice-sub', 'cognito:username': 'alice', exp: Math.floor(Date.now()/1000)+600 };
const foreign = { sub: 'bob-sub', 'cognito:username': 'bob', exp: claims.exp };
function database() {
  const items = new Map([['one', { id:'one', title:'Printer broken', status:'OPEN', owner }]]);
  return { items, async get(id) { return items.get(id); }, async list(user) { return { items: [...items.values()].filter(x => x.owner===user.owner || user.groups.includes('Agents')), nextToken:null }; },
    async create(x) { items.set(x.id,x); return x; }, async update(x,p) { const v={...x,...p};items.set(x.id,v);return v; }, async delete(x) { items.delete(x.id); } };
}
function event(method, path, c=claims, body) { return {httpMethod:method,path,body:body===undefined?undefined:JSON.stringify(body), requestContext:{authorizer:{claims:c}}}; }
test('REST create assigns verified owner and ignores submitted owner/status',async()=>{ const db=database();const r=await rest(db)(event('POST','/tickets',claims,{title:'Network issue',owner:'bob',status:'CLOSED'}));assert.equal(r.statusCode,201);const x=JSON.parse(r.body);assert.equal(x.owner,owner);assert.equal(x.status,'OPEN');assert.ok(db.items.has(x.id)); });
test('REST list exposes only the authenticated user tickets',async()=>{const db=database();db.items.set('two',{id:'two',owner:'bob-sub::bob'});const r=await rest(db)(event('GET','/tickets'));assert.equal(JSON.parse(r.body).items.length,1);});
test('REST rejects requests without verified claims',async()=>assert.equal((await rest(database())({httpMethod:'GET',path:'/tickets',requestContext:{}})).statusCode,401));
test('REST rejects another owner reading/updating/deleting a ticket',async()=>{const h=rest(database());for(const method of ['GET','PATCH','DELETE']) assert.equal((await h(event(method,'/tickets/one',foreign,{status:'CLOSED'}))).statusCode,403);});
test('REST rejects ordinary users at the custom-authorized admin route',async()=>assert.equal((await rest(database())(event('GET','/admin/tickets'))).statusCode,403));
test('REST permits Agents to list all tickets and access another owner',async()=>{const h=rest(database()), c={...foreign,'cognito:groups':['Agents']};assert.equal((await h(event('GET','/admin/tickets',c))).statusCode,200);assert.equal((await h(event('GET','/tickets/one',c))).statusCode,200);});
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
test('DynamoDB list filters at the database and paginates without trusting cursor shape',async()=>{let input;const db=createDatabase({async send(c){input=c.input;return{Items:[],LastEvaluatedKey:{id:'next'}};}},'TicketTable');const r=await db.list({owner,groups:[]});assert.equal(input.FilterExpression,'#owner = :owner');assert.equal(input.ExpressionAttributeValues[':owner'],owner);assert.deepEqual(JSON.parse(Buffer.from(r.nextToken,'base64url')),{id:'next'});await assert.rejects(db.list({owner,groups:[]},Buffer.from('{"id":"one","owner":"evil"}').toString('base64url')),{statusCode:400});});
test('DynamoDB update/delete use conditional ownership protection',async()=>{const calls=[];const db=createDatabase({async send(c){calls.push(c.input);return{Attributes:{id:'one'}};}},'TicketTable');await db.update({id:'one',owner},{status:'CLOSED'});await db.delete({id:'one',owner});for(const x of calls){assert.equal(x.ConditionExpression,'attribute_exists(id) AND #owner = :owner');assert.equal(x.ExpressionAttributeValues[':owner'],owner);}});
