const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('GraphQL My tickets sends the signed-in owner filter and Agent pagination keeps its route', async () => {
  const requests = [], scope = { fetch, AbortSignal, encodeURIComponent };
  vm.createContext(scope);
  const source = fs.readFileSync('frontend/src/api.js','utf8').replace(/^import[^\n]+\n/,'').replaceAll('export ','');
  vm.runInContext(source+';this.create=ticketApi;',scope);
  const api = scope.create({rest:'https://rest.invalid',graphql:'https://graphql.invalid'},async()=>'token',async(url,options)=>{
    requests.push({url,options});return{ok:true,json:async()=>({data:{listTickets:{items:[],nextToken:'gql-next'}}})};
  });
  await api.list('GraphQL','gql-cursor','agent-sub::agent');
  const request=JSON.parse(requests[0].options.body);
  assert.deepEqual(request.variables,{nextToken:'gql-cursor',filter:{owner:{eq:'agent-sub::agent'}}});
  assert.ok(request.query.includes('filter:$filter'));
  assert.throws(()=>api.list('GraphQL'),/sign in/);
  await api.agents('cursor/with+symbols');
  assert.equal(requests[1].url,'https://rest.invalid/admin/tickets?nextToken=cursor%2Fwith%2Bsymbols');
});

test('Agent UI separates queues across GraphQL, refresh, pagination, reconnect and foreign live events', async () => {
  class Element {
    constructor(){this.value='';this.textContent='';this.hidden=false;this.children=[];this.classList={toggle(){}};}
    append(...children){this.children.push(...children);}replaceChildren(...children){this.children=children;}
    setAttribute(){}querySelector(){return this.heading||(this.heading=new Element());}
  }
  const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  element('status-filter').value='ALL';element('list-api').value='REST';
  const own={id:'own',owner:'agent-sub::agent',title:'Mine',status:'OPEN'},peer={id:'peer',owner:'peer-sub::peer',title:'Peer Agent',status:'OPEN'},customer={id:'customer',owner:'customer-sub::customer',title:'Customer',status:'OPEN'};
  let onEvent,onState,sequence=0,agentItems=[own,peer],agentCursor='agent-next';const calls=[];
  const api={
    list:async(source,cursor,owner)=>{calls.push({queue:'mine',source,cursor,owner});return{items:[own],nextToken:null};},
    agents:async cursor=>{calls.push({queue:'agents',cursor});return{items:cursor?[{...peer,id:'peer-page2'}]:agentItems,nextToken:cursor?null:agentCursor,agentOwners:[own.owner,peer.owner]};},
    comments:async()=>({items:[]})
  };
  const scope={document:{getElementById:element,createElement:()=>new Element(),querySelectorAll:()=>[]},
    __APP_CONFIG__:{auth:{},api:{websocket:'wss://invalid'},project:{label:'Test',repository:'https://invalid'}},
    authentication:()=>({signIn:async()=>({email:'agent@example.invalid',owner:own.owner,groups:['Agents']}),token:async()=>'',signOut(){}}),ticketApi:()=>api,
    liveChannel:(url,token,state,event)=>{onEvent=event;onState=state;return{connect:async()=>state(true),disconnect:()=>state(false)};},
    window:{addEventListener(){}},crypto:{randomUUID:()=>String(++sequence)},queueMicrotask,Date,JSON,Set,Map,console};
  vm.createContext(scope);vm.runInContext(fs.readFileSync('frontend/src/main.js','utf8').replace(/^import[^\n]+\n/,''),scope);
  const settle=()=>new Promise(resolve=>setImmediate(resolve));
  await element('sign-in-form').onsubmit({preventDefault(){}});await settle();
  assert.equal(element('queue-title').textContent,'My tickets');assert.equal(element('total-count').textContent,1);
  for(const ticket of [peer,customer])onEvent({type:'ticketChanged',eventId:'mine-'+ticket.id,change:'created',ticket});
  await settle();assert.equal(element('total-count').textContent,1);
  element('list-api').value='GraphQL';await element('list-api').onchange();
  assert.equal(calls.at(-1).owner,own.owner);assert.equal(calls.at(-1).source,'GraphQL');
  await element('agent-queue').onclick();
  assert.equal(element('queue-title').textContent,'Agent queue');assert.equal(element('total-count').textContent,2);
  assert.equal(element('list-api').disabled,true);assert.equal(element('list-api').value,'REST');
  await element('refresh').onclick();assert.equal(calls.at(-1).queue,'agents');
  await element('load-more').onclick();assert.equal(calls.at(-1).cursor,'agent-next');assert.equal(element('total-count').textContent,3);
  onEvent({type:'ticketChanged',eventId:'peer-update',change:'updated',ticket:{...peer,title:'Peer Agent updated'}});await settle();
  assert.equal(element('total-count').textContent,3);assert.equal(calls.at(-1).cursor,'agent-next');
  agentItems=[own,peer,{...peer,id:'peer-page2'}];agentCursor=null;
  onState(false);onState(true);await settle();
  assert.equal(element('queue-title').textContent,'Agent queue');assert.equal(element('total-count').textContent,3);
  onEvent({type:'ticketChanged',eventId:'queue-customer',change:'created',ticket:customer});await settle();
  assert.equal(element('total-count').textContent,3);assert.ok(!element('ticket-list').children.some(li=>li.children[0].children[0].textContent==='Customer'));
  await element('my-tickets').onclick();assert.equal(element('queue-title').textContent,'My tickets');assert.equal(element('total-count').textContent,1);
  assert.equal(element('list-api').disabled,false);await element('refresh').onclick();assert.equal(calls.at(-1).queue,'mine');
  onEvent({type:'ticketChanged',eventId:'owner-changed',change:'updated',ticket:{...own,owner:peer.owner}});await settle();
  assert.equal(element('total-count').textContent,0);
  element('sign-out').onclick();assert.equal(element('queue-title').textContent,'My tickets');assert.equal(element('agent-queue').disabled,true);
});
