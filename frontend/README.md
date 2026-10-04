# SupportDesk frontend

The frontend is included in this repository: `index.html`, `style.css`, and `src/`.
It signs in with this application's Cognito pool and calls REST, AppSync, and
WebSocket endpoints directly from the browser. REST and GraphQL share this
application's Ticket table. The other two projects have independent pools,
APIs, tables, asset buckets, and CloudFront distributions.

## Build and deploy

Run `npm ci` and `npm run validate`. The GitHub main deployment workflow prepares
hosting, deploys the backend, exports its actual `amplify_outputs.json`, builds
the frontend, publishes it, and checks each hosted asset against its build hash.

For a manual update after exporting the current backend outputs:

```sh
npm run hosting:prepare
npm run frontend:deploy
node scripts/check-hosting.cjs
```

`hosting.json` records the live URLs. `hosting-template.json` defines a private
S3 asset bucket, CloudFront Origin Access Control, and a separate empty S3
website bucket that redirects to HTTPS. The initial stack was provisioned with
the account's deployment credentials. `ci-hosting-policy.json` grants the
repository's existing GitHub OIDC role scoped access to maintain that stack and
publish assets. Replacing the hosting stack requires provisioning permissions
and regenerating that policy for the new distribution and origin access control.

The build uses esbuild and amazon-cognito-identity-js. It embeds public endpoint
and app client identifiers, never passwords or AWS deployment credentials.
Cognito tokens stay in memory; reloading a page requires signing in again.
The Content Security Policy limits connections to this backend and Cognito.
The REST origin allowlist supports both localhost:3000 and this hosted origin.

## Workflows

- Create and list tickets through REST or generated GraphQL resolvers.
- Edit through REST, then read the same record through GraphQL.
- Get a summary and close a ticket using custom AppSync Lambda resolvers.
- Connect the live channel and look up a ticket through API Gateway WebSocket.
- Open the agent queue with the custom REST Lambda authorizer. Owners receive a
  readable authorization denial; members of the Agents Cognito group can use it.
- Delete only a selected ticket, with an explicit confirmation dialog.

WebSocket lookup is request/response; this example does not broadcast ticket
updates to other connected clients. Existing accounts must be created through
Cognito administration; this demo frontend does not offer public registration.
