const { CognitoIdentityProviderClient, ListUsersInGroupCommand } = require('@aws-sdk/client-cognito-identity-provider');
function createAgentOwners(client = new CognitoIdentityProviderClient({}), poolId = process.env.USER_POOL_ID) {
  return async () => {
    const owners = new Set();
    let nextToken;
    do {
      const result = await client.send(new ListUsersInGroupCommand({ UserPoolId: poolId, GroupName: 'Agents', Limit: 60, NextToken: nextToken }));
      for (const user of result.Users || []) {
        const sub = user.Attributes?.find(attribute => attribute.Name === 'sub')?.Value;
        if (sub && user.Username) owners.add(`${sub}::${user.Username}`);
      }
      nextToken = result.NextToken;
    } while (nextToken);
    return [...owners];
  };
}
module.exports = { createAgentOwners, agentOwners: createAgentOwners() };
