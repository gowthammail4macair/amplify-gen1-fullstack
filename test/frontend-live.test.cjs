const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
test('Live channel keeps receiving push messages, reconnects, and stops when paused',async()=>{
  const timeouts=new Map();let count=0,sockets=[],messages=[],states=[],tokens=0;
  class Socket extends EventTarget{
    static OPEN=1;
    constructor(url){super();this.url=url;this.readyState=0;sockets.push(this);queueMicrotask(()=>{this.readyState=1;this.dispatchEvent(new Event('open'));});}
    send(){}
    close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
    receive(data){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(data)}));}
  }
  const scope={WebSocket:Socket,setTimeout:fn=>{const id=++count;timeouts.set(id,fn);return id;},clearTimeout:id=>timeouts.delete(id),setInterval:()=>++count,clearInterval:()=>{}};
  vm.createContext(scope);
  const source=fs.readFileSync('frontend/src/api.js','utf8').split('export function liveChannel')[1];
  vm.runInContext('function liveChannel'+source+'; this.create=liveChannel;',scope);
  const live=scope.create('wss://socket.example.invalid',async()=>{tokens++;return 'token-'+tokens;},s=>states.push(s),e=>messages.push(e));
  await live.connect();const first=sockets[0];
  first.receive({type:'ticketChanged',eventId:'a'});first.receive({type:'ticketChanged',eventId:'b'});first.receive({type:'pong'});
  assert.deepEqual(messages.map(x=>x.eventId),['a','b']);assert.equal(states.at(-1),true);
  first.close();assert.equal(states.at(-1),false);
  const retry=[...timeouts.values()][0];assert.ok(retry);timeouts.clear();retry();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(sockets.length,2);assert.equal(tokens,2);
  live.disconnect();assert.equal(timeouts.size,0);assert.equal(states.at(-1),false);
  let resolveOld,issued=0;const newer=scope.create('wss://socket.example.invalid',()=>++issued===1?new Promise(resolve=>{resolveOld=resolve;}):Promise.resolve('fresh-token'),()=>{},()=>{});
  const oldAttempt=newer.connect();newer.disconnect();const newAttempt=newer.connect();resolveOld('stale-token');
  await Promise.all([oldAttempt,newAttempt]);assert.equal(sockets.length,3);assert.ok(sockets.at(-1).url.endsWith('fresh-token'));newer.disconnect();
});
test('Browser push updates the queue/status, preserves drafts, and renders persisted comments as text',async()=>{
  class Element{
    constructor(){this.value='';this.textContent='';this.hidden=false;this.children=[];this.attributes={};this.classList={toggle(){}};}
    append(...children){this.children.push(...children);}replaceChildren(...children){this.children=children;}
    setAttribute(k,v){this.attributes[k]=v;}querySelector(){return this.heading||(this.heading=new Element());}
  }
  const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  element('status-filter').value='ALL';element('list-api').value='REST';element('create-api').value='REST';
  let onState,onEvent,comments=[],posted,profileEmail='alice@example.invalid';
  const ticket={id:'one',owner:'alice::alice',title:'Printer',status:'OPEN',updatedAt:'2026-10-07T00:00:00.000Z'};
  const api={list:async()=>({items:[],nextToken:null}),comments:async()=>({items:comments}),addComment:async(id,body)=>{posted={id,body};const c={id:'c1',body,author:'Alice',createdAt:'2026-10-07T00:02:00.000Z'};comments.push(c);return c;}};
  const scope={document:{getElementById:element,createElement:()=>new Element(),querySelectorAll:()=>[]},
    __APP_CONFIG__:{auth:{},api:{websocket:'wss://example.invalid'},project:{label:'Test',repository:'https://example.invalid'}},
    authentication:()=>({signIn:async()=>({email:profileEmail}),token:async()=>'',signOut(){}}),ticketApi:()=>api,
    liveChannel:(url,token,state,event)=>{onState=state;onEvent=event;return{connect:async()=>onState(true),disconnect:()=>onState(false)};},
    window:{addEventListener(){}},crypto:{randomUUID:()=> 'sync'},queueMicrotask,Date,JSON,Set,Map,console};
  vm.createContext(scope);
  vm.runInContext(fs.readFileSync('frontend/src/main.js','utf8').replace(/^import[^\n]+\n/,''),scope);
  const settle=()=>new Promise(resolve=>setImmediate(resolve));
  await element('sign-in-form').onsubmit({preventDefault(){}});await settle();
  assert.equal(element('connection-state').textContent,'Live updates online');
  onEvent({type:'ticketChanged',eventId:'created',change:'created',ticket});await settle();
  assert.equal(element('total-count').textContent,1);
  await element('ticket-list').children[0].children[0].onclick();await settle();
  element('edit-title').value='My unsaved title';
  onEvent({type:'ticketChanged',eventId:'updated',change:'updated',ticket:{...ticket,status:'CLOSED',updatedAt:'2026-10-07T00:01:00.000Z'}});await settle();
  assert.equal(element('detail-status').textContent,'Closed');assert.equal(element('edit-status').value,'CLOSED');assert.equal(element('edit-title').value,'My unsaved title');
  element('new-comment').value='<script>alert(1)</script>';
  element('comment-form').onsubmit({preventDefault(){}});await settle();
  assert.deepEqual(posted,{id:'one',body:'<script>alert(1)</script>'});
  assert.equal(element('comment-list').children[0].children[1].textContent,'<script>alert(1)</script>');
  assert.equal(element('new-comment').value,'');assert.equal(element('comments-empty').hidden,true);
  let completeOldRead;api.comments=()=>new Promise(resolve=>{completeOldRead=resolve;});
  onEvent({type:'ticketChanged',eventId:'late',change:'commentAdded',commentsChanged:true,ticket:{...ticket,status:'CLOSED',updatedAt:'2026-10-07T00:03:00.000Z'}});
  element('sign-out').onclick();assert.equal(element('workspace').hidden,true);assert.equal(element('comment-list').children.length,0);
  profileEmail='bob@example.invalid';await element('sign-in-form').onsubmit({preventDefault(){}});completeOldRead({items:comments});await settle();
  assert.equal(element('live-events').children.length,0);assert.equal(element('total-count').textContent,0);element('sign-out').onclick();
});
