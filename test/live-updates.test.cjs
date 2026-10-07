const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHandler: rest } = require('../src/rest.cjs');
const { createHandler: workflow } = require('../src/workflow.cjs');
const { createHandler: notify } = require('../src/notifications.cjs');
const { createDatabase } = require('../src/database.cjs');
const claims={sub:'alice-sub','cognito:username':'alice',email:'alice@example.invalid'};
const other={sub:'bob-sub','cognito:username':'bob'};
const owner='alice-sub::alice';
function database(){
  let item={id:'one',owner,title:'Printer',status:'OPEN',comments:[]};
  return {get:async()=>item,addComment:async(ticket,comment)=>{item={...item,comments:[...item.comments,comment]};return comment;},setComments:comments=>item.comments=comments};
}
const event=(method,body,c=claims)=>({httpMethod:method,path:'/tickets/one/comments',body:JSON.stringify(body),requestContext:{authorizer:{claims:c}}});
test('REST and custom GraphQL comments share persisted data and verified authors',async()=>{
  const db=database(),h=rest(db),g=workflow(db);
  const r=await h(event('POST',{body:'  Checked the printer.  ',author:'spoof',authorId:'spoof'}));
  assert.equal(r.statusCode,201);const c=JSON.parse(r.body);
  assert.equal(c.body,'Checked the printer.');assert.equal(c.authorId,claims.sub);assert.equal(c.author,claims.email);
  let list=await g({fieldName:'listTicketComments',arguments:{id:'one'},identity:{claims}});assert.deepEqual(list,[c]);
  const added=await g({info:{fieldName:'addTicketComment'},arguments:{id:'one',body:'Working on it'},identity:{claims}});
  list=JSON.parse((await h(event('GET'))).body).items;assert.deepEqual(list,[c,added]);
});
test('Comments enforce owner/Agents access, authentication, size and bounded threads',async()=>{
  const db=database(),h=rest(db),g=workflow(db);
  for(const method of ['GET','POST'])assert.equal((await h(event(method,{body:'x'},other))).statusCode,403);
  for(const fieldName of ['listTicketComments','addTicketComment'])await assert.rejects(g({fieldName,arguments:{id:'one',body:'x'},identity:{claims:other}}),{statusCode:403});
  assert.equal((await h(event('GET',null,{}))).statusCode,401);
  const agent={...other,'cognito:groups':['Agents']};assert.equal((await h(event('POST',{body:'Agent reply'},agent))).statusCode,201);
  for(const body of ['',123,'😀'.repeat(501)])assert.equal((await h(event('POST',{body}))).statusCode,400);
  db.setComments(Array.from({length:100},()=>({body:'x'})));assert.equal((await h(event('POST',{body:'too many'}))).statusCode,400);
});
test('DynamoDB appends comments atomically with ownership and size conditions',async()=>{
  let command;const db=createDatabase({send:async c=>{command=c;return{};}},'Tickets');
  const comment={id:'c',body:'Done',createdAt:'2026-10-07T00:00:00.000Z'};
  assert.deepEqual(await db.addComment({id:'one',owner},comment),comment);
  assert.equal(command.constructor.name,'UpdateCommand');
  assert.ok(command.input.UpdateExpression.includes('list_append(if_not_exists('));
  assert.ok(command.input.ConditionExpression.includes('#owner = :owner'));
  assert.ok(command.input.ConditionExpression.includes('size(#comments) < :limit'));
  assert.equal(command.input.ExpressionAttributeValues[':limit'],100);
});
function image(ticket){return Object.fromEntries(Object.entries(ticket).map(([k,v])=>[k,Array.isArray(v)?{L:v.map(()=>({M:{}}))}:{S:v}]));}
function record(eventName,fresh,old,eventID='e1'){return{eventName,eventID,dynamodb:{NewImage:fresh&&image(fresh),OldImage:old&&image(old)}};}
function fixture(connections){
  const messages=[],deleted=[],closed=[];let scans=0;
  const doc={send:async command=>{
    if(command.constructor.name==='ScanCommand'){scans++;return scans===1?{Items:connections.slice(0,2),LastEvaluatedKey:{connectionId:'page'}}:{Items:connections.slice(2)};}
    if(command.constructor.name==='DeleteCommand'){deleted.push(command.input.Key.connectionId);return{};}
    throw new Error(command.constructor.name);
  }};
  const management={send:async command=>{
    if(command.constructor.name==='DeleteConnectionCommand'){closed.push(command.input.ConnectionId);return{};}
    if(command.input.ConnectionId==='gone')throw Object.assign(new Error(),{name:'GoneException'});
    messages.push({connectionId:command.input.ConnectionId,message:JSON.parse(command.input.Data.toString())});return{};
  }};
  return {h:notify({doc,management}),messages,deleted,closed};
}
const connection=(connectionId,connectionOwner=owner,groups='')=>({connectionId,owner:connectionOwner,groups,endpoint:'https://socket.example.invalid/dev',expiresAt:Math.floor(Date.now()/1000)+600});
const ticket={id:'one',owner,title:'Printer',status:'OPEN',updatedAt:'2026-10-07T00:00:00.000Z'};
test('Push notifications paginate and deliver creation/status/comments only to owner and Agents',async()=>{
  const f=fixture([connection('owner'),connection('foreign','bob-sub::bob'),connection('agent','bob-sub::bob','Agents')]);
  await f.h({Records:[record('INSERT',ticket),record('MODIFY',{...ticket,status:'CLOSED'},ticket,'e2'),record('MODIFY',{...ticket,comments:[{body:'private'}]},ticket,'e3')]});
  assert.equal(f.messages.length,6);assert.ok(!f.messages.some(m=>m.connectionId==='foreign'));
  assert.deepEqual(f.messages.filter(m=>m.connectionId==='owner').map(m=>m.message.change),['created','updated','commentAdded']);
  assert.ok(!JSON.stringify(f.messages).includes('private'));assert.equal(f.messages[2].message.ticket.status,'CLOSED');
});
test('Push removes stale/expired connections and communicates revocation without disclosing the new ticket',async()=>{
  const expired={...connection('expired'),expiresAt:1},invalid={...connection('invalid')};delete invalid.expiresAt;
  const f=fixture([connection('owner'),connection('gone'),expired,invalid,connection('newOwner','bob-sub::bob')]);
  await f.h({Records:[record('MODIFY',{...ticket,owner:'bob-sub::bob',title:'Private to Bob'},ticket)]});
  assert.deepEqual(f.messages.find(m=>m.connectionId==='owner').message,{type:'ticketRemoved',eventId:'e1',ticketId:'one'});
  assert.equal(f.messages.find(m=>m.connectionId==='newOwner').message.ticket.title,'Private to Bob');
  assert.ok(f.deleted.includes('expired')&&f.deleted.includes('gone')&&f.deleted.includes('invalid'));
  assert.ok(f.closed.includes('expired'));
});
test('Notification send errors propagate for stream retry, while metadata-only updates are ignored',async()=>{
  const f=fixture([connection('owner')]);await f.h({Records:[record('MODIFY',{...ticket,updatedAt:'later'},ticket)]});assert.equal(f.messages.length,0);
  const h=notify({doc:{send:async()=>({Items:[connection('owner')]})},management:{send:async()=>{throw new Error('temporary failure');}}});
  await assert.rejects(h({Records:[record('INSERT',ticket)]}),/temporary failure/);
});
