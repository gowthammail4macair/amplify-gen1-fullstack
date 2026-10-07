import { authentication, ticketApi, liveChannel } from './api.js';
const config=__APP_CONFIG__, $=id=>document.getElementById(id);
const auth=authentication(config.auth), api=ticketApi(config.api,()=>auth.token());
const state={profile:null,queue:'mine',agentOwners:new Set(),tickets:[],selected:null,detailVersion:null,nextToken:null,busy:false,connected:false,livePaused:false,activity:[],notifications:[],pending:[],seen:new Set(),processing:false,commentRequest:0,sessionVersion:0};
const prettyStatus=value=>({OPEN:'Open',IN_PROGRESS:'In progress',CLOSED:'Closed'}[value]||value);
const live=liveChannel(config.api.websocket,()=>auth.token(),connected=>{
  state.connected=connected;
  $('connection-state').textContent=connected?'Live updates online':'Live updates offline';
  $('connection-pill').classList.toggle('online',connected);
  $('live-result').textContent=connected?'Listening for new tickets, status changes, and comments.':state.livePaused?'Live updates are paused.':'Reconnecting to live updates…';
  renderControls();
  if(connected&&state.profile)queueLive({type:'sync',eventId:crypto.randomUUID()});
},queueLive);
function renderControls(){
  document.querySelectorAll('[data-action]').forEach(b=>b.disabled=state.busy);
  $('my-tickets').disabled=state.busy||state.queue==='mine';
  $('agent-queue').disabled=state.busy||!state.profile?.groups?.includes('Agents');
  $('list-api').disabled=state.busy||state.queue==='agents';
  $('sign-out').disabled=state.busy;
  $('connect-live').textContent=state.livePaused?'Resume live updates':'Pause live updates';
}
function notice(message,error=false){$('notice').textContent=message;$('notice').className='notice'+(error?' error':'');}
function log(label,value,error=false){
  $('last-operation').textContent=label;$('api-response').textContent=JSON.stringify(value,null,2);
  state.activity.unshift({label,error,time:new Date()});state.activity=state.activity.slice(0,5);
  $('activity').replaceChildren(...state.activity.map(a=>{
    const li=document.createElement('li'),badge=document.createElement('span'),text=document.createElement('span'),time=document.createElement('time');
    badge.className=a.error?'activity-dot error':'activity-dot';text.textContent=a.label;
    time.textContent=a.time.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});
    li.append(badge,text,time);return li;
  }));
}
async function action(label,fn){
  if(state.busy)return;state.busy=true;notice(label+'…');renderControls();
  try{const result=await fn();notice(label+' — done.');log(label,result??{ok:true});return result;}
  catch(error){notice(error.message,true);log(label,error.details||{message:error.message},true);return null;}
  finally{state.busy=false;renderControls();flushLive();}
}
function draft(){
  const t=state.selected;if(!t)return null;
  return {id:t.id,...($('edit-title').value!==t.title?{title:$('edit-title').value}:{}),...($('edit-status').value!==t.status?{status:$('edit-status').value}:{})};
}
function restoreDraft(value){
  if(!value||value.id!==state.selected?.id)return;
  if(value.title!==undefined)$('edit-title').value=value.title;
  if(value.status!==undefined)$('edit-status').value=value.status;
}
function merge(ticket,select=true){
  const edits=select?null:draft(),i=state.tickets.findIndex(t=>t.id===ticket.id);
  if(i>=0&&state.tickets[i].updatedAt&&ticket.updatedAt&&state.tickets[i].updatedAt>ticket.updatedAt)return;
  if(i<0)state.tickets.unshift(ticket);else state.tickets[i]={...state.tickets[i],...ticket};
  if(select||state.selected?.id===ticket.id)state.selected=state.tickets.find(t=>t.id===ticket.id);
  renderTickets();renderDetails();restoreDraft(edits);
}
function renderTickets(){
  const list=state.tickets.filter(t=>$('status-filter').value==='ALL'||t.status===$('status-filter').value);
  $('ticket-list').replaceChildren(...list.map(t=>{
    const li=document.createElement('li'),b=document.createElement('button'),text=document.createElement('span'),badge=document.createElement('span'),meta=document.createElement('span');
    b.className='ticket-row'+(state.selected?.id===t.id?' selected':'');b.setAttribute('aria-label','Open ticket: '+t.title);
    text.className='ticket-title';text.textContent=t.title;badge.className='status-badge '+t.status.toLowerCase();badge.textContent=prettyStatus(t.status);
    meta.className='ticket-meta';meta.textContent=(t.createdAt?new Date(t.createdAt).toLocaleDateString([], {day:'numeric',month:'short'}):'Ticket')+' · '+t.id.slice(0,8);
    b.append(text,badge,meta);
    b.onclick=()=>action('Loaded ticket comments',async()=>{state.selected=t;renderTickets();renderDetails();return loadComments();});
    li.append(b);return li;
  }));
  $('empty-state').hidden=list.length>0;
  $('empty-state').querySelector('h3').textContent=state.tickets.length?'No matching tickets':'No tickets yet';
  $('total-count').textContent=state.tickets.length;
  for(const [status,id] of [['OPEN','open-count'],['IN_PROGRESS','progress-count'],['CLOSED','closed-count']])$(id).textContent=state.tickets.filter(t=>t.status===status).length;
  $('load-more').hidden=!state.nextToken;
}
function renderComments(){
  const comments=state.selected?.comments||[];
  $('comments-empty').hidden=comments.length>0;
  $('comment-list').replaceChildren(...comments.map(c=>{
    const li=document.createElement('li'),meta=document.createElement('div'),author=document.createElement('strong'),time=document.createElement('time'),body=document.createElement('p');
    author.textContent=c.author;time.dateTime=c.createdAt;time.textContent=new Date(c.createdAt).toLocaleString();
    meta.className='comment-meta';meta.append(author,time);body.textContent=c.body;li.append(meta,body);return li;
  }));
}
function renderDetails(){
  const t=state.selected,version=t?JSON.stringify([t.id,t.title,t.status,t.updatedAt]):null;
  if(version!==state.detailVersion){state.detailVersion=version;$('summary-text').textContent='Request a summary or resolve this ticket.';}
  if($('detail-id').textContent!==(t?.id||'')){$('new-comment').value='';state.commentRequest++;}
  $('ticket-details').hidden=!t;
  if(t){$('detail-heading').textContent=t.title;$('detail-id').textContent=t.id;$('detail-status').textContent=prettyStatus(t.status);$('detail-status').className='status-badge '+t.status.toLowerCase();$('edit-title').value=t.title;$('edit-status').value=t.status;}
  else $('detail-id').textContent='';
  renderComments();renderControls();
}
async function loadComments(){
  const id=state.selected?.id;if(!id)return {items:[]};
  const epoch=state.sessionVersion,request=++state.commentRequest,result=await api.comments(id);
  if(epoch===state.sessionVersion&&state.selected?.id===id&&request===state.commentRequest){state.selected.comments=result.items;renderComments();}
  return result;
}
async function load(more=false,keepDraft=false,source=$('list-api').value,queue=state.queue){
  const epoch=state.sessionVersion,edits=keepDraft?draft():null,previous=state.selected,cursor=more?state.nextToken:null;
  const result=queue==='agents'?await api.agents(cursor):await api.list(source,cursor,state.profile.owner);
  if(epoch!==state.sessionVersion||!state.profile)return result;
  state.queue=queue;
  state.agentOwners=new Set(result.agentOwners||[]);
  if(queue==='agents')$('list-api').value='REST';
  state.tickets=more?[...new Map([...state.tickets,...result.items].map(t=>[t.id,t])).values()]:result.items;
  state.nextToken=result.nextToken;
  const selected=state.tickets.find(t=>t.id===previous?.id);
  state.selected=selected?Object.assign(selected,{comments:previous.comments||[]}):null;
  $('queue-title').textContent=queue==='agents'?'Agent queue':'My tickets';renderTickets();renderDetails();restoreDraft(edits);
  if(state.selected)await loadComments();
  return result;
}
function queueLive(event){
  if(!state.profile||!event.eventId||state.seen.has(event.eventId)||state.pending.some(e=>e.eventId===event.eventId))return;
  state.pending.push(event);flushLive();
}
async function flushLive(){
  if(state.processing||state.busy||!state.profile)return;
  state.processing=true;
  try{
    while(state.pending.length&&!state.busy&&state.profile){
      const epoch=state.sessionVersion,event=state.pending.shift();
      state.seen.add(event.eventId);if(state.seen.size>200)state.seen.delete(state.seen.values().next().value);
      if(event.type==='sync'){state.busy=true;renderControls();try{await load(false,true,'REST');}finally{state.busy=false;renderControls();}continue;}
      let label;
      if(event.type==='ticketChanged'){
        if(!event.ticket?.id)continue;
        const belongs=state.queue==='mine'?event.ticket.owner===state.profile.owner:state.agentOwners.has(event.ticket.owner);
        if(!belongs){
          state.tickets=state.tickets.filter(ticket=>ticket.id!==event.ticket.id);
          if(state.selected?.id===event.ticket.id)state.selected=null;
          renderTickets();renderDetails();continue;
        }
        merge(event.ticket,false);
        if(event.commentsChanged&&state.selected?.id===event.ticket.id)await loadComments();
        label=event.change==='created'?'New ticket: '+event.ticket.title:event.change==='commentAdded'?'New comment on: '+event.ticket.title:'Ticket updated: '+event.ticket.title+' · '+prettyStatus(event.ticket.status);
      }else if(event.type==='ticketRemoved'){
        state.tickets=state.tickets.filter(t=>t.id!==event.ticketId);
        if(state.selected?.id===event.ticketId)state.selected=null;
        renderTickets();renderDetails();label='Ticket removed from your queue.';
      }else continue;
      if(epoch!==state.sessionVersion||!state.profile)break;
      state.notifications.unshift(label);state.notifications=state.notifications.slice(0,5);
      $('live-events').replaceChildren(...state.notifications.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
      $('live-result').textContent=label;
    }
  }catch(error){$('live-result').textContent='Live update refresh failed. Use Refresh tickets to retry.';}
  finally{state.processing=false;if(state.pending.length&&!state.busy&&state.profile)queueMicrotask(flushLive);}
}
$('project-badge').textContent=config.project.label;$('environment-label').textContent=config.project.label;$('footer-environment').textContent=config.project.label;$('source-link').href=config.project.repository;
$('sign-in-form').onsubmit=async event=>{
  event.preventDefault();if(state.busy)return;state.busy=true;$('login-error').textContent='';$('sign-in').textContent='Signing in…';renderControls();
  try{
    state.profile=await auth.signIn($('email').value.trim(),$('password').value);state.queue='mine';state.sessionVersion++;$('password').value='';
    $('sign-in-page').hidden=true;$('workspace').hidden=false;$('account-label').textContent=state.profile.email;$('sign-out').hidden=false;
    notice('Signed in. Loading your tickets…');const result=await load();
    notice('Signed in. Your ticket queue is ready.');log('Signed in and loaded tickets',{profile:state.profile,tickets:result});
    state.livePaused=false;live.connect().catch(()=>{if(state.profile&&!state.livePaused)$('live-result').textContent='Reconnecting to live updates…';});
  }catch(error){if(!state.profile)$('login-error').textContent=error.message;else notice(error.message,true);}
  finally{state.busy=false;$('sign-in').textContent='Sign in to workspace →';renderControls();flushLive();}
};
$('sign-out').onclick=()=>{
  state.sessionVersion++;state.livePaused=true;live.disconnect();auth.signOut();state.profile=null;state.queue='mine';state.agentOwners.clear();state.tickets=[];state.selected=null;state.nextToken=null;state.activity=[];state.pending=[];state.seen.clear();state.notifications=[];
  $('queue-title').textContent='My tickets';
  $('workspace').hidden=true;$('sign-in-page').hidden=false;$('sign-out').hidden=true;$('account-label').textContent='';$('password').value='';$('api-response').textContent='{}';$('activity').replaceChildren();$('live-events').replaceChildren();
  renderTickets();renderDetails();
};
$('create-form').onsubmit=event=>{event.preventDefault();action('Created ticket with '+$('create-api').value,async()=>{const title=$('new-title').value.trim();if(!title||title.length>200)throw new Error('Enter a title between 1 and 200 characters.');const t=await api.create(title,$('create-api').value);merge(t);$('new-title').value='';return t;});};
$('refresh').onclick=()=>action('Refreshed tickets with '+$('list-api').value,()=>load());
$('load-more').onclick=()=>action('Loaded more tickets',()=>load(true));
$('list-api').onchange=()=>action('Loaded tickets with '+$('list-api').value,()=>load());
$('status-filter').onchange=renderTickets;
$('save-ticket').onclick=()=>action('Saved ticket changes with REST',async()=>{const title=$('edit-title').value.trim();if(!title)throw new Error('Enter a ticket title.');const t=await api.update(state.selected.id,{title,status:$('edit-status').value});merge(t);return t;});
$('read-graphql').onclick=()=>action('Read ticket with GraphQL',async()=>{const t=await api.read(state.selected.id,'GraphQL');merge(t);return t;});
$('summarize').onclick=()=>action('Generated summary with Lambda',async()=>{const result=await api.summary(state.selected.id);$('summary-text').textContent=result.summary;return result;});
$('close-ticket').onclick=()=>action('Closed ticket with Lambda',async()=>{const t=await api.close(state.selected.id);merge(t);return t;});
$('refresh-comments').onclick=()=>action('Loaded ticket comments',()=>loadComments());
$('comment-form').onsubmit=event=>{event.preventDefault();action('Added ticket comment',async()=>{const id=state.selected.id,body=$('new-comment').value.trim();if(!body)throw new Error('Enter a comment.');const comment=await api.addComment(id,body);$('new-comment').value='';await loadComments();return comment;});};
$('delete-ticket').onclick=()=>{if(!confirm('Permanently delete this ticket? This cannot be undone.'))return;action('Deleted ticket with REST',async()=>{const id=state.selected.id,result=await api.remove(id);state.tickets=state.tickets.filter(t=>t.id!==id);state.selected=null;renderTickets();renderDetails();return result;});};
$('connect-live').onclick=()=>action(state.livePaused?'Resumed live updates':'Paused live updates',async()=>{state.livePaused=!state.livePaused;if(state.livePaused)live.disconnect();else await live.connect();return {connected:state.connected};});
$('my-tickets').onclick=()=>action('Opened my tickets',()=>load(false,false,$('list-api').value,'mine'));
$('agent-queue').onclick=()=>action('Opened agent queue',()=>load(false,false,'REST','agents'));
window.addEventListener('beforeunload',()=>live.disconnect());
