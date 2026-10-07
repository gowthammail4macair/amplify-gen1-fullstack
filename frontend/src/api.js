import { AuthenticationDetails, CognitoUser, CognitoUserPool } from 'amazon-cognito-identity-js';
export class ApiError extends Error {
  constructor(message, details, status) { super(message); this.details=details; this.status=status; }
}
export function authentication(config) {
  const storage={getItem(){return null;},setItem(){},removeItem(){},clear(){}};
  const pool=new CognitoUserPool({UserPoolId:config.poolId,ClientId:config.clientId,Storage:storage});
  let user,session;
  const profile=()=>{const p=session.getIdToken().decodePayload();return {email:p.email||p['cognito:username'],groups:p['cognito:groups']||[]};};
  return {
    signIn(email,password){return new Promise((resolve,reject)=>{user=new CognitoUser({Username:email,Pool:pool,Storage:storage});user.authenticateUser(new AuthenticationDetails({Username:email,Password:password}),{onSuccess(s){session=s;resolve(profile());},onFailure:reject,newPasswordRequired(){reject(new Error('This account requires a password update. Complete the update with your administrator first.'));}});});},
    async token(){if(!session)throw new Error('Please sign in.');if(session.getIdToken().getExpiration()*1000<Date.now()+30000){session=await new Promise((resolve,reject)=>user.refreshSession(session.getRefreshToken(),(error,s)=>error?reject(error):resolve(s)));}return session.getIdToken().getJwtToken();},
    signOut(){user?.signOut();session=null;user=null;}
  };
}
export function ticketApi(config,getToken,request=fetch) {
  async function rest(method,path,input) {
    const response=await request(config.rest+path,{method,headers:{Authorization:await getToken(),'Content-Type':'application/json'},...(input?{body:JSON.stringify(input)}:{}),signal:AbortSignal.timeout(25000)});
    const body=await response.json();if(!response.ok)throw new ApiError(body.message||`Request failed (${response.status})`,body,response.status);return body;
  }
  async function graphql(query,variables={}) {
    const response=await request(config.graphql,{method:'POST',headers:{Authorization:await getToken(),'Content-Type':'application/json'},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(25000)});
    const body=await response.json();if(!response.ok||body.errors?.length)throw new ApiError(body.errors?.[0]?.message||`GraphQL request failed (${response.status})`,body,response.status);return body.data;
  }
  const fields='id title status owner createdAt updatedAt';
  return {
    list(source,nextToken){return source==='GraphQL'?graphql(`query($nextToken:String){listTickets(limit:50,nextToken:$nextToken){items{${fields}} nextToken}}`,{nextToken:nextToken||null}).then(d=>({...d.listTickets,items:d.listTickets.items.filter(Boolean)})):rest('GET','/tickets'+(nextToken?'?nextToken='+encodeURIComponent(nextToken):''));},
    create(title,source){return source==='GraphQL'?graphql(`mutation($input:CreateTicketInput!){createTicket(input:$input){${fields}}}`,{input:{title,status:'OPEN'}}).then(d=>d.createTicket):rest('POST','/tickets',{title});},
    read(id,source='REST'){return source==='GraphQL'?graphql(`query($id:ID!){getTicket(id:$id){${fields}}}`,{id}).then(d=>{if(!d.getTicket)throw new ApiError('Ticket not found or access denied.',d,404);return d.getTicket;}):rest('GET','/tickets/'+encodeURIComponent(id));},
    update(id,changes){return rest('PATCH','/tickets/'+encodeURIComponent(id),changes);},
    remove(id){return rest('DELETE','/tickets/'+encodeURIComponent(id));},
    comments(id){return rest('GET','/tickets/'+encodeURIComponent(id)+'/comments');},
    addComment(id,body){return rest('POST','/tickets/'+encodeURIComponent(id)+'/comments',{body});},
    summary(id){return graphql('query($id:ID!){ticketSummary(id:$id){id title status summary}}',{id}).then(d=>d.ticketSummary);},
    close(id){return graphql(`mutation($id:ID!){closeTicket(id:$id){${fields}}}`,{id}).then(d=>d.closeTicket);},
    agents(){return rest('GET','/admin/tickets');}
  };
}
export function liveChannel(url,getToken,onState,onEvent) {
  let socket, opening, reconnect, heartbeat, wanted=false, attempt=0, generation=0;
  function schedule() {
    if (!wanted || reconnect) return;
    reconnect=setTimeout(()=>{reconnect=null;connect().catch(()=>{});},Math.min(30000,1000*2**Math.min(attempt++,5)));
  }
  async function connect() {
    wanted=true;
    if (socket?.readyState===WebSocket.OPEN) return;
    if (opening) return opening;
    const epoch=generation;
    opening=(async()=>{
      const token=await getToken();
      if (!wanted || epoch!==generation) return;
      await new Promise((resolve,reject)=>{
        const ws=new WebSocket(url+'?token='+encodeURIComponent(token));socket=ws;
        const timeout=setTimeout(()=>{reject(new Error('Live connection timed out.'));ws.close();},20000);
        ws.addEventListener('open',()=>{
          clearTimeout(timeout);
          if (!wanted || socket!==ws) {ws.close();resolve();return;}
          attempt=0;clearTimeout(reconnect);reconnect=null;
          heartbeat=setInterval(()=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({action:'ping'}));},240000);
          onState(true);resolve();
        },{once:true});
        ws.addEventListener('message',event=>{
          if(socket!==ws || !wanted)return;
          try {const message=JSON.parse(event.data);if(['ticketChanged','ticketRemoved'].includes(message.type))onEvent(message);}catch{}
        });
        ws.addEventListener('error',()=>{clearTimeout(timeout);reject(new Error('Live updates could not connect.'));ws.close();},{once:true});
        ws.addEventListener('close',()=>{
          clearTimeout(timeout);
          reject(new Error('Live connection closed.'));
          if(socket!==ws)return;
          clearInterval(heartbeat);socket=null;onState(false);schedule();reject(new Error('Live connection closed.'));
        });
      });
    })().catch(error=>{if(epoch===generation){onState(false);schedule();}throw error;}).finally(()=>{if(epoch===generation)opening=null;});
    return opening;
  }
  return {
    connect,
    disconnect(){wanted=false;generation++;opening=null;clearTimeout(reconnect);reconnect=null;clearInterval(heartbeat);const ws=socket;socket=null;ws?.close();onState(false);}
  };
}
