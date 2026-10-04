const { CognitoJwtVerifier } = require('aws-jwt-verify');
const { identity } = require('./domain.cjs');
let verifier;
function jwtVerifier() {
  verifier ||= CognitoJwtVerifier.create({ userPoolId: process.env.USER_POOL_ID, clientId: process.env.USER_POOL_CLIENT_ID, tokenUse: 'id' });
  return verifier;
}
function createHandler(verify = token => jwtVerifier().verify(token)) {
  return async event => {
    const websocket = event.requestContext?.routeKey === '$connect';
    const raw = event.authorizationToken || event.headers?.Authorization || event.headers?.authorization || (websocket ? event.queryStringParameters?.token : '');
    const token = raw?.replace(/^Bearer\s+/i, '');
    try {
      if (!token) throw new Error();
      const claims = await verify(token);
      const user = identity(claims);
      const allowed = websocket || user.groups.includes('Agents');
      return { principalId: user.sub, policyDocument: { Version: '2012-10-17', Statement: [{ Action: 'execute-api:Invoke', Effect: allowed ? 'Allow' : 'Deny', Resource: event.methodArn }] },
        context: { sub: user.sub, username: claims['cognito:username'] || claims.username, owner: user.owner, groups: user.groups.join(','), expiresAt: user.expiresAt } };
    } catch { throw new Error('Unauthorized'); }
  };
}
module.exports = { createHandler, handler: createHandler() };
