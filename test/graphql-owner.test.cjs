const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { VelocityTemplate } = require('@aws-amplify/amplify-appsync-simulator');
test('GraphQL creation assigns the verified creator to customer and Agent tickets, ignoring submitted owners', () => {
  const mode='AMAZON_COGNITO_USER_POOLS';
  const template=new VelocityTemplate({content:fs.readFileSync('amplify/backend/api/supportGraphql/resolvers/Mutation.createTicket.preAuth.1.req.vtl','utf8')},{appSyncConfig:{defaultAuthenticationType:{authenticationType:mode}}});
  const render=(claims,input)=>template.render({arguments:{input},stash:{}},{requestAuthorizationMode:mode,jwt:claims,headers:{},sourceIp:['127.0.0.1']},{fieldName:'createTicket',fieldNodes:[],variableValues:{},parentType:'Mutation'});
  for(const groups of [[],['Agents']])for(const input of [{title:'Ticket',status:'OPEN'},{title:'Ticket',status:'OPEN',owner:'another-user'},{title:'Ticket',status:'OPEN',owner:null}]){
    const result=render({sub:'creator-sub','cognito:username':'creator','cognito:groups':groups},input);
    assert.equal(result.hadException,false);assert.deepEqual(result.errors,[]);assert.equal(result.args.input.owner,'creator-sub::creator');
  }
  for(const claims of [{sub:'creator-sub'},{'cognito:username':'creator'}])assert.equal(render(claims,{title:'Ticket'}).hadException,true);
});
